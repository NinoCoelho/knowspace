const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../../../adapters/providers/acp/session-store');

function freshSession() {
  return store.makeSession({
    key: 'acp:claude-code:abc',
    providerSessionId: 'abc',
    agentId: 'claude-code',
    cwd: '/tmp',
  });
}

describe('acp/session-store', () => {
  beforeEach(() => store._sessionsForTest.clear());

  it('add/get/remove roundtrip', () => {
    const s = freshSession();
    store.add(s);
    assert.equal(store.get(s.key), s);
    store.remove(s.key);
    assert.equal(store.get(s.key), undefined);
  });

  it('listForAgent filters by agentId and sorts newest first', () => {
    const a = store.makeSession({ key: 'acp:c:1', providerSessionId: '1', agentId: 'c', cwd: '/' });
    a.createdAt = 100;
    const b = store.makeSession({ key: 'acp:c:2', providerSessionId: '2', agentId: 'c', cwd: '/' });
    b.createdAt = 200;
    const c = store.makeSession({ key: 'acp:other:3', providerSessionId: '3', agentId: 'other', cwd: '/' });
    store.add(a); store.add(b); store.add(c);
    const list = store.listForAgent('c');
    assert.deepEqual(list.map(s => s.key), ['acp:c:2', 'acp:c:1']);
  });

  it('agent_message_chunk updates accumulate into a single streaming message', () => {
    const s = freshSession(); store.add(s);
    store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'Hello, ' } });
    store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'world!' } });
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].content, 'Hello, world!');
    assert.equal(s.messages[0]._streaming, true);
  });

  it('finalizeStreamingMessage drops the _streaming flag', () => {
    const s = freshSession(); store.add(s);
    store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'done' } });
    store.finalizeStreamingMessage(s);
    assert.equal(s.messages[0]._streaming, undefined);
  });

  it('tool_call sets status to executing and records tool', () => {
    const s = freshSession(); store.add(s);
    store.applyUpdate(s, { sessionUpdate: 'tool_call', title: 'Bash', kind: 'execute' });
    assert.equal(s.status, 'executing');
    assert.equal(s.tools.length, 1);
    assert.equal(s.tools[0].tool, 'Bash');
  });

  it('tool_call_update with completed status returns to thinking', () => {
    const s = freshSession(); store.add(s);
    s.status = 'executing';
    store.applyUpdate(s, { sessionUpdate: 'tool_call_update', status: 'completed' });
    assert.equal(s.status, 'thinking');
  });

  it('available_commands_update populates availableCommands', () => {
    const s = freshSession(); store.add(s);
    store.applyUpdate(s, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'init', description: 'Initialize' },
        { name: 'review', description: 'Review' },
      ],
    });
    assert.equal(s.availableCommands.length, 2);
    assert.equal(s.availableCommands[0].name, 'init');
  });

  it('recordUserMessage appends a user message', () => {
    const s = freshSession(); store.add(s);
    store.recordUserMessage(s, 'hi');
    assert.equal(s.messages[0].role, 'user');
    assert.equal(s.messages[0].content, 'hi');
  });

  it('setPromptInFlight false resets status to idle', () => {
    const s = freshSession(); store.add(s);
    s.status = 'thinking';
    store.setPromptInFlight(s, false);
    assert.equal(s.status, 'idle');
    assert.equal(s.promptInFlight, false);
  });

  it('unknown update kinds are silently ignored (no crash)', () => {
    const s = freshSession(); store.add(s);
    assert.doesNotThrow(() =>
      store.applyUpdate(s, { sessionUpdate: 'totally_unknown_thing', foo: 'bar' }),
    );
  });
});
