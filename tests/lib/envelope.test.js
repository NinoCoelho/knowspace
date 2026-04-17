const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderEnvelope, envelopeFromCard } = require('../../lib/envelope');

describe('lib/envelope', () => {
  it('renders a minimal envelope with just a task', () => {
    const md = renderEnvelope({
      source: { kind: 'manual' },
      task: { title: 'Fix the login bug', description: 'Users cannot log in.' },
    });
    assert.match(md, /^# Task: Fix the login bug/m);
    assert.match(md, /Users cannot log in\./);
    assert.match(md, /<!-- knowspace-envelope source=manual -->/);
  });

  it('includes acceptance criteria when provided', () => {
    const md = renderEnvelope({
      source: { kind: 'kanban', boardFile: 'k.md', cardId: 'c1' },
      task: {
        title: 'X',
        description: 'do x',
        acceptanceCriteria: '- works\n- tested',
      },
    });
    assert.match(md, /## Acceptance criteria/);
    assert.match(md, /- works/);
    assert.match(md, /board=k\.md card=c1/);
  });

  it('renders vault refs with optional inlined content', () => {
    const md = renderEnvelope({
      source: { kind: 'manual' },
      task: { title: 'T' },
      vaultRefs: [
        { path: 'specs/auth.md', reason: 'spec', content: 'line1\nline2' },
        { path: 'no-content.md' },
      ],
    });
    assert.match(md, /## Context from vault/);
    assert.match(md, /\*\*specs\/auth\.md\*\* — spec/);
    assert.match(md, /  line1/);
    assert.match(md, /\*\*no-content\.md\*\*/);
  });

  it('renders artifacts and conversation excerpt', () => {
    const md = renderEnvelope({
      source: { kind: 'handoff', fromSessionKey: 'acp:claude-code:abc' },
      task: { title: 'continue' },
      conversationExcerpt: 'user: ...\nassistant: ...',
      artifacts: [
        { kind: 'diff', label: 'change to api.js', content: '@@ -1,3 +1,3 @@\n-old\n+new' },
      ],
    });
    assert.match(md, /## Previous conversation \(excerpt\)/);
    assert.match(md, /## Artifacts/);
    assert.match(md, /### change to api\.js \(diff\)/);
    assert.match(md, /from=acp:claude-code:abc/);
  });

  it('renders workspace footer', () => {
    const md = renderEnvelope({
      source: { kind: 'manual' },
      task: { title: 'T' },
      workspace: { cwd: '/tmp/proj', branch: 'main' },
    });
    assert.match(md, /workspace: `\/tmp\/proj`/);
    assert.match(md, /branch: `main`/);
  });

  it('envelopeFromCard captures card metadata', () => {
    const env = envelopeFromCard({
      card: { id: 'c-1', title: 'X', body: 'do x', meta: {} },
      boardFile: 'b.md',
      cwd: '/tmp',
      vaultRefs: [{ path: 'a.md' }],
    });
    assert.equal(env.source.kind, 'kanban');
    assert.equal(env.source.boardFile, 'b.md');
    assert.equal(env.source.cardId, 'c-1');
    assert.equal(env.task.title, 'X');
    assert.equal(env.task.description, 'do x');
    assert.equal(env.workspace.cwd, '/tmp');
    assert.deepEqual(env.vaultRefs, [{ path: 'a.md' }]);
  });
});
