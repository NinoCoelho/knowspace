const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const AuthManager = require('./middleware/auth');
const apiRoutes = require('./routes/api');
const { gatewayRpc } = require('./lib/gateway');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const authManager = new AuthManager();

// Configure multer for temp chat file uploads
const tempStorage = multer.diskStorage({
  destination: (req, res, cb) => {
    const clientSlug = req.clientSlug;
    // Create temp directory with unique message ID
    const messageId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    const tempPath = path.join('/tmp', `chat-${clientSlug}-${messageId}`);

    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, { recursive: true });
    }

    // Store message ID for cleanup
    req.messageId = messageId;
    req.tempPath = tempPath;

    cb(null, tempPath);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const tempUpload = multer({
  storage: tempStorage,
  fileFilter: (req, file, cb) => {
    // Accept all file types for temp uploads
    cb(null, true);
  }
});

// Cleanup function for temp files
function cleanupTempFiles(messageId) {
  const tempPath = `/tmp/chat-${messageId}`;
  setTimeout(() => {
    try {
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }, 5 * 60 * 1000); // Cleanup after 5 minutes
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Gateway helpers for chat history and sessions

function extractMessageText(message) {
  if (!message || !message.content) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
  }
  return '';
}

function normalizeMessages(messages) {
  return (messages || [])
    .filter(m => (m.role === 'user' || m.role === 'assistant'))
    .map(m => {
      let text = extractMessageText(m);
      // Remove timestamp prefix from user messages
      if (m.role === 'user') {
        text = text.replace(/^\[[\w\s:-]+\]\s*/, '');
      }
      return { role: m.role, content: text, timestamp: m.timestamp };
    })
    .filter(m => m.content);
}

async function loadGatewayHistory(sessionKey, limit = 50) {
  try {
    const result = await gatewayRpc('chat.history', { sessionKey, limit });
    return normalizeMessages(result.messages);
  } catch (error) {
    console.error('Error loading gateway history:', error.message);
    return [];
  }
}

async function listClientSessions(clientSlug, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await gatewayRpc('sessions.list', {
        limit: 50,
        includeLastMessage: true,
        includeDerivedTitles: true,
      });
      const prefix = `agent:${clientSlug}:`;
      return (result.sessions || [])
        .filter(s => s.key && s.key.startsWith(prefix))
        .map(s => ({
          key: s.key,
          label: s.label || s.derivedTitle || s.title || s.key.split(':').pop(),
          updatedAt: s.updatedAt,
          totalTokens: s.totalTokens,
        }));
    } catch (error) {
      if (attempt < retries) {
        console.log(`[gateway] Retrying sessions.list (attempt ${attempt + 2})...`);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.error('Error listing sessions:', error.message);
        return [];
      }
    }
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const clientSlug = req.clientSlug;
    const uploadPath = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault', 'uploads');
    
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.md', '.markdown', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Token authentication route - validates token in URL and sets cookie
app.get('/auth', (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.status(400).send('Token required');
  }

  const clientSlug = authManager.validateToken(token);

  if (!clientSlug) {
    return res.status(403).send('Invalid token');
  }

  // Set secure httpOnly cookie
  res.cookie('auth_token', token, {
    httpOnly: false, // Allow JavaScript to access for Socket.IO
    secure: true, // Served over HTTPS via Tailscale
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    sameSite: 'lax'
  });

  // Redirect to home page without token in URL
  res.redirect('/');
});

// Logout route - clears the cookie
app.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/');
});

// Client info endpoint
app.get('/api/client', (req, res) => {
  const token = req.query.token || req.cookies.auth_token;
  const clientSlug = authManager.validateToken(token);

  if (!clientSlug) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  res.json({ clientSlug });
});

// Chat history endpoint
app.get('/api/chat/history', async (req, res) => {
  const token = req.query.token || req.cookies.auth_token;
  const clientSlug = authManager.validateToken(token);

  if (!clientSlug) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  const sessionKey = req.query.sessionKey || `agent:${clientSlug}:main`;
  const history = await loadGatewayHistory(sessionKey);
  res.json({ messages: history });
});

// API Routes with token auth
app.use('/api', (req, res, next) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '') || req.cookies.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  const clientSlug = authManager.validateToken(token);

  if (!clientSlug) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  req.clientSlug = clientSlug;
  next();
}, apiRoutes);

