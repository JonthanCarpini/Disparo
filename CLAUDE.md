# CLAUDE.md

Este arquivo orienta o Claude Code (e qualquer assistente AI) ao trabalhar neste repositório. Leia antes de fazer mudanças.

---

## 1. Visão Geral

**Disparo WhatsApp** — Plataforma para disparo em massa de mensagens via WhatsApp, com extração de contatos de grupos, geração de mensagens por IA e gestão de campanhas.

### Stack

- **Backend**: Node.js 20, TypeScript, Fastify, MySQL 8, Redis (Bull queue), Baileys 6.7+ (`@whiskeysockets/baileys`)
- **Frontend**: Next.js 14 (App Router), TailwindCSS, Lucide icons, Sonner (toasts)
- **Infra**: Docker Compose (mysql, redis, backend, web), VPS Linux
- **CI/CD**: Push manual em `master` → `git pull` + `docker compose up -d --build` no VPS

### Estrutura

```
apps/
├── backend/              # API Fastify + worker BullMQ + Baileys
│   ├── src/
│   │   ├── routes/       # auth, whatsapp, contacts, campaigns, ai, settings
│   │   ├── services/     # BaileysService.ts (núcleo WA)
│   │   ├── workers/      # CampaignWorker.ts (consumer Bull)
│   │   ├── lib/          # db, redis, logger, auth, migrate, wsEmitter
│   │   └── server.ts
│   └── data/sessions/    # estado Baileys persistente (multi-file auth)
├── web/                  # Next.js
└── deploy/               # scripts utilitários (debug, reset, etc)
```

---

## 2. Ambiente e Comandos

### Local (Windows / PowerShell)

```powershell
# Backend
cd apps\backend
npm install
npx tsc --noEmit          # type-check (CI gate)
npm run dev               # tsx watch

# Frontend
cd apps\web
npm run dev
```

### VPS (produção)

- Host: `178.238.236.103`
- SSH key: `C:\Users\admin\.ssh\disparo_vps`
- Repo no VPS: `/opt/disparo`
- Login dashboard: `admin` / `Admin@2026`

```powershell
# Deploy padrão (após git push)
$key = "$env:USERPROFILE\.ssh\disparo_vps"
C:\Windows\System32\OpenSSH\ssh.exe -i $key -o StrictHostKeyChecking=no root@178.238.236.103 `
  'cd /opt/disparo && git pull && docker compose up -d --build backend'
