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
1. **Real-time Chat** - WebSocket-based chat integration with OpenClaw AI agents
2. **File Vault** - Markdown and media file viewer with search
3. **Kanban Board** - Task management with drag-and-drop

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
  api.js               # REST API endpoints for vault, kanban, chat history
scripts/
  generate-token.js    # Utility for generating client access tokens
.tokens.json          # Secure token storage (hashed values)
```

### Technology Stack

**Backend:**
- Express.js with Socket.IO for real-time WebSocket
- Token-based authentication with SHA-256 hashing
- Multer for file uploads
- Gray-matter for markdown frontmatter parsing
- Fuse.js for fuzzy search in vault

**Frontend:**
- Vanilla JavaScript with SPA architecture (no framework)
- Tailwind CSS via CDN for styling
- Socket.IO Client for real-time communication
- Marked.js for markdown rendering

### Key Architectural Patterns

**Token Authentication Flow:**
1. Admin generates token via `POST /admin/tokens/generate` with `clientSlug`
2. Token is returned unhashed for sharing with client
3. Client provides token in URL query parameter or Bearer header
4. Server validates by hashing provided token and comparing with stored hash
5. Validated `clientSlug` is attached to `req.clientSlug` for downstream handlers

**OpenClaw Integration:**
- Chat messages are sent to OpenClaw via CLI: `openclaw agent --agent <clientSlug> --message "..." --json`
- Session IDs are persisted in memory (`clientSessions`) to maintain conversation context
- Chat history is read from OpenClaw session files at `~/.openclaw/agents/<clientSlug>/sessions/*.jsonl`
- Most recent 50 messages are loaded on WebSocket connection

**Client Data Storage:**
All client data resides at `~/<clientSlug>/workspace/vault/`:
- Uploaded files: `uploads/` subdirectory
- Kanban data: `kanban/kanban.md` (Obsidian-style markdown format)
- Markdown files: Direct file system access

**Kanban Storage Format:**
Kanban boards are stored as markdown files with Obsidian-compatible format:
```markdown
---
kanban-plugin: basic
---

# Board Title

## Lane Title

- [ ] Card content (markdown)
- [x] Completed card
```

### Important Implementation Details

**Security:**
- Tokens are SHA-256 hashed before storage; only the unhashed token is returned during generation
- All API endpoints (except `/admin/*`) require token validation
- File uploads are restricted to: `.md`, `.markdown`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp4`, `.webm`, `.mov`

**WebSocket Connection:**
- Tokens are passed via query string during handshake
- Client receives full chat history on connect via `chat:history` event
- Typing indicators are sent via `typing` event

**File Uploads:**
- Uploaded files are renamed with timestamp + random suffix to prevent collisions
- Files are served back via `/api/vault/file?token=...&path=...`
- Images and videos are rendered directly; markdown files are parsed with Marked.js

**Session Management:**
- OpenClaw session IDs are stored in `clientSessions[clientSlug]` in server memory
- Session IDs expire when the server restarts

### Frontend State Management
The frontend uses simple JavaScript objects for state:
- `currentView` - Active tab ('chat', 'vault', or 'kanban')
- `vaultFiles` - Cached list of vault files
- `currentKanban` - Current kanban board state
- `clientSlug` - Authenticated client identifier

Navigation between views triggers data loading (vault and kanban load on view switch).
