# Contributing to Knowspace

Thanks for your interest! Knowspace is the web portal sidecar for [OpenClaw](https://github.com/openclaw/openclaw), and we welcome contributions from the community.

## Quick Start

1. Fork the repository
2. Clone your fork and install dependencies:
   ```bash
   git clone https://github.com/<your-username>/knowspace.git
   cd knowspace
   npm install
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```
4. Make your changes
5. Run tests:
   ```bash
   npm test
   ```
6. Push and open a pull request

## Development Setup

You need:
- Node.js 22+
- An OpenClaw instance running locally (for manual testing)

Start the dev server:
```bash
npm start
```

The portal runs at `http://localhost:3445`.

## Architecture

Knowspace is a **sidecar** to OpenClaw. The critical rule:

> `server.js` **never** imports `lib/gateway.js` directly. All engine interaction goes through `adapters/engine/`.

This adapter layer isolates all OpenClaw coupling to one place. If you're adding features that talk to the engine, add your logic in `adapters/engine/` and call it from `server.js` or `routes/api.js`.

### Key paths

| Path | Purpose |
|------|---------|
| `server.js` | Express + Socket.IO server |
| `adapters/engine/` | Engine adapter layer (all OpenClaw interaction lives here) |
| `lib/gateway.js` | Low-level WebSocket RPC client |
| `middleware/auth.js` | Token authentication |
| `routes/api.js` | REST API endpoints (vault, kanban, graph) |
| `public/index.html` | SPA entry point + all CSS |
| `public/js/app.js` | Frontend (vanilla JS, no framework) |
| `cli/` | CLI commands |
| `tests/adapters/` | 49 contract tests (node:test, no gateway needed) |

## Coding Conventions

- **Backend:** Node.js, Express, Socket.IO. No TypeScript.
- **Frontend:** Vanilla JS in `public/js/app.js`. No framework, no build step.
- **CSS:** All in `public/index.html` using CSS custom properties for theming.
- **Tests:** Use `node:test` (Node.js built-in). Mock the gateway RPC via `_setRpc()` — no live gateway needed.
- **Style:** Match the surrounding code. Keep it simple.
- **Commits:** Clear, concise messages explaining *why*, not *what*.

## Pull Requests

- Keep PRs focused — one feature or fix per PR.
- Include a clear description of what changed and why.
- Run `npm test` before pushing.
- If your change affects the adapter layer, add or update tests in `tests/adapters/`.

## Areas Where We'd Love Help

These are great starting points if you want to contribute:

- **Frontend improvements** — accessibility, responsive/mobile layout, i18n
- **Vault renderers** — PDF viewer, CSV/TSV table rendering, code notebook support
- **Integrations** — calendar, email, project management tools (Notion, Linear, etc.)
- **Testing** — more adapter tests, frontend E2E tests, CI setup
- **Documentation** — setup guides, video tutorials, architecture deep-dives
- **Daemon improvements** — Windows support (Windows Service), process monitoring

## Questions?

Open an issue with the `question` label, or start a Discussion on the repo. We respond quickly.
