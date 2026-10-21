-- Réplica mínima do financeiro_seis com as definições REAIS de fn_calcular_competencia,
-- v_tabela_fato, v_dre_seis e v_dre_agg (copiadas do banco em 21/10/2026).
create table app_seis.produtos (id_produto uuid primary key, nome_produto text, slug_produto text);
insert into app_seis.produtos values
  ('5bcafa90-bf90-4a00-b744-54e5baa0012d', 'Tráfego Pago', 'trafego-pago'),
  ('94c8fb16-0d6d-4962-a179-22eb332cb2cd', 'BPO Comercial', 'bpo-comercial');

create schema financeiro_seis;
create table financeiro_seis.empresas (id_empresa uuid primary key, nome text, razao_social text, cnpj text, ativa boolean, id_produto uuid);
create table financeiro_seis.categorias_macro (id_categoria_macro text primary key, categoria_macro text, ordem_dre int);
create table financeiro_seis.categorias (id_categoria text primary key, categoria text, id_categoria_macro text, competencia_categoria text);
create table financeiro_seis.cadastro_entidades (id_entidade text primary key, razao_social text, nome_fantasia text, cpf_cnpj text,
  eh_cliente boolean, eh_fornecedor boolean, id_empresa uuid, id_categoria_padrao text);
create table financeiro_seis.extrato_asaas (id_transacao text primary key, id_empresa uuid, id_entidade text, data_transacao date,
  value numeric, tipo_evento text, description text, id_categoria text, correcao_competencia date, id_produto uuid);
create table financeiro_seis.lancamentos_manuais (id_lancamento text primary key, id_empresa uuid, id_entidade text, id_categoria text,
  data_transacao date, value numeric, banco text, status_titulo text, correcao_competencia date, description text,
  observacoes text, id_transacao_asaas text, id_produto uuid);

CREATE FUNCTION financeiro_seis.fn_calcular_competencia(p_data_transacao date, p_value numeric, p_id_categoria text, p_correcao_competencia date)
 RETURNS date LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE v_competencia_categoria text;
BEGIN
  IF p_correcao_competencia IS NOT NULL THEN RETURN date_trunc('month', p_correcao_competencia)::date; END IF;
  IF p_value > 0 AND p_id_categoria = 'CAT_PAGAMENTO_VARIAVEL' THEN RETURN (date_trunc('month', p_data_transacao) - INTERVAL '1 month')::date; END IF;
  IF p_value > 0 THEN RETURN date_trunc('month', p_data_transacao)::date; END IF;
  SELECT competencia_categoria INTO v_competencia_categoria FROM financeiro_seis.categorias WHERE id_categoria = p_id_categoria;
  IF v_competencia_categoria = 'Despesa do Mês Corrente' THEN RETURN date_trunc('month', p_data_transacao)::date; END IF;
  IF v_competencia_categoria = 'Despesa do Mês Anterior' THEN RETURN (date_trunc('month', p_data_transacao) - INTERVAL '1 month')::date; END IF;
  RETURN NULL;
END; $function$;

create view financeiro_seis.v_tabela_fato as
 SELECT ea.id_transacao, 'extrato_asaas'::text AS tabela_origem, ea.data_transacao,
    financeiro_seis.fn_calcular_competencia(ea.data_transacao, ea.value, ea.id_categoria, ea.correcao_competencia) AS regime_competencia,
    CASE WHEN ea.value > 0 THEN 'Crédito' ELSE 'Débito' END AS direcao,
    ea.id_categoria, cat.categoria, cm.categoria_macro, ea.value, 'Real'::text AS projecao, ea.id_produto, ea.id_empresa
   FROM financeiro_seis.extrato_asaas ea
     LEFT JOIN financeiro_seis.categorias cat ON cat.id_categoria = ea.id_categoria
     LEFT JOIN financeiro_seis.categorias_macro cm ON cm.id_categoria_macro = cat.id_categoria_macro
  WHERE ea.id_categoria IS NULL OR (ea.id_categoria <> ALL (ARRAY['CAT_TRANSFERENCIAS_ENTRE_CONTAS','CAT_PAGAMENTO_VARIAVEL','CAT_RETIRADA_DE_LUCRO_SOCIO','CAT_IMPOSTOS_E_TRIBUTOS','CAT_ENCARGOS_E_BENEFICIOS']))
UNION ALL
 SELECT lm.id_lancamento, 'lancamentos_manuais', lm.data_transacao,
    financeiro_seis.fn_calcular_competencia(lm.data_transacao, lm.value, lm.id_categoria, lm.correcao_competencia),
    CASE WHEN lm.value > 0 THEN 'Crédito' ELSE 'Débito' END,
    lm.id_categoria, cat.categoria, cm.categoria_macro, lm.value, 'Real', lm.id_produto, lm.id_empresa
   FROM financeiro_seis.lancamentos_manuais lm
     LEFT JOIN financeiro_seis.categorias cat ON cat.id_categoria = lm.id_categoria
     LEFT JOIN financeiro_seis.categorias_macro cm ON cm.id_categoria_macro = cat.id_categoria_macro;

