\set ON_ERROR_STOP 1
-- Testes da 0013 (no banco da importação: stubs + financeiro_seis stub + 0001..0006 + 0013, depois da importação).
create or replace function public.como13(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
grant execute on function public.como13(uuid) to public;
insert into auth.users values ('00000000-0000-0000-0000-0000000000d9', 'dono13@x'), ('00000000-0000-0000-0000-0000000000a9', 'outro13@x') on conflict do nothing;
insert into bpo_fin.donos (user_auth_id) values ('00000000-0000-0000-0000-0000000000d9') on conflict do nothing;
-- Reproduz produção (conferido em 31/10): views do financeiro_seis com security_invoker e RLS nas tabelas de lá.
-- Aqui a RLS esconde todo o extrato do Asaas de authenticated.
alter view financeiro_seis.v_tabela_fato set (security_invoker = true);
alter view financeiro_seis.v_dre_seis set (security_invoker = true);
grant usage on schema financeiro_seis to authenticated;
grant select on all tables in schema financeiro_seis to authenticated;
alter table financeiro_seis.extrato_asaas enable row level security;

do $$ declare v_direto numeric; v_func numeric; v_adm numeric; begin
  select sum(abs(dre_financeiro_seis)) into v_adm from bpo_fin.v_conferencia_dre_seis;
  perform public.como13('00000000-0000-0000-0000-0000000000d9');
  select coalesce(sum(abs(dre_financeiro_seis)), 0) into v_direto from bpo_fin.v_conferencia_dre_seis;
  select sum(abs(dre_financeiro_seis)) into v_func from bpo_fin.fn_conferencia_dre_seis();
  reset role;
  if v_direto = v_adm then raise exception 'FALHA: o teste não reproduziu o corte da RLS'; end if;
  if v_func is distinct from v_adm then raise exception 'FALHA: pela função o dono vê % e o admin %', v_func, v_adm; end if;
  raise notice 'ok: lendo a view direto o dono via % (cortado pela RLS); pela função vê % = admin', v_direto, v_func;
end $$;

do $$ begin
  perform public.como13('00000000-0000-0000-0000-0000000000a9');
  begin
    perform * from bpo_fin.fn_conferencia_dre_seis();
    raise exception 'FALHA: quem não é dono leu a conferência';
  exception when insufficient_privilege then raise notice 'ok (bloqueou): só o dono';
  end;
  reset role;
end $$;
reset role;
select 'TODOS OS TESTES DA 0013 PASSARAM';
\echo TODOS OS TESTES DA 0013 PASSARAM
