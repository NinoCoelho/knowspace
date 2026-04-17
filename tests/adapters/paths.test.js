const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const paths = require('../../adapters/providers/openclaw/paths');

describe('paths', () => {
  describe('getSessionPrefix', () => {
    it('returns agent:<slug>: format', () => {
      assert.equal(paths.getSessionPrefix('acme'), 'agent:acme:');
    });

    it('handles slugs with hyphens', () => {
      assert.equal(paths.getSessionPrefix('acme-corp'), 'agent:acme-corp:');
    });
  });

  describe('buildSessionKey', () => {
    it('constructs agent:<slug>:<suffix>', () => {
      assert.equal(paths.buildSessionKey('acme', 'main'), 'agent:acme:main');
    });

    it('handles complex suffixes', () => {
      assert.equal(
        paths.buildSessionKey('acme', 'web:direct:portal-abc'),
        'agent:acme:web:direct:portal-abc'
      );
    });
  });

  describe('buildNewSessionKey', () => {
    it('returns a key with portal- UUID suffix', () => {
      const key = paths.buildNewSessionKey('acme');
      assert.match(key, /^agent:acme:web:direct:portal-[0-9a-f-]{36}$/);
    });

    it('generates unique keys', () => {
      const a = paths.buildNewSessionKey('acme');
      const b = paths.buildNewSessionKey('acme');
      assert.notEqual(a, b);
    });
  });

  describe('getDefaultSessionKey', () => {
    it('returns agent:<slug>:main', () => {
      assert.equal(paths.getDefaultSessionKey('nino'), 'agent:nino:main');
    });
  });

  describe('getSessionsJsonPath', () => {
    it('contains .openclaw/agents/<slug>/sessions/sessions.json', () => {
      const p = paths.getSessionsJsonPath('acme');
      assert.ok(p.includes('.openclaw'));
      assert.ok(p.includes('agents/acme/sessions/sessions.json'));
    });
  });

  describe('getEngineConfigPath', () => {
    it('contains .openclaw/openclaw.json', () => {
      const p = paths.getEngineConfigPath();
      assert.ok(p.includes('.openclaw/openclaw.json'));
    });
  });

  describe('getSkillsTargetPath', () => {
    it('contains openclaw/skills', () => {
      const p = paths.getSkillsTargetPath();
      assert.ok(p.includes('openclaw'));
      assert.ok(p.endsWith('skills'));
    });
  });
});
