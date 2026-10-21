-- ════════════════════════════════════════════════════════════════════════════════════
-- 0002 · Importação ÚNICA do histórico da Seis (financeiro_seis → bpo_fin, org 'casa')
--
-- Rodar UMA vez, à mão, como postgres:   select bpo_fin.fn_importar_historico_seis('2026-11-01');
-- O argumento é a competencia_inicial: dali em diante o Vesso FIN cobra rotina (fila,
-- checklist). Antes disso, tudo é histórico.
--
-- A convenção que o financeiro_seis usa hoje — e que esta importação precisa respeitar:
--   · lançamento MANUAL com banco='Asaas' = o TÍTULO (a obrigação, com competência)
--   · linha do EXTRATO Asaas = o PAGAMENTO
--   · v_tabela_fato EXCLUI do extrato Asaas cinco categorias (impostos, encargos, pagamento
--     variável, retirada, transferências) para não contar duas vezes o que o manual já conta.
--   Isso funciona quando o manual existe. Quando não existe, o pagamento SOME do DRE em
--   silêncio (ex.: DARFs de R$ 967,80 jul/26, 769,80 ago, 180,00 set, 379,80 out — sem espelho).
--
-- O que esta importação faz com cada caso:
--   A. Extrato Asaas → movimento (origem 'asaas', id_externo = id_transacao, para o sync
--      ao vivo do Asaas deduplicar contra o histórico).
--   B. Manual em outro banco (Nubank, PayPal, RDB), Pago → movimento + título + baixa.
--   C. Manual banco='Asaas' → título. Se houver linha Asaas de categoria excluída com o mesmo
--      valor em até 5 dias → baixa nela (é a convenção). Se não houver → baixa num movimento
--      sintético na conta "Pagamentos sem extrato (legado)" — o DRE fica igual ao de hoje e
--      o buraco fica VISÍVEL, com nome, em vez de virar 376 títulos "vencidos" na tela.
--   D. Linha Asaas de categoria normal → título + baixa (como o v_tabela_fato conta hoje).
--   E. Linha Asaas de categoria excluída SEM manual correspondente → título + baixa.
--      ⚠️ É aqui que o DRE novo difere do atual, de propósito: esses pagamentos existiram.
--   F. Transferências (das duas fontes) → pareadas (mesmo valor, sinal oposto, ≤ 3 dias,
--      contas diferentes). Sem par → ignorado, categoria 'legado', com motivo.
--   G. Manual 'Em Aberto' → título em aberto (vai para A Pagar / projetado).
--   H. Linha Asaas sem categoria → movimento pendente (antes da competencia_inicial: fora da fila).
--   I. Categoria "Preencher Manualmente" sem correção: lá fica sem competência (fora do DRE);
--      aqui ganha a do mês da transação e a observação 'competencia_presumida'.
--
-- Depois de rodar: select * from bpo_fin.v_conferencia_dre_seis;  — as diferenças por mês
-- devem ser explicadas pelos casos E, H e I. Diferença fora disso = defeito, não aceite.
-- ════════════════════════════════════════════════════════════════════════════════════

begin;

