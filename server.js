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
const providers = require('./adapters/providers');
const engine = providers.engine;
const sessionRouter = require('./lib/session-router');
const permissionBroker = require('./lib/permission-broker');
const acp = require('./adapters/providers/acp');

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

function resolveVaultRef(vaultBase, refName) {
  // Try exact match first, then fuzzy
  const candidates = [];

  function walk(dir, relativePath) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const rel = relativePath ? relativePath + '/' + item : item;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, rel);
      } else {
        candidates.push({ path: rel, fullPath });
      }
    }
  }

  walk(vaultBase, '');

  // Match strategies (in priority order):
  // 1. Exact path match
  let match = candidates.find(f => f.path === refName);
  // 2. Exact name (strip extension)
  if (!match) match = candidates.find(f => f.path === refName + '.md');
  if (!match) match = candidates.find(f => f.path === refName + '.markdown');
  if (!match) match = candidates.find(f => f.path === refName + '.txt');
  // 3. Ends with refName (handles full path without vault prefix)
  if (!match) match = candidates.find(f => f.path.endsWith(refName));
  // 4. Filename contains refName
  if (!match) match = candidates.find(f => {
    const name = f.path.split('/').pop().replace(/\.(md|markdown|txt)$/, '');
    return name === refName.replace(/\.(md|markdown|txt)$/, '');
  });
  // 5. Fuzzy: refName contains partial match
  if (!match) match = candidates.find(f => f.path.toLowerCase().includes(refName.toLowerCase()));

  if (!match) return null;

  // Only read text files (limit size to 50KB)
  const ext = match.path.split('.').pop().toLowerCase();
  const textExts = ['md', 'markdown', 'txt', 'json', 'csv'];
  if (!textExts.includes(ext)) {
    return { path: match.path, content: `[Binary file: ${match.path}]` };
  }

  const stat = fs.statSync(match.fullPath);
  if (stat.size > 50 * 1024) {
    const preview = fs.readFileSync(match.fullPath, 'utf8').slice(0, 10000);
    return { path: match.path, content: preview + '\n... [truncated, file is ' + Math.round(stat.size / 1024) + 'KB]' };
  }

  return { path: match.path, content: fs.readFileSync(match.fullPath, 'utf8') };
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const authManager = new AuthManager();

// Wire the permission broker so ACP agents can ask the UI for tool-use
// approval. Falls back to YOLO auto-allow when no UI is connected.
permissionBroker.setSocketProvider(() => Array.from(io.sockets.sockets.values()));
acp.setPermissionBroker(permissionBroker);

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

// Gateway operations are handled by adapters/providers/openclaw (sessions, chat, messages, paths)

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

// Legal pages
app.get('/LICENSE', (_, res) => res.sendFile(path.join(__dirname, 'LICENSE')));
app.get('/TERMS.md', (_, res) => res.sendFile(path.join(__dirname, 'TERMS.md')));

