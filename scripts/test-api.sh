#!/usr/bin/env bash
# Banco NOVO para o teste de integração da API: stubs + 0001 + 0003 + seed. A API conecta como vesso_fin_api
# (como em produção), com senha local de teste — o papel é do cluster local, nunca de produção.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v psql >/dev/null || export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
DB=vf_api
dropdb --if-exists "$DB"
createdb --template=template0 --locale-provider=icu --icu-locale=en-US --locale=en_US.UTF-8 "$DB"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f test/00_stubs_supabase.sql -f test/01_stub_vault.sql -f sql/0001_bpo_fin_nucleo.sql \
  -f sql/0003_bpo_fin_search_path_funcoes_hash.sql \
  -f sql/0004_bpo_fin_upload_extrato_desfazer_transferencia.sql \
  -f sql/0005_bpo_fin_sync_asaas.sql -f sql/0007_bpo_fin_informar_saldo.sql -f sql/0008_bpo_fin_acessos.sql -f sql/0009_bpo_fin_documentos.sql -f apps/api/test/seed.sql >/dev/null 2>&1
psql -d "$DB" -q -c "alter role vesso_fin_api with login password 'teste-local'" -c "alter role vesso_fin_worker with login password 'teste-local'" >/dev/null
DATABASE_URL_API="postgres://vesso_fin_api:teste-local@localhost/$DB" \
DATABASE_URL_WORKER="postgres://vesso_fin_worker:teste-local@localhost/$DB" pnpm --filter @vesso-fin/api exec vitest run "$@"
