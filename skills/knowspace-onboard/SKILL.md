---
name: knowspace-onboard
description: Onboard a new client on the Knowspace web portal. Creates their workspace and vault, generates a portal access token, and returns the login link. Use when asked to "onboard a client", "add a new user to the portal", "create portal access for X", "set up a client workspace", or "give X access to knowspace".
---

# Knowspace Onboard

Cria workspace e acesso ao portal Knowspace para um novo cliente. O portal é web-based — o cliente acessa via link com token, sem necessidade de Telegram ou bot.

## Quando usar

- "Onboard o cliente X"
- "Cria acesso no portal para Y"
- "Adiciona Z ao knowspace"
- "Configura workspace para o cliente W"

## Informações necessárias

**Obrigatório:**
- `slug` — identificador URL-safe (ex: `acme-corp`, `joao-silva`)

**Opcional (perguntar se não fornecido):**
- Nome do cliente — para personalizar os templates
- Timezone — padrão: `America/Sao_Paulo`

## Workflow

### 1. Coletar informações

Pergunte o slug e, se não informado, o nome do cliente. Agrupe numa única mensagem:

> "Para onboarding no Knowspace preciso de:
> 1. Slug do cliente (identificador, ex: `acme-corp`)
> 2. Nome completo (opcional, para personalizar workspace)"

### 2. Criar workspace e gerar token

```bash
knowspace onboard <slug> --output ~/<slug>/workspace
```

Este comando:
- Copia os templates de workspace (`SOUL.md`, `USER.md`, `AGENTS.md`, `IDENTITY.md`) para `~/<slug>/workspace/`
- Instala os skills bundled no engine
- Gera o token de acesso ao portal e imprime o link

### 3. Registrar o agente no OpenClaw

Após criar o workspace, registrar o agente:

```bash
openclaw agents add "<slug>" --workspace ~/<slug>/workspace
```

### 4. Entregar o acesso

Informe ao usuário:
- **Link de acesso:** o link impresso pelo `knowspace onboard` (formato: `http://localhost:3445/auth?token=...`)
- **Workspace:** `~/<slug>/workspace/`
- **Vault:** `~/<slug>/workspace/vault/`

> ⚠️ O token é mostrado uma única vez. Anote antes de fechar.

## Exemplo

**Usuário:** "Onboard a cliente Maria Silva, slug: maria-silva"

**Agente:**

```bash
knowspace onboard maria-silva --output ~/maria-silva/workspace
openclaw agents add "maria-silva" --workspace ~/maria-silva/workspace
```

Output esperado:
```
  === Portal Token ===

  Client:  maria-silva
  Token:   ks_abc123...
  Link:    http://localhost:3445/auth?token=ks_abc123...
```

Resposta ao usuário:
> ✅ Maria Silva onboarded!
>
> - Workspace: `~/maria-silva/workspace/`
> - Acesso: `http://localhost:3445/auth?token=ks_abc123...`
>
> Compartilhe o link com ela. O token é de uso único — guarde se precisar reenviar.

## Notas

- O vault fica em `~/<slug>/workspace/vault/` — o portal já aponta para lá automaticamente
- Para reenviar o token depois: `knowspace tokens list` para ver os slugs, ou `knowspace tokens rotate <slug>` para gerar novo
- O cliente acessa via browser — não precisa de app, bot, ou configuração
