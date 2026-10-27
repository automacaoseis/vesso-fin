# vesso-fin

Fase 1 do Vesso FIN. Especificação: `docs/PROMPT.md`. Regras: `CLAUDE.md`.

## Testar o banco localmente (macOS)

```bash
brew install postgresql@16
brew services start postgresql@16
export PATH="$(brew --prefix postgresql@16)/bin:$PATH"

# Núcleo (0001) — esperado: 43 linhas "NOTICE: ok" e a última "TODOS OS TESTES PASSARAM"
dropdb --if-exists vf_t1; createdb vf_t1
psql -d vf_t1 -v ON_ERROR_STOP=1 -q -f test/00_stubs_supabase.sql -f sql/0001_bpo_fin_nucleo.sql
psql -d vf_t1 -v ON_ERROR_STOP=1 -q -f test/10_testes_nucleo.sql 2>&1 | grep -E "NOTICE|ERROR"

# Importação da Seis (0002) contra réplica do financeiro_seis — esperado: nao_explicado = 0 em todos os meses
dropdb --if-exists vf_t2; createdb vf_t2
psql -d vf_t2 -v ON_ERROR_STOP=1 -q -f test/00_stubs_supabase.sql -f test/20_stub_financeiro_seis.sql \
  -f sql/0001_bpo_fin_nucleo.sql -f sql/0002_bpo_fin_importa_historico_seis.sql
psql -d vf_t2 -c "select bpo_fin.fn_importar_historico_seis('2026-11-01')" -c "select * from bpo_fin.v_conferencia_dre_seis"
```

Os stubs imitam o mínimo do Supabase (`auth.uid()`, papéis `anon`/`authenticated`, `app_seis.clientes`).
O teste foi validado em Postgres 16; produção é Postgres 17 — por isso o passo seguinte é um branch do Supabase.

## Integridade dos arquivos (sha256, 16 primeiros caracteres)
- 0001_bpo_fin_nucleo.sql ............ 6a118284810ceab2
- 0002_bpo_fin_importa_historico_seis . c26747454142eeda
- test/10_testes_nucleo.sql .......... 945d0a56157b86b6

## Código (pnpm, Node ≥ 22)

```bash
pnpm install
pnpm test:db     # banco: núcleo (43) + importação (nao_explicado = 0) + 0004 + 0005, cada um num banco novo ICU
pnpm test        # unitários (fmtBRL, hash contra vetores de produção)
pnpm test:sql    # hash TS × bpo_fin.fn_hash_natural: banco novo com ICU (como produção), 2.000 linhas aleatórias
pnpm test:api    # API e worker × Postgres local: banco novo, conecta como vesso_fin_api / vesso_fin_worker
pnpm typecheck
```

API local: `cp apps/api/.env.example apps/api/.env`, ajustar e `pnpm --filter @vesso-fin/api dev`.
Worker local: `DATABASE_URL_WORKER=… pnpm --filter @vesso-fin/api worker` (processa a fila `bpo_fin.fila_jobs`: `processar_extrato` (OFX) e `sync_asaas`).
Web local: `cp apps/web/.env.example apps/web/.env.local`, ajustar e `pnpm --filter @vesso-fin/web dev` (porta 3300).

Ponta a ponta sem tocar no Supabase: `pnpm --filter @vesso-fin/api exec tsx scripts/auth-falso.ts` sobe um Auth falso
(JWKS + login, ES256) em :9999 com os usuários do seed (`analista@x`, `revisor@x`, `head@x`, `dono@x`,
`gestor_trafego@x`, senha `senha`). Aponte `SUPABASE_URL=http://localhost:9999` na API e no web.
