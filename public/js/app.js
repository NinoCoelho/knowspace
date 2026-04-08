// Get token from URL or cookie
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');

// If token in URL, redirect to auth endpoint to set cookie
if (urlToken) {
  window.location.href = `/auth?token=${urlToken}`;
  throw new Error('Redirecting to set authentication cookie');
}

// Get token from cookie
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

const token = getCookie('auth_token');

if (!token) {
  document.body.innerHTML = '<div class="flex items-center justify-center h-screen"><div class="text-center"><h1 class="text-2xl font-bold text-red-600">Authentication Required</h1><p class="text-gray-600 mt-2">Please provide a valid token.</p></div></div>';
  throw new Error('No token');
}

// Initialize Socket.IO
const socket = io('/', {
  query: { token }
});

// State
let currentView = 'chat';
let vaultFiles = [];
let currentKanban = null;
let clientSlug = null;
let activeClientSlug = null; // null = own slug, set when admin switches to another client
let isAdmin = false;
let pendingFiles = [];
let sessions = [];
let activeSessionKey = null;
let pendingVaultOpen = null;
let isInitialLoad = true; // true until first chat:history received after connect
const processingSessions = new Set();
let renderedMessageCount = 0; // tracks how many messages are currently displayed
let backgroundPollTimer = null;

// Theme Management
let currentTheme = localStorage.getItem('ks_theme') || 'light';

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('ks_theme', theme);

  const themeIcon = document.getElementById('themeIcon');
  if (themeIcon) {
    themeIcon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  }
}

function toggleTheme() {
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  showToast(`${newTheme === 'dark' ? 'Dark' : 'Light'} mode enabled`, 'info', 2000);
}

// Initialize theme on load
applyTheme(currentTheme);

// Theme toggle button
document.addEventListener('DOMContentLoaded', () => {
  const themeToggleBtn = document.getElementById('themeToggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }
});

// Keyboard Shortcuts System
const shortcuts = {
  'cmd+k': () => openCommandPalette(),
  'cmd+1': () => switchView('chat'),
  'cmd+2': () => switchView('vault'),
  'cmd+n': () => { if (currentView === 'chat') socket.emit('sessions:new'); },
  'cmd+shift+f': () => openUnifiedSearch(),
  'cmd+d': () => toggleTheme(),
  'cmd+/': () => showShortcutsModal(),
  'escape': () => closeAllModals(),
};

function parseShortcut(e) {
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push('cmd');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.key !== 'Escape') parts.push(e.key.toLowerCase());
  else parts.push(e.key.toLowerCase());

  return parts.join('+');
}

function handleKeyboardShortcut(e) {
  // Don't trigger shortcuts when typing in input fields
  const target = e.target;
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true';
  const isAutocomplete = target.closest('#autocompleteDropdown') !== null;

  // Allow Enter for sending messages even in input
  if (e.key === 'Enter' && !e.shiftKey && target === messageInput && !isAutocomplete) {
    return; // Let the existing handler deal with it
  }

  // Allow Escape in inputs to clear or close dropdowns
  if (e.key === 'Escape' && isInput && !isAutocomplete) {
    return;
  }

  // Skip if in input field (except for shortcuts that should work in inputs)
  if (isInput && !['escape', 'cmd+k', 'cmd+shift+f'].includes(parseShortcut(e))) {
    return;
  }

  const shortcut = parseShortcut(e);
  const handler = shortcuts[shortcut];

  if (handler) {
    e.preventDefault();
    try {
      handler();
    } catch (err) {
      console.error('Shortcut error:', err);
    }
  }
}

// Keyboard shortcuts help modal
function showShortcutsModal() {
  const modal = document.getElementById('shortcutsModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function hideShortcutsModal() {
  const modal = document.getElementById('shortcutsModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Close all modals
function closeAllModals() {
  hideShortcutsModal();
  hideCommandPalette();
  hideUnifiedSearch();
  const cardModal = document.getElementById('cardModal');
  if (cardModal) cardModal.classList.add('hidden');

  // Close autocomplete dropdown
  const autocomplete = document.getElementById('autocompleteDropdown');
  if (autocomplete) autocomplete.classList.add('hidden');

  // Close FAB menu
  hideFabMenu();

  // Close any other overlays
  document.querySelectorAll('.vault-modal-overlay, .lightbox-overlay').forEach(el => el.remove());
}

// Quick Actions FAB
let fabMenuOpen = false;

function toggleFabMenu() {
  const menu = document.getElementById('fabMenu');
  const btn = document.getElementById('fabMainBtn');

  fabMenuOpen = !fabMenuOpen;

  if (fabMenuOpen) {
    menu.classList.remove('hidden');
    btn.classList.add('active');
  } else {
    hideFabMenu();
  }
}

function hideFabMenu() {
  const menu = document.getElementById('fabMenu');
  const btn = document.getElementById('fabMainBtn');

  if (menu && !menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
    menu.style.animation = 'fab-out 0.2s ease-in forwards';
  }

  if (btn) btn.classList.remove('active');
  fabMenuOpen = false;
}

function executeQuickAction(action) {
  hideFabMenu();

  switch (action) {
    case 'summarize':
      switchView('chat');
      messageInput.value = 'Summarize our conversation so far, highlighting the key points and action items.';
      messageInput.focus();
      break;
    case 'extract-tasks':
      switchView('chat');
      messageInput.value = 'Extract all action items and tasks from our discussion and format them as a checklist.';
      messageInput.focus();
      break;
    case 'draft-email':
      switchView('chat');
      messageInput.value = 'Draft a professional email based on the context of our conversation. Include a clear subject line and organized content.';
      messageInput.focus();
      break;
    case 'research':
      switchView('chat');
      messageInput.value = 'Help me research this topic. Provide an overview, key concepts, and relevant resources.';
      messageInput.focus();
      break;
    case 'generate-diagram':
      switchView('chat');
      messageInput.value = 'Generate a mermaid diagram that visualizes the concepts we\'ve been discussing. Use flowchart, sequence, or mindmap syntax as appropriate.';
      messageInput.focus();
      break;
  }
}

// Wire up FAB button
document.addEventListener('DOMContentLoaded', () => {
  const fabMainBtn = document.getElementById('fabMainBtn');
  if (fabMainBtn) {
    fabMainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFabMenu();
    });
  }

  // FAB menu items
  document.querySelectorAll('.fab-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      if (action) executeQuickAction(action);
    });
  });

  // Close FAB menu when clicking outside
  document.addEventListener('click', (e) => {
    const fabContainer = document.getElementById('quickActionsFab');
    if (fabContainer && !fabContainer.contains(e.target)) {
      hideFabMenu();
    }
  });
});

// Context-Aware Suggestions
let suggestedFiles = new Set();
const fileMentionPattern = /\[\[([^\]]+)\]\]|@file:([^\s]+)/g;

function analyzeContextForFiles(text) {
  const mentions = [];
  let match;

  while ((match = fileMentionPattern.exec(text)) !== null) {
    const filename = match[1] || match[2];
    mentions.push(filename.trim());
  }

  return mentions;
}

function suggestFiles(filenames) {
  const container = document.getElementById('fileSuggestions');
  if (!container) return;

  if (filenames.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  // Find matching files in vault
  fetch(`/api/vault?token=${token}${asParam()}`)
    .then(r => r.json())
    .then(data => {
      const files = data.files || [];
      const matches = filenames.map(name => {
        const exactMatch = files.find(f => f.path.endsWith(name + '.md') || f.path.endsWith(name + '.markdown'));
        const fuzzyMatch = files.find(f => f.path.toLowerCase().includes(name.toLowerCase()));
        return exactMatch || fuzzyMatch;
      }).filter(f => f && !suggestedFiles.has(f.path));

      if (matches.length > 0) {
        container.innerHTML = matches.map(file => {
          const ext = file.path.split('.').pop().toLowerCase();
          const icon = getFileIcon(ext);
          const name = file.path.split('/').pop().replace(/\.(md|markdown)$/, '');
          return `
            <div class="file-suggestion-chip" data-path="${escapeHtml(file.path)}">
              <i class="fas ${icon}"></i>
              <span>${escapeHtml(name)}</span>
              <i class="fas fa-times close-icon" title="Remove"></i>
            </div>
          `;
        }).join('');

        container.querySelectorAll('.file-suggestion-chip').forEach(chip => {
          chip.addEventListener('click', (e) => {
            if (e.target.classList.contains('close-icon')) {
              e.stopPropagation();
              const path = chip.dataset.path;
              suggestedFiles.delete(path);
              chip.remove();
              if (container.children.length === 0) {
                container.classList.add('hidden');
              }
            } else {
              // Load the file
              const path = chip.dataset.path;
              const file = vaultFiles.find(f => f.path === path);
              if (file) {
                loadFile(file);
                // Add file reference to message input
                messageInput.value += ` [[${path}]] `;
                messageInput.focus();
              }
            }
          });
        });

        matches.forEach(f => suggestedFiles.add(f.path));
      } else {
        container.classList.add('hidden');
      }
    });
}

function addSuggestedActions(messageElement, actionType) {
  if (!messageElement) return;

  const existingActions = messageElement.querySelector('.suggested-actions');
  if (existingActions) return;

  let actions = [];

  switch (actionType) {
    case 'task-detection':
      actions = [
        { icon: 'fa-plus-circle', label: 'Add to Kanban', prompt: 'Create a kanban card for this task' },
        { icon: 'fa-calendar-plus', label: 'Set Reminder', prompt: 'Remind me about this' },
      ];
      break;
    case 'file-mention':
      actions = [
        { icon: 'fa-folder-open', label: 'Open File', prompt: 'Open the referenced file' },
        { icon: 'fa-edit', label: 'Edit File', prompt: 'Let me edit this file' },
      ];
      break;
    case 'research':
      actions = [
        { icon: 'fa-book', label: 'Learn More', prompt: 'Tell me more about this topic' },
        { icon: 'fa-link', label: 'Find Sources', prompt: 'Find sources for this information' },
      ];
      break;
    case 'code':
      actions = [
        { icon: 'fa-copy', label: 'Copy Code', action: 'copy-code' },
        { icon: 'fa-play', label: 'Explain Code', prompt: 'Explain how this code works' },
      ];
      break;
  }

  if (actions.length === 0) return;

  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'suggested-actions';
  actionsContainer.innerHTML = `
    <div class="suggested-actions-label">Suggested Actions</div>
    ${actions.map(a => `
      <button class="suggested-action-btn" data-action="${a.action || ''}" data-prompt="${a.prompt || ''}">
        <i class="fas ${a.icon}"></i>
        <span>${a.label}</span>
      </button>
    `).join('')}
  `;

  actionsContainer.querySelectorAll('.suggested-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const prompt = btn.dataset.prompt;

      if (action === 'copy-code') {
        const codeBlock = messageElement.querySelector('code');
        if (codeBlock) {
          navigator.clipboard.writeText(codeBlock.textContent);
          showToast('Code copied to clipboard', 'success', 2000);
        }
      } else if (prompt) {
        messageInput.value = prompt;
        messageInput.focus();
      }
    });
  });

  messageElement.appendChild(actionsContainer);
}

// Prompt Library
let prompts = [];
let currentPromptFilter = 'all';
let editingPromptId = null;

async function loadPrompts() {
  try {
    const res = await fetch(`/api/prompts?token=${token}${asParam()}`);
    const data = await res.json();
    prompts = data.prompts || [];
    renderPrompts();
  } catch (e) {
    console.error('Failed to load prompts:', e);
  }
}

function renderPrompts() {
  const container = document.getElementById('promptList');
  if (!container) return;

  const filtered = currentPromptFilter === 'all'
    ? prompts
    : prompts.filter(p => p.category === currentPromptFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8" style="color: var(--text-secondary);">
        <i class="fas fa-bookmark" style="font-size: 24px; opacity: 0.3; margin-bottom: 8px;"></i>
        <p class="text-sm">No prompts found</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(prompt => `
    <div class="prompt-item" data-id="${escapeHtml(prompt.id)}">
      <div class="prompt-icon">
        <i class="fas ${prompt.icon || 'fa-robot'}"></i>
      </div>
      <div class="prompt-content">
        <div class="prompt-title">${escapeHtml(prompt.title)}</div>
        <div class="prompt-preview">${escapeHtml(prompt.content)}</div>
      </div>
      <div class="prompt-actions">
        <button class="prompt-action-btn use-prompt" title="Use prompt">
          <i class="fas fa-paper-plane"></i>
        </button>
        <button class="prompt-action-btn edit-prompt" title="Edit">
          <i class="fas fa-pen"></i>
        </button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.prompt-item').forEach(item => {
    const promptId = item.dataset.id;

    item.querySelector('.use-prompt')?.addEventListener('click', (e) => {
      e.stopPropagation();
      usePrompt(promptId);
    });

    item.querySelector('.edit-prompt')?.addEventListener('click', (e) => {
      e.stopPropagation();
      editPrompt(promptId);
    });

    item.addEventListener('click', () => {
      usePrompt(promptId);
    });
  });
}

function openPromptLibrary() {
  const modal = document.getElementById('promptLibraryModal');
  if (modal) {
    modal.classList.remove('hidden');
    loadPrompts();
  }
}

function hidePromptLibrary() {
  document.getElementById('promptLibraryModal')?.classList.add('hidden');
}

function openPromptEditor(promptId = null) {
  const modal = document.getElementById('promptEditorModal');
  const title = document.getElementById('promptEditorTitle');
  const titleInput = document.getElementById('promptTitleInput');
  const categoryInput = document.getElementById('promptCategoryInput');
  const contentInput = document.getElementById('promptContentInput');
  const deleteBtn = document.getElementById('deletePromptBtn');

  if (modal) modal.classList.remove('hidden');

  if (promptId) {
    const prompt = prompts.find(p => p.id === promptId);
    if (prompt) {
      editingPromptId = promptId;
      title.textContent = 'Edit Prompt';
      titleInput.value = prompt.title;
      categoryInput.value = prompt.category || 'custom';
      contentInput.value = prompt.content;
      deleteBtn.style.display = 'block';
      deleteBtn.onclick = () => deletePrompt(promptId);
    }
  } else {
    editingPromptId = null;
    title.textContent = 'New Prompt';
    titleInput.value = '';
    categoryInput.value = 'custom';
    contentInput.value = '';
    deleteBtn.style.display = 'none';
  }
}

function hidePromptEditor() {
  document.getElementById('promptEditorModal')?.classList.add('hidden');
  editingPromptId = null;
}

async function savePrompt() {
  const titleInput = document.getElementById('promptTitleInput');
  const categoryInput = document.getElementById('promptCategoryInput');
  const contentInput = document.getElementById('promptContentInput');

  const title = titleInput.value.trim();
  const category = categoryInput.value;
  const content = contentInput.value.trim();

  if (!title || !content) {
    showToast('Please enter a title and content', 'error', 3000);
    return;
  }

  try {
    const res = await fetch(`/api/prompts?token=${token}${asParam()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: {
          id: editingPromptId,
          title,
          category,
          content,
          icon: getCategoryIcon(category)
        }
      })
    });

    const data = await res.json();
    if (data.success) {
      prompts = data.prompts || prompts;
      renderPrompts();
      hidePromptEditor();
      showToast(editingPromptId ? 'Prompt updated' : 'Prompt created', 'success', 2000);
    }
  } catch (e) {
    console.error('Failed to save prompt:', e);
    showToast('Failed to save prompt', 'error', 3000);
  }
}

