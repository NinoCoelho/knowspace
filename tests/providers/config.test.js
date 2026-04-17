const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('../../adapters/providers/config');
const acp = require('../../adapters/providers/acp');

let tmpFile;
const originalEnv = process.env.KNOWSPACE_PROVIDERS_FILE;

function writeConfig(obj) {
  tmpFile = path.join(os.tmpdir(), `knowspace-providers-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(obj));
  process.env.KNOWSPACE_PROVIDERS_FILE = tmpFile;
}

afterEach(() => {
  if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  tmpFile = undefined;
  if (originalEnv === undefined) delete process.env.KNOWSPACE_PROVIDERS_FILE;
  else process.env.KNOWSPACE_PROVIDERS_FILE = originalEnv;
  acp.setRecipeOverrides({});
});

describe('providers/config', () => {
  it('loadConfig returns null when file does not exist', () => {
    process.env.KNOWSPACE_PROVIDERS_FILE = '/nonexistent/file.json';
    assert.equal(config.loadConfig(), null);
  });

  it('loadConfig parses a valid file', () => {
    writeConfig({ providers: { acp: { enabled: true } } });
    const c = config.loadConfig();
    assert.equal(c.providers.acp.enabled, true);
  });

  it('isEnabled defaults to true when not mentioned', () => {
    assert.equal(config.isEnabled(null, 'openclaw'), true);
    assert.equal(config.isEnabled({ providers: {} }, 'openclaw'), true);
  });

  it('isEnabled returns false only when explicitly disabled', () => {
    const c = { providers: { openclaw: { enabled: false } } };
    assert.equal(config.isEnabled(c, 'openclaw'), false);
  });

  it('getAcpOverrides returns the agents map', () => {
    const c = { providers: { acp: { agents: { 'claude-code': { name: 'C' } } } } };
    const ov = config.getAcpOverrides(c);
    assert.equal(ov['claude-code'].name, 'C');
  });

  it('applyConfig wires ACP overrides into the provider', async () => {
    acp._probe.clearCache();
    const fakeRegistry = {
      listProviders() { return []; },
      unregisterProvider() {},
    };
    config.applyConfig(fakeRegistry, {
      providers: {
        acp: {
          agents: {
            'claude-code': { name: 'Custom Name' },
            // Use `node` (always in PATH during tests) so the probe
            // reports the override as available.
            'my-coder': { name: 'Mine', cmd: 'node', args: [], kind: 'coder' },
          },
        },
      },
    });
    const list = await acp.provider.listAgents();
    assert.equal(list.find(a => a.id === 'claude-code').name, 'Custom Name');
    assert.ok(list.find(a => a.id === 'my-coder'));
    acp._probe.clearCache();
  });

  it('applyConfig unregisters disabled providers', () => {
    const removed = [];
    const fakeRegistry = {
      listProviders() { return [{ id: 'openclaw' }, { id: 'acp' }]; },
      unregisterProvider(id) { removed.push(id); },
    };
    config.applyConfig(fakeRegistry, {
      providers: { openclaw: { enabled: false } },
    });
    assert.deepEqual(removed, ['openclaw']);
  });

  it('applyConfig is a no-op when config is null', () => {
    const r = config.applyConfig({ listProviders: () => [], unregisterProvider() {} }, null);
    assert.equal(r.applied, false);
  });
});
