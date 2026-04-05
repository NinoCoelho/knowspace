# Knowspace — Client Portal

Portal web para clientes com chat em tempo real, file vault e kanban, usando [OpenClaw](https://github.com/openclaw/openclaw) como engine subjacente.

## Features

- **Chat** — Comunicacao em tempo real com agentes via WebSocket
- **Vault** — Visualizador de arquivos markdown e midia com busca fuzzy
- **Kanban** — Gestao de tarefas com drag-and-drop (formato Obsidian)

## Quick Start com Docker

```bash
# 1. Configurar
cp .env.example .env
# Editar .env com suas credenciais (CLAUDE_AI_SESSION_KEY, etc.)

# 2. Criar diretorio de dados
mkdir -p data/openclaw-config data/workspaces data/knowspace data/appdata

# 3. Subir
docker compose up -d

# 4. Pegar o token de acesso nos logs (so aparece no primeiro boot)
docker compose logs knowspace | grep "Access link"
```

No primeiro boot, o knowspace gera automaticamente um token para o usuario `main` e imprime a URL de acesso nos logs. Copie e acesse no navegador.

### Variaveis de ambiente

| Variavel | Descricao | Default |
|----------|-----------|---------|
| `OPENCLAW_GATEWAY_TOKEN` | Token de auth do gateway | (obrigatorio) |
| `CLAUDE_AI_SESSION_KEY` | Session key da Claude API | (obrigatorio) |
| `KNOWSPACE_PORT` | Porta do portal | `3445` |
| `KNOWSPACE_BASE_URL` | URL publica do portal | `http://localhost:3445` |
| `KNOWSPACE_ADMIN_SLUG` | Slug do usuario admin inicial | `main` |
| `GATEWAY_PORT` | Porta exposta do gateway | `18789` |
| `TZ` | Timezone | `America/Sao_Paulo` |

### Comandos uteis

```bash
# Ver logs
docker compose logs -f knowspace
docker compose logs -f gateway

# Reiniciar
docker compose restart

# Parar
docker compose down

# Rebuild apos mudancas no codigo
docker compose build knowspace && docker compose up -d knowspace
```

## Desenvolvimento local (sem Docker)

### Requisitos

- Node.js 22+
- Gateway OpenClaw rodando (default: `ws://127.0.0.1:18789`)

### Setup

```bash
git clone <repo-url> && cd knowspace
npm install
npm link   # disponibiliza o comando 'knowspace' globalmente
```

### Iniciar

```bash
knowspace serve              # porta default (3445)
knowspace serve --port 4000  # porta customizada

# ou
npm start
```

### Testes

```bash
npm test   # 49 testes de contrato para a adapter layer
```

## CLI — Knowspace

### Onboarding de clientes

Instala skills no engine, gera templates de workspace e token de acesso:

```bash
knowspace onboard <slug>
knowspace onboard <slug> --output ~/<slug>/workspace
knowspace onboard <slug> --skills-target /path/to/engine/skills
```

### Gestao de tokens

```bash
knowspace tokens list              # listar todos
knowspace tokens generate <slug>   # gerar novo
knowspace tokens rotate <slug>     # rotacionar existente
```

## Arquitetura

O knowspace usa uma arquitetura de **wrapper com adapter layer**: o produto (CLI, UX, branding) fica separado do engine (OpenClaw), conectados por uma camada de adaptacao que centraliza todo o acoplamento.

```
Usuário → Knowspace Portal → Adapter Layer → OpenClaw Gateway
```

### Estrutura de diretorios

```
server.js                  # Express + Socket.IO (usa apenas adapters/)
adapters/engine/           # Adapter layer — unico ponto de acoplamento com o engine
  paths.js                 # Paths e session key formats do engine
  messages.js              # Normalizacao e filtros de mensagens
  sessions.js              # CRUD de sessoes via gateway RPC
  chat.js                  # Chat: historico, envio, polling
  index.js                 # Barrel export
lib/gateway.js             # WebSocket RPC client (transporte baixo nivel)
middleware/auth.js          # Autenticacao por token (SHA-256)
routes/api.js              # API REST (vault, kanban)
public/                    # Frontend SPA (vanilla JS + Tailwind)
bin/knowspace.js           # CLI entry point
cli/                       # Comandos do CLI (serve, onboard, tokens)
skills/                    # Skills bundled
templates/                 # Templates de workspace
tests/adapters/            # Testes de contrato da adapter layer
Dockerfile                 # Imagem do knowspace
docker-compose.yml         # Gateway + knowspace
```

### Stack

- **Backend:** Express.js, Socket.IO, Multer, Fuse.js
- **Frontend:** Vanilla JS, Tailwind CSS, Marked.js
- **Dados:** File system (zero database)
- **Auth:** Tokens SHA-256 com cookie
- **Engine:** OpenClaw via WebSocket RPC (Ed25519 device identity)

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
