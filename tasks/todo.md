# Knowspace v2 — Multi-provider portal

Goal: turn Knowspace from an OpenClaw-only sidecar into a generic multi-agent
portal supporting OpenClaw, Hermes, Claude Code, Codex, and Gemini through two
provider implementations (`openclaw` gateway + unified `acp` adapter).

## Scope decisions

- **Multi-tenancy removed.** Knowspace is now single-user (one device, one
  vault). Token auth stays for visitor blocking; `clientSlug` collapses to a
  per-provider routing key (e.g. which OpenClaw agent to filter by).
- **Vault stays.** It's the shared memory layer across providers.
- **Kanban stays in vault** (Obsidian-compatible md), extended with invisible
  `<!-- ks:* -->` HTML comments for dispatch metadata.
- **Onboard skill removed.** Replaced with `knowspace providers add` /
  `knowspace agents add` CLI (next session — out of scope here).
- **YOLO trust mode** for kanban dispatch (no allowlist of cwd paths).

## Architecture (target)

```
adapters/providers/
  types.js                  Provider interface + capabilities (JSDoc)
  index.js                  Registry: load configured providers, expose getter
  openclaw/                 (refactor of adapters/engine/*)
    index.js
    paths.js
    messages.js
    sessions.js
    chat.js
  acp/                      New: speaks ACP via @agentclientprotocol/sdk
    index.js                Spawns adapter, owns connection
    session.js              Per-session state
    agents.js               Built-in agent recipes (claude, hermes, codex)

~/.knowspace/providers.json  Provider + agent config, written by CLI
```

## Plan (commits)

- [x] Preserve current state on `legacy/openclaw-portal` (pushed to origin)
- [x] **Commit A**: POCs + this plan into the branch
- [x] **Commit B**: Move `adapters/engine/*` → `adapters/providers/openclaw/*`,
      update test imports, fixed 4 pre-existing chat.test.js failures along
      the way
- [x] **Commit C**: Provider interface + registry (`adapters/providers/`)
- [x] **Commit D**: server.js wired through the registry (back-compat shim
      keeps existing call sites valid)
- [x] **Commit E**: ACP provider — Claude Code + Hermes + Codex through one
      implementation. Smoke test against Claude returns the prompt as
      expected; Hermes connection path validated (reply latency depends on
      its locally-configured model)
- [x] **Commit F**: `~/.knowspace/providers.json` loader — agent recipe
      overrides for ACP, enabling/disabling providers
- [x] **Commit G**: `lib/kanban.js` extended parser in production with
      `<!-- ks:* -->` metadata; cards expose stable id + meta in API
- [x] **Commit H**: `GET /api/providers`, `GET /api/agents` (with optional
      `?provider=` filter), `POST /api/kanban/dispatch` (creates session,
      sends rendered envelope, persists session linkage back to card)
- [x] **Commit I**: Final verification — 121/121 tests, server boots
      cleanly, authenticated endpoint smoke confirms payload (OpenClaw
      enumerates Jhones/Nando/Coury/David/...; ACP enumerates
      claude-code/hermes/codex)

## Out of scope (next session)

- Frontend changes (provider/agent picker, dispatch UI, session badges) — needs
  browser verification per CLAUDE.md, not safe to do headless
- CLI: `knowspace providers add`, `knowspace agents add`, slim onboard
- Tool-use approval UI for ACP `requestPermission` flow (POC stubbed it)
- Terminal ops for ACP coder mode (needs node-pty)
- Removing the legacy `knowspace-onboard` skill

## Verification

- `npm test` (49 + new tests for kanban + provider registry) must pass
- POC `npm run claude` and `npm run hermes` in `poc/acp/` keep working
- Dev startup smoke test: `npm start`, server boots without error, existing
  endpoints respond
