-- 0005 · Sync do Asaas por API: segredo no Vault e agendamento diário.
-- A chave do Asaas NUNCA fica no repositório nem em env: mora em vault.secrets, e conexoes.id_segredo
-- guarda só o id (docs/PROMPT.md §2, regra 4). Quem lê é o worker, por esta função e por mais nada.
-- Aplicada em produção em 27/10/2026 como 20261027133109_bpo_fin_0005_sync_asaas.
begin;

-- Só conexão asaas_api ativa/em erro (pausada não sincroniza) e só para o login do worker.
-- Quem tiver a senha do vesso_fin_worker lê as chaves — é o mesmo limite de confiança do worker hoje.
create function bpo_fin.fn_segredo_da_conexao(p_id_conexao uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_cx bpo_fin.conexoes%rowtype; v_seg text;
begin
  select * into v_cx from bpo_fin.conexoes where id_conexao = p_id_conexao;
  if not found then raise exception 'conexão não encontrada'; end if;
  if v_cx.metodo <> 'asaas_api' then raise exception 'conexão % não é asaas_api', p_id_conexao; end if;
  if v_cx.status = 'pausada' then raise exception 'conexão pausada'; end if;
  if v_cx.id_segredo is null then raise exception 'conexão sem segredo cadastrado (conexoes.id_segredo)'; end if;
  select s.decrypted_secret into v_seg from vault.decrypted_secrets s where s.id = v_cx.id_segredo;
  if v_seg is null then raise exception 'segredo % não encontrado no Vault', v_cx.id_segredo; end if;
  return v_seg;
end $$;
revoke execute on function bpo_fin.fn_segredo_da_conexao(uuid) from public;
grant execute on function bpo_fin.fn_segredo_da_conexao(uuid) to vesso_fin_worker;

-- Um job sync_asaas por conexão asaas_api que ainda não tem um na fila. Idempotente: rodar duas vezes
-- no mesmo minuto não duplica. Chamado pelo pg_cron (abaixo); pode ser chamado à mão.
create function bpo_fin.fn_agendar_sync_asaas() returns int
language sql security definer set search_path = '' as $$
  with novos as (
    insert into bpo_fin.fila_jobs (tipo, id_org, payload)
    select 'sync_asaas', cx.id_org, jsonb_build_object('id_conexao', cx.id_conexao)
      from bpo_fin.conexoes cx
      join bpo_fin.organizacoes o on o.id_org = cx.id_org and o.status in ('onboarding', 'ativa')
     where cx.metodo = 'asaas_api' and cx.status <> 'pausada' and cx.id_segredo is not null
       and not exists (select 1 from bpo_fin.fila_jobs j
                        where j.tipo = 'sync_asaas' and j.status in ('pendente', 'rodando')
                          and j.payload->>'id_conexao' = cx.id_conexao::text)
    returning 1)
  select count(*)::int from novos
$$;
revoke execute on function bpo_fin.fn_agendar_sync_asaas() from public;

-- Diário às 09:00 UTC (06:00 em Brasília). Só onde o pg_cron existe (produção; o Postgres de teste não tem).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bpo_fin_sync_asaas', '0 9 * * *', 'select bpo_fin.fn_agendar_sync_asaas()');
  end if;
end $$;

commit;
