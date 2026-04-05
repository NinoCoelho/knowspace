# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Docker (production/testing)
```bash
# Start everything (gateway + knowspace)
docker compose up -d

# Rebuild after code changes
docker compose build knowspace && docker compose up -d knowspace

# View logs (first boot prints admin token)
docker compose logs knowspace

# Stop
docker compose down
```

### Knowspace CLI
```bash
# Start the server (local dev, requires gateway running separately)
knowspace serve [--port 3445]

# Onboard a client (install skills, generate templates & token)
knowspace onboard <slug>
knowspace onboard <slug> --output ~/slug/workspace
knowspace onboard <slug> --skills-target /path/to/engine/skills

# Token management
knowspace tokens list
knowspace tokens generate <slug>
knowspace tokens rotate <slug>
```

### Development
```bash
npm start          # Start the server
npm test           # Run adapter layer contract tests (49 tests)
```

### Environment Variables
```bash
KNOWSPACE_GATEWAY_URL      # WebSocket URL for engine gateway (default: ws://127.0.0.1:18789)
KNOWSPACE_GATEWAY_TOKEN    # Gateway auth token (falls back to CLAWDBOT_GATEWAY_TOKEN)
KNOWSPACE_PORT             # Portal port (default: 3445)
KNOWSPACE_BASE_URL         # Public URL for token links (default: http://localhost:<port>)
KNOWSPACE_ADMIN_SLUG       # Admin slug for first-boot token (default: main)
KNOWSPACE_TOKENS_FILE      # Path to tokens file (default: .tokens.json)
KNOWSPACE_WORKSPACE        # Workspace dir for skills (falls back to OPENCLAW_WORKSPACE)
```

## Architecture Overview

### Wrapper Architecture
Knowspace is a **product wrapper** over the OpenClaw engine. The architecture has three layers:

1. **Product Layer** — CLI, branding, templates, skills, frontend (everything the user sees)
2. **Adapter Layer** (`adapters/engine/`) — translates knowspace operations to engine calls. This is the **only** place that knows about engine internals.
3. **Engine** (`lib/gateway.js`) — low-level WebSocket RPC transport to OpenClaw Gateway

**Critical rule:** `server.js` never imports `lib/gateway.js` directly. All engine interaction goes through `adapters/engine/`.

### Directory Layout
```
server.js              # Express + Socket.IO, uses only adapters/engine
adapters/
  engine/
    index.js           # Barrel export
    paths.js           # Engine path conventions and session key formats
    messages.js        # Message normalization, filtering, status detection
    sessions.js        # Session CRUD (list, create, rename, delete)
    chat.js            # Chat operations (history, send, poll for reply)
lib/
  gateway.js           # Low-level WebSocket RPC client (singleton + pool)
middleware/
  auth.js              # Token-based authentication (SHA-256 hashed)
routes/
  api.js               # REST API endpoints for vault, kanban
public/
  index.html           # Single-page application entry point
  js/app.js            # Frontend JavaScript (vanilla JS, SPA architecture)
bin/
  knowspace.js         # CLI entry point
cli/
  serve.js             # CLI: start the server
  onboard.js           # CLI: onboard a client (skills, templates, token)
  tokens.js            # CLI: token management commands
skills/                # Bundled skills (client-onboard, content-matrix, etc.)
templates/             # Workspace templates for onboarding (AGENTS.md, IDENTITY.md, etc.)
tests/
  adapters/            # Contract tests for adapter layer (49 tests)
scripts/
  generate-token.js    # Legacy utility for generating client access tokens
  debug-history.js     # Debug utility: load chat history via adapter
Dockerfile             # Knowspace container image
docker-compose.yml     # Gateway + knowspace orchestration
.env.example           # Environment variable template
.tokens.json           # Secure token storage (hashed values, gitignored)
.device-keys.json      # Ed25519 device identity for Gateway auth (gitignored)
data/                  # Docker volume mount point (gitignored)
```

### Application Structure
Full-stack client portal with three main features:
1. **Real-time Chat** — WebSocket-based chat with AI agents via adapter layer
2. **File Vault** — Markdown and media file viewer with fuzzy search
3. **Kanban Board** — Task management with drag-and-drop, multiple boards

The application uses **no database** — all data is stored as files on the file system.

### Technology Stack

**Backend:**
- Express.js with Socket.IO for real-time WebSocket
- Adapter layer (`adapters/engine/`) wraps all engine RPC calls
- `lib/gateway.js` handles low-level WebSocket transport with Ed25519 device authentication
- Token-based client authentication with SHA-256 hashing
- Multer for file uploads (vault and temp chat attachments)
- Fuse.js for fuzzy search in vault

**Frontend:**
- Vanilla JavaScript with SPA architecture (no framework)
- Tailwind CSS via CDN for styling
- Socket.IO Client for real-time communication
- Marked.js for markdown rendering

### Key Architectural Patterns

**Adapter Layer (adapters/engine/):**
- `paths.js` — centralizes all engine path conventions (`~/.openclaw/...`) and session key formats (`agent:<slug>:...`). Single source of truth.
- `messages.js` — normalizes engine message format, filters internal system messages, detects agent status from content blocks
- `sessions.js` — wraps gateway RPC for session CRUD with retry logic and disk validation
- `chat.js` — wraps chat send/history/polling. The polling loop (2s interval, 30min max) detects `tool_use`/`tool_result` blocks for progress reporting.
- Both `sessions.js` and `chat.js` use lazy-loaded RPC with `_setRpc()` for test injection