```

### Git workflow

**Sempre nesta ordem** (do user_global rules):
```powershell
git add -A; git status; git commit -m "<msg>"; git push
```
Nunca usar `&&` no PowerShell — usar `;`.

---

## 3. Histórico de Trabalho

### 3.1. Problema inicial: Extração de contatos de grupo

**Sintoma**: Ao extrair contatos do grupo "Promoção de calçados (Elegância Calçados)" (958 membros), a lista vinha vazia ou com números inválidos. CSV exportado não abria no Excel.

**Causa raiz**: WhatsApp introduziu **LID (Local Identifier)** em 2023 como proteção de privacidade. Em grupos onde os membros não estão na agenda do usuário, os participantes aparecem como `<numero>@lid` em vez de `<telefone>@s.whatsapp.net`. LIDs são IDs opacos, não telefones reais.

### 3.2. Tentativas anteriores (descartadas)

1. ❌ **`makeInMemoryStore`** — não existe nesta versão do Baileys
2. ❌ **Mapear LID via `contacts.upsert`** — só popula contatos da agenda; LIDs de desconhecidos nunca aparecem
3. ❌ **`sock.onWhatsApp(lidId)`** — espera números de telefone, não LIDs; retorna vazio
4. ❌ **`syncFullHistory: true` + `resyncAppState`** — falha com `failed to find key "AAAAADyV"` em sessões antigas; após relogin funciona mas só popula contatos da agenda do usuário

### 3.3. Solução final: enviar para `@lid` diretamente

**Insight da Evolution API** (PR #2025): a Evolution não resolve LID→telefone. Ela apenas:
1. Pega o `id` do participante (LID ou JID real)
2. Remove sufixo `@lid`/`@s.whatsapp.net` e usa o número como "phoneNumber"
3. Ao enviar mensagem, usa o JID original (incluindo `@lid`)

**Baileys aceita enviar mensagens diretamente para `<lid>@lid`** — o WhatsApp resolve internamente.

**Implementação**:

- Coluna `jid VARCHAR(100)` adicionada em `contacts` (migration idempotente em `apps/backend/src/lib/migrate.ts`)
- `BaileysService.getGroupParticipants()` retorna `{ phone, jid, name }[]`:
  - JIDs `@s.whatsapp.net` → `phone` extraído normalmente
  - JIDs `@lid` com mapeamento conhecido (`lidMap`) → resolvidos para telefone real
  - JIDs `@lid` sem mapeamento → preservados, com `phone = lidNum` e `jid = "lidNum@lid"`
- `routes/contacts.ts` salva `jid` em bulk insert (batches de 500, performance)
- `workers/CampaignWorker.ts` envia para `contact.jid || contact.phone`

### 3.4. Outras correções aplicadas

- **CSV export**: BOM UTF-8 (`\uFEFF`) + delimiter `;` para compatibilidade com Excel pt-BR (`apps/backend/src/routes/contacts.ts`)
- **Frontend export**: usar `fetch` com `Authorization` header + Blob download (em vez de `window.open` com token na query, que causava logout)
- **lidMap persistente**: salva em `data/sessions/<sessionId>/lid-map.json` a cada 30s, recarrega ao iniciar sessão
- **Eventos capturados** para popular `lidMap`:
  - `contacts.upsert` / `contacts.update`
  - `chats.upsert` / `chats.update`
  - `messages.upsert` (pushName por phone)
  - `messaging-history.set` (sync inicial — só funciona em scan novo)
- **`syncFullHistory: true`** + `markOnlineOnConnect: true` em `makeWASocket`
- **`resyncAppState`** disparado 3s após `connection.open` (force re-sync de coleções `regular`, `regular_high`, etc)
- **Endpoints diagnóstico**:
  - `GET /api/whatsapp/sessions/:id/sync-status` → `{ connected, lidMapSize, syncing }`
  - `POST /api/whatsapp/sessions/:id/resync` → força resync manual

### 3.5. Resultado

Teste no grupo de 958 membros após relogin:
- **957 contatos extraídos** (1 telefone real do dono + 956 LIDs preservados)
- LIDs serão usados como destinatários nos disparos via `<lid>@lid`

### 3.6. Evolução do módulo de campanhas (Abr/2026)

Features adicionadas após o fix do LID:

**1. Limite de disparos por dia (`max_per_day`)**
- Coluna `campaigns.max_per_day INT DEFAULT 0` (0 = sem limite)
- Colunas auxiliares: `daily_sent INT`, `last_send_date DATE`
- Worker pausa automaticamente ao atingir o limite e emite WS `campaign:update` com `reason: 'max_per_day_reached'`
- Reset diário automático quando `last_send_date != hoje`

**2. Pause/Resume robusto (de onde parou)**
- `SELECT` no worker faz LEFT JOIN com subquery em `campaign_logs` excluindo contatos com `status='sent'`
- Filtro adicional: `(c.wa_exists IS NULL OR c.wa_exists = 1)` — pula números que falharam na validação
- Mantém contadores `sent`/`failed` acumulados ao retomar
- Botão "Retomar" aparece em `paused` E `failed`

**3. Status por contato (aguardando / enviado / falhou)**
- Componente `CampaignDetailsModal.tsx` com totais clicáveis (filtros) + tabela paginada
- Endpoint `GET /api/campaigns/:id/contacts-status?page&limit&status`
- Query usa `ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at DESC)` para pegar o último log de cada contato
- Status `aguardando` é virtual: `COALESCE(cl.status, 'aguardando')` quando não há log

**4. Validação prévia de contatos (onWhatsApp)**
- `BaileysService.verifyContacts(sessionId, contacts[])` em batches de 50, throttle 500ms
- LIDs sempre considerados válidos (privacidade WA não permite verificação)
- Atualiza `contacts.wa_exists` (TINYINT 1/0) e `verified_at`
- Endpoint `POST /api/contacts/lists/:id/verify-numbers` com `{sessionId}`
- Worker pula `wa_exists = 0` no SELECT principal

**5. Pré-visualização e disparo de teste**
- `TestMessageModal.tsx` — gera 1-5 amostras com IA usando contatos reais (sem disparar)
- `POST /api/campaigns/test-message` — preview no form ANTES de criar a campanha
- `POST /api/campaigns/:id/test-send` — envia 3 mensagens reais (com 2s delay) para amostragem após criar

### 3.7. Suporte a Mistral AI (Abr/2026)

- Tipo `AIProvider = 'openai' | 'gemini' | 'groq' | 'mistral'`
- Função `generateMistral()` via `fetch` direto na API oficial (`https://api.mistral.ai/v1/chat/completions`) — endpoint compatível com OpenAI, sem nova dependência
- Migração `ensureColumnType` faz `ALTER MODIFY` idempotente nos ENUMs de `ai_configs.provider` e `campaigns.ai_provider` para incluir `'mistral'`
- 8 modelos disponíveis no dropdown: `mistral-large-latest`, `mistral-medium-latest`, `mistral-small-latest`, `ministral-8b-latest`, `ministral-3b-latest`, `open-mistral-7b`, `open-mixtral-8x7b`, `open-mixtral-8x22b`
- TTS continua **exclusivamente OpenAI** (único com suporte nativo). Lógica de fallback simplificada em `generateAudio()`

