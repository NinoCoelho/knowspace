const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const chat = require('../../adapters/engine/chat');

describe('chat', () => {
  let mockRpc;

  beforeEach(() => {
    mockRpc = mock.fn();
    chat._setRpc(mockRpc);
  });

  describe('loadHistory', () => {
    it('returns normalized messages', async () => {
      mockRpc.mock.mockImplementation(async () => ({
        messages: [
          { role: 'user', content: '[2025-01-01 10:00] hello' },
          { role: 'assistant', content: 'hi there' },
          { role: 'system', content: 'you are helpful' },
        ],
      }));

      const result = await chat.loadHistory('agent:acme:main');
      assert.equal(result.length, 2);
      assert.equal(result[0].content, 'hello');
      assert.equal(result[1].content, 'hi there');
    });

    it('returns empty array on gateway error', async () => {
      mockRpc.mock.mockImplementation(async () => {
        throw new Error('connection refused');
      });

      const result = await chat.loadHistory('agent:acme:main');
      assert.deepEqual(result, []);
    });
  });

  describe('sendMessage', () => {
    it('calls gateway with correct params', async () => {
      mockRpc.mock.mockImplementation(async () => ({}));

      await chat.sendMessage('agent:acme:main', 'hello world');
      const call = mockRpc.mock.calls[0];
      assert.equal(call.arguments[0], 'chat.send');
      assert.equal(call.arguments[1].sessionKey, 'agent:acme:main');
      assert.equal(call.arguments[1].message, 'hello world');
      assert.equal(call.arguments[1].deliver, true);
    });
  });

  describe('pollForReply', () => {
    it('finds a reply when new assistant message appears', async () => {
      let callCount = 0;
      mockRpc.mock.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { messages: [{ role: 'user', content: 'hello' }] };
        }
        return {
          messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: [{ type: 'text', text: 'hi there' }], timestamp: '2025-01-01T00:00:00Z' },
          ],
        };
      });

      const result = await chat.pollForReply('agent:acme:main', 1, {
        pollIntervalMs: 10,
        maxPolls: 5,
      });

      assert.ok(result.found);
      assert.equal(result.reply.content, 'hi there');
      assert.equal(result.reply.role, 'assistant');
    });

    it('returns not found after max polls', async () => {
      mockRpc.mock.mockImplementation(async () => ({
        messages: [{ role: 'user', content: 'hello' }],
      }));

      const result = await chat.pollForReply('agent:acme:main', 1, {
        pollIntervalMs: 10,
        maxPolls: 3,
      });

      assert.ok(!result.found);
      assert.equal(result.reply, null);
    });

    it('stops polling when disconnected', async () => {
      mockRpc.mock.mockImplementation(async () => ({
        messages: [{ role: 'user', content: 'hello' }],
      }));

      const result = await chat.pollForReply('agent:acme:main', 1, {
        pollIntervalMs: 10,
        maxPolls: 100,
        isDisconnected: () => true,
      });

      assert.ok(!result.found);
      assert.ok(result.disconnected);
    });

    it('calls onProgress when status changes', async () => {
      let callCount = 0;
      mockRpc.mock.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            messages: [
              { role: 'user', content: 'hello' },
              { role: 'assistant', content: [{ type: 'tool_use', name: 'search' }] },
            ],
          };
        }
        return {
          messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: [{ type: 'tool_use', name: 'search' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'found it' }], timestamp: '2025-01-01T00:00:00Z' },
          ],
        };
      });

      const statuses = [];
      await chat.pollForReply('agent:acme:main', 1, {
        pollIntervalMs: 10,
        maxPolls: 5,
        onProgress: (s) => statuses.push(s),
      });

      assert.ok(statuses.includes('executing'));
    });

    it('skips intermediate tool-use-only messages', async () => {
      let callCount = 0;
      mockRpc.mock.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            messages: [
              { role: 'user', content: 'hello' },
              { role: 'assistant', content: [{ type: 'tool_use', name: 'search' }] },
            ],
          };
        }
        return {
          messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: [{ type: 'tool_use', name: 'search' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: '2025-01-01T00:00:00Z' },
          ],
        };
      });

      const result = await chat.pollForReply('agent:acme:main', 1, {
        pollIntervalMs: 10,
        maxPolls: 10,
      });

      assert.ok(result.found);
      assert.equal(result.reply.content, 'done');
    });
  });
});