async function deletePrompt(promptId) {
  if (!confirm('Are you sure you want to delete this prompt?')) return;

  try {
    const res = await fetch(`/api/prompts?token=${token}${asParam()}&id=${encodeURIComponent(promptId)}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (data.success) {
      prompts = prompts.filter(p => p.id !== promptId);
      renderPrompts();
      hidePromptEditor();
      showToast('Prompt deleted', 'success', 2000);
    }
  } catch (e) {
    console.error('Failed to delete prompt:', e);
    showToast('Failed to delete prompt', 'error', 3000);
  }
}

function usePrompt(promptId) {
  const prompt = prompts.find(p => p.id === promptId);
  if (!prompt) return;

  hidePromptLibrary();
  switchView('chat');

  // Check if prompt has placeholder
  if (prompt.content.includes('{topic}')) {
    const topic = prompt('Enter topic for the prompt:');
    if (topic) {
      messageInput.value = prompt.content.replace('{topic}', topic);
    }
  } else {
    messageInput.value = prompt.content;
  }

  messageInput.focus();
}

function editPrompt(promptId) {
  openPromptEditor(promptId);
}

function getCategoryIcon(category) {
  const icons = {
    conversation: 'fa-comments',
    productivity: 'fa-check-double',
    creativity: 'fa-lightbulb',
    code: 'fa-code',
    writing: 'fa-pen-fancy',
    research: 'fa-search',
    custom: 'fa-robot'
  };
  return icons[category] || 'fa-robot';
}

// Wire up prompt library UI
document.addEventListener('DOMContentLoaded', () => {
  // Manage prompts button
  document.getElementById('managePromptsBtn')?.addEventListener('click', openPromptLibrary);

  // Close prompt library
  document.getElementById('closePromptModal')?.addEventListener('click', hidePromptLibrary);
  document.getElementById('promptLibraryModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'promptLibraryModal') hidePromptLibrary();
  });

  // Category filter
  document.querySelectorAll('.prompt-category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.prompt-category-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPromptFilter = btn.dataset.category;
      renderPrompts();
    });
  });

  // Add new prompt
  document.getElementById('addPromptBtn')?.addEventListener('click', () => {
    openPromptEditor();
  });

  // Close prompt editor
  document.getElementById('closePromptEditor')?.addEventListener('click', hidePromptEditor);
  document.getElementById('cancelPromptBtn')?.addEventListener('click', hidePromptEditor);
  document.getElementById('promptEditorModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'promptEditorModal') hidePromptEditor();
  });

  // Save prompt
  document.getElementById('savePromptBtn')?.addEventListener('click', savePrompt);
});

// Command Palette
const commands = [
  {
    id: 'go-chat',
    title: 'Go to Chat',
    description: 'Switch to chat view',
    icon: 'fa-comment',
    shortcut: '⌘1',
    category: 'navigation',
    action: () => switchView('chat')
  },
  {
    id: 'go-vault',
    title: 'Go to Vault',
    description: 'Switch to vault view',
    icon: 'fa-folder',
    shortcut: '⌘2',
    category: 'navigation',
    action: () => switchView('vault')
  },
  {
    id: 'new-chat',
    title: 'New Chat',
    description: 'Start a new conversation',
    icon: 'fa-plus',
    shortcut: '⌘N',
    category: 'actions',
    action: () => {
      switchView('chat');
      socket.emit('sessions:new');
    }
  },
  {
    id: 'search',
    title: 'Search',
    description: 'Search across vault, chat, and kanban',
    icon: 'fa-search',
    shortcut: '⇧⌘F',
    category: 'actions',
    action: () => openUnifiedSearch()
  },
  {
    id: 'upload-file',
    title: 'Upload File',
    description: 'Upload a file to the vault',
    icon: 'fa-upload',
    shortcut: '',
    category: 'actions',
    action: () => uploadBtn?.click()
  },
  {
    id: 'toggle-theme',
    title: 'Toggle Dark Mode',
    description: 'Switch between light and dark theme',
    icon: 'fa-moon',
    shortcut: '⌘D',
    category: 'settings',
    action: () => toggleTheme()
  },
  {
    id: 'prompt-library',
    title: 'Prompt Library',
    description: 'Manage and use saved prompts',
    icon: 'fa-bookmark',
    shortcut: '',
    category: 'settings',
    action: () => openPromptLibrary()
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    description: 'View all keyboard shortcuts',
    icon: 'fa-keyboard',
    shortcut: '⌘/',
    category: 'settings',
    action: () => showShortcutsModal()
  }
];

let commandPaletteVisible = false;
let selectedCommandIndex = -1;
let filteredCommands = [];

function openCommandPalette() {
  const palette = document.getElementById('commandPalette');
  const input = document.getElementById('commandInput');
  if (palette && input) {
    palette.classList.remove('hidden');
    input.value = '';
    input.focus();
    commandPaletteVisible = true;
    filteredCommands = [...commands];
    selectedCommandIndex = -1;
    renderCommands('');
  }
}

function hideCommandPalette() {
  const palette = document.getElementById('commandPalette');
  if (palette) {
    palette.classList.add('hidden');
    commandPaletteVisible = false;
    selectedCommandIndex = -1;
  }
}

function renderCommands(query) {
  const list = document.getElementById('commandList');
  if (!list) return;

  if (!query) {
    // Group by category
    const grouped = commands.reduce((acc, cmd) => {
      if (!acc[cmd.category]) acc[cmd.category] = [];
      acc[cmd.category].push(cmd);
      return acc;
    }, {});

    const categoryOrder = { navigation: 1, actions: 2, settings: 3 };
    const sortedCategories = Object.keys(grouped).sort((a, b) =>
      (categoryOrder[a] || 99) - (categoryOrder[b] || 99)
    );

    filteredCommands = commands;
    selectedCommandIndex = -1;

    list.innerHTML = sortedCategories.map(category => {
      const categoryLabels = {
        navigation: 'Navigation',
        actions: 'Actions',
        settings: 'Settings'
      };
      return `
        <div class="command-section">
          <div class="command-section-title">${categoryLabels[category] || category}</div>
          ${grouped[category].map(cmd => renderCommandItem(cmd)).join('')}
        </div>
      `;
    }).join('');
  } else {
    // Filter commands
    const q = query.toLowerCase();
    filteredCommands = commands.filter(cmd =>
      cmd.title.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q)
    );

    selectedCommandIndex = -1;

    if (filteredCommands.length === 0) {
      list.innerHTML = '<div class="no-results">No commands found</div>';
    } else {
      list.innerHTML = filteredCommands.map(cmd => renderCommandItem(cmd)).join('');
    }
  }
}

function renderCommandItem(cmd) {
  return `
    <div class="command-item" data-id="${cmd.id}">
      <div class="command-item-icon">
        <i class="fas ${cmd.icon}"></i>
      </div>
      <div class="command-item-info">
        <div class="command-item-title">${escapeHtml(cmd.title)}</div>
        <div class="command-item-desc">${escapeHtml(cmd.description)}</div>
      </div>
      ${cmd.shortcut ? `<kbd class="command-item-shortcut">${cmd.shortcut}</kbd>` : ''}
    </div>
  `;
}

function executeCommand(command) {
  if (command && command.action) {
    try {
      command.action();
    } catch (err) {
      console.error('Command error:', err);
    }
  }
  hideCommandPalette();
}

function selectNextCommand() {
  if (filteredCommands.length === 0) return;
  selectedCommandIndex = (selectedCommandIndex + 1) % filteredCommands.length;
  updateCommandSelection();
}

function selectPreviousCommand() {
  if (filteredCommands.length === 0) return;
  selectedCommandIndex = selectedCommandIndex <= 0 ? filteredCommands.length - 1 : selectedCommandIndex - 1;
  updateCommandSelection();
}

function updateCommandSelection() {
  document.querySelectorAll('.command-item').forEach((item, index) => {
    item.classList.toggle('selected', index === selectedCommandIndex);
  });
  // Scroll selected into view
  const selected = document.querySelector('.command-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function getSelectedCommand() {
  if (selectedCommandIndex >= 0 && selectedCommandIndex < filteredCommands.length) {
    return filteredCommands[selectedCommandIndex];
  }
  return null;
}

// Unified Search
let unifiedSearchVisible = false;

function openUnifiedSearch() {
  const modal = document.getElementById('unifiedSearchModal');
  const input = document.getElementById('unifiedSearchInput');
  if (modal && input) {
    modal.classList.remove('hidden');
    input.value = '';
    input.focus();
    unifiedSearchVisible = true;
  }
}

function hideUnifiedSearch() {
  const modal = document.getElementById('unifiedSearchModal');
  if (modal) {
    modal.classList.add('hidden');
    unifiedSearchVisible = false;
  }
}

async function performUnifiedSearch(query) {
  const resultsDiv = document.getElementById('searchResults');
  if (!resultsDiv || !query.trim()) {
    if (resultsDiv) resultsDiv.innerHTML = '<div class="search-placeholder"><i class="fas fa-search" style="font-size: 32px; opacity: 0.3; margin-bottom: 12px;"></i><p>Type to search across all your content</p></div>';
    return;
  }

  resultsDiv.innerHTML = '<div style="display: flex; justify-content: center; padding: 40px;"><i class="fas fa-circle-notch fa-spin" style="font-size: 24px; color: var(--accent-primary);"></i></div>';

  const results = {
    vault: [],
    chat: [],
    kanban: []
  };

  // Search vault
  try {
    const vaultRes = await fetch(`/api/vault/search?token=${token}${asParam()}&q=${encodeURIComponent(query)}`);
    const vaultData = await vaultRes.json();
    results.vault = (vaultData.results || []).map(f => ({
      type: 'vault',
      id: f.path,
      title: f.path.split('/').pop(),
      path: f.path,
      preview: 'Vault file'
    }));
  } catch (e) {}

  // Search chat (search in current messages)
  const chatMessages = Array.from(document.querySelectorAll('.message.assistant .prose, .message.user'))
    .filter(el => el.textContent.toLowerCase().includes(query.toLowerCase()));

  results.chat = chatMessages.map((el, i) => ({
    type: 'chat',
    id: `chat-${i}`,
    title: 'Message',
    preview: el.textContent.substring(0, 200) + '...',
    element: el
  }));

  // Search kanban cards
  try {
    const kanbanRes = await fetch(`/api/kanban/list?token=${token}${asParam()}`);
    const kanbanData = await kanbanRes.json();
    const boards = kanbanData.boards || [];

    for (const board of boards) {
      const boardRes = await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(board.file)}`);
      const boardData = await boardRes.json();
      const kanban = boardData.kanban;

      if (kanban && kanban.lanes) {
        for (const lane of kanban.lanes) {
          for (const card of lane.cards) {
            const cardText = `${card.title} ${card.body || ''}`.toLowerCase();
            if (cardText.includes(query.toLowerCase())) {
              results.kanban.push({
                type: 'kanban',
                id: `${board.file}-${card.id}`,
                title: card.title,
                board: board.title,
                lane: lane.title,
                preview: card.body?.substring(0, 100) || '',
                file: board.file
              });
            }
          }
        }
      }
    }
  } catch (e) {}

  renderSearchResults(results);
}

function renderSearchResults(results) {
  const resultsDiv = document.getElementById('searchResults');
  if (!resultsDiv) return;

  const hasResults = results.vault.length > 0 || results.chat.length > 0 || results.kanban.length > 0;

  if (!hasResults) {
    resultsDiv.innerHTML = '<div class="search-no-results"><i class="fas fa-search-minus" style="font-size: 32px; opacity: 0.3; margin-bottom: 12px;"></i><p>No results found</p></div>';
    return;
  }

  let html = '';

  if (results.vault.length > 0) {
    html += '<div class="search-section-title">Vault Files</div>';
    results.vault.forEach(item => {
      html += `
        <div class="search-result-item" data-type="vault" data-path="${escapeHtml(item.path)}">
          <div class="search-result-header">
            <div class="search-result-icon"><i class="fas fa-file-alt"></i></div>
            <div class="search-result-title">${escapeHtml(item.title)}</div>
            <span class="search-result-type vault">Vault</span>
          </div>
          <div class="search-result-preview">${escapeHtml(item.path)}</div>
        </div>
      `;
    });
  }

  if (results.chat.length > 0) {
    html += '<div class="search-section-title">Chat Messages</div>';
    results.chat.forEach((item, i) => {
      html += `
        <div class="search-result-item" data-type="chat" data-index="${i}">
          <div class="search-result-header">
            <div class="search-result-icon"><i class="fas fa-comment"></i></div>
            <div class="search-result-title">Message</div>
            <span class="search-result-type chat">Chat</span>
          </div>
          <div class="search-result-preview">${escapeHtml(item.preview)}</div>
        </div>
      `;
    });
  }

  if (results.kanban.length > 0) {
    html += '<div class="search-section-title">Kanban Cards</div>';
    results.kanban.forEach(item => {
      html += `
        <div class="search-result-item" data-type="kanban" data-file="${escapeHtml(item.file)}">
          <div class="search-result-header">
            <div class="search-result-icon"><i class="fas fa-columns"></i></div>
            <div class="search-result-title">${escapeHtml(item.title)}</div>
            <span class="search-result-type kanban">Kanban</span>
          </div>
          <div class="search-result-meta">${escapeHtml(item.board)} • ${escapeHtml(item.lane)}</div>
          <div class="search-result-preview">${escapeHtml(item.preview)}</div>
        </div>
      `;
    });
  }

  resultsDiv.innerHTML = html;

  // Add click handlers
  resultsDiv.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      if (type === 'vault') {
        const path = item.dataset.path;
        const file = vaultFiles.find(f => f.path === path);
        if (file) {
          switchView('vault');
          loadFile(file);
        }
      } else if (type === 'chat') {
        // Scroll to the message
        const index = parseInt(item.dataset.index);
        const chatMsg = results.chat[index].element;
        if (chatMsg) {
          chatMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
          chatMsg.style.animation = 'highlight 2s ease';
        }
      } else if (type === 'kanban') {
        const file = item.dataset.file;
        currentKanbanFile = file;
        switchView('vault');
        document.getElementById('sidebarVault')?.classList.remove('hidden');
        document.getElementById('sidebarChat')?.classList.add('hidden');
        loadKanban();
        loadKanbanList();
      }
      hideUnifiedSearch();
    });
  });
}

// Wire up unified search modal
const searchInput = document.getElementById('unifiedSearchInput');
let searchTimeout = null;

searchInput?.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    performUnifiedSearch(e.target.value);
  }, 300);
});

searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideUnifiedSearch();
  }
});

document.getElementById('closeSearchModal')?.addEventListener('click', hideUnifiedSearch);
document.getElementById('unifiedSearchModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'unifiedSearchModal') hideUnifiedSearch();
});

// Dashboard functionality
function loadDashboard() {
  loadDashboardTasks();
  loadDashboardRecentFiles();
  updateAgentStatus();
}

async function loadDashboardTasks() {
  const tasksContainer = document.getElementById('dashboardTasks');
  if (!tasksContainer) return;

  try {
    const res = await fetch(`/api/kanban/list?token=${token}${asParam()}`);
    const data = await res.json();
    const boards = data.boards || [];

    const todayTasks = [];

    for (const board of boards) {
      const boardRes = await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(board.file)}`);
      const boardData = await boardRes.json();
      const kanban = boardData.kanban;

      if (kanban && kanban.lanes) {
        for (const lane of kanban.lanes) {
          for (const card of lane.cards) {
            const hasUnchecked = card.body && /- \[ \]/.test(card.body);
            if (hasUnchecked || !card.body) {
              todayTasks.push({
                title: card.title,
                board: board.title,
                lane: lane.title,
                file: board.file,
                cardId: card.id
              });
            }
          }
        }
      }
    }

    if (todayTasks.length > 0) {
      tasksContainer.innerHTML = todayTasks.slice(0, 5).map(task => `
        <div class="task-item" data-file="${escapeHtml(task.file)}" data-card-id="${escapeHtml(task.cardId)}">
          <input type="checkbox" class="task-checkbox">
          <span class="task-title">${escapeHtml(task.title)}</span>
        </div>
      `).join('');

      tasksContainer.querySelectorAll('.task-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('task-checkbox')) return;
          const file = item.dataset.file;
          currentKanbanFile = file;
          switchView('vault');
          document.getElementById('sidebarVault')?.classList.remove('hidden');
          document.getElementById('sidebarChat')?.classList.add('hidden');
          loadKanban();
          loadKanbanList();
        });
      });

      tasksContainer.querySelectorAll('.task-checkbox').forEach((checkbox, i) => {
        checkbox.addEventListener('change', (e) => {
          const item = e.target.closest('.task-item');
          item.classList.toggle('checked', checkbox.checked);
        });
      });
    } else {
      tasksContainer.innerHTML = `
        <div class="text-center py-8" style="color: var(--text-secondary);">
          <i class="fas fa-clipboard-list" style="font-size: 24px; opacity: 0.3; margin-bottom: 8px;"></i>
          <p class="text-sm">No tasks for today</p>
        </div>
      `;
    }
  } catch (e) {
    console.error('Failed to load tasks:', e);
  }
}

async function loadDashboardRecentFiles() {
  const recentContainer = document.getElementById('dashboardRecentFiles');
  if (!recentContainer) return;

  const recentFiles = JSON.parse(localStorage.getItem('ks_recentFiles') || '[]');
  const uniqueRecent = [...new Set(recentFiles)].slice(0, 5);

  if (uniqueRecent.length > 0) {
    const files = await fetch(`/api/vault?token=${token}${asParam()}`)
      .then(r => r.json())
      .then(data => (data.files || []))
      .catch(() => []);

    recentContainer.innerHTML = uniqueRecent.map(path => {
      const file = files.find(f => f.path === path);
      const ext = path.split('.').pop().toLowerCase();
      const icon = getFileIcon(ext);
      const name = path.split('/').pop().replace(/\.(md|markdown)$/, '');

      return `
        <div class="recent-file-item" data-path="${escapeHtml(path)}">
          <div class="recent-file-icon">
            <i class="fas ${icon}"></i>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; color: var(--text-primary);">${escapeHtml(name)}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(path)}</div>
          </div>
        </div>
      `;
    }).join('');

    recentContainer.querySelectorAll('.recent-file-item').forEach(item => {
      item.addEventListener('click', () => {
        const path = item.dataset.path;
        const file = vaultFiles.find(f => f.path === path);
        if (file) {
          switchView('vault');
          loadFile(file);
        }
      });
    });
  } else {
    recentContainer.innerHTML = `
      <div class="text-center py-8" style="color: var(--text-secondary);">
        <i class="fas fa-file-alt" style="font-size: 24px; opacity: 0.3; margin-bottom: 8px;"></i>
        <p class="text-sm">No recent files</p>
      </div>
    `;
  }
}

function updateAgentStatus() {
  const statusDiv = document.getElementById('dashboardAgentStatus');
  if (!statusDiv) return;

  const isProcessing = processingSessions.size > 0;

  statusDiv.innerHTML = `
    <div class="flex items-center gap-2 py-2">
      <div class="status-indicator" style="width: 8px; height: 8px; border-radius: 50%; background: ${isProcessing ? '#f59e0b' : '#10b981'};"></div>
      <span style="color: var(--text-primary); font-size: 14px;">${isProcessing ? 'Processing...' : 'Ready'}</span>
    </div>
    <p class="text-xs mt-2" style="color: var(--text-secondary);">${isProcessing ? 'Your AI assistant is working on a task.' : 'Your AI assistant is ready to help.'}</p>
  `;
}

// Track recently accessed files
const originalLoadFile = loadFile;
loadFile = function(file) {
  const result = originalLoadFile.call(this, file);
  if (file && file.path) {
    const recent = JSON.parse(localStorage.getItem('ks_recentFiles') || '[]');
    recent.unshift(file.path);
    const uniqueRecent = [...new Set(recent)].slice(0, 10);
    localStorage.setItem('ks_recentFiles', JSON.stringify(uniqueRecent));

    if (currentView === 'home') {
      loadDashboardRecentFiles();
    }
  }
  return result;
};

// Wire up dashboard buttons
document.getElementById('goToKanbanBtn')?.addEventListener('click', () => {
  switchView('vault');
  document.getElementById('sidebarVault')?.classList.remove('hidden');
  document.getElementById('sidebarChat')?.classList.add('hidden');
  loadKanban();
  loadKanbanList();
});

document.getElementById('goToVaultBtn')?.addEventListener('click', () => {
  switchView('vault');
});

// Quick prompts
document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt;
    if (prompt) {
      switchView('chat');
      messageInput.value = prompt;
      messageInput.focus();
    }
  });
});

// Quick actions
document.querySelectorAll('.quick-action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;

    switch (action) {
      case 'new-chat':
        switchView('chat');
        socket.emit('sessions:new');
        break;
      case 'new-kanban':
        switchView('vault');
        document.getElementById('sidebarVault')?.classList.remove('hidden');
        document.getElementById('sidebarChat')?.classList.add('hidden');
        const name = prompt('Board name:');
        if (name) {
          createNewKanbanBoard(name);
        }
        break;
      case 'upload':
        uploadBtn?.click();
        break;
      case 'search':
        openUnifiedSearch();
        break;
    }
  });
});

// Create new kanban board (simplified)
async function createNewKanbanBoard(name) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let file = slug + '.md';

  try {
    const listRes = await fetch(`/api/kanban/list?token=${token}${asParam()}`);
    const listData = await listRes.json();
    if (listData.boards?.some(b => b.file === file)) {
      file = slug + '-' + Date.now().toString(36) + '.md';
    }
  } catch (e) {}

  const newKanban = {
    title: name.trim(),
    lanes: [
      { id: 'todo', title: 'To Do', cards: [] },
      { id: 'in-progress', title: 'In Progress', cards: [] },
      { id: 'done', title: 'Done', cards: [] }
    ]
  };

  await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(file)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kanban: newKanban })
  });

  currentKanbanFile = file;
  currentKanban = newKanban;
  renderKanban();
  loadKanbanList();
  showToast(`Created board: ${name}`, 'success', 2000);
}

// Wire up shortcuts modal close buttons
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('closeShortcutsModal')?.addEventListener('click', hideShortcutsModal);
  document.getElementById('closeShortcutsModalBtn')?.addEventListener('click', hideShortcutsModal);

  // Close modal on overlay click
  document.getElementById('shortcutsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'shortcutsModal') hideShortcutsModal();
  });

  // Command Palette
  const commandInput = document.getElementById('commandInput');
  const commandPalette = document.getElementById('commandPalette');

  commandInput?.addEventListener('input', (e) => {
    renderCommands(e.target.value);
    selectedCommandIndex = -1;
  });

  commandInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectNextCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectPreviousCommand();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = getSelectedCommand();
      if (cmd) {
        executeCommand(cmd);
      }
    }
  });

  commandPalette?.addEventListener('click', (e) => {
    const item = e.target.closest('.command-item');
    if (item) {
      const id = item.dataset.id;
      const cmd = commands.find(c => c.id === id);
      executeCommand(cmd);
    } else if (e.target.id === 'commandPalette') {
      hideCommandPalette();
    }
  });

  // Register global keyboard handler
  document.addEventListener('keydown', handleKeyboardShortcut);
});

// Append ?as=<slug> to API calls when admin has switched to another client
function asParam() {
  return activeClientSlug ? `&as=${activeClientSlug}` : '';
}

// DOM Elements
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const vaultTree = document.getElementById('vaultTree');
const vaultContent = document.getElementById('vaultContent');

// Add file mention detection to message input
messageInput?.addEventListener('input', (e) => {
  const mentions = analyzeContextForFiles(e.target.value);
  if (mentions.length > 0) {
    suggestFiles(mentions);
  } else {
    const container = document.getElementById('fileSuggestions');
    if (container) container.classList.add('hidden');
  }
});
const vaultFileName = document.getElementById('vaultFileName');
const vaultSearch = document.getElementById('vaultSearch');
const kanbanBoard = document.getElementById('kanbanBoard');
const clientName = document.getElementById('clientName');
const uploadBtn = document.getElementById('uploadBtn');
const sessionList = document.getElementById('sessionList');
const newSessionBtn = document.getElementById('newSessionBtn');

// Session sidebar

function renderSessionList() {
  sessionList.innerHTML = '';

  const portalSessions = sessions.filter(s => !s.isSubagent);

  portalSessions.forEach(session => {
    const isActive = session.key === activeSessionKey && currentView === 'chat';
    const div = document.createElement('div');
    div.className = `session-item ${isActive ? 'active' : ''}`;
    const isProcessing = processingSessions.has(session.key);
    div.innerHTML = `
      <div class="session-name">${isProcessing ? '<span class="processing-badge" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-right:6px;animation:pulse-badge 1.2s ease-in-out infinite;vertical-align:middle;"></span>' : ''}${escapeHtml(session.label || 'Untitled')}</div>
      <div class="session-date">${isProcessing ? '<span style="color:#f59e0b;font-size:10px;">processing...</span>' : formatSessionDate(session.updatedAt)}</div>
      <div class="session-actions">
        <button class="session-action-btn rename-session" title="Rename">
          <i class="fas fa-pen"></i>
        </button>
        <button class="session-action-btn delete-session" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.closest('.session-actions')) return;
      // Switch to chat view if not already there
      if (currentView !== 'chat') switchView('chat');
      socket.emit('sessions:switch', { sessionKey: session.key });
    });
    div.querySelector('.rename-session').addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt('Rename conversation:', session.label || '');
      if (newName && newName.trim()) {
        socket.emit('sessions:rename', { sessionKey: session.key, name: newName.trim() });
      }
    });
    div.querySelector('.delete-session').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete this conversation?')) {
        socket.emit('sessions:delete', { sessionKey: session.key });
      }
    });
    sessionList.appendChild(div);
  });
}

