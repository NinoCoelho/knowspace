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

## Done after the original plan (commits J–O)

- [x] **Commit J**: `knowspace providers` and `knowspace agents` CLI
      (list/add/remove/show/enable/disable). 10 integration tests drive the
      binary end-to-end against an isolated config file.
- [x] **Commit K**: Frontend dispatch UI — "Dispatch to agent…" item in
      the kanban card context menu, modal listing agents grouped by
      provider with optional cwd, meta footer on cards (assignee +
      session-status pill).
- [x] **Commit L**: `lib/session-router.js` + server.js plumbing — chat
      operations route by session key prefix so `acp:*` sessions are
      chatable through the existing chat loop.
- [x] **Commit M**: After dispatch, jump to the chat view on the new
      session so the user sees the agent's reply instead of staring at
      the kanban.
- [x] **Commit N**: Slimmed `knowspace connect` and `knowspace onboard`
      — skill installation removed, multi-tenant onboarding is gone.
      Workspace template scaffolding + token generation kept.
- [x] **Commit O**: CLAUDE.md updated to reflect the v2 architecture.

## Still deferred (next session)

- Tool-use approval UI: backend queues an ACP `requestPermission` event
  on a websocket, frontend pops a modal, user approves/denies.
- Terminal ops for ACP coder mode: node-pty-backed `createTerminal` /
  `terminalOutput` / etc. so coder agents can actually run shells.
- Provider/agent picker for "new chat" in the sidebar — currently new
  chats default to the OpenClaw provider; ACP chats only exist via
  dispatch. Picker would let the user start an ACP session from the
  chat sidebar without needing a kanban card.
- Persistence for ACP sessions across server restart (currently
  in-memory only via session-store).

## Verification

- `npm test` (49 + new tests for kanban + provider registry) must pass
- POC `npm run claude` and `npm run hermes` in `poc/acp/` keep working
- Dev startup smoke test: `npm start`, server boots without error, existing
  endpoints respond
