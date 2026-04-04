# Knowspace — Client Portal

Portal web para clientes com chat em tempo real, file vault e kanban, integrado ao [OpenClaw](https://github.com/nicholasgriffintn/openclaw).

## Features

- **Chat** — Comunicacao em tempo real com agentes OpenClaw via WebSocket
- **Vault** — Visualizador de arquivos markdown e midia com busca fuzzy
- **Kanban** — Gestao de tarefas com drag-and-drop (formato Obsidian)

## Requisitos

- Node.js 18+
- [OpenClaw](https://github.com/nicholasgriffintn/openclaw) instalado e configurado
- Gateway OpenClaw rodando (default: `ws://127.0.0.1:18789`)

## Instalacao

```bash
git clone <repo-url> && cd client-portal
npm install
npm link   # disponibiliza o comando 'knowspace' globalmente
```

## CLI — Knowspace

### Iniciar o servidor

```bash
knowspace serve              # porta default (3445)
knowspace serve --port 4000  # porta customizada
```

### Onboarding de clientes

Instala skills no OpenClaw, gera templates de workspace e token de acesso:

```bash
# Imprime templates no stdout
knowspace onboard <slug>

# Salva templates em diretorio
knowspace onboard <slug> --output ~/<slug>/workspace

# Skills target customizado
knowspace onboard <slug> --skills-target /path/to/openclaw/skills
```

O workspace do cliente (`~/<slug>/workspace/`) deve ser criado previamente pelo agente principal do OpenClaw. O comando `onboard` cuida de:

1. Copiar os 6 skills bundled para o OpenClaw da maquina
2. Gerar templates (SOUL.md, AGENTS.md, IDENTITY.md, USER.md, MEMORY.md)
3. Criar token de acesso ao portal

### Gestao de tokens

```bash
knowspace tokens list              # listar todos
knowspace tokens generate <slug>   # gerar novo
knowspace tokens rotate <slug>     # rotacionar existente
```

## Arquitetura

```
bin/knowspace.js       # CLI entry point
cli/                   # Comandos do CLI (serve, onboard, tokens)
server.js              # Express + Socket.IO
lib/gateway.js         # Cliente WebSocket do gateway OpenClaw
middleware/auth.js      # Autenticacao por token (SHA-256)
routes/api.js          # API REST (vault, kanban, chat)
public/                # Frontend SPA (vanilla JS + Tailwind)
skills/                # Skills OpenClaw bundled
templates/             # Templates de workspace com placeholders
```

### Stack

- **Backend:** Express.js, Socket.IO, Multer, Gray-matter, Fuse.js
- **Frontend:** Vanilla JS, Tailwind CSS, Marked.js
- **Dados:** File system (zero database)
- **Auth:** Tokens SHA-256 com cookie httpOnly

### Integracao OpenClaw

- Chat via gateway WebSocket RPC (Ed25519 device identity)
- Historico de sessoes em `~/.openclaw/agents/<slug>/sessions/*.jsonl`
- Dados do cliente em `~/<slug>/workspace/vault/`
- Kanban em formato markdown compativel com Obsidian

## Skills bundled

| Skill | Descricao |
|-------|-----------|
| `client-onboard` | Workflow de onboarding de clientes |
| `instagram-carousel` | Geracao de carroseis com framework PAS |
| `content-matrix` | Calendario e fila de conteudo |
| `trend-detector` | Deteccao de tendencias |
| `linkedin_post` | Geracao de posts LinkedIn |
| `herenow` | Publicacao HTML instantanea |

## Licenca

Proprietario.