create function bpo_fin.fn_importar_historico_seis(p_competencia_inicial date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org     uuid;
  v_legado  uuid;
  v_res     jsonb := '{}';
  v_n       int;
  v_n2      int;
  r         record;
  v_mov     uuid;
  excluidas constant text[] := array['CAT_IMPOSTOS_E_TRIBUTOS', 'CAT_ENCARGOS_E_BENEFICIOS',
                                     'CAT_PAGAMENTO_VARIAVEL', 'CAT_RETIRADA_DE_LUCRO_SOCIO'];
  transf    constant text := 'CAT_TRANSFERENCIAS_ENTRE_CONTAS';
begin
  if exists (select 1 from bpo_fin.organizacoes where tipo = 'casa' and nome = 'Agência Seis') then
    raise exception 'histórico da Seis já importado';
  end if;

  insert into bpo_fin.organizacoes (nome, tipo, status, turma_fechamento, competencia_inicial)
  values ('Agência Seis', 'casa', 'ativa', 'A', date_trunc('month', p_competencia_inicial)::date)
  returning id_org into v_org;

  -- Entidades = empresas do financeiro_seis (Seis Marketing, Task SV)
  create temp table m_emp on commit drop as
  select e.id_empresa, gen_random_uuid() as id_entidade, e.razao_social, e.nome,
         regexp_replace(e.cnpj, '\D', '', 'g') as cnpj
  from financeiro_seis.empresas e where e.ativa;
  insert into bpo_fin.entidades (id_entidade, id_org, razao_social, nome_fantasia, cnpj)
  select id_entidade, v_org, razao_social, nome, cnpj from m_emp;

  -- Centros de custo = produtos que aparecem nos lançamentos
  create temp table m_cc on commit drop as
  select p.id_produto, gen_random_uuid() as id_centro_custo, p.slug_produto, p.nome_produto
  from app_seis.produtos p
  where p.id_produto in (select id_produto from financeiro_seis.extrato_asaas
                         union select id_produto from financeiro_seis.lancamentos_manuais
                         union select id_produto from financeiro_seis.empresas);
  insert into bpo_fin.centros_custo (id_centro_custo, id_org, codigo, nome)
  select id_centro_custo, v_org, slug_produto, nome_produto from m_cc;

  -- Plano de contas: macro vira grupo; categoria vira conta analítica
  create temp table m_pc on commit drop as
  select c.id_categoria, gen_random_uuid() as id_plano_conta, c.categoria, c.competencia_categoria,
         m.id_categoria_macro, m.categoria_macro, m.ordem_dre
  from financeiro_seis.categorias c
  left join financeiro_seis.categorias_macro m using (id_categoria_macro);

  insert into bpo_fin.plano_contas (id_plano_conta, id_org, codigo, nome, natureza, aceita_lancamento, entra_dre, entra_dfc, ordem_dre)
  select gen_random_uuid(), v_org, 'G_' || id_categoria_macro, categoria_macro, 'grupo', false, false, false, min(ordem_dre)
  from m_pc where id_categoria_macro is not null group by id_categoria_macro, categoria_macro;

  insert into bpo_fin.plano_contas (id_plano_conta, id_org, codigo, nome, id_pai, natureza, aceita_lancamento,
                                    entra_dre, entra_dfc, grupo_dfc, linha_dre, ordem_dre, regra_competencia, generica, sensivel)
  select p.id_plano_conta, v_org, p.id_categoria, p.categoria,
         (select g.id_plano_conta from bpo_fin.plano_contas g where g.id_org = v_org and g.codigo = 'G_' || p.id_categoria_macro),
         x.natureza, true,
         x.natureza not in ('retirada', 'transferencia', 'aplicacao'),
         x.natureza <> 'transferencia',
         case when x.natureza = 'transferencia' then null
              when x.natureza in ('investimento', 'aplicacao') then 'investimento'
              when x.natureza = 'retirada' then 'financiamento'
              else 'operacional' end,
         -- mesma régua de linha do financeiro_seis.v_dre_seis
         case when p.id_categoria = 'CAT_PESSOAL_FOLHA_DE_PAGAMENTO' then 'FOLHA'
              else case p.categoria_macro
                     when 'Receita' then 'RECEITA_BRUTA'
                     when 'Descontos e Estornos' then 'DEDUCOES'
                     when 'Custos Variáveis' then 'CUSTOS_VARIAVEIS'
                     when 'Despesas Fixas Operacionais' then 'DESPESAS_FIXAS_OUTRAS'
                     when 'Investimentos/Crescimento' then 'INVEST_CRESCIMENTO'
                     when 'Receitas Financeiras' then 'RECEITAS_FINANCEIRAS'
                     when 'Despesas Financeiras' then 'DESPESAS_FINANCEIRAS'
                     when 'Impostos sobre Lucro / Faturamento' then 'IMPOSTO_LUCRO' end end,
         case when p.id_categoria = 'CAT_PESSOAL_FOLHA_DE_PAGAMENTO' then 7
              else case p.categoria_macro when 'Receita' then 1 when 'Descontos e Estornos' then 2
                     when 'Custos Variáveis' then 4 when 'Despesas Fixas Operacionais' then 7
                     when 'Investimentos/Crescimento' then 10 when 'Receitas Financeiras' then 12
                     when 'Despesas Financeiras' then 13 when 'Impostos sobre Lucro / Faturamento' then 15 end end,
         case p.competencia_categoria when 'Despesa do Mês Anterior' then 'mes_anterior'
                                      when 'Preencher Manualmente' then 'manual' else 'mes_corrente' end,
         p.id_categoria like 'CAT_OUTROS_%',
         p.id_categoria in ('CAT_PESSOAL_FOLHA_DE_PAGAMENTO', 'CAT_RETIRADA_DE_LUCRO_SOCIO',
                            'CAT_ENCARGOS_E_BENEFICIOS', 'CAT_DESPESAS_PESSOAIS_NAO_DEDUTIVEIS')
  from m_pc p
  cross join lateral (select case
           when p.id_categoria = transf                      then 'transferencia'
           when p.id_categoria = 'CAT_APLICACOES_FINANCEIRAS' then 'aplicacao'
           when p.categoria_macro = 'Retirada de Lucro - Sócio' then 'retirada'
           when p.categoria_macro = 'Receita' then 'receita'
           when p.categoria_macro = 'Descontos e Estornos' then 'deducao'
           when p.categoria_macro = 'Custos Variáveis' then 'custo'
           when p.categoria_macro = 'Investimentos/Crescimento' then 'investimento'
           when p.categoria_macro = 'Receitas Financeiras' then 'financeira_receita'
           when p.categoria_macro = 'Despesas Financeiras' then 'financeira_despesa'
           when p.categoria_macro = 'Impostos sobre Lucro / Faturamento' then 'imposto'
           else 'despesa' end as natureza) x;

  -- Contas: Asaas por empresa + cada banco dos manuais + a conta de legado
  create temp table m_conta on commit drop as
  select e.id_empresa, 'Asaas'::text as banco, gen_random_uuid() as id_conta from m_emp e
  union all
  select distinct l.id_empresa, l.banco, null::uuid from financeiro_seis.lancamentos_manuais l where l.banco <> 'Asaas';
  update m_conta set id_conta = gen_random_uuid() where id_conta is null;
  insert into bpo_fin.contas (id_conta, id_org, id_entidade, tipo, instituicao, apelido, saldo_inicial, data_saldo_inicial)
  select c.id_conta, v_org, e.id_entidade,
         case when c.banco = 'Asaas' then 'gateway' when c.banco ilike 'aplica%' then 'aplicacao' else 'banco' end,
         c.banco, c.banco || ' · ' || e.nome, 0, date '2023-12-31'
  from m_conta c join m_emp e using (id_empresa);

  insert into bpo_fin.contas (id_org, id_entidade, tipo, instituicao, apelido, saldo_inicial, data_saldo_inicial, ativa)
  select v_org, (select id_entidade from m_emp order by nome limit 1), 'caixa', 'Legado',
         'Pagamentos sem extrato (legado)', 0, date '2023-12-31', false
  returning id_conta into v_legado;

  -- Contrapartes: dedup por documento; sem documento, uma por id_entidade de origem
  create temp table m_cp on commit drop as
  select ce.id_entidade as id_legado, regexp_replace(coalesce(ce.cpf_cnpj, ''), '\D', '', 'g') as doc,
         coalesce(ce.razao_social, ce.nome_fantasia) as nome, ce.id_categoria_padrao,
         case when ce.eh_cliente and ce.eh_fornecedor then 'ambos' when ce.eh_cliente then 'cliente' else 'fornecedor' end as tipo,
         null::uuid as id_contraparte
  from financeiro_seis.cadastro_entidades ce;
  update m_cp set doc = null where doc !~ '^[0-9]{11}$|^[0-9]{14}$';
  with docs as (select doc, gen_random_uuid() id from m_cp where doc is not null group by doc)
  update m_cp set id_contraparte = d.id from docs d where m_cp.doc = d.doc;
  update m_cp set id_contraparte = gen_random_uuid() where id_contraparte is null;
  insert into bpo_fin.contrapartes (id_contraparte, id_org, nome, documento, tipo, id_plano_conta_padrao, origem_legado)
  select distinct on (c.id_contraparte) c.id_contraparte, v_org, c.nome, c.doc, c.tipo,
         (select p.id_plano_conta from m_pc p where p.id_categoria = c.id_categoria_padrao), c.id_legado
  from m_cp c order by c.id_contraparte, c.id_legado;

  -- A. Extrato Asaas → movimentos
  create temp table m_asaas on commit drop as
  select ea.*, gen_random_uuid() as id_movimento, ct.id_conta,
         (row_number() over (partition by ea.id_empresa, ea.data_transacao, ea.value, bpo_fin.fn_normalizar_descricao(ea.description)
                             order by ea.id_transacao) - 1)::int as seq,
         false as consumido
  from financeiro_seis.extrato_asaas ea
  join m_conta ct on ct.id_empresa = ea.id_empresa and ct.banco = 'Asaas'
  where ea.value <> 0;
  insert into bpo_fin.movimentos (id_movimento, id_org, id_conta, origem, id_externo, hash_natural, data_movimento,
                                  valor, descricao_bruta, id_contraparte, payload_raw)
  select a.id_movimento, v_org, a.id_conta, 'asaas', a.id_transacao,
         bpo_fin.fn_hash_natural(a.id_conta, a.data_transacao, a.value, a.description, a.seq),
         a.data_transacao, a.value, a.description,
         (select cp.id_contraparte from m_cp cp where cp.id_legado = a.id_entidade),
         jsonb_build_object('legado', 'financeiro_seis.extrato_asaas', 'id_categoria', a.id_categoria, 'tipo_evento', a.tipo_evento)
  from m_asaas a;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('A_movimentos_asaas', v_n);

  -- Manuais
  create temp table m_man on commit drop as
  select l.*, gen_random_uuid() as id_titulo, null::uuid as id_movimento,
         financeiro_seis.fn_calcular_competencia(l.data_transacao, l.value, l.id_categoria, l.correcao_competencia) as comp_calc
  from financeiro_seis.lancamentos_manuais l where l.value <> 0;

  -- B. Manual em outro banco, Pago → movimento
  update m_man set id_movimento = gen_random_uuid()
   where banco <> 'Asaas' and status_titulo = 'Pago' and data_transacao <= current_date;
  insert into bpo_fin.movimentos (id_movimento, id_org, id_conta, origem, id_externo, hash_natural, data_movimento,
                                  valor, descricao_bruta, id_contraparte, payload_raw)
  select m.id_movimento, v_org, ct.id_conta, 'legado', m.id_lancamento,
         bpo_fin.fn_hash_natural(ct.id_conta, m.data_transacao, m.value, coalesce(m.description, '') || '#' || m.id_lancamento, 0),
         m.data_transacao, m.value, coalesce(m.description, m.observacoes),
         (select cp.id_contraparte from m_cp cp where cp.id_legado = m.id_entidade),
         jsonb_build_object('legado', 'financeiro_seis.lancamentos_manuais', 'id_categoria', m.id_categoria)
  from m_man m join m_conta ct on ct.id_empresa = m.id_empresa and ct.banco = m.banco
  where m.id_movimento is not null;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('B_movimentos_outros_bancos', v_n);

  -- Títulos de todos os manuais (menos transferência, que não é obrigação)
  insert into bpo_fin.titulos (id_titulo, id_org, id_entidade, tipo, id_contraparte, descricao, valor, data_emissao,
                               data_vencimento, competencia, id_plano_conta, id_centro_custo, origem, id_externo, observacao)
  select m.id_titulo, v_org, e.id_entidade, case when m.value > 0 then 'receber' else 'pagar' end,
         (select cp.id_contraparte from m_cp cp where cp.id_legado = m.id_entidade),
         coalesce(nullif(btrim(m.description), ''), nullif(btrim(m.observacoes), ''), pc.categoria, 'Lançamento manual (legado)'),
         abs(m.value), m.data_transacao, m.data_transacao,
         coalesce(m.comp_calc, date_trunc('month', m.data_transacao)::date),
         pc.id_plano_conta, cc.id_centro_custo, 'legado', 'manual:' || m.id_lancamento,
         case when m.comp_calc is null then 'competencia_presumida' end
  from m_man m
  join m_emp e using (id_empresa)
  left join m_pc pc on pc.id_categoria = m.id_categoria
  left join m_cc cc on cc.id_produto = m.id_produto
  where coalesce(m.id_categoria, '') <> transf;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('titulos_manuais', v_n);

  -- B. baixa do manual de outro banco no próprio movimento
  insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem)
  select v_org, m.id_titulo, m.id_movimento, abs(m.value), 'legado'
  from m_man m where m.id_movimento is not null and coalesce(m.id_categoria, '') <> transf;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('B_baixas_outros_bancos', v_n);

  -- C. manual banco='Asaas' Pago ↔ linha Asaas de categoria EXCLUÍDA (a convenção de hoje)
  v_n := 0;
  for r in
    select m.id_titulo, m.id_empresa, m.value, m.data_transacao
    from m_man m
    where m.banco = 'Asaas' and m.status_titulo = 'Pago' and coalesce(m.id_categoria, '') <> transf
    order by m.data_transacao, m.id_lancamento
  loop
    select a.id_movimento into v_mov from m_asaas a
     where not a.consumido and a.id_empresa = r.id_empresa and a.value = r.value
       and a.id_categoria = any (excluidas) and abs(a.data_transacao - r.data_transacao) <= 5
     order by abs(a.data_transacao - r.data_transacao), a.id_transacao limit 1;
    if v_mov is not null then
      update m_asaas set consumido = true where id_movimento = v_mov;
      update m_man set id_movimento = v_mov where id_titulo = r.id_titulo;
      insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem)
      values (v_org, r.id_titulo, v_mov, abs(r.value), 'legado');
      v_n := v_n + 1;
    end if;
  end loop;
  v_res := v_res || jsonb_build_object('C_manual_asaas_com_pagamento', v_n);

  -- C'. manual banco='Asaas' Pago sem pagamento no extrato → movimento sintético na conta de legado
  -- ⚠️ Duas instruções, não um CTE com INSERT: o trigger da baixa consulta o movimento, e
  -- dentro do mesmo comando ele não enxergaria o movimento recém-inserido pelo CTE.
  create temp table m_sem on commit drop as
  select m.*, gen_random_uuid() as id_mov_sint from m_man m
  where m.banco = 'Asaas' and m.status_titulo = 'Pago' and m.id_movimento is null and coalesce(m.id_categoria, '') <> transf;
  insert into bpo_fin.movimentos (id_movimento, id_org, id_conta, origem, id_externo, hash_natural, data_movimento, valor, descricao_bruta, payload_raw)
  select s.id_mov_sint, v_org, v_legado, 'legado', 'sem_extrato:' || s.id_lancamento,
         bpo_fin.fn_hash_natural(v_legado, s.data_transacao, s.value, 'sem_extrato:' || s.id_lancamento, 0),
         s.data_transacao, s.value, 'Sem pagamento correspondente no extrato Asaas: ' || coalesce(s.description, s.id_lancamento),
         jsonb_build_object('legado', 'financeiro_seis.lancamentos_manuais', 'motivo', 'sem_gemeo_no_extrato')
  from m_sem s;
  insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem)
  select v_org, s.id_titulo, s.id_mov_sint, abs(s.value), 'legado' from m_sem s;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('C_manual_asaas_SEM_extrato', v_n);

  -- D + E. Linha Asaas não consumida, com categoria e que não é transferência → título + baixa
  create temp table m_d on commit drop as
  select a.*, gen_random_uuid() as id_titulo_novo, (a.id_categoria = any (excluidas)) as caso_e
  from m_asaas a
  where not a.consumido and a.id_categoria is not null and a.id_categoria <> transf;
  insert into bpo_fin.titulos (id_titulo, id_org, id_entidade, tipo, id_contraparte, descricao, valor, data_emissao,
                               data_vencimento, competencia, id_plano_conta, id_centro_custo, origem, id_externo, observacao)
  select d.id_titulo_novo, v_org, e.id_entidade, case when d.value > 0 then 'receber' else 'pagar' end,
         (select cp.id_contraparte from m_cp cp where cp.id_legado = d.id_entidade),
         coalesce(nullif(btrim(d.description), ''), d.tipo_evento, 'Asaas (legado)'),
         abs(d.value), d.data_transacao, d.data_transacao,
         coalesce(financeiro_seis.fn_calcular_competencia(d.data_transacao, d.value, d.id_categoria, d.correcao_competencia),
                  date_trunc('month', d.data_transacao)::date),
         pc.id_plano_conta, cc.id_centro_custo, 'legado', 'asaas:' || d.id_transacao,
         concat_ws('; ',
           case when financeiro_seis.fn_calcular_competencia(d.data_transacao, d.value, d.id_categoria, d.correcao_competencia) is null
                then 'competencia_presumida' end,
           case when d.caso_e then 'fora_do_dre_no_financeiro_seis' end)
  from m_d d join m_emp e using (id_empresa)
  join m_pc pc on pc.id_categoria = d.id_categoria
  left join m_cc cc on cc.id_produto = d.id_produto;
  insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem)
  select v_org, d.id_titulo_novo, d.id_movimento, abs(d.value), 'legado' from m_d d;
  v_res := v_res || jsonb_build_object(
    'D_asaas_titulo_baixa', (select count(*) from m_d where not caso_e),
    'E_asaas_excluido_sem_manual', (select count(*) from m_d where caso_e),
    'E_valor', (select coalesce(sum(value), 0) from m_d where caso_e));

  -- F. Transferências: parear; sem par → ignorado 'legado'
  create temp table m_tr on commit drop as
  select a.id_movimento, a.id_conta, a.data_transacao as data, a.value as valor, false as usado from m_asaas a where a.id_categoria = transf
  union all
  select m.id_movimento, ct.id_conta, m.data_transacao, m.value, false
  from m_man m join m_conta ct on ct.id_empresa = m.id_empresa and ct.banco = m.banco
  where m.id_categoria = transf and m.id_movimento is not null;
  v_n := 0;
  for r in select * from m_tr where valor < 0 order by data, id_movimento loop
    select t.id_movimento into v_mov from m_tr t
     where not t.usado and t.valor = -r.valor and t.id_conta <> r.id_conta and abs(t.data - r.data) <= 3
     order by abs(t.data - r.data), t.id_movimento limit 1;
    if v_mov is not null then
      update m_tr set usado = true where id_movimento in (v_mov, r.id_movimento);
      insert into bpo_fin.transferencias (id_org, id_mov_saida, id_mov_entrada) values (v_org, r.id_movimento, v_mov);
      v_n := v_n + 1;
    end if;
  end loop;
  insert into bpo_fin.movimentos_ignorados (id_org, id_movimento, categoria, motivo)
  select v_org, t.id_movimento, 'legado',
         'Transferência entre contas importada do financeiro_seis; a outra ponta está em conta não importada'
  from m_tr t where not t.usado;
  get diagnostics v_n2 = row_count;
  v_res := v_res || jsonb_build_object('F_transferencias_pareadas', v_n, 'F_transferencias_sem_par', v_n2);

  -- H. contagem informativa
  v_res := v_res || jsonb_build_object('H_asaas_sem_categoria', (select count(*) from m_asaas where id_categoria is null));
  v_res := v_res || jsonb_build_object('G_titulos_em_aberto', (select count(*) from m_man where status_titulo <> 'Pago'));
  v_res := v_res || jsonb_build_object('id_org', v_org);
  return v_res;
