\set ON_ERROR_STOP 1
-- Testes da 0004. Banco NOVO: stubs + 0001 + 0003 + 0004 + apps/api/test/seed.sql.
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

insert into bpo_fin.conexoes (id_conexao, id_org, id_conta, metodo) values
  ('60000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000b2', 'asaas_api');

-- 1. UPLOAD ──────────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
insert into public.r select 'up1', bpo_fin.fn_registrar_extrato('60000000-0000-0000-0000-0000000000b1', 'nubank-out.ofx',
  encode(convert_to('OFXHEADER:100' || chr(10) || '<OFX>teste</OFX>', 'UTF8'), 'base64'));
select checar((select (v->>'duplicado')::boolean = false and v->>'id_job' is not null from public.r where k = 'up1'), 'upload novo cria extrato e job');
select checar((select e.arquivo_sha256 = encode(sha256(convert_to('OFXHEADER:100' || chr(10) || '<OFX>teste</OFX>', 'UTF8')), 'hex')
                 and e.recebido_por = '00000000-0000-0000-0000-0000000000a1' and e.status = 'recebido'
               from bpo_fin.extratos e where e.id_extrato = (select (v->>'id_extrato')::uuid from public.r where k = 'up1')),
              'sha256 calculado no banco sobre os bytes; quem enviou fica gravado');
select checar((select j.tipo = 'processar_extrato' and j.payload->>'id_extrato' = (select v->>'id_extrato' from public.r where k = 'up1')
               from bpo_fin.fila_jobs j where j.id_job = (select (v->>'id_job')::bigint from public.r where k = 'up1')), 'job aponta para o extrato');

insert into public.r select 'up2', bpo_fin.fn_registrar_extrato('60000000-0000-0000-0000-0000000000b1', 'copia.ofx',
  encode(convert_to('OFXHEADER:100' || chr(10) || '<OFX>teste</OFX>', 'UTF8'), 'base64'));
select checar((select (a.v->>'duplicado')::boolean and a.v->>'id_extrato' = b.v->>'id_extrato' from public.r a, public.r b where a.k = 'up2' and b.k = 'up1'),
              'mesmo arquivo de novo → duplicado, mesmo extrato');
reset role;
select checar((select count(*) = 1 from bpo_fin.fila_jobs), 'duplicado não cria job');
select como('00000000-0000-0000-0000-0000000000a1');

select esperar_erro($$select bpo_fin.fn_registrar_extrato('60000000-0000-0000-0000-0000000000b2', 'x.ofx', 'QUJD')$$, 'não recebe arquivo OFX');
select esperar_erro($$select bpo_fin.fn_registrar_extrato('60000000-0000-0000-0000-0000000000b1', 'x.ofx', '***')$$, 'arquivo ilegível');
select esperar_erro($$select bpo_fin.fn_registrar_extrato('60000000-0000-0000-0000-0000000000b1', 'x.ofx', '')$$, 'arquivo vazio');
select esperar_erro($$select bpo_fin.fn_registrar_extrato('60000000-0000-0000-0000-000000000099', 'x.ofx', 'QUJD')$$, 'conexão não encontrada');

select como('00000000-0000-0000-0000-0000000000c1');   -- gestor de tráfego sem concessão
select esperar_erro($$select bpo_fin.fn_registrar_extrato('60000000-0000-0000-0000-0000000000b1', 'x.ofx', 'QUJD')$$, 'sem permissão');

-- worker preenche período e saldo, mas não toca no payload
reset role;
set role vesso_fin_worker;
update bpo_fin.extratos set periodo_inicio = '2026-10-01', periodo_fim = '2026-10-31', saldo_final_informado = 123.45, data_saldo_final = '2026-10-31'
 where id_extrato = (select (v->>'id_extrato')::uuid from public.r where k = 'up1');
select checar((select periodo_fim = '2026-10-31' and saldo_final_informado = 123.45 from bpo_fin.extratos
               where id_extrato = (select (v->>'id_extrato')::uuid from public.r where k = 'up1')), 'worker grava período e saldo do arquivo');
select esperar_erro($$update bpo_fin.extratos set payload = '{}'$$, 'permission denied');
reset role;

-- 2. DESFAZER TRANSFERÊNCIA ──────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
insert into public.r select 't1', to_jsonb(bpo_fin.fn_registrar_transferencia('80000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000005'));
select checar((select count(*) = 2 from bpo_fin.v_movimento_status where status = 'conciliado' and id_transferencia is not null), 'transferência concilia as duas pontas');

select como('00000000-0000-0000-0000-0000000000c1');
select esperar_erro(format($$select bpo_fin.fn_desfazer_transferencia(%L, 'tentativa sem acesso')$$, (select v #>> '{}' from public.r where k = 't1')), 'sem permissão');

select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro(format($$select bpo_fin.fn_desfazer_transferencia(%L, 'abc')$$, (select v #>> '{}' from public.r where k = 't1')), 'motivo obrigatório');
select bpo_fin.fn_desfazer_transferencia((select (v #>> '{}')::uuid from public.r where k = 't1'), 'par errado, refazer');
select checar((select count(*) = 2 from bpo_fin.v_movimento_status
               where id_movimento in ('80000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000005') and status = 'pendente'),
              'desfeita: as duas pontas voltam a pendente');
select esperar_erro(format($$select bpo_fin.fn_desfazer_transferencia(%L, 'de novo, de novo')$$, (select v #>> '{}' from public.r where k = 't1')), 'já revertida');
reset role;
select checar((select motivo_reversao = 'par errado, refazer' and revertida_por = '00000000-0000-0000-0000-0000000000a1'
               from bpo_fin.transferencias), 'reversão guarda motivo e autor (nada é apagado)');
select checar((select count(*) >= 2 from bpo_fin.log_eventos where tabela = 'transferencias'), 'auditoria gravou registro e reversão');

-- registrar de novo funciona; com o mês fechado, desfazer é bloqueado
select como('00000000-0000-0000-0000-0000000000a1');
insert into public.r select 't2', to_jsonb(bpo_fin.fn_registrar_transferencia('80000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000005'));
reset role;
insert into bpo_fin.fechamento_mensal (id_org, competencia, status) values ('20000000-0000-0000-0000-00000000000b', '2026-09-01', 'fechado');
select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro(format($$select bpo_fin.fn_desfazer_transferencia(%L, 'tentando no mês fechado')$$, (select v #>> '{}' from public.r where k = 't2')), 'mês fechado');
reset role;

select checar(true, 'TODOS OS TESTES DA 0004 PASSARAM');
