const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const AuthManager = require('./middleware/auth');
const apiRoutes = require('./routes/api');
const engine = require('./adapters/engine');

const KNOWSPACE_CONFIG = path.join(os.homedir(), '.knowspace', 'config.json');

function getVaultBase(clientSlug) {
  let vaultPath;
  try {
    const config = JSON.parse(fs.readFileSync(KNOWSPACE_CONFIG, 'utf8'));
    if (config.vaultPath && config.slug === clientSlug) {
      vaultPath = config.vaultPath;
    }
  } catch {
    // config not found or invalid — fall through
  }
  if (!vaultPath) {
    vaultPath = path.join(os.homedir(), clientSlug, 'workspace', 'vault');
  }
  try {
    return fs.realpathSync(vaultPath);
  } catch {
    return vaultPath;
  }
}

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

// Gateway operations are handled by adapters/engine (sessions, chat, messages, paths)

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const clientSlug = req.clientSlug;
    const uploadPath = path.join(getVaultBase(clientSlug), 'uploads');
    
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
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('auth_token', token, {
    httpOnly: false, // Allow JavaScript to access for Socket.IO
    secure: isSecure,
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

  const sessionKey = req.query.sessionKey || engine.paths.getDefaultSessionKey(clientSlug);
  const history = await engine.chat.loadHistory(sessionKey);
  res.json({ messages: history });
});

