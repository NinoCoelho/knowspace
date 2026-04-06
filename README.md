# Knowspace

A web portal sidecar for [OpenClaw](https://github.com/openclaw/openclaw) that gives clients a simple browser interface for AI agent interactions. Adds chat history, a file vault, and a kanban board on top of an existing OpenClaw installation — no Docker, no database, no separate infrastructure.

```
Browser → Knowspace Portal → Adapter Layer → OpenClaw Gateway
```

## Features

- **Chat** — Real-time conversation with your OpenClaw agent. Full history, file attachments, subtask awareness.
- **Vault** — Markdown and media file viewer with fuzzy search, backed by the agent workspace on disk.
- **Kanban** — Drag-and-drop task board stored as Obsidian-compatible markdown files.

## Requirements

- Node.js 22+
- OpenClaw installed and running

## Installation

```bash
git clone <repo-url> && cd knowspace
npm install
npm link          # makes 'knowspace' available globally
```

## Setup

### 1. Connect to OpenClaw

Detects your OpenClaw config, saves the connection, and installs the `knowspace-onboard` skill into the agent workspace:

```bash
knowspace connect
```

### 2. Configure the portal

Interactive wizard on first run — sets the gateway, configures the `main` vault path, and generates the first access token. Opens a menu on subsequent runs.

```bash
knowspace configure
```

### 3. Start

Run interactively:

```bash
knowspace serve              # default port 3445
knowspace serve --port 4000
```

Or install as a background daemon (auto-starts on login):

```bash
knowspace daemon install
```

The portal is available at `http://localhost:3445`. The access link is printed on first boot.

---

## CLI Reference

### `knowspace connect`

Configures the OpenClaw connection and installs the onboard skill. Run once after installation, and again to reinstall the skill after updates.

1. Reads `~/.openclaw/openclaw.json` to detect gateway URL and token
2. Saves connection overrides to `~/.knowspace/.env` if needed
3. Copies `knowspace-onboard` skill to the agent workspace (`~/.openclaw/workspace/skills/`)
4. Registers the skill in `AGENTS.md`

### `knowspace configure`

Interactive setup. First run is a sequential wizard; subsequent runs open a menu.

```bash
knowspace configure
knowspace configure --reset    # force wizard again
```

**Wizard steps:**
1. **Gateway** — detects `~/.openclaw/openclaw.json`; confirm or enter an alternate path
2. **Vault** — path to the `main` client's vault (default: `~/main/workspace/vault`; can point to iCloud, Obsidian, etc.)
3. **Token** — generates the portal access link for slug `main`

**Menu options** (subsequent runs): Gateway, Vault location, Skills, Access tokens, Environment keys, Workspace templates.

### `knowspace serve`

```bash
knowspace serve [--port 3445]
```

### `knowspace daemon`

Install and manage Knowspace as a system daemon. Uses `launchd` on macOS and `systemd --user` on Linux.

```bash
knowspace daemon install       # write service file, enable auto-start on login, start now
knowspace daemon uninstall     # stop and remove service file
knowspace daemon start
knowspace daemon stop
knowspace daemon restart
knowspace daemon status        # show running status and PID
knowspace daemon logs          # tail -f ~/.knowspace/knowspace.log
knowspace daemon logs --error  # tail error log instead
```

### `knowspace tokens`

```bash
knowspace tokens list
knowspace tokens generate <slug>
knowspace tokens rotate <slug>
```

---

## Vault Design

There are two kinds of clients:

**Main client (`main`)** — configured manually via `knowspace configure`. The vault path can be set to any directory (e.g., an iCloud or Obsidian folder). Stored in `~/.knowspace/config.json`.

**Onboarded clients** — created by the agent via the `knowspace-onboard` skill. Their vault is always at `~/slug/workspace/vault`, created automatically during onboarding. To onboard a new client, ask your agent:

> "Onboard a new client, slug: acme-corp"

The agent will create the workspace, register the agent with OpenClaw, generate a portal access token, and return the login link.

---

## Environment Variables

Set in shell or `~/.knowspace/.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `KNOWSPACE_GATEWAY_URL` | WebSocket URL of the OpenClaw gateway | `ws://127.0.0.1:18789` |
| `KNOWSPACE_GATEWAY_TOKEN` | Gateway auth token | read from `openclaw.json` |
| `KNOWSPACE_PORT` | Portal port | `3445` |
| `KNOWSPACE_BASE_URL` | Public URL (used in token links) | `http://localhost:<port>` |
| `KNOWSPACE_ADMIN_SLUG` | Slug for the first-boot auto-generated token | `main` |
| `KNOWSPACE_TOKENS_FILE` | Path to the tokens file | `.tokens.json` |

---

## Architecture

Knowspace is a **sidecar** to OpenClaw. It adds a product layer (web UI, CLI, auth, vault) without modifying the engine. All engine interaction is isolated to the adapter layer.

```
server.js                    Express + Socket.IO server
adapters/engine/
  index.js                   Barrel export
  paths.js                   Engine path conventions, session key formats
  messages.js                Message normalization, filtering, status detection
  sessions.js                Session CRUD via gateway RPC
  chat.js                    Chat: history, send, streaming poll
lib/gateway.js               Low-level WebSocket RPC client (Ed25519 auth)
middleware/auth.js           Token authentication (SHA-256 hashed)
routes/api.js                REST API: vault, kanban
public/
  index.html                 SPA entry point
  js/app.js                  Frontend (vanilla JS)
bin/knowspace.js             CLI entry point
cli/
  connect.js                 Configure gateway + install onboard skill
  configure/                 Interactive wizard and menu
    wizard.js                First-run: gateway → vault → token
    menu.js                  Subsequent-run menu
    gateway.js               OpenClaw detection and config
    vault.js                 Vault path configuration
    skills.js                Skill install + AGENTS.md registration
    state.js                 ~/.knowspace/config.json read/write
    env.js                   ~/.knowspace/.env read/write
    prompts.js               readline-based interactive prompts
  daemon.js                  Daemon lifecycle management
  daemon/
    launchd.js               macOS launchd backend
    systemd.js               Linux systemd --user backend
  serve.js                   Start server interactively
  tokens.js                  Token management
skills/
  knowspace-onboard/         Agent skill: onboards portal clients
templates/                   Workspace markdown templates (SOUL, USER, AGENTS, IDENTITY, MEMORY)
tests/adapters/              49 contract tests for the adapter layer
```

**Rule:** `server.js` never imports `lib/gateway.js` directly. All engine calls go through `adapters/engine/`.

**Stack:** Node.js, Express, Socket.IO, Vanilla JS, filesystem (no database).

---

## License

Proprietary.
