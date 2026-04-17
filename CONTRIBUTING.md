# Contributing to Knowspace

Thanks for your interest! Knowspace is a multi-provider portal that drives [OpenClaw](https://github.com/openclaw/openclaw), [Claude Code](https://www.anthropic.com/claude-code), [Hermes](https://github.com/nousresearch/hermes-agent), and [Codex](https://github.com/openai/codex) — and we welcome contributions from any of those communities.

## Quick Start

```bash
git clone https://github.com/<your-username>/knowspace.git
cd knowspace
npm install
npm test                      # ~180 tests, no live agent needed
npm start                     # http://localhost:3445
```

You don't need every provider to develop — pick what you have:
- **No backend at all** is enough for unit tests, parser work, frontend changes
- **OpenClaw gateway running** unlocks chat against existing OpenClaw agents
- **`claude` CLI authenticated** unlocks Claude Code via ACP (`npx @agentclientprotocol/claude-agent-acp` is bundled)
- **`hermes` / `codex` in PATH** unlocks those ACP recipes

## Architecture in one paragraph

`server.js` accepts WebSocket + REST traffic, delegates every chat / session call to the **provider registry** (`adapters/providers/`). Two providers ship: `openclaw` (WebSocket gateway) and `acp` (JSON-RPC stdio for Claude Code, Hermes, Codex). `lib/session-router` maps a session-key prefix to the right provider, so the chat loop is provider-agnostic. Kanban dispatch goes through `lib/envelope` (renders the markdown context) and writes a `<!-- ks:session ... -->` linkage back into the card's markdown.

### Key invariants

> `server.js` never imports `lib/gateway.js` directly. All OpenClaw interaction lives in `adapters/providers/openclaw/`. New code paths route through `lib/session-router` or `providers.getProvider(id)` — never hardcode a provider.

### Key paths

| Path | Purpose |
|------|---------|
| `server.js` | Express + Socket.IO server |
| `adapters/providers/types.js` | Provider interface (JSDoc contract) |
| `adapters/providers/index.js` | Registry, applies `~/.knowspace/providers.json` |
| `adapters/providers/openclaw/` | OpenClaw provider |
| `adapters/providers/acp/` | ACP provider — connection / store / persistence / terminals / probe |
| `lib/gateway.js` | Low-level WebSocket RPC (Ed25519, OpenClaw only) |
| `lib/kanban.js` | Markdown parser/serializer with `ks:*` metadata |
| `lib/envelope.js` | Renders dispatch context envelope as markdown |
| `lib/session-router.js` | Session-key → provider routing |
| `lib/permission-broker.js` | ACP `requestPermission` → WebSocket modal |
| `lib/file-resolver.js` | Multi-strategy file path resolution |
| `middleware/auth.js` | Token authentication (SHA-256 hashed) |
| `routes/api.js` | REST: vault, kanban, dispatch, providers, agents, file preview/raw |
| `public/index.html` | SPA entry + all CSS |
| `public/js/app.js` | Frontend (vanilla JS, no framework, no build) |
| `cli/` | `serve`, `connect`, `configure`, `daemon`, `tokens`, `providers`, `agents` |
| `tests/` | ~180 unit + contract tests (node:test) |

## Coding conventions

- **Backend:** Node.js, Express, Socket.IO. No TypeScript.
- **Frontend:** Vanilla JS in `public/js/app.js`. No framework, no build step.
- **CSS:** Inline in `public/index.html` using CSS custom properties for theming.
- **Tests:** `node:test`. Provider tests inject mocks via `_setRpc()` / `_setSocketProvider()` etc — no live backend required.
- **Style:** Match surrounding code. Keep it simple. Don't add error handling for impossible scenarios.
- **Comments:** Default to none. Add one only when the *why* is non-obvious (a workaround, a constraint, a past incident). Don't restate what the code does.
- **Commits:** Explain *why*, not *what*. Squash noise before opening a PR.

## Testing

```bash
npm test                                     # full suite
node scripts/smoke-acp.js claude-code "hi"   # end-to-end ACP smoke against a real agent
node scripts/smoke-acp-restart.js            # exercises persistence + reattach
```

When adding a feature that crosses providers, run both smokes if you can.

## Pull requests

- One feature/fix per PR. Easier to review, easier to revert.
- Run `npm test` before pushing.
- New behavior → new test. Bug fix → regression test.
- If your change touches the kanban markdown format or the envelope contract, update the tests in `tests/lib/`.
- Note in the description if you tested against a specific provider end-to-end.

## Areas where we'd love help

- **Provider health view** — surface `listAgentsWithAvailability()` results in the UI
- **Vault renderers** — PDF, CSV/TSV, code notebooks
- **Mobile layout** — kanban especially
- **More ACP recipes** — Gemini CLI, anything new the spec brings
- **Real auth** — OAuth, magic-link, or device-flow for shared deployments
- **CI** — smoke pipelines, GitHub Actions
- **Docs** — setup guides, architecture deep-dives, video walkthroughs

## Questions?

Open an issue with the `question` label, or start a Discussion. We respond quickly.
