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

-- Storage (0009): o mínimo para as policies do bucket bpo-fin
create schema if not exists storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Portal do cliente (0010): o mínimo de app_seis.cliente_acessos + fn_cliente_externo_id (como em produção)
create table app_seis.cliente_acessos (id uuid primary key default gen_random_uuid(), user_auth_id uuid not null,
  id_cliente uuid not null references app_seis.clientes(id_cliente), tipo text not null check (tipo in ('titular', 'secretaria', 'socio')),
  ativo boolean not null default true);
create function app_seis.fn_cliente_externo_id() returns uuid language sql security definer stable set search_path = app_seis, public as $$
  select ca.id_cliente from app_seis.cliente_acessos ca where ca.user_auth_id = auth.uid() and ca.ativo = true limit 1
$$;
grant execute on function app_seis.fn_cliente_externo_id() to authenticated;