function formatSessionDate(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts : ts);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString();
}

newSessionBtn.addEventListener('click', () => {
  if (currentView !== 'chat') switchView('chat');
  socket.emit('sessions:new');
});

socket.on('sessions:list', (data) => {
  sessions = data.sessions || [];
  renderSessionList();
});

socket.on('client:switched', (data) => {
  // Reload the active view for the new client context
  if (currentView === 'vault') loadVault();
});

// Mermaid and library initialization
window.addEventListener('DOMContentLoaded', () => {
  if (window.mermaid) {
    window.mermaid.init(window.mermaidConfig || { startOnLoad: false }, document.querySelectorAll('.prose .mermaid'));
  }
});

// Configure marked with custom renderer for all enhancements
if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();

  // Headings with anchor links (marked v5+ passes object {text, depth, raw})
  renderer.heading = function(data) {
    const text = typeof data === 'object' ? data.text : data;
    const level = typeof data === 'object' ? data.depth : arguments[1];
    const escapedText = text.toLowerCase().replace(/[^\w]+/g, '-');
    return `<h${level} id="${escapedText}">${text}<a class="heading-anchor" href="#${escapedText}" title="Link"><i class="fas fa-link"></i></a></h${level}>`;
  };

  // Code blocks with syntax highlighting via highlight.js
  // marked v5+: code(code, lang, escaped) → code({ text, lang, escaped })
  renderer.code = function(data) {
    const code = typeof data === 'object' ? data.text : data;
    const language = typeof data === 'object' ? data.lang : (arguments[1] || '');
    const lang = language.split('{')[0].trim();
    let highlighted;
    try {
      if (typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, { language: lang }).value;
      } else {
        highlighted = escapeHtml(code);
      }
    } catch (e) {
      highlighted = escapeHtml(code);
    }
    // Handle mermaid specially
    if (lang === 'mermaid') {
      return `<div class="mermaid">${code}</div>`;
    }
    return `<pre><code class="hljs language-${lang || 'plaintext'}">${highlighted}</code></pre>`;
  };

  // Inline code
  renderer.codespan = function(data) {
    const code = typeof data === 'object' ? data.text : data;
    return `<code>${escapeHtml(code)}</code>`;
  };

  // Images with lightbox support
  renderer.image = function(data) {
    const href = typeof data === 'object' ? data.href : arguments[0];
    const title = typeof data === 'object' ? data.title : arguments[1];
    const text = typeof data === 'object' ? data.text : arguments[2];
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${href}" alt="${escapeHtml(text)}"${titleAttr} class="lightbox-img" data-src="${href}">`;
  };

  // Table of contents generation (post-render)
  marked.setOptions({
    breaks: true,
    gfm: true,
    renderer: renderer
  });
}

// Render markdown with all post-processing enhancements
function renderMarkdown(content, container) {
  if (typeof marked === 'undefined') return escapeHtml(content);
  let html = marked.parse(content);

  // Handle wiki-style [[Page Name]] links
  html = html.replace(/\[\[([^\]]+)\]\]/g, (match, pageName) => {
    const slug = pageName.trim().replace(/\s+/g, '-').toLowerCase();
    return `<a class="vault-wiki-link" data-wiki-page="${escapeHtml(pageName.trim())}" href="javascript:void(0)">${escapeHtml(pageName)}</a>`;
  });

  // Handle callout blocks: > [!note], > [!tip], etc.
  html = html.replace(/^&gt; \[!(note|tip|warning|danger|info)\]\s*\n((?:&gt;.*\n?)*)/gim, (match, type, body) => {
    const icons = { note: 'fa-sticky-note', tip: 'fa-lightbulb', warning: 'fa-exclamation-triangle', danger: 'fa-skull', info: 'fa-info-circle' };
    const icon = icons[type.toLowerCase()] || 'fa-info-circle';
    const cleanBody = body.replace(/^&gt;\s?/gm, '').trim();
    return `<div class="callout callout-${type.toLowerCase()}"><div class="callout-title"><i class="fas ${icon}"></i> ${type.charAt(0).toUpperCase() + type.slice(1)}</div><div class="callout-body">${cleanBody}</div></div>`;
  });

  // Handle GFM footnotes (convert to renderable format)
  html = html.replace(/\[\^(\w+)\]/g, '<sup class="footnote-ref" id="fnref-$1"><a href="#fn-$1" class="footnote-back">[$1]</a></sup>');
  html = html.replace(/^\[\^(\w+)\]:\s*(.*)$/gm, '<li id="fn-$1">$2 <a href="#fnref-$1">↩</a></li>');

  if (container) {
    container.innerHTML = html;

    // Apply syntax highlighting to code blocks
    container.querySelectorAll('pre code:not(.hljs)').forEach(block => {
      const lang = block.className.replace('language-', '').trim();
      if (hljs.getLanguage(lang)) {
        try { block.innerHTML = hljs.highlight(block.textContent, { language: lang }).value; block.classList.add('hljs'); } catch (e) {}
      }
    });

    // Initialize mermaid diagrams
    if (window.mermaid) {
      container.querySelectorAll('.mermaid').forEach(el => {
        window.mermaid.init(window.mermaidConfig || { startOnLoad: false }, el);
      });
    }

    // Render KaTeX math
    if (typeof renderMathInElement !== 'undefined') {
      try {
        renderMathInElement(container, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false
        });
      } catch (e) { /* math render error */ }
    }

    // Image lightbox
    container.querySelectorAll('img.lightbox-img').forEach(img => {
      img.addEventListener('click', () => openLightbox(img.dataset.src || img.src, img.alt));
    });

    // Wiki links
    container.querySelectorAll('.vault-wiki-link').forEach(link => {
      link.addEventListener('click', () => {
        const pageName = link.dataset.wikiPage;
        // Find matching vault file
        const target = vaultFiles.find(f => {
          const name = f.path.split('/').pop().replace(/\.md$/i, '');
          return name.toLowerCase() === pageName.toLowerCase() ||
                 name.toLowerCase().replace(/\s+/g, '-') === pageName.toLowerCase().replace(/\s+/g, '-');
        });
        if (target) loadFile(target);
        else {
          // Try searching
          fetch(`/api/vault/search?token=${token}${asParam()}&q=${encodeURIComponent(pageName)}`).then(r => r.json()).then(data => {
            if (data.results && data.results[0]) loadFile(data.results[0]);
            else showToast('Page not found: ' + pageName, 'warning');
          }).catch(() => showToast('Page not found: ' + pageName, 'warning'));
        }
      });
    });

    // Wrap footnotes section if any footnotes exist
    const footnotes = container.querySelector('li[id^="fn-"]');
    if (footnotes) {
      const footnotesSection = document.createElement('div');
      footnotesSection.className = 'footnotes';
      const ol = document.createElement('ol');
      container.querySelectorAll('li[id^="fn-"]').forEach(fn => ol.appendChild(fn));
      footnotesSection.appendChild(ol);
      container.appendChild(footnotesSection);
    }
  }

  return html;
}

// Post-render markdown enhancements (applies to container with innerHTML already set)
function applyMarkdownEnhancements(container) {
  if (!container) return;

  // Syntax highlighting for code blocks
  container.querySelectorAll('pre code:not(.hljs)').forEach(block => {
    const lang = block.className.replace('language-', '').trim();
    if (hljs.getLanguage(lang)) {
      try { block.innerHTML = hljs.highlight(block.textContent, { language: lang }).value; block.classList.add('hljs'); } catch (e) {}
    }
  });

  // Mermaid diagrams
  if (window.mermaid) {
    container.querySelectorAll('.mermaid').forEach(el => {
      window.mermaid.init(window.mermaidConfig || { startOnLoad: false }, el);
    });
  }

  // KaTeX math rendering
  if (typeof renderMathInElement !== 'undefined') {
    try {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    } catch (e) {}
  }

  // Render #hashtags as clickable chips
  container.querySelectorAll('p, li, span:not(.tag-chip):not(.hljs):not(.mermaid)').forEach(el => {
    if (el.closest('.tag-chip') || el.closest('pre') || el.closest('code')) return;
    el.innerHTML = el.innerHTML.replace(/#([a-zA-Z][a-zA-Z0-9_-]*)/g, (match, tag) => {
      return `<span class="tag-chip" data-tag="${tag.toLowerCase()}">#${tag}</span>`;
    });
  });
  container.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tag = chip.dataset.tag;
      vaultSearch.value = '#' + tag;
      onVaultSearchInput({ target: vaultSearch });
      switchView('vault');
    });
  });

  // Image lightbox
  container.querySelectorAll('img.lightbox-img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.dataset.src || img.src, img.alt));
  });

  // Wiki-style [[links]]
  container.querySelectorAll('.vault-wiki-link').forEach(link => {
    link.addEventListener('click', () => {
      const pageName = link.dataset.wikiPage;
      const target = vaultFiles.find(f => {
        const name = f.path.split('/').pop().replace(/\.md$/i, '');
        return name.toLowerCase() === pageName.toLowerCase() ||
               name.toLowerCase().replace(/\s+/g, '-') === pageName.toLowerCase().replace(/\s+/g, '-');
      });
      if (target) loadFile(target);
      else {
        fetch(`/api/vault/search?token=${token}${asParam()}&q=${encodeURIComponent(pageName)}`).then(r => r.json()).then(data => {
          if (data.results && data.results[0]) loadFile(data.results[0]);
          else showToast('Page not found: ' + pageName, 'warning');
        }).catch(() => showToast('Page not found: ' + pageName, 'warning'));
      }
    });
  });

  // Footnotes wrapper
  const fnItems = container.querySelectorAll('li[id^="fn-"]');
  if (fnItems.length > 0) {
    let footnotesSection = container.querySelector('.footnotes');
    if (!footnotesSection) {
      footnotesSection = document.createElement('div');
      footnotesSection.className = 'footnotes';
      const ol = document.createElement('ol');
      footnotesSection.appendChild(ol);
      container.appendChild(footnotesSection);
    }
    const ol = footnotesSection.querySelector('ol');
    fnItems.forEach(fn => {
      if (!ol.querySelector('#' + fn.id)) ol.appendChild(fn);
    });
  }
}

// Generate TOC from headings
function generateTOC(container) {
  const headings = container.querySelectorAll('h1, h2, h3');
  if (headings.length < 2) return '';
  let toc = '<div class="toc"><div class="toc-title">Contents</div><ul>';
  headings.forEach(h => {
    const level = parseInt(h.tagName[1]);
    const id = h.id || h.textContent.toLowerCase().replace(/[^\w]+/g, '-');
    h.id = id;
    toc += `<li class="toc-h${level}"><a href="#${id}">${h.textContent.replace(/<[^>]+>/g, '')}</a></li>`;
  });
  toc += '</ul></div>';
  return toc;
}

// Lightbox
function openLightbox(src, alt) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// Wire relative links inside a rendered vault markdown container to open files in the vault viewer
function wireVaultInternalLinks(container, filePath) {
  const dir = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';
  container.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#') || href.startsWith('mailto:')) return;
    let resolved;
    if (href.startsWith('/')) {
      resolved = href.slice(1);
    } else {
      resolved = dir ? `${dir}/${href}` : href;
      const parts = resolved.split('/');
      const normalized = [];
      for (const part of parts) {
        if (part === '..') normalized.pop();
        else if (part !== '.') normalized.push(part);
      }
      resolved = normalized.join('/');
    }
    a.setAttribute('href', 'javascript:void(0)');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = vaultFiles.find(f => f.path === resolved || f.path === resolved + '.md');
      if (target) {
        loadFile(target);
      } else {
        loadVault(resolved);
      }
    });
  });
}

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const view = item.dataset.view;
    switchView(view);
  });
});

// Split View
let splitViewEnabled = localStorage.getItem('ks_splitView') === 'true';
let splitPanelWidth = 50; // percentage for chat panel

function toggleSplitView() {
  splitViewEnabled = !splitViewEnabled;
  localStorage.setItem('ks_splitView', splitViewEnabled);
  updateSplitView();

  if (splitViewEnabled) {
    showToast('Split view enabled', 'info', 2000);
    // Initialize split vault panel
    loadVaultSplit();
  } else {
    showToast('Split view disabled', 'info', 2000);
  }
}

function updateSplitView() {
  const splitContainer = document.getElementById('splitViewContainer');
  const chatView = document.getElementById('chatView');
  const vaultView = document.getElementById('vaultView');

  if (!splitContainer || !chatView || !vaultView) return;

  if (splitViewEnabled) {
    splitContainer.classList.remove('hidden');
    chatView.classList.add('hidden');
    vaultView.classList.add('hidden');

    // Update toggle button text
    const toggleBtn = document.getElementById('splitViewToggle');
    const toggleBtnSplit = document.getElementById('splitViewToggleSplit');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-columns mr-1"></i>Split View (Active)';
      toggleBtn.style.background = 'var(--accent-primary)';
      toggleBtn.style.color = 'white';
    }
    if (toggleBtnSplit) {
      toggleBtnSplit.innerHTML = '<i class="fas fa-times mr-1"></i>Close Split';
    }

    // Sync messages to split view
    const messagesSplit = document.getElementById('messagesSplit');
    if (messagesSplit && messagesDiv) {
      messagesSplit.innerHTML = messagesDiv.innerHTML;
    }
  } else {
    splitContainer.classList.add('hidden');
    chatView.classList.remove('hidden');
    vaultView.classList.toggle('hidden', currentView !== 'vault');

    // Update toggle button
    const toggleBtn = document.getElementById('splitViewToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-columns mr-1"></i>Split View';
      toggleBtn.style.background = '';
      toggleBtn.style.color = '';
    }
  }
}

