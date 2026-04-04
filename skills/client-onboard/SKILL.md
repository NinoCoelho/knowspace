---
name: client-onboard
description: Onboard new clients by creating dedicated workspaces with vault structure, Telegram bot configuration, and skill initialization. Use when setting up a new client agent, creating a new workspace, or when asked to "onboard a client", "create client workspace", or "set up new agent". Collects client information interactively and creates all necessary files and directories.
---

# Client Onboarding

Create new client workspaces with proper structure for multi-tenant AI agent deployments.

## ⚠️ CRITICAL: Multi-Agent Architecture

**NEVER modify the main bot token.** Each client gets:
1. A separate Telegram bot account (via `openclaw channels add --account`)
2. A separate agent (via `openclaw agents add`)
3. A binding to connect them (via `openclaw agents bind`)

The main Nexus bot remains untouched.

## Workflow

### 1. Collect Client Information

Ask the user for the following information. Group questions logically (2-3 per message):

**Required:**
- Client slug (URL-safe identifier, e.g., "acme-corp")
- Client name (full name, e.g., "Acme Corporation")
- Telegram bot token (from @BotFather)

**Recommended:**
- Display name (what to call them)
- Timezone (default: UTC)
- Business context (brief description)
- Bot username (without @)
- Agent name (default: "Agent")

**Optional:**
- Allowed Telegram user IDs (for access control)
- Skills to enable (from: instagram_carousel, content-matrix, trend-detector, linkedin_post, herenow)
- Brand voice tone
- Default Instagram hashtags
- Default CTA

### 2. Create Workspace Structure

Once you have the required information, run the onboarding script:

```bash
python3 {skill_dir}/scripts/onboard_client.py \
  --client-slug "acme-corp" \
  --client-name "Acme Corporation" \
  --telegram-bot-token "123456:ABC-DEF..." \
  --bot-username "acme_ai_bot" \
  --timezone "America/Sao_Paulo" \
  --business-context "Manufacturing company specializing in industrial equipment" \
  --agent-name "Acme Assistant" \
  --skills instagram_carousel content-matrix linkedin_post
```

The script creates:

```
~/acme-corp/
├── workspace/
│   ├── vault/
│   │   ├── instagram-carousel/config.json
│   │   ├── content-matrix/state.json
│   │   ├── trend-detector/cache/
│   │   ├── linkedin_post/templates/
│   │   ├── kanban/kanban.md         # Task board (Obsidian-style)
│   │   ├── notes/                   # Meeting notes & ideas
│   │   ├── projects/                # Project folders
│   │   └── assets/
│   ├── MEMORY.md
│   ├── USER.md
│   ├── SOUL.md          # Includes Kanban + Vault guidelines
│   ├── IDENTITY.md
│   └── AGENTS.md        # Includes vault structure docs
└── .openclaw/
    └── config.json (client metadata only)
```

**New Client Agent Behavior:**
- 📋 **Kanban**: Auto-detects "kanban"/"novo kanban"/project mentions → divides into small tasks
- 📁 **Vault**: Always creates contextual subfolders, notifies with `/vault/[path]` links

### 3. Register with OpenClaw Multi-Agent System

After the workspace is created, register the client with OpenClaw:

```bash
# 1. Add the Telegram bot as a channel account (NOT the main bot!)
openclaw channels add --channel telegram --account "acme-corp" --token "123456:ABC-DEF..."

# 2. Create the agent with its workspace
openclaw agents add "acme-corp" --workspace ~/acme-corp/workspace

# 3. Bind the channel account to the agent
openclaw agents bind --agent "acme-corp" --bind "telegram:acme-corp"

# 4. Restart gateway to apply changes
openclaw gateway restart
```

### 4. Verify and Provide Next Steps

After successful registration, inform the user:

1. Workspace location
2. Agent ID
3. Channel account name
4. Next steps:
   - Open Telegram and find the client's bot
   - Send `/start` to begin pairing
   - Approve pairing: `openclaw pairing approve --channel telegram:acme-corp <USER_ID>`
   - Test with a simple message

## Example Interaction

**User:** "I need to onboard a new client called TechStart"

**Agent:** "I'll help you onboard TechStart. Let me collect some information:

1. What's the URL-safe slug for this client? (e.g., "techstart" or "tech-startup")
2. Full client name for display?

Also, do you have the Telegram bot token ready from @BotFather?"

**User:** "Slug: techstart, Full name: TechStart Solutions, Token: 123456:ABC..."

**Agent:** "Perfect. A few more details:

1. What timezone is the client in? (default: UTC)
2. Brief description of their business?
3. What should we call the AI agent? (default: Agent)"

**User:** "Timezone: America/New_York, Business: SaaS startup for project management, Agent name: TechStart Assistant"

**Agent:** *[runs onboarding script, then registers with OpenClaw]*

```bash
# Create workspace
python3 ~/.npm-global/lib/node_modules/openclaw/skills/client-onboard/scripts/onboard_client.py \
  --client-slug "techstart" \
  --client-name "TechStart Solutions" \
  --telegram-bot-token "123456:ABC..." \
  --timezone "America/New_York" \
  --business-context "SaaS startup for project management" \
  --agent-name "TechStart Assistant"

# Register with OpenClaw multi-agent system
openclaw channels add --channel telegram --account "techstart" --token "123456:ABC..."
openclaw agents add "techstart" --workspace ~/techstart/workspace
openclaw agents bind --agent "techstart" --bind "telegram:techstart"
openclaw gateway restart
```

✅ TechStart Solutions onboarded!

📦 Workspace: ~/techstart/workspace
🤖 Agent: techstart
📱 Channel: telegram:techstart

**Next steps:**
1. Open Telegram, search for your bot
2. Send /start to pair
3. Approve pairing: `openclaw pairing approve --channel telegram:techstart <USER_ID>`

Ready when you are!

## Notes

- The script validates inputs and creates all necessary directories
- Vault structure isolates client data per skill
- **Multi-agent architecture**: Each client gets their own bot account, agent, and binding
- **Main bot is never modified**: Client bots are added as separate channel accounts
- Default SOUL.md provides generic assistant personality
- Client can customize SOUL.md, templates, and configs after onboarding
