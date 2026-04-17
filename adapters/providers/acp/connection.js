/**
 * ACP connection manager.
 *
 * Owns at most one spawned subprocess per agent recipe. The subprocess
 * is an ACP server (e.g. `npx @agentclientprotocol/claude-agent-acp`,
 * `hermes acp`); we are the ACP client.
 *
 * Exposes a small surface — getOrCreate(recipe) returns a connection
 * with `newSession`, `prompt`, `cancel`, and a per-session subscription
 * callback registered via `onSessionUpdate`. Sessions are managed by
 * the higher-level session-store module; this layer only owns the
 * connection lifecycle.
 *
 * The @agentclientprotocol/sdk package is ESM-only, so we load it via
 * dynamic import on first use.
 */

const { spawn } = require('node:child_process');
const { Readable, Writable } = require('node:stream');

let _sdkPromise = null;
function loadSdk() {
  if (!_sdkPromise) _sdkPromise = import('@agentclientprotocol/sdk');
  return _sdkPromise;
}

const connections = new Map();

function makeClientHandler({ onSessionUpdate, onPermission, fileOps }) {
  return {
    async sessionUpdate(params) {
      if (process.env.KNOWSPACE_ACP_DEBUG) {
        console.error('[acp.debug] sessionUpdate:', params?.sessionId, JSON.stringify(params?.update).slice(0, 200));
      }
      try { onSessionUpdate(params); }
      catch (err) { console.error('[acp] sessionUpdate handler error:', err.message); }
    },
    async requestPermission(params) {
      // Default: allow_once if available — YOLO mode per spec for v2.
      // Callers can override via onPermission to gate behavior.
      if (onPermission) {
        try {
          const decision = await onPermission(params);
          if (decision) return decision;
        } catch (err) {
          console.error('[acp] onPermission handler error:', err.message);
        }
      }
      const opt = params.options?.find(o => o.kind === 'allow_once' || o.kind === 'allow_always')
                  ?? params.options?.[0];
      return { outcome: { outcome: 'selected', optionId: opt?.optionId } };
    },
    async readTextFile(params) {
      if (fileOps?.readTextFile) return fileOps.readTextFile(params);
      const fs = require('node:fs/promises');
      return { content: await fs.readFile(params.path, 'utf8') };
    },
    async writeTextFile(params) {
      if (fileOps?.writeTextFile) return fileOps.writeTextFile(params);
      const fs = require('node:fs/promises');
      await fs.writeFile(params.path, params.content, 'utf8');
      return null;
    },
    async createTerminal() { throw new Error('terminal ops not implemented yet'); },
    async terminalOutput() { throw new Error('terminal ops not implemented yet'); },
    async releaseTerminal() { return null; },
    async waitForTerminalExit() { throw new Error('terminal ops not implemented yet'); },
    async killTerminal() { return null; },
  };
}

async function spawnAndConnect(recipe, hooks) {
  const sdk = await loadSdk();

  const child = spawn(recipe.cmd, recipe.args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env,
  });

  const input = Readable.toWeb(child.stdout);
  const output = Writable.toWeb(child.stdin);
  const stream = sdk.ndJsonStream(output, input);

  const conn = new sdk.ClientSideConnection(
    () => makeClientHandler(hooks),
    stream,
  );

  // Initialize handshake — required before anything else
  const init = await conn.initialize({
    protocolVersion: sdk.PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
    },
    clientInfo: { name: 'knowspace', version: '2.0.0' },
  });

  return {
    recipe,
    child,
    conn,
    init,
    closed: false,
  };
}

/**
 * Get or create a long-lived ACP connection for the given recipe.
 * The hooks are stored once; subsequent getOrCreate calls reuse them.
 */
async function getOrCreate(recipe, hooks) {
  const existing = connections.get(recipe.id);
  if (existing && !existing.closed) return existing;

  const conn = await spawnAndConnect(recipe, hooks);
  conn.child.on('exit', (code, sig) => {
    conn.closed = true;
    if (connections.get(recipe.id) === conn) connections.delete(recipe.id);
    console.log(`[acp] ${recipe.id} exited (code=${code} sig=${sig})`);
  });
  conn.child.on('error', (err) => {
    console.error(`[acp] ${recipe.id} child error:`, err.message);
  });
  connections.set(recipe.id, conn);
  return conn;
}

function shutdownAll() {
  for (const conn of connections.values()) {
    try { conn.child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  connections.clear();
}

module.exports = { getOrCreate, shutdownAll };
