/**
 * Built-in ACP agent recipes. Each recipe describes how to launch an
 * ACP-compatible coding agent. Users can override / extend these via
 * ~/.knowspace/providers.json (loaded by adapters/providers/index.js).
 *
 * The recipe shape doubles as the public Agent descriptor returned by
 * the ACP provider's listAgents().
 */

const BUILTIN_RECIPES = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'coder',
    description: 'Anthropic Claude Code via Zed ACP adapter (npx)',
    cmd: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp'],
  },
  {
    id: 'hermes',
    name: 'Hermes',
    kind: 'chat',
    description: 'Nous Research Hermes Agent (native ACP)',
    cmd: 'hermes',
    args: ['acp'],
  },
  {
    id: 'codex',
    name: 'Codex',
    kind: 'coder',
    description: 'OpenAI Codex CLI via ACP (requires codex CLI installed)',
    // Subject to verification — Codex ACP support is via a Zed adapter
    // similar to Claude. Users can override the cmd/args in providers.json
    // until upstream stabilizes.
    cmd: 'codex',
    args: ['acp'],
  },
];

function builtinRecipes() {
  return BUILTIN_RECIPES.map(r => ({ ...r, args: [...r.args] }));
}

function recipeById(id, overrides) {
  const base = builtinRecipes().find(r => r.id === id);
  const override = overrides?.[id];
  if (!base && !override) return null;
  return { ...(base || {}), ...(override || {}), id };
}

function listRecipes(overrides) {
  const seen = new Map();
  for (const r of builtinRecipes()) seen.set(r.id, r);
  for (const [id, ov] of Object.entries(overrides || {})) {
    const merged = { ...(seen.get(id) || { id }), ...ov, id };
    seen.set(id, merged);
  }
  return Array.from(seen.values());
}

module.exports = { builtinRecipes, recipeById, listRecipes };