create view financeiro_seis.v_dre_seis as
 SELECT regime_competencia AS competencia, value, projecao, id_produto,
   CASE WHEN id_categoria IS NULL THEN 'NAO_CATEGORIZADO'
        WHEN categoria_macro = 'Receita' AND direcao = 'Crédito' THEN 'RECEITA_BRUTA'
        WHEN categoria_macro = 'Receita' AND direcao = 'Débito' THEN 'DEDUCOES'
        WHEN categoria_macro = 'Descontos e Estornos' THEN 'DEDUCOES'
        WHEN categoria_macro = 'Custos Variáveis' THEN 'CUSTOS_VARIAVEIS'
        WHEN id_categoria = 'CAT_PESSOAL_FOLHA_DE_PAGAMENTO' THEN 'FOLHA'
        WHEN categoria_macro = 'Despesas Fixas Operacionais' THEN 'DESPESAS_FIXAS_OUTRAS'
        WHEN categoria_macro = 'Investimentos/Crescimento' THEN 'INVEST_CRESCIMENTO'
        WHEN categoria_macro = 'Receitas Financeiras' THEN 'RECEITAS_FINANCEIRAS'
        WHEN categoria_macro = 'Despesas Financeiras' THEN 'DESPESAS_FINANCEIRAS'
        WHEN categoria_macro = 'Impostos sobre Lucro / Faturamento' THEN 'IMPOSTO_LUCRO' END AS linha_dre
   FROM financeiro_seis.v_tabela_fato vtf
  WHERE id_categoria IS NULL OR (categoria_macro <> ALL (ARRAY['Movimentações Internas', 'Retirada de Lucro - Sócio']));
create view financeiro_seis.v_dre_agg as
 SELECT competencia, projecao, linha_dre, id_produto, sum(value) AS value, count(*) AS qtd_transacoes
   FROM financeiro_seis.v_dre_seis WHERE linha_dre IS NOT NULL GROUP BY competencia, projecao, linha_dre, id_produto;

-- domínio (subconjunto real)
insert into financeiro_seis.categorias_macro values
  ('MAC_REC','Receita',7),('MAC_FIX','Despesas Fixas Operacionais',4),('MAC_IMP','Impostos sobre Lucro / Faturamento',1),
  ('MAC_FIN','Despesas Financeiras',2),('MAC_INT','Movimentações Internas',null),('MAC_RET','Retirada de Lucro - Sócio',null);
insert into financeiro_seis.categorias values
  ('CAT_PAGAMENTO_DE_RECORRENCIA','Pagamento de Recorrência','MAC_REC','Despesa do Mês Corrente'),
  ('CAT_PAGAMENTO_VARIAVEL','Pagamento Variável','MAC_REC','Despesa do Mês Anterior'),
  ('CAT_PESSOAL_FOLHA_DE_PAGAMENTO','Pessoal / Folha','MAC_FIX','Despesa do Mês Anterior'),
  ('CAT_ENCARGOS_E_BENEFICIOS','Encargos e Benefícios','MAC_FIX','Despesa do Mês Anterior'),
  ('CAT_SOFTWARES_ADMINISTRATIVOS','Softwares','MAC_FIX','Despesa do Mês Corrente'),
  ('CAT_OUTROS_CUSTOS_FIXOS','Outros Custos Fixos','MAC_FIX','Preencher Manualmente'),
  ('CAT_IMPOSTOS_E_TRIBUTOS','Impostos e Tributos','MAC_IMP','Despesa do Mês Anterior'),
  ('CAT_TAXAS_BANCARIAS_GATEWAY','Taxas Bancárias / Gateway','MAC_FIN','Despesa do Mês Corrente'),
  ('CAT_TRANSFERENCIAS_ENTRE_CONTAS','Transferências entre Contas','MAC_INT',null),
  ('CAT_RETIRADA_DE_LUCRO_SOCIO','Retirada de Lucro - Sócio','MAC_RET','Despesa do Mês Corrente');
insert into financeiro_seis.empresas values
  ('5dd1e25a-ffa6-4a5e-8e58-e021e983cea5','Seis Marketing','Agência Seis e Marketing LTDA','40.724.592/0001-09',true,'5bcafa90-bf90-4a00-b744-54e5baa0012d'),
  ('1faaa84a-c92e-4bc5-8cd0-6cff0bba1562','Task SV','Task SV','58.607.550/0001-53',true,'94c8fb16-0d6d-4962-a179-22eb332cb2cd');