function loadVaultSplit() {
  fetch(`/api/vault?token=${token}${asParam()}`).then(r => r.json()).then(data => {
    const files = (data.files || []).filter(f => {
      const ext = f.path.split('.').pop().toLowerCase();
      return ['md', 'markdown', 'txt', 'json', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(ext);
    });

    const treeContainer = document.getElementById('vaultTreeSplit');
    if (!treeContainer) return;

    // Build simple tree
    const tree = buildTree(files);

    function renderTreeNode(node, container, level = 0) {
      const sortedKeys = Object.keys(node).sort((a, b) => {
        const aIsFile = node[a].__file;
        const bIsFile = node[b].__file;
        if (aIsFile === bIsFile) return a.localeCompare(b);
        return aIsFile ? 1 : -1;
      });

      sortedKeys.forEach(key => {
        const value = node[key];
        const isFile = value.__file;

        if (isFile) {
          const item = document.createElement('div');
          item.className = 'vault-item file';
          item.style.padding = '4px 8px';
          item.style.borderRadius = '4px';
          item.style.cursor = 'pointer';

          const ext = key.split('.').pop().toLowerCase();
          const icon = getFileIcon(ext);
          const cleanName = key.replace(/\.(md|markdown)$/, '');

          item.innerHTML = `
            <i class="fas ${icon}" style="color: var(--accent-light); font-size: 12px; margin-right: 6px;"></i>
            <span style="font-size: 12px;">${escapeHtml(cleanName)}</span>
          `;

          item.addEventListener('click', () => loadFileSplit(value.__file));
          container.appendChild(item);
        } else {
          const wrapper = document.createElement('div');

          const item = document.createElement('div');
          item.className = 'vault-item folder';
          item.style.padding = '4px 8px';
          item.style.borderRadius = '4px';
          item.style.cursor = 'pointer';
          item.style.fontWeight = '500';

          const chevron = document.createElement('i');
          chevron.className = 'fas fa-chevron-right';
          chevron.style.fontSize = '9px';
          chevron.style.marginRight = '6px';
          chevron.style.transition = 'transform 0.2s';

          item.innerHTML = `
            <i class="fas fa-folder" style="color: var(--accent-light); font-size: 12px; margin-right: 6px;"></i>
            <span style="font-size: 12px;">${escapeHtml(key)}</span>
          `;
          item.prepend(chevron);

          const childContainer = document.createElement('div');
          childContainer.className = 'folder-children';
          childContainer.style.marginLeft = '12px';

          let isOpen = level === 0;

          item.addEventListener('click', () => {
            isOpen = !isOpen;
            childContainer.classList.toggle('hidden', !isOpen);
            chevron.style.transform = isOpen ? 'rotate(90deg)' : '0deg';
          });

          if (level === 0) {
            chevron.style.transform = 'rotate(90deg)';
          }

          wrapper.appendChild(item);
          renderTreeNode(value, childContainer, level + 1);
          wrapper.appendChild(childContainer);
          container.appendChild(wrapper);
        }
      });
    }

    treeContainer.innerHTML = '';
    renderTreeNode(tree, treeContainer);
  }).catch(console.error);
}

function loadFileSplit(file) {
  fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(file.path)}`)
    .then(r => r.text())
    .then(content => {
      const contentDiv = document.getElementById('vaultContentSplit');
      if (!contentDiv) return;

      const ext = file.path.split('.').pop().toLowerCase();

      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        const imagePath = `/api/vault/file?token=${token}${asParam()}&path=${file.path}`;
        contentDiv.innerHTML = `<img src="${imagePath}" alt="${file.path}" class="max-w-full rounded-lg lightbox-img" data-src="${imagePath}">`;
      } else if (typeof marked !== 'undefined') {
        contentDiv.innerHTML = `<div class="prose max-w-none">${marked.parse(content)}</div>`;
        applyMarkdownEnhancements(contentDiv);
      } else {
        contentDiv.innerHTML = `<pre style="white-space:pre-wrap;">${escapeHtml(content)}</pre>`;
      }
    });
}

// Wire up split view toggle buttons
document.getElementById('splitViewToggle')?.addEventListener('click', toggleSplitView);
document.getElementById('splitViewToggleSplit')?.addEventListener('click', toggleSplitView);

// Initialize split view on load
document.addEventListener('DOMContentLoaded', () => {
  updateSplitView();
  if (splitViewEnabled) {
    loadVaultSplit();
  }
});

function switchView(view) {
  currentView = view;

  // Update nav tabs
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Hide all views first
  document.getElementById('splitViewContainer')?.classList.add('hidden');
  document.getElementById('chatView')?.classList.add('hidden');
  document.getElementById('vaultView')?.classList.add('hidden');
  document.getElementById('homeView')?.classList.add('hidden');

  // Show selected view
  if (view === 'home') {
    document.getElementById('homeView')?.classList.remove('hidden');
    loadDashboard();
    // Hide sidebar panels in home view
    document.getElementById('sidebarChat')?.classList.add('hidden');
    document.getElementById('sidebarVault')?.classList.add('hidden');
  } else if (view === 'chat') {
    document.getElementById('chatView')?.classList.remove('hidden');

    // Handle split view
    if (splitViewEnabled) {
      document.getElementById('splitViewContainer')?.classList.remove('hidden');
      document.getElementById('chatView')?.classList.add('hidden');

      // Sync messages to split view
      const messagesSplit = document.getElementById('messagesSplit');
      if (messagesSplit && messagesDiv) {
        messagesSplit.innerHTML = messagesDiv.innerHTML;
      }
    }

    // Update sidebar
    document.getElementById('sidebarChat')?.classList.remove('hidden');
    document.getElementById('sidebarVault')?.classList.add('hidden');

    // Update session list active highlight
    renderSessionList();
    const portalSessions = sessions.filter(s => !s.isSubagent);
    if (!activeSessionKey && portalSessions.length > 0) {
      socket.emit('sessions:switch', { sessionKey: portalSessions[0].key });
    } else {
      socket.emit('agent:status');
      const targetMessagesDiv = splitViewEnabled ? document.getElementById('messagesSplit') : messagesDiv;
      if (targetMessagesDiv) targetMessagesDiv.scrollTop = targetMessagesDiv.scrollHeight;
    }
  } else if (view === 'vault') {
    document.getElementById('vaultView')?.classList.remove('hidden');

    // Handle split view
    if (splitViewEnabled) {
      document.getElementById('splitViewContainer')?.classList.remove('hidden');
      document.getElementById('vaultView')?.classList.add('hidden');
      loadVaultSplit();
    }

    // Update sidebar
    document.getElementById('sidebarChat')?.classList.add('hidden');
    document.getElementById('sidebarVault')?.classList.remove('hidden');

    loadVault();
  }
}

// Connection status monitoring
let connectionStatus = 'connecting';
let typingTimeout = null;
const TYPING_TIMEOUT_MS = 30 * 60 * 1000 + 5000; // 30 min + 5s buffer (matches server)

function updateConnectionStatus(status) {
  connectionStatus = status;
  let indicator = document.getElementById('connection-status');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'connection-status';
    indicator.style.cssText = 'position:fixed;top:12px;right:12px;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:500;z-index:100;transition:all 0.3s ease;pointer-events:none;';
    document.body.appendChild(indicator);
  }
  if (status === 'connected') {
    indicator.textContent = 'Connected';
    indicator.style.background = '#d1fae5';
    indicator.style.color = '#065f46';
    // Auto-hide after 2s
    setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
  } else if (status === 'disconnected') {
    indicator.style.opacity = '1';
    indicator.textContent = 'Disconnected — reconnecting...';
    indicator.style.background = '#fee2e2';
    indicator.style.color = '#991b1b';
  } else if (status === 'connecting') {
    indicator.style.opacity = '1';
    indicator.textContent = 'Connecting...';
    indicator.style.background = '#fef3c7';
    indicator.style.color = '#92400e';
  }
}

socket.on('connect', () => {
  console.log('Connected to server');
  updateConnectionStatus('connected');
  isInitialLoad = true;
  loadClientInfo();

  // Preload vault file list for chat autocomplete
  if (vaultFiles.length === 0) {
    fetch(`/api/vault?token=${token}${asParam()}`).then(r => r.json()).then(data => {
      if (vaultFiles.length === 0) {
        vaultFiles = (data.files || []).filter(f => {
          const ext = f.path.split('.').pop().toLowerCase();
          return ['md', 'markdown', 'txt', 'json', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(ext);
        });
      }
    }).catch(() => {});
  }

  // Deep-link: /vault/path/to/file opens vault with that file selected
  const urlPath = window.location.pathname;
  if (urlPath.startsWith('/vault/')) {
    pendingVaultOpen = decodeURIComponent(urlPath.slice('/vault/'.length));
    switchView('vault');
    history.replaceState(null, '', '/');
  }
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  updateConnectionStatus('disconnected');
});

socket.on('reconnecting', () => {
  updateConnectionStatus('connecting');
});

socket.on('reconnect', () => {
  updateConnectionStatus('connected');
});

socket.on('chat:message', (data) => {
  // Clear typing timeout since we got a response
  clearTimeout(typingTimeout);
  typingTimeout = null;
  addMessage(data.content, data.role, data.timestamp);
});

socket.on('typing', (data) => {
  // Track which session is processing
  if (activeSessionKey) {
    if (data.typing) processingSessions.add(activeSessionKey);
    else processingSessions.delete(activeSessionKey);
    renderSessionList();
  }
  showTypingIndicator(data.typing);
  if (data.typing) {
    // Safety net: if server never sends typing:false, auto-clear
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      showTypingIndicator(false);
      if (activeSessionKey) processingSessions.delete(activeSessionKey);
      renderSessionList();
    }, TYPING_TIMEOUT_MS);
  } else {
    clearTimeout(typingTimeout);
    typingTimeout = null;

  }
});

// Check agent processing status (e.g. after reconnect or view switch)
socket.on('agent:status', (data) => {
  if (activeSessionKey) {
    if (data.processing) processingSessions.add(activeSessionKey);
    else processingSessions.delete(activeSessionKey);
    renderSessionList();
  }
  showTypingIndicator(!!data.processing);
});

// Progress updates from server during long-running agent operations
const STATUS_LABELS = {
  thinking: 'Agent is thinking...',
  executing: 'Agent is executing tools...',
};

socket.on('agent:progress', (data) => {
  const statusEl = document.getElementById('typing-status-text');
  if (statusEl && data.status) {
    statusEl.textContent = STATUS_LABELS[data.status] || `Agent is ${data.status}...`;
  }
});

let typingElapsedTimer = null;

function updateProcessingBadge(show) {
  // Show/hide pulsing dot on chat nav items so user sees activity from any view
  document.querySelectorAll('[data-view="chat"]').forEach(el => {
    let badge = el.querySelector('.processing-badge');
    if (show && !badge) {
      badge = document.createElement('span');
      badge.className = 'processing-badge';
      badge.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-left:4px;animation:pulse-badge 1.2s ease-in-out infinite;';
      el.appendChild(badge);
    } else if (!show && badge) {
      badge.remove();
    }
  });
}

function showTypingIndicator(show) {
  const existing = document.getElementById('typing-indicator');
  updateProcessingBadge(show);

  if (show && !existing) {
    const startTime = Date.now();
    const typingDiv = document.createElement('div');
    typingDiv.id = 'typing-indicator';
    typingDiv.className = 'message assistant';
    typingDiv.style.opacity = '0.7';
    typingDiv.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="typing-dots">
          <span class="dot">●</span>
          <span class="dot">●</span>
          <span class="dot">●</span>
        </div>
        <span class="text-sm" id="typing-status-text">Agent is thinking...</span>
        <span class="typing-elapsed" id="typing-elapsed"></span>
      </div>
      <style>
        .typing-dots { display:flex; gap:4px; }
        .dot { animation:blink 1.4s infinite; animation-fill-mode:both; }
        .dot:nth-child(2) { animation-delay:0.2s; }
        .dot:nth-child(3) { animation-delay:0.4s; }
        @keyframes blink { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }
        @keyframes pulse-badge { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
      </style>
    `;
    messagesDiv.appendChild(typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Show elapsed time after 5s
    typingElapsedTimer = setInterval(() => {
      const el = document.getElementById('typing-elapsed');
      if (!el) { clearInterval(typingElapsedTimer); return; }
      const secs = Math.floor((Date.now() - startTime) / 1000);
      if (secs >= 5) {
        const mins = Math.floor(secs / 60);
        el.textContent = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      }
    }, 1000);
  } else if (!show && existing) {
    clearInterval(typingElapsedTimer);
    existing.remove();
  }
}

// Detect exec approval requests in message text
// Matches patterns like: /approve abc123 allow-always
// The approval ID is a hex string, and the message typically contains command details
const APPROVAL_REGEX = /\/approve\s+([a-f0-9]+)\s+(allow-always|allow-once|deny)/g;

function parseApprovalRequest(text) {
  APPROVAL_REGEX.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = APPROVAL_REGEX.exec(text)) !== null) {
    matches.push({ id: match[1], fullMatch: match[0] });
  }
  return matches;
}

// Edit message functionality
let editingMessageDiv = null;
let editingOriginalText = '';

function editMessage(msgDiv, text) {
  if (editingMessageDiv) {
    cancelEditMessage();
  }

  editingMessageDiv = msgDiv;
  editingOriginalText = text;

  // Replace message content with textarea
  const contentDiv = msgDiv.querySelector('.message') || msgDiv;
  contentDiv.innerHTML = `
    <textarea class="message-edit-textarea" style="width: 100%; min-height: 60px; padding: 12px; border: 1px solid var(--border-light); border-radius: 8px; background: var(--bg-chat); color: var(--text-primary); resize: vertical; font-family: inherit; font-size: 14px; line-height: 1.5;">${escapeHtml(text)}</textarea>
    <div class="edit-actions mt-2 flex gap-2">
      <button class="msg-action-btn save-edit" style="background: var(--accent-primary); color: white;">Save</button>
      <button class="msg-action-btn cancel-edit">Cancel</button>
    </div>
  `;

  const textarea = contentDiv.querySelector('textarea');
  textarea.focus();

  contentDiv.querySelector('.save-edit').addEventListener('click', () => saveEditMessage());
  contentDiv.querySelector('.cancel-edit').addEventListener('click', cancelEditMessage);

  // Handle Enter key (save) and Shift+Enter (new line)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEditMessage();
    } else if (e.key === 'Escape') {
      cancelEditMessage();
    }
  });
}

function saveEditMessage() {
  if (!editingMessageDiv) return;

  const textarea = editingMessageDiv.querySelector('textarea');
  if (!textarea) return;

  const newText = textarea.value.trim();
  if (newText !== editingOriginalText) {
    // Remove the old message and add the edited one
    const allMessages = messagesDiv.querySelectorAll('.message.user, .message.assistant, .subagent-event');
    let found = false;
    for (let i = 0; i < allMessages.length; i++) {
      if (allMessages[i] === editingMessageDiv) {
        // Replace this message's content
        const textSpan = editingMessageDiv.querySelector('.message') || editingMessageDiv;
        textSpan.innerHTML = escapeHtml(newText);
        found = true;
        break;
      }
    }

    // Send the edited message
    socket.emit('chat:message', {
      message: newText,
      messageId: Date.now().toString() + '-edit',
      tempFiles: []
    });

    showToast('Message edited', 'success', 2000);
  }

  editingMessageDiv = null;
  editingOriginalText = '';
  loadChatHistory(); // Reload to get proper state
}

function cancelEditMessage() {
  if (!editingMessageDiv) return;

  // Restore original content
  const textSpan = editingMessageDiv.querySelector('.message') || editingMessageDiv;
  textSpan.innerHTML = escapeHtml(editingOriginalText);

  editingMessageDiv = null;
  editingOriginalText = '';
}

function regenerateMessage() {
  // Regenerate the last assistant message
  showToast('Regenerating response...', 'info', 2000);

  // Send a regeneration request (special message)
  socket.emit('chat:message', {
    message: 'Please regenerate your last response.',
    messageId: Date.now().toString() + '-regen',
    tempFiles: []
  });
}

// Add reactions to message
function addReactionsToMessage(msgDiv, role) {
  // Check if reactions already exist
  if (msgDiv.querySelector('.msg-reactions')) return;

  const reactions = document.createElement('div');
  reactions.className = 'msg-reactions';
  reactions.style.cssText = 'display: none; gap: 4px; margin-top: 8px;';

  const emojis = ['👍', '👎', '🎯', '💡', '❤️'];

  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'reaction-btn';
    btn.textContent = emoji;
    btn.style.cssText = 'background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px; border-radius: 4px; transition: background 0.15s; opacity: 0.6;';
    btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
    btn.addEventListener('mouseleave', () => btn.style.opacity = '0.6');
    btn.addEventListener('click', () => {
      toggleReaction(msgDiv, emoji, btn);
    });
    reactions.appendChild(btn);
  });

  msgDiv.appendChild(reactions);

  // Show reactions on message hover
  msgDiv.addEventListener('mouseenter', () => {
    reactions.style.display = 'flex';
  });

  msgDiv.addEventListener('mouseleave', () => {
    // Keep reactions visible if any are selected
    const selectedReactions = reactions.querySelectorAll('.reaction-btn.selected');
    if (selectedReactions.length === 0) {
      reactions.style.display = 'none';
    }
  });
}

