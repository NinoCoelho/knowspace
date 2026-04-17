const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const acp = require('../../../adapters/providers/acp');

describe('acp/index', () => {
  it('provider conforms to the Provider interface', () => {
    const p = acp.provider;
    assert.equal(p.id, 'acp');
    for (const key of [
      'capabilities', 'listAgents',
      'listSessions', 'createSession', 'renameSession', 'deleteSession',
      'loadHistory', 'sendMessage', 'pollForReply',
    ]) {
      assert.ok(p[key] !== undefined, `missing ${key}`);
    }
    assert.equal(p.capabilities.streaming, 'native');
    assert.equal(p.capabilities.cwdBinding, true);
  });

  it('listAgents includes claude-code, hermes, codex', async () => {
    const list = await acp.provider.listAgents();
    const ids = list.map(a => a.id);
    for (const id of ['claude-code', 'hermes', 'codex']) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
  });

  it('buildSessionKey + parseSessionKey roundtrip', () => {
    const k = acp._buildSessionKey('claude-code', 'sess-uuid-123');
    assert.equal(k, 'acp:claude-code:sess-uuid-123');
    const parsed = acp._parseSessionKey(k);
    assert.deepEqual(parsed, { agentId: 'claude-code', providerSessionId: 'sess-uuid-123' });
  });

  it('parseSessionKey rejects non-acp keys', () => {
    assert.throws(() => acp._parseSessionKey('agent:foo:bar'), /not an ACP session key/);
  });

  it('parseSessionKey rejects malformed keys', () => {
    assert.throws(() => acp._parseSessionKey('acp:noprovsessid'), /malformed ACP session key/);
  });

  it('setRecipeOverrides changes listAgents output', async () => {
    acp._probe.clearCache();
    // Use `node` as the cmd — it's always in PATH in a Node test env, so
    // the probe will report the agent as available.
    acp.setRecipeOverrides({
      'claude-code': { name: 'Custom Claude' },
      myagent: { name: 'Mine', cmd: 'node', args: [], kind: 'chat' },
    });
    const list = await acp.provider.listAgents();
    assert.equal(list.find(a => a.id === 'claude-code').name, 'Custom Claude');
    assert.ok(list.find(a => a.id === 'myagent'));
    acp.setRecipeOverrides({}); // reset for other tests
    acp._probe.clearCache();
  });

  it('listAgents hides recipes whose binary is missing', async () => {
    acp._probe.clearCache();
    acp.setRecipeOverrides({
      ghost: { name: 'Ghost', cmd: '/no/such/binary/kn-xyz', args: [], kind: 'chat' },
    });
    const list = await acp.provider.listAgents();
    assert.equal(list.find(a => a.id === 'ghost'), undefined);
    acp.setRecipeOverrides({});
    acp._probe.clearCache();
  });

  it('listAgentsWithAvailability reports both available and unavailable', async () => {
    acp._probe.clearCache();
    acp.setRecipeOverrides({
      ghost: { name: 'Ghost', cmd: '/no/such/binary/kn-xyz', args: [], kind: 'chat' },
    });
    const all = await acp.listAgentsWithAvailability();
    const ghost = all.find(a => a.id === 'ghost');
    assert.ok(ghost);
    assert.equal(ghost.available, false);
    acp.setRecipeOverrides({});
    acp._probe.clearCache();
  });

  it('loadHistory returns empty array for unknown session', async () => {
    const messages = await acp.provider.loadHistory('acp:claude-code:nonexistent');
    assert.deepEqual(messages, []);
  });

  it('sendMessage throws on unknown session', async () => {
    await assert.rejects(
      acp.provider.sendMessage('acp:claude-code:nonexistent', 'hi'),
      /unknown session/,
    );
  });
});
