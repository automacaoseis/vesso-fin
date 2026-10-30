\set ON_ERROR_STOP 1
-- Testes da 0010 (portal do cliente). Banco NOVO: stubs + 0001 + 0003..0005 + 0007..0010 + apps/api/test/seed.sql.
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
-- e1 titular da Dra. X (org B) · e2 secretária da Dra. X · e3 titular do Dr. Y (org C) · a1 analista interno (não é cliente)
insert into auth.users values ('00000000-0000-0000-0000-0000000000e1', 'titular@x'), ('00000000-0000-0000-0000-0000000000e2', 'secretaria@x'),
                              ('00000000-0000-0000-0000-0000000000e3', 'drY@x');
insert into app_seis.cliente_acessos (user_auth_id, id_cliente, tipo) values
  ('00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000001', 'titular'),
  ('00000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-000000000001', 'secretaria'),
  ('00000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-000000000002', 'titular');
-- agosto LIBERADO (com snapshot), setembro só FECHADO, outubro liberado da Clínica Y
insert into bpo_fin.fechamento_mensal (id_org, competencia, status, liberado_em, snapshot) values
  ('20000000-0000-0000-0000-00000000000b', '2026-08-01', 'liberado', now(), jsonb_build_object(
     'dre', jsonb_build_array(
        jsonb_build_object('linha_dre', 'RECEITA_BRUTA', 'ordem_dre', 1, 'codigo', '1.1', 'conta', 'Consultas', 'natureza', 'receita', 'valor', 30000),
        jsonb_build_object('linha_dre', 'DESPESAS_FIXAS', 'ordem_dre', 5, 'codigo', '4.1', 'conta', 'Aluguel', 'natureza', 'despesa', 'valor', -3000)),
     'saldos', jsonb_build_array(jsonb_build_object('apelido', 'Itaú PJ', 'data', '2026-08-31', 'saldo_extrato', 12345.67, 'saldo_sistema', 12345.67)),
     'gerado_em', now())),
  ('20000000-0000-0000-0000-00000000000b', '2026-09-01', 'fechado', null, jsonb_build_object(
     'dre', jsonb_build_array(jsonb_build_object('linha_dre', 'RECEITA_BRUTA', 'ordem_dre', 1, 'codigo', '1.1', 'conta', 'Consultas', 'natureza', 'receita', 'valor', 99999)),
     'saldos', '[]'::jsonb, 'gerado_em', now())),
  ('20000000-0000-0000-0000-00000000000c', '2026-10-01', 'liberado', now(), jsonb_build_object(
     'dre', jsonb_build_array(jsonb_build_object('linha_dre', 'RECEITA_BRUTA', 'ordem_dre', 1, 'codigo', '1.1', 'conta', 'Consultas', 'natureza', 'receita', 'valor', 777)),
     'saldos', '[]'::jsonb, 'gerado_em', now()));
insert into bpo_fin.documentos (id_documento, id_org, tipo, descricao, status, competencia, pedido_em) values
  ('d0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', 'nf', 'NF do aluguel', 'pedido', '2026-09-01', now()),
  ('d0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000c', 'nf', 'NF do Dr. Y', 'pedido', '2026-09-01', now());

-- 1. TITULAR ────────────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000e1');
select checar((select (a ->> 'tem_bpo')::boolean and (a ->> 'financeiro')::boolean and a ->> 'organizacao' = 'Clínica X'
                      and a ->> 'ultimo_liberado' = '2026-08-01' and (a ->> 'documentos_pedidos')::int = 1
               from public.fn_cliente_fin_acesso() a), 'titular: tem BPO, vê financeiro, último liberado = ago');
select checar((select array_agg(competencia) = array['2026-08-01'::date] from public.fn_cliente_fin_meses()), 'só meses LIBERADOS (setembro fechado não aparece)');
select checar((select count(*) = 2 and sum(valor) = 27000 and bool_and(competencia = '2026-08-01') from public.fn_cliente_fin_dre('2026-01-01', '2026-12-01')),
              'DRE vem do snapshot do mês liberado, nunca do fechado');
