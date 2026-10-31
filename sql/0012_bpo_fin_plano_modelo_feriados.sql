-- 0012 · Plano de contas pela tela, modelo "Clínica médica" e feriados no prazo de fechamento.
-- Por quê:
--   · o cadastro (0011) cria a org com plano copiado, mas ajustar o plano ainda era por SQL;
--   · não havia nenhum modelo de plano em produção — cliente novo só copiava o plano da Seis (agência);
--   · o prazo das turmas ("Nº dia útil") contava só seg–sex: core_seis.dim_calendario NÃO marca feriado
--     (conferido em produção em 31/10/2026: zero dias de semana não úteis em 2026).
-- Regras do plano:
--   · criar/editar exige 'configurar_org'. Natureza não muda depois de criada (muda o sinal de tudo que já foi lançado).
--   · mudar a LINHA DO DRE de conta com título em mês FECHADO/LIBERADO é recusado: o DRE vivo daquele mês deixaria
--     de bater com o snapshot que o cliente viu. Renomear e desativar podem sempre.
--   · desativar tira a conta dos seletores; o que já foi lançado nela continua. Grupo com filha ativa não desativa.
-- Feriados: nacionais e bancários (Carnaval, Sexta-feira Santa e Corpus Christi incluídos — banco não compensa).
-- Municipais ficam de fora por ora (a org não tem município cadastrado).
begin;

-- ─── feriados e dia útil ─────────────────────────────────────────────────────────────────
create table bpo_fin.feriados (
  data  date primary key,
  nome  text not null
);
alter table bpo_fin.feriados enable row level security;
create policy ler_dominio on bpo_fin.feriados for select to authenticated using (true);
grant select on bpo_fin.feriados to authenticated;

