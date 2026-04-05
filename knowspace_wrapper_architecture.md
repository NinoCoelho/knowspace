# Arquitetura técnica do wrapper do knowspace sobre o upstream

## Objetivo

Este documento descreve uma arquitetura recomendada para posicionar o **knowspace** como produto principal, usando o upstream como engine subjacente, sem transformar o projeto imediatamente em um fork profundo. A proposta privilegia velocidade de produto, isolamento da diferenciação, baixo acoplamento com internals e manutenção previsível ao longo das atualizações do upstream.[cite:7][cite:9][cite:12]

A abordagem recomendada é tratar o knowspace como uma **distribution layer** ou **thin wrapper product**: o CLI, a experiência de desenvolvedor, o branding, os presets, as extensões e os fluxos corporativos ficam no produto knowspace, enquanto o núcleo operacional permanece o mais próximo possível do upstream.[cite:9][cite:12][cite:16]

## Decisão arquitetural

A melhor estratégia inicial é evitar um fork profundo do core e construir uma camada própria com três responsabilidades: experiência oficial de uso, empacotamento/distribuição e integração com extensões corporativas. Esse padrão reduz o risco de *fork drift*, que acontece quando pequenas customizações começam a se acumular e tornam cada atualização do upstream mais cara e manual.[cite:7][cite:9][cite:16]

Na prática, o knowspace deve ser apresentado ao usuário como o produto principal, mas tecnicamente organizado para consumir o upstream como engine versionada. Isso preserva a capacidade de atualizar rápido, testar compatibilidade em ciclos curtos e limitar o número de pontos onde o seu código depende de APIs internas instáveis.[cite:9][cite:12][cite:21]

## Arquitetura em camadas

### 1. Camada de produto: knowspace CLI e UX

Essa é a camada visível e oficial do produto. Ela deve conter:

- `knowspace` como CLI principal.
- Configuração default do produto.
- Wizards de setup, bootstrap de projeto, templates e presets.
- Branding, nomenclatura, help messages, documentação e telemetria própria.
- Comandos de alto nível orientados a casos de uso do produto.[cite:9][cite:21]

Essa camada não deve conhecer detalhes internos do runtime além de uma interface estável e limitada. O objetivo é que o usuário interaja com o knowspace, não com o upstream, mesmo quando o comando final delega a execução ao engine subjacente.[cite:9][cite:12]

### 2. Camada de compatibilidade: adapter/runtime bridge

Essa camada traduz o contrato do knowspace para o contrato do upstream. Ela deve conter:

- Mapeamento de comandos do CLI para chamadas do engine.
- Normalização de arquivos de configuração.
- Conversão de nomes de recursos, flags, paths e conventions.
- Tratamento de erros e mensagens amigáveis.
- *Feature detection* por versão do upstream.[cite:12][cite:16][cite:21]

Essa é a camada mais importante para preservar independência do produto. Em vez de espalhar dependência do upstream pelo código todo, concentra-se o acoplamento em poucos adapters testáveis. Se o upstream mudar flags, APIs internas ou estrutura de diretórios, o ajuste fica concentrado aqui.[cite:12][cite:16]

### 3. Camada de engine: upstream intocado ou quase intocado

Essa camada é o core subjacente. O ideal é mantê-la como:

- Dependência versionada, quando tecnicamente possível.
- Submódulo, subtree ou mirror fork com delta mínimo, se a distribuição exigir empacotamento conjunto.
- Fonte única para runtime, scheduler, primitives e comportamento-base.[cite:9][cite:12][cite:21]

A regra é simples: tudo o que for diferenciação do knowspace deve ficar fora do core; tudo o que for infraestrutura-base deve continuar no upstream enquanto isso não bloquear o roadmap do produto.[cite:9][cite:21]

## Diagrama lógico

```text
Usuário
  │
  ▼
knowspace CLI (oficial)
  │
  ├── comandos de produto
  ├── setup/bootstrap
  ├── templates/presets
  ├── branding/documentação
  │
  ▼
Compatibility Layer / Runtime Bridge
  │
  ├── command mapping
  ├── config translation
  ├── version detection
  ├── error normalization
  │
  ▼
Upstream Engine
  │
  ├── runtime
  ├── execution primitives
  ├── core services
  │
  ▼
Extensões knowspace
  ├── integrações corporativas
  ├── bots (WhatsApp/Telegram)
  ├── conectores de leitura/gravação
  ├── busca semântica / relatórios / BI
```