end $$;

revoke execute on function bpo_fin.fn_importar_historico_seis(date) from public;

-- Conferência: DRE do financeiro_seis × DRE do bpo_fin, mês a mês. Só o dono vê a org casa.
create view bpo_fin.v_conferencia_dre_seis with (security_invoker = true) as
with velho as (
  select competencia, sum(value) as valor
  from financeiro_seis.v_dre_agg
  -- competência NULL ("Preencher Manualmente" sem correção) não cai em mês nenhum lá;
  -- aqui cai no mês da transação — aparece em explicado_caso_i
  where projecao = 'Real' and linha_dre <> 'NAO_CATEGORIZADO' and competencia is not null
  group by 1),
novo as (
  select d.competencia, sum(d.valor) as valor
  from bpo_fin.v_dre d join bpo_fin.organizacoes o on o.id_org = d.id_org
  where o.tipo = 'casa' and o.nome = 'Agência Seis'
  group by 1),
explicado as (
  select t.competencia,
         sum(case when t.observacao like '%fora_do_dre_no_financeiro_seis%' then
                   case when t.tipo = 'receber' then t.valor else -t.valor end else 0 end) as caso_e,
         sum(case when t.observacao like '%competencia_presumida%' then
                   case when t.tipo = 'receber' then t.valor else -t.valor end else 0 end) as caso_i
  from bpo_fin.titulos t
  join bpo_fin.organizacoes o on o.id_org = t.id_org
  join bpo_fin.plano_contas pc on pc.id_plano_conta = t.id_plano_conta and pc.entra_dre
  where o.tipo = 'casa' and o.nome = 'Agência Seis' and t.cancelado_em is null
  group by 1)
select coalesce(v.competencia, n.competencia) as competencia,
       v.valor as dre_financeiro_seis, n.valor as dre_vesso_fin,
       coalesce(n.valor, 0) - coalesce(v.valor, 0) as diferenca,
       coalesce(x.caso_e, 0) as explicado_caso_e,
       coalesce(x.caso_i, 0) as explicado_caso_i,
       coalesce(n.valor, 0) - coalesce(v.valor, 0) - coalesce(x.caso_e, 0) - coalesce(x.caso_i, 0) as nao_explicado
from velho v
full join novo n on n.competencia = v.competencia
left join explicado x on x.competencia = coalesce(v.competencia, n.competencia)
order by 1;

commit;