// List all registered clients (admin only)
app.get('/api/clients', (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '') || req.cookies.auth_token;
  if (!token) return res.status(401).json({ error: 'Token required' });
  const clientSlug = authManager.validateToken(token);
  if (!clientSlug) return res.status(403).json({ error: 'Invalid token' });
  const adminSlug = process.env.KNOWSPACE_ADMIN_SLUG || 'main';
  if (clientSlug !== adminSlug) return res.status(403).json({ error: 'Admin only' });
  res.json(authManager.listTokens());
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

  // Admin can impersonate another client via ?as=slug
  const adminSlug = process.env.KNOWSPACE_ADMIN_SLUG || 'main';
  if (req.query.as && clientSlug === adminSlug) {
    req.clientSlug = req.query.as;
  } else {
    req.clientSlug = clientSlug;
  }
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
    link: `${BASE_URL}/auth?token=${token}`
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
    link: `${BASE_URL}/auth?token=${token}`
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
  socket.originalSlug = clientSlug; // immutable — used for admin checks
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
    const sessions = await engine.sessions.listSessions(socket.clientSlug);
    socket.emit('sessions:list', { sessions });

    if (sessions.length > 0) {
      // Auto-select the most recent session
      socket.activeSessionKey = sessions[0].key;
      const history = await engine.chat.loadHistory(sessions[0].key);
      socket.emit('chat:history', { messages: history, sessionKey: sessions[0].key });
    }
  } catch (error) {
    console.error('Error on connect:', error.message);
  }

  // --- Session management ---

  socket.on('sessions:list', async () => {
    try {
      const sessions = await engine.sessions.listSessions(socket.clientSlug);
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:list error:', error.message);
    }
  });

  socket.on('sessions:switch', async (data) => {
    try {
      socket.activeSessionKey = data.sessionKey;
      const history = await engine.chat.loadHistory(data.sessionKey);
      socket.emit('chat:history', { messages: history, sessionKey: data.sessionKey });
    } catch (error) {
      console.error('sessions:switch error:', error.message);
    }
  });

  socket.on('sessions:new', async () => {
    try {
      const newKey = await engine.sessions.createSession(socket.clientSlug);
      socket.activeSessionKey = newKey;

      // Clear chat and refresh session list
      socket.emit('chat:history', { messages: [], sessionKey: newKey });
      const sessions = await engine.sessions.listSessions(socket.clientSlug);
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:new error:', error.message);
    }
  });

  socket.on('sessions:rename', async (data) => {
    try {
      await engine.sessions.renameSession(data.sessionKey, data.name);
      const sessions = await engine.sessions.listSessions(socket.clientSlug);
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:rename error:', error.message);
    }
  });

  socket.on('sessions:delete', async (data) => {
    try {
      await engine.sessions.deleteSession(data.sessionKey);

      // If deleting the active session, switch to the next available
      if (socket.activeSessionKey === data.sessionKey) {
        const sessions = await engine.sessions.listSessions(socket.clientSlug);
        if (sessions.length > 0) {
          socket.activeSessionKey = sessions[0].key;
          const history = await engine.chat.loadHistory(sessions[0].key);
          socket.emit('chat:history', { messages: history, sessionKey: sessions[0].key });
        } else {
          socket.activeSessionKey = null;
          socket.emit('chat:history', { messages: [], sessionKey: null });
        }
        socket.emit('sessions:list', { sessions });
      } else {
        const sessions = await engine.sessions.listSessions(socket.clientSlug);
        socket.emit('sessions:list', { sessions });
      }
    } catch (error) {
      console.error('sessions:delete error:', error.message);
    }
  });

  // --- Client switching (admin only) ---
  socket.on('client:switch', async (data) => {
    const adminSlug = process.env.KNOWSPACE_ADMIN_SLUG || 'main';
    if (socket.originalSlug !== adminSlug) return;

    const targetSlug = data.clientSlug;
    if (!targetSlug) return;

    socket.clientSlug = targetSlug;
    socket.activeSessionKey = null;

    try {
      const sessions = await engine.sessions.listSessions(targetSlug);
      socket.emit('sessions:list', { sessions });

      if (sessions.length > 0) {
        socket.activeSessionKey = sessions[0].key;
        const history = await engine.chat.loadHistory(sessions[0].key);
        socket.emit('chat:history', { messages: history, sessionKey: sessions[0].key });
      } else {
        socket.emit('chat:history', { messages: [], sessionKey: null });
      }

      socket.emit('client:switched', { clientSlug: targetSlug });
    } catch (error) {
      console.error('client:switch error:', error.message);
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
        socket.activeSessionKey = await engine.sessions.createSession(socket.clientSlug);
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
      const historyBefore = await engine.chat.loadHistory(sessionKey, 50);
      const msgCountBefore = historyBefore.length;

      // Send via the engine adapter
      await engine.chat.sendMessage(sessionKey, messageText);

      // Poll for the assistant response — emits each reply immediately via onMessage
      const result = await engine.chat.pollForReply(sessionKey, msgCountBefore, {
        onProgress: (status) => socket.emit('agent:progress', { status }),
        onMessage: (reply) => socket.emit('chat:message', reply),
        isDisconnected: () => socket.disconnected,
      });

      sessionProcessing.set(sessionKey, false);

      if (result.disconnected) {
        return; // client gone, skip cleanup emits
      }

      socket.emit('typing', { typing: false });

      if (!result.found) {
        console.log(`[chat] ${socket.clientSlug}: agent polling timed out after 30 min for ${sessionKey}`);
      }

      // Refresh session list (title may have been derived from first message)
      const sessions = await engine.sessions.listSessions(socket.clientSlug);
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

const PORT = process.env.KNOWSPACE_PORT || process.env.PORT || 3445;
const BASE_URL = process.env.KNOWSPACE_BASE_URL || `http://localhost:${PORT}`;

server.listen(PORT, () => {
  console.log(`Knowspace portal running on port ${PORT}`);

  // First-boot: auto-generate admin token if no tokens exist
  const existingTokens = authManager.listTokens();
  if (existingTokens.length === 0) {
    const adminSlug = process.env.KNOWSPACE_ADMIN_SLUG || 'main';
    const token = authManager.generateToken(adminSlug);
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║  FIRST BOOT — Admin token generated automatically       ║');
    console.log('  ╠══════════════════════════════════════════════════════════╣');
    console.log(`  ║  Client:  ${adminSlug.padEnd(46)} ║`);
    console.log(`  ║  Token:   ${token.substring(0, 16)}...${token.substring(token.length - 8).padEnd(25)} ║`);
    console.log('  ║                                                          ║');
    console.log('  ║  Access link (share with system owner):                  ║');
    console.log(`  ║  ${(BASE_URL + '/auth?token=' + token).padEnd(56)} ║`);
    console.log('  ║                                                          ║');
    console.log('  ║  This message only appears once. Save the link above.    ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝');
    console.log('');
  }
});