---

## 4. Arquivos Críticos

### `apps/backend/src/services/BaileysService.ts`

Núcleo. Gerencia sessões Baileys. Pontos de atenção:

- **`lidToPhone: Map<sessionId, Map<lidNum, phone>>`** — cache em memória + disco
- Em `connect()`:
  - Carrega `lid-map.json` do disco
  - `setInterval(persistLidMap, 30000)` — persistência periódica
  - Subscreve eventos para popular `lidMap`
  - Em `connection.open`, dispara `resyncAppState` após 3s
- **`getGroupParticipants(sessionId, groupId)`** retorna `{ phone, jid, name }[]`
  - Não filtra LIDs — preserva todos com JID original
- **`sendText/sendImage/sendAudio(sessionId, phone, ...)`** — aceita `phone` puro (constrói `<phone>@s.whatsapp.net`) **ou** JID completo (`@lid`/`@s.whatsapp.net`)

### `apps/backend/src/lib/migrate.ts`

Migrations idempotentes via `CREATE TABLE IF NOT EXISTS` + `ensureColumn()` (verifica `information_schema`) e `ensureColumnType()` (`ALTER MODIFY`).

Sempre adicione novas colunas via `ensureColumn()` no final de `runMigrations()` — **não recrie a tabela**.

### `apps/backend/src/workers/CampaignWorker.ts`

Worker BullMQ que processa filas de campanhas. Para cada contato:
- `target = contact.jid || contact.phone` — preferência sempre por JID completo
- Aceita rotação de sessões (`rotate_sessions`)
- Delay aleatório entre `min_delay` e `max_delay` segundos
- **Resume**: SELECT exclui `campaign_logs.status='sent'` e `contacts.wa_exists=0`
- **Limite diário**: ao atingir `max_per_day`, pausa e emite WS event
- **Reset diário**: zera `daily_sent` quando `last_send_date != hoje`
- Status da campanha verificado a cada contato (custo desnecessário — TODO: trocar por pub/sub Redis)

### `apps/backend/src/routes/contacts.ts`

- `POST /contacts/extract-group` — extrai grupo via Baileys, salva em `contacts` com `jid`
- `POST /contacts/extract-contacts` — extrai agenda completa
- `GET /contacts/lists/:id/export` — CSV com BOM + `;`
- `POST /contacts/lists/:id/verify-numbers` — valida via `onWhatsApp`, marca `wa_exists`
- **`bulkInsertContacts()`** — batch INSERT de 500 em 500 (importante para grupos grandes; INSERT linha-a-linha trava com 1000+ contatos)

### `apps/backend/src/routes/campaigns.ts`

- `POST /campaigns` — cria campanha (multipart com mídia opcional)
- `POST /campaigns/:id/pause` / `POST /campaigns/:id/resume`
- `POST /campaigns/test-message` — preview IA (sem disparar) usando contatos reais
- `POST /campaigns/:id/test-send` — envia 3 mensagens reais para amostra
- `GET /campaigns/:id/contacts-status` — status agregado por contato (aguardando/sent/failed) com totais

### `apps/backend/src/services/AIService.ts`

Provedores: OpenAI (SDK `openai`), Gemini (SDK `@google/generative-ai`), Groq (SDK `groq-sdk`), Mistral (`fetch` direto).
Dispatcher em `generateMessage()` por `if/else`. Próxima refatoração: extrair `AIProviderAdapter` interface + Map.

---

## 5. Banco de Dados

### Schema relevante

```sql
contacts (
  id VARCHAR(36) PK,
  list_id VARCHAR(36) FK,
  phone VARCHAR(50),         -- pode ser telefone OU número de LID (15 dígitos)
  jid VARCHAR(100),          -- JID completo: <num>@s.whatsapp.net OU <lid>@lid
  name VARCHAR(200),
  wa_exists TINYINT(1) NULL, -- NULL=não verificado, 1=válido, 0=inválido
  verified_at TIMESTAMP NULL,
  ...
)

campaigns (
  id VARCHAR(36) PK,
  ai_provider ENUM('openai','gemini','groq','mistral'),
  status ENUM('draft','scheduled','running','paused','completed','failed'),
  max_per_day INT DEFAULT 0,       -- 0 = sem limite
  daily_sent INT DEFAULT 0,        -- contador resetado diariamente
  last_send_date DATE NULL,        -- data do último disparo (para reset)
  sent INT, failed INT, total INT,
  ...
)

campaign_logs (
  id VARCHAR(36) PK,
  campaign_id VARCHAR(36) FK,
  contact_id VARCHAR(36) FK,
  status ENUM('pending','sent','failed'),
  message TEXT, error TEXT, sent_at TIMESTAMP,
  created_at TIMESTAMP
)

ai_configs (
  provider ENUM('openai','gemini','groq','mistral') UNIQUE,
  api_key VARCHAR(500), model VARCHAR(100), enabled TINYINT(1)
)
```

