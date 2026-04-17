/**
 * In-memory store for ACP sessions, backed by per-session JSON files
 * under ~/.knowspace/sessions/acp/.
 *
 * ACP itself is push-based: the agent emits sessionUpdate notifications
 * that arrive while a prompt() call is in flight. Knowspace's existing
 * server.js loop is poll-based: it calls loadHistory + pollForReply
 * after each send. To bridge the two, we accumulate updates into a
 * per-session buffer here, and pollForReply walks the buffer.
 *
 * Sessions survive a server restart: the message history and metadata
 * are persisted on every meaningful mutation. Restored sessions are
 * marked `attached: false` — index.js detects that and creates a fresh
 * ACP session under the same Knowspace key before the next prompt.
 */

const persistence = require('./persistence');

const sessions = new Map(); // sessionKey -> SessionState

function loadFromDisk() {
  for (const data of persistence.loadAll()) {
    sessions.set(data.key, data);
  }
}

// Pre-populate from disk on first require.
loadFromDisk();

function makeSession({ key, providerSessionId, agentId, cwd }) {
  return {
    key,
    providerSessionId,
    agentId,
    cwd,
    createdAt: Date.now(),
    label: null,
    messages: [],   // { role, content, timestamp, [subagent] }
    tools: [],      // last reported tool activity
    status: 'idle', // 'idle' | 'thinking' | 'executing'
    promptInFlight: false,
    availableCommands: [],
    lastError: null,
    attached: true, // false after restore from disk — needs reattach
  };
}

function add(state) {
  sessions.set(state.key, state);
  persistence.save(state);
}
function get(key)   { return sessions.get(key); }
function remove(key){
  const ok = sessions.delete(key);
  persistence.deleteFor(key);
  return ok;
}
function listForAgent(agentId) {
  return Array.from(sessions.values())
    .filter(s => s.agentId === agentId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Apply an ACP sessionUpdate notification to the buffer.
 * This is intentionally lossy w.r.t. partial chunks: agent_message_chunk
 * deltas accumulate into a single trailing assistant message until the
 * turn ends or a non-chunk update arrives.
 */
function applyUpdate(state, update) {
  if (!state || !update) return;
  const u = update.sessionUpdate;
  switch (u) {
    case 'agent_message_chunk': {
      const text = update.content?.text ?? '';
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant' && last._streaming) {
        last.content += text;
      } else {
        state.messages.push({
          role: 'assistant',
          content: text,
          timestamp: new Date().toISOString(),
          _streaming: true,
        });
      }
      break;
    }
    case 'agent_thought_chunk':
      state.status = 'thinking';
      break;
    case 'tool_call':
      state.status = 'executing';
      state.tools.push({ tool: update.title || update.kind || 'tool', preview: '' });
      break;
    case 'tool_call_update':
      if (update.status && update.status !== 'in_progress') state.status = 'thinking';
      break;
    case 'plan':
      // Could surface plan updates as a separate channel; not yet wired.
      break;
    case 'available_commands_update':
      state.availableCommands = (update.availableCommands || []).map(c => ({
        name: c.name, description: c.description,
      }));
      break;
    case 'current_mode_update':
      // mode info — ignore for now
      break;
    case 'usage_update':
      // cost/tokens — ignore for now
      break;
    default:
      // Unknown update kind — record but don't crash
      break;
  }
}

function recordUserMessage(state, text) {
  state.messages.push({
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  });
  persistence.save(state);
}

function finalizeStreamingMessage(state) {
  // After a turn ends, mark the trailing streaming assistant message as final.
  const last = state.messages[state.messages.length - 1];
  if (last && last._streaming) {
    delete last._streaming;
    persistence.save(state);
  }
}

function setPromptInFlight(state, value) {
  state.promptInFlight = value;
  if (!value) state.status = 'idle';
}

function updateLabel(state, label) {
  state.label = label;
  persistence.save(state);
}

function markAttached(state, providerSessionId) {
  state.attached = true;
  if (providerSessionId) state.providerSessionId = providerSessionId;
  persistence.save(state);
}

module.exports = {
  makeSession,
  add, get, remove,
  listForAgent,
  applyUpdate,
  recordUserMessage,
  finalizeStreamingMessage,
  setPromptInFlight,
  updateLabel,
  markAttached,
  _sessionsForTest: sessions,
  _loadFromDisk: loadFromDisk,
};
