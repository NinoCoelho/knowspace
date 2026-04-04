const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');
const AuthManager = require('./middleware/auth');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const authManager = new AuthManager();

// Store active sessions per client
const clientSessions = {};

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
app.use(express.static(path.join(__dirname, 'public')));

// Client info endpoint
app.get('/api/client', (req, res) => {
  const token = req.query.token;
  const clientSlug = authManager.validateToken(token);
  
  if (!clientSlug) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  
  res.json({ clientSlug });
});

// Chat history endpoint
app.get('/api/chat/history', (req, res) => {
  const token = req.query.token;
  const clientSlug = authManager.validateToken(token);
  
  if (!clientSlug) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  
  const history = loadSessionHistory(clientSlug);
  res.json({ messages: history });
});

// API Routes with token auth
app.use('/api', (req, res, next) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  
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
  const token = req.query.token;
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
  const token = socket.handshake.query.token;
  
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
      // Send typing indicator
      socket.emit('typing', { typing: true });
      
      // Get or create session for this client
      let sessionId = clientSessions[socket.clientSlug];
      
      // Build command with session if available
      let cmd = `openclaw agent --agent ${socket.clientSlug} --message "${data.message.replace(/"/g, '\\"')}" --json`;
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
          
          // Extract human-readable text from payload
          let reply = 'No response';
          if (result.result && result.result.payloads && result.result.payloads.length > 0) {
            reply = result.result.payloads[0].text || 'No response';
          }
          
          // Save session ID for next message
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
  console.log(`Access via: http://localhost:3445/?token=<token>`);
});
