const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractMessageText,
  isInternalMessage,
  normalizeMessages,
  detectAgentStatus,
  isIntermediateMessage,
} = require('../../adapters/engine/messages');

describe('extractMessageText', () => {
  it('returns empty for null/undefined', () => {
    assert.equal(extractMessageText(null), '');
    assert.equal(extractMessageText(undefined), '');
    assert.equal(extractMessageText({}), '');
  });

  it('extracts string content', () => {
    assert.equal(extractMessageText({ content: 'hello' }), 'hello');
  });

  it('extracts text blocks from array content', () => {
    const msg = {
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'tool_use', name: 'search' },
        { type: 'text', text: 'world' },
      ],
    };
    assert.equal(extractMessageText(msg), 'hello world');
  });

  it('returns empty for array with no text blocks', () => {
    const msg = { content: [{ type: 'tool_use', name: 'search' }] };
    assert.equal(extractMessageText(msg), '');
  });
});

describe('isInternalMessage', () => {
  it('detects "Exec denied" messages', () => {
    assert.ok(isInternalMessage('Exec denied for tool approval-timeout'));
  });

  it('detects "Do not run the command again"', () => {
    assert.ok(isInternalMessage('Do not run the command again please'));
  });

  it('detects "An async command did not run"', () => {
    assert.ok(isInternalMessage('An async command did not run because of timeout'));
  });

  it('detects case-insensitive "do not claim"', () => {
    assert.ok(isInternalMessage('Do not claim there is new command output'));
    assert.ok(isInternalMessage('do not claim there is new command output'));
  });

  it('passes normal messages through', () => {
    assert.ok(!isInternalMessage('Hello, how can I help you?'));
    assert.ok(!isInternalMessage('Here is the file you requested'));
  });
});

describe('normalizeMessages', () => {
  it('returns empty array for null/undefined', () => {
    assert.deepEqual(normalizeMessages(null), []);
    assert.deepEqual(normalizeMessages(undefined), []);
  });

  it('filters out system/tool roles', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'you are helpful' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: 'result' },
    ];
    const result = normalizeMessages(msgs);
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'user');
    assert.equal(result[1].role, 'assistant');
  });

  it('strips timestamp prefix from user messages', () => {
    const msgs = [{ role: 'user', content: '[2025-01-15 10:30] hello there' }];
    const result = normalizeMessages(msgs);
    assert.equal(result[0].content, 'hello there');
  });

  it('filters out internal messages', () => {
    const msgs = [
      { role: 'assistant', content: 'An async command did not run because timeout' },
      { role: 'assistant', content: 'Here is your answer' },
    ];
    const result = normalizeMessages(msgs);
    assert.equal(result.length, 1);
    assert.equal(result[0].content, 'Here is your answer');
  });

  it('filters out empty content messages', () => {
    const msgs = [
      { role: 'user', content: '' },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'x' }] },
      { role: 'user', content: 'real message' },
    ];
    const result = normalizeMessages(msgs);
    assert.equal(result.length, 1);
    assert.equal(result[0].content, 'real message');
  });

  it('preserves timestamps', () => {
    const msgs = [{ role: 'user', content: 'hi', timestamp: '2025-01-01T00:00:00Z' }];
    const result = normalizeMessages(msgs);
    assert.equal(result[0].timestamp, '2025-01-01T00:00:00Z');
  });
});

describe('detectAgentStatus', () => {
  it('returns thinking for empty messages', () => {
    assert.equal(detectAgentStatus([]), 'thinking');
  });

  it('returns executing when last block is tool_use', () => {
    const msgs = [
      { content: [{ type: 'text', text: 'let me check' }, { type: 'tool_use', name: 'search' }] },
    ];
    assert.equal(detectAgentStatus(msgs), 'executing');
  });

  it('returns thinking when last block is tool_result', () => {
    const msgs = [
      { content: [{ type: 'tool_use', name: 'search' }] },
      { content: [{ type: 'tool_result', content: 'found it' }] },
    ];
    assert.equal(detectAgentStatus(msgs), 'thinking');
  });

  it('handles string content gracefully', () => {
    const msgs = [{ content: 'just text' }];
    assert.equal(detectAgentStatus(msgs), 'thinking');
  });
});

describe('isIntermediateMessage', () => {
  it('returns true for tool_use without text', () => {
    const msg = { content: [{ type: 'tool_use', name: 'search' }] };
    assert.ok(isIntermediateMessage(msg));
  });

  it('returns false when text is present', () => {
    const msg = {
      content: [
        { type: 'text', text: 'Here is the result' },
        { type: 'tool_use', name: 'search' },
      ],
    };
    assert.ok(!isIntermediateMessage(msg));
  });

  it('returns false for text-only messages', () => {
    const msg = { content: [{ type: 'text', text: 'hello' }] };
    assert.ok(!isIntermediateMessage(msg));
  });

  it('returns false for null/undefined', () => {
    assert.ok(!isIntermediateMessage(null));
    assert.ok(!isIntermediateMessage(undefined));
  });

  it('returns false for string content', () => {
    assert.ok(!isIntermediateMessage({ content: 'hello' }));
  });

  it('treats whitespace-only text as no text', () => {
    const msg = {
      content: [
        { type: 'text', text: '   ' },
        { type: 'tool_use', name: 'search' },
      ],
    };
    assert.ok(isIntermediateMessage(msg));
  });
});