insert into financeiro_seis.cadastro_entidades values
  ('ENT_CLI1','Dra. Cliente','Dra.','12.345.678/0001-90',true,false,'5dd1e25a-ffa6-4a5e-8e58-e021e983cea5','CAT_PAGAMENTO_DE_RECORRENCIA'),
  ('ENT_CLI1_TASK','Dra. Cliente','Dra.','12.345.678/0001-90',true,false,'1faaa84a-c92e-4bc5-8cd0-6cff0bba1562',null),
  ('ENT_RF','Receita Federal',null,null,false,true,'5dd1e25a-ffa6-4a5e-8e58-e021e983cea5',null);

-- casos (Seis Marketing = S, Task SV = T)
\set S '''5dd1e25a-ffa6-4a5e-8e58-e021e983cea5'''
\set T '''1faaa84a-c92e-4bc5-8cd0-6cff0bba1562'''
\set TR '''5bcafa90-bf90-4a00-b744-54e5baa0012d'''
insert into financeiro_seis.extrato_asaas values
  ('A1', :S, 'ENT_CLI1', '2026-09-05',  4000, 'PAYMENT_RECEIVED', 'Mensalidade', 'CAT_PAGAMENTO_DE_RECORRENCIA', null, :TR),  -- D
  ('A2', :S, null,       '2026-09-05',    -2, 'PAYMENT_FEE',      'Taxa',        'CAT_TAXAS_BANCARIAS_GATEWAY', null, :TR),   -- D
  ('A3', :S, null,       '2026-09-05',    -2, 'PAYMENT_FEE',      'Taxa',        'CAT_TAXAS_BANCARIAS_GATEWAY', null, :TR),   -- D, mesma linha → seq 1
  ('A4', :S, 'ENT_RF',   '2026-09-20', -1500, 'TRANSFER',         'PIX MINISTERIO DA FAZENDA', 'CAT_ENCARGOS_E_BENEFICIOS', null, :TR), -- C (gêmeo do M1, categoria diferente)
  ('A5', :S, 'ENT_RF',   '2026-09-21',  -380, 'TRANSFER',         'PIX MINISTERIO DA FAZENDA', 'CAT_ENCARGOS_E_BENEFICIOS', null, :TR), -- E (sem manual)
  ('A6', :S, null,       '2026-09-25', -1000, 'TRANSFER',         'Transf p/ Nubank', 'CAT_TRANSFERENCIAS_ENTRE_CONTAS', null, :TR), -- F par com M4
  ('A7', :S, null,       '2026-09-26',  -999, 'TRANSFER',         'Transf p/ conta X', 'CAT_TRANSFERENCIAS_ENTRE_CONTAS', null, :TR), -- F sem par
  ('A8', :S, null,       '2026-09-27',   -50, 'OUTRO',            'Sem categoria', null, null, :TR),                                  -- H
  ('A9', :S, null,       '2026-09-28',  -800, 'TRANSFER',         'Retirada',    'CAT_RETIRADA_DE_LUCRO_SOCIO', null, :TR),         -- E (fora do DRE nos dois)
  ('A10',:S, null,       '2026-09-29',  -120, 'BILL_PAYMENT',     'Serviço avulso', 'CAT_OUTROS_CUSTOS_FIXOS', null, :TR),          -- D + I
  ('A11',:T, 'ENT_CLI1_TASK','2026-09-10', 900, 'PAYMENT_RECEIVED','Variável', 'CAT_PAGAMENTO_VARIAVEL', null, '94c8fb16-0d6d-4962-a179-22eb332cb2cd'); -- C com M5
insert into financeiro_seis.lancamentos_manuais values
  ('M1', :S, 'ENT_RF', 'CAT_IMPOSTOS_E_TRIBUTOS', '2026-09-20', -1500, 'Asaas', 'Pago', null, 'DAS ago/26', null, null, :TR),        -- C
  ('M2', :S, null, 'CAT_PESSOAL_FOLHA_DE_PAGAMENTO', '2026-09-05', -6000, 'Asaas', 'Pago', null, 'Folha ago/26', null, null, :TR),   -- C' sem extrato
  ('M3', :S, null, 'CAT_SOFTWARES_ADMINISTRATIVOS', '2026-09-08', -300, 'Nubank', 'Pago', null, 'Software', null, null, :TR),        -- B
  ('M4', :S, null, 'CAT_TRANSFERENCIAS_ENTRE_CONTAS', '2026-09-25', 1000, 'Nubank', 'Pago', null, 'Transf do Asaas', null, null, :TR), -- F
  ('M5', :T, 'ENT_CLI1_TASK', 'CAT_PAGAMENTO_VARIAVEL', '2026-09-10', 900, 'Asaas', 'Pago', null, 'Variável ago', null, null, '94c8fb16-0d6d-4962-a179-22eb332cb2cd'), -- C
  ('M6', :S, null, 'CAT_SOFTWARES_ADMINISTRATIVOS', '2026-12-10', -450, 'Asaas', 'Em Aberto', null, 'Renovação anual', null, null, :TR); -- G