**Token Authentication Flow:**
1. Admin generates token via `POST /admin/tokens/generate` with `clientSlug`
2. Token is returned unhashed for sharing with client
3. Client accesses `/auth?token=...` which validates and sets an `auth_token` cookie
4. Subsequent requests use the cookie, Bearer header, or query parameter
5. Server validates by hashing provided token and comparing with stored hash
6. Validated `clientSlug` is attached to `req.clientSlug` for downstream handlers

**First-Boot Token:**
- On startup, if no tokens exist, server auto-generates one for `KNOWSPACE_ADMIN_SLUG` (default: `main`)
- Access URL is printed to logs with a visual box — only appears once
- Token persists in `KNOWSPACE_TOKENS_FILE` (Docker: `/app/data/.tokens.json`)

**Session Management:**
- Sessions are identified by keys like `agent:<clientSlug>:web:direct:portal-<uuid>`
- Key construction is centralized in `adapters/engine/paths.js`
- On WebSocket connect, server sends `sessions:list` and loads the most recent session's history
- Agent processing state is tracked per session key in a `sessionProcessing` Map

**Client Data Storage:**
All client data resides at `~/<clientSlug>/workspace/vault/`:
- Uploaded files: `uploads/` subdirectory
- Kanban data: `kanban/*.md` (Obsidian-compatible markdown)
- Markdown files: Direct file system access

**Docker Architecture:**
- `gateway` service: official OpenClaw image, exposes port 18789, healthcheck on `/healthz`
- `knowspace` service: custom Dockerfile (Node 22 slim), connects to gateway via `ws://gateway:18789`
- Shared volume `./data/workspaces` for client data
- Gateway config in `./data/openclaw-config`, tokens in `./data/appdata`

### HTTP Endpoints

**Public:**
- `GET /auth?token=...` — Validate token and set auth cookie
- `GET /logout` — Clear auth cookie

**API (require auth):**
- `GET /api/client` — Returns authenticated `clientSlug`
- `GET /api/chat/history?sessionKey=...` — Load chat history via adapter
- `POST /api/chat/upload` — Upload temp files for chat attachments
- `GET /api/vault` — List all vault files
- `GET /api/vault/file?path=...` — Read a vault file
- `PUT /api/vault/file?path=...` — Save/update a vault file
- `DELETE /api/vault/file?path=...` — Delete a vault file
- `POST /api/vault/upload` — Upload file to vault
- `GET /api/vault/search?q=...` — Fuzzy search vault files
- `GET /api/kanban/list` — List available kanban boards
- `GET /api/kanban?file=...` — Load a kanban board
- `POST /api/kanban?file=...` — Save a kanban board
- `DELETE /api/kanban?file=...` — Delete a kanban board

**Admin (no auth):**
- `POST /admin/tokens/generate` — Generate new client token
- `POST /admin/tokens/rotate` — Rotate existing client token
- `GET /admin/tokens` — List all tokens

### WebSocket Events

**Client → Server:**
- `chat:message` — Send a chat message (with optional `tempFiles` and `messageId`)
- `sessions:list` — Request session list refresh
- `sessions:switch` — Switch active session (`{ sessionKey }`)
- `sessions:new` — Create a new session
- `sessions:rename` — Rename a session (`{ sessionKey, name }`)
- `sessions:delete` — Delete a session (`{ sessionKey }`)
- `agent:status` — Check if agent is currently processing

**Server → Client:**
- `chat:history` — Full chat history for a session
- `chat:message` — New assistant message
- `sessions:list` — Updated session list
- `typing` — Typing indicator
- `agent:progress` — Agent processing status (`thinking` / `executing`)
- `agent:status` — Agent processing state

### Important Implementation Details

**Security:**
- Tokens are SHA-256 hashed before storage; only the unhashed token is returned during generation
- All API endpoints (except `/admin/*`) require token validation
- File uploads to vault restricted to: `.md`, `.markdown`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp4`, `.webm`, `.mov`
- Path traversal prevention on all vault file operations

**Gateway Connection:**
- Device identity (Ed25519 key pair) auto-generated on first run, stored in `.device-keys.json`
- Gateway config read from env vars (`KNOWSPACE_GATEWAY_URL`, `KNOWSPACE_GATEWAY_TOKEN`) or `~/.openclaw/openclaw.json`
- Connection auto-reconnects: singleton client cleared on close, next RPC call triggers reconnect

**Testing:**
- 49 contract tests in `tests/adapters/` using Node.js built-in test runner (`node:test`)
- `sessions.js` and `chat.js` tests inject mock RPC via `_setRpc()` — no gateway needed
- `messages.js` and `paths.js` tests are pure unit tests

### Frontend State Management
The frontend uses simple JavaScript objects for state:
- `currentView` — Active tab ('chat', 'vault', or 'kanban')
- `vaultFiles` — Cached list of vault files
- `currentKanban` — Current kanban board state
- `clientSlug` — Authenticated client identifier
