-- Imita o mínimo do Supabase para testar 0001/0002 num Postgres limpo.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to public;

create schema app_seis;
create table app_seis.clientes (id_cliente uuid primary key, nome_principal text);
create schema core_seis;
create table core_seis.dim_calendario (data date primary key, dia_util boolean, inicio_mes date, fim_mes date);
