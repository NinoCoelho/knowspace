/**
 * Disk persistence for ACP sessions.
 *
 * Each session lives in its own JSON file under ~/.knowspace/sessions/acp/
 * named <key-with-colons-replaced>.json. Writes are best-effort and
 * synchronous (the buffer is small — title + meta + message list).
 *
 * On boot, loadAll() returns the persisted sessions so session-store can
 * pre-populate its in-memory map. Restored sessions are marked
 * `attached: false` — sendMessage in adapters/providers/acp/index.js
 * detects that flag and reattaches to a fresh ACP server session before
 * forwarding the user's prompt.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_DIR = path.join(os.homedir(), '.knowspace', 'sessions', 'acp');

function getDir() {
  return process.env.KNOWSPACE_ACP_SESSIONS_DIR || DEFAULT_DIR;
}

function ensureDir() {
  const dir = getDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileForKey(key) {
  // session keys contain colons; flatten for a safe filename
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(getDir(), safe + '.json');
}

function snapshot(state) {
  return {
    key: state.key,
    providerSessionId: state.providerSessionId,
    agentId: state.agentId,
    cwd: state.cwd,
    createdAt: state.createdAt,
    label: state.label,
    // Strip _streaming flag — we only persist finalized messages, but
    // belt-and-suspenders in case someone calls save mid-stream.
    messages: (state.messages || []).map(({ _streaming, ...rest }) => rest),
    availableCommands: state.availableCommands || [],
  };
}

function save(state) {
  if (!state || !state.key) return;
  try {
    ensureDir();
    fs.writeFileSync(fileForKey(state.key), JSON.stringify(snapshot(state), null, 2));
  } catch (err) {
    console.error(`[acp.persistence] save failed for ${state.key}:`, err.message);
  }
}

function deleteFor(key) {
  try {
    const f = fileForKey(key);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch (err) {
    console.error(`[acp.persistence] delete failed for ${key}:`, err.message);
  }
}

function loadAll() {
  const dir = getDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      const data = JSON.parse(raw);
      out.push({
        ...data,
        // Restored sessions need to reattach before the next prompt
        attached: false,
        status: 'idle',
        promptInFlight: false,
        tools: [],
        lastError: null,
      });
    } catch (err) {
      console.error(`[acp.persistence] load failed for ${name}:`, err.message);
    }
  }
  return out;
}

module.exports = {
  getDir,
  fileForKey,
  save,
  deleteFor,
  loadAll,
  snapshot,
  DEFAULT_DIR,
};
