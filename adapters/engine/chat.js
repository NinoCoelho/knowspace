/**
 * Chat operations adapter for the upstream engine.
 * Wraps all chat-related gateway RPC calls including the polling loop.
 */

const crypto = require('crypto');
const messages = require('./messages');

let _rpc = null;
function rpc(...args) {
  if (!_rpc) _rpc = require('../../lib/gateway').gatewayRpc;
  return _rpc(...args);
}

async function loadHistory(sessionKey, limit = 50) {
  try {
    const result = await rpc('chat.history', { sessionKey, limit });
    return messages.normalizeMessages(result.messages);
  } catch (error) {
    console.error('Error loading gateway history:', error.message);
    return [];
  }
}

async function sendMessage(sessionKey, messageText, options = {}) {
  const { timeoutMs = 30 * 60 * 1000, idempotencyKey } = options;
  await rpc('chat.send', {
    sessionKey,
    message: messageText,
    deliver: true,
    timeoutMs,
    idempotencyKey: idempotencyKey || crypto.randomUUID(),
  });
}

/**
 * Poll for assistant replies after sending a message.
 * Calls onMessage for each new final reply as it arrives, then keeps polling
 * for additional messages until the agent is idle.
 *
 * @param {string} sessionKey
 * @param {number} msgCountBefore - normalized message count before the send
 * @param {object} options
 * @param {function} [options.onProgress] - called with 'thinking' or 'executing'
 * @param {function} [options.onMessage]  - called with each new reply { role, content, timestamp }
 * @param {function} [options.isDisconnected] - returns true if client disconnected
 * @param {number}   [options.pollIntervalMs=2000]
 * @param {number}   [options.maxPolls=900]
 * @param {number}   [options.idlePollsToStop=3] - consecutive idle polls after last message before stopping
 * @returns {{ found: boolean, disconnected: boolean }}
 */
async function pollForReply(sessionKey, msgCountBefore, options = {}) {
  const {
    onProgress,
    onMessage,
    isDisconnected,
    pollIntervalMs = 2000,
    maxPolls = 900,
    idlePollsToStop = 3,
  } = options;

  let lastStatus = 'thinking';
  let lastSeenCount = msgCountBefore;
  let found = false;
  let idlePolls = 0;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    if (isDisconnected && isDisconnected()) {
      return { found, disconnected: true };
    }

    let rawHistory;
    try {
      const result = await rpc('chat.history', { sessionKey, limit: 50 });
      rawHistory = result.messages || [];
    } catch {
      continue; // transient gateway error, keep polling
    }

    // Always compare normalized counts — msgCountBefore is derived from normalized history
    const normalizedHistory = messages.normalizeMessages(rawHistory);
    const currentStatus = messages.detectAgentStatus(rawHistory);

    if (currentStatus !== lastStatus) {
      lastStatus = currentStatus;
      if (onProgress) onProgress({ status: currentStatus, tools: [] });
    }

    // Always extract and forward tool activity
    if (currentStatus === 'executing') {
      const tools = messages.extractToolActivity(rawHistory);
      if (tools.length > 0 && onProgress) onProgress({ status: currentStatus, tools });
    }

    if (normalizedHistory.length > lastSeenCount) {
      const newNormalized = normalizedHistory.slice(lastSeenCount);
      const lastRaw = rawHistory.filter(m => m.role === 'assistant').pop();
      const isIntermediate = messages.isIntermediateMessage(lastRaw);

      // Emit each new final assistant message immediately
      for (const msg of newNormalized) {
        if (msg.role !== 'assistant') continue;
        if (isIntermediate) continue; // last raw msg still has pending tool_use — don't emit yet
        if (onMessage) onMessage({
          role: 'assistant',
          content: msg.content,
          timestamp: msg.timestamp || new Date().toISOString(),
          ...(msg.subagent ? { subagent: msg.subagent } : {}),
        });
        found = true;
      }

      lastSeenCount = normalizedHistory.length;
      idlePolls = 0;
    } else {
      // No new messages this poll
      const lastRaw = rawHistory.filter(m => m.role === 'assistant').pop();
      const agentStillWorking = messages.isIntermediateMessage(lastRaw) || currentStatus === 'executing';

      if (!agentStillWorking) {
        idlePolls++;
        // Once we've seen at least one reply and the agent has been quiet for
        // idlePollsToStop consecutive polls, consider it done.
        if (found && idlePolls >= idlePollsToStop) break;
      } else {
        idlePolls = 0; // reset — agent is still doing tool work between messages
      }
    }
  }

  return { found, disconnected: false };
}

module.exports = {
  loadHistory,
  sendMessage,
  pollForReply,
  _setRpc(fn) { _rpc = fn; },
};
