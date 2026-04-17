# Knowspace v2: multi-provider portal (OpenClaw + ACP) with kanban dispatch

## Summary

- Generalizes Knowspace from an OpenClaw-only sidecar into a multi-provider agent portal. Two providers ship: `openclaw` (existing WebSocket gateway, refactored) and `acp` (one implementation that covers Claude Code, Hermes, Codex, Gemini, and any future ACP-compatible agent). The chat loop is provider-agnostic via `lib/session-router`.
- Kanban cards gain stable IDs and `<!-- ks:* -->` metadata (assignee, linked sessions, vault refs) — invisible to Obsidian Kanban, parseable by Knowspace. New `POST /api/kanban/dispatch` creates a session in the target provider, sends the rendered context envelope as the first prompt, persists the session id back to the card, and the UI auto-jumps to the chat.
- New CLI: `knowspace providers list/enable/disable/path`, `knowspace agents list/add/remove/show`. Onboard slimmed: skill installation removed, multi-tenancy gone (single-user model).

Branch is preserved at `legacy/openclaw-portal` for anyone who wants to fork the v1 sidecar.

## Architecture

```
adapters/providers/
  types.js               # Provider interface (JSDoc)
  index.js               # Registry, loads providers.json
  config.js              # ~/.knowspace/providers.json loader
  openclaw/              # Was adapters/engine/* — wraps as a Provider
  acp/                   # JSON-RPC over stdio via @agentclientprotocol/sdk
    agents.js            # Built-in recipes (claude-code/hermes/codex)
    connection.js        # Spawned subprocess + ACP connection lifecycle
    session-store.js     # Push → poll bridge (per-session message buffer)
    index.js             # Provider implementation
lib/
  kanban.js              # Parser/serializer with ks:* metadata
  envelope.js            # Renders the dispatch envelope as markdown
  session-router.js      # Maps session-key prefix → owning provider
```

Session keys: `agent:<slug>:web:direct:portal-<uuid>` (openclaw) or `acp:<agentId>:<uuid>` (acp).

## What's new for users

- Right-click any kanban card → "Dispatch to agent…" → pick from any registered agent across providers → the agent gets a markdown envelope (task title, body, vault refs inlined) and a fresh session, and the chat view opens on it.
- Cards display assignee + last session status pills. Multiple `ks:session` lines accumulate, so handoff history survives in the .md.
- `knowspace providers list` shows what's wired; `knowspace agents add my-coder --cmd /usr/local/bin/acp-server --kind coder` registers a custom ACP agent. Config in `~/.knowspace/providers.json`.

## Verification

- 136/136 tests green (`npm test`). Suites cover the Provider registry, ACP agents/store/poll loop, kanban roundtrip, envelope rendering, session router, and the CLI binary against an isolated config file.
- End-to-end smoke validated against real Claude Code via `node scripts/smoke-acp.js claude-code` — prompt → reply through the production wiring.
- Server boots cleanly (`KNOWSPACE_PORT=13458 node server.js`); authenticated `GET /api/providers` and `GET /api/agents` return the expected payload (9 OpenClaw agents + 3 ACP recipes).

## Test plan

- [ ] Pull the branch, run `npm install` (adds `@agentclientprotocol/sdk`)
- [ ] Run `npm test` — expect 136 pass
- [ ] `node scripts/smoke-acp.js claude-code "say hi"` against your Claude install
- [ ] `knowspace providers list` and `knowspace agents list --provider acp`
- [ ] `npm start`, open the portal, dispatch a kanban card to claude-code, confirm the chat view opens on the new session and the agent replies
- [ ] Edit the kanban .md in Obsidian — `ks:*` comments should be invisible

## Deferred

- Tool-use approval UI (ACP `requestPermission` runs in YOLO mode today)
- Terminal ops for ACP coder mode (needs `node-pty`)
- Sidebar agent picker ("new chat" still defaults to OpenClaw)
- Persistence for ACP sessions across server restarts (in-memory today)

Tracked in [tasks/todo.md](tasks/todo.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
