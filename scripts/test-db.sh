#!/usr/bin/env bash
# Todos os testes do banco, cada um num banco NOVO com locale ICU (como produção):
#   núcleo (test/10) · importação (0002 + conferência) · 0004 (test/30) · 0005 (test/40) · 0007 (test/50) — sempre com todas as migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v psql >/dev/null || export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
MIGS=(sql/0001_bpo_fin_nucleo.sql sql/0003_bpo_fin_search_path_funcoes_hash.sql sql/0004_bpo_fin_upload_extrato_desfazer_transferencia.sql sql/0005_bpo_fin_sync_asaas.sql sql/0007_bpo_fin_informar_saldo.sql)
STUBS=(test/00_stubs_supabase.sql test/01_stub_vault.sql)
novo() { dropdb --if-exists "$1" 2>/dev/null; createdb --template=template0 --locale-provider=icu --icu-locale=en-US --locale=en_US.UTF-8 "$1"; }
aplicar() { local db=$1; shift; local args=(); for f in "$@"; do args+=(-f "$f"); done; psql -d "$db" -v ON_ERROR_STOP=1 -q "${args[@]}" >/dev/null 2>&1; }
falhou=0

novo vf_t1; aplicar vf_t1 "${STUBS[@]}" "${MIGS[@]}"
saida=$(psql -d vf_t1 -v ON_ERROR_STOP=1 -q -f test/10_testes_nucleo.sql 2>&1 || true)
n=$(grep -c "NOTICE:  ok" <<<"$saida" || true)
if grep -q "TODOS OS TESTES PASSARAM" <<<"$saida"; then echo "núcleo: $n ok"; else echo "núcleo FALHOU"; grep -E "ERROR|FALHA" <<<"$saida"; falhou=1; fi

novo vf_t2; aplicar vf_t2 "${STUBS[@]}" test/20_stub_financeiro_seis.sql sql/0001_bpo_fin_nucleo.sql sql/0002_bpo_fin_importa_historico_seis.sql "${MIGS[@]:1}" sql/0006_bpo_fin_importacao_uma_org_por_empresa.sql
psql -d vf_t2 -v ON_ERROR_STOP=1 -Atqc "select bpo_fin.fn_importar_historico_seis('2026-11-01')" >/dev/null
nx=$(psql -d vf_t2 -Atc "select count(*) filter (where nao_explicado <> 0) || '/' || count(*) from bpo_fin.v_conferencia_dre_seis")
orgs=$(psql -d vf_t2 -Atc "select string_agg(distinct organizacao, ' + ') from bpo_fin.v_conferencia_dre_seis")
if [[ $nx == 0/* ]]; then echo "importação: nao_explicado = 0 em ${nx#0/} linhas (org × mês: $orgs)"; else echo "importação FALHOU: $nx meses com nao_explicado"; falhou=1; fi
saida=$(psql -d vf_t2 -v ON_ERROR_STOP=1 -q -f test/25_testes_0006.sql 2>&1 || true)
n=$(grep -c "NOTICE:  ok" <<<"$saida" || true)
if grep -q "TODOS OS TESTES DA 0006 PASSARAM" <<<"$saida"; then echo "0006: $n ok"; else echo "0006 FALHOU"; grep -E "ERROR|FALHA" <<<"$saida"; falhou=1; fi

novo vf_t4; aplicar vf_t4 "${STUBS[@]}" "${MIGS[@]}" apps/api/test/seed.sql
saida=$(psql -d vf_t4 -v ON_ERROR_STOP=1 -q -f test/30_testes_0004.sql 2>&1 || true)
n=$(grep -c "NOTICE:  ok" <<<"$saida" || true)
if grep -q "TODOS OS TESTES DA 0004 PASSARAM" <<<"$saida"; then echo "0004: $n ok"; else echo "0004 FALHOU"; grep -E "ERROR|FALHA" <<<"$saida"; falhou=1; fi
novo vf_t5; aplicar vf_t5 "${STUBS[@]}" "${MIGS[@]}" apps/api/test/seed.sql
saida=$(psql -d vf_t5 -v ON_ERROR_STOP=1 -q -f test/40_testes_0005.sql 2>&1 || true)
n=$(grep -c "NOTICE:  ok" <<<"$saida" || true)
if grep -q "TODOS OS TESTES DA 0005 PASSARAM" <<<"$saida"; then echo "0005: $n ok"; else echo "0005 FALHOU"; grep -E "ERROR|FALHA" <<<"$saida"; falhou=1; fi
novo vf_t7; aplicar vf_t7 "${STUBS[@]}" "${MIGS[@]}" apps/api/test/seed.sql
saida=$(psql -d vf_t7 -v ON_ERROR_STOP=1 -q -f test/50_testes_0007.sql 2>&1 || true)
n=$(grep -c "NOTICE:  ok" <<<"$saida" || true)
if grep -q "TODOS OS TESTES DA 0007 PASSARAM" <<<"$saida"; then echo "0007: $n ok"; else echo "0007 FALHOU"; grep -E "ERROR|FALHA" <<<"$saida"; falhou=1; fi
exit $falhou
