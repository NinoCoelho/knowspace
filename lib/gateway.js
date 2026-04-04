/**
 * OpenClaw Gateway WebSocket RPC Client
 * Uses a singleton persistent connection for all RPC calls.
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEVICE_KEYS_PATH = path.join(__dirname, '..', '.device-keys.json');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// --- Device Identity ---

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function derivePublicKeyRaw(publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function loadOrCreateDeviceIdentity() {
  let keyPair = null;

  if (fs.existsSync(DEVICE_KEYS_PATH)) {
    try {
      const stored = JSON.parse(fs.readFileSync(DEVICE_KEYS_PATH, 'utf8'));
      if (stored.version === 2 && stored.algorithm === 'ed25519') {
        keyPair = {
          publicKey: crypto.createPublicKey(stored.publicKeyPem),
          privateKey: crypto.createPrivateKey(stored.privateKeyPem),
        };
      }
    } catch {
      // regenerate on error
    }
  }

  if (!keyPair) {
    keyPair = crypto.generateKeyPairSync('ed25519');
    const payload = {
      version: 2,
      algorithm: 'ed25519',
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      createdAtMs: Date.now(),
    };
    fs.writeFileSync(DEVICE_KEYS_PATH, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  }

  const rawPublicKey = derivePublicKeyRaw(keyPair.publicKey);
  const deviceId = crypto.createHash('sha256').update(rawPublicKey).digest('hex');

  return {
    deviceId,
    privateKey: keyPair.privateKey,
    publicKeyRawBase64Url: base64UrlEncode(rawPublicKey),
  };
}

let _deviceIdentity = null;
function getDeviceIdentity() {
  if (!_deviceIdentity) {
    _deviceIdentity = loadOrCreateDeviceIdentity();
  }
  return _deviceIdentity;
}

// --- Gateway Config ---

function getGatewayConfig() {
  let url = process.env.CLAWDBOT_GATEWAY_URL || '';
  let token = process.env.CLAWDBOT_GATEWAY_TOKEN || '';

  if (!url || !token) {
    try {
      const configPath = path.join(process.env.HOME || '/home/nino', '.openclaw', 'openclaw.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!url && config.gateway) {
        const port = config.gateway.port || 18789;
        url = `ws://127.0.0.1:${port}`;
      }
      if (!token && config.gateway && config.gateway.auth) {
        token = config.gateway.auth.token || '';
      }
    } catch {
      // fallback defaults
    }
  }

  if (!url) url = 'ws://127.0.0.1:18789';
  return { url, token };
}

// --- WebSocket Helpers ---

function wsOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (e) => { cleanup(); reject(new Error(`WebSocket error: ${e.message || e}`)); };
    const cleanup = () => { ws.removeListener('open', onOpen); ws.removeListener('error', onError); };
    ws.on('open', onOpen);
    ws.on('error', onError);
  });
}

function wsClose(ws) {
  if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });
}

function waitForConnectChallenge(ws, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('Timed out waiting for connect.challenge'));
    }, timeoutMs);

    function handler(data) {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'event' && parsed.event === 'connect.challenge') {
          const nonce = parsed.payload && parsed.payload.nonce;
          if (typeof nonce === 'string' && nonce.trim()) {
            clearTimeout(timer);
            ws.removeListener('message', handler);
            resolve(nonce.trim());
          }
        }
      } catch {
        // ignore
      }
    }

    ws.on('message', handler);
  });
}

function buildConnectParams(token, nonce) {
  const identity = getDeviceIdentity();
  const clientId = 'gateway-client';
  const clientMode = 'ui';
  const role = 'operator';
  const scopes = ['operator.admin'];
  const signedAt = Date.now();

  const payload = [
    'v2', identity.deviceId, clientId, clientMode, role,
    scopes.join(','), String(signedAt), token, nonce,
  ].join('|');
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), identity.privateKey);
  const sigB64 = base64UrlEncode(sig);

  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: clientId,
      displayName: 'Client Portal',
      version: '1.0',
      platform: process.platform,
      mode: clientMode,
      instanceId: crypto.randomUUID(),
    },
    auth: { token: token || undefined },
    role,
    scopes,
    device: {
      id: identity.deviceId,
      publicKey: identity.publicKeyRawBase64Url,
      signature: sigB64,
      signedAt,
      nonce,
    },
  };
}

// --- Singleton Persistent Client ---
// One long-lived WS connection for all general RPC calls.
// Auto-reconnects on close/error.

let _mainClient = null;
let _mainConnecting = null;

function createPersistentClient() {
  const { url, token } = getGatewayConfig();
  let ws = null;
  let connected = false;
  let closed = false;
  const waiters = new Map();

  function rejectAll(error) {
    for (const [, w] of waiters) w.reject(error);
    waiters.clear();
  }

  function handleMessage(data) {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.type !== 'res') return;
      const w = waiters.get(parsed.id);
      if (!w) return;
      waiters.delete(parsed.id);
      if (parsed.ok) w.resolve(parsed.payload);
      else w.reject(new Error(parsed.error?.message || 'gateway error'));
    } catch {
      // ignore
    }
  }

  function handleClose() {
    connected = false;
    closed = true;
    rejectAll(new Error('Gateway connection closed'));
    // Clear singleton so next call reconnects
    if (_mainClient === client) {
      _mainClient = null;
      _mainConnecting = null;
    }
  }

  function handleError(err) {
    console.error('[gateway] Connection error:', err.message || err);
  }

  async function connect() {
    ws = new WebSocket(url);
    ws.on('message', handleMessage);
    ws.on('error', handleError);
    ws.on('close', handleClose);

    await wsOpen(ws);
    const nonce = await waitForConnectChallenge(ws);

    const connectId = crypto.randomUUID();
    const connectPromise = new Promise((resolve, reject) => { waiters.set(connectId, { resolve, reject }); });
    ws.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params: buildConnectParams(token, nonce) }));
    await connectPromise;
    connected = true;
    closed = false;
    console.log('[gateway] Connected to gateway');
  }

  function sendReq(method, params) {
    if (closed || !connected) return Promise.reject(new Error('Gateway not connected'));
    const id = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => { waiters.set(id, { resolve, reject }); });
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
    return promise;
  }

  function isConnected() { return connected && !closed; }

  const client = { connect, sendReq, isConnected };
  return client;
}

async function getMainClient() {
  if (_mainClient && _mainClient.isConnected()) {
    return _mainClient;
  }

  // If already connecting, wait for that to finish
  if (_mainConnecting) {
    return _mainConnecting;
  }

  _mainConnecting = (async () => {
    const client = createPersistentClient();
    await client.connect();
    _mainClient = client;
    _mainConnecting = null;
    return client;
  })();

  try {
    return await _mainConnecting;
  } catch (err) {
    _mainConnecting = null;
    throw err;
  }
}

async function gatewayRpc(method, params) {
  const client = await getMainClient();
  return client.sendReq(method, params);
}

// --- Per-session Event Client ---
// Separate WS connections for sessions that need event streaming (chat.send).

function createEventClient() {
  const { url, token } = getGatewayConfig();
  let ws = null;
  let closed = false;
  let connected = false;
  let onEvent = null;
  let onError = null;
  const waiters = new Map();

  function rejectAll(error) {
    for (const [, w] of waiters) w.reject(error);
    waiters.clear();
  }

  function handleMessage(data) {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'event') {
        if (onEvent) onEvent(parsed);
        return;
      }
      if (parsed.type !== 'res') return;
      const w = waiters.get(parsed.id);
      if (!w) return;
      waiters.delete(parsed.id);
      if (parsed.ok) w.resolve(parsed.payload);
      else w.reject(new Error(parsed.error?.message || 'gateway error'));
    } catch {
      // ignore
    }
  }

  function handleError(err) {
    if (onError) onError(new Error(`Gateway event client error: ${err.message || err}`));
  }

  function handleClose(code) {
    if (closed) return;
    closed = true;
    if (code === 1008) {
      const identity = getDeviceIdentity();
      console.error(`[gateway] Device auth rejected. Run: openclaw devices approve ${identity.deviceId}`);
    }
    rejectAll(new Error('Gateway event client closed'));
  }

  async function connect() {
    if (connected || closed) return;
    ws = new WebSocket(url);
    ws.on('message', handleMessage);
    ws.on('error', handleError);
    ws.on('close', handleClose);

    await wsOpen(ws);
    const nonce = await waitForConnectChallenge(ws);

    const connectId = crypto.randomUUID();
    const connectPromise = new Promise((resolve, reject) => { waiters.set(connectId, { resolve, reject }); });
    ws.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params: buildConnectParams(token, nonce) }));
    await connectPromise;
    connected = true;
  }

  function sendReq(method, params) {
    if (closed) return Promise.reject(new Error('Event client closed'));
    const id = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => { waiters.set(id, { resolve, reject }); });
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
    return promise;
  }

  function close() {
    if (closed) return;
    closed = true;
    connected = false;
    rejectAll(new Error('Event client closed'));
    if (ws) {
      ws.removeListener('message', handleMessage);
      ws.removeListener('error', handleError);
      ws.removeListener('close', handleClose);
      wsClose(ws).catch(() => {});
    }
  }

  return {
    connect,
    sendReq,
    close,
    setOnEvent(handler) { onEvent = handler; },
    setOnError(handler) { onError = handler; },
    isClosed() { return closed; },
  };
}

// --- Shared Event Client Pool ---

const sharedClients = new Map();

async function acquireGatewayClient(key, options) {
  const existing = sharedClients.get(key);
  if (existing && !existing.client.isClosed()) {
    existing.refs += 1;
    if (options?.onEvent) existing.client.setOnEvent(options.onEvent);
    if (options?.onError) existing.client.setOnError(options.onError);
    return { client: existing.client, release: () => releaseGatewayClient(key) };
  }

  const client = createEventClient();
  if (options?.onEvent) client.setOnEvent(options.onEvent);
  if (options?.onError) client.setOnError(options.onError);
  await client.connect();
  sharedClients.set(key, { key, refs: 1, client });
  return { client, release: () => releaseGatewayClient(key) };
}

function releaseGatewayClient(key) {
  const entry = sharedClients.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.client.close();
  sharedClients.delete(key);
}

// --- Public API ---

module.exports = {
  getDeviceIdentity,
  getGatewayConfig,
  gatewayRpc,
  acquireGatewayClient,
  releaseGatewayClient,
};
