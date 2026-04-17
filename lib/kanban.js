// Extended Kanban parser/serializer for Knowspace v2.
//
// Backwards-compatible with the existing Obsidian Kanban format
// (kanban-plugin: basic). Adds Knowspace-specific metadata via
// HTML comments inside card bodies, invisible to Obsidian:
//
//   <!-- ks:id=<uuid> -->                                stable card id
//   <!-- ks:assignee=<provider>:<agentId> -->            preferred agent
//   <!-- ks:session provider=<p> id=<sid> status=<s> --> linked session (append-only)
//   <!-- ks:vault-refs=path/a.md,path/b.md -->           extra context refs
//
// Ids are generated on first save. The displayed body strips ks:* lines.

const { randomUUID } = require('node:crypto');

const KS_LINE = /^\s*<!--\s*ks:([a-z][a-z0-9-]*)(?:=(.*?))?\s*(?:\s+(.*?))?\s*-->\s*$/i;

function parseKsLine(line) {
  const m = line.match(KS_LINE);
  if (!m) return null;
  const [, key, simpleValue, attrPart] = m;
  if (simpleValue !== undefined && !attrPart) {
    return { key, value: simpleValue.trim(), attrs: null };
  }
  // Multi-attr form: <!-- ks:session a=b c=d -->
  const attrs = {};
  const rest = (simpleValue ? `${simpleValue} ${attrPart || ''}` : attrPart || '').trim();
  for (const pair of rest.split(/\s+/)) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    attrs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return { key, value: null, attrs };
}

function extractMetaFromBody(rawBody) {
  const lines = rawBody.split('\n');
  const meta = { sessions: [] };
  const remaining = [];
  for (const line of lines) {
    const ks = parseKsLine(line);
    if (!ks) {
      remaining.push(line);
      continue;
    }
    switch (ks.key) {
      case 'id':
        meta.id = ks.value;
        break;
      case 'assignee':
        meta.assignee = ks.value;
        break;
      case 'session':
        if (ks.attrs && (ks.attrs.id || ks.attrs.session_id)) {
          meta.sessions.push({
            provider: ks.attrs.provider,
            sessionId: ks.attrs.id || ks.attrs.session_id,
            status: ks.attrs.status,
          });
        }
        break;
      case 'vault-refs':
        meta.vaultRefs = ks.value ? ks.value.split(',').map(s => s.trim()).filter(Boolean) : [];
        break;
      default:
        // unknown ks:* — preserve as-is so we don't lose forward-compat data
        remaining.push(line);
    }
  }
  if (meta.sessions.length === 0) delete meta.sessions;
  // strip leading/trailing blanks left after removing comments
  while (remaining.length && remaining[0].trim() === '') remaining.shift();
  while (remaining.length && remaining[remaining.length - 1].trim() === '') remaining.pop();
  return { meta, body: remaining.join('\n') };
}

function parseKanban(content) {
  const lines = content.split('\n');
  const kanban = { title: 'Kanban', lanes: [] };

  let currentLane = null;
  let currentCard = null;
  let bodyLines = [];
  let inFrontmatter = false;
  let inObsidianBlock = false;
  let laneUsesHeaders = false;

  function pushCard() {
    if (currentCard && currentLane) {
      const rawBody = bodyLines.join('\n').trim();
      const { meta, body } = extractMetaFromBody(rawBody);
      currentCard.body = body;
      // meta.id wins over the placeholder id we assigned at card creation
      if (meta.id) currentCard.id = meta.id;
      currentCard.meta = {
        ...(meta.assignee ? { assignee: meta.assignee } : {}),
        ...(meta.sessions ? { sessions: meta.sessions } : {}),
        ...(meta.vaultRefs ? { vaultRefs: meta.vaultRefs } : {}),
      };
      currentLane.cards.push(currentCard);
    }
    bodyLines = [];
  }

  for (const line of lines) {
    if (line.trim() === '---') { inFrontmatter = !inFrontmatter; continue; }
    if (inFrontmatter) continue;
    if (line.trim().startsWith('%%')) { inObsidianBlock = !inObsidianBlock; continue; }
    if (inObsidianBlock) continue;

    if (/^# /.test(line) && !line.startsWith('## ') && !line.startsWith('### ')) {
      kanban.title = line.replace(/^# /, '').trim();
    } else if (line.startsWith('## ')) {
      pushCard();
      if (currentLane) kanban.lanes.push(currentLane);
      const title = line.replace('## ', '').trim();
      currentLane = {
        id: title.toLowerCase().replace(/\s+/g, '-'),
        title,
        cards: [],
      };
      currentCard = null;
      laneUsesHeaders = false;
    } else if (line.startsWith('### ') && currentLane) {
      pushCard();
      laneUsesHeaders = true;
      currentCard = {
        id: '__pending__',  // overwritten by ks:id during pushCard, or generated on serialize
        title: line.replace('### ', '').trim(),
        body: '',
        meta: {},
      };
    } else if (/^- /.test(line) && !/^[\t ]/.test(line) && currentLane && !laneUsesHeaders) {
      pushCard();
      currentCard = {
        id: '__pending__',
        title: line.replace(/^- (\[[ x]\] )?/, '').trim(),
        body: '',
        meta: {},
      };
    } else if (currentCard) {
      bodyLines.push(line);
    }
  }
  pushCard();
  if (currentLane) kanban.lanes.push(currentLane);
  return kanban;
}

function ensureCardId(card) {
  if (!card.id || card.id === '__pending__') {
    card.id = randomUUID();
  }
  return card.id;
}

function serializeMeta(card) {
  const out = [];
  out.push(`<!-- ks:id=${ensureCardId(card)} -->`);
  if (card.meta?.assignee) {
    out.push(`<!-- ks:assignee=${card.meta.assignee} -->`);
  }
  for (const s of card.meta?.sessions ?? []) {
    const parts = [];
    if (s.provider) parts.push(`provider=${s.provider}`);
    if (s.sessionId) parts.push(`id=${s.sessionId}`);
    if (s.status) parts.push(`status=${s.status}`);
    out.push(`<!-- ks:session ${parts.join(' ')} -->`);
  }
  if (card.meta?.vaultRefs?.length) {
    out.push(`<!-- ks:vault-refs=${card.meta.vaultRefs.join(',')} -->`);
  }
  return out.join('\n');
}

function serializeKanban(kanban) {
  let md = `---\nkanban-plugin: basic\n---\n\n# ${kanban.title}\n\n`;
  for (const lane of kanban.lanes) {
    md += `## ${lane.title}\n\n`;
    for (const card of lane.cards) {
      md += `### ${card.title}\n`;
      md += serializeMeta(card) + '\n';
      if (card.body && card.body.trim()) {
        md += '\n' + card.body.trim() + '\n';
      }
      md += '\n';
    }
  }
  return md;
}

module.exports = { parseKanban, serializeKanban, parseKsLine, extractMetaFromBody };
