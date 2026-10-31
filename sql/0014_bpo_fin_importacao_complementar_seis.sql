-- 0014 · Importação COMPLEMENTAR do financeiro_seis (o que entrou ou mudou lá depois da importação de 27/10/2026).
-- Por quê: o financeiro_seis seguiu em uso; em 31/10 a conferência (lida como admin) mostrava não explicado só em
-- out/26 e nov/26 (Seis) e set–out/26 (Task SV): 88 linhas novas do Asaas, 13 alteradas e 4 manuais. O Luiz escolheu
-- trazer (opção A) em vez de aceitar a diferença.
-- Regras (as MESMAS da 0006, casos A–F), só para o que falta:
--   · Asaas: linha sem movimento origem 'asaas' com aquele id_externo na org → movimento (+ título/baixa ou ignorado).
--   · Manual: lançamento sem título 'manual:<id>' (e sem movimento 'legado' <id>) → como na importação.
--   · Já importado e ALTERADO lá: categoria diferente → recategoriza o título (mês aberto). Valor/data diferente → NÃO
--     mexe (baixa e hash dependem disso): sai no relatório para alguém decidir na tela.
--   · Só até p_ate (padrão 31/10/2026): de novembro em diante quem manda é o Vesso FIN (competencia_inicial).
--   · p_aplicar = false (padrão) = SIMULAÇÃO: faz tudo e desfaz, devolvendo o relatório. true = grava.
-- Roda como postgres (sem grant para ninguém), como a importação original.
-- Aplicada em produção em 31/10/2026 (SQL Editor) como 20261031210000_bpo_fin_0014_importacao_complementar_seis (só as funções; rodar é outro passo).
begin;

