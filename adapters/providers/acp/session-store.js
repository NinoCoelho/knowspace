/**
 * In-memory store for ACP sessions.
 *
 * ACP itself is push-based: the agent emits sessionUpdate notifications
 * that arrive while a prompt() call is in flight. Knowspace's existing
 * server.js loop is poll-based: it calls loadHistory + pollForReply
 * after each send. To bridge the two, we accumulate updates into a
 * per-session buffer here, and pollForReply walks the buffer.
 *
 * Sessions do not currently survive a server restart. That's acceptable
 * for v2.0; persistence comes later when ACP's session/list and
 * session/resume are wired through.
 */

const sessions = new Map(); // sessionKey -> SessionState

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
  };
}

function add(state) { sessions.set(state.key, state); }
function get(key)   { return sessions.get(key); }
function remove(key){ return sessions.delete(key); }
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
}

function finalizeStreamingMessage(state) {
  // After a turn ends, mark the trailing streaming assistant message as final.
  const last = state.messages[state.messages.length - 1];
  if (last && last._streaming) delete last._streaming;
}

function setPromptInFlight(state, value) {
  state.promptInFlight = value;
  if (!value) state.status = 'idle';
}

module.exports = {
  makeSession,
  add, get, remove,
  listForAgent,
  applyUpdate,
  recordUserMessage,
  finalizeStreamingMessage,
  setPromptInFlight,
  _sessionsForTest: sessions,
};