// File upload
app.post('/api/vault/upload', (req, res, next) => {
  const token = req.query.token || req.cookies.auth_token;
  const clientSlug = authManager.validateToken(token);

  if (!clientSlug) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  req.clientSlug = clientSlug;
  next();
}, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  res.json({
    success: true,
    path: `uploads/${req.file.filename}`
  });
});

// Temp file upload for chat
app.post('/api/chat/upload', (req, res, next) => {
  const token = req.query.token || req.cookies.auth_token;
  const clientSlug = authManager.validateToken(token);

  if (!clientSlug) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  req.clientSlug = clientSlug;
  next();
}, tempUpload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const files = req.files.map(f => ({
    path: path.join(req.tempPath, f.originalname),
    name: f.originalname,
    type: f.mimetype,
    size: f.size
  }));

  res.json({
    success: true,
    messageId: req.messageId,
    files: files
  });
});

// Token management (admin only - for Nexus to call)
app.post('/admin/tokens/generate', (req, res) => {
  const { clientSlug } = req.body;
  if (!clientSlug) {
    return res.status(400).json({ error: 'clientSlug required' });
  }
  
  const token = authManager.generateToken(clientSlug);
  res.json({ 
    token, 
    link: `http://localhost:3445/?token=${token}` 
  });
});

app.post('/admin/tokens/rotate', (req, res) => {
  const { clientSlug } = req.body;
  if (!clientSlug) {
    return res.status(400).json({ error: 'clientSlug required' });
  }
  
  const token = authManager.rotateToken(clientSlug);
  res.json({ 
    token, 
    link: `http://localhost:3445/?token=${token}` 
  });
});

app.get('/admin/tokens', (req, res) => {
  res.json(authManager.listTokens());
});

// WebSocket for chat
io.use((socket, next) => {
  const token = socket.handshake.query.token || socket.handshake.headers.cookie?.match(/auth_token=([^;]+)/)?.[1];

  if (!token) {
    return next(new Error('Token required'));
  }

  const clientSlug = authManager.validateToken(token);

  if (!clientSlug) {
    return next(new Error('Invalid token'));
  }

  socket.clientSlug = clientSlug;
  next();
});

// Track agent processing state per session key (survives socket reconnects)
const sessionProcessing = new Map();

