\set ON_ERROR_STOP 1
-- Testes da 0014 (importação complementar). Banco NOVO com a importação já feita (stub financeiro_seis + 0001..0006 + 0014).
create or replace function public.checar14(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'FALHA: %', p_msg; end if; raise notice 'ok: %', p_msg; end $$;
\set S '''5dd1e25a-ffa6-4a5e-8e58-e021e983cea5'''
\set TR '''5bcafa90-bf90-4a00-b744-54e5baa0012d'''

select checar14((select count(*) = 0 from bpo_fin.v_conferencia_dre_seis where nao_explicado <> 0), 'antes: conferência zerada');

-- o financeiro_seis seguiu em uso depois da importação: linhas novas de outubro (e uma de novembro) …
insert into financeiro_seis.extrato_asaas values
  ('A20', :S, 'ENT_CLI1', '2026-10-10',  800, 'PAYMENT_RECEIVED', 'Mensalidade out', 'CAT_PAGAMENTO_DE_RECORRENCIA', null, :TR), -- D
  ('A21', :S, null,       '2026-10-10',   -2, 'PAYMENT_FEE',      'Taxa',            'CAT_TAXAS_BANCARIAS_GATEWAY', null, :TR),   -- D
  ('A22', :S, 'ENT_RF',   '2026-10-12', -700, 'TRANSFER',         'PIX MINISTERIO DA FAZENDA', 'CAT_ENCARGOS_E_BENEFICIOS', null, :TR), -- C com M20
  ('A23', :S, 'ENT_RF',   '2026-10-15', -400, 'TRANSFER',         'PIX MINISTERIO DA FAZENDA', 'CAT_ENCARGOS_E_BENEFICIOS', null, :TR), -- E
  ('A24', :S, null,       '2026-10-16', -100, 'TRANSFER',         'Transf p/ Nubank', 'CAT_TRANSFERENCIAS_ENTRE_CONTAS', null, :TR),   -- F
  ('A26', :S, null,       '2026-10-17',  -30, 'OUTRO',            'Sem categoria', null, null, :TR),                                  -- H
  ('A25', :S, 'ENT_CLI1', '2026-11-05',  999, 'PAYMENT_RECEIVED', 'Mensalidade nov', 'CAT_PAGAMENTO_DE_RECORRENCIA', null, :TR); -- fora (nov)
insert into financeiro_seis.lancamentos_manuais values
  ('M20', :S, 'ENT_RF', 'CAT_IMPOSTOS_E_TRIBUTOS', '2026-10-12', -700, 'Asaas', 'Pago', null, 'DAS set/26', null, null, :TR),        -- C
  ('M21', :S, null, 'CAT_SOFTWARES_ADMINISTRATIVOS', '2026-10-08', -150, 'Nubank', 'Pago', null, 'Software out', null, null, :TR),   -- B
  ('M22', :S, null, 'CAT_PESSOAL_FOLHA_DE_PAGAMENTO', '2026-10-20', -90, 'Asaas', 'Pago', null, 'Folha extra', null, null, :TR),     -- C' sem extrato
  ('M23', :S, null, 'CAT_SOFTWARES_ADMINISTRATIVOS', '2026-10-30', -50, 'Asaas', 'Em Aberto', null, 'Assinatura', null, null, :TR); -- G
-- … e linhas JÁ importadas alteradas lá: categoria (A2) e valor (A1)
update financeiro_seis.extrato_asaas set id_categoria = 'CAT_SOFTWARES_ADMINISTRATIVOS' where id_transacao = 'A2';
update financeiro_seis.extrato_asaas set value = 4100 where id_transacao = 'A1';

select checar14((select count(*) > 0 from bpo_fin.v_conferencia_dre_seis where nao_explicado <> 0), 'depois das mudanças lá: conferência com diferença');

-- 1. SIMULAÇÃO não grava nada
create temp table antes as select (select count(*) from bpo_fin.movimentos) mov, (select count(*) from bpo_fin.titulos) tit, (select count(*) from bpo_fin.baixas) bx;
create temp table sim as select bpo_fin.fn_simular_complemento_seis() r;
select checar14((select (r ->> 'simulacao')::boolean and (r ->> 'A_movimentos_asaas_novos')::int = 6 from sim), 'simulação devolve o relatório (6 linhas Asaas novas)');
select checar14((select mov = (select count(*) from bpo_fin.movimentos) and tit = (select count(*) from bpo_fin.titulos) and bx = (select count(*) from bpo_fin.baixas) from antes),
               'simulação não gravou nada');

-- 2. APLICAR
create temp table apl as select bpo_fin.fn_importar_complemento_seis('2026-10-31', true) r;
select checar14((select (r ->> 'A_movimentos_asaas_novos')::int = 6 and (r ->> 'titulos_manuais_novos')::int = 4
                        and (r ->> 'B_movimentos_outros_bancos')::int = 1 and (r ->> 'C_manual_asaas_com_pagamento')::int = 1
                        and (r ->> 'C_manual_asaas_SEM_extrato')::int = 1 and (r ->> 'D_asaas_titulo_baixa')::int = 2
                        and (r ->> 'E_asaas_excluido_sem_manual')::int = 1 and (r ->> 'F_transferencias_ignoradas')::int = 1
                        and (r ->> 'H_asaas_sem_categoria')::int = 1 and (r ->> 'titulos_recategorizados')::int = 1 from apl),
               'casos A–F como na importação original');
select checar14((select jsonb_array_length(r -> 'alterados_para_revisar') = 1 and r -> 'alterados_para_revisar' -> 0 ->> 'origem' = 'A1'
                        and r -> 'alterados_para_revisar' -> 0 -> 'valor' = '[4000, 4100]'::jsonb from apl),
               'valor alterado lá NÃO é aplicado: vai para revisão');
select checar14((select count(*) = 0 from bpo_fin.movimentos where id_externo = 'A25'), 'novembro em diante não entra (é rotina do Vesso FIN)');
select checar14((select pc.codigo = 'CAT_SOFTWARES_ADMINISTRATIVOS' from bpo_fin.titulos t join bpo_fin.plano_contas pc using (id_plano_conta) where t.id_externo = 'asaas:A2'),
               'categoria alterada lá → título recategorizado');
select checar14(exists (select 1 from bpo_fin.titulos t where t.id_externo = 'manual:M23'
                   and not exists (select 1 from bpo_fin.baixas b where b.id_titulo = t.id_titulo)), 'manual em aberto vira título sem baixa');
select checar14((select count(*) = 1 and bool_and(organizacao = 'Agência Seis' and competencia = '2026-09-01' and nao_explicado = -100)
                 from bpo_fin.v_conferencia_dre_seis where nao_explicado <> 0 and competencia < '2026-11-01'),
               'conferência até out/26: só sobra o valor alterado em set/26 (−100), que foi para revisão');
select checar14((select nao_explicado = -999 from bpo_fin.v_conferencia_dre_seis where competencia = '2026-11-01' and organizacao = 'Agência Seis'),
               'nov/26 segue diferente de propósito (a linha nova de lá é rotina do Vesso FIN)');

-- 3. IDEMPOTENTE
create temp table apl2 as select bpo_fin.fn_importar_complemento_seis('2026-10-31', true) r;
select checar14((select (r ->> 'A_movimentos_asaas_novos')::int = 0 and (r ->> 'titulos_manuais_novos')::int = 0 and (r ->> 'titulos_recategorizados')::int = 0 from apl2),
               'rodar de novo não duplica nada');
select checar14(has_function_privilege('authenticated', 'bpo_fin.fn_importar_complemento_seis(date, boolean)', 'execute') = false, 'ninguém além do postgres executa');

\echo TODOS OS TESTES DA 0014 PASSARAM
