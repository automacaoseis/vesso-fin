\set ON_ERROR_STOP 1
-- helpers ─────────────────────────────────────────────────────────────────────────────
create or replace function public.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function public.esperar_erro(p_sql text, p_trecho text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_trecho in sqlerrm) = 0 then
      raise exception 'FALHA: erro inesperado para [%]: %', p_sql, sqlerrm;
    end if;
    raise notice 'ok (bloqueou): %', p_trecho;
    return;
  end;
  raise exception 'FALHA: deveria ter bloqueado: %', p_sql;
end $$;
create or replace function public.checar(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FALHA: %', p_msg; end if;
  raise notice 'ok: %', p_msg;
end $$;
grant execute on function public.como(uuid), public.esperar_erro(text, text), public.checar(boolean, text) to public;

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

-- 1. ISOLAMENTO ───────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
select checar((select count(*) from bpo_fin.organizacoes) = 1, 'analista vê só a org dele');
select checar((select count(*) from bpo_fin.movimentos) = 6, 'analista vê os movimentos da org dele');
reset role;
select como('00000000-0000-0000-0000-0000000000b1');
select checar((select array_agg(nome order by nome) from bpo_fin.organizacoes) = array['Clínica X','Clínica Y'], 'head vê todas as CLIENTE e não a casa');
reset role;
select como('00000000-0000-0000-0000-0000000000c1');
select checar((select count(*) from bpo_fin.organizacoes) = 0 and (select count(*) from bpo_fin.movimentos) = 0, 'gestor de tráfego sem concessão não vê nada');
select esperar_erro($$select bpo_fin.fn_conciliar('80000000-0000-0000-0000-000000000001', '[{"id_titulo":"90000000-0000-0000-0000-000000000001","valor":3000}]')$$, 'sem permissão');
select esperar_erro($$insert into bpo_fin.titulos (id_org, id_entidade, tipo, descricao, valor, data_vencimento, competencia, origem) values ('20000000-0000-0000-0000-00000000000b','30000000-0000-0000-0000-00000000000b','pagar','x',1,current_date,'2026-09-01','manual')$$, 'permission denied');
reset role;
select como('00000000-0000-0000-0000-0000000000d0');
select checar((select count(*) from bpo_fin.organizacoes) = 3, 'dono vê as três, inclusive a casa');
reset role;

-- 2. CONCILIAÇÃO ──────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro($$insert into bpo_fin.baixas (id_org,id_titulo,id_movimento,valor) values ('20000000-0000-0000-0000-00000000000b','90000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',3000)$$, 'permission denied');
select esperar_erro($$select bpo_fin.fn_conciliar('80000000-0000-0000-0000-000000000002', '[{"id_titulo":"90000000-0000-0000-0000-000000000001","valor":3000}]')$$, 'direção incompatível');
select esperar_erro($$select bpo_fin.fn_conciliar('80000000-0000-0000-0000-000000000001', '[{"id_titulo":"90000000-0000-0000-0000-000000000001","valor":3500}]')$$, 'excede o movimento');
select bpo_fin.fn_conciliar('80000000-0000-0000-0000-000000000001', '[{"id_titulo":"90000000-0000-0000-0000-000000000001","valor":3000}]');
select checar((select status from bpo_fin.v_movimento_status where id_movimento = '80000000-0000-0000-0000-000000000001') = 'conciliado', 'aluguel conciliado');
-- parcial → divergente
select bpo_fin.fn_conciliar('80000000-0000-0000-0000-000000000002', '[{"id_titulo":"90000000-0000-0000-0000-000000000002","valor":4800}]');
select checar((select status||'/'||diferenca from bpo_fin.v_movimento_status where id_movimento = '80000000-0000-0000-0000-000000000002') = 'divergente/200.00', 'recebimento parcial aparece divergente com Δ 200');
select checar((select count(*) from bpo_fin.v_fila where tipo_item = 'movimento_divergente') = 1, 'divergência entra na fila');
-- conciliar o restante no mesmo título (conciliação em duas partes)
select bpo_fin.fn_conciliar('80000000-0000-0000-0000-000000000002', '[{"id_titulo":"90000000-0000-0000-0000-000000000002","valor":200}]');
select checar((select status from bpo_fin.v_movimento_status where id_movimento = '80000000-0000-0000-0000-000000000002') = 'conciliado', 'segunda parte fecha a divergência');
select checar(not exists (select 1 from bpo_fin.v_titulos_abertos where id_titulo = '90000000-0000-0000-0000-000000000002'), 'título de receita quitado');
-- tarifa: lança e concilia; competência pela regra da conta
select bpo_fin.fn_lancar_e_conciliar('80000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 'Tarifa de pacote');
select checar((select competencia from bpo_fin.titulos where descricao = 'Tarifa de pacote') = '2026-09-01', 'tarifa competência = mês corrente (regra da conta)');
-- transferência entre contas da mesma org
select bpo_fin.fn_registrar_transferencia('80000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000005');
select checar((select count(*) from bpo_fin.v_movimento_status where status = 'conciliado') = 5, 'os 5 movimentos conciliados');
select esperar_erro($$select bpo_fin.fn_ignorar('80000000-0000-0000-0000-000000000003', 'outro', 'motivo longo o bastante')$$, 'desconcilie antes');
select esperar_erro($$select bpo_fin.fn_ignorar('80000000-0000-0000-0000-000000000006', 'outro', 'curto')$$, 'movimentos_ignorados_motivo_check');
select bpo_fin.fn_ignorar('80000000-0000-0000-0000-000000000006', 'duplicado_na_fonte', 'Banco enviou a mesma linha duas vezes no OFX');
select checar((select status from bpo_fin.v_movimento_status where id_movimento = '80000000-0000-0000-0000-000000000006') = 'ignorado', 'ignorado com motivo');
select esperar_erro($$select bpo_fin.fn_conciliar('80000000-0000-0000-0000-000000000006', '[{"id_titulo":"90000000-0000-0000-0000-000000000001","valor":1}]')$$, 'ignorado');
reset role;

-- 3. FECHAMENTO ───────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro($$select bpo_fin.fn_enviar_revisao('20000000-0000-0000-0000-00000000000b', '2026-09-01')$$, 'saldo conferido');
reset role;
-- saldo informado pelas fontes no último dia: Itaú 1000-3000+5000-12,90-1000 = 1987,10 · Asaas 1000
insert into bpo_fin.saldos_extrato values ('40000000-0000-0000-0000-0000000000b1', '2026-09-30', 1987.10), ('40000000-0000-0000-0000-0000000000b2', '2026-09-30', 1000);
select como('00000000-0000-0000-0000-0000000000a1');
select checar((select bool_and(ok) from bpo_fin.fn_checklist_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01') where bloqueia), 'checklist de set/26 verde');
select bpo_fin.fn_enviar_revisao('20000000-0000-0000-0000-00000000000b', '2026-09-01');
select esperar_erro($$select bpo_fin.fn_revisar_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01', true)$$, 'sem permissão');
reset role;
-- o próprio executor, mesmo com papel de revisor, não pode revisar
insert into bpo_fin.org_acessos (user_auth_id, id_org, papel) values ('00000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000000c', 'leitura');
select como('00000000-0000-0000-0000-0000000000a2');
select bpo_fin.fn_revisar_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01', true, 'Conferido');
select checar((select status from bpo_fin.fechamento_mensal) = 'fechado', 'revisor fechou set/26');
select checar((select jsonb_array_length(snapshot -> 'dre') from bpo_fin.fechamento_mensal) = 2, 'snapshot do DRE gravado (receita + tarifa)');
-- mês travado
select esperar_erro($$select bpo_fin.fn_desconciliar((select id_baixa from bpo_fin.baixas limit 1), 'teste de trava')$$, 'fechado');
select esperar_erro($$select bpo_fin.fn_reabrir_mes('20000000-0000-0000-0000-00000000000b', '2026-09-01', 'revisor tentando reabrir')$$, 'sem permissão');
reset role;
select como('00000000-0000-0000-0000-0000000000d0');
select bpo_fin.fn_reabrir_mes('20000000-0000-0000-0000-00000000000b', '2026-09-01', 'Dono reabre para teste de trava');
select checar((select status || '/' || reaberturas from bpo_fin.fechamento_mensal) = 'aberto/1', 'dono reabriu, contador de reaberturas = 1');
select checar((select count(*) from bpo_fin.fechamento_eventos) = 3, 'três transições registradas');
select bpo_fin.fn_enviar_revisao('20000000-0000-0000-0000-00000000000b', '2026-09-01');
select esperar_erro($$select bpo_fin.fn_revisar_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01', true)$$, 'diferente de quem executou');
reset role;

-- 4. DRE / DFC ────────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000d0');
select checar((select sum(valor) from bpo_fin.v_dre where competencia = '2026-09-01') = 4987.10, 'DRE set/26 = 5.000 − 12,90');
select checar((select sum(valor) from bpo_fin.v_dre where competencia = '2026-08-01') = -3000, 'aluguel pago em set entra no DRE de AGO (competência)');
select checar((select sum(valor) from bpo_fin.v_dfc where mes = '2026-09-01') = 1987.10, 'DFC set/26 = 5.000 − 3.000 − 12,90 (transferência fora)');
select checar((select count(*) from bpo_fin.log_eventos) > 0, 'auditoria gravou');
reset role;

-- 5. PAPÉIS DE BANCO ──────────────────────────────────────────────────────────────────
set role vesso_fin_worker;
insert into bpo_fin.movimentos (id_org, id_conta, origem, hash_natural, data_movimento, valor, descricao_bruta)
values ('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b1', 'ofx',
        bpo_fin.fn_hash_natural('40000000-0000-0000-0000-0000000000b1', '2026-10-01', -50, 'pix  teste', 0), '2026-10-01', -50, 'PIX TESTE');
select esperar_erro($$insert into bpo_fin.movimentos (id_org, id_conta, origem, hash_natural, data_movimento, valor) values ('20000000-0000-0000-0000-00000000000b','40000000-0000-0000-0000-0000000000b1','ofx', bpo_fin.fn_hash_natural('40000000-0000-0000-0000-0000000000b1','2026-10-01',-50,'PIX TESTE',0),'2026-10-01',-50)$$, 'duplicate key');
select esperar_erro($$update bpo_fin.movimentos set valor = -60 where hash_natural like '%' and data_movimento = '2026-10-01'$$, 'permission denied');
select esperar_erro($$insert into bpo_fin.titulos (id_org, id_entidade, tipo, descricao, valor, data_vencimento, competencia, origem) values ('20000000-0000-0000-0000-00000000000b','30000000-0000-0000-0000-00000000000b','pagar','x',1,current_date,'2026-10-01','manual')$$, 'permission denied');
select esperar_erro($$update bpo_fin.extratos set payload = '{}' $$, 'permission denied');
reset role;
select esperar_erro($$update bpo_fin.extratos set payload = '{"a":1}' $$, 'imutável');
select esperar_erro($$delete from bpo_fin.movimentos$$, 'não se apaga');
set role vesso_fin_api;
select esperar_erro($$select count(*) from bpo_fin.movimentos$$, 'permission denied');
reset role;
select checar(true, 'TODOS OS TESTES PASSARAM');