## Estrutura sugerida de repositório

### Opção A — recomendada: wrapper separado

```text
knowspace/
  cli/
  adapters/
  extensions/
  templates/
  docs/
  packages/
  tests/
```

Nesse modelo, o upstream entra como dependência externa ou artefato versionado. É a opção com menor atrito para atualização e com menor risco de contaminar o produto com dependências internas desnecessárias.[cite:9][cite:12][cite:21]

### Opção B — distribution fork leve

```text
knowspace-fork/
  upstream-core/
  knowspace-cli/
  knowspace-adapters/
  knowspace-extensions/
  patches/
  tests/
```

Esse modelo é útil quando é importante distribuir tudo como um pacote único, mas ele ainda exige disciplina para manter `upstream-core` próximo do original e isolar os deltas em patches pequenos e rastreáveis.[cite:12][cite:15][cite:16]

## Estratégia de atualização

A ideia de que “não mexendo no core o código estará sempre atualizado” é parcialmente correta, mas operacionalmente incompleta. Mesmo sem alterar o core, ainda será necessário sincronizar releases, validar compatibilidade e corrigir a camada de adaptação sempre que o upstream introduzir mudanças quebradoras ou alterar contratos implícitos.[cite:7][cite:9][cite:16]

A estratégia recomendada é:

1. Fixar versões suportadas do upstream.
2. Manter testes de compatibilidade na bridge.
3. Rodar validação automática a cada nova release upstream.
4. Só promover upgrade após smoke tests e testes de regressão do CLI e das extensões.[cite:12][cite:15][cite:16]

Isso significa que ainda pode haver merge, rebase ou sync, dependendo do modelo escolhido. Se houver fork espelho no GitHub, será necessário sincronizar com o upstream regularmente; se houver apenas dependência versionada, o trabalho muda de “merge de código” para “upgrade de dependência + validação de contrato”.[cite:12][cite:16][cite:21]

## Riscos principais

### 1. Fork drift

O risco mais conhecido é o acúmulo gradual de diferenças locais. Mesmo um fork inicialmente pequeno pode se tornar caro se as customizações começarem a tocar bootstrap, init, resolução de plugins, paths, contratos internos ou comportamento do runtime.[cite:7][cite:9]

### 2. Dependência em internals não estáveis

Se o knowspace CLI depender de detalhes internos do engine em vez de uma superfície mínima, qualquer mudança upstream pode quebrar comandos, extensões ou instalação. Esse é um risco clássico em forks e wrappers mal delimitados.[cite:9][cite:12]

### 3. Custo de segurança e manutenção

Mesmo sem grandes alterações, qualquer distribuição própria cria responsabilidade sobre atualização, vulnerabilidades, compatibilidade de dependências e resposta a regressões do ecossistema.[cite:7][cite:11][cite:15]

### 4. Confusão de responsabilidade

Quando o produto visível usa um engine terceirizado por trás, é comum que bugs e limitações sejam percebidos como problema do produto final. Por isso, a camada de adaptação precisa capturar erros, padronizar mensagens e isolar o máximo possível o comportamento percebido pelo usuário.[cite:9]

## Regras de design para manter baixo risco

- Nunca alterar o core por conveniência estética.
- Toda customização de branding, CLI e UX fica fora do engine.
- Qualquer patch no core precisa de justificativa explícita e owner definido.
- Cada patch deve ser pequeno, reversível e documentado.
- A adapter layer deve ser o único lugar autorizado a conhecer contratos variáveis do upstream.
- Extensões do knowspace não devem depender diretamente de internals do upstream sem passar por interfaces próprias.[cite:9][cite:12][cite:15]

## Instruções operacionais para Claude Code

Abaixo está um conjunto de instruções que pode ser usado como base de contexto para o Claude Code trabalhar nesse projeto.

## Contexto do projeto

O projeto **knowspace** é um produto-wrapper sobre um engine upstream. O knowspace é a interface oficial do produto, incluindo CLI, branding, templates, extensões e fluxos corporativos. O engine upstream deve ser tratado como infraestrutura subjacente, mantendo o menor nível possível de alterações diretas no core.

## Objetivo de engenharia

Ao implementar qualquer mudança, priorizar:

