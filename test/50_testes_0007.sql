\set ON_ERROR_STOP 1
-- Testes da 0007. Banco NOVO: stubs + 0001 + 0003..0005 + 0007 + apps/api/test/seed.sql.
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

-- 1. INFORMAR ─────────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');  -- analista: tem 'conciliar'
select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b2', '2026-09-30', 1234.567);
select checar((select saldo = 1234.57 and informado_por = '00000000-0000-0000-0000-0000000000a1' and informado_em is not null and id_extrato is null
               from bpo_fin.saldos_extrato where id_conta = '40000000-0000-0000-0000-0000000000b2' and data = '2026-09-30'),
              'analista informa saldo; arredonda a 2 casas e grava quem informou');
select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b2', '2026-09-30', 99);
select checar((select saldo = 99 from bpo_fin.saldos_extrato where id_conta = '40000000-0000-0000-0000-0000000000b2' and data = '2026-09-30'),
              'informar de novo a mesma data corrige o valor');
select checar((select count(*) = 1 from bpo_fin.fn_checklist_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01')
               where item = 'saldo conferido: Asaas' and detalhe <> 'sem saldo informado na última semana do mês'),
              'checklist passa a enxergar o saldo informado');

-- 2. RECUSAS ──────────────────────────────────────────────────────────────────────────
select esperar_erro($$select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b2', current_date + 2, 1)$$, 'data no futuro');
select esperar_erro($$select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b2', '2026-08-01', 1)$$, 'anterior ao saldo inicial');
select esperar_erro($$select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b2', '2026-09-30', null)$$, 'obrigatórios');
select esperar_erro($$select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000ff', '2026-09-30', 1)$$, 'conta não encontrada');
select esperar_erro($$insert into bpo_fin.saldos_extrato (id_conta, data, saldo) values ('40000000-0000-0000-0000-0000000000b2', '2026-09-29', 1)$$, 'permission denied');
select como('00000000-0000-0000-0000-0000000000c1');  -- sem acesso à org
select esperar_erro($$select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b2', '2026-09-30', 1)$$, 'sem permissão');
reset role;

-- saldo vindo do extrato não é sobrescrito; quando a fonte grava a mesma data, a marca manual some
insert into bpo_fin.saldos_extrato (id_conta, data, saldo, id_extrato) values ('40000000-0000-0000-0000-0000000000b1', '2026-09-30', 500, '70000000-0000-0000-0000-000000000001');
select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro($$select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b1', '2026-09-30', 1)$$, 'veio do extrato');
select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b1', '2026-09-29', 10);
reset role;
update bpo_fin.saldos_extrato set saldo = 11, id_extrato = '70000000-0000-0000-0000-000000000001' where id_conta = '40000000-0000-0000-0000-0000000000b1' and data = '2026-09-29';
select checar((select informado_por is null and informado_em is null from bpo_fin.saldos_extrato where id_conta = '40000000-0000-0000-0000-0000000000b1' and data = '2026-09-29'),
              'fonte sobrescreve a data e limpa a marca de informado à mão');

-- mês travado
insert into bpo_fin.fechamento_mensal (id_org, competencia, status) values ('20000000-0000-0000-0000-00000000000b', '2026-09-01', 'fechado');
select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro($$select bpo_fin.fn_informar_saldo('40000000-0000-0000-0000-0000000000b2', '2026-09-28', 1)$$, 'mês fechado');
reset role;

select checar(true, 'TODOS OS TESTES DA 0007 PASSARAM');