function toggleReaction(msgDiv, emoji, btn) {
  btn.classList.toggle('selected');
  if (btn.classList.contains('selected')) {
    btn.style.background = 'rgba(139, 94, 60, 0.15)';
    btn.style.opacity = '1';
  } else {
    btn.style.background = 'none';
  }
  // Note: In a full implementation, this would sync with the server
}

// Helper to reload chat history
function loadChatHistory() {
  if (activeSessionKey) {
    socket.emit('chat:history', { sessionKey: activeSessionKey });
  }
}

function addMessage(content, role, timestamp) {
  // Remove typing indicator if present
  showTypingIndicator(false);

  const text = typeof content === 'string' ? content : (content.text || '');

  // OpenClaw runtime context messages — render as a compact separator instead
  if (role === 'assistant' && text.startsWith('OpenClaw runtime context (internal):')) {
    const taskMatch = text.match(/task:\s*([\w-]+)/);
    const statusMatch = text.match(/status:\s*([\w\s]+?)(?:\s+Result|\s+Stats|\s*$)/);
    const task = taskMatch ? taskMatch[1] : 'subagent';
    const status = statusMatch ? statusMatch[1].trim() : '';
    const isOk = /complet|success|done/i.test(status);
    const statusClass = isOk ? 'status-ok' : 'status-err';
    const icon = isOk ? '✓' : '✕';
    const el = document.createElement('div');
    el.className = 'subagent-event';
    el.innerHTML = `<span class="subagent-label"><span class="${statusClass}">${icon}</span> ${escapeHtml(task)}${status ? ` · ${escapeHtml(status)}` : ''}</span>`;
    messagesDiv.appendChild(el);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return;
  }

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;

  const files = (typeof content === 'object' ? content.files : []) || [];

  // Check if this is an approval request from the assistant
  const approvals = (role === 'assistant') ? parseApprovalRequest(text) : [];

  let html = '';
  if (approvals.length > 0) {
    // Render approval card instead of raw text
    // Extract context: everything except the /approve lines
    let context = text;
    for (const a of approvals) {
      context = context.replace(a.fullMatch, '').trim();
    }

    // Try to extract command info from context
    const contextHtml = context ? (typeof marked !== 'undefined' ? marked.parse(context) : escapeHtml(context)) : '';

    for (const approval of approvals) {
      html += `<div class="approval-card" data-approval-id="${approval.id}">
        <div class="approval-header"><i class="fas fa-shield-alt"></i> Exec approval required</div>
        ${contextHtml ? `<div class="approval-command">${contextHtml}</div>` : ''}
        <div class="approval-actions">
          <button class="approval-btn allow-always" data-decision="allow-always" data-id="${approval.id}">
            <i class="fas fa-check-double"></i> Allow always
          </button>
          <button class="approval-btn allow-once" data-decision="allow-once" data-id="${approval.id}">
            <i class="fas fa-check"></i> Allow once
          </button>
          <button class="approval-btn deny" data-decision="deny" data-id="${approval.id}">
            <i class="fas fa-times"></i> Deny
          </button>
        </div>
        <div class="approval-resolved"></div>
      </div>`;
    }
  } else if (role === 'assistant' && typeof marked !== 'undefined') {
    html = marked.parse(text);
  } else {
    html = escapeHtml(text);
  }

  // Append a small open-icon after vault paths in assistant messages (keeps original text intact)
  if (role === 'assistant' && approvals.length === 0) {
    html = html.replace(/(?:\/?)vault\/([\w\/\-_.]+)/g, (match, filePath) => {
      // Skip directory paths (ending with /)
      if (filePath.endsWith('/')) return match;
      return `${match}<a class="vault-link" data-vault-path="${escapeHtml(filePath)}" href="javascript:void(0)" title="Abrir ${escapeHtml(filePath)}"><i class="fas fa-external-link-alt"></i></a>`;
    });
  }

  // Add file info for user messages
  if (files.length > 0) {
    const filesHtml = files.map(f => {
      const sizeStr = formatFileSize(f.size);
      return `<div class="flex items-center gap-2 mt-2 p-2 bg-gray-100 rounded">
        <i class="fas fa-file text-gray-500"></i>
        <span class="text-sm">${escapeHtml(f.name)}</span>
        <span class="text-xs text-gray-400">(${sizeStr})</span>
      </div>`;
    }).join('');
    html += `<div class="mt-2">${filesHtml}</div>`;
  }

  msgDiv.innerHTML = html;

  // Apply markdown enhancements to rendered content
  if (role === 'assistant' && approvals.length === 0) {
    applyMarkdownEnhancements(msgDiv);
  }


  // Action buttons (copy + download) on all messages with text
  if (text) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        copyBtn.classList.add('done');
        setTimeout(() => { copyBtn.innerHTML = '<i class="fas fa-copy"></i>'; copyBtn.classList.remove('done'); }, 1500);
      });
    });
    actions.appendChild(copyBtn);

    // Download button (as .md for assistant, .txt for user)
    const dlBtn = document.createElement('button');
    dlBtn.className = 'msg-action-btn';
    dlBtn.title = 'Download';
    dlBtn.innerHTML = '<i class="fas fa-download"></i>';
    dlBtn.addEventListener('click', () => {
      const ext = role === 'assistant' ? 'md' : 'txt';
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `message.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    });
    actions.appendChild(dlBtn);

    // Edit button for user messages
    if (role === 'user') {
      const editBtn = document.createElement('button');
      editBtn.className = 'msg-action-btn';
      editBtn.title = 'Edit';
      editBtn.innerHTML = '<i class="fas fa-pen"></i>';
      editBtn.addEventListener('click', () => editMessage(msgDiv, text));
      actions.appendChild(editBtn);
    }

    // Regenerate button for assistant messages
    if (role === 'assistant') {
      const regenBtn = document.createElement('button');
      regenBtn.className = 'msg-action-btn';
      regenBtn.title = 'Regenerate';
      regenBtn.innerHTML = '<i class="fas fa-redo"></i>';
      regenBtn.addEventListener('click', () => regenerateMessage());
      actions.appendChild(regenBtn);
    }

    msgDiv.appendChild(actions);
  }

  // Add reaction emojis to messages
  addReactionsToMessage(msgDiv, role);

  // Wire up vault links to open preview popup
  msgDiv.querySelectorAll('.vault-link').forEach(link => {
    link.addEventListener('click', () => {
      openVaultPreview(link.dataset.vaultPath);
    });
  });

  // Wire up approval buttons
  msgDiv.querySelectorAll('.approval-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const approvalId = btn.dataset.id;
      const decision = btn.dataset.decision;
      const card = btn.closest('.approval-card');

      // Send the /approve command as a chat message
      socket.emit('chat:message', {
        message: `/approve ${approvalId} ${decision}`,
        messageId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
        tempFiles: []
      });

      // Mark card as resolved
      card.classList.add('resolved');
      const labels = { 'allow-always': 'Allowed (always)', 'allow-once': 'Allowed (once)', 'deny': 'Denied' };
      card.querySelector('.approval-resolved').textContent = labels[decision] || decision;

      // Show typing since agent will continue
      if (decision !== 'deny') {
        showTypingIndicator(true);
      }
    });
  });

  // Timestamp + reply row
  if (text) {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';

    if (timestamp) {
      const ts = document.createElement('span');
      ts.className = 'msg-timestamp';
      const d = new Date(timestamp);
      ts.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ts.title = d.toLocaleString();
      meta.appendChild(ts);
    }

    const replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action-btn msg-reply-btn';
    replyBtn.title = 'Reply';
    replyBtn.innerHTML = '<i class="fas fa-reply"></i>';
    replyBtn.addEventListener('click', () => {
      const lines = text.split('\n').slice(0, 3).map(l => '> ' + l).join('\n');
      const quote = lines + (text.split('\n').length > 3 ? '\n> …' : '');
      messageInput.value = quote + '\n\n' + messageInput.value;
      messageInput.focus();
      messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
    });
    meta.appendChild(replyBtn);

    msgDiv.appendChild(meta);
  }

  // Add suggested actions for assistant messages
  if (role === 'assistant' && text) {
    const contentLower = text.toLowerCase();

    if (contentLower.includes('task') || contentLower.includes('todo') || contentLower.includes('action item')) {
      addSuggestedActions(msgDiv, 'task-detection');
    } else if (contentLower.includes('research') || contentLower.includes('study') || contentLower.includes('information about')) {
      addSuggestedActions(msgDiv, 'research');
    } else if (text.includes('```')) {
      addSuggestedActions(msgDiv, 'code');
    }
  }

  renderedMessageCount++;
  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

sendButton.addEventListener('click', sendMessage);

// Autocomplete state
const autocompleteDropdown = document.getElementById('autocompleteDropdown');
let autocompleteIndex = -1;
let autocompleteMatches = [];

function getHashQuery() {
  const val = messageInput.value;
  const cursor = messageInput.selectionStart;
  const before = val.slice(0, cursor);
  const hashIdx = before.lastIndexOf('#');
  if (hashIdx === -1) return null;
  // Must be start of input or preceded by a space
  if (hashIdx > 0 && before[hashIdx - 1] !== ' ') return null;
  const query = before.slice(hashIdx + 1);
  // No spaces allowed in query (user moved on)
  if (query.includes(' ')) return null;
  return { query, start: hashIdx, end: cursor };
}

function renderAutocomplete() {
  const hq = getHashQuery();
  if (!hq || vaultFiles.length === 0) {
    autocompleteDropdown.classList.add('hidden');
    autocompleteMatches = [];
    autocompleteIndex = -1;
    return;
  }
  const q = hq.query.toLowerCase();
  autocompleteMatches = vaultFiles
    .filter(f => {
      const name = f.path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
      const path = f.path.toLowerCase();
      return name.includes(q) || path.includes(q);
    })
    .slice(0, 8);

  if (autocompleteMatches.length === 0) {
    autocompleteDropdown.classList.add('hidden');
    autocompleteIndex = -1;
    return;
  }

  autocompleteIndex = Math.min(autocompleteIndex, autocompleteMatches.length - 1);
  if (autocompleteIndex < 0) autocompleteIndex = 0;

  autocompleteDropdown.innerHTML = autocompleteMatches.map((f, i) => {
    const name = f.path.split('/').pop();
    const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') + '/' : '';
    return `<div class="autocomplete-item px-4 py-2 cursor-pointer text-sm flex items-center gap-2 ${i === autocompleteIndex ? 'active' : ''}" data-index="${i}" style="${i === autocompleteIndex ? 'background: var(--accent-primary); color: white;' : ''}">
      <i class="fas fa-file-alt opacity-50 text-xs"></i>
      <span>${dir ? '<span class="opacity-50">' + dir + '</span>' : ''}${name}</span>
    </div>`;
  }).join('');

  autocompleteDropdown.classList.remove('hidden');
}

function selectAutocomplete(index) {
  const hq = getHashQuery();
  if (!hq || !autocompleteMatches[index]) return;
  const file = autocompleteMatches[index];
  const name = file.path.split('/').pop().replace(/\.[^.]+$/, '');
  const val = messageInput.value;
  messageInput.value = val.slice(0, hq.start) + '#' + name + ' ' + val.slice(hq.end);
  messageInput.selectionStart = messageInput.selectionEnd = hq.start + name.length + 2;
  autocompleteDropdown.classList.add('hidden');
  autocompleteMatches = [];
  autocompleteIndex = -1;
  messageInput.focus();
}

messageInput.addEventListener('input', renderAutocomplete);

messageInput.addEventListener('keydown', (e) => {
  if (!autocompleteDropdown.classList.contains('hidden') && autocompleteMatches.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteIndex = (autocompleteIndex + 1) % autocompleteMatches.length;
      renderAutocomplete();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteIndex = (autocompleteIndex - 1 + autocompleteMatches.length) % autocompleteMatches.length;
      renderAutocomplete();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      selectAutocomplete(autocompleteIndex);
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      autocompleteDropdown.classList.add('hidden');
      autocompleteMatches = [];
      autocompleteIndex = -1;
    }
  }
});

messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (!autocompleteDropdown.classList.contains('hidden')) return;
    e.preventDefault();
    sendMessage();
  }
});

autocompleteDropdown.addEventListener('mousedown', (e) => {
  const item = e.target.closest('.autocomplete-item');
  if (item) {
    e.preventDefault();
    selectAutocomplete(parseInt(item.dataset.index));
  }
});

// Chat file upload handler
document.getElementById('chatUploadBtn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;

  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      await uploadTempFile(file);
    }
  };
  input.click();
});

// Split view chat elements
const messageInputSplit = document.getElementById('messageInputSplit');
const sendButtonSplit = document.getElementById('sendButtonSplit');
const chatUploadBtnSplit = document.getElementById('chatUploadBtnSplit');
const chatFilePreviewSplit = document.getElementById('chatFilePreviewSplit');
const messagesSplit = document.getElementById('messagesSplit');
const autocompleteDropdownSplit = document.getElementById('autocompleteDropdownSplit');

// Wire up split view chat
sendButtonSplit?.addEventListener('click', () => {
  // Temporarily use split view input
  const originalInput = messageInput;
  const originalMessages = messagesDiv;
  const originalFilePreview = document.getElementById('chatFilePreview');
  const originalAutocomplete = document.getElementById('autocompleteDropdown');

  // Swap references
  messageInput.value = messageInputSplit.value;
  pendingFiles = []; // Reset for split view

  // Use original sendMessage
  sendMessage();

  // Copy message back to split view
  messageInputSplit.value = messageInput.value;
  pendingFiles = [];
});

chatUploadBtnSplit?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;

  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      await uploadTempFile(file);
    }
    renderFilePreviewSplit();
  };
  input.click();
});

function renderFilePreviewSplit() {
  if (!chatFilePreviewSplit) return;
  chatFilePreviewSplit.innerHTML = '';

  if (pendingFiles.length === 0) {
    chatFilePreviewSplit.classList.add('hidden');
    return;
  }

  chatFilePreviewSplit.classList.remove('hidden');
  pendingFiles.forEach((file, index) => {
    const div = document.createElement('div');
    div.className = 'file-preview';
    div.title = file.name;

    if (file.type && file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file.blob || new Blob([]));
      img.onload = () => URL.revokeObjectURL(img.src);
      div.appendChild(img);
    } else {
      div.innerHTML = `<i class="fas fa-file file-icon"></i>`;
    }

    const removeBtn = document.createElement('div');
    removeBtn.className = 'remove-btn';
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.onclick = () => {
      pendingFiles.splice(index, 1);
      renderFilePreviewSplit();
    };

    div.appendChild(removeBtn);
    chatFilePreviewSplit.appendChild(div);
  });
}

// Enter key support for split view input
messageInputSplit?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendButtonSplit.click();
  }
});

// Vault search in split view
const vaultSearchSplit = document.getElementById('vaultSearchSplit');
vaultSearchSplit?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const treeContainer = document.getElementById('vaultTreeSplit');
  if (!treeContainer) return;

  if (!query) {
    loadVaultSplit(); // Reload full tree
    return;
  }

  // Simple filename search
  fetch(`/api/vault/search?token=${token}${asParam()}&q=${encodeURIComponent(query)}`)
    .then(r => r.json())
    .then(data => {
      const results = data.results || [];
      treeContainer.innerHTML = '';
      results.forEach(f => {
        const item = document.createElement('div');
        item.className = 'vault-item file';
        item.style.padding = '4px 8px';
        item.style.borderRadius = '4px';
        item.style.cursor = 'pointer';

        const ext = f.path.split('.').pop().toLowerCase();
        const icon = getFileIcon(ext);
        item.innerHTML = `
          <i class="fas ${icon}" style="color: var(--accent-light); font-size: 12px; margin-right: 6px;"></i>
          <span style="font-size: 12px;">${escapeHtml(f.path)}</span>
        `;
        item.addEventListener('click', () => loadFileSplit(f));
        treeContainer.appendChild(item);
      });
    });
});

// Upload file to temp directory
async function uploadTempFile(file) {
  const formData = new FormData();
  formData.append('files', file);

  try {
    const res = await fetch(`/api/chat/upload?token=${token}`, {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      // Add files with their server-side paths
      data.files.forEach(f => {
        pendingFiles.push({
          path: f.path,
          name: f.name,
          type: f.type,
          size: f.size
        });
      });
      renderFilePreview();
    }
  } catch (error) {
    console.error('Upload failed:', error);
    showToast('Failed to upload file', 'error');
  }
}

// Render file preview
function renderFilePreview() {
  const preview = document.getElementById('chatFilePreview');
  preview.innerHTML = '';

  if (pendingFiles.length === 0) {
    preview.classList.add('hidden');
    return;
  }

  preview.classList.remove('hidden');
  pendingFiles.forEach((file, index) => {
    const div = document.createElement('div');
    div.className = 'file-preview';
    div.title = file.name;

    if (file.type && file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file.blob || new Blob([]));
      img.onload = () => URL.revokeObjectURL(img.src);
      div.appendChild(img);
    } else {
      div.innerHTML = `<i class="fas fa-file file-icon"></i>`;
    }

    const removeBtn = document.createElement('div');
    removeBtn.className = 'remove-btn';
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.onclick = () => {
      pendingFiles.splice(index, 1);
      renderFilePreview();
    };

    div.appendChild(removeBtn);
    preview.appendChild(div);
  });
}

function sendMessage() {
  const message = messageInput.value.trim();
  if (!message && pendingFiles.length === 0) return;

  // Generate message ID for tracking
  const messageId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);

  // Display user message with file info
  const messageData = {
    text: message,
    files: pendingFiles.map(f => ({ name: f.name, size: f.size }))
  };
  addMessage(messageData, 'user', new Date().toISOString());

  // Send to agent with temp file paths
  socket.emit('chat:message', {
    message: message,
    messageId: messageId,
    tempFiles: pendingFiles
  });

  // Clear inputs
  messageInput.value = '';
  pendingFiles = [];
  renderFilePreview();
}

function slugLabel(slug) {
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');
}