// Guard the SPA entry point — if the visitor has no valid session
// cookie, route them to the login form instead of serving index.html
// (which would just fail on API calls anyway).
app.get(['/', '/index.html'], (req, res, next) => {
  const token = req.cookies && req.cookies.auth_token;
  if (token && authManager.validateToken(token)) return next();
  res.set('Cache-Control', 'no-store');
  return res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

// GET /auth?token=... — legacy onboarding link flow. Kept so the
// first-boot admin URL and shareable links keep working. The token is
// consumed once, a cookie is set, and the browser is redirected to /
// stripping the query string. Cache-Control is no-store so no proxy or
// browser caches the sensitive URL.
// POST /auth — form submission from the login page. Same validation,
// same cookie, but the token never appears in a URL.
function acceptAuthToken(req, res, token) {
  res.set('Cache-Control', 'no-store');
  if (!token || typeof token !== 'string') {
    return { ok: false, status: 400, body: 'Token required' };
  }
  const clientSlug = authManager.validateToken(token);
  if (!clientSlug) {
    return { ok: false, status: 403, body: 'Invalid token' };
  }
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('auth_token', token, {
    httpOnly: false, // Allow JavaScript to access for Socket.IO
    secure: isSecure,
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    sameSite: 'lax',
  });
  return { ok: true, clientSlug };
}

app.get('/auth', (req, res) => {
  const result = acceptAuthToken(req, res, req.query.token);
  if (!result.ok) return res.status(result.status).send(result.body);
  res.redirect('/');
});

app.post('/auth', express.urlencoded({ extended: false }), (req, res) => {
  const token = (req.body && req.body.token) || '';
  const result = acceptAuthToken(req, res, token);
  if (!result.ok) {
    // Re-render the login page with an error banner.
    return res.status(result.status).send(renderLoginPage({ error: result.body }));
  }
  res.redirect('/');
});

// Lightweight login page — only rendered for unauth'd GET / requests
// (see catch-all at the bottom) and on POST /auth failure.
function renderLoginPage({ error } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Knowspace — sign in</title>
<link rel="icon" type="image/png" href="/images/knowspace-logo.png">
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #FAF9F6; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { html, body { background: #0d0d0d; color: #e5e5e5; } .card { background: #1a1a1a !important; border-color: #333 !important; } input { background: #0d0d0d !important; color: #e5e5e5 !important; border-color: #333 !important; } }
  .wrap { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border: 1px solid #E8E4DD; border-radius: 14px; padding: 28px; width: 100%; max-width: 380px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.sub { margin: 0 0 20px; color: #6B6B6B; font-size: 13px; }
  label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6B6B6B; margin-bottom: 6px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #E8E4DD; border-radius: 8px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; box-sizing: border-box; }
  button { width: 100%; margin-top: 14px; padding: 10px; border: 0; border-radius: 8px; background: #8B5E3C; color: #fff; font-size: 14px; font-weight: 500; cursor: pointer; }
  button:hover { background: #6B4A32; }
  .err { background: #fee; border: 1px solid #fcc; color: #9f1a1a; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 14px; }
</style>
</head>
<body>
<div class="wrap">
  <form class="card" method="POST" action="/auth" autocomplete="off">
    <h1>Knowspace</h1>
    <p class="sub">Paste your access token to sign in.</p>
    ${error ? `<div class="err">${String(error).replace(/[<>&]/g, '')}</div>` : ''}
    <label for="token">Access token</label>
    <input id="token" name="token" type="password" autofocus spellcheck="false" autocapitalize="off" autocorrect="off" />
    <button type="submit">Sign in</button>
  </form>
</div>
</body>
</html>`;
}

app.get('/login', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(renderLoginPage());
});

// Logout route - clears the cookie
app.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/login');
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
  const provider = sessionRouter.getProviderForSession(sessionKey);
  const history = await provider.loadHistory(sessionKey);
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

// Card Chat REST endpoints (for card modal chat tab)
app.post('/api/chat/session', async (req, res) => {
  const token = req.query.token || req.cookies.auth_token;
  const clientSlug = authManager.validateToken(token);
  if (!clientSlug) return res.status(403).json({ error: 'Invalid token' });

  try {
    const sessionKey = await engine.sessions.createSession(clientSlug);
    if (req.body.label && typeof req.body.label === 'string' && req.body.label.length <= 200) {
      await engine.sessions.renameSession(sessionKey, req.body.label);
    }
    res.json({ sessionKey });
  } catch (error) {
    console.error('[card-chat] Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.post('/api/chat/send', async (req, res) => {
  const token = req.query.token || req.cookies.auth_token;
  const clientSlug = authManager.validateToken(token);
  if (!clientSlug) return res.status(403).json({ error: 'Invalid token' });

  const { sessionKey, message } = req.body;
  if (!sessionKey || !message) {
    return res.status(400).json({ error: 'sessionKey and message required' });
  }

  req.setTimeout(30 * 60 * 1000); // 30 min timeout for long agent responses

  try {
    const provider = sessionRouter.getProviderForSession(sessionKey);
    const historyBefore = await provider.loadHistory(sessionKey, 50);
    const msgCountBefore = historyBefore.length;

    await provider.sendMessage(sessionKey, message);

    await provider.pollForReply(sessionKey, msgCountBefore, {
      pollIntervalMs: provider.id === 'acp' ? 250 : 2000,
      maxPolls: provider.id === 'acp' ? 7200 : 900,
      idlePollsToStop: 3,
    });

    const historyAfter = await provider.loadHistory(sessionKey, 50);
    const newMessages = historyAfter.slice(msgCountBefore);

    res.json({ messages: newMessages });
  } catch (error) {
    console.error('[card-chat] Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
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
    const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
    socket.emit('sessions:list', { sessions });

    if (sessions.length > 0) {
      // Auto-select the most recent session
      socket.activeSessionKey = sessions[0].key;
      const history = await sessionRouter.getProviderForSession(sessions[0].key).loadHistory(sessions[0].key);
      socket.emit('chat:history', { messages: history, sessionKey: sessions[0].key });
    }
  } catch (error) {
    console.error('Error on connect:', error.message);
  }

  // --- Session management ---

  socket.on('sessions:list', async () => {
    try {
      const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:list error:', error.message);
    }
  });

  socket.on('sessions:switch', async (data) => {
    try {
      socket.activeSessionKey = data.sessionKey;
      const history = await sessionRouter.getProviderForSession(data.sessionKey).loadHistory(data.sessionKey);
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
      const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:new error:', error.message);
    }
  });

  // Multi-provider variant: spawn a new session in any registered provider.
  // data: { providerId, agentId, cwd?, label? }
  socket.on('sessions:newWithAgent', async (data) => {
    try {
      const { providerId, agentId, cwd, label } = data || {};
      if (!providerId || !agentId) {
        socket.emit('chat:message', { role: 'assistant', content: 'sessions:newWithAgent: providerId and agentId are required.', timestamp: new Date().toISOString() });
        return;
      }
      const provider = providers.getProvider(providerId);
      const newKey = await provider.createSession(agentId, { cwd, label });
      socket.activeSessionKey = newKey;
      socket.emit('chat:history', { messages: [], sessionKey: newKey });
      const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
      socket.emit('sessions:list', { sessions });
    } catch (error) {
      console.error('sessions:newWithAgent error:', error.message);
      socket.emit('chat:message', { role: 'assistant', content: `Could not create session: ${error.message}`, timestamp: new Date().toISOString() });
    }
  });

  socket.on('sessions:rename', async (data) => {
    try {
      await engine.sessions.renameSession(data.sessionKey, data.name);
      const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
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
        const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
        if (sessions.length > 0) {
          socket.activeSessionKey = sessions[0].key;
          const history = await sessionRouter.getProviderForSession(sessions[0].key).loadHistory(sessions[0].key);
          socket.emit('chat:history', { messages: history, sessionKey: sessions[0].key });
        } else {
          socket.activeSessionKey = null;
          socket.emit('chat:history', { messages: [], sessionKey: null });
        }
        socket.emit('sessions:list', { sessions });
      } else {
        const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
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
        const history = await sessionRouter.getProviderForSession(sessions[0].key).loadHistory(sessions[0].key);
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

  // --- Tool-use permission flow ---
  socket.on('permission:response', (data) => {
    if (!data || !data.id) return;
    permissionBroker.respond(data.id, data.optionId);
  });

  // --- Watch a session for replies (used after kanban dispatch where
  //     the message was sent via REST, not chat:message). Polls until
  //     the agent goes idle and streams replies via chat:message.
  socket.on('sessions:watch', async (data) => {
    try {
      const sessionKey = data?.sessionKey;
      if (!sessionKey) return;
      const provider = sessionRouter.getProviderForSession(sessionKey);
      const history = await provider.loadHistory(sessionKey, 50);
      const msgCountBefore = history.length;
      sessionProcessing.set(sessionKey, true);
      socket.emit('typing', { typing: true });

      const result = await provider.pollForReply(sessionKey, msgCountBefore, {
        pollIntervalMs: provider.id === 'acp' ? 250 : 2000,
        maxPolls: provider.id === 'acp' ? 7200 : 900,
        onProgress: (p) => socket.emit('agent:progress', typeof p === 'string' ? { status: p, tools: [] } : p),
        onMessage: (m) => socket.emit('chat:message', m),
        isDisconnected: () => socket.disconnected,
      });

      sessionProcessing.set(sessionKey, false);
      socket.emit('typing', { typing: false });

      if (!result.found) {
        console.log(`[chat] watch: agent polling timed out for ${sessionKey}`);
      }
      const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
      socket.emit('sessions:list', { sessions });
    } catch (err) {
      console.error('sessions:watch error:', err.message);
      sessionProcessing.set(data?.sessionKey, false);
      socket.emit('typing', { typing: false });
    }
  });

  // --- Chat messaging via Gateway ---

  socket.on('chat:message', async (data) => {
    try {
      socket.emit('typing', { typing: true });

      // Ensure we have an active session
      if (!socket.activeSessionKey) {
        socket.activeSessionKey = await engine.sessions.createSession(socket.clientSlug);
        // Immediately notify client of the new session so the sidebar updates
        socket.emit('chat:history', { messages: [], sessionKey: socket.activeSessionKey });
        const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
        socket.emit('sessions:list', { sessions });
      }

      const sessionKey = socket.activeSessionKey;
      sessionProcessing.set(sessionKey, true);

      // Build message with temp file paths
      let messageText = data.message;

      // Resolve #file references — inject vault file content into the message
      const hashRefs = messageText.match(/#([\w][\w./-]*)/g);
      if (hashRefs) {
        const vaultBase = getVaultBase(socket.clientSlug);
        for (const ref of hashRefs) {
          const refName = ref.slice(1); // remove #
          try {
            // Search for matching file in vault
            const resolved = resolveVaultRef(vaultBase, refName);
            if (resolved) {
              messageText = messageText.replace(ref, '');
              messageText += `\n\n--- Content of ${resolved.path} ---\n${resolved.content}\n--- End of ${resolved.path} ---`;
            }
          } catch (e) {
            console.log(`[chat] could not resolve #ref ${refName}: ${e.message}`);
          }
        }
      }

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

      // Route by session key prefix — the chat loop is provider-agnostic
      const targetProvider = sessionRouter.getProviderForSession(sessionKey);

      // Get message count before sending so we can detect the new reply
      const historyBefore = await targetProvider.loadHistory(sessionKey, 50);
      const msgCountBefore = historyBefore.length;

      await targetProvider.sendMessage(sessionKey, messageText);

      // Poll for the assistant response — emits each reply immediately via onMessage
      const result = await targetProvider.pollForReply(sessionKey, msgCountBefore, {
        pollIntervalMs: targetProvider.id === 'acp' ? 250 : 2000,
        maxPolls: targetProvider.id === 'acp' ? 7200 : 900,
        onProgress: (data) => socket.emit('agent:progress', typeof data === 'string' ? { status: data, tools: [] } : data),
        onMessage: (reply) => socket.emit('chat:message', reply),
        isDisconnected: () => socket.disconnected,
      });

      sessionProcessing.set(sessionKey, false);

      if (result.disconnected) {
        return; // client gone, skip cleanup emits
      }

      socket.emit('typing', { typing: false });

      if (!result.found) {
        console.log(`[chat] ${socket.clientSlug}: agent polling timed out for ${sessionKey}`);
      }

      // Refresh session list (title may have been derived from first message).
      // Aggregate across providers so ACP sessions show up alongside OpenClaw ones.
      const sessions = await sessionRouter.listAllSessions({ clientSlug: socket.clientSlug });
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

// Serve the SPA shell for any other route. Unauth'd users hitting
// deep-linked views get bounced to /login.
app.get('*', (req, res) => {
  const token = req.cookies && req.cookies.auth_token;
  if (!token || !authManager.validateToken(token)) {
    res.set('Cache-Control', 'no-store');
    return res.redirect('/login');
  }
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
