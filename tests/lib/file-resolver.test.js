const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const resolver = require('../../lib/file-resolver');

let vault;

function touch(rel, content = 'x') {
  const full = path.join(vault, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

beforeEach(() => {
  // Vault must be under $HOME to pass the safety check.
  vault = fs.mkdtempSync(path.join(os.homedir(), '.kn-resolver-test-'));
});
afterEach(() => {
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
});

describe('lib/file-resolver', () => {
  it('resolves a real absolute path', () => {
    const real = touch('Briefs/a.md');
    const r = resolver.resolve(real, vault);
    assert.equal(r.strategy, 'absolute');
    assert.equal(fs.realpathSync(r.path), fs.realpathSync(real));
  });

  it('resolves a tilde path', () => {
    touch('Briefs/b.md');
    const rel = path.relative(os.homedir(), path.join(vault, 'Briefs/b.md'));
    const r = resolver.resolve('~/' + rel, vault);
    assert.equal(r.strategy, 'tilde');
  });

  it('resolves vault-rooted absolute paths (the agent bug)', () => {
    touch('Design/Exports/img.png');
    // Agent emits path "/Design/Exports/img.png" thinking it's vault-rooted
    const r = resolver.resolve('/Design/Exports/img.png', vault);
    assert.equal(r.strategy, 'vault-rooted');
    assert.match(r.path, /Design\/Exports\/img\.png$/);
  });

  it('resolves vault-relative paths', () => {
    touch('Notes/note.md');
    const r = resolver.resolve('Notes/note.md', vault);
    assert.equal(r.strategy, 'vault-relative');
  });

  it('falls back to fuzzy basename when nothing else matches', () => {
    touch('Some/Deep/Path/unique-thing.md');
    const r = resolver.resolve('unique-thing.md', vault);
    assert.equal(r.strategy, 'vault-basename');
  });

  it('refuses fuzzy basename when ambiguous', () => {
    touch('A/dup.md');
    touch('B/dup.md');
    const r = resolver.resolve('dup.md', vault);
    assert.equal(r, null, 'ambiguous basename should not auto-resolve');
  });

  it('returns null when nothing matches', () => {
    const r = resolver.resolve('not-here.md', vault);
    assert.equal(r, null);
  });

  it('refuses paths that escape the home directory', () => {
    // /etc/hosts is real but outside $HOME — must come back null
    const r = resolver.resolve('/etc/hosts', vault);
    assert.equal(r, null);
  });

  it('handles a path with spaces (Mobile Documents style)', () => {
    touch('Mobile Documents/iCloud~md~obsidian/Briefs/with space.md');
    const r = resolver.resolve('/Mobile Documents/iCloud~md~obsidian/Briefs/with space.md', vault);
    assert.equal(r.strategy, 'vault-rooted');
  });

  it('returns null gracefully on bad input', () => {
    assert.equal(resolver.resolve(null, vault), null);
    assert.equal(resolver.resolve('', vault), null);
    assert.equal(resolver.resolve(123, vault), null);
  });
});