// Client info
async function loadClientInfo() {
  try {
    const res = await fetch(`/api/client?token=${token}`);
    const data = await res.json();
    clientSlug = data.clientSlug;
    clientName.textContent = slugLabel(clientSlug);

    // Try to load client list (admin only — will 403 for regular clients)
    const clientsRes = await fetch(`/api/clients?token=${token}`);
    if (clientsRes.ok) {
      const clients = await clientsRes.json();
      if (clients.length > 1) {
        isAdmin = true;
        const switcher = document.getElementById('clientSwitcher');
        const select = document.getElementById('clientSelect');
        select.innerHTML = clients.map(c =>
          `<option value="${c.clientSlug}">${slugLabel(c.clientSlug)}</option>`
        ).join('');
        select.value = clientSlug;
        switcher.style.display = 'block';

        select.addEventListener('change', () => {
          const target = select.value;
          if (target === (activeClientSlug || clientSlug)) return;
          activeClientSlug = target === clientSlug ? null : target;
          clientName.textContent = slugLabel(target);
          socket.emit('client:switch', { clientSlug: target });
        });
      }
    }
  } catch (error) {
    console.error('Failed to load client info:', error);
  }
}

// Vault functionality
let currentFile = null;

async function loadVault(autoOpenPath) {
  try {
    const res = await fetch(`/api/vault?token=${token}${asParam()}`);
    const data = await res.json();

    vaultFiles = (data.files || []).filter(f => {
      const ext = f.path.split('.').pop().toLowerCase();
      return ['md', 'markdown', 'txt', 'json', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(ext);
    });

    renderVaultTree();

    // Auto-open a file if requested (from deep link, pendingVaultOpen, or last selected)
    const savedVaultFile = localStorage.getItem('ks_lastVaultFile') || '';
    const target = (autoOpenPath || pendingVaultOpen || savedVaultFile || '').replace(/^\/+/, '');
    pendingVaultOpen = null;
    if (target) {
      const file = vaultFiles.find(f =>
        f.path === target ||
        f.path === target + '.md' ||
        f.path === target + '.markdown' ||
        f.path.replace(/\.(md|markdown)$/, '') === target
      );
      if (file) loadFile(file);
    }
  } catch (error) {
    console.error('Failed to load vault:', error);
  }
}

function renderVaultTree() {
  vaultTree.innerHTML = '';
  
  const tree = buildTree(vaultFiles);
  renderTreeNode(tree, vaultTree, 0);
}

function buildTree(files, path = '') {
  const tree = {};
  
  files.forEach(file => {
    const parts = file.path.split('/');
    let current = tree;
    
    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = index === parts.length - 1 ? { __file: file } : {};
      }
      current = current[part];
    });
  });
  
  return tree;
}

function renderTreeNode(node, container, level) {
  const sortedKeys = Object.keys(node).sort((a, b) => {
    const aIsFile = node[a].__file;
    const bIsFile = node[b].__file;
    if (aIsFile === bIsFile) return a.localeCompare(b);
    return aIsFile ? 1 : -1; // Folders first
  });

  sortedKeys.forEach(key => {
    const value = node[key];
    const isFile = value.__file;

    if (isFile) {
      const item = document.createElement('div');
      item.className = 'vault-item file';
      item.dataset.filePath = value.__file.path;

      const ext = key.split('.').pop().toLowerCase();
      const icon = getFileIcon(ext);
      const cleanName = key.replace(/\.(md|markdown)$/, '');

      if (currentFile && currentFile.path === value.__file.path) {
        item.classList.add('active');
      }

      item.innerHTML = `
        <i class="fas ${icon} item-icon" style="color: var(--accent-light);"></i>
        <span class="item-label">${cleanName}</span>
      `;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        loadFile(value.__file);
      });

      container.appendChild(item);
    } else {
      const wrapper = document.createElement('div');

      const item = document.createElement('div');
      item.className = 'vault-item folder';

      const chevron = document.createElement('i');
      chevron.className = 'fas fa-chevron-right chevron';

      item.innerHTML = `
        <i class="fas fa-chevron-right chevron"></i>
        <i class="fas fa-folder item-icon" style="color: var(--accent-light);"></i>
        <span class="item-label" style="font-weight: 500;">${key}</span>
      `;

      const childContainer = document.createElement('div');
      childContainer.className = 'folder-children';
      // Auto-expand first level
      if (level > 0) childContainer.classList.add('hidden');

      const chevronEl = item.querySelector('.chevron');
      if (level === 0) {
        chevronEl.classList.add('open');
        item.querySelector('.fa-folder').classList.replace('fa-folder', 'fa-folder-open');
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !childContainer.classList.contains('hidden');
        childContainer.classList.toggle('hidden');
        chevronEl.classList.toggle('open');
        const folderIcon = item.querySelector('.item-icon');
        if (isOpen) {
          folderIcon.classList.replace('fa-folder-open', 'fa-folder');
        } else {
          folderIcon.classList.replace('fa-folder', 'fa-folder-open');
        }
      });

      wrapper.appendChild(item);
      renderTreeNode(value, childContainer, level + 1);
      wrapper.appendChild(childContainer);
      container.appendChild(wrapper);
    }
  });
}

function getFileIcon(ext) {
  const icons = {
    'md': 'fa-file-alt',
    'markdown': 'fa-file-alt',
    'jpg': 'fa-file-image',
    'jpeg': 'fa-file-image',
    'png': 'fa-file-image',
    'gif': 'fa-file-image',
    'webp': 'fa-file-image',
    'mp4': 'fa-file-video',
    'webm': 'fa-file-video',
    'mov': 'fa-file-video'
  };
  return icons[ext] || 'fa-file';
}

// Vault preview popup (opened from chat vault links)
async function openVaultPreview(filePath) {
  // Resolve path (with or without .md)
  const target = filePath.replace(/^\/+/, '');

  async function fetchVaultFiles() {
    const res = await fetch(`/api/vault?token=${token}${asParam()}`);
    const data = await res.json();
    vaultFiles = (data.files || []).filter(f => {
      const ext = f.path.split('.').pop().toLowerCase();
      return ['md', 'markdown', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(ext);
    });
  }

  // Fetch vault file list if not loaded
  if (vaultFiles.length === 0) {
    try { await fetchVaultFiles(); } catch (e) { console.error('[vault] preload error:', e); }
  }

  function findInVault(list, cleanTarget) {
    return list.find(f =>
      f.path === cleanTarget ||
      f.path === cleanTarget + '.md' ||
      f.path === cleanTarget + '.markdown' ||
      f.path.replace(/\.(md|markdown)$/, '') === cleanTarget ||
      f.path.startsWith(cleanTarget + '/')
    );
  }

  const cleanTarget = target.replace(/\/+$/, '');
  let file = findInVault(vaultFiles, cleanTarget);

  // Not found in cached list — force a fresh fetch and retry once
  if (!file) {
    try {
      await fetchVaultFiles();
      file = findInVault(vaultFiles, cleanTarget);
    } catch (e) { console.error('[vault] refresh error:', e); }
  }

  // Last resort: try server-side fuzzy search by filename stem
  if (!file) {
    try {
      const stem = cleanTarget.split('/').pop().replace(/\.(md|markdown)$/, '');
      const res = await fetch(`/api/vault/search?token=${token}${asParam()}&q=${encodeURIComponent(stem)}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        file = data.results[0];
      }
    } catch (e) { console.error('[vault] search fallback error:', e); }
  }

  if (!file) {
    console.error('[vault] file not found:', filePath, 'vaultFiles count:', vaultFiles.length);
    showToast('File not found: ' + filePath, 'error');
    return;
  }

  try {
    const res = await fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(file.path)}`);
    const content = await res.text();
    const ext = file.path.split('.').pop().toLowerCase();
    const cleanName = file.path.split('/').pop().replace(/\.(md|markdown)$/, '');
    const fileUrl = `/api/vault/file?token=${token}${asParam()}&path=${file.path}`;

    // Build modal
    const overlay = document.createElement('div');
    overlay.className = 'vault-modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    let bodyHtml = '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      bodyHtml = `<img src="${fileUrl}" alt="${escapeHtml(cleanName)}" style="max-width:100%;border-radius:8px;" class="lightbox-img" data-src="${fileUrl}">`;
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      bodyHtml = `<video src="${fileUrl}" controls style="max-width:100%;border-radius:8px;"></video>`;
    } else if (ext === 'pdf') {
      bodyHtml = `<div class="pdf-viewer" id="pdfViewer"><div class="pdf-controls"><button id="pdfPrev"><i class="fas fa-chevron-left"></i></button><span id="pdfPageInfo">1 / 1</span><button id="pdfNext"><i class="fas fa-chevron-right"></i></button></div><canvas id="pdfCanvas"></canvas></div>`;
    } else if (typeof marked !== 'undefined') {
      bodyHtml = `<div class="prose max-w-none" id="modalProse">${marked.parse(content)}</div>`;
    } else {
      bodyHtml = `<pre style="white-space:pre-wrap;">${escapeHtml(content)}</pre>`;
    }

    overlay.innerHTML = `
      <div class="vault-modal">
        <div class="vault-modal-header">
          <h3><i class="fas fa-file-alt" style="color:var(--accent-light);margin-right:8px;"></i>${escapeHtml(cleanName)}</h3>
          <div class="modal-actions">
            <button class="modal-btn" id="vaultModalCopy"><i class="fas fa-copy"></i> Copy</button>
            <button class="modal-btn" id="vaultModalDownload"><i class="fas fa-download"></i> Download</button>
            <button class="modal-btn" id="vaultModalOpen"><i class="fas fa-external-link-alt"></i> Open in Vault</button>
            <button class="modal-btn" id="vaultModalClose"><i class="fas fa-times"></i></button>
          </div>
        </div>
        <div class="vault-modal-body">${bodyHtml}</div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Wire buttons
    overlay.querySelector('#vaultModalClose').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#vaultModalCopy').addEventListener('click', () => {
      navigator.clipboard.writeText(content).then(() => {
        const btn = overlay.querySelector('#vaultModalCopy');
        btn.innerHTML = '<i class="fas fa-check"></i> Copied';
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 1500);
      });
    });

    overlay.querySelector('#vaultModalDownload').addEventListener('click', () => {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.path.split('/').pop();
      a.click();
      URL.revokeObjectURL(url);
    });

    overlay.querySelector('#vaultModalOpen').addEventListener('click', () => {
      overlay.remove();
      switchView('vault');
      loadVault(file.path);
    });

    // Post-render enhancements for modal prose content
    const modalProse = overlay.querySelector('#modalProse');
    if (modalProse) {
      applyMarkdownEnhancements(modalProse);
      // Add TOC if headings exist
      const tocHtml = generateTOC(modalProse);
      if (tocHtml) modalProse.insertAdjacentHTML('beforebegin', tocHtml);
    }

    // PDF viewer
    const pdfViewer = overlay.querySelector('#pdfViewer');
    if (pdfViewer && typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      let pdfDoc = null, currentPage = 1, totalPages = 1;
      const canvas = pdfViewer.querySelector('#pdfCanvas');
      const ctx = canvas.getContext('2d');
      const pageInfo = pdfViewer.querySelector('#pdfPageInfo');
      const prevBtn = pdfViewer.querySelector('#pdfPrev');
      const nextBtn = pdfViewer.querySelector('#pdfNext');

      pdfjsLib.getDocument(fileUrl).promise.then(doc => {
        pdfDoc = doc;
        totalPages = doc.numPages;
        pageInfo.textContent = `${currentPage} / ${totalPages}`;
        renderPdfPage(currentPage);
      });

      function renderPdfPage(num) {
        pdfDoc.getPage(num).then(page => {
          const viewport = page.getViewport({ scale: 1.5 });
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          page.render({ canvasContext: ctx, viewport }).promise;
        });
      }

      prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; pageInfo.textContent = `${currentPage} / ${totalPages}`; renderPdfPage(currentPage); } });
      nextBtn.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; pageInfo.textContent = `${currentPage} / ${totalPages}`; renderPdfPage(currentPage); } });
    }

    // Lightbox for images in modal
    overlay.querySelectorAll('img.lightbox-img').forEach(img => {
      img.addEventListener('click', () => openLightbox(img.dataset.src || img.src, img.alt));
    });

    // Close on Escape
    function onKey(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);

  } catch (error) {
    console.error('Failed to preview vault file:', error);
  }
}

async function loadFile(file) {
  try {
    vaultEditing = false;
    updateVaultEditBtn();

    const ext = file.path.split('.').pop().toLowerCase();
    const cleanName = file.path.split('/').pop().replace(/\.(md|markdown)$/, '');
    const isTextFile = ['md', 'markdown', 'txt', 'json', 'csv'].includes(ext);

    // Detect kanban files (in kanban/ folder)
    const isKanbanFile = ext === 'md' && (
      file.path.startsWith('kanban/') || file.path.includes('/kanban/')
    );

    vaultFileName.textContent = cleanName;
    document.getElementById('vaultActions').style.display = 'flex';
    // Only show edit button for non-kanban text files (or when kanban is in md view mode)
    document.getElementById('vaultEditBtn').style.display = (isTextFile && !isKanbanFile) ? '' : 'none';
    // Show toggle button only for kanban files
    document.getElementById('vaultKanbanToggleBtn').style.display = isKanbanFile ? '' : 'none';
    // Show convert button only for .md files NOT in kanban/ folder
    document.getElementById('vaultConvertKanbanBtn').style.display = (ext === 'md' && !isKanbanFile) ? '' : 'none';

    currentFile = file;
    localStorage.setItem('ks_lastVaultFile', file.path);

    // Update active state
    document.querySelectorAll('.vault-item.file').forEach(el => {
      el.classList.toggle('active', el.dataset.filePath === file.path);
    });

    // Kanban files: fetch from /api/kanban and render inline
    if (isKanbanFile) {
      const kanbanBasename = file.path.split('/').pop();
      const res = await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(kanbanBasename)}`);
      const data = await res.json();
      currentKanban = data.kanban || getDefaultKanban();
      currentKanbanFile = kanbanBasename;
      kanbanViewMode = 'kanban'; // reset to kanban view on file open
      vaultEditing = false;
      updateVaultKanbanToggleBtn();
      renderKanbanFileView();
      return;
    }

    const res = await fetch(`/api/vault/file?token=${token}${asParam()}&path=${file.path}`);
    const content = await res.text();

    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      const imagePath = `/api/vault/file?token=${token}${asParam()}&path=${file.path}`;
      vaultContent.innerHTML = `<img src="${imagePath}" alt="${cleanName}" class="max-w-full rounded-lg lightbox-img" data-src="${imagePath}">`;
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      const videoPath = `/api/vault/file?token=${token}${asParam()}&path=${file.path}`;
      vaultContent.innerHTML = `<video src="${videoPath}" controls class="max-w-full rounded-lg"></video>`;
    } else if (ext === 'pdf') {
      const pdfPath = `/api/vault/file?token=${token}${asParam()}&path=${file.path}`;
      vaultContent.innerHTML = `<div class="pdf-viewer" id="vaultPdfViewer" data-path="${encodeURIComponent(file.path)}"><div class="pdf-controls"><button id="vpdfPrev"><i class="fas fa-chevron-left"></i></button><span id="vpdfPageInfo">1 / 1</span><button id="vpdfNext"><i class="fas fa-chevron-right"></i></button></div><canvas id="vpdfCanvas"></canvas></div>`;
    } else {
      // Markdown
      if (typeof marked !== 'undefined') {
        vaultContent.innerHTML = `<div class="prose max-w-none" id="vaultProse">${marked.parse(content)}</div>`;
        const proseEl = vaultContent.querySelector('#vaultProse');
        applyMarkdownEnhancements(proseEl);
        // Add copy buttons to content blocks inside a container
        function addCopyButtons(container) {
          container.querySelectorAll('.prose > p, .prose > pre, .prose > blockquote, .prose > ul, .prose > ol').forEach(block => {
            const btn = document.createElement('button');
            btn.className = 'copy-block-btn';
            btn.innerHTML = '<i class="fas fa-copy"></i>';
            btn.title = 'Copy';
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const text = block.innerText.replace(/\n?Copy$/, '').trim();
              navigator.clipboard.writeText(text).then(() => {
                btn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1500);
              });
            });
            block.style.position = 'relative';
            block.appendChild(btn);
          });
        }
        // Enable interactive checkboxes in vault
        let vaultRawContent = content;
        function onVaultCheckboxToggle(idx) {
          vaultRawContent = toggleMarkdownCheckbox(vaultRawContent, idx);
          vaultContent.querySelector('.prose').innerHTML = marked.parse(vaultRawContent);
          const proseAfter = vaultContent.querySelector('.prose');
          enableInteractiveCheckboxes(proseAfter, onVaultCheckboxToggle);
          addCopyButtons(proseAfter);
          wireVaultInternalLinks(proseAfter, file.path);
          applyMarkdownEnhancements(proseAfter);
          fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(file.path)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: vaultRawContent })
          });
        }
        enableInteractiveCheckboxes(proseEl, onVaultCheckboxToggle);
        addCopyButtons(proseEl);
        wireVaultInternalLinks(proseEl, file.path);

        // Add TOC if there are 2+ headings
        const tocHtml = generateTOC(proseEl);
        if (tocHtml) proseEl.insertAdjacentHTML('beforebegin', tocHtml);
      } else {
        vaultContent.innerHTML = `<pre>${content}</pre>`;
      }
    }

    // Initialize PDF viewer if present
    const vaultPdfViewer = document.getElementById('vaultPdfViewer');
    if (vaultPdfViewer && typeof pdfjsLib !== 'undefined') {
      initPdfViewer(vaultPdfViewer);
    }

    // Image lightbox
    vaultContent.querySelectorAll('img.lightbox-img').forEach(img => {
      img.addEventListener('click', () => openLightbox(img.dataset.src || img.src, img.alt));
    });
  } catch (error) {
    console.error('Failed to load file:', error);
    vaultContent.innerHTML = '<p class="text-red-600">Failed to load file</p>';
  }
}

