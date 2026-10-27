#!/usr/bin/env bash
# Prepara um banco NOVO com locale ICU (igual a produção), aplica stubs + 0001 + 0003 e roda o teste TS × SQL do hash.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v psql >/dev/null || export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
DB=vf_hash
dropdb --if-exists "$DB"
createdb --template=template0 --locale-provider=icu --icu-locale=en-US --locale=en_US.UTF-8 "$DB"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f test/00_stubs_supabase.sql -f sql/0001_bpo_fin_nucleo.sql -f sql/0003_bpo_fin_search_path_funcoes_hash.sql >/dev/null
DATABASE_URL_HASH="postgres:///$DB" pnpm --filter @vesso-fin/shared exec vitest run test/hash.sql.test.ts
