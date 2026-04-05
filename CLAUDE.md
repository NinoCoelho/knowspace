# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Knowspace CLI
```bash
# Start the server
knowspace serve [--port 3445]

# Onboard a client (install skills, generate templates & token)
knowspace onboard <slug>
knowspace onboard <slug> --output ~/slug/workspace
knowspace onboard <slug> --skills-target /path/to/openclaw/skills

# Token management
knowspace tokens list
knowspace tokens generate <slug>
knowspace tokens rotate <slug>
```

### Development
```bash
# Start the server (alternative to knowspace serve)
npm start
# or
npm dev
```

### Token Management (legacy)
```bash
# Generate a new token for a client
node scripts/generate-token.js <client-slug>
```

### Testing
```bash
# Test chat history loading
node test_history.js
```

## Architecture Overview

### Application Structure
This is a full-stack client portal application that provides three main features:
1. **Real-time Chat** - WebSocket-based chat integration with OpenClaw AI agents via Gateway RPC
2. **File Vault** - Markdown and media file viewer with fuzzy search
3. **Kanban Board** - Task management with drag-and-drop, multiple boards

The application uses **no database** - all data is stored as files on the file system.

### Directory Layout
```
server.js              # Express server with Socket.IO, entry point
public/
  index.html           # Single-page application entry point
  js/app.js            # Frontend JavaScript (vanilla JS, SPA architecture)
middleware/
  auth.js              # Token-based authentication (SHA-256 hashed)
routes/
  api.js               # REST API endpoints for vault, kanban
lib/
  gateway.js           # OpenClaw Gateway WebSocket RPC client (singleton)
bin/
  knowspace.js         # CLI entry point
cli/
  serve.js             # CLI: start the server
  onboard.js           # CLI: onboard a client (skills, templates, token)
  tokens.js            # CLI: token management commands
skills/                # Bundled OpenClaw skills (client-onboard, content-matrix, etc.)
templates/             # Workspace templates for onboarding (AGENTS.md, IDENTITY.md, etc.)
scripts/
  generate-token.js    # Legacy utility for generating client access tokens
.tokens.json           # Secure token storage (hashed values)
.device-keys.json      # Ed25519 device identity for Gateway authentication
```

### Technology Stack

**Backend:**
- Express.js with Socket.IO for real-time WebSocket
- OpenClaw Gateway RPC client (`lib/gateway.js`) over persistent WebSocket with Ed25519 device authentication
- Token-based client authentication with SHA-256 hashing
- Multer for file uploads (vault and temp chat attachments)
- Gray-matter for markdown frontmatter parsing
- Fuse.js for fuzzy search in vault
- cookie-parser for auth cookie management

**Frontend:**
- Vanilla JavaScript with SPA architecture (no framework)
- Tailwind CSS via CDN for styling
- Socket.IO Client for real-time communication
- Marked.js for markdown rendering

### Key Architectural Patterns

**Token Authentication Flow:**
1. Admin generates token via `POST /admin/tokens/generate` with `clientSlug`
2. Token is returned unhashed for sharing with client
3. Client accesses `/auth?token=...` which validates and sets an `auth_token` cookie
4. Subsequent requests use the cookie, Bearer header, or query parameter
5. Server validates by hashing provided token and comparing with stored hash
6. Validated `clientSlug` is attached to `req.clientSlug` for downstream handlers

**OpenClaw Gateway Integration:**
- `lib/gateway.js` maintains a singleton persistent WebSocket connection to OpenClaw Gateway at `ws://127.0.0.1:<port>` (port from `~/.openclaw/openclaw.json`, default 18789)
- Authentication uses Ed25519 device identity (keys stored in `.device-keys.json`), with a challenge-response handshake on connect
- Chat messages are sent via `gatewayRpc('chat.send', { sessionKey, message, deliver: true, ... })`
- Chat history is loaded via `gatewayRpc('chat.history', { sessionKey, limit })`
- Sessions are managed via `gatewayRpc('sessions.list/patch/delete', ...)`
- After sending a message, the server polls `chat.history` every 2s for up to 30 minutes waiting for the assistant reply
- During polling, `tool_use`/`tool_result` content blocks are detected to emit `agent:progress` events (`thinking`/`executing`)
- Internal/system messages are filtered out before sending to the client (patterns like "Exec denied", "Do not run the command again")

**Session Management:**
- Sessions are identified by keys like `agent:<clientSlug>:web:direct:portal-<uuid>`
- On WebSocket connect, server sends `sessions:list` and loads the most recent session's history
- Clients can create, switch, rename, and delete sessions via WebSocket events
- Session list includes derived titles and last message info from Gateway
- Agent processing state is tracked per session key in a `sessionProcessing` Map (survives socket reconnects)

