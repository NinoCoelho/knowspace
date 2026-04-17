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
- [ ] **Commit A**: POCs + this plan into the branch
- [ ] **Commit B**: Move `adapters/engine/*` → `adapters/providers/openclaw/*`,
      update test imports, keep all 49 tests green, behavior unchanged
- [ ] **Commit C**: Define Provider interface (`adapters/providers/types.js`)
      and registry (`adapters/providers/index.js`); wrap OpenClaw as a
      Provider implementation
- [ ] **Commit D**: Wire `server.js` and `routes/api.js` to use the registry;
      OpenClaw remains the default; existing API/WebSocket events unchanged
- [ ] **Commit E**: Implement ACP provider, port POC #1 client, support
      Claude Code + Hermes + Codex agents through one code path
- [ ] **Commit F**: Provider+agent config persistence at
      `~/.knowspace/providers.json` (read-only loader for now; CLI later)
- [ ] **Commit G**: Replace kanban parser/serializer in `routes/api.js` with
      POC #2 version; cards expose `id` (stable) and `meta` fields
- [ ] **Commit H**: New endpoints: `GET /api/providers`, `GET /api/agents`,
      `POST /api/kanban/dispatch`; the dispatch endpoint creates a session in
      the target provider, builds the context envelope, sends it as the first
      prompt, writes session id back into the card's `ks:session` comment
- [ ] **Commit I**: Final verification — full test suite, smoke test ACP
      against Claude and Hermes, smoke test OpenClaw still works

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
