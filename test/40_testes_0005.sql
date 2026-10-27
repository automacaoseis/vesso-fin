\set ON_ERROR_STOP 1
-- Testes da 0005. Banco NOVO: stubs + 01_stub_vault + 0001 + 0003 + 0004 + 0005 + apps/api/test/seed.sql.
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
grant execute on function public.esperar_erro(text, text), public.checar(boolean, text) to public;

insert into bpo_fin.conexoes (id_conexao, id_org, id_conta, metodo, id_segredo) values
  ('60000000-0000-0000-0000-0000000000a5', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b2', 'asaas_api',
   vault.create_secret('chave-asaas-de-teste', 'asaas_clinica_x', 'teste')),
  ('60000000-0000-0000-0000-0000000000a6', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b2', 'asaas_api', null);

set role vesso_fin_worker;
select checar(bpo_fin.fn_segredo_da_conexao('60000000-0000-0000-0000-0000000000a5') = 'chave-asaas-de-teste', 'worker lê a chave da conexão pelo Vault');
select esperar_erro($$select bpo_fin.fn_segredo_da_conexao('60000000-0000-0000-0000-0000000000a6')$$, 'sem segredo');
select esperar_erro($$select bpo_fin.fn_segredo_da_conexao('60000000-0000-0000-0000-0000000000b1')$$, 'não é asaas_api');
select esperar_erro($$select * from vault.decrypted_secrets$$, 'permission denied');
select esperar_erro($$select bpo_fin.fn_agendar_sync_asaas()$$, 'permission denied');
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d0"}', false);   -- nem o dono
select esperar_erro($$select bpo_fin.fn_segredo_da_conexao('60000000-0000-0000-0000-0000000000a5')$$, 'permission denied');
reset role;

-- (o seed tem outras conexões asaas_api: conferir por conexão, não pelo total)
create function pg_temp.jobs(p uuid) returns int language sql as $$
  select count(*)::int from bpo_fin.fila_jobs where tipo = 'sync_asaas' and status = 'pendente' and payload->>'id_conexao' = p::text $$;
select checar(bpo_fin.fn_agendar_sync_asaas() >= 1, 'agenda os jobs');
select checar(pg_temp.jobs('60000000-0000-0000-0000-0000000000a5') = 1, 'um job para a conexão com chave');
select checar(pg_temp.jobs('60000000-0000-0000-0000-0000000000a6') = 0, 'a conexão sem chave fica de fora');
select checar(bpo_fin.fn_agendar_sync_asaas() = 0, 'rodar de novo não duplica');
update bpo_fin.fila_jobs set status = 'ok' where tipo = 'sync_asaas';
update bpo_fin.conexoes set status = 'pausada' where id_conexao = '60000000-0000-0000-0000-0000000000a5';
select bpo_fin.fn_agendar_sync_asaas();
select checar(pg_temp.jobs('60000000-0000-0000-0000-0000000000a5') = 0, 'conexão pausada não é agendada');
set role vesso_fin_worker;
select esperar_erro($$select bpo_fin.fn_segredo_da_conexao('60000000-0000-0000-0000-0000000000a5')$$, 'pausada');
reset role;

select checar(true, 'TODOS OS TESTES DA 0005 PASSARAM');