// PDF viewer init shared between modal and inline
function initPdfViewer(container) {
  const path = container.dataset.path;
  if (!path) return;
  const fileUrl = `/api/vault/file?token=${token}${asParam()}&path=${decodeURIComponent(path)}`;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  let pdfDoc = null, currentPage = 1, totalPages = 1;
  const canvas = container.querySelector('canvas') || container.querySelector('#vpdfCanvas') || container.querySelector('#pdfCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const pageInfo = container.querySelector('span');
  const prevBtn = container.querySelector('button[id$="Prev"]');
  const nextBtn = container.querySelector('button[id$="Next"]');
  if (!pageInfo || !prevBtn || !nextBtn) return;

  pdfjsLib.getDocument(fileUrl).promise.then(doc => {
    pdfDoc = doc;
    totalPages = doc.numPages;
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
    renderPdfPage(currentPage);
  });

  function renderPdfPage(num) {
    pdfDoc.getPage(num).then(page => {
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      page.render({ canvasContext: ctx, viewport }).promise;
    });
  }

  prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; pageInfo.textContent = `${currentPage} / ${totalPages}`; renderPdfPage(currentPage); } };
  nextBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; pageInfo.textContent = `${currentPage} / ${totalPages}`; renderPdfPage(currentPage); } };
}

// Search
async function onVaultSearchInput(e) {
  const rawQuery = e.target.value;
  const query = rawQuery.toLowerCase();

  if (!query) {
    renderVaultTree();
    return;
  }

  vaultTree.innerHTML = '';

  // Tag or content search: delegate to server
  if (rawQuery.startsWith('#') || query.includes('#')) {
    try {
      const res = await fetch(`/api/vault/search?token=${token}${asParam()}&q=${encodeURIComponent(rawQuery)}`);
      const data = await res.json();
      const results = data.results || [];
      if (results.length === 0) {
        vaultTree.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px;">No files found for tag: ' + escapeHtml(rawQuery) + '</div>';
      }
      results.forEach(f => {
        const item = document.createElement('div');
        item.className = 'vault-item file';
        if (currentFile && currentFile.path === f.path) item.classList.add('active');
        const ext = f.path.split('.').pop().toLowerCase();
        item.innerHTML = `<i class="fas ${getFileIcon(ext)}" style="color: var(--accent-light); font-size: 14px;"></i><span class="text-sm">${escapeHtml(f.path)}</span>`;
        item.addEventListener('click', (ev) => { ev.stopPropagation(); loadFile(f); });
        vaultTree.appendChild(item);
      });
    } catch (err) { console.error('[vault] search error:', err); }
    return;
  }

  // Local filename fuzzy search (substring match, case-insensitive)
  const results = vaultFiles.filter(f => f.path.toLowerCase().includes(query));

  results.forEach(f => {
    const item = document.createElement('div');
    item.className = 'vault-item file';
    if (currentFile && currentFile.path === f.path) item.classList.add('active');
    const ext = f.path.split('.').pop().toLowerCase();
    item.innerHTML = `<i class="fas ${getFileIcon(ext)}" style="color: var(--accent-light); font-size: 14px;"></i><span class="text-sm">${escapeHtml(f.path)}</span>`;
    item.addEventListener('click', (ev) => { ev.stopPropagation(); loadFile(f); });
    vaultTree.appendChild(item);
  });
}

vaultSearch.addEventListener('input', onVaultSearchInput);
// Upload
uploadBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.markdown,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch(`/api/vault/upload?token=${token}${asParam()}`, {
        method: 'POST',
        body: formData
      });
      
      if (res.ok) {
        showToast('File uploaded successfully!', 'success');
        loadVault();
      } else {
        showToast('Upload failed', 'error');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      showToast('Upload failed', 'error');
    }
  };
  
  input.click();
});

// Split view vault upload
document.getElementById('uploadBtnSplit')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.markdown,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`/api/vault/upload?token=${token}${asParam()}`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        showToast('File uploaded successfully!', 'success');
        loadVaultSplit();
      } else {
        showToast('Upload failed', 'error');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      showToast('Upload failed', 'error');
    }
  };

  input.click();
});

// Toggle the nth checkbox in markdown content (0-indexed)
function toggleMarkdownCheckbox(markdown, checkboxIndex) {
  const regex = /- \[([ xX])\]/g;
  let count = 0;
  return markdown.replace(regex, (match, state) => {
    if (count++ === checkboxIndex) {
      return state.trim() ? '- [ ]' : '- [x]';
    }
    return match;
  });
}

// Enable interactive checkboxes inside a container, calling onChange(checkboxIndex, checked) on toggle
function enableInteractiveCheckboxes(container, onChange) {
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach((cb, idx) => {
    cb.disabled = false;
    cb.style.cursor = 'pointer';
    // Prevent drag from intercepting checkbox clicks (kanban cards are draggable)
    cb.addEventListener('mousedown', (e) => e.stopPropagation());
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      onChange(idx, cb.checked);
    });
  });
}

// Vault edit & delete
let vaultEditing = false;
let vaultOriginalContent = '';
let kanbanViewMode = 'kanban'; // 'kanban' | 'md'
let autosaveTimeout = null;
let isSaving = false;

// Autosave function with debouncing
function scheduleAutosave() {
  if (!vaultEditing || !currentFile) return;

  // Clear existing timeout
  clearTimeout(autosaveTimeout);

  // Show "Saving..." indicator
  showAutosaveStatus('saving');

  // Schedule save after 2 seconds of inactivity
  autosaveTimeout = setTimeout(async () => {
    await autosaveVault();
  }, 2000);
}

// Perform the actual autosave
async function autosaveVault() {
  if (!vaultEditing || !currentFile || isSaving) return;

  const textarea = document.querySelector('.vault-editor');
  if (!textarea) return;

  isSaving = true;
  const content = textarea.value;

  try {
    const res = await fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(currentFile.path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    if (res.ok) {
      showAutosaveStatus('saved');
      // Clear "Saved" status after 3 seconds
      setTimeout(() => {
        if (!isSaving) hideAutosaveStatus();
      }, 3000);
    } else {
      showAutosaveStatus('error');
    }
  } catch (error) {
    console.error('Autosave failed:', error);
    showAutosaveStatus('error');
  } finally {
    isSaving = false;
  }
}

// Show autosave status indicator
function showAutosaveStatus(status) {
  const indicator = document.getElementById('autosaveIndicator');
  const text = document.getElementById('autosaveText');
  if (!indicator || !text) return;

  indicator.classList.remove('hidden', 'saved');

  switch (status) {
    case 'saving':
      text.textContent = 'Saving...';
      break;
    case 'saved':
      indicator.classList.add('saved');
      text.textContent = 'Saved';
      break;
    case 'error':
      text.textContent = 'Save failed';
      text.style.color = '#ef4444';
      break;
  }
}

// Hide autosave status indicator
function hideAutosaveStatus() {
  const indicator = document.getElementById('autosaveIndicator');
  if (indicator) {
    indicator.classList.add('hidden');
    indicator.classList.remove('saved');
  }
  const text = document.getElementById('autosaveText');
  if (text) {
    text.style.color = '';
  }
}

document.getElementById('vaultEditBtn').addEventListener('click', async () => {
  if (!currentFile) return;
  const ext = currentFile.path.split('.').pop().toLowerCase();
  if (!['md', 'markdown', 'txt', 'json', 'csv'].includes(ext)) return;

  if (vaultEditing) {
    // Save and exit edit mode
    await autosaveVault(); // Save any pending changes
    vaultEditing = false;
    clearTimeout(autosaveTimeout);
    hideAutosaveStatus();

    const isKanbanFileSave = currentFile && (currentFile.path.startsWith('kanban/') || currentFile.path.includes('/kanban/'));
    if (isKanbanFileSave && kanbanViewMode === 'md') {
      renderKanbanFileView();
    } else {
      loadFile(currentFile);
    }
  } else {
    // Enter edit mode
    const res = await fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(currentFile.path)}`);
    vaultOriginalContent = await res.text();
    vaultEditing = true;

    const vaultContent = document.getElementById('vaultContent');
    vaultContent.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.className = 'vault-editor';
    textarea.value = vaultOriginalContent;
    vaultContent.appendChild(textarea);
    textarea.focus();

    // Set up autosave on input
    textarea.addEventListener('input', () => {
      scheduleAutosave();
    });

    // Save on Ctrl/Cmd + S
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        autosaveVault();
      }
    });
  }
  updateVaultEditBtn();
});

document.getElementById('vaultDeleteBtn').addEventListener('click', async () => {
  if (!currentFile) return;
  if (!confirm(`Delete "${currentFile.path}"?`)) return;

  await fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(currentFile.path)}`, {
    method: 'DELETE'
  });

  currentFile = null;
  vaultEditing = false;
  document.getElementById('vaultFileName').textContent = 'Select a file';
  document.getElementById('vaultContent').innerHTML = '';
  document.getElementById('vaultActions').style.display = 'none';
  loadVault();
});

function updateVaultEditBtn() {
  const btn = document.getElementById('vaultEditBtn');
  if (vaultEditing) {
    btn.innerHTML = '<i class="fas fa-save"></i>';
    btn.title = 'Save';
  } else {
    btn.innerHTML = '<i class="fas fa-pen"></i>';
    btn.title = 'Edit';
  }
}

function updateVaultKanbanToggleBtn() {
  const btn = document.getElementById('vaultKanbanToggleBtn');
  if (!btn) return;
  if (kanbanViewMode === 'kanban') {
    btn.innerHTML = '<i class="fas fa-file-alt"></i>';
    btn.title = 'View as Markdown';
  } else {
    btn.innerHTML = '<i class="fas fa-columns"></i>';
    btn.title = 'View as Kanban';
  }
}

function renderKanbanFileView() {
  vaultContent.innerHTML = '';
  vaultEditing = false;
  updateVaultEditBtn();
  if (kanbanViewMode === 'kanban') {
    const kanbanContainer = document.createElement('div');
    kanbanContainer.className = 'flex h-full gap-4 overflow-x-auto pb-4 items-stretch';
    kanbanContainer.style.minHeight = '400px';
    vaultContent.style.overflow = 'auto';
    vaultContent.appendChild(kanbanContainer);
    renderKanban(kanbanContainer);
    document.getElementById('vaultEditBtn').style.display = 'none';
  } else {
    // MD view: fetch raw file and render as markdown
    vaultContent.style.overflow = '';
    document.getElementById('vaultEditBtn').style.display = '';
    updateVaultEditBtn();
    fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(currentFile.path)}`)
      .then(r => r.text())
      .then(content => {
        if (typeof marked !== 'undefined') {
          vaultContent.innerHTML = `<div class="prose max-w-none" id="vaultProse">${marked.parse(content)}</div>`;
          const proseEl = vaultContent.querySelector('#vaultProse');
          applyMarkdownEnhancements(proseEl);
          wireVaultInternalLinks(proseEl, currentFile.path);
          const tocHtml = generateTOC(proseEl);
          if (tocHtml) proseEl.insertAdjacentHTML('beforebegin', tocHtml);
        } else {
          vaultContent.innerHTML = `<pre class="whitespace-pre-wrap text-sm">${escapeHtml(content)}</pre>`;
        }
      });
  }
}

document.getElementById('vaultKanbanToggleBtn').addEventListener('click', () => {
  if (!currentFile) return;
  kanbanViewMode = kanbanViewMode === 'kanban' ? 'md' : 'kanban';
  vaultEditing = false;
  updateVaultKanbanToggleBtn();
  renderKanbanFileView();
});

document.getElementById('vaultConvertKanbanBtn').addEventListener('click', async () => {
  if (!currentFile) return;
  const ext = currentFile.path.split('.').pop().toLowerCase();
  if (ext !== 'md') return;

  // Fetch current content
  let content = '';
  try {
    const res = await fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(currentFile.path)}`);
    content = await res.text();
  } catch (e) {
    showToast('Could not read file.', 'error');
    return;
  }

  // Parse markdown into kanban: ## Heading → lane, - item / * item → card
  const lines = content.split('\n');
  const kanban = { title: currentFile.path.split('/').pop().replace(/\.md$/, ''), lanes: [] };
  let currentLane = null;
  lines.forEach(line => {
    if (/^## /.test(line)) {
      currentLane = { id: line.replace(/^## /, '').trim().toLowerCase().replace(/\s+/g, '-'), title: line.replace(/^## /, '').trim(), cards: [] };
      kanban.lanes.push(currentLane);
    } else if (/^[*-] /.test(line) && currentLane) {
      const title = line.replace(/^[*-] /, '').trim();
      if (title) currentLane.cards.push({ id: Date.now().toString() + Math.random(), title, body: '' });
    } else if (/^# /.test(line) && !/^##/.test(line)) {
      kanban.title = line.replace(/^# /, '').trim();
    }
  });

  if (kanban.lanes.length === 0) {
    kanban.lanes = [
      { id: 'todo', title: 'To Do', cards: [] },
      { id: 'in-progress', title: 'In Progress', cards: [] },
      { id: 'done', title: 'Done', cards: [] }
    ];
  }

  // Save as kanban file with same basename
  const basename = currentFile.path.split('/').pop();
  try {
    await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(basename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanban })
    });
  } catch (e) {
    showToast('Could not save kanban.', 'error');
    return;
  }

  // Reload vault to pick up new kanban file in kanban/ folder
  loadVault();
});

document.getElementById('vaultMoveBtn').addEventListener('click', async () => {
  if (!currentFile) return;

  // Gather unique folders from vault files
  const folders = [...new Set(
    vaultFiles
      .map(f => f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '')
      .filter(Boolean)
  )].sort();

  const folderList = folders.length ? folders.join('\n') : '(root)';
  const dest = prompt(`Move "${currentFile.path.split('/').pop()}" to folder:\nAvailable folders:\n${folderList}\n\nEnter folder path (leave empty for root):`);
  if (dest === null) return; // cancelled

  const filename = currentFile.path.split('/').pop();
  const toPath = dest.trim() ? dest.trim().replace(/\/$/, '') + '/' + filename : filename;

  if (toPath === currentFile.path) return;

  try {
    const res = await fetch(`/api/vault/move?token=${token}${asParam()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: currentFile.path, to: toPath })
    });
    if (!res.ok) {
      const err = await res.json();
      showToast('Move failed: ' + (err.error || 'Unknown error'), 'error');
      return;
    }
    currentFile = null;
    document.getElementById('vaultFileName').textContent = 'Select a file';
    document.getElementById('vaultContent').innerHTML = '';
    document.getElementById('vaultActions').style.display = 'none';
    loadVault();
  } catch (e) {
    showToast('Move failed.', 'error');
  }
});

// Kanban functionality
let kanbanBoards = [];
let currentKanbanFile = 'kanban.md';
let currentKanbanContainer = null; // tracks which container renderKanban last rendered to

async function loadKanbanList() {
  try {
    const res = await fetch(`/api/kanban/list?token=${token}${asParam()}`);
    const data = await res.json();
    kanbanBoards = data.boards || [];
    renderKanbanList();
  } catch (error) {
    console.error('Failed to load kanban list:', error);
  }
}

function renderKanbanList() {
  const list = document.getElementById('kanbanList');
  if (!list) return;
  list.innerHTML = '';
  kanbanBoards.forEach(board => {
    const div = document.createElement('div');
    div.className = `session-item ${board.file === currentKanbanFile ? 'active' : ''}`;
    div.innerHTML = `
      <div class="session-name"><i class="fas fa-columns" style="margin-right:6px;opacity:0.5;font-size:11px;"></i>${escapeHtml(board.title)}</div>
      <div class="session-actions">
        <button class="session-action-btn rename-kanban" title="Rename"><i class="fas fa-pen"></i></button>
        <button class="session-action-btn delete-kanban" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.closest('.session-actions')) return;
      currentKanbanFile = board.file;
      loadKanban();
      renderKanbanList();
    });
    div.querySelector('.rename-kanban').addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt('Rename board:', board.title);
      if (!newName || !newName.trim()) return;
      renameKanbanBoard(board.file, newName.trim());
    });
    div.querySelector('.delete-kanban').addEventListener('click', (e) => {
      e.stopPropagation();
      if (kanbanBoards.length <= 1) { showToast('Cannot delete the last board.', 'warning'); return; }
      if (!confirm(`Delete "${board.title}"?`)) return;
      deleteKanbanBoard(board.file);
    });
    list.appendChild(div);
  });
}

async function renameKanbanBoard(file, newTitle) {
  try {
    const res = await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(file)}`);
    const data = await res.json();
    const kanban = data.kanban || getDefaultKanban();
    kanban.title = newTitle;
    await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(file)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanban })
    });
    await loadKanbanList();
    if (currentKanbanFile === file) {
      currentKanban.title = newTitle;
      renderKanban();
    }
  } catch (error) {
    console.error('Failed to rename kanban:', error);
  }
}

async function deleteKanbanBoard(file) {
  try {
    await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(file)}`, { method: 'DELETE' });
    if (currentKanbanFile === file) {
      currentKanbanFile = 'kanban.md';
    }
    await loadKanbanList();
    await loadKanban();
  } catch (error) {
    console.error('Failed to delete kanban:', error);
  }
}

const newKanbanBtnEl = document.getElementById('newKanbanBtn');
if (newKanbanBtnEl) newKanbanBtnEl.addEventListener('click', async () => {
  const name = prompt('Board name:');
  if (!name || !name.trim()) return;
  // Generate unique filename that won't conflict
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let file = slug + '.md';
  // Avoid overwriting existing boards
  if (kanbanBoards.some(b => b.file === file)) {
    file = slug + '-' + Date.now().toString(36) + '.md';
  }
  const newKanban = { title: name.trim(), lanes: [
    { id: 'todo', title: 'To Do', cards: [] },
    { id: 'in-progress', title: 'In Progress', cards: [] },
    { id: 'done', title: 'Done', cards: [] }
  ]};
  // Save the new board without switching currentKanbanFile first
  await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(file)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kanban: newKanban })
  });
  currentKanbanFile = file;
  currentKanban = newKanban;
  renderKanban();
  await loadKanbanList();
});