create function bpo_fin.fn_importar_complemento_seis(p_ate date default '2026-10-31', p_aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res     jsonb := '{}';
  v_n       int;
  r         record;
  v_mov     uuid;
  excluidas constant text[] := array['CAT_IMPOSTOS_E_TRIBUTOS', 'CAT_ENCARGOS_E_BENEFICIOS',
                                     'CAT_PAGAMENTO_VARIAVEL', 'CAT_RETIRADA_DE_LUCRO_SOCIO'];
  transf    constant text := 'CAT_TRANSFERENCIAS_ENTRE_CONTAS';
begin
  -- empresas do financeiro_seis já importadas (org casa ligada pelo CNPJ)
  create temp table c_emp on commit drop as
  select fe.id_empresa, o.id_org, en.id_entidade, o.nome as org,
         (select c.id_conta from bpo_fin.contas c where c.id_org = o.id_org and c.instituicao = 'Asaas' and c.tipo = 'gateway' order by c.created_at limit 1) as id_asaas,
         (select c.id_conta from bpo_fin.contas c where c.id_org = o.id_org and c.instituicao = 'Legado' order by c.created_at limit 1) as id_legado
  from financeiro_seis.empresas fe
  join bpo_fin.entidades en on en.cnpj = regexp_replace(fe.cnpj, '\D', '', 'g')
  join bpo_fin.organizacoes o on o.id_org = en.id_org and o.tipo = 'casa';
  if not exists (select 1 from c_emp) then raise exception 'histórico ainda não importado: rode a importação, não o complemento'; end if;

  -- ── A. linhas novas do Asaas ──────────────────────────────────────────────────────────────
  create temp table c_asaas on commit drop as
  select ea.*, e.id_org, e.id_asaas as id_conta, gen_random_uuid() as id_movimento, false as consumido
  from financeiro_seis.extrato_asaas ea join c_emp e using (id_empresa)
  where ea.value <> 0 and ea.data_transacao <= p_ate
    and not exists (select 1 from bpo_fin.movimentos m where m.id_org = e.id_org and m.origem = 'asaas' and m.id_externo = ea.id_transacao);
  -- seq do hash: continua de onde os movimentos já existentes do mesmo dia/valor/descrição pararam
  insert into bpo_fin.movimentos (id_movimento, id_org, id_conta, origem, id_externo, hash_natural, data_movimento,
                                  valor, descricao_bruta, id_contraparte, payload_raw)
  select a.id_movimento, a.id_org, a.id_conta, 'asaas', a.id_transacao,
         bpo_fin.fn_hash_natural(a.id_conta, a.data_transacao, a.value, a.description,
           (select count(*) from bpo_fin.movimentos m where m.id_conta = a.id_conta and m.data_movimento = a.data_transacao and m.valor = a.value
                and bpo_fin.fn_normalizar_descricao(m.descricao_bruta) = bpo_fin.fn_normalizar_descricao(a.description))::int
           + (row_number() over (partition by a.id_conta, a.data_transacao, a.value, bpo_fin.fn_normalizar_descricao(a.description) order by a.id_transacao) - 1)::int),
         a.data_transacao, a.value, a.description,
         (select cp.id_contraparte from bpo_fin.contrapartes cp where cp.id_org = a.id_org and cp.origem_legado = a.id_entidade limit 1),
         jsonb_build_object('legado', 'financeiro_seis.extrato_asaas', 'id_categoria', a.id_categoria, 'tipo_evento', a.tipo_evento, 'complemento', true)
  from c_asaas a;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('A_movimentos_asaas_novos', v_n);

  -- ── manuais novos ─────────────────────────────────────────────────────────────────────────
  create temp table c_man on commit drop as
  select l.*, e.id_org, e.id_entidade as id_ent_org, gen_random_uuid() as id_titulo, null::uuid as id_movimento,
         financeiro_seis.fn_calcular_competencia(l.data_transacao, l.value, l.id_categoria, l.correcao_competencia) as comp_calc
  from financeiro_seis.lancamentos_manuais l join c_emp e using (id_empresa)
  where l.value <> 0 and l.data_transacao <= p_ate
    and not exists (select 1 from bpo_fin.titulos t where t.id_org = e.id_org and t.id_externo = 'manual:' || l.id_lancamento)
    and not exists (select 1 from bpo_fin.movimentos m where m.id_org = e.id_org and m.origem = 'legado'
                      and m.id_externo in (l.id_lancamento, 'sem_extrato:' || l.id_lancamento));

  -- B. outro banco, Pago → movimento na conta daquele banco (que já existe desde a importação)
  update c_man set id_movimento = gen_random_uuid()
   where banco <> 'Asaas' and status_titulo = 'Pago' and data_transacao <= current_date
     and exists (select 1 from bpo_fin.contas c where c.id_org = c_man.id_org and c.instituicao = c_man.banco);
  insert into bpo_fin.movimentos (id_movimento, id_org, id_conta, origem, id_externo, hash_natural, data_movimento,
                                  valor, descricao_bruta, id_contraparte, payload_raw)
  select m.id_movimento, m.id_org, ct.id_conta, 'legado', m.id_lancamento,
         bpo_fin.fn_hash_natural(ct.id_conta, m.data_transacao, m.value, coalesce(m.description, '') || '#' || m.id_lancamento, 0),
         m.data_transacao, m.value, coalesce(m.description, m.observacoes),
         (select cp.id_contraparte from bpo_fin.contrapartes cp where cp.id_org = m.id_org and cp.origem_legado = m.id_entidade limit 1),
         jsonb_build_object('legado', 'financeiro_seis.lancamentos_manuais', 'id_categoria', m.id_categoria, 'complemento', true)
  from c_man m join lateral (select c.id_conta from bpo_fin.contas c where c.id_org = m.id_org and c.instituicao = m.banco order by c.created_at limit 1) ct on true
  where m.id_movimento is not null;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('B_movimentos_outros_bancos', v_n);

  insert into bpo_fin.titulos (id_titulo, id_org, id_entidade, tipo, id_contraparte, descricao, valor, data_emissao,
                               data_vencimento, competencia, id_plano_conta, id_centro_custo, origem, id_externo, observacao)
  select m.id_titulo, m.id_org, m.id_ent_org, case when m.value > 0 then 'receber' else 'pagar' end,
         (select cp.id_contraparte from bpo_fin.contrapartes cp where cp.id_org = m.id_org and cp.origem_legado = m.id_entidade limit 1),
         coalesce(nullif(btrim(m.description), ''), nullif(btrim(m.observacoes), ''), pc.nome, 'Lançamento manual (legado)'),
         abs(m.value), m.data_transacao, m.data_transacao,
         coalesce(m.comp_calc, date_trunc('month', m.data_transacao)::date),
         pc.id_plano_conta,
         (select cc.id_centro_custo from bpo_fin.centros_custo cc join app_seis.produtos p on p.slug_produto = cc.codigo
           where cc.id_org = m.id_org and p.id_produto = m.id_produto limit 1),
         'legado', 'manual:' || m.id_lancamento,
         concat_ws('; ', case when m.comp_calc is null then 'competencia_presumida' end, 'complemento_31_10')
  from c_man m
  left join bpo_fin.plano_contas pc on pc.id_org = m.id_org and pc.codigo = m.id_categoria
  where coalesce(m.id_categoria, '') <> transf;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('titulos_manuais_novos', v_n);

  insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem)
  select m.id_org, m.id_titulo, m.id_movimento, abs(m.value), 'legado'
  from c_man m where m.id_movimento is not null and coalesce(m.id_categoria, '') <> transf;

  -- C. manual Asaas Pago ↔ linha Asaas NOVA de categoria excluída (até 5 dias); senão, movimento sintético no legado
  v_n := 0;
  for r in select m.id_titulo, m.id_empresa, m.id_org, m.value, m.data_transacao from c_man m
            where m.banco = 'Asaas' and m.status_titulo = 'Pago' and coalesce(m.id_categoria, '') <> transf
            order by m.data_transacao, m.id_lancamento loop
    select a.id_movimento into v_mov from c_asaas a
     where not a.consumido and a.id_empresa = r.id_empresa and a.value = r.value
       and a.id_categoria = any (excluidas) and abs(a.data_transacao - r.data_transacao) <= 5
     order by abs(a.data_transacao - r.data_transacao), a.id_transacao limit 1;
    if v_mov is not null then
      update c_asaas set consumido = true where id_movimento = v_mov;
      update c_man set id_movimento = v_mov where id_titulo = r.id_titulo;
      insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem) values (r.id_org, r.id_titulo, v_mov, abs(r.value), 'legado');
      v_n := v_n + 1;
    end if;
  end loop;
  v_res := v_res || jsonb_build_object('C_manual_asaas_com_pagamento', v_n);
  create temp table c_sem on commit drop as
  select m.*, gen_random_uuid() as id_mov_sint from c_man m
  where m.banco = 'Asaas' and m.status_titulo = 'Pago' and m.id_movimento is null and coalesce(m.id_categoria, '') <> transf;
  insert into bpo_fin.movimentos (id_movimento, id_org, id_conta, origem, id_externo, hash_natural, data_movimento, valor, descricao_bruta, payload_raw)
  select s.id_mov_sint, s.id_org, e.id_legado, 'legado', 'sem_extrato:' || s.id_lancamento,
         bpo_fin.fn_hash_natural(e.id_legado, s.data_transacao, s.value, 'sem_extrato:' || s.id_lancamento, 0),
         s.data_transacao, s.value, 'Sem pagamento correspondente no extrato Asaas: ' || coalesce(s.description, s.id_lancamento),
         jsonb_build_object('legado', 'financeiro_seis.lancamentos_manuais', 'motivo', 'sem_gemeo_no_extrato', 'complemento', true)
  from c_sem s join c_emp e on e.id_org = s.id_org;
  insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem)
  select s.id_org, s.id_titulo, s.id_mov_sint, abs(s.value), 'legado' from c_sem s;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('C_manual_asaas_SEM_extrato', v_n);

  -- D + E. linha Asaas nova, não consumida, com categoria e não transferência → título + baixa
  create temp table c_d on commit drop as
  select a.*, gen_random_uuid() as id_titulo_novo, (a.id_categoria = any (excluidas)) as caso_e
  from c_asaas a where not a.consumido and a.id_categoria is not null and a.id_categoria <> transf;
  insert into bpo_fin.titulos (id_titulo, id_org, id_entidade, tipo, id_contraparte, descricao, valor, data_emissao,
                               data_vencimento, competencia, id_plano_conta, id_centro_custo, origem, id_externo, observacao)
  select d.id_titulo_novo, d.id_org, e.id_entidade, case when d.value > 0 then 'receber' else 'pagar' end,
         (select cp.id_contraparte from bpo_fin.contrapartes cp where cp.id_org = d.id_org and cp.origem_legado = d.id_entidade limit 1),
         coalesce(nullif(btrim(d.description), ''), d.tipo_evento, 'Asaas (legado)'),
         abs(d.value), d.data_transacao, d.data_transacao,
         coalesce(financeiro_seis.fn_calcular_competencia(d.data_transacao, d.value, d.id_categoria, d.correcao_competencia),
                  date_trunc('month', d.data_transacao)::date),
         pc.id_plano_conta,
         (select cc.id_centro_custo from bpo_fin.centros_custo cc join app_seis.produtos p on p.slug_produto = cc.codigo
           where cc.id_org = d.id_org and p.id_produto = d.id_produto limit 1),
         'legado', 'asaas:' || d.id_transacao,
         concat_ws('; ',
           case when financeiro_seis.fn_calcular_competencia(d.data_transacao, d.value, d.id_categoria, d.correcao_competencia) is null
                then 'competencia_presumida' end,
           case when d.caso_e then 'fora_do_dre_no_financeiro_seis' end, 'complemento_31_10')
  from c_d d join c_emp e on e.id_org = d.id_org
  join bpo_fin.plano_contas pc on pc.id_org = d.id_org and pc.codigo = d.id_categoria;
  insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem)
  select d.id_org, d.id_titulo_novo, d.id_movimento, abs(d.value), 'legado' from c_d d
  where exists (select 1 from bpo_fin.titulos t where t.id_titulo = d.id_titulo_novo);
  v_res := v_res || jsonb_build_object('D_asaas_titulo_baixa', (select count(*) from c_d where not caso_e),
                                       'E_asaas_excluido_sem_manual', (select count(*) from c_d where caso_e));

  -- F. transferência nova: sem tentar parear (são poucas) → ignorada 'legado' com motivo; o analista pareia na tela se quiser
  insert into bpo_fin.movimentos_ignorados (id_org, id_movimento, categoria, motivo)
  select a.id_org, a.id_movimento, 'legado', 'Transferência entre contas importada do financeiro_seis (complemento de 31/10); pareie na Conciliação se a outra ponta estiver aqui'
  from c_asaas a where a.id_categoria = transf;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('F_transferencias_ignoradas', v_n);
  v_res := v_res || jsonb_build_object('H_asaas_sem_categoria', (select count(*) from c_asaas where id_categoria is null));

  -- ── já importado e ALTERADO lá ───────────────────────────────────────────────────────────
  -- categoria: recategoriza o título (o trigger de mês travado recusa se o mês estiver fechado → vai para o relatório)
  create temp table c_alt on commit drop as
  select t.id_titulo, t.id_org, e.org, ea.id_transacao as origem_id, ea.id_categoria as cat_nova, pc_atual.codigo as cat_atual,
         abs(ea.value) as valor_novo, t.valor as valor_atual, ea.data_transacao as data_nova, t.data_vencimento as data_atual
  from bpo_fin.titulos t
  join c_emp e on e.id_org = t.id_org
  join financeiro_seis.extrato_asaas ea on t.id_externo = 'asaas:' || ea.id_transacao and ea.id_empresa = e.id_empresa
  left join bpo_fin.plano_contas pc_atual on pc_atual.id_plano_conta = t.id_plano_conta
  where t.cancelado_em is null and ea.data_transacao <= p_ate
  union all
  select t.id_titulo, t.id_org, e.org, l.id_lancamento, l.id_categoria, pc_atual.codigo, abs(l.value), t.valor, l.data_transacao, t.data_vencimento
  from bpo_fin.titulos t
  join c_emp e on e.id_org = t.id_org
  join financeiro_seis.lancamentos_manuais l on t.id_externo = 'manual:' || l.id_lancamento and l.id_empresa = e.id_empresa
  left join bpo_fin.plano_contas pc_atual on pc_atual.id_plano_conta = t.id_plano_conta
  where t.cancelado_em is null and l.data_transacao <= p_ate;
  delete from c_alt where cat_nova is not distinct from cat_atual and valor_novo = valor_atual and data_nova = data_atual;

  v_n := 0;
  for r in select a.*, pc.id_plano_conta as id_pc_novo from c_alt a
             left join bpo_fin.plano_contas pc on pc.id_org = a.id_org and pc.codigo = a.cat_nova
            where a.cat_nova is distinct from a.cat_atual and a.cat_nova is not null and a.cat_nova <> transf loop
    begin
      update bpo_fin.titulos set id_plano_conta = r.id_pc_novo where id_titulo = r.id_titulo and r.id_pc_novo is not null;
      if found then v_n := v_n + 1; end if;
    exception when others then null;   -- mês travado etc.: fica no relatório abaixo
    end;
  end loop;
  v_res := v_res || jsonb_build_object('titulos_recategorizados', v_n);
  v_res := v_res || jsonb_build_object('alterados_para_revisar', coalesce((
    select jsonb_agg(jsonb_build_object('org', org, 'origem', origem_id, 'id_titulo', id_titulo,
             'valor', case when valor_novo <> valor_atual then jsonb_build_array(valor_atual, valor_novo) end,
             'data', case when data_nova <> data_atual then jsonb_build_array(data_atual, data_nova) end) order by org, data_nova)
    from c_alt where valor_novo <> valor_atual or data_nova <> data_atual), '[]'));

  -- resultado da conferência depois do complemento (meses até p_ate)
  v_res := v_res || jsonb_build_object('conferencia_nao_explicado', coalesce((
    select jsonb_object_agg(organizacao || ' ' || to_char(competencia, 'YYYY-MM'), nao_explicado)
    from bpo_fin.v_conferencia_dre_seis where nao_explicado <> 0 and competencia <= p_ate), '{}'));

  if not p_aplicar then
    raise exception using errcode = 'P0001', message = 'SIMULACAO', detail = v_res::text;
  end if;
  return v_res || jsonb_build_object('aplicado', true);
end $$;

-- Simulação legível: chama o complemento, captura o relatório e desfaz tudo (subtransação).
create function bpo_fin.fn_simular_complemento_seis(p_ate date default '2026-10-31') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_det text;
begin
  perform bpo_fin.fn_importar_complemento_seis(p_ate, false);
  return null;
exception when sqlstate 'P0001' then
  get stacked diagnostics v_det = pg_exception_detail;
  if v_det is null or v_det = '' then raise; end if;
  return v_det::jsonb || jsonb_build_object('simulacao', true);
end $$;

revoke execute on function bpo_fin.fn_importar_complemento_seis(date, boolean), bpo_fin.fn_simular_complemento_seis(date) from public;

commit;
