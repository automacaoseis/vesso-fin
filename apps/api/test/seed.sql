-- Dados do teste da API: cópia da seção 'dados' de test/10_testes_nucleo.sql (sem as ações).
-- dados ───────────────────────────────────────────────────────────────────────────────
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000d0', 'dono@x'),
  ('00000000-0000-0000-0000-0000000000a1', 'analista@x'),
  ('00000000-0000-0000-0000-0000000000a2', 'revisor@x'),
  ('00000000-0000-0000-0000-0000000000b1', 'head@x'),
  ('00000000-0000-0000-0000-0000000000c1', 'gestor_trafego@x');
insert into app_seis.clientes values
  ('10000000-0000-0000-0000-000000000001', 'Dra. X'), ('10000000-0000-0000-0000-000000000002', 'Dr. Y');
insert into bpo_fin.donos (user_auth_id) values ('00000000-0000-0000-0000-0000000000d0');
insert into bpo_fin.organizacoes (id_org, nome, tipo, id_cliente, status, competencia_inicial) values
  ('20000000-0000-0000-0000-00000000000a', 'Agência Seis', 'casa', null, 'ativa', '2026-09-01'),
  ('20000000-0000-0000-0000-00000000000b', 'Clínica X', 'cliente', '10000000-0000-0000-0000-000000000001', 'ativa', '2026-09-01'),
  ('20000000-0000-0000-0000-00000000000c', 'Clínica Y', 'cliente', '10000000-0000-0000-0000-000000000002', 'ativa', '2026-09-01');
insert into bpo_fin.org_acessos (user_auth_id, id_org, papel) values
  ('00000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000000b', 'analista'),
  ('00000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-00000000000b', 'revisor'),
  ('00000000-0000-0000-0000-0000000000b1', null, 'head');
insert into bpo_fin.entidades (id_entidade, id_org, razao_social, cnpj) values
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Clínica X LTDA', '11222333000144');
insert into bpo_fin.contas (id_conta, id_org, id_entidade, tipo, instituicao, apelido, saldo_inicial, data_saldo_inicial) values
  ('40000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'banco', 'Itaú', 'Itaú PJ', 1000, '2026-08-31'),
  ('40000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'gateway', 'Asaas', 'Asaas', 0, '2026-08-31');
insert into bpo_fin.plano_contas (id_plano_conta, id_org, codigo, nome, natureza, entra_dre, entra_dfc, grupo_dfc, linha_dre, ordem_dre, regra_competencia, generica, aceita_lancamento) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', '3.1', 'Consultas particulares', 'receita', true, true, 'operacional', 'RECEITA_BRUTA', 1, 'mes_corrente', false, true),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000b', '4.1', 'Aluguel', 'despesa', true, true, 'operacional', 'DESPESAS_FIXAS', 7, 'mes_anterior', false, true),
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000b', '5.9', 'Tarifas bancárias', 'financeira_despesa', true, true, 'operacional', 'DESPESAS_FINANCEIRAS', 13, 'mes_corrente', false, true),
  ('50000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-00000000000b', '4.99', 'Outros', 'despesa', true, true, 'operacional', 'DESPESAS_FIXAS', 7, 'mes_corrente', true, true);
insert into bpo_fin.conexoes (id_conexao, id_org, id_conta, metodo) values
  ('60000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b1', 'ofx');
insert into bpo_fin.extratos (id_extrato, id_org, id_conexao, origem, arquivo_sha256, periodo_inicio, periodo_fim) values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', '60000000-0000-0000-0000-0000000000b1', 'ofx', 'abc', '2026-09-01', '2026-09-30');
insert into bpo_fin.movimentos (id_movimento, id_org, id_conta, id_extrato, origem, hash_natural, data_movimento, valor, descricao_bruta) values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-000000000001', 'ofx', 'h1', '2026-09-05', -3000, 'PIX ALUGUEL'),
  ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-000000000001', 'ofx', 'h2', '2026-09-10', 5000, 'PIX RECEBIDO PACIENTE'),
  ('80000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-000000000001', 'ofx', 'h3', '2026-09-12', -12.90, 'TARIFA PACOTE'),
  ('80000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-000000000001', 'ofx', 'h4', '2026-09-15', -1000, 'TED MESMA TITULARIDADE'),
  ('80000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b2', null, 'asaas', 'h5', '2026-09-15', 1000, 'TRANSFERENCIA RECEBIDA'),
  ('80000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b1', null, 'ofx', 'h6', '2026-10-02', -77, 'LINHA DUPLICADA');
insert into bpo_fin.titulos (id_titulo, id_org, id_entidade, tipo, descricao, valor, data_vencimento, competencia, id_plano_conta, origem) values
  ('90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'pagar', 'Aluguel agosto', 3000, '2026-09-05', '2026-08-01', '50000000-0000-0000-0000-000000000002', 'manual'),
  ('90000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'receber', 'Consultas 1ª quinzena', 5000, '2026-09-10', '2026-09-01', '50000000-0000-0000-0000-000000000001', 'manual');


-- Extras para o teste do worker (não estão no 10_testes_nucleo): org C (Clínica Y), conta Nubank com final, conexão OFX.
-- Na org C para não mexer nas contagens da org B que o teste da API confere.
insert into bpo_fin.entidades (id_entidade, id_org, razao_social, cnpj) values
  ('30000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-00000000000c', 'Clínica Y LTDA', '22333444000155');
insert into bpo_fin.contas (id_conta, id_org, id_entidade, tipo, instituicao, apelido, numero_final, saldo_inicial, data_saldo_inicial) values
  ('40000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-00000000000c', '30000000-0000-0000-0000-00000000000c', 'banco', 'Nubank', 'Nubank PJ', '1234', 0, '2026-08-31');
insert into bpo_fin.conexoes (id_conexao, id_org, id_conta, metodo) values
  ('60000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-0000000000c1', 'ofx');

-- Extras do teste do sync Asaas (org C): conta Asaas, conexão com a chave no Vault, conexão sem chave,
-- e uma transação que "veio do histórico" (0002) — o sync não pode duplicá-la.
insert into bpo_fin.contas (id_conta, id_org, id_entidade, tipo, instituicao, apelido, saldo_inicial, data_saldo_inicial) values
  ('40000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-00000000000c', '30000000-0000-0000-0000-00000000000c', 'gateway', 'Asaas', 'Asaas', 0, '2026-08-31');
insert into bpo_fin.conexoes (id_conexao, id_org, id_conta, metodo, id_segredo) values
  ('60000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-0000000000c2', 'asaas_api',
   vault.create_secret('chave-c2', 'asaas_clinica_y', 'teste')),
  ('60000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-0000000000c2', 'asaas_api', null);
insert into bpo_fin.movimentos (id_org, id_conta, origem, id_externo, hash_natural, data_movimento, valor, descricao_bruta, payload_raw) values
  ('20000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-0000000000c2', 'asaas', 'ftn_000000001000',
   bpo_fin.fn_hash_natural('40000000-0000-0000-0000-0000000000c2', '2026-10-13', 200, 'Cobrança recebida 0', 0),
   '2026-10-13', 200, 'Cobrança recebida 0', '{"legado": "financeiro_seis.extrato_asaas"}');