**Sempre prefira `jid` para envio**. `phone` é apenas para exibição/CSV.

### Conectar ao MySQL no VPS

```sh
docker exec disparo_mysql mysql -udisparo -pDisparo@2026 disparo_whats -e "SELECT ..."
```

---

## 6. Limitações Conhecidas (WhatsApp)

1. **Privacy Mode (LID)**: contatos de grupos onde o usuário não tem o membro salvo na agenda aparecem como `@lid`. Não é possível resolver para telefone real via API Web. Solução: enviar para `@lid` diretamente (funciona).
2. **Risk de ban**: disparos para muitos LIDs desconhecidos em sequência **podem** levar a ban. Recomendação:
   - Delays 15-30s
   - Múltiplas sessões com rotação
   - Mensagens variadas (gerar com IA)
   - Teste com 5-10 contatos antes de disparo em massa
3. **Sync inicial só no primeiro QR**: `messaging-history.set` só dispara em login novo (após scan). Sessões antigas não recebem o sync completo. Para forçar: deletar `data/sessions/<id>` e re-escanear.

---

## 7. Workflow para Adicionar Features

1. **Type-check antes de commit**: `npx tsc --noEmit` em `apps/backend` e `apps/web`
2. **Commit semântico**: `feat:`, `fix:`, `chore:`, `docs:`
3. **Deploy**: push em master → SSH no VPS → `git pull && docker compose up -d --build backend`
4. **Verificar logs**: `docker logs disparo_backend 2>&1 | grep <padrão> | tail -20`
5. **Testar**: usar scripts em `deploy/` ou via curl direto

### Scripts úteis em `deploy/`

- `check_sync.sh` — status da sessão (lidMapSize)
- `test_extract.sh` — extrai grupo via API e cria lista
- `check_extracted.sh` — verifica contatos no DB
- `reset_session.js` — reseta sessão para `disconnected` no DB
- `debug_meta.js` — testa `groupMetadata` direto

---

## 8. Convenções

- **Código**: TypeScript estrito, sem `any` solto (use `as unknown as <T>`)
- **Comentários**: NÃO adicionar/remover comentários sem ser pedido (regra global)
- **Idioma**: PT-BR em mensagens de UI, logs e commits
- **PowerShell**: nunca usar `&&` — usar `;`. Para SQL com aspas, criar script `.sh` temporário em vez de inline
- **Git**: nunca fazer push sem testar `npx tsc --noEmit`
- **Arquivos grandes**: refatorar em > 300 linhas; funções > 50 linhas

---

## 9. Referências Externas

- [Evolution API PR #2025](https://github.com/EvolutionAPI/evolution-api/pull/2025) — referência da abordagem LID→JID
- [Baileys docs](https://github.com/WhiskeySockets/Baileys)
- Fonte do `findParticipants` da Evolution: `evolution-ref/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts:4904`

---

## 10. Próximos Passos Sugeridos

- [x] ~~Endpoint de **disparo de teste** (5 mensagens) antes do massivo~~ — feito (`/campaigns/:id/test-send`)
- [x] ~~**Validação prévia de contatos** via `onWhatsApp`~~ — feito
- [x] ~~**Limite diário** com pause automático~~ — feito (`max_per_day`)
- [x] ~~**Status por contato** (aguardando/enviado/falhou)~~ — feito
- [x] ~~**Mistral AI** como provedor~~ — feito
- [ ] **Aquecimento de chip** (warming): primeiras 24h enviar só para contatos da agenda
- [ ] **Detecção de ban** automática (tratar `connection.update` com `loggedOut`, marcar sessão)
- [ ] **Rotação inteligente** de sessões baseada em taxa de erro
- [ ] **Métricas** por sessão (sent/failed/banned em dashboard)
- [ ] **Refatorar `AIService`**: extrair `AIProviderAdapter` interface (suporte fácil para DeepSeek, Anthropic)
- [ ] **Pub/sub Redis** para checagem de status no worker (hoje faz SELECT a cada contato)
- [ ] **Índice composto** em `campaign_logs(campaign_id, contact_id, status)` para acelerar resume com milhões de logs
- [ ] **Verificação de números em background job** (hoje bloqueia HTTP até terminar; problemático para listas com 5k+)
- [ ] **Busca por telefone/nome** no modal de detalhes da campanha
- [ ] **Variação de mensagens** via templates + IA (já parcial via `prompt`)
