const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const broker = require('../../lib/permission-broker');

const SAMPLE_OPTIONS = [
  { optionId: 'a-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'a-always', name: 'Allow always', kind: 'allow_always' },
  { optionId: 'r-once', name: 'Reject once', kind: 'reject_once' },
];

beforeEach(() => {
  broker._pendingForTest.clear();
  broker.setSocketProvider(null);
});

describe('lib/permission-broker', () => {
  it('falls back to allow_once when no socket is connected', async () => {
    const result = await broker.request({
      sessionKey: 'acp:claude-code:abc',
      toolCall: { title: 'Bash', input: { command: 'ls' } },
      options: SAMPLE_OPTIONS,
    });
    assert.equal(result.outcome.outcome, 'selected');
    assert.equal(result.outcome.optionId, 'a-once');
  });

  it('emits a permission:request to all connected sockets and resolves on respond()', async () => {
    const emitted = [];
    const fakeSocket = { emit: (event, payload) => emitted.push({ event, payload }) };
    broker.setSocketProvider(() => [fakeSocket]);

    const promise = broker.request({
      sessionKey: 'acp:claude-code:s1',
      toolCall: { title: 'Edit', input: { file: 'a.js' } },
      options: SAMPLE_OPTIONS,
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, 'permission:request');
    const { id } = emitted[0].payload;
    assert.ok(id);

    broker.respond(id, 'a-always');
    const result = await promise;
    assert.equal(result.outcome.optionId, 'a-always');
  });

  it('respond() returns false for unknown id', () => {
    assert.equal(broker.respond('nope', 'whatever'), false);
  });

  it('cancel() resolves the request as cancelled', async () => {
    const fakeSocket = { emit: () => {} };
    broker.setSocketProvider(() => [fakeSocket]);
    const promise = broker.request({
      sessionKey: 'acp:c:s',
      toolCall: { title: 't' },
      options: SAMPLE_OPTIONS,
    });
    const id = Array.from(broker._pendingForTest.keys())[0];
    broker.cancel(id);
    const r = await promise;
    assert.equal(r.outcome.outcome, 'cancelled');
  });

  it('times out and returns the default when no response arrives', async () => {
    const fakeSocket = { emit: () => {} };
    broker.setSocketProvider(() => [fakeSocket]);
    const promise = broker.request({
      sessionKey: 'acp:c:s',
      toolCall: { title: 't' },
      options: SAMPLE_OPTIONS,
      timeoutMs: 30,
    });
    const r = await promise;
    assert.equal(r.outcome.outcome, 'selected');
    assert.equal(r.outcome.optionId, 'a-once');
  });

  it('defaultDecision picks first option when no allow option exists', () => {
    const r = broker.defaultDecision([
      { optionId: 'r1', kind: 'reject_once' },
      { optionId: 'r2', kind: 'reject_always' },
    ]);
    assert.equal(r.outcome.optionId, 'r1');
  });

  it('pending count tracks active requests', async () => {
    const fakeSocket = { emit: () => {} };
    broker.setSocketProvider(() => [fakeSocket]);
    const p = broker.request({
      sessionKey: 'k',
      toolCall: { title: 't' },
      options: SAMPLE_OPTIONS,
    });
    assert.equal(broker.pendingCount(), 1);
    const id = Array.from(broker._pendingForTest.keys())[0];
    broker.respond(id, 'a-once');
    await p;
    assert.equal(broker.pendingCount(), 0);
  });
});
