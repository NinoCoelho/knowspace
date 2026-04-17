// Regression test for the streaming-finalize race in pollForReply.
//
// Bug: the original loop advanced `lastSeenCount` past streaming messages
// when it skipped them, so when the message finally finalized it was
// already "behind" the cursor and never emitted.
//
// Fix: walk from msgCountBefore each tick, track emitted messages by
// reference (WeakSet), and emit only on transition from streaming -> final.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const acp = require('../../../adapters/providers/acp');
const store = require('../../../adapters/providers/acp/session-store');

function freshSession(key = 'acp:claude-code:test') {
  store._sessionsForTest.clear();
  const s = store.makeSession({
    key,
    providerSessionId: 'test',
    agentId: 'claude-code',
    cwd: '/tmp',
  });
  store.add(s);
  return s;
}

describe('acp/pollForReply', () => {
  beforeEach(() => store._sessionsForTest.clear());

  it('returns no replies for an unknown session', async () => {
    const r = await acp.provider.pollForReply('acp:claude-code:nope', 0, {
      pollIntervalMs: 1,
      maxPolls: 1,
    });
    assert.deepEqual(r, { found: false, disconnected: false });
  });

  it('emits a streaming message exactly once after it finalizes', async () => {
    const s = freshSession();
    s.promptInFlight = true;
    store.recordUserMessage(s, 'hi');

    // Schedule chunks + finalize on a separate timeline.
    setTimeout(() => store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'hello ' } }), 10);
    setTimeout(() => store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'world' } }), 20);
    setTimeout(() => {
      store.finalizeStreamingMessage(s);
      store.setPromptInFlight(s, false);
    }, 30);

    const replies = [];
    const r = await acp.provider.pollForReply(s.key, 1 /* msgCountBefore: just user */, {
      pollIntervalMs: 5,
      maxPolls: 100,
      onMessage: (m) => replies.push(m),
    });

    assert.equal(r.found, true);
    assert.equal(replies.length, 1, 'message should be emitted exactly once');
    assert.equal(replies[0].content, 'hello world');
    assert.equal(replies[0].role, 'assistant');
  });

  it('does not emit while a message is still streaming', async () => {
    const s = freshSession('acp:claude-code:s2');
    s.promptInFlight = true;
    store.recordUserMessage(s, 'hi');

    // Chunks arrive but never finalize during the poll window.
    setTimeout(() => store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'partial' } }), 5);

    const replies = [];
    const r = await acp.provider.pollForReply(s.key, 1, {
      pollIntervalMs: 5,
      maxPolls: 6, // ~30ms of polling, never finalizes
      onMessage: (m) => replies.push(m),
    });

    assert.equal(r.found, false);
    assert.equal(replies.length, 0);
  });

  it('emits multiple final messages in arrival order', async () => {
    const s = freshSession('acp:claude-code:s3');
    s.promptInFlight = true;
    store.recordUserMessage(s, 'hi');

    setTimeout(() => {
      store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'first' } });
      store.finalizeStreamingMessage(s);
      // Start a second streaming message
      store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'second' } });
      store.finalizeStreamingMessage(s);
      store.setPromptInFlight(s, false);
    }, 10);

    const replies = [];
    const r = await acp.provider.pollForReply(s.key, 1, {
      pollIntervalMs: 5,
      maxPolls: 50,
      onMessage: (m) => replies.push(m),
    });

    assert.equal(r.found, true);
    assert.deepEqual(replies.map(m => m.content), ['first', 'second']);
  });

  it('respects isDisconnected', async () => {
    const s = freshSession('acp:claude-code:s4');
    let polls = 0;
    const r = await acp.provider.pollForReply(s.key, 0, {
      pollIntervalMs: 5,
      maxPolls: 100,
      isDisconnected: () => { polls++; return polls > 2; },
    });
    assert.equal(r.disconnected, true);
  });

  it('fires onProgress when status changes', async () => {
    const s = freshSession('acp:claude-code:s5');
    s.promptInFlight = true;
    setTimeout(() => store.applyUpdate(s, { sessionUpdate: 'tool_call', title: 'Bash', kind: 'execute' }), 10);
    setTimeout(() => {
      store.applyUpdate(s, { sessionUpdate: 'tool_call_update', status: 'completed' });
      store.setPromptInFlight(s, false);
    }, 20);

    const statuses = [];
    await acp.provider.pollForReply(s.key, 0, {
      pollIntervalMs: 5,
      maxPolls: 30,
      onProgress: (p) => statuses.push(p.status),
    });

    assert.ok(statuses.includes('executing'), `expected executing, got ${statuses.join(',')}`);
  });
});
