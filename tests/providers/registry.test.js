const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../adapters/providers');

describe('provider registry', () => {
  it('exposes openclaw as the default provider', () => {
    const p = registry.getDefaultProvider();
    assert.equal(p.id, 'openclaw');
  });

  it('getProvider("openclaw") returns the same instance', () => {
    assert.equal(registry.getProvider('openclaw').id, 'openclaw');
  });

  it('listProviders includes openclaw', () => {
    const ids = registry.listProviders().map(p => p.id);
    assert.ok(ids.includes('openclaw'));
  });

  it('throws for unknown provider id', () => {
    assert.throws(() => registry.getProvider('nope'), /unknown provider/);
  });

  it('openclaw provider conforms to the Provider interface shape', () => {
    const p = registry.getProvider('openclaw');
    for (const key of [
      'id', 'capabilities', 'listAgents',
      'listSessions', 'createSession', 'renameSession', 'deleteSession',
      'loadHistory', 'sendMessage', 'pollForReply',
    ]) {
      assert.ok(p[key] !== undefined, `missing field ${key}`);
    }
    assert.equal(typeof p.listSessions, 'function');
    assert.equal(typeof p.capabilities.persistentSessions, 'boolean');
  });

  it('back-compat engine export still works', () => {
    assert.equal(typeof registry.engine.sessions.listSessions, 'function');
    assert.equal(typeof registry.engine.chat.loadHistory, 'function');
    assert.equal(typeof registry.engine.paths.getDefaultSessionKey, 'function');
  });

  it('registerProvider adds a custom provider', () => {
    const fake = { id: '__test_provider__', capabilities: {}, listAgents: () => [] };
    registry.registerProvider(fake);
    assert.equal(registry.getProvider('__test_provider__'), fake);
  });
});
