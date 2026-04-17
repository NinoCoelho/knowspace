/**
 * Tool-use permission broker.
 *
 * ACP agents call `requestPermission` mid-turn to ask the client whether
 * a tool call is OK. We forward each request to the connected WebSocket
 * UIs as a `permission:request` event, then resolve the underlying ACP
 * promise once the user picks an option (`permission:response`) or the
 * request times out.
 *
 * Default fallback when no UI is connected (or the timeout fires): the
 * first `allow_once` / `allow_always` option, or the first option in
 * the list. This preserves the v2 YOLO default — Knowspace was already
 * auto-allowing — while opting in to interactive approval whenever a
 * browser is open.
 */

const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 60_000;
const pending = new Map(); // id -> { resolve, timer, sessionKey }
let socketProvider = null;

function setSocketProvider(fn) { socketProvider = fn; }

function defaultDecision(options) {
  const opt = (options || []).find(o => o.kind === 'allow_once' || o.kind === 'allow_always')
    ?? (options || [])[0];
  return { outcome: { outcome: 'selected', optionId: opt?.optionId } };
}

function request({ sessionKey, toolCall, options, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const sockets = socketProvider ? socketProvider() : [];
  if (!sockets || sockets.length === 0) {
    return Promise.resolve(defaultDecision(options));
  }
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      console.warn(`[permission] timeout for ${id} on ${sessionKey} — falling back to default`);
      resolve(defaultDecision(options));
    }, timeoutMs);
    pending.set(id, { resolve, timer, sessionKey });
    const payload = { id, sessionKey, toolCall, options };
    for (const s of sockets) {
      try { s.emit('permission:request', payload); }
      catch (err) { console.error('[permission] socket emit failed:', err.message); }
    }
  });
}

function respond(id, optionId) {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve({ outcome: { outcome: 'selected', optionId } });
  return true;
}

function cancel(id) {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve({ outcome: { outcome: 'cancelled' } });
  return true;
}

function pendingCount() { return pending.size; }

module.exports = {
  setSocketProvider,
  request,
  respond,
  cancel,
  defaultDecision,
  DEFAULT_TIMEOUT_MS,
  _pendingForTest: pending,
  pendingCount,
};
