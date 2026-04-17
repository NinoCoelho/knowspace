const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const agents = require('../../../adapters/providers/acp/agents');

describe('acp/agents', () => {
  it('builtinRecipes returns claude-code, hermes, codex', () => {
    const ids = agents.builtinRecipes().map(r => r.id);
    for (const id of ['claude-code', 'hermes', 'codex']) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
  });

  it('every builtin has cmd and args', () => {
    for (const r of agents.builtinRecipes()) {
      assert.equal(typeof r.cmd, 'string');
      assert.ok(Array.isArray(r.args));
    }
  });

  it('recipeById resolves a builtin', () => {
    const r = agents.recipeById('claude-code');
    assert.equal(r.id, 'claude-code');
    assert.equal(r.cmd, 'npx');
  });

  it('recipeById applies overrides on top of builtin', () => {
    const r = agents.recipeById('claude-code', {
      'claude-code': { cmd: '/usr/local/bin/claude-acp' },
    });
    assert.equal(r.cmd, '/usr/local/bin/claude-acp');
    assert.deepEqual(r.args, ['-y', '@agentclientprotocol/claude-agent-acp']);
  });

  it('recipeById supports a brand-new agent via overrides', () => {
    const r = agents.recipeById('custom', {
      custom: { name: 'Custom', cmd: 'foo', args: ['--acp'], kind: 'chat' },
    });
    assert.equal(r.id, 'custom');
    assert.equal(r.cmd, 'foo');
  });

  it('recipeById returns null for unknown id with no overrides', () => {
    assert.equal(agents.recipeById('nope'), null);
  });

  it('listRecipes merges builtins with overrides', () => {
    const all = agents.listRecipes({
      'claude-code': { name: 'Renamed Claude' },
      custom: { name: 'Custom', cmd: 'foo', args: [] },
    });
    const ids = all.map(r => r.id);
    assert.ok(ids.includes('claude-code'));
    assert.ok(ids.includes('custom'));
    assert.equal(all.find(r => r.id === 'claude-code').name, 'Renamed Claude');
  });
});