- isolamento da diferenciação do knowspace fora do core;
- compatibilidade com upgrades do upstream;
- baixo acoplamento com internals;
- testabilidade da camada de adaptação;
- experiência de uso centrada no CLI `knowspace`.

## Restrições

- Não renomear ou modificar o core sem necessidade técnica real.
- Não espalhar chamadas diretas ao upstream por todo o código.
- Centralizar integrações na adapter layer.
- Não introduzir dependência de APIs internas não documentadas sem criar um wrapper interno estável.
- Qualquer patch no core precisa ser minimizado, documentado e isolado.

## Diretrizes de implementação

### 1. CLI

- O binário principal deve ser `knowspace`.
- O CLI deve expor comandos orientados ao produto, não ao engine.
- Sempre que possível, traduzir os comandos do produto para operações do upstream na bridge.
- Help, docs e mensagens devem usar a marca knowspace.

### 2. Adapter layer

- Criar uma camada explícita `adapters/upstream/`.
- Toda chamada ao upstream deve passar por essa camada.
- Implementar version detection e guards por capability.
- Encapsular parsing de config, argumentos e erros.

### 3. Extensões

- Extensões do knowspace devem depender de interfaces internas do knowspace, não do upstream diretamente.
- Criar contratos estáveis para leitura/escrita, bot adapters, semantic search, reporting e BI.
- O runtime bridge deve conectar esses contratos ao engine quando necessário.

### 4. Testes

- Criar testes de contrato para a bridge.
- Criar smoke tests por versão suportada do upstream.
- Garantir que comandos críticos do CLI continuem funcionando após upgrades.
- Ter testes separados para extensões e para integração com o engine.

### 5. Atualizações upstream

- Toda nova release upstream deve passar por uma checklist:
  1. detectar breaking changes;
  2. rodar smoke tests do CLI;
  3. rodar testes da adapter layer;
  4. validar extensões principais;
  5. só então promover a versão.

## Prompt operacional sugerido para Claude Code

```text
Você está trabalhando no produto knowspace, que usa um engine upstream como infraestrutura subjacente.

Princípios obrigatórios:
1. O knowspace é o produto oficial e deve expor a interface principal via CLI, branding, templates e extensões.
2. O engine upstream deve permanecer o mais intacto possível.
3. Toda integração com o upstream deve passar pela adapter layer.
4. Não espalhe dependências de internals do upstream pelo código.
5. Ao propor mudanças, prefira wrapper, configuração, bridge ou extensão antes de alterar o core.
6. Se uma alteração no core for inevitável, mantenha-a pequena, reversível, documentada e isolada.
7. Sempre considere impacto em upgrades futuros do upstream.
8. Antes de implementar, identifique se a mudança pertence a: produto, adapter, extensão ou core.
9. Sempre que possível, escreva testes de compatibilidade para a camada de bridge.
10. Em qualquer texto, documentação, help output ou nomenclatura visível ao usuário, use knowspace como marca principal.

Ao responder:
- diga em qual camada a mudança deve acontecer;
- explique o menor ponto de acoplamento possível;
- proponha estrutura de arquivos quando relevante;
- aponte riscos de manutenção e upgrade;
- evite soluções que criem fork drift sem necessidade.
```

## Roadmap técnico sugerido

### Fase 1 — wrapper puro

- Criar CLI `knowspace`.
- Criar adapter layer para os comandos principais.
- Centralizar config translation.
- Embalar templates, presets e documentação.
- Definir contratos das extensões.[cite:9][cite:12]

### Fase 2 — extensibilidade

- Registrar plugin system do knowspace.
- Adicionar integrações corporativas.
- Implementar conectores de bots, leitura/escrita, search e reports.
- Medir quais capacidades exigem aproximação maior do core.

### Fase 3 — avaliação de fork real

- Só considerar fork profundo se o roadmap exigir mudanças recorrentes em runtime, scheduler, memory core, primitives ou contratos centrais do engine.[cite:7][cite:9]

## Recomendação final

A melhor decisão, neste estágio, é construir o knowspace como **wrapper de produto com adapter layer forte**, evitando fork profundo do core. Se for necessário manter um fork, ele deve ser um **distribution fork** com delta mínimo e sincronização frequente com upstream, e não o repositório principal onde toda a inovação do produto acontece.[cite:9][cite:12][cite:16]