async function loadKanban() {
  try {
    const res = await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(currentKanbanFile)}`);
    const data = await res.json();
    currentKanban = data.kanban || getDefaultKanban();
    renderKanban();
  } catch (error) {
    console.error('Failed to load kanban:', error);
    currentKanban = getDefaultKanban();
    renderKanban();
  }
}

function getDefaultKanban() {
  return {
    title: 'Kanban',
    lanes: [
      { id: 'todo', title: 'To Do', cards: [] },
      { id: 'in-progress', title: 'In Progress', cards: [] },
      { id: 'done', title: 'Done', cards: [] }
    ]
  };
}

// Migrate old card format (items array) to new format (body markdown)
function migrateCard(card) {
  if (card.body !== undefined) return card;
  let body = '';
  if (card.items && card.items.length > 0) {
    body = card.items.map(item => {
      if (item.type === 'section') return '### ' + item.content;
      if (item.type === 'checkbox') return '- [' + (item.checked ? 'x' : ' ') + '] ' + item.content;
      if (item.type === 'bullet') return '- ' + item.content;
      return item.content;
    }).join('\n');
  }
  if (card.content && !card.items) {
    body = card.content;
  }
  return { id: card.id, title: card.title || 'Untitled', body };
}

function renderCardBody(body) {
  let html = marked.parse(body);
  // Fallback: if marked didn't render task list checkboxes (GFM issue),
  // convert remaining literal [ ]/[x] in list items to actual checkbox inputs
  html = html.replace(/<li>\s*\[([ xX])\]\s*/g, (match, state) => {
    const checked = state.trim() ? ' checked' : '';
    return `<li><input type="checkbox" disabled${checked}> `;
  });
  return html;
}

function renderCardContent(card) {
  const c = migrateCard(card);
  let html = '';
  if (c.title) {
    html += `<div class="card-title">${escapeHtml(c.title)}</div>`;
  }
  if (c.body) {
    html += `<div class="card-body">${renderCardBody(c.body)}</div>`;
  }
  return html;
}

function renderKanban(container) {
  if (!container) container = currentKanbanContainer || kanbanBoard;
  currentKanbanContainer = container;
  container.innerHTML = '';

  currentKanban.lanes.forEach(lane => {
    const column = document.createElement('div');
    column.className = 'kanban-column flex-1 min-w-64 rounded-lg p-4 min-h-0 overflow-hidden';
    column.dataset.laneId = lane.id;

    const cardsHtml = lane.cards.map((card, index) => {
      return `
        <div class="kanban-card" draggable="true" data-card-index="${index}" data-card-id="${card.id}" data-lane-id="${lane.id}">
          ${renderCardContent(card)}
          <div class="card-actions">
            <button class="edit-card-btn" data-card-id="${card.id}" title="Edit">
              <i class="fas fa-pen text-xs"></i>
            </button>
            <button class="delete-card-btn" data-card-id="${card.id}" title="Delete">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    column.innerHTML = `
      <div class="lane-header">
        <div class="flex items-center">
          <h3>${escapeHtml(lane.title)}</h3>
          <span class="lane-count">${lane.cards.length}</span>
        </div>
        <button class="add-card-btn" style="border:none;background:none;cursor:pointer;color:var(--accent-primary);font-size:14px;padding:4px 8px;border-radius:6px;transition:background 0.15s;"
                onmouseover="this.style.background='rgba(212,165,116,0.1)'" onmouseout="this.style.background='none'">
          <i class="fas fa-plus"></i>
        </button>
      </div>
      <div class="cards-container space-y-2 drop-zone" data-lane-id="${lane.id}">
        ${cardsHtml}
      </div>
    `;

    container.appendChild(column);

    // Add card button — opens modal for new card
    column.querySelector('.add-card-btn').addEventListener('click', () => {
      openNewCardModal(lane.id);
    });

    // Edit/delete buttons
    column.querySelectorAll('.edit-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCardModal(lane.id, btn.dataset.cardId);
      });
    });

    column.querySelectorAll('.delete-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCard(lane.id, btn.dataset.cardId);
      });
    });

    // Enable interactive checkboxes on kanban cards
    column.querySelectorAll('.kanban-card').forEach(cardEl => {
      const cardId = cardEl.dataset.cardId;
      const card = lane.cards.find(c => c.id === cardId);
      if (!card) return;
      function onCardCheckboxToggle(idx) {
        const migrated = migrateCard(card);
        card.body = toggleMarkdownCheckbox(migrated.body, idx);
        card.title = migrated.title;
        delete card.items;
        delete card.content;
        const actionsDiv = cardEl.querySelector('.card-actions');
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderCardContent(card);
        while (cardEl.firstChild && cardEl.firstChild !== actionsDiv) {
          cardEl.removeChild(cardEl.firstChild);
        }
        while (tempDiv.firstChild) {
          cardEl.insertBefore(tempDiv.firstChild, actionsDiv);
        }
        enableInteractiveCheckboxes(cardEl, onCardCheckboxToggle);
        saveKanban();
      }
      enableInteractiveCheckboxes(cardEl, onCardCheckboxToggle);
    });

    // Drag and drop
    const cardsContainer = column.querySelector('.cards-container');

    cardsContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      cardsContainer.classList.add('active');
    });

    cardsContainer.addEventListener('dragleave', () => {
      cardsContainer.classList.remove('active');
    });

    cardsContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      cardsContainer.classList.remove('active');
      const cardIndex = e.dataTransfer.getData('cardIndex');
      const sourceLaneId = e.dataTransfer.getData('sourceLaneId');
      if (cardIndex && sourceLaneId) {
        moveCard(sourceLaneId, lane.id, parseInt(cardIndex));
      }
    });
  });

  // Make cards draggable
  container.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('cardIndex', card.dataset.cardIndex);
      e.dataTransfer.setData('sourceLaneId', card.closest('.cards-container').dataset.laneId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  // Add lane button — thin vertical strip
  const addLaneBtn = document.createElement('button');
  addLaneBtn.className = 'add-lane-strip';
  addLaneBtn.innerHTML = '<i class="fas fa-plus"></i>';
  addLaneBtn.title = 'Add Lane';
  addLaneBtn.addEventListener('click', addLane);
  container.appendChild(addLaneBtn);
}

function addCard(laneId, title) {
  const lane = currentKanban.lanes.find(l => l.id === laneId);
  if (lane) {
    lane.cards.push({ title, id: Date.now().toString(), body: '' });
    saveKanban();
    renderKanban();
  }
}

function deleteCard(laneId, cardId) {
  if (confirm('Delete this card?')) {
    const lane = currentKanban.lanes.find(l => l.id === laneId);
    if (lane) {
      lane.cards = lane.cards.filter(c => c.id !== cardId);
      saveKanban();
      renderKanban();
    }
  }
}

function moveCard(sourceLaneId, targetLaneId, cardIndex) {
  const sourceLane = currentKanban.lanes.find(l => l.id === sourceLaneId);
  const targetLane = currentKanban.lanes.find(l => l.id === targetLaneId);
  
  if (sourceLane && targetLane) {
    const [card] = sourceLane.cards.splice(cardIndex, 1);
    targetLane.cards.push(card);
    saveKanban();
    renderKanban();
  }
}

function addLane() {
  const title = prompt('Enter lane title:');
  if (title) {
    currentKanban.lanes.push({
      id: Date.now().toString(),
      title,
      cards: []
    });
    saveKanban();
    renderKanban();
  }
}

async function saveKanban() {
  try {
    // When rendering a kanban file inline in the vault, derive the filename from currentFile
    let fileToSave = currentKanbanFile;
    if (currentFile && (currentFile.path.startsWith('kanban/') || currentFile.path.includes('/kanban/'))) {
      fileToSave = currentFile.path.split('/').pop();
    }
    await fetch(`/api/kanban?token=${token}${asParam()}&file=${encodeURIComponent(fileToSave)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanban: currentKanban })
    });
  } catch (error) {
    console.error('Failed to save kanban:', error);
  }
}

// Initialize
socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  updateConnectionStatus('disconnected');
});
// Load chat history (sent by server on connect or session switch)
socket.on('chat:history', (data) => {
  if (data.sessionKey !== undefined) {
    activeSessionKey = data.sessionKey;
    if (data.sessionKey) localStorage.setItem('ks_lastSessionKey', data.sessionKey);
    renderSessionList();
  }

  // On initial connect, restore last selected session if different from server's auto-selected
  if (isInitialLoad) {
    isInitialLoad = false;
    const savedKey = localStorage.getItem('ks_lastSessionKey');
    const portalSessions = sessions.filter(s => !s.isSubagent);
    if (savedKey && savedKey !== data.sessionKey && portalSessions.some(s => s.key === savedKey)) {
      socket.emit('sessions:switch', { sessionKey: savedKey });
      return; // skip rendering server's auto-selected history; wait for saved session history
    }
  }

  messagesDiv.innerHTML = '';
  if (data.messages && data.messages.length > 0) {
    data.messages.forEach(msg => {
      // Hide user /approve commands — the approval card shows the decision
      if (msg.role === 'user' && /^\/?approve\s+[a-f0-9]+\s/i.test(msg.content.trim())) return;
      addMessage(msg.content, msg.role, msg.timestamp);
    });
  }
  renderedMessageCount = messagesDiv.children.length;
  // Re-check if agent is still processing (indicator was cleared with innerHTML)
  socket.emit('agent:status');

  // Restart background poll for this session
  startBackgroundPoll();
});

// Background poll: fetch new messages that arrived without a user trigger (heartbeats, proactive agent messages)
function startBackgroundPoll() {
  if (backgroundPollTimer) clearInterval(backgroundPollTimer);
  backgroundPollTimer = setInterval(async () => {
    if (!activeSessionKey || processingSessions.has(activeSessionKey)) return;
    try {
      const asQ = asParam();
      const res = await fetch(`/api/chat/history?token=${token}${asQ}&sessionKey=${encodeURIComponent(activeSessionKey)}`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs = (data.messages || []).filter(m =>
        !(m.role === 'user' && /^\/?approve\s+[a-f0-9]+\s/i.test((m.content || '').trim()))
      );
      if (msgs.length > renderedMessageCount) {
        const newMsgs = msgs.slice(renderedMessageCount);
        newMsgs.forEach(msg => addMessage(msg.content, msg.role, msg.timestamp));
      }
    } catch { /* ignore */ }
  }, 5000);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Toast Notification System
const toastIcons = {
  success: 'fa-check-circle',
  error: 'fa-exclamation-circle',
  info: 'fa-info-circle',
  warning: 'fa-exclamation-triangle'
};

function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = toastIcons[type] || toastIcons.info;

  toast.innerHTML = `
    <i class="fas ${icon} toast-icon"></i>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" title="Dismiss">
      <i class="fas fa-times"></i>
    </button>
  `;

  container.appendChild(toast);

  // Close button handler
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => dismissToast(toast));

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }

  return toast;
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('hiding')) return;
  toast.classList.add('hiding');
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 200);
}

function clearToasts() {
  const container = document.getElementById('toastContainer');
  if (container) {
    container.innerHTML = '';
  }
}

// Kanban Modal State
let editingCard = null;

// Modal button handlers
document.getElementById('saveCard').addEventListener('click', saveCard);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('cancelCard').addEventListener('click', closeModal);

// Close modal on overlay click
document.getElementById('cardModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('cardModal')) closeModal();
});

// WYSIWYG toolbar
document.querySelectorAll('.wysiwyg-toolbar button[data-cmd]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const editor = document.getElementById('cardEditor');
    editor.focus();
    const cmd = btn.dataset.cmd;

    if (cmd === 'checkbox') {
      // Insert a markdown checkbox line the user can type into
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        // If cursor is at end of a non-empty block, insert a new div after
        const block = range.startContainer.nodeType === 3
          ? range.startContainer.parentElement.closest('div, p, li') || range.startContainer.parentElement
          : range.startContainer;
        const newDiv = document.createElement('div');
        newDiv.textContent = '- [ ] ';
        // Place after current block, or append
        if (block && block !== editor && block.parentNode === editor) {
          block.after(newDiv);
        } else {
          editor.appendChild(newDiv);
        }
        // Move cursor to end of new line
        const newRange = document.createRange();
        newRange.setStart(newDiv.firstChild, newDiv.textContent.length);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
      } else {
        document.execCommand('insertHTML', false, '<div>- [ ] </div>');
      }
    } else {
      document.execCommand(cmd, false, null);
    }
  });
});

// Prevent # and ## at line starts in the editor
document.getElementById('cardEditor').addEventListener('input', () => {
  const editor = document.getElementById('cardEditor');
  // Strip heading markers from text nodes at start of blocks
  editor.querySelectorAll('h1, h2, h3').forEach(h => {
    const p = document.createElement('p');
    p.innerHTML = h.innerHTML;
    h.replaceWith(p);
  });
});

// Convert editor HTML to markdown
function htmlToMarkdown(el) {
  let md = '';
  el.childNodes.forEach(node => {
    if (node.nodeType === 3) {
      md += node.textContent;
    } else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') {
        md += '\n';
      } else if (tag === 'div' || tag === 'p') {
        const inner = htmlToMarkdown(node).trim();
        if (inner) md += '\n' + inner;
      } else if (tag === 'strong' || tag === 'b') {
        md += '**' + htmlToMarkdown(node) + '**';
      } else if (tag === 'em' || tag === 'i') {
        md += '*' + htmlToMarkdown(node) + '*';
      } else if (tag === 'ul' || tag === 'ol') {
        node.querySelectorAll(':scope > li').forEach(li => {
          const cb = li.querySelector(':scope > input[type="checkbox"]');
          if (cb) {
            const text = Array.from(li.childNodes).filter(n => n !== cb && !(n.nodeName === 'UL' || n.nodeName === 'OL')).map(n => n.textContent).join('').replace(/\u00a0/g, '').trim();
            md += '\n- [' + (cb.checked ? 'x' : ' ') + '] ' + text;
            const nested = li.querySelector(':scope > ul, :scope > ol');
            if (nested) md += htmlToMarkdown(nested);
          } else {
            md += '\n- ' + htmlToMarkdown(li).trim();
          }
        });
      } else if (tag === 'input' && node.type === 'checkbox') {
        // skip — checkboxes in editor are plain text now
      } else {
        md += htmlToMarkdown(node);
      }
    }
  });
  return md;
}

// Convert markdown to editor HTML — checkboxes stay as plain text so they're editable
function markdownToEditorHtml(md) {
  if (!md) return '';
  return md.split('\n').map(line => {
    // Keep checkbox lines as plain editable text (- [ ] text or - [x] text)
    if (/^\s*- \[([ xX])\]/.test(line)) {
      return `<div>${escapeHtml(line)}</div>`;
    }
    const inlineHtml = marked.parseInline(line);
    return `<div>${inlineHtml || '<br>'}</div>`;
  }).join('');
}

// Open modal for editing card
function openCardModal(laneId, cardId) {
  const lane = currentKanban.lanes.find(l => l.id === laneId);
  const card = migrateCard(lane.cards.find(c => c.id === cardId));

  editingCard = { laneId, cardId };

  document.getElementById('cardTitle').value = card.title || '';
  document.getElementById('modalTitle').textContent = card.title || 'Card';
  document.getElementById('cardEditor').innerHTML = markdownToEditorHtml(card.body || '');

  document.getElementById('cardModal').classList.remove('hidden');
}

function openNewCardModal(laneId) {
  editingCard = { laneId, cardId: null };

  document.getElementById('cardTitle').value = '';
  document.getElementById('modalTitle').textContent = 'New Card';
  document.getElementById('cardEditor').innerHTML = '';

  document.getElementById('cardModal').classList.remove('hidden');
  document.getElementById('cardTitle').focus();
}

function saveCard() {
  const title = document.getElementById('cardTitle').value || 'Untitled';
  const editor = document.getElementById('cardEditor');
  // Sanitize: strip any # or ## at start of lines
  let body = htmlToMarkdown(editor).trim();
  body = body.replace(/^#{1,2}\s/gm, '');

  const lane = currentKanban.lanes.find(l => l.id === editingCard.laneId);
  if (!lane) return;

  if (editingCard.cardId) {
    const card = lane.cards.find(c => c.id === editingCard.cardId);
    if (card) {
      card.title = title;
      card.body = body;
    }
  } else {
    lane.cards.push({
      id: Date.now().toString(),
      title,
      body,
    });
  }

  saveKanban();
  renderKanban();
  closeModal();
}

function closeModal() {
  document.getElementById('cardModal').classList.add('hidden');
  editingCard = null;
}

// --- Sidebar collapse & resize ---

const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarResize = document.getElementById('sidebarResize');
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 256;
let sidebarWidth = parseInt(localStorage.getItem('sidebarWidth')) || SIDEBAR_DEFAULT;
let sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

function applySidebarState() {
  if (sidebarCollapsed) {
    sidebar.classList.add('collapsed');
    sidebar.style.width = '';
    sidebarToggle.innerHTML = '<i class="fas fa-chevron-right"></i>';
  } else {
    sidebar.classList.remove('collapsed');
    sidebar.style.width = sidebarWidth + 'px';
    sidebarToggle.innerHTML = '<i class="fas fa-chevron-left"></i>';
  }
}

applySidebarState();

sidebarToggle.addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed;
  localStorage.setItem('sidebarCollapsed', sidebarCollapsed);
  applySidebarState();
});

// Collapsed icons — switch view and expand
document.querySelectorAll('.sidebar-collapsed-icons button').forEach(btn => {
  btn.addEventListener('click', () => {
    sidebarCollapsed = false;
    localStorage.setItem('sidebarCollapsed', 'false');
    applySidebarState();
    switchView(btn.dataset.view);
  });
});

// Update collapsed icon active states
const origSwitchView = switchView;
switchView = function(view) {
  origSwitchView(view);
  document.querySelectorAll('.sidebar-collapsed-icons button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
};

// Drag to resize
let resizing = false;
sidebarResize.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizing = true;
  sidebarResize.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  let w = e.clientX;
  if (w < SIDEBAR_MIN) w = SIDEBAR_MIN;
  if (w > SIDEBAR_MAX) w = SIDEBAR_MAX;
  sidebarWidth = w;
  sidebar.style.width = w + 'px';
});

document.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  sidebarResize.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  localStorage.setItem('sidebarWidth', sidebarWidth);
});
