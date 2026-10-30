-- 0010 · Portal do cliente (vesso-clientes): Meu Caixa, Relatórios e Documentos.
-- Por quê: docs/PROMPT.md §7 (Fase 1b) — o cliente externo vê SÓ meses com fechamento_mensal.status = 'liberado',
-- e a partir do snapshot congelado no fechamento (não do dado vivo, que o BPO ainda pode estar mexendo).
-- Identidade: a mesma do portal — app_seis.cliente_acessos (titular | socio | secretaria) → organizacoes.id_cliente.
-- O schema bpo_fin NÃO é exposto: o portal chama wrappers public.fn_cliente_fin_* (padrão dos fn_cliente_* do portal).
--   · titular/sócio: caixa, relatórios e documentos;  · secretaria: só documentos (novo papel do portal, já no CHECK).
--   · o cliente pode ANEXAR arquivo a um documento pedido (policy de INSERT no bucket só na pasta da própria org).
-- Depende da 0009 (documentos + bucket bpo-fin).
begin;

-- org BPO do cliente logado + papel no portal (nulo = não é cliente do BPO)
create function bpo_fin.fn_cliente_portal() returns table (id_org uuid, nome text, papel text)
language sql stable security definer set search_path = '' as $$
  select o.id_org, o.nome, ca.tipo
  from app_seis.cliente_acessos ca
  join bpo_fin.organizacoes o on o.id_cliente = ca.id_cliente and o.tipo = 'cliente' and o.status in ('onboarding', 'ativa')
  where ca.user_auth_id = auth.uid() and ca.ativo
  order by ca.tipo = 'titular' desc
  limit 1
$$;

create function bpo_fin.fn_cliente_exigir(p_financeiro boolean) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v record;
begin
  if auth.uid() is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  select * into v from bpo_fin.fn_cliente_portal();
  if v.id_org is null then raise exception 'sem acesso ao financeiro' using errcode = '42501'; end if;
  if p_financeiro and v.papel not in ('titular', 'socio') then raise exception 'sem acesso ao financeiro' using errcode = '42501'; end if;
  return v.id_org;
end $$;

-- O que mostrar no menu do portal (uma chamada barata, entra no Promise.all do requireCliente)
create function public.fn_cliente_fin_acesso() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('tem_bpo', true, 'organizacao', p.nome, 'papel', p.papel,
             'financeiro', p.papel in ('titular', 'socio'), 'documentos', true,
             'ultimo_liberado', (select max(f.competencia) from bpo_fin.fechamento_mensal f where f.id_org = p.id_org and f.status = 'liberado'),
             'documentos_pedidos', (select count(*) from bpo_fin.documentos d where d.id_org = p.id_org and d.status = 'pedido'))
    from bpo_fin.fn_cliente_portal() p), jsonb_build_object('tem_bpo', false))
$$;

