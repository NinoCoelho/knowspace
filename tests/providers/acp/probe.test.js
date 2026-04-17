const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const probe = require('../../../adapters/providers/acp/probe');

beforeEach(() => probe.clearCache());

describe('acp/probe', () => {
  it('reports npx recipes as available without probing', async () => {
    const r = await probe.probeRecipe({ id: 'x', cmd: 'npx', args: [] });
    assert.equal(r.available, true);
    assert.equal(r.reason, 'npx');
  });

  it('reports missing binaries as unavailable', async () => {
    const r = await probe.probeRecipe({ id: 'x', cmd: 'definitely-not-a-real-binary-xyz-123', args: [] });
    assert.equal(r.available, false);
    assert.match(r.reason, /not in PATH/);
  });

  it('finds binaries that exist', async () => {
    const r = await probe.probeRecipe({ id: 'x', cmd: 'node', args: [] });
    assert.equal(r.available, true);
    assert.match(r.reason, /found at \//);
  });

  it('accepts absolute paths', async () => {
    const r = await probe.probeRecipe({ id: 'x', cmd: '/bin/sh', args: [] });
    assert.equal(r.available, true);
  });

  it('caches results', async () => {
    const recipe = { id: 'cached', cmd: 'node', args: [] };
    const first = await probe.probeWithCache(recipe);
    assert.equal(first.available, true);
    // Mutate the cmd to something bogus — the cache should still return true
    const second = await probe.probeWithCache({ ...recipe, cmd: 'bogus-cmd' });
    assert.equal(second.available, true);
  });

  it('missing cmd fails gracefully', async () => {
    const r = await probe.probeRecipe({ id: 'x' });
    assert.equal(r.available, false);
  });
});
