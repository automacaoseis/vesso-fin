-- 0008 · Conceder e revogar acesso (tela /acessos) e e-mail das pessoas (telas /acessos e /equipe).
-- Por quê: na 0001 concessão era só por SQL e `authenticated` não lê auth.users, então a tela não tinha como
-- mostrar QUEM é cada pessoa. Entradas são RPCs SECURITY DEFINER com a regra aqui dentro, como o resto.
-- Regras (docs/PROMPT.md §7: "/acessos — concessões, só dono e head"):
--   · dono concede/revoga qualquer coisa, inclusive acesso global (id_org nulo = todas as orgs cliente) e papel head;
--   · head (ação configurar_org na org) concede/revoga leitura/analista/revisor NAQUELA org — não mexe em head nem em global;
--   · ninguém altera o próprio acesso; dono não recebe acesso (já vê tudo);
--   · trocar o papel = revoga o ativo e cria outro (histórico fica); motivo obrigatório nos dois sentidos.
begin;

alter table bpo_fin.org_acessos
  add column revogado_em       timestamptz,
  add column revogado_por      uuid references auth.users(id),
  add column motivo_revogacao  text;

-- pode administrar o acesso (papel, org) em questão?
create function bpo_fin.fn_pode_administrar_acesso(p_id_org uuid, p_papel text) returns boolean
language sql stable security definer set search_path = '' as $$
  select bpo_fin.fn_eh_dono()
      or (p_id_org is not null and p_papel <> 'head' and bpo_fin.fn_pode(p_id_org, 'configurar_org'))
$$;

create function bpo_fin.fn_conceder_acesso(p_email text, p_id_org uuid, p_papel text, p_motivo text,
  p_expira_em timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_atual bpo_fin.org_acessos%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  if not exists (select 1 from bpo_fin.papeis where papel = p_papel) then raise exception 'papel inválido'; end if;
  if p_id_org is not null and not exists (select 1 from bpo_fin.organizacoes where id_org = p_id_org) then
    raise exception 'organização não encontrada';
  end if;
  if not bpo_fin.fn_pode_administrar_acesso(p_id_org, p_papel) then
    raise exception 'sem permissão para conceder %', case when p_id_org is null then 'acesso a todas as organizações'
      when p_papel = 'head' then 'o papel head' else 'acesso nesta organização' end using errcode = '42501';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'motivo obrigatório (5+ caracteres)'; end if;
  if p_expira_em is not null and p_expira_em <= now() then raise exception 'validade tem que ser no futuro'; end if;

  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then raise exception 'nenhum login do Vesso com o e-mail %', btrim(p_email); end if;
  if v_user = auth.uid() then raise exception 'você não pode alterar o próprio acesso'; end if;
  if exists (select 1 from bpo_fin.donos where user_auth_id = v_user) then raise exception 'essa pessoa é dona: já vê tudo'; end if;

  select * into v_atual from bpo_fin.org_acessos
   where user_auth_id = v_user and ativo and id_org is not distinct from p_id_org;
  if found then
    -- head não rebaixa nem troca quem é head
    if not bpo_fin.fn_pode_administrar_acesso(v_atual.id_org, v_atual.papel) then
      raise exception 'sem permissão para alterar o acesso atual dessa pessoa (%)', v_atual.papel using errcode = '42501';
    end if;
    update bpo_fin.org_acessos set ativo = false, revogado_em = now(), revogado_por = auth.uid(),
           motivo_revogacao = 'substituído: ' || btrim(p_motivo)
     where id_acesso = v_atual.id_acesso;
  end if;

  insert into bpo_fin.org_acessos (user_auth_id, id_org, papel, motivo, concedido_por, expira_em)
  values (v_user, p_id_org, p_papel, btrim(p_motivo), auth.uid(), p_expira_em)
  returning id_acesso into v_id;
  return v_id;
end $$;

create function bpo_fin.fn_revogar_acesso(p_id_acesso uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v bpo_fin.org_acessos%rowtype;
begin
  if auth.uid() is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  select * into v from bpo_fin.org_acessos where id_acesso = p_id_acesso;
  if not found or not v.ativo then raise exception 'acesso não encontrado ou já revogado'; end if;
  if not bpo_fin.fn_pode_administrar_acesso(v.id_org, v.papel) then
    raise exception 'sem permissão para revogar este acesso' using errcode = '42501';
  end if;
  if v.user_auth_id = auth.uid() then raise exception 'você não pode alterar o próprio acesso'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'motivo obrigatório (5+ caracteres)'; end if;
  update bpo_fin.org_acessos set ativo = false, revogado_em = now(), revogado_por = auth.uid(), motivo_revogacao = btrim(p_motivo)
   where id_acesso = p_id_acesso;
end $$;

-- Acessos que quem chama administra (dono: todos; head: os das orgs que configura) + os próprios. Com e-mail.
create function bpo_fin.fn_listar_acessos() returns table (
  id_acesso uuid, user_auth_id uuid, email text, id_org uuid, organizacao text, papel text, motivo text,
  concedido_por_email text, created_at timestamptz, expira_em timestamptz, ativo boolean,
  revogado_em timestamptz, revogado_por_email text, motivo_revogacao text, pode_administrar boolean)
language sql stable security definer set search_path = '' as $$
  select a.id_acesso, a.user_auth_id, u.email, a.id_org, o.nome, a.papel, a.motivo,
         cp.email, a.created_at, a.expira_em, a.ativo, a.revogado_em, rp.email, a.motivo_revogacao,
         a.ativo and a.user_auth_id <> auth.uid() and bpo_fin.fn_pode_administrar_acesso(a.id_org, a.papel)
  from bpo_fin.org_acessos a
  join auth.users u on u.id = a.user_auth_id
  left join bpo_fin.organizacoes o on o.id_org = a.id_org
  left join auth.users cp on cp.id = a.concedido_por
  left join auth.users rp on rp.id = a.revogado_por
  where auth.uid() is not null
    and (bpo_fin.fn_eh_dono() or a.user_auth_id = auth.uid()
         or (a.id_org is not null and bpo_fin.fn_pode(a.id_org, 'configurar_org')))
  order by a.ativo desc, o.nome nulls first, u.email, a.created_at desc
$$;

-- E-mail de quem aparece nas telas (equipe, executor/revisor): só de quem tem acesso a alguma org que eu vejo.
create function bpo_fin.fn_pessoas(p_ids uuid[]) returns table (user_auth_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email from auth.users u
  where u.id = any(p_ids) and auth.uid() is not null
    and (u.id = auth.uid() or bpo_fin.fn_eh_dono()
         or exists (select 1 from bpo_fin.donos d where d.user_auth_id = u.id)
         or exists (select 1 from bpo_fin.org_acessos a
                     where a.user_auth_id = u.id
                       and (a.id_org is null or a.id_org in (select bpo_fin.fn_orgs_visiveis()))))
$$;

revoke execute on function bpo_fin.fn_pode_administrar_acesso(uuid, text), bpo_fin.fn_conceder_acesso(text, uuid, text, text, timestamptz),
  bpo_fin.fn_revogar_acesso(uuid, text), bpo_fin.fn_listar_acessos(), bpo_fin.fn_pessoas(uuid[]) from public;
grant execute on function bpo_fin.fn_conceder_acesso(text, uuid, text, text, timestamptz),
  bpo_fin.fn_revogar_acesso(uuid, text), bpo_fin.fn_listar_acessos(), bpo_fin.fn_pessoas(uuid[]) to authenticated;

commit;
