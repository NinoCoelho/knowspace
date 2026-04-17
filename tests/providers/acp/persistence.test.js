const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let tmpDir;
const ORIG_ENV = process.env.KNOWSPACE_ACP_SESSIONS_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-acp-persist-'));
  process.env.KNOWSPACE_ACP_SESSIONS_DIR = tmpDir;
  // Drop module cache so persistence + store re-resolve the new dir
  delete require.cache[require.resolve('../../../adapters/providers/acp/persistence')];
  delete require.cache[require.resolve('../../../adapters/providers/acp/session-store')];
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  if (ORIG_ENV === undefined) delete process.env.KNOWSPACE_ACP_SESSIONS_DIR;
  else process.env.KNOWSPACE_ACP_SESSIONS_DIR = ORIG_ENV;
  delete require.cache[require.resolve('../../../adapters/providers/acp/persistence')];
  delete require.cache[require.resolve('../../../adapters/providers/acp/session-store')];
});

describe('acp/persistence', () => {
  it('save + loadAll roundtrip', () => {
    const persistence = require('../../../adapters/providers/acp/persistence');
    persistence.save({
      key: 'acp:claude-code:abc',
      providerSessionId: 'abc',
      agentId: 'claude-code',
      cwd: '/tmp',
      createdAt: 100,
      label: 'My session',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', _streaming: true }, // should be stripped
      ],
      availableCommands: [],
    });
    const all = persistence.loadAll();
    assert.equal(all.length, 1);
    const r = all[0];
    assert.equal(r.key, 'acp:claude-code:abc');
    assert.equal(r.label, 'My session');
    assert.equal(r.messages.length, 2);
    assert.equal(r.messages[1]._streaming, undefined, '_streaming should be stripped');
    assert.equal(r.attached, false, 'restored sessions need reattach');
    assert.equal(r.status, 'idle');
    assert.equal(r.promptInFlight, false);
  });

  it('deleteFor removes the file', () => {
    const persistence = require('../../../adapters/providers/acp/persistence');
    persistence.save({ key: 'acp:c:k', providerSessionId: 'k', agentId: 'c', messages: [] });
    assert.ok(fs.existsSync(persistence.fileForKey('acp:c:k')));
    persistence.deleteFor('acp:c:k');
    assert.equal(fs.existsSync(persistence.fileForKey('acp:c:k')), false);
  });

  it('loadAll on empty dir returns []', () => {
    const persistence = require('../../../adapters/providers/acp/persistence');
    assert.deepEqual(persistence.loadAll(), []);
  });

  it('session-store add() persists; remove() deletes', () => {
    const persistence = require('../../../adapters/providers/acp/persistence');
    const store = require('../../../adapters/providers/acp/session-store');

    const s = store.makeSession({ key: 'acp:c:1', providerSessionId: '1', agentId: 'c', cwd: '/' });
    store.add(s);
    assert.ok(fs.existsSync(persistence.fileForKey(s.key)));

    store.remove(s.key);
    assert.equal(fs.existsSync(persistence.fileForKey(s.key)), false);
  });

  it('session-store loads from disk on init', () => {
    const persistence = require('../../../adapters/providers/acp/persistence');
    persistence.save({
      key: 'acp:c:restored',
      providerSessionId: 'restored',
      agentId: 'c',
      cwd: '/',
      createdAt: 1,
      messages: [{ role: 'user', content: 'old turn' }],
    });
    // Now requiring the store should pre-populate
    const store = require('../../../adapters/providers/acp/session-store');
    const s = store.get('acp:c:restored');
    assert.ok(s, 'session restored from disk');
    assert.equal(s.attached, false);
    assert.equal(s.messages.length, 1);
  });

  it('finalizeStreamingMessage persists the finalized message', () => {
    const persistence = require('../../../adapters/providers/acp/persistence');
    const store = require('../../../adapters/providers/acp/session-store');

    const s = store.makeSession({ key: 'acp:c:fs', providerSessionId: 'fs', agentId: 'c', cwd: '/' });
    store.add(s);
    store.applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { text: 'partial' } });
    // Mid-stream: file exists but message still has _streaming flag in memory
    store.finalizeStreamingMessage(s);

    const reloaded = persistence.loadAll().find(x => x.key === s.key);
    assert.equal(reloaded.messages.length, 1);
    assert.equal(reloaded.messages[0].content, 'partial');
    assert.equal(reloaded.messages[0]._streaming, undefined);
  });
});
