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
let pendingFiles = [];
let sessions = [];
let activeSessionKey = null;
let pendingVaultOpen = null;

// DOM Elements
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const vaultTree = document.getElementById('vaultTree');
const vaultContent = document.getElementById('vaultContent');
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
  sessions.forEach(session => {
    const isActive = session.key === activeSessionKey && currentView === 'chat';
    const div = document.createElement('div');
    div.className = `session-item ${isActive ? 'active' : ''}`;
    div.innerHTML = `
      <div class="session-name">${escapeHtml(session.label || 'Untitled')}</div>
      <div class="session-date">${formatSessionDate(session.updatedAt)}</div>
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

// Configure marked
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true,
    gfm: true
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

function switchView(view) {
  currentView = view;

  // Update nav tabs
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Show/hide main content views
  document.getElementById('chatView').classList.toggle('hidden', view !== 'chat');
  document.getElementById('vaultView').classList.toggle('hidden', view !== 'vault');
  document.getElementById('kanbanView').classList.toggle('hidden', view !== 'kanban');

  // Show/hide sidebar panels
  document.getElementById('sidebarChat').classList.toggle('hidden', view !== 'chat');
  document.getElementById('sidebarVault').classList.toggle('hidden', view !== 'vault');
  document.getElementById('sidebarKanban').classList.toggle('hidden', view !== 'kanban');

  // Update session list active highlight
  if (view === 'chat') renderSessionList();

  // Load data for view
  if (view === 'vault') loadVault();
  if (view === 'kanban') { loadKanbanList(); loadKanban(); }
}

// Connection status monitoring
let connectionStatus = 'connecting';
let typingTimeout = null;
const TYPING_TIMEOUT_MS = 95000; // slightly longer than server's 90s

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
  loadClientInfo();

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
  addMessage(data.content, data.role);
});

socket.on('typing', (data) => {
  showTypingIndicator(data.typing);
  if (data.typing) {
    // Safety net: if server never sends typing:false, auto-clear
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      showTypingIndicator(false);
      addMessage('The agent did not respond in time. Please try again.', 'assistant');
    }, TYPING_TIMEOUT_MS);
  } else {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
});

let typingElapsedTimer = null;

function showTypingIndicator(show) {
  const existing = document.getElementById('typing-indicator');

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
        <span class="text-sm">Agent is thinking...</span>
        <span class="typing-elapsed" id="typing-elapsed"></span>
      </div>
      <style>
        .typing-dots { display:flex; gap:4px; }
        .dot { animation:blink 1.4s infinite; animation-fill-mode:both; }
        .dot:nth-child(2) { animation-delay:0.2s; }
        .dot:nth-child(3) { animation-delay:0.4s; }
        @keyframes blink { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }
      </style>
    `;
    messagesDiv.appendChild(typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Show elapsed time after 5s
    typingElapsedTimer = setInterval(() => {
      const el = document.getElementById('typing-elapsed');
      if (!el) { clearInterval(typingElapsedTimer); return; }
      const secs = Math.floor((Date.now() - startTime) / 1000);
      if (secs >= 5) el.textContent = `${secs}s`;
    }, 1000);
  } else if (!show && existing) {
    clearInterval(typingElapsedTimer);
    existing.remove();
  }
}

function addMessage(content, role) {
  // Remove typing indicator if present
  showTypingIndicator(false);

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;

  const text = typeof content === 'string' ? content : (content.text || '');
  const files = (typeof content === 'object' ? content.files : []) || [];

  let html = '';
  if (role === 'assistant' && typeof marked !== 'undefined') {
    html = marked.parse(text);
  } else {
    html = escapeHtml(text);
  }

  // Replace /vault/... paths with clickable links in assistant messages
  if (role === 'assistant') {
    html = html.replace(/(?:\/vault\/)([\w\/\-_.]+)/g, (match, filePath) => {
      const name = filePath.split('/').pop().replace(/\.(md|markdown)$/, '');
      return `<a class="vault-link" data-vault-path="${escapeHtml(filePath)}" href="javascript:void(0)"><i class="fas fa-file-alt"></i>${escapeHtml(name)}</a>`;
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

    msgDiv.appendChild(actions);
  }

  // Wire up vault links to open preview popup
  msgDiv.querySelectorAll('.vault-link').forEach(link => {
    link.addEventListener('click', () => {
      openVaultPreview(link.dataset.vaultPath);
    });
  });

  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
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
    alert('Failed to upload file');
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
  addMessage(messageData, 'user');

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

// Client info
async function loadClientInfo() {
  try {
    const res = await fetch(`/api/client?token=${token}`);
    const data = await res.json();
    clientSlug = data.clientSlug;
    clientName.textContent = clientSlug.charAt(0).toUpperCase() + clientSlug.slice(1).replace(/-/g, ' ');
  } catch (error) {
    console.error('Failed to load client info:', error);
  }
}

// Vault functionality
let currentFile = null;

async function loadVault(autoOpenPath) {
  try {
    const res = await fetch(`/api/vault?token=${token}`);
    const data = await res.json();

    vaultFiles = (data.files || []).filter(f => {
      const ext = f.path.split('.').pop().toLowerCase();
      return ['md', 'markdown', 'txt', 'json', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(ext);
    });

    renderVaultTree();

    // Auto-open a file if requested (from deep link or pendingVaultOpen)
    const target = (autoOpenPath || pendingVaultOpen || '').replace(/^\/+/, '');
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

  // Fetch vault file list if not loaded
  if (vaultFiles.length === 0) {
    try {
      const res = await fetch(`/api/vault?token=${token}`);
      const data = await res.json();
      vaultFiles = (data.files || []).filter(f => {
        const ext = f.path.split('.').pop().toLowerCase();
        return ['md', 'markdown', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(ext);
      });
    } catch { /* ignore */ }
  }

  const file = vaultFiles.find(f =>
    f.path === target ||
    f.path === target + '.md' ||
    f.path === target + '.markdown' ||
    f.path.replace(/\.(md|markdown)$/, '') === target
  );
  if (!file) {
    alert('File not found: ' + filePath);
    return;
  }

  try {
    const res = await fetch(`/api/vault/file?token=${token}&path=${file.path}`);
    const content = await res.text();
    const ext = file.path.split('.').pop().toLowerCase();
    const cleanName = file.path.split('/').pop().replace(/\.(md|markdown)$/, '');
    const fileUrl = `/api/vault/file?token=${token}&path=${file.path}`;

    // Build modal
    const overlay = document.createElement('div');
    overlay.className = 'vault-modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    let bodyHtml = '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      bodyHtml = `<img src="${fileUrl}" alt="${escapeHtml(cleanName)}" style="max-width:100%;border-radius:8px;">`;
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      bodyHtml = `<video src="${fileUrl}" controls style="max-width:100%;border-radius:8px;"></video>`;
    } else if (typeof marked !== 'undefined') {
      bodyHtml = `<div class="prose max-w-none">${marked.parse(content)}</div>`;
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

    // Close on Escape
    function onKey(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);

  } catch (error) {
    console.error('Failed to preview vault file:', error);
  }
}

async function loadFile(file) {
  try {
    const res = await fetch(`/api/vault/file?token=${token}&path=${file.path}`);
    const content = await res.text();

    const ext = file.path.split('.').pop().toLowerCase();
    const cleanName = file.path.split('/').pop().replace(/\.(md|markdown)$/, '');

    vaultFileName.textContent = cleanName;

    currentFile = file;

    // Update active state
    document.querySelectorAll('.vault-item.file').forEach(el => {
      el.classList.toggle('active', el.dataset.filePath === file.path);
    });

    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      const imagePath = `/api/vault/file?token=${token}&path=${file.path}`;
      vaultContent.innerHTML = `<img src="${imagePath}" alt="${cleanName}" class="max-w-full rounded-lg">`;
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      const videoPath = `/api/vault/file?token=${token}&path=${file.path}`;
      vaultContent.innerHTML = `<video src="${videoPath}" controls class="max-w-full rounded-lg"></video>`;
    } else {
      // Markdown
      if (typeof marked !== 'undefined') {
        vaultContent.innerHTML = `<div class="prose max-w-none">${marked.parse(content)}</div>`;
      } else {
        vaultContent.innerHTML = `<pre>${content}</pre>`;
      }
    }
  } catch (error) {
    console.error('Failed to load file:', error);
    vaultContent.innerHTML = '<p class="text-red-600">Failed to load file</p>';
  }
}

// Search
vaultSearch.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();

  if (!query) {
    renderVaultTree();
    return;
  }

  const filtered = vaultFiles.filter(f =>
    f.path.toLowerCase().includes(query)
  );

  vaultTree.innerHTML = '';
  filtered.forEach(file => {
    const item = document.createElement('div');
    item.className = 'vault-item file';

    // Add active class for current file
    if (currentFile && currentFile.path === file.path) {
      item.classList.add('active');
    }

    const ext = file.path.split('.').pop().toLowerCase();
    item.innerHTML = `
      <i class="fas ${getFileIcon(ext)}" style="color: var(--accent-light); font-size: 14px;"></i>
      <span class="text-sm">${file.path}</span>
    `;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      loadFile(file);
    });
    vaultTree.appendChild(item);
  });
});

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
      const res = await fetch(`/api/vault/upload?token=${token}`, {
        method: 'POST',
        body: formData
      });
      
      if (res.ok) {
        alert('File uploaded successfully!');
        loadVault();
      } else {
        alert('Upload failed');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed');
    }
  };
  
  input.click();
});

