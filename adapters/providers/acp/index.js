/**
 * ACP provider — covers Claude Code, Hermes, Codex, Gemini and any
 * future ACP-compatible coding agent through a single implementation.
 *
 * Session keys have the form `acp:<agentId>:<providerSessionId>`. The
 * provider parses the key to dispatch to the right subprocess. Sessions
 * are kept in-memory (see session-store.js) — they don't currently
 * survive a server restart.
 */

const path = require('node:path');
const os = require('node:os');

const agents = require('./agents');
const connection = require('./connection');
const store = require('./session-store');

const SESSION_PREFIX = 'acp:';

function buildSessionKey(agentId, providerSessionId) {
  return `${SESSION_PREFIX}${agentId}:${providerSessionId}`;
}

function parseSessionKey(key) {
  if (!key || !key.startsWith(SESSION_PREFIX)) {
    throw new Error(`not an ACP session key: ${key}`);
  }
  const rest = key.slice(SESSION_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon === -1) throw new Error(`malformed ACP session key: ${key}`);
  return { agentId: rest.slice(0, colon), providerSessionId: rest.slice(colon + 1) };
}

let _recipeOverrides = {};

function setRecipeOverrides(overrides) {
  _recipeOverrides = overrides || {};
}

function getRecipe(agentId) {
  const r = agents.recipeById(agentId, _recipeOverrides);
  if (!r) throw new Error(`unknown ACP agent: ${agentId}`);
  if (!r.cmd) throw new Error(`ACP agent ${agentId} has no cmd configured`);
  return r;
}

async function ensureConnection(agentId) {
  const recipe = getRecipe(agentId);
  return connection.getOrCreate(recipe, {
    onSessionUpdate(params) {
      const key = buildSessionKey(agentId, params.sessionId);
      const state = store.get(key);
      if (!state) return; // session may have been deleted
      store.applyUpdate(state, params.update);
    },
  });
}

async function listAgents() {
  return agents.listRecipes(_recipeOverrides).map(r => ({
    id: r.id,
    name: r.name,
    kind: r.kind || 'chat',
    description: r.description,
    defaultCwd: r.defaultCwd,
  }));
}

async function listSessions(agentId) {
  return store.listForAgent(agentId).map(s => ({
    key: s.key,
    label: s.label || (s.messages.find(m => m.role === 'user')?.content?.slice(0, 60)) || 'New chat',
    updatedAt: new Date(s.createdAt).toISOString(),
    isSubagent: false,
  }));
}

async function createSession(agentId, opts = {}) {
  const conn = await ensureConnection(agentId);
  const cwd = opts.cwd || process.cwd();
  const resp = await conn.conn.newSession({ cwd, mcpServers: [] });
  const key = buildSessionKey(agentId, resp.sessionId);
  const state = store.makeSession({
    key,
    providerSessionId: resp.sessionId,
    agentId,
    cwd,
  });
  if (opts.label) state.label = opts.label;
  store.add(state);
  return key;
}

async function renameSession(sessionKey, label) {
  const state = store.get(sessionKey);
  if (state) state.label = label;
}

async function deleteSession(sessionKey) {
  const state = store.get(sessionKey);
  if (!state) return;
  // Best-effort: ACP doesn't require explicit delete. We could call
  // session/cancel here for in-flight prompts, but for v2.0 we just
  // drop the local buffer.
  store.remove(sessionKey);
}

async function loadHistory(sessionKey, _limit) {
  const state = store.get(sessionKey);
  if (!state) return [];
  // Strip internal _streaming flag before returning
  return state.messages.map(({ _streaming, ...rest }) => rest);
}

async function sendMessage(sessionKey, text) {
  const state = store.get(sessionKey);
  if (!state) throw new Error(`unknown session: ${sessionKey}`);
  store.recordUserMessage(state, text);
  store.setPromptInFlight(state, true);

  const conn = await ensureConnection(state.agentId);
  // prompt() resolves on turn end. We don't await here — callers use
  // pollForReply to drive the UI loop. Kick it off and track completion.
  conn.conn.prompt({
    sessionId: state.providerSessionId,
    prompt: [{ type: 'text', text }],
  })
    .then(() => {
      store.finalizeStreamingMessage(state);
      store.setPromptInFlight(state, false);
    })
    .catch((err) => {
      console.error(`[acp] prompt rejected for ${sessionKey}: ${err.message}`);
      state.lastError = err.message;
      store.setPromptInFlight(state, false);
    });
}

async function pollForReply(sessionKey, msgCountBefore, opts = {}) {
  const {
    onProgress,
    onMessage,
    isDisconnected,
    pollIntervalMs = 250,    // ACP is push-based; we poll the buffer fast
    maxPolls = 7200,         // ~30 min at 250ms
    idlePollsToStop = 4,
  } = opts;

  const state = store.get(sessionKey);
  if (!state) return { found: false, disconnected: false };

  // Track which assistant messages we've already emitted by reference.
  // Walking from msgCountBefore each tick + this set means streaming
  // messages get re-checked until finalized, then emitted exactly once.
  const emitted = new WeakSet();
  let lastStatus = state.status;
  let found = false;
  let idlePolls = 0;

  function flushNewFinalReplies() {
    for (let idx = msgCountBefore; idx < state.messages.length; idx++) {
      const m = state.messages[idx];
      if (m.role !== 'assistant') continue;
      if (m._streaming) continue; // not finalized yet
      if (emitted.has(m)) continue;
      emitted.add(m);
      if (onMessage) {
        const { _streaming, ...rest } = m;
        onMessage(rest);
      }
      found = true;
    }
  }

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    if (isDisconnected && isDisconnected()) {
      return { found, disconnected: true };
    }

    if (state.status !== lastStatus) {
      lastStatus = state.status;
      if (onProgress) onProgress({ status: state.status, tools: state.tools.slice(-5) });
    }

    const beforeFlush = found;
    flushNewFinalReplies();

    const hasUnfinalizedTail = state.messages.some(m => m._streaming);
    const stillWorking = state.promptInFlight || state.status === 'executing' || hasUnfinalizedTail;

    if (found > beforeFlush) {
      idlePolls = 0;
    } else if (!stillWorking) {
      idlePolls++;
      if (found && idlePolls >= idlePollsToStop) break;
      if (!found && idlePolls >= idlePollsToStop * 8) break; // give up if nothing came
    } else {
      idlePolls = 0;
    }
  }

  // Final flush in case the loop exited right as a message finalized.
  flushNewFinalReplies();

  return { found, disconnected: false };
}

async function health() {
  // We don't actively probe agents on every health check. Just confirm
  // the SDK loads. Per-agent health comes when a session is requested.
  try {
    await import('@agentclientprotocol/sdk');
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/** @type {import('../types').Provider} */
const provider = {
  id: 'acp',
  capabilities: {
    persistentSessions: true,  // within a server lifetime
    streaming: 'native',
    toolUse: true,
    fileAttachments: false,    // not wired through yet
    cwdBinding: true,
    multiAgent: true,
  },
  listAgents,
  listSessions,
  createSession,
  renameSession,
  deleteSession,
  loadHistory,
  sendMessage,
  pollForReply,
  health,
};

module.exports = {
  provider,
  setRecipeOverrides,
  // Test seams
  _buildSessionKey: buildSessionKey,
  _parseSessionKey: parseSessionKey,
  _store: store,
  _connection: connection,
};