select checar((select count(*) = 1 and min(saldo) = 12345.67 and min(conta) = 'Itaú PJ' from public.fn_cliente_fin_saldos('2026-08-15')), 'saldos do snapshot do mês');
select checar((select count(*) = 0 from public.fn_cliente_fin_saldos('2026-09-01')), 'mês só fechado: sem saldos');
select checar((select count(*) = 1 and min(descricao) = 'NF do aluguel' from public.fn_cliente_fin_documentos()), 'só documentos da própria org');
select checar(public.fn_cliente_fin_pasta() = '20000000-0000-0000-0000-00000000000b/cliente', 'pasta de envio é a da própria org');

-- 2. SECRETÁRIA: só documentos; anexa o pedido ───────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000e2');
select checar((select (a ->> 'tem_bpo')::boolean and not (a ->> 'financeiro')::boolean from public.fn_cliente_fin_acesso() a), 'secretária: tem BPO, sem financeiro');
select esperar_erro($$select * from public.fn_cliente_fin_meses()$$, 'sem acesso ao financeiro');
select esperar_erro($$select * from public.fn_cliente_fin_dre('2026-01-01', '2026-12-01')$$, 'sem acesso ao financeiro');
insert into storage.objects (bucket_id, name) values ('bpo-fin', '20000000-0000-0000-0000-00000000000b/cliente/nf-aluguel.pdf');
select checar(true, 'secretária sobe arquivo na pasta da própria org');
select esperar_erro($$insert into storage.objects (bucket_id, name) values ('bpo-fin', '20000000-0000-0000-0000-00000000000c/cliente/x.pdf')$$, 'row-level security');
select checar((select count(*) = 0 from storage.objects), 'cliente não lista o bucket (nem o que subiu)');
select esperar_erro($$select public.fn_cliente_fin_anexar('d0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000b/cliente/nf-aluguel.pdf', 'a.pdf', 1, 'application/pdf')$$, 'não encontrado');
select esperar_erro($$select public.fn_cliente_fin_anexar('d0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000c/cliente/x.pdf', 'a.pdf', 1, 'application/pdf')$$, 'fora da pasta');
select public.fn_cliente_fin_anexar('d0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b/cliente/nf-aluguel.pdf', 'nf-aluguel.pdf', 2048, 'application/pdf');
select esperar_erro($$select public.fn_cliente_fin_anexar('d0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b/cliente/nf-aluguel.pdf', 'a.pdf', 1, 'application/pdf')$$, 'já foi enviado');
reset role;
select checar((select status = 'recebido' and recebido_por = '00000000-0000-0000-0000-0000000000e2' and arquivo_nome = 'nf-aluguel.pdf'
               from bpo_fin.documentos where id_documento = 'd0000000-0000-0000-0000-000000000001'), 'anexo do cliente vira recebido (BPO valida)');

-- 3. OUTROS: cliente de outra org, interno, anônimo ───────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000e3');
select checar((select array_agg(competencia) = array['2026-10-01'::date] from public.fn_cliente_fin_meses()), 'Dr. Y só vê a própria org');
select checar((select sum(valor) = 777 from public.fn_cliente_fin_dre('2026-01-01', '2026-12-01')), 'Dr. Y: DRE só da Clínica Y');
select como('00000000-0000-0000-0000-0000000000a1');
select checar((select not (a ->> 'tem_bpo')::boolean from public.fn_cliente_fin_acesso() a), 'interno sem cliente_acessos: sem financeiro no portal');
select esperar_erro($$select * from public.fn_cliente_fin_documentos()$$, 'sem acesso');
reset role;
update app_seis.cliente_acessos set ativo = false where user_auth_id = '00000000-0000-0000-0000-0000000000e1';
select como('00000000-0000-0000-0000-0000000000e1');
select esperar_erro($$select * from public.fn_cliente_fin_meses()$$, 'sem acesso');
reset role;
select esperar_erro($$set role anon; select * from public.fn_cliente_fin_meses()$$, 'permission denied');
reset role;
select esperar_erro($$set role authenticated; select * from bpo_fin.fn_cliente_exigir(true)$$, 'permission denied');
reset role;

select checar(true, 'TODOS OS TESTES DA 0010 PASSARAM');