// Kanban functionality
let kanbanBoards = [];
let currentKanbanFile = 'kanban.md';

async function loadKanbanList() {
  try {
    const res = await fetch(`/api/kanban/list?token=${token}`);
    const data = await res.json();
    kanbanBoards = data.boards || [];
    renderKanbanList();
  } catch (error) {
    console.error('Failed to load kanban list:', error);
  }
}

function renderKanbanList() {
  const list = document.getElementById('kanbanList');
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
      if (kanbanBoards.length <= 1) { alert('Cannot delete the last board.'); return; }
      if (!confirm(`Delete "${board.title}"?`)) return;
      deleteKanbanBoard(board.file);
    });
    list.appendChild(div);
  });
}

async function renameKanbanBoard(file, newTitle) {
  try {
    const res = await fetch(`/api/kanban?token=${token}&file=${encodeURIComponent(file)}`);
    const data = await res.json();
    const kanban = data.kanban || getDefaultKanban();
    kanban.title = newTitle;
    await fetch(`/api/kanban?token=${token}&file=${encodeURIComponent(file)}`, {
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
    await fetch(`/api/kanban?token=${token}&file=${encodeURIComponent(file)}`, { method: 'DELETE' });
    if (currentKanbanFile === file) {
      currentKanbanFile = 'kanban.md';
    }
    await loadKanbanList();
    await loadKanban();
  } catch (error) {
    console.error('Failed to delete kanban:', error);
  }
}

document.getElementById('newKanbanBtn').addEventListener('click', async () => {
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
  await fetch(`/api/kanban?token=${token}&file=${encodeURIComponent(file)}`, {
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
    const res = await fetch(`/api/kanban?token=${token}&file=${encodeURIComponent(currentKanbanFile)}`);
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

function renderCardContent(card) {
  const migrated = migrateCard(card);
  let html = '';

  if (migrated.title) {
    html += `<div class="card-title">${escapeHtml(migrated.title)}</div>`;
  }

  if (migrated.items && migrated.items.length > 0) {
    html += '<div class="card-body">';
    migrated.items.forEach((item, idx) => {
      if (item.type === 'section') {
        html += `<div class="card-section">${escapeHtml(item.content)}</div>`;
      } else if (item.type === 'bullet') {
        html += `<div class="card-bullet"><span>${escapeHtml(item.content)}</span></div>`;
      } else if (item.type === 'checkbox') {
        const checkedClass = item.checked ? 'checked' : '';
        const checkedAttr = item.checked ? 'checked' : '';
        html += `<div class="card-checkbox ${checkedClass}">
          <input type="checkbox" ${checkedAttr} data-item-index="${idx}">
          <span>${escapeHtml(item.content)}</span>
        </div>`;
      }
    });
    html += '</div>';
  }

  return html;
}

function renderKanban() {
  kanbanBoard.innerHTML = '';

  currentKanban.lanes.forEach(lane => {
    const column = document.createElement('div');
    column.className = 'kanban-column flex-1 min-w-64 rounded-lg p-4';
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
      <div class="cards-container space-y-2 drop-zone" data-lane-id="${lane.id}" style="min-height: 80px;">
        ${cardsHtml}
      </div>
    `;

    kanbanBoard.appendChild(column);

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

    // Checkbox toggle on cards
    column.querySelectorAll('.card-checkbox input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const cardEl = cb.closest('.kanban-card');
        const cardId = cardEl.dataset.cardId;
        const laneId = cardEl.dataset.laneId;
        const itemIndex = parseInt(cb.dataset.itemIndex);
        const cardLane = currentKanban.lanes.find(l => l.id === laneId);
        const card = cardLane.cards.find(c => c.id === cardId);
        const migrated = migrateCard(card);
        if (migrated.items[itemIndex]) {
          migrated.items[itemIndex].checked = cb.checked;
          card.items = migrated.items;
          saveKanban();
          renderKanban();
        }
      });
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
  document.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('cardIndex', card.dataset.cardIndex);
      e.dataTransfer.setData('sourceLaneId', card.closest('.cards-container').dataset.laneId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  // Add lane button
  const addLaneBtn = document.createElement('button');
  addLaneBtn.className = 'px-6 py-3 rounded-lg font-medium min-w-64';
  addLaneBtn.style.cssText = 'background:var(--bg-secondary);color:var(--accent-light);border:2px dashed var(--border-light);cursor:pointer;transition:all 0.15s;';
  addLaneBtn.innerHTML = '<i class="fas fa-plus mr-2"></i>Add Lane';
  addLaneBtn.addEventListener('click', addLane);
  kanbanBoard.appendChild(addLaneBtn);
}

function addCard(laneId, title) {
  const lane = currentKanban.lanes.find(l => l.id === laneId);
  if (lane) {
    lane.cards.push({ title, id: Date.now().toString(), items: [] });
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
    await fetch(`/api/kanban?token=${token}&file=${encodeURIComponent(currentKanbanFile)}`, {
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
    renderSessionList();
  }
  messagesDiv.innerHTML = '';
  if (data.messages && data.messages.length > 0) {
    data.messages.forEach(msg => {
      addMessage(msg.content, msg.role);
    });
  }
});

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

// Kanban Modal State
let editingCard = null;
let currentCardItems = [];
let currentCardTitle = '';
let modalTab = 'preview';

// Modal button handlers
document.getElementById('addSection').addEventListener('click', () => addItem('section'));
document.getElementById('addBullet').addEventListener('click', () => addItem('bullet'));
document.getElementById('addCheckbox').addEventListener('click', () => addItem('checkbox'));
document.getElementById('saveCard').addEventListener('click', saveCard);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('cancelCard').addEventListener('click', closeModal);

// Tab switching
document.getElementById('tabPreview').addEventListener('click', () => switchModalTab('preview'));
document.getElementById('tabEdit').addEventListener('click', () => switchModalTab('edit'));

function switchModalTab(tab) {
  modalTab = tab;
  document.getElementById('tabPreview').classList.toggle('active', tab === 'preview');
  document.getElementById('tabEdit').classList.toggle('active', tab === 'edit');
  document.getElementById('cardPreviewPane').classList.toggle('hidden', tab !== 'preview');
  document.getElementById('cardEditPane').classList.toggle('hidden', tab !== 'edit');

  if (tab === 'preview') {
    // Sync title from edit input
    const titleInput = document.getElementById('cardTitle');
    if (titleInput) currentCardTitle = titleInput.value;
    renderCardPreview();
  }
}

function renderCardPreview() {
  const container = document.getElementById('cardPreviewPane');
  let html = '';

  if (currentCardTitle) {
    html += `<div class="preview-title">${escapeHtml(currentCardTitle)}</div>`;
  }

  if (currentCardItems.length === 0 && !currentCardTitle) {
    html += '<div class="preview-empty">This card is empty. Switch to Edit to add content.</div>';
  }

  currentCardItems.forEach(item => {
    if (item.type === 'section') {
      html += `<div class="preview-section">${escapeHtml(item.content)}</div>`;
    } else if (item.type === 'bullet') {
      html += `<div class="preview-bullet"><span>${escapeHtml(item.content)}</span></div>`;
    } else if (item.type === 'checkbox') {
      const checkedClass = item.checked ? 'checked' : '';
      const checkedAttr = item.checked ? 'checked' : '';
      html += `<div class="preview-checkbox ${checkedClass}">
        <input type="checkbox" ${checkedAttr} disabled>
        <span>${escapeHtml(item.content)}</span>
      </div>`;
    }
  });

  container.innerHTML = html;
}

// Open modal for editing card
function openCardModal(laneId, cardId) {
  const lane = currentKanban.lanes.find(l => l.id === laneId);
  const card = lane.cards.find(c => c.id === cardId);

  const migratedCard = migrateCard(card);

  editingCard = { laneId, cardId };
  currentCardItems = JSON.parse(JSON.stringify(migratedCard.items || []));
  currentCardTitle = migratedCard.title || '';

  document.getElementById('cardTitle').value = currentCardTitle;
  document.getElementById('modalTitle').textContent = currentCardTitle || 'Card';

  // Start on preview tab
  switchModalTab('preview');
  renderCardItems();

  document.getElementById('cardModal').classList.remove('hidden');
}

// Close modal on overlay click
document.getElementById('cardModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('cardModal')) closeModal();
});

// Migrate old card format to new structure
function migrateCard(card) {
  if (card.content && !card.items) {
    return {
      id: card.id,
      title: card.content.split('\n')[0] || 'Card',
      items: []
    };
  }
  return card;
}

// Render items in modal editor
function renderCardItems() {
  const container = document.getElementById('cardItems');
  container.innerHTML = '';

  currentCardItems.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'card-item';

    const iconMap = { 'section': 'fa-heading', 'bullet': 'fa-circle', 'checkbox': 'fa-check-square' };
    const iconClass = iconMap[item.type] || 'fa-circle';

    div.innerHTML = `
      <div class="item-actions">
        <button class="move-up" ${index === 0 ? 'disabled' : ''} title="Move up">
          <i class="fas fa-chevron-up"></i>
        </button>
        <button class="move-down" ${index === currentCardItems.length - 1 ? 'disabled' : ''} title="Move down">
          <i class="fas fa-chevron-down"></i>
        </button>
      </div>
      <i class="fas ${iconClass} item-type-icon"></i>
      <input type="text" class="item-content" value="${escapeHtml(item.content)}" placeholder="Type here...">
      <div class="item-actions">
        <button class="delete" title="Delete">
          <i class="fas fa-trash" style="color:#dc2626;"></i>
        </button>
      </div>
    `;

    const upBtn = div.querySelector('.move-up');
    const downBtn = div.querySelector('.move-down');
    const input = div.querySelector('.item-content');
    const deleteBtn = div.querySelector('.delete');

    upBtn.addEventListener('click', () => moveItem(index, -1));
    downBtn.addEventListener('click', () => moveItem(index, 1));
    input.addEventListener('input', (e) => {
      currentCardItems[index].content = e.target.value;
    });
    deleteBtn.addEventListener('click', () => deleteItem(index));

    container.appendChild(div);
  });
}

// Add new item
function addItem(type) {
  currentCardItems.push({
    id: Date.now().toString(),
    type: type,
    content: '',
    checked: type === 'checkbox' ? false : undefined
  });
  renderCardItems();

  // Focus the new input
  setTimeout(() => {
    const inputs = document.querySelectorAll('#cardItems .item-content');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 50);
}

// Move item
function moveItem(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= currentCardItems.length) return;

  const [item] = currentCardItems.splice(index, 1);
  currentCardItems.splice(newIndex, 0, item);
  renderCardItems();
}

// Delete item
function deleteItem(index) {
  currentCardItems.splice(index, 1);
  renderCardItems();
}

// Save card
function openNewCardModal(laneId) {
  editingCard = { laneId, cardId: null }; // null cardId = new card
  currentCardItems = [];
  currentCardTitle = '';

  document.getElementById('cardTitle').value = '';
  document.getElementById('modalTitle').textContent = 'New Card';

  switchModalTab('edit');
  renderCardItems();

  document.getElementById('cardModal').classList.remove('hidden');
}

function saveCard() {
  const title = document.getElementById('cardTitle').value || 'Untitled';

  const lane = currentKanban.lanes.find(l => l.id === editingCard.laneId);
  if (!lane) return;

  if (editingCard.cardId) {
    // Edit existing card
    const card = lane.cards.find(c => c.id === editingCard.cardId);
    if (card) {
      card.title = title;
      card.items = currentCardItems;
      delete card.content;
    }
  } else {
    // New card
    lane.cards.push({
      id: Date.now().toString(),
      title,
      items: currentCardItems,
    });
  }

  saveKanban();
  renderKanban();
  closeModal();
}

// Close modal
function closeModal() {
  document.getElementById('cardModal').classList.add('hidden');
  editingCard = null;
  currentCardItems = [];
  currentCardTitle = '';
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
