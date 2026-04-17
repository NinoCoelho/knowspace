const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const sessions = require('../../adapters/providers/openclaw/sessions');

describe('sessions', () => {
  let mockRpc;

  beforeEach(() => {
    mockRpc = mock.fn();
    sessions._setRpc(mockRpc);
  });

  describe('listSessions', () => {
    it('filters sessions by client prefix', async () => {
      mockRpc.mock.mockImplementation(async () => ({
        sessions: [
          { key: 'agent:acme:main', label: 'Main', updatedAt: '2025-01-01' },
          { key: 'agent:other:main', label: 'Other', updatedAt: '2025-01-01' },
          { key: 'agent:acme:web:direct:portal-abc', derivedTitle: 'Chat 2', updatedAt: '2025-01-02' },
        ],
      }));

      const result = await sessions.listSessions('acme');
      assert.equal(result.length, 2);
      assert.equal(result[0].key, 'agent:acme:main');
      assert.equal(result[1].key, 'agent:acme:web:direct:portal-abc');
    });

    it('returns empty array on gateway error after retries', async () => {
      mockRpc.mock.mockImplementation(async () => {
        throw new Error('connection refused');
      });

      const result = await sessions.listSessions('acme', 0);
      assert.deepEqual(result, []);
    });

    it('uses label, derivedTitle, title, or key suffix as label', async () => {
      mockRpc.mock.mockImplementation(async () => ({
        sessions: [
          { key: 'agent:acme:one', label: 'Custom Label' },
          { key: 'agent:acme:two', derivedTitle: 'Derived' },
          { key: 'agent:acme:three', title: 'Title' },
          { key: 'agent:acme:four' },
        ],
      }));

      const result = await sessions.listSessions('acme');
      assert.equal(result[0].label, 'Custom Label');
      assert.equal(result[1].label, 'Derived');
      assert.equal(result[2].label, 'Title');
      assert.equal(result[3].label, 'four');
    });
  });

  describe('createSession', () => {
    it('calls gateway and returns new session key', async () => {
      mockRpc.mock.mockImplementation(async () => ({}));

      const key = await sessions.createSession('acme');
      assert.match(key, /^agent:acme:web:direct:portal-/);
      assert.equal(mockRpc.mock.calls.length, 1);
      assert.equal(mockRpc.mock.calls[0].arguments[0], 'sessions.patch');
    });
  });

  describe('renameSession', () => {
    it('calls gateway with key and label', async () => {
      mockRpc.mock.mockImplementation(async () => ({}));

      await sessions.renameSession('agent:acme:main', 'New Name');
      const call = mockRpc.mock.calls[0];
      assert.equal(call.arguments[0], 'sessions.patch');
      assert.deepEqual(call.arguments[1], { key: 'agent:acme:main', label: 'New Name' });
    });
  });

  describe('deleteSession', () => {
    it('calls gateway with key', async () => {
      mockRpc.mock.mockImplementation(async () => ({}));

      await sessions.deleteSession('agent:acme:main');
      const call = mockRpc.mock.calls[0];
      assert.equal(call.arguments[0], 'sessions.delete');
      assert.deepEqual(call.arguments[1], { key: 'agent:acme:main' });
    });
  });
});
