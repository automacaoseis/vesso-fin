-- 0009 · Documentos e pendências: pedir ao cliente, receber o arquivo (bucket bpo-fin), validar ou recusar.
-- Por quê: a 0001 criou bpo_fin.documentos (e o item do checklist "documentos pedidos e não recebidos"), mas sem
-- nenhuma entrada — nem o bucket. docs/PROMPT.md §7 (Fase 1b): "bucket bpo-fin com policy por prefixo id_org/".
-- Desenho:
--   · o arquivo vai para storage.objects em 'bpo-fin/<id_org>/<aaaa-mm>/<uuid>-<nome>' — subido pela API com o JWT
--     do próprio usuário (sem service_role); a policy de INSERT exige a ação 'importar' na org do 1º segmento;
--     a de SELECT, org visível. Sem UPDATE/DELETE: arquivo recebido não some (recusar = pedir de novo).
--   · recusar volta o documento para 'pedido' com o motivo (o item do checklist volta a bloquear); o caminho
--     recusado fica no log de auditoria. Dispensar = apagar um PEDIDO sem arquivo (feito por engano), com log.
--   · pedir/validar/recusar/dispensar exigem 'lancar'; anexar/registrar exigem 'importar'.
begin;

alter table bpo_fin.documentos
  add column arquivo_nome   text,
  add column arquivo_bytes  int,
  add column arquivo_mime   text,
  add column recebido_por   uuid,
  add column motivo_recusa  text;

create trigger auditar after insert or update on bpo_fin.documentos for each row execute function bpo_fin.tg_auditar('id_documento');

-- 1º segmento do caminho como id_org (NULL se não for uuid — a policy nega em vez de dar erro de cast)
create function bpo_fin.fn_org_do_caminho(p_nome text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then split_part(p_nome, '/', 1)::uuid end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bpo-fin', 'bpo-fin', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'text/xml', 'application/xml',
              'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/x-ofx', 'application/octet-stream', 'text/plain'])
on conflict (id) do nothing;

create policy bpo_fin_ler on storage.objects for select to authenticated
  using (bucket_id = 'bpo-fin' and bpo_fin.fn_org_do_caminho(name) in (select bpo_fin.fn_orgs_visiveis()));
create policy bpo_fin_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'bpo-fin' and bpo_fin.fn_org_do_caminho(name) is not null
              and bpo_fin.fn_pode(bpo_fin.fn_org_do_caminho(name), 'importar'));

create function bpo_fin.fn_pedir_documento(p_id_org uuid, p_tipo text, p_descricao text,
  p_competencia date default null, p_id_titulo uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'lancar');
  if p_descricao is null or length(btrim(p_descricao)) < 3 then raise exception 'descreva o documento'; end if;
  insert into bpo_fin.documentos (id_org, id_titulo, tipo, competencia, descricao, status, pedido_em, pedido_por)
  values (p_id_org, p_id_titulo, p_tipo, date_trunc('month', p_competencia)::date, btrim(p_descricao), 'pedido', now(), auth.uid())
  returning id_documento into v_id;
  return v_id;
end $$;

-- arquivo chegou para um pedido existente
create function bpo_fin.fn_anexar_documento(p_id_documento uuid, p_storage_path text, p_nome text, p_bytes int, p_mime text) returns void
language plpgsql security definer set search_path = '' as $$
declare v bpo_fin.documentos%rowtype;
begin
  select * into v from bpo_fin.documentos where id_documento = p_id_documento;
  if not found then raise exception 'documento não encontrado'; end if;
  perform bpo_fin.fn_exigir(v.id_org, 'importar');
  if v.status <> 'pedido' then raise exception 'este documento já foi recebido'; end if;
  if bpo_fin.fn_org_do_caminho(p_storage_path) is distinct from v.id_org then raise exception 'arquivo fora da pasta da organização'; end if;
  update bpo_fin.documentos set status = 'recebido', storage_path = p_storage_path, arquivo_nome = left(p_nome, 200),
         arquivo_bytes = p_bytes, arquivo_mime = left(p_mime, 100), recebido_em = now(), recebido_por = auth.uid(), motivo_recusa = null
   where id_documento = p_id_documento;
