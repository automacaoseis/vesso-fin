\set ON_ERROR_STOP 1
-- Testes da 0011 (cadastro). Banco NOVO: stubs + 0001 + 0003..0005 + 0007..0011 + apps/api/test/seed.sql.
create or replace function public.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function public.esperar_erro(p_sql text, p_trecho text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_trecho in sqlerrm) = 0 then raise exception 'FALHA: erro inesperado para [%]: %', p_sql, sqlerrm; end if;
    raise notice 'ok (bloqueou): %', p_trecho; return;
  end;
  raise exception 'FALHA: deveria ter bloqueado: %', p_sql;
end $$;
create or replace function public.checar(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FALHA: %', p_msg; end if;
  raise notice 'ok: %', p_msg;
end $$;
grant execute on function public.como(uuid), public.esperar_erro(text, text), public.checar(boolean, text) to public;
create table public.r (k text primary key, v jsonb);
grant all on public.r to public;
-- d0 dono · b1 head global · a1 analista (B) · A casa '…0a' · B cliente '…0b' · C cliente '…0c'
insert into app_seis.clientes values ('10000000-0000-0000-0000-000000000003', 'Dra. Z'), ('10000000-0000-0000-0000-000000000004', 'Dra. W'),
                                     ('10000000-0000-0000-0000-000000000005', 'Seis e Marketing (comercial interno)');
insert into bpo_fin.plano_contas (id_plano_conta, id_org, codigo, nome, natureza, aceita_lancamento, entra_dre, entra_dfc, grupo_dfc) values
  ('50000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-00000000000b', '9', 'Grupo teste', 'grupo', false, false, false, null);
update bpo_fin.plano_contas set id_pai = '50000000-0000-0000-0000-0000000000f0' where id_org = '20000000-0000-0000-0000-00000000000b' and codigo <> '9';

-- 1. CRIAR ORGANIZAÇÃO ──────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000d0');
insert into public.r select 'z', to_jsonb(bpo_fin.fn_criar_organizacao('Clínica Z', 'cliente', '10000000-0000-0000-0000-000000000003',
  'Clínica Z LTDA', 'Clínica Z', '12.345.678/0001-90', 'simples', '2026-11-15', 'A', '20000000-0000-0000-0000-00000000000b', null));
select checar((select status = 'onboarding' and competencia_inicial = '2026-11-01' and turma_fechamento = 'A'
               from bpo_fin.organizacoes where id_org = (select (v #>> '{}')::uuid from public.r where k = 'z')), 'dono cria org cliente (onboarding, competência dia 1)');
select checar((select cnpj = '12345678000190' from bpo_fin.entidades where id_org = (select (v #>> '{}')::uuid from public.r where k = 'z')), 'entidade com CNPJ só dígitos');
select checar((select count(*) = (select count(*) from bpo_fin.plano_contas where id_org = '20000000-0000-0000-0000-00000000000b')
                  and count(id_pai) = (select count(id_pai) from bpo_fin.plano_contas where id_org = '20000000-0000-0000-0000-00000000000b')
               from bpo_fin.plano_contas where id_org = (select (v #>> '{}')::uuid from public.r where k = 'z')), 'plano copiado inteiro, com a hierarquia');
select checar((select bool_and(p.id_org = n.id_org) from bpo_fin.plano_contas n join bpo_fin.plano_contas p on p.id_plano_conta = n.id_pai
               where n.id_org = (select (v #>> '{}')::uuid from public.r where k = 'z')), 'pai aponta para conta do plano NOVO');
select esperar_erro($$select bpo_fin.fn_criar_organizacao('De novo', 'cliente', '10000000-0000-0000-0000-000000000003', null, null, '12345678000190', null, '2026-11-01', null)$$, 'já tem organização');
select esperar_erro($$select bpo_fin.fn_criar_organizacao('CNPJ ruim', 'cliente', '10000000-0000-0000-0000-000000000004', null, null, '123', null, '2026-11-01', null)$$, 'CNPJ');
select esperar_erro($$select bpo_fin.fn_criar_organizacao('Sem cliente', 'cliente', null, null, null, '12345678000190', null, '2026-11-01', null)$$, 'ligada ao cliente');
select esperar_erro($$select bpo_fin.fn_criar_organizacao('Dois planos', 'cliente', '10000000-0000-0000-0000-000000000004', null, null, '12345678000190', null, '2026-11-01', null,
  '20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001')$$, 'modelo OU');

select como('00000000-0000-0000-0000-0000000000b1');  -- head global
insert into public.r select 'w', to_jsonb(bpo_fin.fn_criar_organizacao('Clínica W', 'cliente', '10000000-0000-0000-0000-000000000004', null, null, '98765432000110', null, '2026-12-01', 'B'));
select checar((select count(*) = 0 from bpo_fin.plano_contas where id_org = (select (v #>> '{}')::uuid from public.r where k = 'w')), 'head global cria org cliente (plano vazio quando não copia)');
select checar((select count(*) = 1 from bpo_fin.organizacoes where id_org = (select (v #>> '{}')::uuid from public.r where k = 'w')), 'head enxerga a org que criou');
select esperar_erro($$select bpo_fin.fn_criar_organizacao('Casa nova', 'casa', null, null, null, '98765432000110', null, '2026-12-01', null)$$, 'só o dono');
select esperar_erro($$select bpo_fin.fn_criar_organizacao('Copia casa', 'cliente', '10000000-0000-0000-0000-000000000005', null, null, '98765432000110', null, '2026-12-01', null,
  '20000000-0000-0000-0000-00000000000a', null)$$, 'sem acesso à organização');
select bpo_fin.fn_atualizar_organizacao((select (v #>> '{}')::uuid from public.r where k = 'w'), 'Clínica W Saúde', 'ativa', 'C', '2026-12-01');
select checar((select nome = 'Clínica W Saúde' and status = 'ativa' and turma_fechamento = 'C' from bpo_fin.organizacoes
               where id_org = (select (v #>> '{}')::uuid from public.r where k = 'w')), 'head atualiza nome, status e turma');
select esperar_erro($$select bpo_fin.fn_ligar_portal('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000005')$$, 'só o dono');
select checar((select count(*) = 0 from bpo_fin.fn_buscar_clientes('x')), 'busca exige 2+ letras');
select checar((select count(*) >= 1 and bool_or(organizacao = 'Clínica X') from bpo_fin.fn_buscar_clientes('Dra')), 'head busca clientes e vê quem já tem org');

select como('00000000-0000-0000-0000-0000000000a1');  -- analista
select esperar_erro($$select bpo_fin.fn_criar_organizacao('Nao', 'cliente', '10000000-0000-0000-0000-000000000005', null, null, '98765432000110', null, '2026-12-01', null)$$, 'só o dono ou o head');
select checar((select count(*) = 0 from bpo_fin.fn_buscar_clientes('Dra')), 'analista não busca clientes');
select esperar_erro($$select bpo_fin.fn_criar_conta('20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'banco', 'Nubank', 'Nubank PJ', '1234', 0, '2026-08-31', 'ofx')$$, 'sem permissão');

-- 2. CASA NO PORTAL (só o dono) ───────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000d0');
select esperar_erro($$select bpo_fin.fn_ligar_portal('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000005')$$, 'pelo próprio cliente');
select esperar_erro($$select bpo_fin.fn_ligar_portal('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003')$$, 'já tem organização');
select bpo_fin.fn_ligar_portal('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000005');
reset role;
select checar((select id_cliente_portal = '10000000-0000-0000-0000-000000000005' and id_cliente is null and tipo = 'casa'
               from bpo_fin.organizacoes where id_org = '20000000-0000-0000-0000-00000000000a'), 'casa ligada ao portal continua casa (sem id_cliente)');
select esperar_erro($$update bpo_fin.organizacoes set id_cliente_portal = '10000000-0000-0000-0000-000000000004' where id_org = '20000000-0000-0000-0000-00000000000b'$$, 'org_portal_so_casa');
insert into auth.users values ('00000000-0000-0000-0000-0000000000e5', 'luiz-portal@x');
insert into app_seis.cliente_acessos (user_auth_id, id_cliente, tipo) values ('00000000-0000-0000-0000-0000000000e5', '10000000-0000-0000-0000-000000000005', 'titular');
select checar((select nome = 'Seis e Marketing (comercial interno)' and via = 'portal' from bpo_fin.fn_cliente_da_org('20000000-0000-0000-0000-00000000000a')), 'nome do cliente ligado (dono)');
select como('00000000-0000-0000-0000-0000000000e5');
select checar((select a ->> 'organizacao' = 'Agência Seis' and (a ->> 'financeiro')::boolean from public.fn_cliente_fin_acesso() a), 'portal do cliente Seis enxerga a Agência Seis');
select como('00000000-0000-0000-0000-0000000000b1');
select checar((select count(*) = 0 from bpo_fin.organizacoes where id_org = '20000000-0000-0000-0000-00000000000a'), 'head global continua SEM ver a org casa');
select checar((select count(*) = 0 from bpo_fin.fn_cliente_da_org('20000000-0000-0000-0000-00000000000a')), 'nem o cliente ligado a ela');
select como('00000000-0000-0000-0000-0000000000d0');
select bpo_fin.fn_ligar_portal('20000000-0000-0000-0000-00000000000a', null);
select como('00000000-0000-0000-0000-0000000000e5');
select checar((select not (a ->> 'tem_bpo')::boolean from public.fn_cliente_fin_acesso() a), 'desligar tira do portal');

-- 3. ENTIDADE, CONTA, CONEXÃO ─────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000b1');
insert into public.r select 'e2', to_jsonb(bpo_fin.fn_criar_entidade('20000000-0000-0000-0000-00000000000b', 'Clínica X Filial LTDA', 'Filial', '11222333000225', 'presumido'));
insert into public.r select 'c1', to_jsonb(bpo_fin.fn_criar_conta('20000000-0000-0000-0000-00000000000b', (select (v #>> '{}')::uuid from public.r where k = 'e2'),
  'banco', 'Nubank', 'Nubank Filial', '4321', 1500.555, '2026-08-31', 'ofx'));
select checar((select c.saldo_inicial = 1500.56 and x.metodo = 'ofx' and x.status = 'ativa' from bpo_fin.contas c join bpo_fin.conexoes x using (id_conta)
               where c.id_conta = (select (v #>> '{}')::uuid from public.r where k = 'c1')), 'conta nova com conexão OFX');
select esperar_erro(format($$select bpo_fin.fn_criar_conta('20000000-0000-0000-0000-00000000000b', %L, 'gateway', 'Asaas', 'Asaas 2', null, 0, '2026-08-31', 'asaas_api')$$,
  (select v #>> '{}' from public.r where k = 'e2')), 'só OFX ou manual');
select esperar_erro(format($$select bpo_fin.fn_criar_conta('20000000-0000-0000-0000-00000000000b', %L, 'banco', 'Nubank', 'nubank filial', null, 0, '2026-08-31', null)$$,
  (select v #>> '{}' from public.r where k = 'e2')), 'esse apelido');
select esperar_erro($$select bpo_fin.fn_criar_conta('20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'banco', 'Nubank', 'Outra', '12345678', 0, '2026-08-31', null)$$, 'numero_final');
select esperar_erro(format($$select bpo_fin.fn_desativar_conta(%L, 'ok')$$, (select v #>> '{}' from public.r where k = 'c1')), 'motivo obrigatório');
select bpo_fin.fn_desativar_conta((select (v #>> '{}')::uuid from public.r where k = 'c1'), 'conta encerrada no banco');
select checar((select not c.ativa and x.status = 'pausada' from bpo_fin.contas c join bpo_fin.conexoes x using (id_conta)
               where c.id_conta = (select (v #>> '{}')::uuid from public.r where k = 'c1')), 'desativar conta pausa a conexão');
select checar((select count(*) = 0 from bpo_fin.fn_checklist_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01') where item = 'saldo conferido: Nubank Filial'),
              'conta inativa sai do checklist');
reset role;
select checar((select count(*) >= 3 from bpo_fin.log_eventos where tabela = 'organizacoes'), 'organizações auditadas');

-- 4. CORREÇÕES DA REVISÃO ────────────────────────────────────────────────────────────────
-- competência inicial para FRENTE passando por mês fechado também é recusada
insert into bpo_fin.fechamento_mensal (id_org, competencia, status) values ((select (v #>> '{}')::uuid from public.r where k = 'w'), '2027-01-01', 'fechado');
select como('00000000-0000-0000-0000-0000000000b1');
select esperar_erro(format($$select bpo_fin.fn_atualizar_organizacao(%L, 'Clínica W Saúde', 'ativa', 'C', '2027-03-01')$$, (select v #>> '{}' from public.r where k = 'w')), 'mês fechado entre');
select bpo_fin.fn_atualizar_organizacao((select (v #>> '{}')::uuid from public.r where k = 'w'), 'Clínica W Saúde', 'ativa', 'C', '2027-01-01');
select checar(true, 'competência até o mês fechado (sem passar dele) pode');
-- cliente: anexar exige o arquivo existir no bucket e estar em <org>/cliente/
reset role;
update app_seis.cliente_acessos set id_cliente = '10000000-0000-0000-0000-000000000003' where user_auth_id = '00000000-0000-0000-0000-0000000000e5';
insert into bpo_fin.documentos (id_documento, id_org, tipo, descricao, status, pedido_em)
values ('d0000000-0000-0000-0000-0000000000aa', (select (v #>> '{}')::uuid from public.r where k = 'z'), 'nf', 'NF teste revisão', 'pedido', now());
insert into public.r select 'pz', to_jsonb((select (v #>> '{}') from public.r where k = 'z') || '/cliente/nf.pdf');
select como('00000000-0000-0000-0000-0000000000e5');
select esperar_erro(format($$select public.fn_cliente_fin_anexar('d0000000-0000-0000-0000-0000000000aa', %L, 'nf.pdf', 10, 'application/pdf')$$, (select v #>> '{}' from public.r where k = 'pz')), 'arquivo não encontrado');
select esperar_erro(format($$select public.fn_cliente_fin_anexar('d0000000-0000-0000-0000-0000000000aa', %L, 'nf.pdf', 10, 'application/pdf')$$,
  (select v #>> '{}' from public.r where k = 'z') || '/2026-10/nf.pdf'), 'fora da pasta');
insert into storage.objects (bucket_id, name) values ('bpo-fin', (select v #>> '{}' from public.r where k = 'pz'));
select public.fn_cliente_fin_anexar('d0000000-0000-0000-0000-0000000000aa', (select v #>> '{}' from public.r where k = 'pz'), 'nf.pdf', 10, 'application/pdf');
select esperar_erro(format($$select public.fn_cliente_fin_anexar('d0000000-0000-0000-0000-0000000000aa', %L, 'nf.pdf', 10, 'application/pdf')$$, (select v #>> '{}' from public.r where k = 'pz')), 'já foi enviado');
reset role;
select checar((select status = 'recebido' from bpo_fin.documentos where id_documento = 'd0000000-0000-0000-0000-0000000000aa'), 'cliente anexa quando o arquivo existe na pasta /cliente/');

select checar(true, 'TODOS OS TESTES DA 0011 PASSARAM');