-- Meses liberados (mais recente primeiro)
create function public.fn_cliente_fin_meses() returns table (competencia date, liberado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.competencia, f.liberado_em from bpo_fin.fechamento_mensal f
  where f.id_org = bpo_fin.fn_cliente_exigir(true) and f.status = 'liberado'
  order by f.competencia desc
$$;

-- DRE congelado dos meses liberados no intervalo: uma linha por conta do plano × mês
create function public.fn_cliente_fin_dre(p_de date, p_ate date) returns table (
  competencia date, linha_dre text, ordem_dre int, codigo text, conta text, natureza text, valor numeric)
language sql stable security definer set search_path = '' as $$
  select f.competencia, d ->> 'linha_dre', (d ->> 'ordem_dre')::int, d ->> 'codigo', d ->> 'conta', d ->> 'natureza', (d ->> 'valor')::numeric
  from bpo_fin.fechamento_mensal f
  cross join lateral jsonb_array_elements(coalesce(f.snapshot -> 'dre', '[]')) d
  where f.id_org = bpo_fin.fn_cliente_exigir(true) and f.status = 'liberado'
    and f.competencia between date_trunc('month', p_de)::date and date_trunc('month', p_ate)::date
$$;

-- Saldos por conta no fim de um mês liberado (do snapshot)
create function public.fn_cliente_fin_saldos(p_competencia date) returns table (conta text, data date, saldo numeric)
language sql stable security definer set search_path = '' as $$
  select s ->> 'apelido', (s ->> 'data')::date, (s ->> 'saldo_extrato')::numeric
  from bpo_fin.fechamento_mensal f
  cross join lateral jsonb_array_elements(coalesce(f.snapshot -> 'saldos', '[]')) s
  where f.id_org = bpo_fin.fn_cliente_exigir(true) and f.status = 'liberado'
    and f.competencia = date_trunc('month', p_competencia)::date
  order by 1
$$;

-- Documentos da org (titular, sócio e secretaria). Sem o caminho do arquivo.
create function public.fn_cliente_fin_documentos() returns table (
  id_documento uuid, tipo text, competencia date, descricao text, status text, motivo_recusa text,
  arquivo_nome text, pedido_em timestamptz, recebido_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.id_documento, d.tipo, d.competencia, d.descricao, d.status, d.motivo_recusa, d.arquivo_nome, d.pedido_em, d.recebido_em
  from bpo_fin.documentos d
  where d.id_org = bpo_fin.fn_cliente_exigir(false)
    and (d.status in ('pedido', 'recebido') or d.created_at > now() - interval '12 months')
  order by d.status = 'pedido' desc, coalesce(d.recebido_em, d.pedido_em, d.created_at) desc
$$;

-- Pasta onde o cliente sobe o arquivo de um pedido (o portal sobe direto ao Storage com a sessão do cliente)
create function public.fn_cliente_fin_pasta() returns text
language sql stable security definer set search_path = '' as $$
  select bpo_fin.fn_cliente_exigir(false)::text || '/cliente'
$$;

-- Cliente anexa arquivo a um documento PEDIDO da própria org
create function public.fn_cliente_fin_anexar(p_id_documento uuid, p_storage_path text, p_nome text, p_bytes int, p_mime text) returns void
language plpgsql security definer set search_path = '' as $$
declare v bpo_fin.documentos%rowtype; v_org uuid := bpo_fin.fn_cliente_exigir(false);
begin
  select * into v from bpo_fin.documentos where id_documento = p_id_documento and id_org = v_org;
  if not found then raise exception 'documento não encontrado'; end if;
  if v.status <> 'pedido' then raise exception 'este documento já foi enviado'; end if;
  if bpo_fin.fn_org_do_caminho(p_storage_path) is distinct from v_org then raise exception 'arquivo fora da pasta da organização'; end if;
  update bpo_fin.documentos set status = 'recebido', storage_path = p_storage_path, arquivo_nome = left(p_nome, 200),
         arquivo_bytes = p_bytes, arquivo_mime = left(p_mime, 100), recebido_em = now(), recebido_por = auth.uid(), motivo_recusa = null
   where id_documento = p_id_documento;
end $$;

-- Storage: o cliente sobe só na pasta da própria org (lê só o que ele mesmo subiu: owner)
create policy bpo_fin_cliente_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'bpo-fin' and bpo_fin.fn_org_do_caminho(name) is not null
              and bpo_fin.fn_org_do_caminho(name) = (select p.id_org from bpo_fin.fn_cliente_portal() p));

revoke execute on function bpo_fin.fn_cliente_portal(), bpo_fin.fn_cliente_exigir(boolean) from public;
grant execute on function bpo_fin.fn_cliente_portal() to authenticated;   -- usada pela policy do storage
revoke execute on function public.fn_cliente_fin_acesso(), public.fn_cliente_fin_meses(), public.fn_cliente_fin_dre(date, date),
  public.fn_cliente_fin_saldos(date), public.fn_cliente_fin_documentos(), public.fn_cliente_fin_pasta(),
  public.fn_cliente_fin_anexar(uuid, text, text, int, text) from public, anon;
grant execute on function public.fn_cliente_fin_acesso(), public.fn_cliente_fin_meses(), public.fn_cliente_fin_dre(date, date),
  public.fn_cliente_fin_saldos(date), public.fn_cliente_fin_documentos(), public.fn_cliente_fin_pasta(),
  public.fn_cliente_fin_anexar(uuid, text, text, int, text) to authenticated;

commit;
