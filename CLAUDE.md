# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

Knowspace is a **multi-provider agent portal**. It started as a sidecar for [OpenClaw](https://github.com/openclaw/openclaw) and v2 generalized it: today it connects to OpenClaw, Claude Code, Hermes, Codex, and any other agent that speaks the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) through one of two providers (`openclaw` WebSocket gateway, or `acp` JSON-RPC over stdio). The portal adds a browser UI, file vault, kanban board, and dispatch flow on top of those agents — it does not modify them.

Single-user model: one Knowspace instance per user. Token auth blocks visitors but does not partition data; multi-tenant client slugs were removed in v2.

## CLI Commands

```bash
knowspace configure            # interactive setup wizard / menu (gateway, vault, token)
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
knowspace providers list                       # show registered providers
knowspace providers enable|disable <id>        # toggle a provider in providers.json
knowspace agents list [--provider <id>]        # list agents grouped by provider
knowspace agents add <id> --cmd <bin> [opts]   # register a new ACP agent recipe
knowspace agents remove <id>                   # remove an ACP agent override
knowspace agents show <id>                     # print resolved recipe
```

Daemon backend: `launchd` on macOS (`~/Library/LaunchAgents/com.knowspace.server.plist`), `systemd --user` on Linux (`~/.config/systemd/user/knowspace.service`). Logs at `~/.knowspace/knowspace.log`.

## Development

```bash
npm start    # start the server (any configured provider works; gateway only needed for openclaw)
npm test     # run the full suite (~136 tests across providers, kanban, envelope, router, CLI)
node scripts/smoke-acp.js claude-code "say hi"   # end-to-end ACP smoke against a real agent
```

## Environment Variables

```
KNOWSPACE_GATEWAY_URL      WebSocket URL for the OpenClaw gateway (default: ws://127.0.0.1:18789)
KNOWSPACE_GATEWAY_TOKEN    Gateway auth token (falls back to openclaw.json)
KNOWSPACE_PORT             Portal port (default: 3445)
KNOWSPACE_BASE_URL         Public URL for token links (default: http://localhost:<port>)
KNOWSPACE_ADMIN_SLUG       Slug for first-boot auto-generated token (default: main)
KNOWSPACE_TOKENS_FILE      Path to tokens file (default: .tokens.json)
KNOWSPACE_PROVIDERS_FILE   Provider config file (default: ~/.knowspace/providers.json)
KNOWSPACE_ACP_DEBUG        When truthy, log every ACP sessionUpdate to stderr
```

Set in shell or `~/.knowspace/.env`.

## Directory Layout

```
server.js                    Express + Socket.IO server
adapters/providers/          v2 Provider abstraction
  types.js                   JSDoc Provider interface (no runtime code)
  index.js                   Registry: getProvider/listProviders, applies providers.json
  config.js                  Loader for ~/.knowspace/providers.json
  openclaw/                  OpenClaw provider (was adapters/engine/* in v1)
    paths.js, messages.js, sessions.js, chat.js, index.js
  acp/                       ACP provider — Claude Code, Hermes, Codex, Gemini, ...
    agents.js                Built-in recipes
    connection.js            Spawns the ACP server subprocess + connection lifecycle
    session-store.js         Per-session in-memory message buffer (push → poll bridge)
    index.js                 Provider implementation
lib/
  gateway.js                 Low-level WebSocket RPC client (Ed25519, OpenClaw only)
  kanban.js                  Markdown parser/serializer with <!-- ks:* --> metadata
  envelope.js                Renders the dispatch context envelope as markdown
  session-router.js          Routes a session key to its owning provider by prefix
middleware/auth.js           Token authentication (SHA-256 hashed)
routes/api.js                REST API: vault, kanban, providers, agents, dispatch
public/
  index.html                 SPA entry point + all CSS
  js/app.js                  Frontend (vanilla JS, no framework)
bin/knowspace.js             CLI entry point
cli/
  connect.js                 Configure the OpenClaw gateway link
  providers.js               list / enable / disable / path
  agents.js                  list / add / remove / show
  configure/
    wizard.js                First-run wizard (gateway → vault → token)
    menu.js                  Subsequent-run menu
    gateway.js               OpenClaw gateway detection and config
    vault.js                 Vault path configuration
    skills.js                Optional skill install (legacy, on-demand only)
    state.js                 ~/.knowspace/config.json read/write
    env.js                   ~/.knowspace/.env and ~/.openclaw/.env read/write
    prompts.js               readline-based interactive prompts
  daemon.js                  Daemon lifecycle (install/uninstall/start/stop/restart/status/logs)
  daemon/
    launchd.js               macOS launchd backend
    systemd.js               Linux systemd --user backend
  serve.js                   Start server interactively
  tokens.js                  Token management (list / generate / rotate)
  constants.js               CLI-level constants (DEFAULT_USER_SLUG for v2 single-user)
skills/
  knowspace-onboard/         Legacy multi-tenant onboarding skill (no longer auto-installed; kept for users who opt in via `knowspace configure`)
tests/
  adapters/                  Tests for the openclaw provider internals
  providers/                 Registry, config, ACP agents/store/poll tests
  lib/                       Kanban parser, envelope, session-router tests
  cli/                       providers/agents CLI integration tests
scripts/
  generate-token.js          Legacy one-off token generator
  debug-history.js           Debug utility: dump chat history via adapter
  smoke-acp.js               End-to-end ACP smoke against a real agent
poc/acp/                     POC reference for the ACP client (kept as documentation)
.tokens.json                 Hashed token storage (gitignored)
.device-keys.json            Ed25519 key pair for gateway auth (gitignored)
```

## Architecture

### Critical Rules

1. `server.js` **never** imports `lib/gateway.js` directly. All OpenClaw interaction goes through `adapters/providers/openclaw/`.
2. `server.js` and `routes/api.js` route session operations through `lib/session-router` or the registry — they do **not** hardcode a provider for new code paths. The legacy `engine` shim is for back-compat only.

### Provider abstraction (`adapters/providers/`)

The `Provider` interface (see `types.js`) is the contract every backend implements:

```
listAgents() | listSessions(agentId) | createSession(agentId, opts)
loadHistory(sessionKey, limit) | sendMessage(sessionKey, text) | pollForReply(sessionKey, msgCountBefore, opts)
renameSession | deleteSession | health
capabilities { persistentSessions, streaming, toolUse, fileAttachments, cwdBinding, multiAgent }
```

Two built-in providers:

- **`openclaw`** — wraps the existing WebSocket gateway. `agentId` maps to an OpenClaw agent slug (Jhones, Nando, Coury, …). Session keys are `agent:<slug>:web:direct:portal-<uuid>`.
- **`acp`** — JSON-RPC over stdio per the [Agent Client Protocol](https://agentclientprotocol.com/) via `@agentclientprotocol/sdk`. Spawns one subprocess per agent recipe (`claude-code` via `npx @agentclientprotocol/claude-agent-acp`, `hermes` via `hermes acp`, `codex` via `codex acp`). Session keys are `acp:<agentId>:<uuid>`. The push-based `sessionUpdate` notifications are buffered in `session-store.js` so the existing poll-based chat loop keeps working unchanged. ACP sessions are in-memory only — they don't survive a server restart.

`registerProvider(provider)` lets external code add a new backend. `~/.knowspace/providers.json` (loaded by `config.js`) overrides built-in agent recipes and toggles providers on/off.

### Session routing (`lib/session-router.js`)

Maps a session key prefix → owning provider:

- `acp:...`   → acp
- `agent:...` → openclaw
- (anything else) → default (openclaw)

`getProviderForSession(key)` is what server.js + routes use to dispatch chat operations. `listAllSessions({ clientSlug })` aggregates sessions across providers for the sidebar.

### Kanban with `ks:*` metadata (`lib/kanban.js`)

Each card carries Knowspace-specific metadata in HTML comments inside the body — invisible to Obsidian Kanban but parseable by us:

```
<!-- ks:id=<uuid> -->                                stable card id
<!-- ks:assignee=<provider>:<agentId> -->            preferred agent
<!-- ks:session provider=<p> id=<sid> status=<s> --> linked session (append-only)
<!-- ks:vault-refs=path/a.md,path/b.md -->           extra context refs
```

IDs are auto-generated on first save. `POST /api/kanban/dispatch` reads a card by id, builds the envelope (`lib/envelope.js`), creates a session in the target provider, sends the envelope as the first prompt, and writes the new `ks:session` line back to the card.

### Vault Path Resolution

`routes/api.js` and `server.js` resolve the vault base via `getVaultBase(clientSlug)`:
1. Reads `~/.knowspace/config.json`
2. If `config.slug === clientSlug` and `config.vaultPath` is set, uses that path
3. Falls back to `~/<slug>/workspace/vault`

Vault path is set manually via `knowspace configure`. Can point to any directory (e.g., iCloud, Obsidian vault). Stored in `~/.knowspace/config.json`. Multi-tenant onboarded clients no longer exist in v2.

### Token Authentication

1. Token generated via `POST /admin/tokens/generate` or `knowspace tokens generate <slug>`
2. Token returned unhashed — share with client
3. Client visits `/auth?token=...` — cookie set
4. All subsequent requests validated via cookie, Bearer header, or query param
5. SHA-256 hash compared against `.tokens.json`; `clientSlug` attached to `req.clientSlug`

**First boot:** if no tokens exist, server auto-generates one for `KNOWSPACE_ADMIN_SLUG` and prints the access URL once.

### Session Keys

- OpenClaw portal sessions: `agent:<slug>:web:direct:portal-<uuid>` — shown in sidebar
- OpenClaw subagent sessions: any other `agent:<slug>:*` key — hidden from sidebar, `isSubagent: true`
- ACP sessions: `acp:<agentId>:<uuid>` — created via `POST /api/kanban/dispatch` or `provider.createSession`, in-memory until restart

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