**Client Data Storage:**
All client data resides at `~/<clientSlug>/workspace/vault/`:
- Uploaded files: `uploads/` subdirectory
- Kanban data: `kanban/*.md` (multiple boards supported, Obsidian-style markdown format)
- Markdown files: Direct file system access

**Chat File Attachments:**
- Temp files uploaded via `POST /api/chat/upload` (up to 10 files, any type)
- Stored in `/tmp/chat-<clientSlug>-<messageId>/`
- File paths are appended to the chat message text before sending to Gateway
- Temp files are cleaned up after 5 minutes

**Kanban Storage Format:**
Kanban boards are stored as markdown files with Obsidian-compatible format:
```markdown
---
kanban-plugin: basic
---

# Board Title

## Lane Title

### Card Title
Card body content (markdown)
```

### HTTP Endpoints

**Public:**
- `GET /auth?token=...` - Validate token and set auth cookie
- `GET /logout` - Clear auth cookie

**API (require auth):**
- `GET /api/client` - Returns authenticated `clientSlug`
- `GET /api/chat/history?sessionKey=...` - Load chat history for a session via Gateway
- `POST /api/chat/upload` - Upload temp files for chat attachments
- `GET /api/vault` - List all vault files
- `GET /api/vault/file?path=...` - Read a vault file
- `PUT /api/vault/file?path=...` - Save/update a vault file
- `DELETE /api/vault/file?path=...` - Delete a vault file
- `POST /api/vault/upload` - Upload file to vault
- `GET /api/vault/search?q=...` - Fuzzy search vault files
- `GET /api/kanban/list` - List available kanban boards
- `GET /api/kanban?file=...` - Load a kanban board
- `POST /api/kanban?file=...` - Save a kanban board
- `DELETE /api/kanban?file=...` - Delete a kanban board

**Admin (no auth):**
- `POST /admin/tokens/generate` - Generate new client token
- `POST /admin/tokens/rotate` - Rotate existing client token
- `GET /admin/tokens` - List all tokens

### WebSocket Events

**Client → Server:**
- `chat:message` - Send a chat message (with optional `tempFiles` and `messageId`)
- `sessions:list` - Request session list refresh
- `sessions:switch` - Switch active session (`{ sessionKey }`)
- `sessions:new` - Create a new session
- `sessions:rename` - Rename a session (`{ sessionKey, name }`)
- `sessions:delete` - Delete a session (`{ sessionKey }`)
- `agent:status` - Check if agent is currently processing

**Server → Client:**
- `chat:history` - Full chat history for a session (`{ messages, sessionKey }`)
- `chat:message` - New assistant message (`{ role, content, timestamp }`)
- `sessions:list` - Updated session list (`{ sessions }`)
- `typing` - Typing indicator (`{ typing: boolean }`)
- `agent:progress` - Agent processing status (`{ status: 'thinking' | 'executing' }`)
- `agent:status` - Agent processing state (`{ processing: boolean }`)

### Important Implementation Details

**Security:**
- Tokens are SHA-256 hashed before storage; only the unhashed token is returned during generation
- All API endpoints (except `/admin/*`) require token validation
- File uploads to vault are restricted to: `.md`, `.markdown`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp4`, `.webm`, `.mov`
- Temp chat uploads accept any file type
- Path traversal prevention on all vault file operations

**Gateway Connection:**
- Device identity (Ed25519 key pair) is auto-generated on first run and stored in `.device-keys.json`
- Gateway config is read from `~/.openclaw/openclaw.json` or env vars (`CLAWDBOT_GATEWAY_URL`, `CLAWDBOT_GATEWAY_TOKEN`)
- Connection auto-reconnects: singleton client is cleared on close, next RPC call triggers reconnect
- Separate event client pool exists for streaming use cases (`acquireGatewayClient`/`releaseGatewayClient`)

**File Uploads:**
- Vault uploads are renamed with timestamp + random suffix to prevent collisions
- Files are served back via `/api/vault/file?path=...`
- Images and videos are rendered directly; markdown files are parsed with Marked.js

### Frontend State Management
The frontend uses simple JavaScript objects for state:
- `currentView` - Active tab ('chat', 'vault', or 'kanban')
- `vaultFiles` - Cached list of vault files
- `currentKanban` - Current kanban board state
- `clientSlug` - Authenticated client identifier

Navigation between views triggers data loading (vault and kanban load on view switch).
