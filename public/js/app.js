// Get token from URL
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

if (!token) {
  document.body.innerHTML = '<div class="flex items-center justify-center h-screen"><div class="text-center"><h1 class="text-2xl font-bold text-red-600">Token Required</h1><p class="text-gray-600 mt-2">Please provide a valid token in the URL.</p></div></div>';
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
  
  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  
  // Show/hide views
  document.getElementById('chatView').classList.toggle('hidden', view !== 'chat');
  document.getElementById('vaultView').classList.toggle('hidden', view !== 'vault');
  document.getElementById('kanbanView').classList.toggle('hidden', view !== 'kanban');
  
  // Load data for view
  if (view === 'vault') loadVault();
  if (view === 'kanban') loadKanban();
}

// Chat functionality
socket.on('connect', () => {
  console.log('Connected to server');
  loadClientInfo();
});

socket.on('chat:message', (data) => {
  addMessage(data.content, data.role);
});

socket.on('typing', (data) => {
  showTypingIndicator(data.typing);
});

function showTypingIndicator(show) {
  const existing = document.getElementById('typing-indicator');
  
  if (show && !existing) {
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
        <span class="text-sm">Agent is typing...</span>
      </div>
      <style>
        .typing-dots {
          display: flex;
          gap: 4px;
          animation: typing 1.4s infinite;
        }
        .dot {
          animation: blink 1.4s infinite;
          animation-fill-mode: both;
        }
        .dot:nth-child(2) {
          animation-delay: 0.2s;
        }
        .dot:nth-child(3) {
          animation-delay: 0.4s;
        }
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }
        @keyframes typing {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      </style>
    `;
    messagesDiv.appendChild(typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  } else if (!show && existing) {
    existing.remove();
  }
}

function addMessage(content, role) {
  // Remove typing indicator if present
  showTypingIndicator(false);
  
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;
  
  // Render markdown for assistant messages
  if (role === 'assistant' && typeof marked !== 'undefined') {
    msgDiv.innerHTML = marked.parse(content);
  } else {
    msgDiv.textContent = content;
  }
  
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

function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;
  
  addMessage(message, 'user');
  socket.emit('chat:message', { message });
  messageInput.value = '';
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
async function loadVault() {
  try {
    const res = await fetch(`/api/vault?token=${token}`);
    const data = await res.json();
    
    // Filter only relevant files (md, images, videos)
    vaultFiles = (data.files || []).filter(f => {
      const ext = f.path.split('.').pop().toLowerCase();
      return ['md', 'markdown', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(ext);
    });
    
    renderVaultTree();
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
    
    const item = document.createElement('div');
    item.className = isFile ? 'vault-item file' : 'vault-item folder';
    
    if (isFile) {
      const ext = key.split('.').pop().toLowerCase();
      const icon = getFileIcon(ext);
      const cleanName = key.replace(/\.(md|markdown)$/, '');
      item.innerHTML = `
        <i class="fas ${icon} mr-2 text-sm" style="color: var(--accent-primary);"></i>
        <span class="text-sm">${cleanName}</span>
      `;
      item.addEventListener('click', () => loadFile(value.__file));
    } else {
      item.innerHTML = `
        <i class="fas fa-folder mr-2 text-sm" style="color: var(--accent-primary);"></i>
        <span class="text-sm font-medium">${key}</span>
        <i class="fas fa-chevron-down ml-auto text-xs"></i>
      `;
      
      const childContainer = document.createElement('div');
      childContainer.className = 'hidden';
      item.appendChild(childContainer);
      
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        childContainer.classList.toggle('hidden');
        const chevron = item.querySelector('.fa-chevron-down');
        chevron.classList.toggle('rotate-180');
      });
      
      renderTreeNode(value, childContainer, level + 1);
    }
    
    container.appendChild(item);
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

async function loadFile(file) {
  try {
    const res = await fetch(`/api/vault/file?token=${token}&path=${file.path}`);
    const content = await res.text();
    
    const ext = file.path.split('.').pop().toLowerCase();
    const cleanName = file.path.split('/').pop().replace(/\.(md|markdown)$/, '');
    
    vaultFileName.textContent = cleanName;
    
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
    const ext = file.path.split('.').pop().toLowerCase();
    item.innerHTML = `
      <i class="fas ${getFileIcon(ext)} mr-2 text-sm" style="color: var(--accent-primary);"></i>
      <span class="text-sm">${file.path}</span>
    `;
    item.addEventListener('click', () => loadFile(file));
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
async function loadKanban() {
  try {
    const res = await fetch(`/api/kanban?token=${token}`);
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
    title: 'Personal Kanban',
    lanes: [
      { id: 'todo', title: 'To Do', cards: [] },
      { id: 'progress', title: 'In Progress', cards: [] },
      { id: 'done', title: 'Done', cards: [] }
    ]
  };
}

function renderKanban() {
  kanbanBoard.innerHTML = '';
  
  currentKanban.lanes.forEach(lane => {
    const column = document.createElement('div');
    column.className = 'kanban-column flex-1 min-w-64 rounded-lg p-4';
    column.dataset.laneId = lane.id;
    
    column.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold">${lane.title}</h3>
        <button class="add-card-btn text-sm px-2 py-1 rounded hover:bg-white" style="color: var(--accent-primary);">
          <i class="fas fa-plus"></i>
        </button>
      </div>
      <div class="cards-container space-y-2 min-h-96 drop-zone" data-lane-id="${lane.id}">
        ${lane.cards.map((card, index) => `
          <div class="kanban-card" draggable="true" data-card-index="${index}" data-card-id="${card.id}">
            <div class="flex items-start justify-between">
              <div class="text-sm flex-1 prose">${typeof marked !== 'undefined' ? marked.parse(card.content) : card.content}</div>
              <div class="flex gap-2 ml-2">
                <button class="edit-card-btn text-gray-400 hover:text-blue-600" data-card-id="${card.id}">
                  <i class="fas fa-edit text-xs"></i>
                </button>
                <button class="delete-card-btn text-gray-400 hover:text-red-600" data-card-id="${card.id}">
                  <i class="fas fa-trash text-xs"></i>
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    
    kanbanBoard.appendChild(column);
    
    // Add card button
    column.querySelector('.add-card-btn').addEventListener('click', () => {
      const content = prompt('Enter card content (markdown supported):');
      if (content) {
        addCard(lane.id, content);
      }
    });
    
    // Edit/delete buttons
    column.querySelectorAll('.edit-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = btn.dataset.cardId;
        editCard(lane.id, cardId);
      });
    });
    
    column.querySelectorAll('.delete-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = btn.dataset.cardId;
        deleteCard(lane.id, cardId);
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
  addLaneBtn.style.background = 'var(--bg-secondary)';
  addLaneBtn.style.color = 'var(--accent-primary)';
  addLaneBtn.innerHTML = '<i class="fas fa-plus mr-2"></i>Add Lane';
  addLaneBtn.addEventListener('click', addLane);
  kanbanBoard.appendChild(addLaneBtn);
}

