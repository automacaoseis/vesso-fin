# Vesso FIN — status (23/10/2026)

## Banco: APLICADO em produção (gzdvkqzliyupiuyaqkpj, Postgres 17.6)
| Versão no histórico do Supabase | Arquivo |
|---|---|
| 20261023114442 | sql/0001_bpo_fin_nucleo.sql |
| 20261023114707 | sql/0002_bpo_fin_importa_historico_seis.sql |
| 20261023114802 | sql/0003_bpo_fin_search_path_funcoes_hash.sql |
| 20261026153011 | sql/0004_bpo_fin_upload_extrato_desfazer_transferencia.sql (aplicada em 26/10, `fn_registrar_extrato` + `fn_desfazer_transferencia`) |
| 20261027133109 | sql/0005_bpo_fin_sync_asaas.sql (aplicada em 27/10: `fn_segredo_da_conexao` só p/ worker, `fn_agendar_sync_asaas`, cron `bpo_fin_sync_asaas` 09:00 UTC) |
| 20261027165200 | sql/0006_bpo_fin_importacao_uma_org_por_empresa.sql (aplicada pelo SQL Editor em 27/10: importação cria UMA org casa por empresa — Agência Seis e Task SV; conferência por org × mês; grant da view) |

Cópias com esses nomes exatos estão em `seis-sistema/supabase/migrations/` (sem commit), para o `supabase db push` de lá não estranhar o histórico.

- Schema `bpo_fin`: 27 tabelas, 10 views, 39 funções (35 + 2 da 0004 + 2 da 0005). Duas organizações casa (Agência Seis, Task SV), importadas em 27/10.
- Papéis `vesso_fin_api` e `vesso_fin_worker` existem, **NOLOGIN** (sem senha). `grant authenticated to vesso_fin_api` funcionou no Supabase.
- Security Advisor: nenhum aviso restante no `bpo_fin` (os 2 de search_path foram corrigidos pela 0003).
- **Validação:** ensaio completo em produção com rollback antes de aplicar — 0001+0002 + a importação real da Seis:
  41 meses, `nao_explicado = 0` em todos. Diferenças explicadas: caso E −R$ 5.242,86 (Encargos pagos no Asaas sem lançamento
  manual, que o financeiro_seis deixa fora do DRE) e caso I −R$ 198,87 (competência presumida).
  Contagens do ensaio: 8.733 mov. Asaas · 106 mov. outros bancos · 8.269 títulos Asaas conciliados · 236 manuais ligados ao
  pagamento · 382 manuais sem extrato (conta legado) · 19 transferências pareadas / 22 sem par · 24 títulos em aberto · 22 sem categoria.

## Ensaio com a 0006 (27/10/2026, produção, transação descartada — nada gravado)
| Org | Meses | nao_explicado ≠ 0 | DRE financeiro_seis | DRE Vesso FIN | Caso E | Caso I | Contas | Movimentos | Títulos | Em aberto | Pendentes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Agência Seis | 41 (dez/23–abr/27) | 0 | 380.534,51 | 380.250,32 | −178,31 | −105,88 | 5 | 7.974 | 7.940 | 24 | 5 |
| Task SV | 23 (dez/24–out/26) | 0 | 82.762,05 | 77.604,51 | −5.064,55 | −92,99 | 3 | 1.295 | 1.271 | 0 | 17 |
Totais E (−5.242,86) e I (−198,87) iguais ao ensaio de 23/10 com org única. Transferências: 19 pareadas (Seis), 22 sem par
(15 Seis, 7 Task SV), 0 entre as empresas. 382 manuais Asaas sem extrato na conta de legado.

## Importação REAL: feita em 27/10/2026 (competencia_inicial 2026-11-01)
Mesmos números do ensaio acima; nao_explicado = 0 em todos os meses das duas orgs. 18.541 eventos de auditoria.
- Agência Seis: f41614cb-7e4c-4285-8bf3-f7051f66a95d · Task SV: f0205731-27e1-4e37-bfa5-3bbf47c180ed
- Próximos passos manuais (com os ids certos): docs/pos-importacao.sql

## NÃO feito (depende do Luiz)
- Senhas dos papéis (`alter role ... with login password`), inserir o dono em `bpo_fin.donos`.
- Confirmar no painel (Settings → API → Exposed schemas) que `bpo_fin` NÃO está exposto. (O advisor não listou funções do
  bpo_fin como executáveis por anon/authenticated via API — indício de que não está exposto, mas confirmar no painel.)
- Commit das cópias no seis-sistema.

## Vetor de teste do hash (TS tem que reproduzir)
`fn_hash_natural('00000000-0000-0000-0000-000000000001', '2026-10-01', -50, '  pix   teste ', 0)`
= sha256(`00000000-0000-0000-0000-000000000001|2026-10-01|-50.00|PIX TESTE|0`)
= `7fce8b012c186feb30c5c55b5a80e57e3468f10762833ec3a157e499efb85974` (conferido em produção e em Python)

## Próximo
1. Monorepo (`apps/web`, `apps/api`, `packages/shared`) + `fmtBRL` + hash em TS com o vetor acima.
2. API (Hono na Railway): HMAC de serviço + JWT (confirmar JWKS × JWT secret) + `set local role authenticated`.
3. Tela de Conciliação.
