\set ON_ERROR_STOP 1
-- Testes da 0008. Banco NOVO: stubs + 0001 + 0003..0005 + 0007 + 0008 + apps/api/test/seed.sql.
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
-- ids
-- d0 dono · a1 analista (org B) · a2 revisor (org B) · b1 head GLOBAL · c1 gestor sem acesso
-- A = casa '…0a' · B = cliente '…0b'

-- 1. HEAD concede na org cliente ────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000b1');
insert into public.r select 'g1', to_jsonb(bpo_fin.fn_conceder_acesso('Gestor_Trafego@x', '20000000-0000-0000-0000-00000000000b', 'leitura', 'acompanha o cliente'));
select checar((select papel = 'leitura' and ativo and concedido_por = '00000000-0000-0000-0000-0000000000b1' from bpo_fin.org_acessos
               where id_acesso = (select (v #>> '{}')::uuid from public.r where k = 'g1')), 'head concede leitura na org cliente (e-mail sem caixa)');
select checar(bpo_fin.fn_pode('20000000-0000-0000-0000-00000000000b', 'ver') is not null, 'sanidade');
-- trocar papel: revoga o antigo e cria outro, histórico fica
select bpo_fin.fn_conceder_acesso('revisor@x', '20000000-0000-0000-0000-00000000000b', 'analista', 'voltou a executar');
select checar((select count(*) = 2 and count(*) filter (where ativo) = 1
                      and bool_or(not ativo and motivo_revogacao like 'substituído:%' and revogado_por = '00000000-0000-0000-0000-0000000000b1')
               from bpo_fin.org_acessos where user_auth_id = '00000000-0000-0000-0000-0000000000a2'), 'trocar papel guarda o histórico');

-- 2. HEAD — limites ────────────────────────────────────────────────────────────────────
select esperar_erro($$select bpo_fin.fn_conceder_acesso('gestor_trafego@x', '20000000-0000-0000-0000-00000000000b', 'head', 'promoção')$$, 'o papel head');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('gestor_trafego@x', null, 'analista', 'todas as orgs')$$, 'todas as organizações');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('gestor_trafego@x', '20000000-0000-0000-0000-00000000000a', 'leitura', 'empresa da casa')$$, 'sem permissão');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('head@x', '20000000-0000-0000-0000-00000000000b', 'analista', 'eu mesmo')$$, 'próprio acesso');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('dono@x', '20000000-0000-0000-0000-00000000000b', 'analista', 'dono também')$$, 'já vê tudo');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('ninguem@x', '20000000-0000-0000-0000-00000000000b', 'analista', 'quem?')$$, 'nenhum login');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('gestor_trafego@x', '20000000-0000-0000-0000-00000000000b', 'analista', 'ok')$$, 'motivo obrigatório');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('gestor_trafego@x', '20000000-0000-0000-0000-00000000000b', 'analista', 'temporário', now() - interval '1 day')$$, 'no futuro');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('gestor_trafego@x', '20000000-0000-0000-0000-00000000000b', 'chefe', 'papel novo')$$, 'papel inválido');

-- 3. ANALISTA não administra; lista só o próprio ────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro($$select bpo_fin.fn_conceder_acesso('gestor_trafego@x', '20000000-0000-0000-0000-00000000000b', 'leitura', 'tentando')$$, 'sem permissão');
select esperar_erro(format($$select bpo_fin.fn_revogar_acesso(%L, 'tentando revogar')$$, (select v #>> '{}' from public.r where k = 'g1')), 'sem permissão');
select checar((select count(*) = 1 and bool_and(email = 'analista@x' and not pode_administrar) from bpo_fin.fn_listar_acessos()), 'analista lista só o próprio acesso');
select checar((select count(*) = 3 from bpo_fin.fn_pessoas(array['00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d0']::uuid[])),
              'analista vê e-mail de colegas da org, do head global e do dono');

-- 4. HEAD lista e revoga ─────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000b1');
select checar((select count(*) filter (where ativo and id_org = '20000000-0000-0000-0000-00000000000b') = 3
                  and bool_and(pode_administrar) filter (where ativo and id_org is not null)
                  and bool_and(not pode_administrar) filter (where id_org is null)
               from bpo_fin.fn_listar_acessos()), 'head lista os acessos da org que configura; não administra o próprio global');
select bpo_fin.fn_revogar_acesso((select (v #>> '{}')::uuid from public.r where k = 'g1'), 'saiu do projeto');
select checar((select not ativo and revogado_por = '00000000-0000-0000-0000-0000000000b1' and motivo_revogacao = 'saiu do projeto'
               from bpo_fin.org_acessos where id_acesso = (select (v #>> '{}')::uuid from public.r where k = 'g1')), 'head revoga com motivo');
select esperar_erro(format($$select bpo_fin.fn_revogar_acesso(%L, 'de novo agora')$$, (select v #>> '{}' from public.r where k = 'g1')), 'já revogado');
select esperar_erro($$select bpo_fin.fn_revogar_acesso((select id_acesso from bpo_fin.org_acessos where user_auth_id = auth.uid() and ativo), 'eu mesmo saio')$$, 'sem permissão');

-- 5. DONO pode tudo, e o gestor sem acesso não vê ninguém além de si ─────────────────────
select como('00000000-0000-0000-0000-0000000000c1');
select checar((select count(*) = 1 from bpo_fin.fn_pessoas(array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1']::uuid[])),
              'sem acesso a org nenhuma: só o próprio e-mail');
select como('00000000-0000-0000-0000-0000000000d0');
insert into public.r select 'h2', to_jsonb(bpo_fin.fn_conceder_acesso('gestor_trafego@x', null, 'head', 'novo head do produto'));
select checar((select papel = 'head' and id_org is null from bpo_fin.org_acessos where user_auth_id = '00000000-0000-0000-0000-0000000000c1' and ativo), 'dono concede head global');
select como('00000000-0000-0000-0000-0000000000b1');
select esperar_erro(format($$select bpo_fin.fn_revogar_acesso(%L, 'head tirando head')$$, (select v #>> '{}' from public.r where k = 'h2')), 'sem permissão');
reset role;
select checar((select count(*) >= 4 from bpo_fin.log_eventos where tabela = 'org_acessos'), 'auditoria registra as concessões');
select esperar_erro($$set role authenticated; insert into bpo_fin.org_acessos (user_auth_id, id_org, papel) values ('00000000-0000-0000-0000-0000000000c1', null, 'head')$$, 'permission denied');
reset role;

select checar(true, 'TODOS OS TESTES DA 0008 PASSARAM');
