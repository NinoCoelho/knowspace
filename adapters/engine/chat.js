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
 * Poll for an assistant reply after sending a message.
 *
 * @param {string} sessionKey
 * @param {number} msgCountBefore - message count before the send
 * @param {object} options
 * @param {function} [options.onProgress] - called with 'thinking' or 'executing'
 * @param {function} [options.isDisconnected] - returns true if client disconnected
 * @param {number} [options.pollIntervalMs=2000]
 * @param {number} [options.maxPolls=900]
 * @returns {{ found: boolean, reply: { role, content, timestamp } | null }}
 */
async function pollForReply(sessionKey, msgCountBefore, options = {}) {
  const {
    onProgress,
    isDisconnected,
    pollIntervalMs = 2000,
    maxPolls = 900,
  } = options;

  let lastStatus = 'thinking';

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    if (isDisconnected && isDisconnected()) {
      return { found: false, reply: null, disconnected: true };
    }

    let rawHistory;
    try {
      const result = await rpc('chat.history', { sessionKey, limit: 50 });
      rawHistory = result.messages || [];
    } catch {
      continue; // transient gateway error, keep polling
    }

    if (rawHistory.length > msgCountBefore) {
      const newRaw = rawHistory.slice(msgCountBefore);

      // Detect and report agent activity
      const currentStatus = messages.detectAgentStatus(newRaw);
      if (currentStatus !== lastStatus) {
        lastStatus = currentStatus;
        if (onProgress) onProgress(currentStatus);
      }

      // Check for a final assistant reply
      const normalizedNew = messages.normalizeMessages(newRaw);
      const assistantReply = normalizedNew.filter(m => m.role === 'assistant').pop();

      if (assistantReply) {
        // Verify this is a real final reply, not intermediate tool-calling
        const lastRaw = newRaw.filter(m => m.role === 'assistant').pop();
        if (messages.isIntermediateMessage(lastRaw)) continue;

        return {
          found: true,
          reply: {
            role: 'assistant',
            content: assistantReply.content,
            timestamp: assistantReply.timestamp || new Date().toISOString(),
          },
        };
      }
    }
  }

  return { found: false, reply: null, disconnected: false };
}

module.exports = {
  loadHistory,
  sendMessage,
  pollForReply,
  _setRpc(fn) { _rpc = fn; },
};
