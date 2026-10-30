-- 0011 · Cadastro mínimo (organização, entidade, conta + conexão, plano copiado) e org da casa no portal.
-- Por quê: docs/PROMPT.md §7 — "cadastro mínimo" entra na Fase 1b, quando cadastrar por SQL começa a doer.
-- E o Luiz decidiu (30/10) que a Agência Seis (org CASA, com o histórico importado) é a primeira a aparecer no
-- portal, pelo cliente "Seis e Marketing (comercial interno)".
-- Desenho:
--   · id_cliente segue sendo "é cliente do BPO" (a CHECK da 0001 continua: casa nunca tem id_cliente, então não
--     conta como cliente em lugar nenhum). A ligação com o portal é uma coluna NOVA, id_cliente_portal, só para
--     org casa, que só o dono mexe. fn_cliente_portal (0010) passa a olhar as duas.
--   · criar organização: dono (qualquer tipo) ou head global (só 'cliente'). Nasce 'onboarding', com a entidade
--     (CNPJ) e o plano de contas copiado de um modelo OU de outra org que quem cria enxerga.
--   · entidade, conta e conexão (ofx/manual — asaas_api pede segredo no Vault, segue por SQL): 'configurar_org'.
--   · nada é apagado: conta sai com desativar (o checklist ignora conta inativa); org sai com status 'encerrada'.
begin;

alter table bpo_fin.organizacoes
  add column id_cliente_portal uuid unique references app_seis.clientes(id_cliente),
  add constraint org_portal_so_casa check (id_cliente_portal is null or tipo = 'casa');

create trigger auditar after insert or update on bpo_fin.organizacoes for each row execute function bpo_fin.tg_auditar('id_org');
create trigger auditar after insert or update on bpo_fin.entidades    for each row execute function bpo_fin.tg_auditar('id_entidade');

-- portal (0010): org cliente pelo id_cliente OU org casa ligada pelo id_cliente_portal
create or replace function bpo_fin.fn_cliente_portal() returns table (id_org uuid, nome text, papel text)
language sql stable security definer set search_path = '' as $$
  select o.id_org, o.nome, ca.tipo
  from app_seis.cliente_acessos ca
  join bpo_fin.organizacoes o on (o.id_cliente = ca.id_cliente or o.id_cliente_portal = ca.id_cliente)
                             and o.status in ('onboarding', 'ativa')
  where ca.user_auth_id = auth.uid() and ca.ativo
  order by ca.tipo = 'titular' desc
  limit 1
$$;

-- quem cadastra organização: dono, ou head com acesso global ativo
create function bpo_fin.fn_pode_cadastrar() returns boolean
language sql stable security definer set search_path = '' as $$
  select bpo_fin.fn_eh_dono() or exists (
    select 1 from bpo_fin.org_acessos a
    where a.user_auth_id = auth.uid() and a.ativo and a.id_org is null and a.papel = 'head'
      and (a.expira_em is null or a.expira_em > now()))
$$;

