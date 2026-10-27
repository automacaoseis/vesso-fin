# Deploy do Vesso FIN

Ordem: banco (já feito) → passos manuais do Supabase → Railway (API + worker) → Vercel (web) → conferência.
Nada aqui usa `service_role`. Nenhuma variável `NEXT_PUBLIC_*`.

## 0. Antes (Supabase, SQL Editor) — `docs/pos-importacao.sql`
Passos 1 (você em `bpo_fin.donos`) e 2 (senhas de `vesso_fin_api` e `vesso_fin_worker`) são pré-requisito.
Guarde as duas senhas num gerenciador; elas só vão para o env da Railway.

Conferir que o pooler aceita os logins (do seu terminal):
```bash
psql "postgres://vesso_fin_api.gzdvkqzliyupiuyaqkpj:<senha1>@<host do pooler>:6543/postgres" -c "select current_user"
psql "postgres://vesso_fin_worker.gzdvkqzliyupiuyaqkpj:<senha2>@<host do pooler>:6543/postgres" -c "select current_user"
```
O host está em Supabase → Connect → **Transaction pooler** (us-east-1). Baixe também o certificado em
Settings → Database → SSL Configuration (vira `DATABASE_CA`).

## 1. Código no GitHub
Railway e Vercel puxam do GitHub. Criar o repositório privado `vesso-fin` e dar push da `main`.

## 2. Railway — projeto `vesso-fin`, região **US East**, dois serviços do mesmo repo
| | Serviço `api` | Serviço `worker` |
|---|---|---|
| Config file | `apps/api/railway.api.json` | `apps/api/railway.worker.json` |
| Domínio público | sim (gera a URL da API) | **não** |
| Variáveis | `DATABASE_URL` (login api), `DATABASE_CA`, `SUPABASE_URL`, `VESSO_SERVICE_SECRET` | `DATABASE_URL_WORKER` (login worker), `DATABASE_CA`, `INTERVALO_MS=2000` |

- `SUPABASE_URL=https://gzdvkqzliyupiuyaqkpj.supabase.co` (só para JWKS/issuer).
- `VESSO_SERVICE_SECRET`: gerar com `openssl rand -hex 32`. O MESMO valor vai para a Vercel.
- Conferir: `curl https://<url-da-api>/health` → `ok`; `curl https://<url-da-api>/orgs` → 401 "sem assinatura de serviço".

## 3. Vercel — projeto `vesso-fin`
- Root Directory: `apps/web` · Framework: Next.js · região vem do `apps/web/vercel.json` (`iad1`).
- Variáveis (todas de servidor):
  `VESSO_API_URL=https://<url-da-api>` · `VESSO_SERVICE_SECRET=<o mesmo da Railway>` ·
  `SUPABASE_URL=https://gzdvkqzliyupiuyaqkpj.supabase.co` · `SUPABASE_PUBLISHABLE_KEY=sb_publishable_…`
  (Supabase → Settings → API Keys; é a chave publicável, NÃO a service_role).
- Domínio: o que você escolher (ex.: `fin.vessosocio.com.br`).

## 4. Conferência pós-deploy (critérios de aceite da Fase 1a)
1. Abrir o app, DevTools → Network: nenhuma requisição a `*.supabase.co`, inclusive no login.
2. Entrar como você: aparecem Agência Seis e Task SV. Entrar como um gestor de tráfego qualquer: zero organizações.
3. Conexões → importar um OFX do Nubank → "Processado" em segundos; reimportar o mesmo → "já tinha sido importado".
4. Railway → logs do worker: `{"nivel":"info","tipo":"sync_asaas",…}` depois de `select bpo_fin.fn_agendar_sync_asaas();`.
