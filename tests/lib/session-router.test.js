const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const router = require('../../lib/session-router');

describe('lib/session-router', () => {
  it('detectProviderId routes acp: prefix to acp', () => {
    assert.equal(router.detectProviderId('acp:claude-code:abc-123'), 'acp');
  });

  it('detectProviderId routes agent: prefix to openclaw', () => {
    assert.equal(router.detectProviderId('agent:main:web:direct:portal-x'), 'openclaw');
  });

  it('detectProviderId falls back to default for unknown prefixes', () => {
    assert.equal(router.detectProviderId('mystery:key'), 'openclaw');
    assert.equal(router.detectProviderId(''), 'openclaw');
    assert.equal(router.detectProviderId(null), 'openclaw');
    assert.equal(router.detectProviderId(undefined), 'openclaw');
  });

  it('getProviderForSession returns the correct Provider object', () => {
    const acpProvider = router.getProviderForSession('acp:claude-code:abc');
    assert.equal(acpProvider.id, 'acp');
    const openclaw = router.getProviderForSession('agent:main:web:direct:portal-x');
    assert.equal(openclaw.id, 'openclaw');
  });

  it('PREFIXES is the source of truth for routing rules', () => {
    const ids = router.PREFIXES.map(p => p.providerId);
    assert.ok(ids.includes('acp'));
    assert.ok(ids.includes('openclaw'));
  });
});
