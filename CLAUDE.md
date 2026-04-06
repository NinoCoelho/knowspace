# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

Knowspace is a **web portal sidecar** for [OpenClaw](https://github.com/openclaw/openclaw). It adds a browser UI, file vault, and kanban board on top of an existing OpenClaw installation. It does not modify OpenClaw — it connects to it via WebSocket RPC.

## CLI Commands

```bash
knowspace connect              # configure gateway + install onboard skill
knowspace configure            # interactive setup wizard / menu
knowspace configure --reset    # force wizard again
knowspace serve                # start the portal (default port 3445)
knowspace serve --port 4000
knowspace daemon install       # write service file, enable auto-start, start now
knowspace daemon uninstall     # stop and remove service file
knowspace daemon start
knowspace daemon stop
knowspace daemon restart
knowspace daemon status
knowspace daemon logs          # tail -f ~/.knowspace/knowspace.log
knowspace daemon logs --error  # tail -f ~/.knowspace/knowspace.error.log
knowspace tokens list
knowspace tokens generate <slug>
knowspace tokens rotate <slug>
```

Daemon backend: `launchd` on macOS (`~/Library/LaunchAgents/com.knowspace.server.plist`), `systemd --user` on Linux (`~/.config/systemd/user/knowspace.service`). Logs at `~/.knowspace/knowspace.log`.

## Development

```bash
npm start    # start the server (requires OpenClaw gateway running)
npm test     # run adapter layer contract tests (49 tests)
```

## Environment Variables

```
KNOWSPACE_GATEWAY_URL      WebSocket URL for the OpenClaw gateway (default: ws://127.0.0.1:18789)
KNOWSPACE_GATEWAY_TOKEN    Gateway auth token (falls back to openclaw.json)
KNOWSPACE_PORT             Portal port (default: 3445)
KNOWSPACE_BASE_URL         Public URL for token links (default: http://localhost:<port>)
KNOWSPACE_ADMIN_SLUG       Slug for first-boot auto-generated token (default: main)
KNOWSPACE_TOKENS_FILE      Path to tokens file (default: .tokens.json)
```

Set in shell or `~/.knowspace/.env`.

## Directory Layout

```
server.js                    Express + Socket.IO server
adapters/engine/
  index.js                   Barrel export
  paths.js                   Engine path conventions, session key formats
  messages.js                Message normalization, filtering, status detection
  sessions.js                Session CRUD via gateway RPC (with retry + disk validation)
  chat.js                    Chat: history, send, streaming poll for replies
lib/gateway.js               Low-level WebSocket RPC client (Ed25519 device auth)
middleware/auth.js           Token authentication (SHA-256 hashed)
routes/api.js                REST API: vault, kanban
public/
  index.html                 SPA entry point + all CSS
  js/app.js                  Frontend (vanilla JS, no framework)
bin/knowspace.js             CLI entry point
cli/
  connect.js                 Configure gateway + install knowspace-onboard skill
  configure/
    wizard.js                First-run wizard (gateway → vault → token)
    menu.js                  Subsequent-run menu
    gateway.js               OpenClaw gateway detection and config
    vault.js                 Vault path configuration (main client only)
    skills.js                Skill install + AGENTS.md registration
    state.js                 ~/.knowspace/config.json read/write
    env.js                   ~/.knowspace/.env and ~/.openclaw/.env read/write
    prompts.js               readline-based interactive prompts
  daemon.js                  Daemon lifecycle (install/uninstall/start/stop/restart/status/logs)
  daemon/
    launchd.js               macOS launchd backend
    systemd.js               Linux systemd --user backend
  serve.js                   Start server interactively
  tokens.js                  Token management
  onboard.js                 Legacy: creates workspace + token from CLI args
skills/
  knowspace-onboard/         Agent skill: instructs agent how to onboard portal clients
    SKILL.md                 Skill instructions (no env vars required)
templates/                   Workspace markdown templates (SOUL, USER, AGENTS, IDENTITY, MEMORY)
tests/
  adapters/                  49 contract tests using node:test (no gateway needed)
scripts/
  generate-token.js          Legacy one-off token generator
  debug-history.js           Debug utility: dump chat history via adapter
.tokens.json                 Hashed token storage (gitignored)
.device-keys.json            Ed25519 key pair for gateway auth (gitignored)
```

## Architecture

### Critical Rule

`server.js` **never** imports `lib/gateway.js` directly. All engine interaction goes through `adapters/engine/`. This isolates all OpenClaw coupling to one place.

### Adapter Layer (`adapters/engine/`)

- **`paths.js`** — single source of truth for all engine path conventions (`~/.openclaw/...`) and session key formats (`agent:<slug>:web:direct:portal-<uuid>`). Resolves the skills target path from `openclaw.json` (`agents.workspace`).
- **`messages.js`** — normalizes raw engine messages, filters internal system messages, detects agent status from `tool_use`/`tool_result` blocks.
- **`sessions.js`** — session CRUD via gateway RPC. Filters to the authenticated client's sessions by key prefix. Marks non-portal sessions (subagents) with `isSubagent: true`.
- **`chat.js`** — history load, message send, and streaming poll loop. Calls `onMessage` for each new final reply as it arrives; continues until agent is idle (3 consecutive polls with no new messages and no pending tool_use).

### Vault Path Resolution

`routes/api.js` and `server.js` resolve the vault base via `getVaultBase(clientSlug)`:
1. Reads `~/.knowspace/config.json`
2. If `config.slug === clientSlug` and `config.vaultPath` is set, uses that path
3. Falls back to `~/<slug>/workspace/vault`

**Main client** — vault path is set manually via `knowspace configure` (step 2). Can point to any directory (e.g., iCloud, Obsidian vault). Stored in `~/.knowspace/config.json`.

**Onboarded clients** — vault is always at `~/slug/workspace/vault`, created by the agent during onboarding via the `knowspace-onboard` skill. No manual configuration needed.

### Token Authentication

1. Token generated via `POST /admin/tokens/generate` or `knowspace tokens generate <slug>`
2. Token returned unhashed — share with client
3. Client visits `/auth?token=...` — cookie set
4. All subsequent requests validated via cookie, Bearer header, or query param
5. SHA-256 hash compared against `.tokens.json`; `clientSlug` attached to `req.clientSlug`

**First boot:** if no tokens exist, server auto-generates one for `KNOWSPACE_ADMIN_SLUG` and prints the access URL once.

### Session Keys

- Portal sessions: `agent:<slug>:web:direct:portal-<uuid>` — shown in sidebar
- Subagent sessions: any other `agent:<slug>:*` key — hidden from sidebar, `isSubagent: true`

### Gateway Connection

- Ed25519 device identity auto-generated on first run, stored in `.device-keys.json`
- Config priority: env vars -> `~/.openclaw/openclaw.json` -> defaults
- Auto-reconnects: singleton cleared on close, next RPC call reconnects

### Skills Target Path

Resolved dynamically by `paths.getSkillsTargetPath()`:
1. Reads `~/.openclaw/openclaw.json`
2. Uses `agents.workspace` field (e.g., `~/.openclaw/workspace`)
3. Returns `<workspace>/skills/`
4. Falls back to `~/.openclaw/workspace/skills/`

## Testing

```bash
npm test
```

49 contract tests in `tests/adapters/` using Node.js built-in `node:test`. Sessions and chat tests inject a mock RPC via `_setRpc()` — no live gateway needed. Messages and paths tests are pure unit tests.

## HTTP Endpoints

**Public:**
- `GET /auth?token=...` — validate token, set cookie
- `GET /logout` — clear cookie

**API (auth required):**
- `GET /api/client`
- `GET /api/chat/history?sessionKey=...`
- `POST /api/chat/upload`
- `GET /api/vault`, `GET /api/vault/file`, `PUT /api/vault/file`, `DELETE /api/vault/file`
- `POST /api/vault/upload`, `GET /api/vault/search?q=...`
- `GET /api/kanban/list`, `GET /api/kanban`, `POST /api/kanban`, `DELETE /api/kanban`

**Admin (no auth):**
- `POST /admin/tokens/generate`
- `POST /admin/tokens/rotate`
- `GET /admin/tokens`

## WebSocket Events

**Client -> Server:** `chat:message`, `sessions:list`, `sessions:switch`, `sessions:new`, `sessions:rename`, `sessions:delete`, `agent:status`

**Server -> Client:** `chat:history`, `chat:message`, `sessions:list`, `typing`, `agent:progress`, `agent:status`
