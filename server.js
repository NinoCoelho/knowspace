const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { exec } = require('child_process');
const AuthManager = require('./middleware/auth');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const authManager = new AuthManager();

// Store active sessions per client
const clientSessions = {};

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

// Chat history management - read from OpenClaw session
function loadSessionHistory(clientSlug) {
  try {
    const sessionsDir = path.join(process.env.HOME || '/home/nino', '.openclaw', 'agents', clientSlug, 'sessions');
    
    if (!fs.existsSync(sessionsDir)) return [];
    
    // Find most recent .jsonl file
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(sessionsDir, f),
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (files.length === 0) return [];
    
    // Read most recent session file
    const sessionPath = files[0].path;
    const content = fs.readFileSync(sessionPath, 'utf8');
    const lines = content.trim().split('\n');
    const messages = [];
    
    lines.forEach(line => {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message && entry.message.content) {
          const role = entry.message.role;
          
          // Extract text content (ignore thinking blocks)
          let text = '';
          if (Array.isArray(entry.message.content)) {
            entry.message.content.forEach(block => {
              if (block.type === 'text') {
                text += block.text;
              }
            });
          } else if (typeof entry.message.content === 'string') {
            text = entry.message.content;
          }
          
          if (text && (role === 'user' || role === 'assistant')) {
            // Remove timestamp prefix from user messages
            if (role === 'user') {
              text = text.replace(/^\[[\w\s:-]+\]\s*/, '');
            }
            
            messages.push({
              role,
              content: text,
              timestamp: entry.timestamp
            });
          }
        }
      } catch (parseError) {
        // Skip malformed lines
      }
    });
    
    // Keep last 50 messages
    return messages.slice(-50);
  } catch (error) {
    console.error('Error loading session history:', error);
    return [];
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
    secure: process.env.NODE_ENV === 'production',
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
app.get('/api/chat/history', (req, res) => {
  const token = req.query.token || req.cookies.auth_token;
  const clientSlug = authManager.validateToken(token);

  if (!clientSlug) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  const history = loadSessionHistory(clientSlug);
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
    link: `https://bella.bonito-halosaur.ts.net/?token=${token}` 
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
    link: `https://bella.bonito-halosaur.ts.net/?token=${token}` 
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

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.clientSlug}`);
  
  // Send recent session history on connect
  const history = loadSessionHistory(socket.clientSlug);
  if (history.length > 0) {
    socket.emit('chat:history', { messages: history });
  }
  
  socket.on('chat:message', async (data) => {
    try {
      socket.emit('typing', { typing: true });

      let sessionId = clientSessions[socket.clientSlug];

      // Build message with temp file paths
      let messageText = data.message;

      // If there are temp files, add them to the message
      if (data.tempFiles && data.tempFiles.length > 0) {
        const fileRefs = data.tempFiles.map(f => {
          return `Attached file: ${f.path} (${formatFileSize(f.size)})`;
        }).join('\n');

        messageText = `${messageText}\n\n${fileRefs}`;

        // Schedule cleanup
        data.tempFiles.forEach(f => {
          cleanupTempFiles(`${socket.clientSlug}-${data.messageId}`);
        });
      }

      // Build command
      let cmd = `openclaw agent --agent ${socket.clientSlug} --message "${messageText.replace(/"/g, '\\"')}" --json`;
      if (sessionId) {
        cmd += ` --session-id ${sessionId}`;
      }

      exec(cmd, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        socket.emit('typing', { typing: false });

        if (error) {
          console.error('Agent error:', error);
          socket.emit('chat:message', {
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
            timestamp: new Date().toISOString()
          });
          return;
        }

        try {
          const result = JSON.parse(stdout);
          let reply = 'No response';
          if (result.result && result.result.payloads && result.result.payloads.length > 0) {
            reply = result.result.payloads[0].text || 'No response';
          }

          if (result.result && result.result.meta && result.result.meta.agentMeta) {
            clientSessions[socket.clientSlug] = result.result.meta.agentMeta.sessionId;
          }

          socket.emit('chat:message', {
            role: 'assistant',
            content: reply,
            timestamp: new Date().toISOString()
          });
        } catch (parseError) {
          console.error('Parse error:', parseError);
          socket.emit('chat:message', {
            role: 'assistant',
            content: stdout || 'Sorry, I could not process the response.',
            timestamp: new Date().toISOString()
          });
        }
      });
    } catch (error) {
      console.error('Chat error:', error);
      socket.emit('typing', { typing: false });
      socket.emit('chat:message', {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date().toISOString()
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
  console.log(`Access via: https://bella.bonito-halosaur.ts.net/?token=<token>`);
});