create function bpo_fin.fn_criar_organizacao(p_nome text, p_tipo text, p_id_cliente uuid,
  p_razao_social text, p_nome_fantasia text, p_cnpj text, p_regime text,
  p_competencia_inicial date, p_turma text, p_copiar_plano_de uuid default null, p_id_modelo uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
begin
  if auth.uid() is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  if not bpo_fin.fn_pode_cadastrar() then raise exception 'só o dono ou o head do produto cadastram organização' using errcode = '42501'; end if;
  if p_tipo = 'casa' and not bpo_fin.fn_eh_dono() then raise exception 'empresa da casa só o dono cadastra' using errcode = '42501'; end if;
  if p_nome is null or length(btrim(p_nome)) < 2 then raise exception 'nome obrigatório'; end if;
  if p_tipo = 'cliente' and p_id_cliente is null then raise exception 'organização cliente precisa estar ligada ao cliente do portal'; end if;
  if p_tipo = 'casa' and p_id_cliente is not null then raise exception 'empresa da casa não é cliente'; end if;
  if p_id_cliente is not null and exists (select 1 from bpo_fin.organizacoes where id_cliente = p_id_cliente or id_cliente_portal = p_id_cliente) then
    raise exception 'esse cliente já tem organização no BPO';
  end if;
  if length(v_cnpj) <> 14 then raise exception 'CNPJ com 14 dígitos'; end if;
  if p_copiar_plano_de is not null and p_id_modelo is not null then raise exception 'escolha modelo OU organização para copiar o plano'; end if;
  if p_copiar_plano_de is not null and p_copiar_plano_de not in (select bpo_fin.fn_orgs_visiveis()) then
    raise exception 'sem acesso à organização de onde copiar o plano' using errcode = '42501';
  end if;

  insert into bpo_fin.organizacoes (nome, tipo, id_cliente, status, turma_fechamento, competencia_inicial)
  values (btrim(p_nome), p_tipo, p_id_cliente, 'onboarding', p_turma, date_trunc('month', p_competencia_inicial)::date)
  returning id_org into v_org;
  insert into bpo_fin.entidades (id_org, razao_social, nome_fantasia, cnpj, regime_tributario)
  values (v_org, btrim(coalesce(nullif(btrim(p_razao_social), ''), p_nome)), nullif(btrim(p_nome_fantasia), ''), v_cnpj, p_regime);

  if p_copiar_plano_de is not null or p_id_modelo is not null then
    insert into bpo_fin.plano_contas (id_org, codigo, nome, natureza, aceita_lancamento, entra_dre, entra_dfc, grupo_dfc,
                                      linha_dre, ordem_dre, regra_competencia, generica, sensivel, ativa)
    select v_org, codigo, nome, natureza, aceita_lancamento, entra_dre, entra_dfc, grupo_dfc,
           linha_dre, ordem_dre, regra_competencia, generica, sensivel, ativa
    from bpo_fin.plano_contas
    where (p_copiar_plano_de is not null and id_org = p_copiar_plano_de) or (p_id_modelo is not null and id_modelo = p_id_modelo);
    -- pai pelo código (único no plano de origem e no novo)
    update bpo_fin.plano_contas n set id_pai = np.id_plano_conta
      from bpo_fin.plano_contas o
      join bpo_fin.plano_contas op on op.id_plano_conta = o.id_pai
      join bpo_fin.plano_contas np on np.id_org = v_org and np.codigo = op.codigo
     where n.id_org = v_org and o.codigo = n.codigo
       and ((p_copiar_plano_de is not null and o.id_org = p_copiar_plano_de) or (p_id_modelo is not null and o.id_modelo = p_id_modelo));
  end if;
  return v_org;
end $$;

create function bpo_fin.fn_atualizar_organizacao(p_id_org uuid, p_nome text, p_status text, p_turma text, p_competencia_inicial date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform bpo_fin.fn_exigir(p_id_org, 'configurar_org');
  if p_nome is null or length(btrim(p_nome)) < 2 then raise exception 'nome obrigatório'; end if;
  if exists (select 1 from bpo_fin.fechamento_mensal f where f.id_org = p_id_org and f.status in ('fechado', 'liberado')
               and f.competencia >= date_trunc('month', p_competencia_inicial)::date
               and f.competencia < (select o.competencia_inicial from bpo_fin.organizacoes o where o.id_org = p_id_org)) then
    raise exception 'há mês fechado entre a competência nova e a atual: reabra antes';
  end if;
  update bpo_fin.organizacoes set nome = btrim(p_nome), status = p_status, turma_fechamento = p_turma,
         competencia_inicial = date_trunc('month', p_competencia_inicial)::date, updated_at = now()
   where id_org = p_id_org;
end $$;

-- org da casa aparece no portal de um cliente (só o dono). p_id_cliente nulo = desliga.
create function bpo_fin.fn_ligar_portal(p_id_org uuid, p_id_cliente uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tipo text;
begin
  if not bpo_fin.fn_eh_dono() then raise exception 'só o dono liga empresa da casa ao portal' using errcode = '42501'; end if;
  select tipo into v_tipo from bpo_fin.organizacoes where id_org = p_id_org;
  if v_tipo is null then raise exception 'organização não encontrada'; end if;
  if v_tipo <> 'casa' then raise exception 'organização cliente já aparece no portal pelo próprio cliente'; end if;
  if p_id_cliente is not null and exists (select 1 from bpo_fin.organizacoes where (id_cliente = p_id_cliente or id_cliente_portal = p_id_cliente) and id_org <> p_id_org) then
    raise exception 'esse cliente já tem organização no BPO';
  end if;
  update bpo_fin.organizacoes set id_cliente_portal = p_id_cliente, updated_at = now() where id_org = p_id_org;
end $$;

-- clientes do portal para ligar (dono/head global). Mostra se já têm organização.
create function bpo_fin.fn_buscar_clientes(p_q text) returns table (id_cliente uuid, nome text, id_org uuid, organizacao text)
language sql stable security definer set search_path = '' as $$
  select c.id_cliente, c.nome_principal, o.id_org, o.nome
  from app_seis.clientes c
  left join bpo_fin.organizacoes o on o.id_cliente = c.id_cliente or o.id_cliente_portal = c.id_cliente
  where bpo_fin.fn_pode_cadastrar() and length(btrim(coalesce(p_q, ''))) >= 2
    and c.nome_principal ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%'
  order by c.nome_principal
  limit 20
$$;

-- nome do cliente do portal ligado a uma org que eu vejo (a equipe não lê app_seis.clientes)
create function bpo_fin.fn_cliente_da_org(p_id_org uuid) returns table (id_cliente uuid, nome text, via text)
language sql stable security definer set search_path = '' as $$
  select c.id_cliente, c.nome_principal, case when o.id_cliente is not null then 'cliente' else 'portal' end
  from bpo_fin.organizacoes o join app_seis.clientes c on c.id_cliente = coalesce(o.id_cliente, o.id_cliente_portal)
  where o.id_org = p_id_org and o.id_org in (select bpo_fin.fn_orgs_visiveis())
$$;

create function bpo_fin.fn_criar_entidade(p_id_org uuid, p_razao_social text, p_nome_fantasia text, p_cnpj text, p_regime text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
begin
  perform bpo_fin.fn_exigir(p_id_org, 'configurar_org');
  if length(v_cnpj) <> 14 then raise exception 'CNPJ com 14 dígitos'; end if;
  if p_razao_social is null or length(btrim(p_razao_social)) < 2 then raise exception 'razão social obrigatória'; end if;
  insert into bpo_fin.entidades (id_org, razao_social, nome_fantasia, cnpj, regime_tributario)
  values (p_id_org, btrim(p_razao_social), nullif(btrim(p_nome_fantasia), ''), v_cnpj, p_regime)
  returning id_entidade into v_id;
  return v_id;
end $$;

-- conta + conexão (ofx | manual | nenhuma). asaas_api precisa do segredo no Vault: segue por SQL (docs/pos-importacao.sql).
create function bpo_fin.fn_criar_conta(p_id_org uuid, p_id_entidade uuid, p_tipo text, p_instituicao text, p_apelido text,
  p_numero_final text, p_saldo_inicial numeric, p_data_saldo_inicial date, p_metodo text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'configurar_org');
  if p_apelido is null or length(btrim(p_apelido)) < 2 then raise exception 'apelido obrigatório'; end if;
  if p_instituicao is null or length(btrim(p_instituicao)) < 2 then raise exception 'instituição obrigatória'; end if;
  if p_data_saldo_inicial is null then raise exception 'data do saldo inicial obrigatória'; end if;
  if p_metodo is not null and p_metodo not in ('ofx', 'manual') then raise exception 'pela tela só OFX ou manual; API (Asaas) é configurada à parte'; end if;
  if exists (select 1 from bpo_fin.contas c where c.id_org = p_id_org and lower(c.apelido) = lower(btrim(p_apelido)) and c.ativa) then
    raise exception 'já existe conta ativa com esse apelido';
  end if;
  insert into bpo_fin.contas (id_org, id_entidade, tipo, instituicao, apelido, numero_final, saldo_inicial, data_saldo_inicial)
  values (p_id_org, p_id_entidade, p_tipo, btrim(p_instituicao), btrim(p_apelido), nullif(btrim(p_numero_final), ''),
          coalesce(round(p_saldo_inicial, 2), 0), p_data_saldo_inicial)
  returning id_conta into v_id;
  if p_metodo is not null then
    insert into bpo_fin.conexoes (id_org, id_conta, metodo) values (p_id_org, v_id, p_metodo);
  end if;
  return v_id;
end $$;

create function bpo_fin.fn_desativar_conta(p_id_conta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select id_org into v_org from bpo_fin.contas where id_conta = p_id_conta and ativa;
  if v_org is null then raise exception 'conta não encontrada ou já inativa'; end if;
  perform bpo_fin.fn_exigir(v_org, 'configurar_org');
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'motivo obrigatório (5+ caracteres)'; end if;
  update bpo_fin.contas set ativa = false where id_conta = p_id_conta;
  update bpo_fin.conexoes set status = 'pausada', erro_msg = 'conta desativada: ' || btrim(p_motivo) where id_conta = p_id_conta;
end $$;

revoke execute on function bpo_fin.fn_pode_cadastrar(),
  bpo_fin.fn_criar_organizacao(text, text, uuid, text, text, text, text, date, text, uuid, uuid),
  bpo_fin.fn_atualizar_organizacao(uuid, text, text, text, date), bpo_fin.fn_ligar_portal(uuid, uuid),
  bpo_fin.fn_buscar_clientes(text), bpo_fin.fn_cliente_da_org(uuid), bpo_fin.fn_criar_entidade(uuid, text, text, text, text),
  bpo_fin.fn_criar_conta(uuid, uuid, text, text, text, text, numeric, date, text), bpo_fin.fn_desativar_conta(uuid, text) from public;
grant execute on function bpo_fin.fn_pode_cadastrar(),
  bpo_fin.fn_criar_organizacao(text, text, uuid, text, text, text, text, date, text, uuid, uuid),
  bpo_fin.fn_atualizar_organizacao(uuid, text, text, text, date), bpo_fin.fn_ligar_portal(uuid, uuid),
  bpo_fin.fn_buscar_clientes(text), bpo_fin.fn_cliente_da_org(uuid), bpo_fin.fn_criar_entidade(uuid, text, text, text, text),
  bpo_fin.fn_criar_conta(uuid, uuid, text, text, text, text, numeric, date, text), bpo_fin.fn_desativar_conta(uuid, text) to authenticated;

commit;
