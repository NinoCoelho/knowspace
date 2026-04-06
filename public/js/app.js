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

// Configure marked
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true,
    gfm: true
  });
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

function switchView(view) {
  currentView = view;

  // Update nav tabs
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Show/hide main content views
  document.getElementById('chatView').classList.toggle('hidden', view !== 'chat');
  document.getElementById('vaultView').classList.toggle('hidden', view !== 'vault');

  // Show/hide sidebar panels
  document.getElementById('sidebarChat').classList.toggle('hidden', view !== 'chat');
  document.getElementById('sidebarVault').classList.toggle('hidden', view !== 'vault');

  // Update session list active highlight
  if (view === 'chat') {
    renderSessionList();
    // If no session is active yet but sessions are loaded, select the first one
    const portalSessions = sessions.filter(s => !s.isSubagent);
    if (!activeSessionKey && portalSessions.length > 0) {
      socket.emit('sessions:switch', { sessionKey: portalSessions[0].key });
    } else {
      // Re-check agent status and scroll to bottom
      socket.emit('agent:status');
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }

  // Load data for view
  if (view === 'vault') loadVault();
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

  // Replace /vault/... paths with clickable links in assistant messages
  if (role === 'assistant' && approvals.length === 0) {
    html = html.replace(/(?:\/?)vault\/([\w\/\-_.]+)/g, (match, filePath) => {
      // Skip directory paths (ending with /)
      if (filePath.endsWith('/')) return match;
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
    try { await fetchVaultFiles(); } catch { /* ignore */ }
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
    } catch { /* ignore */ }
  }

  if (!file) {
    alert('File not found: ' + filePath);
    return;
  }

  try {
    const res = await fetch(`/api/vault/file?token=${token}${asParam()}&path=${file.path}`);
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
      vaultContent.innerHTML = `<img src="${imagePath}" alt="${cleanName}" class="max-w-full rounded-lg">`;
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      const videoPath = `/api/vault/file?token=${token}${asParam()}&path=${file.path}`;
      vaultContent.innerHTML = `<video src="${videoPath}" controls class="max-w-full rounded-lg"></video>`;
    } else {
      // Markdown
      if (typeof marked !== 'undefined') {
        vaultContent.innerHTML = `<div class="prose max-w-none">${marked.parse(content)}</div>`;
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
          enableInteractiveCheckboxes(vaultContent, onVaultCheckboxToggle);
          addCopyButtons(vaultContent);
          wireVaultInternalLinks(vaultContent, file.path);
          fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(file.path)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: vaultRawContent })
          });
        }
        enableInteractiveCheckboxes(vaultContent, onVaultCheckboxToggle);
        addCopyButtons(vaultContent);
        wireVaultInternalLinks(vaultContent, file.path);
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
      const res = await fetch(`/api/vault/upload?token=${token}${asParam()}`, {
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

document.getElementById('vaultEditBtn').addEventListener('click', async () => {
  if (!currentFile) return;
  const ext = currentFile.path.split('.').pop().toLowerCase();
  if (!['md', 'markdown', 'txt', 'json', 'csv'].includes(ext)) return;

  if (vaultEditing) {
    // Save
    const textarea = document.querySelector('.vault-editor');
    if (textarea) {
      await fetch(`/api/vault/file?token=${token}${asParam()}&path=${encodeURIComponent(currentFile.path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: textarea.value })
      });
    }
    vaultEditing = false;
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
          vaultContent.innerHTML = `<div class="prose max-w-none">${marked.parse(content)}</div>`;
          wireVaultInternalLinks(vaultContent, currentFile.path);
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
    alert('Could not read file.');
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
    alert('Could not save kanban.');
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
      alert('Move failed: ' + (err.error || 'Unknown error'));
      return;
    }
    currentFile = null;
    document.getElementById('vaultFileName').textContent = 'Select a file';
    document.getElementById('vaultContent').innerHTML = '';
    document.getElementById('vaultActions').style.display = 'none';
    loadVault();
  } catch (e) {
    alert('Move failed.');
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
      if (kanbanBoards.length <= 1) { alert('Cannot delete the last board.'); return; }
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