io.on('connection', async (socket) => {
  console.log(`Client connected: ${socket.clientSlug}`);

  // Default active session key — will be set when user picks a session
  socket.activeSessionKey = null;

  // Send session list and load the most recent session's history
  try {
    const sessions = await listClientSessions(socket.clientSlug);
    socket.emit('sessions:list', { sessions });

    if (sessions.length > 0) {
      // Auto-select the most recent session
      socket.activeSessionKey = sessions[0].key;
      const history = await loadGatewayHistory(sessions[0].key);
      socket.emit('chat:history', { messages: history, sessionKey: sessions[0].key });
    }
  } catch (error) {
    console.error('Error on connect:', error.message);
  }

  // --- Session management ---

  socket.on('sessions:list', async () => {
    try {
      const sessions = await listClientSessions(socket.clientSlug);
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:list error:', error.message);
    }
  });

  socket.on('sessions:switch', async (data) => {
    try {
      socket.activeSessionKey = data.sessionKey;
      const history = await loadGatewayHistory(data.sessionKey);
      socket.emit('chat:history', { messages: history, sessionKey: data.sessionKey });
    } catch (error) {
      console.error('sessions:switch error:', error.message);
    }
  });

  socket.on('sessions:new', async () => {
    try {
      // Create a new session via gateway
      const friendlyId = `agent:${socket.clientSlug}:web:direct:portal-${crypto.randomUUID()}`;
      await gatewayRpc('sessions.patch', { key: friendlyId });
      socket.activeSessionKey = friendlyId;

      // Clear chat and refresh session list
      socket.emit('chat:history', { messages: [], sessionKey: friendlyId });
      const sessions = await listClientSessions(socket.clientSlug);
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:new error:', error.message);
    }
  });

  socket.on('sessions:rename', async (data) => {
    try {
      await gatewayRpc('sessions.patch', { key: data.sessionKey, label: data.name });
      const sessions = await listClientSessions(socket.clientSlug);
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:rename error:', error.message);
    }
  });

  socket.on('sessions:delete', async (data) => {
    try {
      await gatewayRpc('sessions.delete', { key: data.sessionKey });

      // If deleting the active session, switch to the next available
      if (socket.activeSessionKey === data.sessionKey) {
        const sessions = await listClientSessions(socket.clientSlug);
        if (sessions.length > 0) {
          socket.activeSessionKey = sessions[0].key;
          const history = await loadGatewayHistory(sessions[0].key);
          socket.emit('chat:history', { messages: history, sessionKey: sessions[0].key });
        } else {
          socket.activeSessionKey = null;
          socket.emit('chat:history', { messages: [], sessionKey: null });
        }
        socket.emit('sessions:list', { sessions });
      } else {
        const sessions = await listClientSessions(socket.clientSlug);
        socket.emit('sessions:list', { sessions });
      }
    } catch (error) {
      console.error('sessions:delete error:', error.message);
    }
  });

  // --- Agent status check ---
  socket.on('agent:status', () => {
    socket.emit('agent:status', { processing: !!sessionProcessing.get(socket.activeSessionKey) });
  });

  // --- Chat messaging via Gateway ---

  socket.on('chat:message', async (data) => {
    try {
      socket.emit('typing', { typing: true });

      // Ensure we have an active session
      if (!socket.activeSessionKey) {
        socket.activeSessionKey = `agent:${socket.clientSlug}:web:direct:portal-${crypto.randomUUID()}`;
        await gatewayRpc('sessions.patch', { key: socket.activeSessionKey });
      }

      const sessionKey = socket.activeSessionKey;
      sessionProcessing.set(sessionKey, true);

      // Build message with temp file paths
      let messageText = data.message;
      if (data.tempFiles && data.tempFiles.length > 0) {
        const fileRefs = data.tempFiles.map(f => {
          return `Attached file: ${f.path} (${formatFileSize(f.size)})`;
        }).join('\n');
        messageText = `${messageText}\n\n${fileRefs}`;
        data.tempFiles.forEach(() => {
          cleanupTempFiles(`${socket.clientSlug}-${data.messageId}`);
        });
      }
      console.log(`[chat] ${socket.clientSlug}: sending to ${sessionKey}`);

      // Get message count before sending so we can detect the new reply
      const historyBefore = await loadGatewayHistory(sessionKey, 50);
      const msgCountBefore = historyBefore.length;

      // Send via the singleton gateway client
      await gatewayRpc('chat.send', {
        sessionKey,
        message: messageText,
        deliver: true,
        timeoutMs: 120000,
        idempotencyKey: crypto.randomUUID(),
      });

      // Poll for the assistant response (chat.send is async)
      const POLL_INTERVAL = 2000;
      const MAX_POLLS = 45; // 90s max
      let found = false;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        const history = await loadGatewayHistory(sessionKey, 50);
        if (history.length > msgCountBefore) {
          // New messages appeared — find the latest assistant reply
          const newMessages = history.slice(msgCountBefore);
          const assistantReply = newMessages.filter(m => m.role === 'assistant').pop();
          if (assistantReply) {
            sessionProcessing.set(sessionKey, false);
            socket.emit('typing', { typing: false });
            socket.emit('chat:message', {
              role: 'assistant',
              content: assistantReply.content,
              timestamp: assistantReply.timestamp || new Date().toISOString(),
            });
            found = true;
            break;
          }
          // Check if there's an error message in the new content
          const errorMsg = newMessages.find(m =>
            m.role === 'assistant' && (m.content.includes('rate limit') || m.content.includes('error'))
          );
          if (errorMsg) {
            sessionProcessing.set(sessionKey, false);
            socket.emit('typing', { typing: false });
            socket.emit('chat:message', {
              role: 'assistant',
              content: errorMsg.content,
              timestamp: new Date().toISOString(),
            });
            found = true;
            break;
          }
        }
      }

      if (!found) {
        sessionProcessing.set(sessionKey, false);
        socket.emit('typing', { typing: false });
        socket.emit('chat:message', {
          role: 'assistant',
          content: 'The agent is taking too long to respond. Please try again.',
          timestamp: new Date().toISOString(),
        });
      }

      // Refresh session list (title may have been derived from first message)
      const sessions = await listClientSessions(socket.clientSlug);
      socket.emit('sessions:list', { sessions });

    } catch (error) {
      console.error(`[chat] ${socket.clientSlug}: ${error.message}`);
      if (socket.activeSessionKey) sessionProcessing.set(socket.activeSessionKey, false);
      socket.emit('typing', { typing: false });
      socket.emit('chat:message', {
        role: 'assistant',
        content: `Something went wrong: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.clientSlug}`);
  });
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3445;
server.listen(PORT, () => {
  console.log(`Client Portal running on port ${PORT}`);
  console.log(`Access via: http://localhost:3445/?token=<token>`);
});