end $$;

-- arquivo avulso (sem pedido antes): já nasce recebido
create function bpo_fin.fn_registrar_documento(p_id_org uuid, p_tipo text, p_descricao text, p_competencia date, p_id_titulo uuid,
  p_storage_path text, p_nome text, p_bytes int, p_mime text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'importar');
  if p_descricao is null or length(btrim(p_descricao)) < 3 then raise exception 'descreva o documento'; end if;
  if bpo_fin.fn_org_do_caminho(p_storage_path) is distinct from p_id_org then raise exception 'arquivo fora da pasta da organização'; end if;
  insert into bpo_fin.documentos (id_org, id_titulo, tipo, competencia, descricao, status, storage_path, arquivo_nome, arquivo_bytes,
                                  arquivo_mime, recebido_em, recebido_por)
  values (p_id_org, p_id_titulo, p_tipo, date_trunc('month', p_competencia)::date, btrim(p_descricao), 'recebido', p_storage_path,
          left(p_nome, 200), p_bytes, left(p_mime, 100), now(), auth.uid())
  returning id_documento into v_id;
  return v_id;
end $$;

create function bpo_fin.fn_validar_documento(p_id_documento uuid, p_aprovar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v bpo_fin.documentos%rowtype;
begin
  select * into v from bpo_fin.documentos where id_documento = p_id_documento;
  if not found then raise exception 'documento não encontrado'; end if;
  perform bpo_fin.fn_exigir(v.id_org, 'lancar');
  if v.status <> 'recebido' then raise exception 'só documento recebido pode ser validado ou recusado'; end if;
  if p_aprovar then
    update bpo_fin.documentos set status = 'validado', validado_por = auth.uid() where id_documento = p_id_documento;
  else
    if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'diga por que recusou (5+ caracteres)'; end if;
    -- volta a ser pedido: o checklist volta a cobrar; o arquivo recusado fica no storage e no log
    update bpo_fin.documentos set status = 'pedido', motivo_recusa = btrim(p_motivo), storage_path = null, arquivo_nome = null,
           arquivo_bytes = null, arquivo_mime = null, recebido_em = null, recebido_por = null,
           pedido_em = coalesce(pedido_em, now()), pedido_por = coalesce(pedido_por, auth.uid())
     where id_documento = p_id_documento;
  end if;
end $$;

create function bpo_fin.fn_dispensar_documento(p_id_documento uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v bpo_fin.documentos%rowtype;
begin
  select * into v from bpo_fin.documentos where id_documento = p_id_documento;
  if not found then raise exception 'documento não encontrado'; end if;
  perform bpo_fin.fn_exigir(v.id_org, 'lancar');
  if v.status <> 'pedido' then raise exception 'só pedido ainda sem arquivo pode ser dispensado'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'motivo obrigatório (5+ caracteres)'; end if;
  insert into bpo_fin.log_eventos (id_org, tabela, id_registro, acao, antes, depois, por)
  values (v.id_org, 'documentos', v.id_documento::text, 'dispensar', to_jsonb(v), jsonb_build_object('motivo', btrim(p_motivo)), auth.uid());
  delete from bpo_fin.documentos where id_documento = p_id_documento;
end $$;

revoke execute on function bpo_fin.fn_pedir_documento(uuid, text, text, date, uuid),
  bpo_fin.fn_anexar_documento(uuid, text, text, int, text),
  bpo_fin.fn_registrar_documento(uuid, text, text, date, uuid, text, text, int, text),
  bpo_fin.fn_validar_documento(uuid, boolean, text), bpo_fin.fn_dispensar_documento(uuid, text) from public;
grant execute on function bpo_fin.fn_pedir_documento(uuid, text, text, date, uuid),
  bpo_fin.fn_anexar_documento(uuid, text, text, int, text),
  bpo_fin.fn_registrar_documento(uuid, text, text, date, uuid, text, text, int, text),
  bpo_fin.fn_validar_documento(uuid, boolean, text), bpo_fin.fn_dispensar_documento(uuid, text) to authenticated;
-- a policy do storage roda como o usuário: precisa executar o helper
grant execute on function bpo_fin.fn_org_do_caminho(text) to authenticated;

commit;
