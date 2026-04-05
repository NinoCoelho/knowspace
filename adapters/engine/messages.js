/**
 * Message normalization and filtering for upstream engine messages.
 * Centralizes all knowledge of the engine's message format.
 */

// System/internal messages that should never appear in client chat
const INTERNAL_MESSAGE_PATTERNS = [
  /^An async command did not run\b/,
  /\bExec denied\b.*\bapproval-timeout\b/,
  /\bDo not run the command again\b/,
  /\bDo not mention, summarize, or reuse output\b/,
  /\bReply to the user in a helpful way\b/,
  /\bdo not claim there is new command output\b/i,
];

function extractMessageText(message) {
  if (!message || !message.content) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
  }
  return '';
}

function isInternalMessage(text) {
  return INTERNAL_MESSAGE_PATTERNS.some(p => p.test(text));
}

function normalizeMessages(messages) {
  return (messages || [])
    .filter(m => (m.role === 'user' || m.role === 'assistant'))
    .map(m => {
      let text = extractMessageText(m);
      if (m.role === 'user') {
        text = text.replace(/^\[[\w\s:-]+\]\s*/, '');
      }
      return { role: m.role, content: text, timestamp: m.timestamp };
    })
    .filter(m => m.content)
    .filter(m => !isInternalMessage(m.content));
}

/**
 * Detect agent processing status from raw message content blocks.
 * Returns 'thinking' or 'executing'.
 */
function detectAgentStatus(rawMessages) {
  let status = 'thinking';
  for (const m of rawMessages) {
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'tool_use') status = 'executing';
        if (block.type === 'tool_result') status = 'thinking';
      }
    }
  }
  return status;
}

/**
 * Check if a raw assistant message is intermediate (still working, not a final reply).
 * Returns true if the message has tool_use blocks but no text content.
 */
function isIntermediateMessage(rawMessage) {
  if (!rawMessage || !Array.isArray(rawMessage.content)) return false;
  const hasToolUse = rawMessage.content.some(b => b.type === 'tool_use');
  const hasText = rawMessage.content.some(b => b.type === 'text' && b.text.trim());
  return hasToolUse && !hasText;
}

module.exports = {
  INTERNAL_MESSAGE_PATTERNS,
  extractMessageText,
  isInternalMessage,
  normalizeMessages,
  detectAgentStatus,
  isIntermediateMessage,
};
