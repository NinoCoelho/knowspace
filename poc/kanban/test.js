const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKanban, serializeKanban, parseKsLine, extractMetaFromBody } = require('./parser');

const LEGACY_BOARD = `---
kanban-plugin: basic
---

# Sprint 1

## To Do

### Implement OAuth on /auth

Validate token via Google.

### Add rate limiting

100 req/min per IP.

## Done

### Setup CI
`;

const ENRICHED_BOARD = `---
kanban-plugin: basic
---

# Sprint 1

## To Do

### Implement OAuth on /auth
<!-- ks:id=11111111-1111-1111-1111-111111111111 -->
<!-- ks:assignee=acp:claude-code -->
<!-- ks:session provider=acp id=sess-abc status=running -->
<!-- ks:vault-refs=specs/auth.md,specs/db.md -->

Validate token via Google.

### Add rate limiting
<!-- ks:id=22222222-2222-2222-2222-222222222222 -->

100 req/min per IP.
`;

test('parseKsLine handles simple key=value', () => {
  const r = parseKsLine('<!-- ks:id=abc-123 -->');
  assert.deepEqual(r, { key: 'id', value: 'abc-123', attrs: null });
});

test('parseKsLine handles multi-attr form', () => {
  const r = parseKsLine('<!-- ks:session provider=acp id=sess-1 status=running -->');
  assert.equal(r.key, 'session');
  assert.deepEqual(r.attrs, { provider: 'acp', id: 'sess-1', status: 'running' });
});

test('parseKsLine returns null for non-ks comments', () => {
  assert.equal(parseKsLine('<!-- some other comment -->'), null);
  assert.equal(parseKsLine('plain text'), null);
});

test('extractMetaFromBody pulls all ks:* fields and cleans body', () => {
  const raw = `<!-- ks:id=card-1 -->
<!-- ks:assignee=acp:claude-code -->
<!-- ks:session provider=acp id=sess-1 status=done -->
<!-- ks:vault-refs=a.md,b.md -->

The actual user body content.
With multiple lines.`;
  const { meta, body } = extractMetaFromBody(raw);
  assert.equal(meta.id, 'card-1');
  assert.equal(meta.assignee, 'acp:claude-code');
  assert.deepEqual(meta.sessions, [{ provider: 'acp', sessionId: 'sess-1', status: 'done' }]);
  assert.deepEqual(meta.vaultRefs, ['a.md', 'b.md']);
  assert.equal(body, 'The actual user body content.\nWith multiple lines.');
});

test('legacy Obsidian kanban parses with no meta', () => {
  const k = parseKanban(LEGACY_BOARD);
  assert.equal(k.title, 'Sprint 1');
  assert.equal(k.lanes.length, 2);
  assert.equal(k.lanes[0].title, 'To Do');
  assert.equal(k.lanes[0].cards.length, 2);
  assert.equal(k.lanes[0].cards[0].title, 'Implement OAuth on /auth');
  assert.equal(k.lanes[0].cards[0].body, 'Validate token via Google.');
  assert.deepEqual(k.lanes[0].cards[0].meta, {});
  // pre-save: id is __pending__
  assert.equal(k.lanes[0].cards[0].id, '__pending__');
});

test('enriched board parses with full meta and clean body', () => {
  const k = parseKanban(ENRICHED_BOARD);
  const oauth = k.lanes[0].cards[0];
  assert.equal(oauth.id, '11111111-1111-1111-1111-111111111111');
  assert.equal(oauth.title, 'Implement OAuth on /auth');
  assert.equal(oauth.body, 'Validate token via Google.');
  assert.equal(oauth.meta.assignee, 'acp:claude-code');
  assert.deepEqual(oauth.meta.sessions, [{ provider: 'acp', sessionId: 'sess-abc', status: 'running' }]);
  assert.deepEqual(oauth.meta.vaultRefs, ['specs/auth.md', 'specs/db.md']);
});

test('serialize generates ids for pending cards', () => {
  const k = parseKanban(LEGACY_BOARD);
  const out = serializeKanban(k);
  assert.match(out, /<!-- ks:id=[0-9a-f-]{36} -->/);
  // re-parse: ids are now real UUIDs
  const k2 = parseKanban(out);
  for (const lane of k2.lanes) {
    for (const card of lane.cards) {
      assert.match(card.id, /^[0-9a-f-]{36}$/);
    }
  }
});

test('roundtrip preserves ids and meta', () => {
  const k1 = parseKanban(ENRICHED_BOARD);
  const md = serializeKanban(k1);
  const k2 = parseKanban(md);
  assert.deepEqual(
    k1.lanes.map(l => l.cards.map(c => ({ id: c.id, title: c.title, body: c.body, meta: c.meta }))),
    k2.lanes.map(l => l.cards.map(c => ({ id: c.id, title: c.title, body: c.body, meta: c.meta }))),
  );
});

test('legacy board ids are stable across two roundtrips', () => {
  const k1 = parseKanban(LEGACY_BOARD);
  const md1 = serializeKanban(k1);
  const k2 = parseKanban(md1);
  const md2 = serializeKanban(k2);
  assert.equal(md1, md2, 'second serialize should be identical (ids stuck)');
});

test('multiple session lines accumulate (handoff history)', () => {
  const board = `---
kanban-plugin: basic
---

# B

## To Do

### Card with handoffs
<!-- ks:id=h-1 -->
<!-- ks:session provider=acp id=sess-1 status=done -->
<!-- ks:session provider=openclaw id=sess-2 status=running -->

Some body.
`;
  const k = parseKanban(board);
  const card = k.lanes[0].cards[0];
  assert.equal(card.meta.sessions.length, 2);
  assert.equal(card.meta.sessions[0].provider, 'acp');
  assert.equal(card.meta.sessions[1].provider, 'openclaw');

  // appending a new session and roundtripping
  card.meta.sessions.push({ provider: 'acp', sessionId: 'sess-3', status: 'running' });
  const md = serializeKanban(k);
  const k2 = parseKanban(md);
  assert.equal(k2.lanes[0].cards[0].meta.sessions.length, 3);
});

test('demo: dispatch a card by mutating meta and re-serializing', () => {
  const k = parseKanban(LEGACY_BOARD);
  const card = k.lanes[0].cards[0];
  card.meta.assignee = 'acp:claude-code';
  card.meta.sessions = [{ provider: 'acp', sessionId: 'sess-fresh', status: 'running' }];
  const md = serializeKanban(k);
  console.log('\n--- DISPATCHED CARD MARKDOWN ---\n' + md.split('## To Do')[1].split('## Done')[0]);
});