function addCard(laneId, content) {
  const lane = currentKanban.lanes.find(l => l.id === laneId);
  if (lane) {
    lane.cards.push({ content, id: Date.now().toString() });
    saveKanban();
    renderKanban();
  }
}

function editCard(laneId, cardId) {
  const lane = currentKanban.lanes.find(l => l.id === laneId);
  if (lane) {
    const card = lane.cards.find(c => c.id === cardId);
    if (card) {
      const newContent = prompt('Edit card (markdown supported):', card.content);
      if (newContent !== null) {
        card.content = newContent;
        saveKanban();
        renderKanban();
      }
    }
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
    await fetch(`/api/kanban?token=${token}`, {
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
  alert('Authentication failed');
});
// Add to existing app.js after chat functionality

// Typing indicator
socket.on('typing', (data) => {
  if (data.typing) {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant typing-indicator';
    typingDiv.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    messagesDiv.appendChild(typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  } else {
    const typing = messagesDiv.querySelector('.typing-indicator');
    if (typing) typing.remove();
  }
});
// Load chat history on connect
async function loadChatHistory() {
  try {
    const res = await fetch(`/api/chat/history?token=${token}`);
    const data = await res.json();
    
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(msg => {
        addMessage(msg.content, msg.role, false);
      });
    }
  } catch (error) {
    console.error('Failed to load chat history:', error);
  }
}

// Call on connect
socket.on('connect', () => {
  console.log('Connected to server');
  loadClientInfo();
  loadChatHistory();
});

// Load chat history from OpenClaw session
socket.on('chat:history', (data) => {
  if (data.messages && data.messages.length > 0) {
    messagesDiv.innerHTML = ''; // Clear existing
    data.messages.forEach(msg => {
      addMessage(msg.content, msg.role, false);
    });
  }
});
