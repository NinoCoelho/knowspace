const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKanban, serializeKanban } = require('../../lib/kanban');

const BOARD = `---
kanban-plugin: basic
---

# Sprint

## To Do

### A card
<!-- ks:id=11111111-1111-1111-1111-111111111111 -->

body

## Design
<!-- ks:lane-assignee=acp:nando -->
<!-- ks:lane-auto-dispatch=true -->
<!-- ks:lane-prompt=Inicie o design.\\nFoque em mobile primeiro. -->

### B card
<!-- ks:id=22222222-2222-2222-2222-222222222222 -->
`;

test('parseKanban reads lane.meta from ks:lane-* comments', () => {
  const k = parseKanban(BOARD);
  const todo = k.lanes.find(l => l.id === 'to-do');
  const design = k.lanes.find(l => l.id === 'design');
  assert.ok(todo);
  assert.deepEqual(todo.meta, {});
  assert.equal(design.meta.assignee, 'acp:nando');
  assert.equal(design.meta.autoDispatch, true);
  assert.equal(design.meta.prompt, 'Inicie o design.\nFoque em mobile primeiro.');
});

test('parseKanban does not eat ks:lane-* comments as cards', () => {
  const k = parseKanban(BOARD);
  const design = k.lanes.find(l => l.id === 'design');
  assert.equal(design.cards.length, 1);
  assert.equal(design.cards[0].title, 'B card');
});

test('roundtrip preserves lane.meta and card content', () => {
  const k1 = parseKanban(BOARD);
  const md = serializeKanban(k1);
  const k2 = parseKanban(md);
  for (const id of ['to-do', 'design']) {
    const a = k1.lanes.find(l => l.id === id);
    const b = k2.lanes.find(l => l.id === id);
    assert.deepEqual(a.meta, b.meta);
    assert.equal(a.cards.length, b.cards.length);
  }
});

test('newline encoding round-trips for ks:lane-prompt', () => {
  const k = parseKanban(BOARD);
  const design = k.lanes.find(l => l.id === 'design');
  // mutate prompt + serialize + reparse
  design.meta.prompt = 'line1\nline2\nline3';
  const md = serializeKanban(k);
  // Stored as escaped \n on disk
  assert.match(md, /ks:lane-prompt=line1\\nline2\\nline3/);
  const k2 = parseKanban(md);
  assert.equal(k2.lanes.find(l => l.id === 'design').meta.prompt, 'line1\nline2\nline3');
});

test('autoDispatch only writes when true', () => {
  const k = parseKanban(BOARD);
  const todo = k.lanes.find(l => l.id === 'to-do');
  todo.meta.assignee = 'acp:claude-code';
  // autoDispatch left undefined / false
  const md = serializeKanban(k);
  assert.match(md, /## To Do[\s\S]*ks:lane-assignee=acp:claude-code/);
  assert.doesNotMatch(md, /## To Do[\s\S]*ks:lane-auto-dispatch[\s\S]*## Design/);
});

test('legacy boards without lane meta still parse', () => {
  const legacy = `---
kanban-plugin: basic
---

# K

## Done

### Task
some body
`;
  const k = parseKanban(legacy);
  assert.equal(k.lanes[0].title, 'Done');
  assert.deepEqual(k.lanes[0].meta, {});
});