insert into bpo_fin.feriados (data, nome) values
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-02-16', 'Carnaval (segunda)'),
  ('2026-02-17', 'Carnaval (terça)'),
  ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-06-04', 'Corpus Christi'),
  ('2026-09-07', 'Independência'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-02-08', 'Carnaval (segunda)'),
  ('2027-02-09', 'Carnaval (terça)'),
  ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-05-27', 'Corpus Christi'),
  ('2027-09-07', 'Independência'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2027-12-25', 'Natal'),
  ('2028-01-01', 'Confraternização Universal'),
  ('2028-02-28', 'Carnaval (segunda)'),
  ('2028-02-29', 'Carnaval (terça)'),
  ('2028-04-14', 'Sexta-feira Santa'),
  ('2028-04-21', 'Tiradentes'),
  ('2028-05-01', 'Dia do Trabalho'),
  ('2028-06-15', 'Corpus Christi'),
  ('2028-09-07', 'Independência'),
  ('2028-10-12', 'Nossa Senhora Aparecida'),
  ('2028-11-02', 'Finados'),
  ('2028-11-15', 'Proclamação da República'),
  ('2028-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2028-12-25', 'Natal'),
  ('2029-01-01', 'Confraternização Universal'),
  ('2029-02-12', 'Carnaval (segunda)'),
  ('2029-02-13', 'Carnaval (terça)'),
  ('2029-03-30', 'Sexta-feira Santa'),
  ('2029-04-21', 'Tiradentes'),
  ('2029-05-01', 'Dia do Trabalho'),
  ('2029-05-31', 'Corpus Christi'),
  ('2029-09-07', 'Independência'),
  ('2029-10-12', 'Nossa Senhora Aparecida'),
  ('2029-11-02', 'Finados'),
  ('2029-11-15', 'Proclamação da República'),
  ('2029-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2029-12-25', 'Natal'),
  ('2030-01-01', 'Confraternização Universal'),
  ('2030-03-04', 'Carnaval (segunda)'),
  ('2030-03-05', 'Carnaval (terça)'),
  ('2030-04-19', 'Sexta-feira Santa'),
  ('2030-04-21', 'Tiradentes'),
  ('2030-05-01', 'Dia do Trabalho'),
  ('2030-06-20', 'Corpus Christi'),
  ('2030-09-07', 'Independência'),
  ('2030-10-12', 'Nossa Senhora Aparecida'),
  ('2030-11-02', 'Finados'),
  ('2030-11-15', 'Proclamação da República'),
  ('2030-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2030-12-25', 'Natal');

-- N-ésimo dia útil (seg–sex, fora feriado) do mês seguinte à competência — o prazo da turma.
create function bpo_fin.fn_prazo_fechamento(p_competencia date, p_dia_util int) returns date
language sql stable set search_path = '' as $$
  select d::date from generate_series((date_trunc('month', p_competencia) + interval '1 month')::date,
                                      (date_trunc('month', p_competencia) + interval '2 months - 1 day')::date, interval '1 day') d
  where extract(isodow from d) < 6 and not exists (select 1 from bpo_fin.feriados f where f.data = d::date)
  order by d offset greatest(p_dia_util, 1) - 1 limit 1
$$;
grant execute on function bpo_fin.fn_prazo_fechamento(date, int) to authenticated;

-- ─── plano de contas pela tela ────────────────────────────────────────────────────────────
create function bpo_fin.fn_linha_dre_valida(p_linha text) returns boolean
language sql immutable set search_path = '' as $$
  -- DESPESAS_FIXAS (sem _OUTRAS) é apelido aceito pelo DRE (packages/shared/src/demonstrativos.ts)
  select p_linha is null or p_linha in ('RECEITA_BRUTA', 'DEDUCOES', 'CUSTOS_VARIAVEIS', 'FOLHA', 'DESPESAS_FIXAS_OUTRAS', 'DESPESAS_FIXAS',
    'INVEST_CRESCIMENTO', 'RECEITAS_FINANCEIRAS', 'DESPESAS_FINANCEIRAS', 'IMPOSTO_LUCRO')
$$;

create function bpo_fin.fn_criar_plano_conta(p_id_org uuid, p_codigo text, p_nome text, p_id_pai uuid, p_natureza text,
  p_linha_dre text, p_grupo_dfc text, p_regra text, p_generica boolean, p_sensivel boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_grupo boolean := p_natureza = 'grupo';
begin
  perform bpo_fin.fn_exigir(p_id_org, 'configurar_org');
  if p_codigo is null or p_codigo !~ '^[A-Z0-9_.-]{2,60}$' then raise exception 'código: 2 a 60 letras maiúsculas, números, _ . -'; end if;
  if p_nome is null or length(btrim(p_nome)) < 2 then raise exception 'nome obrigatório'; end if;
  if not bpo_fin.fn_linha_dre_valida(p_linha_dre) then raise exception 'linha do DRE inválida'; end if;
  if v_grupo and p_linha_dre is not null then raise exception 'grupo não tem linha no DRE (as contas dentro dele têm)'; end if;
  if p_natureza in ('transferencia', 'retirada', 'aplicacao') and p_linha_dre is not null then raise exception 'transferência, retirada e aplicação não entram no DRE'; end if;
  if p_id_pai is not null and not exists (select 1 from bpo_fin.plano_contas where id_plano_conta = p_id_pai and id_org = p_id_org and natureza = 'grupo') then
    raise exception 'o pai precisa ser um grupo desta organização';
  end if;
  insert into bpo_fin.plano_contas (id_org, codigo, nome, id_pai, natureza, aceita_lancamento, entra_dre, entra_dfc, grupo_dfc,
                                    linha_dre, regra_competencia, generica, sensivel)
  values (p_id_org, p_codigo, btrim(p_nome), p_id_pai, p_natureza, not v_grupo, p_linha_dre is not null,
          not v_grupo and p_natureza <> 'transferencia',
          case when v_grupo or p_natureza = 'transferencia' then null else coalesce(p_grupo_dfc, 'operacional') end,
          p_linha_dre, coalesce(p_regra, 'mes_corrente'), coalesce(p_generica, false), coalesce(p_sensivel, false))
  returning id_plano_conta into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'já existe conta com o código %', p_codigo;
end $$;

create function bpo_fin.fn_editar_plano_conta(p_id uuid, p_nome text, p_id_pai uuid, p_linha_dre text, p_grupo_dfc text,
  p_regra text, p_generica boolean, p_sensivel boolean, p_ativa boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v bpo_fin.plano_contas%rowtype;
begin
  select * into v from bpo_fin.plano_contas where id_plano_conta = p_id and id_org is not null;
  if not found then raise exception 'conta do plano não encontrada'; end if;
  perform bpo_fin.fn_exigir(v.id_org, 'configurar_org');
  if p_nome is null or length(btrim(p_nome)) < 2 then raise exception 'nome obrigatório'; end if;
  if not bpo_fin.fn_linha_dre_valida(p_linha_dre) then raise exception 'linha do DRE inválida'; end if;
  if v.natureza = 'grupo' and p_linha_dre is not null then raise exception 'grupo não tem linha no DRE'; end if;
  if v.natureza in ('transferencia', 'retirada', 'aplicacao') and p_linha_dre is not null then raise exception 'transferência, retirada e aplicação não entram no DRE'; end if;
  if p_id_pai is not null and (p_id_pai = p_id or not exists (select 1 from bpo_fin.plano_contas where id_plano_conta = p_id_pai and id_org = v.id_org and natureza = 'grupo')) then
    raise exception 'o pai precisa ser outro grupo desta organização';
  end if;
  if p_linha_dre is distinct from v.linha_dre and exists (
       select 1 from bpo_fin.titulos t join bpo_fin.fechamento_mensal f on f.id_org = t.id_org and f.competencia = t.competencia
       where t.id_plano_conta = p_id and t.cancelado_em is null and f.status in ('fechado', 'liberado')) then
    raise exception 'esta conta tem lançamento em mês fechado: mudar a linha do DRE mudaria um resultado já entregue. Reabra o mês ou crie uma conta nova';
  end if;
  if not p_ativa and v.natureza = 'grupo' and exists (select 1 from bpo_fin.plano_contas where id_pai = p_id and ativa) then
    raise exception 'grupo com conta ativa dentro: desative as contas antes';
  end if;
  update bpo_fin.plano_contas set nome = btrim(p_nome), id_pai = p_id_pai, linha_dre = p_linha_dre, entra_dre = p_linha_dre is not null,
         grupo_dfc = case when entra_dfc then coalesce(p_grupo_dfc, grupo_dfc, 'operacional') else null end,
         regra_competencia = coalesce(p_regra, regra_competencia), generica = coalesce(p_generica, generica),
         sensivel = coalesce(p_sensivel, sensivel), ativa = p_ativa
   where id_plano_conta = p_id;
end $$;

revoke execute on function bpo_fin.fn_linha_dre_valida(text),
  bpo_fin.fn_criar_plano_conta(uuid, text, text, uuid, text, text, text, text, boolean, boolean),
  bpo_fin.fn_editar_plano_conta(uuid, text, uuid, text, text, text, boolean, boolean, boolean) from public;
grant execute on function bpo_fin.fn_criar_plano_conta(uuid, text, text, uuid, text, text, text, text, boolean, boolean),
  bpo_fin.fn_editar_plano_conta(uuid, text, uuid, text, text, text, boolean, boolean, boolean) to authenticated;

-- ─── modelo "Clínica médica" ────────────────────────────────────────────────────────────────
-- Mesma estrutura do plano da Seis (G_MACRO_* → CAT_*), com as contas de uma clínica. Convênio e repasse
-- médico usam competência do mês ANTERIOR ao pagamento (o convênio paga o atendimento ~30 dias depois).
insert into bpo_fin.plano_contas_modelos (nome, descricao)
values ('Clínica médica', 'Consultório/clínica: particular, convênio e procedimentos; DRE no padrão Vesso.');

with m as (select id_modelo from bpo_fin.plano_contas_modelos where nome = 'Clínica médica'),
grupos (codigo, nome) as (values
  ('G_MACRO_RECEITA', 'Receita'), ('G_MACRO_DESCONTOS_ESTORNOS', 'Descontos, glosas e estornos'),
  ('G_MACRO_CUSTOS_VARIAVEIS', 'Custos variáveis'), ('G_MACRO_PESSOAL', 'Pessoal'),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'Despesas fixas operacionais'), ('G_MACRO_INVESTIMENTOS_CRESCIMENTO', 'Investimentos / crescimento'),
  ('G_MACRO_RECEITAS_FINANCEIRAS', 'Receitas financeiras'), ('G_MACRO_DESPESAS_FINANCEIRAS', 'Despesas financeiras'),
  ('G_MACRO_IMPOSTOS_LUCRO_FATURAMENTO', 'Impostos sobre faturamento / lucro'),
  ('G_MACRO_RETIRADA_LUCRO_SOCIO', 'Retiradas do sócio'), ('G_MACRO_MOVIMENTACOES_INTERNAS', 'Movimentações internas'))
insert into bpo_fin.plano_contas (id_modelo, codigo, nome, natureza, aceita_lancamento, entra_dre, entra_dfc)
select m.id_modelo, g.codigo, g.nome, 'grupo', false, false, false from m, grupos g;

with m as (select id_modelo from bpo_fin.plano_contas_modelos where nome = 'Clínica médica'),
contas (pai, codigo, nome, natureza, linha, dfc, regra, generica, sensivel) as (values
  ('G_MACRO_RECEITA', 'CAT_CONSULTAS_PARTICULARES', 'Consultas particulares', 'receita', 'RECEITA_BRUTA', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_RECEITA', 'CAT_PROCEDIMENTOS_PARTICULARES', 'Procedimentos particulares', 'receita', 'RECEITA_BRUTA', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_RECEITA', 'CAT_CIRURGIAS', 'Cirurgias', 'receita', 'RECEITA_BRUTA', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_RECEITA', 'CAT_EXAMES', 'Exames', 'receita', 'RECEITA_BRUTA', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_RECEITA', 'CAT_CONVENIOS', 'Convênios', 'receita', 'RECEITA_BRUTA', 'operacional', 'mes_anterior', false, false),
  ('G_MACRO_RECEITA', 'CAT_OUTRAS_RECEITAS', 'Outras receitas', 'receita', 'RECEITA_BRUTA', 'operacional', 'manual', true, false),
  ('G_MACRO_DESCONTOS_ESTORNOS', 'CAT_DESCONTOS_CONCEDIDOS', 'Descontos concedidos', 'deducao', 'DEDUCOES', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESCONTOS_ESTORNOS', 'CAT_GLOSAS_CONVENIO', 'Glosas de convênio', 'deducao', 'DEDUCOES', 'operacional', 'mes_anterior', false, false),
  ('G_MACRO_DESCONTOS_ESTORNOS', 'CAT_ESTORNOS', 'Estornos e chargebacks', 'deducao', 'DEDUCOES', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_CUSTOS_VARIAVEIS', 'CAT_MATERIAIS_E_MEDICAMENTOS', 'Materiais e medicamentos', 'custo', 'CUSTOS_VARIAVEIS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_CUSTOS_VARIAVEIS', 'CAT_REPASSE_MEDICOS', 'Repasse a médicos parceiros', 'custo', 'CUSTOS_VARIAVEIS', 'operacional', 'mes_anterior', false, true),
  ('G_MACRO_CUSTOS_VARIAVEIS', 'CAT_LABORATORIO_TERCEIRIZADO', 'Laboratório e exames terceirizados', 'custo', 'CUSTOS_VARIAVEIS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_CUSTOS_VARIAVEIS', 'CAT_COMISSOES_E_INDICACOES', 'Comissões e indicações', 'custo', 'CUSTOS_VARIAVEIS', 'operacional', 'mes_anterior', false, false),
  ('G_MACRO_CUSTOS_VARIAVEIS', 'CAT_OUTROS_CUSTOS_DIRETOS', 'Outros custos diretos', 'custo', 'CUSTOS_VARIAVEIS', 'operacional', 'manual', true, false),
  ('G_MACRO_PESSOAL', 'CAT_PESSOAL_FOLHA_DE_PAGAMENTO', 'Folha de pagamento (equipe)', 'despesa', 'FOLHA', 'operacional', 'mes_anterior', false, true),
  ('G_MACRO_PESSOAL', 'CAT_PRO_LABORE', 'Pró-labore', 'despesa', 'FOLHA', 'operacional', 'mes_anterior', false, true),
  ('G_MACRO_PESSOAL', 'CAT_ENCARGOS_E_BENEFICIOS', 'Encargos e benefícios', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_anterior', false, true),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_ALUGUEL_E_CONDOMINIO', 'Aluguel e condomínio', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_UTILIDADES', 'Energia, água, internet e telefone', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_anterior', false, false),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_CONTABILIDADE_E_JURIDICO', 'Contabilidade e jurídico', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_SOFTWARES_E_SISTEMAS', 'Softwares (prontuário, agenda)', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_MANUTENCAO_EQUIPAMENTOS', 'Manutenção de equipamentos', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_LIMPEZA_E_CONSERVACAO', 'Limpeza, lavanderia e conservação', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_CONSELHOS_LICENCAS_TAXAS', 'Conselho, alvarás e licenças', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_SEGUROS', 'Seguros', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FIXAS_OP', 'CAT_OUTROS_CUSTOS_FIXOS', 'Outros custos fixos', 'despesa', 'DESPESAS_FIXAS_OUTRAS', 'operacional', 'manual', true, false),
  ('G_MACRO_INVESTIMENTOS_CRESCIMENTO', 'CAT_MARKETING_E_TRAFEGO', 'Marketing e tráfego pago', 'investimento', 'INVEST_CRESCIMENTO', 'investimento', 'mes_corrente', false, false),
  ('G_MACRO_INVESTIMENTOS_CRESCIMENTO', 'CAT_EQUIPAMENTOS_MEDICOS', 'Equipamentos médicos', 'investimento', 'INVEST_CRESCIMENTO', 'investimento', 'mes_corrente', false, false),
  ('G_MACRO_INVESTIMENTOS_CRESCIMENTO', 'CAT_REFORMAS_E_INSTALACOES', 'Reformas e instalações', 'investimento', 'INVEST_CRESCIMENTO', 'investimento', 'mes_corrente', false, false),
  ('G_MACRO_INVESTIMENTOS_CRESCIMENTO', 'CAT_CURSOS_E_CONGRESSOS', 'Cursos e congressos', 'investimento', 'INVEST_CRESCIMENTO', 'investimento', 'mes_corrente', false, false),
  ('G_MACRO_RECEITAS_FINANCEIRAS', 'CAT_RECEITAS_FINANCEIRAS', 'Rendimentos e juros recebidos', 'financeira_receita', 'RECEITAS_FINANCEIRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FINANCEIRAS', 'CAT_TAXAS_CARTAO_E_MAQUININHA', 'Taxas de cartão e maquininha', 'financeira_despesa', 'DESPESAS_FINANCEIRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FINANCEIRAS', 'CAT_TAXAS_BANCARIAS', 'Tarifas bancárias', 'financeira_despesa', 'DESPESAS_FINANCEIRAS', 'operacional', 'mes_corrente', false, false),
  ('G_MACRO_DESPESAS_FINANCEIRAS', 'CAT_JUROS_E_MULTAS', 'Juros e multas', 'financeira_despesa', 'DESPESAS_FINANCEIRAS', 'operacional', 'mes_anterior', false, false),
  ('G_MACRO_DESPESAS_FINANCEIRAS', 'CAT_OUTROS_FINANCEIROS', 'Outros (financeiros)', 'financeira_despesa', 'DESPESAS_FINANCEIRAS', 'operacional', 'manual', true, false),
  ('G_MACRO_IMPOSTOS_LUCRO_FATURAMENTO', 'CAT_IMPOSTOS_SOBRE_FATURAMENTO', 'Impostos (Simples, ISS, IRPJ/CSLL)', 'imposto', 'IMPOSTO_LUCRO', 'operacional', 'mes_anterior', false, false),
  ('G_MACRO_RETIRADA_LUCRO_SOCIO', 'CAT_RETIRADA_DE_LUCRO_SOCIO', 'Distribuição de lucro ao sócio', 'retirada', null, 'financiamento', 'mes_corrente', false, true),
  ('G_MACRO_RETIRADA_LUCRO_SOCIO', 'CAT_DESPESAS_PESSOAIS_SOCIO', 'Despesas pessoais do sócio', 'retirada', null, 'financiamento', 'mes_corrente', false, true),
  ('G_MACRO_MOVIMENTACOES_INTERNAS', 'CAT_APLICACOES_FINANCEIRAS', 'Aplicações financeiras', 'aplicacao', null, 'investimento', 'mes_corrente', false, false),
  ('G_MACRO_MOVIMENTACOES_INTERNAS', 'CAT_TRANSFERENCIAS_ENTRE_CONTAS', 'Transferências entre contas', 'transferencia', null, null, 'mes_corrente', false, false))
insert into bpo_fin.plano_contas (id_modelo, id_pai, codigo, nome, natureza, aceita_lancamento, entra_dre, entra_dfc, grupo_dfc,
                                  linha_dre, regra_competencia, generica, sensivel)
select m.id_modelo, g.id_plano_conta, c.codigo, c.nome, c.natureza, true, c.linha is not null, c.natureza <> 'transferencia', c.dfc,
       c.linha, c.regra, c.generica, c.sensivel
from m cross join contas c
join bpo_fin.plano_contas g on g.id_modelo = m.id_modelo and g.codigo = c.pai;

commit;
