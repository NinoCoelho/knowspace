/**
 * Context envelope — the markdown payload sent as the first prompt of a
 * session created via kanban dispatch or agent handoff.
 *
 * The envelope is intentionally provider-agnostic: it serializes to plain
 * markdown that any agent (OpenClaw, Claude Code, Hermes, Codex, ...) can
 * consume directly. Structured fields stay on the JS side; the agent only
 * sees the rendered text.
 *
 * @typedef {Object} EnvelopeSource
 * @property {'kanban'|'handoff'|'manual'} kind
 * @property {string=} boardFile      Kanban board file (kind=kanban)
 * @property {string=} cardId         Card id (kind=kanban)
 * @property {string=} fromSessionKey Originating session (kind=handoff)
 *
 * @typedef {Object} EnvelopeArtifact
 * @property {'diff'|'url'|'file'|'note'} kind
 * @property {string} label
 * @property {string} content
 *
 * @typedef {Object} EnvelopeVaultRef
 * @property {string}  path
 * @property {string=} reason
 * @property {string=} content        Inline-resolved file content
 *
 * @typedef {Object} ContextEnvelope
 * @property {EnvelopeSource} source
 * @property {{ title: string, description?: string, acceptanceCriteria?: string }} task
 * @property {EnvelopeVaultRef[]=}    vaultRefs
 * @property {string=}                conversationExcerpt
 * @property {EnvelopeArtifact[]=}    artifacts
 * @property {{ cwd?: string, branch?: string }=} workspace
 */

/**
 * Render an envelope to the markdown that gets sent as the first user
 * message of a freshly-created session.
 */
function renderEnvelope(envelope) {
  const lines = [];
  const { source, task, vaultRefs, conversationExcerpt, artifacts, workspace } = envelope;

  lines.push(`# Task: ${task.title}`);
  lines.push('');

  if (task.description) {
    lines.push(task.description.trim());
    lines.push('');
  }

  if (task.acceptanceCriteria) {
    lines.push('## Acceptance criteria');
    lines.push('');
    lines.push(task.acceptanceCriteria.trim());
    lines.push('');
  }

  if (vaultRefs && vaultRefs.length) {
    lines.push('## Context from vault');
    lines.push('');
    for (const ref of vaultRefs) {
      const reason = ref.reason ? ` — ${ref.reason}` : '';
      lines.push(`- **${ref.path}**${reason}`);
      if (ref.content) {
        lines.push('');
        lines.push('  ```');
        for (const l of ref.content.split('\n')) lines.push('  ' + l);
        lines.push('  ```');
      }
    }
    lines.push('');
  }

  if (conversationExcerpt) {
    lines.push('## Previous conversation (excerpt)');
    lines.push('');
    lines.push(conversationExcerpt.trim());
    lines.push('');
  }

  if (artifacts && artifacts.length) {
    lines.push('## Artifacts');
    lines.push('');
    for (const a of artifacts) {
      lines.push(`### ${a.label} (${a.kind})`);
      lines.push('');
      lines.push(a.content.trim());
      lines.push('');
    }
  }

  if (workspace?.cwd || workspace?.branch) {
    lines.push('---');
    lines.push('');
    const parts = [];
    if (workspace.cwd) parts.push(`workspace: \`${workspace.cwd}\``);
    if (workspace.branch) parts.push(`branch: \`${workspace.branch}\``);
    lines.push(parts.join(' · '));
  }

  // Source provenance footer (small, machine-readable for follow-on tools)
  lines.push('');
  const src = `<!-- knowspace-envelope source=${source.kind}` +
    (source.boardFile ? ` board=${source.boardFile}` : '') +
    (source.cardId    ? ` card=${source.cardId}` : '') +
    (source.fromSessionKey ? ` from=${source.fromSessionKey}` : '') +
    ' -->';
  lines.push(src);

  return lines.join('\n');
}

/**
 * Build an envelope from a parsed kanban card. Vault content is not
 * resolved here — caller is responsible for inlining files referenced in
 * card.meta.vaultRefs if desired.
 *
 * Optional context:
 *   notes      — free-form additional instructions from the dispatcher
 *                (rendered as "## Additional instructions")
 *   boardTitle — board name, used in the description footer
 *   laneTitle  — lane name (e.g. "To Do" / "In Progress"), used in footer
 */
function envelopeFromCard({ card, boardFile, cwd, vaultRefs, notes, boardTitle, laneTitle }) {
  let description = card.body || '';
  if (boardTitle || laneTitle) {
    description = (description ? description + '\n\n' : '') +
      `_From kanban` +
      (boardTitle ? ` board **${boardTitle}**` : '') +
      (laneTitle  ? `, lane **${laneTitle}**` : '') +
      `._`;
  }
  return {
    source: { kind: 'kanban', boardFile, cardId: card.id },
    task: {
      title: card.title,
      description,
      ...(notes ? { acceptanceCriteria: notes } : {}),
    },
    vaultRefs,
    workspace: cwd ? { cwd } : undefined,
  };
}

module.exports = { renderEnvelope, envelopeFromCard };
