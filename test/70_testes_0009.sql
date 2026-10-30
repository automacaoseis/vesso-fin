\set ON_ERROR_STOP 1
-- Testes da 0009. Banco NOVO: stubs (com storage) + 0001 + 0003..0005 + 0007..0009 + apps/api/test/seed.sql.
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
-- a1 analista (B) · a2 revisor (B) · c1 gestor sem acesso · B = '…0b', A (casa) = '…0a'

-- 1. PEDIR ───────────────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
insert into public.r select 'p1', to_jsonb(bpo_fin.fn_pedir_documento('20000000-0000-0000-0000-00000000000b', 'nf', 'NF do aluguel de setembro', '2026-09-15'));
select checar((select status = 'pedido' and competencia = '2026-09-01' and pedido_por = '00000000-0000-0000-0000-0000000000a1'
               from bpo_fin.documentos where id_documento = (select (v #>> '{}')::uuid from public.r where k = 'p1')), 'analista pede; competência vira dia 1');
select checar((select not ok and detalhe = '1 pendentes' from bpo_fin.fn_checklist_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01')
               where item = 'documentos pedidos e não recebidos'), 'checklist conta o pedido');
select esperar_erro($$select bpo_fin.fn_pedir_documento('20000000-0000-0000-0000-00000000000b', 'nf', 'x')$$, 'descreva');
select esperar_erro($$select bpo_fin.fn_pedir_documento('20000000-0000-0000-0000-00000000000b', 'selfie', 'tipo errado')$$, 'documentos_tipo_check');
select como('00000000-0000-0000-0000-0000000000c1');
select esperar_erro($$select bpo_fin.fn_pedir_documento('20000000-0000-0000-0000-00000000000b', 'nf', 'sem acesso')$$, 'sem permissão');

-- 2. STORAGE: policy por prefixo id_org/ ────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
insert into storage.objects (bucket_id, name) values ('bpo-fin', '20000000-0000-0000-0000-00000000000b/2026-09/a-nf.pdf');
select checar(true, 'analista sobe arquivo na pasta da própria org');
select esperar_erro($$insert into storage.objects (bucket_id, name) values ('bpo-fin', '20000000-0000-0000-0000-00000000000a/2026-09/x.pdf')$$, 'row-level security');
select esperar_erro($$insert into storage.objects (bucket_id, name) values ('bpo-fin', 'qualquer/coisa.pdf')$$, 'row-level security');
select esperar_erro($$insert into storage.objects (bucket_id, name) values ('outro', '20000000-0000-0000-0000-00000000000b/x.pdf')$$, 'row-level security');
select como('00000000-0000-0000-0000-0000000000a2');
select checar((select count(*) = 1 from storage.objects where bucket_id = 'bpo-fin'), 'revisor da org lê o arquivo');
select como('00000000-0000-0000-0000-0000000000c1');
select checar((select count(*) = 0 from storage.objects where bucket_id = 'bpo-fin'), 'quem não vê a org não lê o arquivo');
select esperar_erro($$insert into storage.objects (bucket_id, name) values ('bpo-fin', '20000000-0000-0000-0000-00000000000b/2026-09/z.pdf')$$, 'row-level security');

-- 3. ANEXAR, RECUSAR, ANEXAR DE NOVO, VALIDAR ─────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro(format($$select bpo_fin.fn_anexar_documento(%L, '20000000-0000-0000-0000-00000000000a/2026-09/a.pdf', 'a.pdf', 10, 'application/pdf')$$,
                    (select v #>> '{}' from public.r where k = 'p1')), 'fora da pasta');
select bpo_fin.fn_anexar_documento((select (v #>> '{}')::uuid from public.r where k = 'p1'), '20000000-0000-0000-0000-00000000000b/2026-09/a-nf.pdf', 'nf.pdf', 1234, 'application/pdf');
select checar((select status = 'recebido' and arquivo_nome = 'nf.pdf' and recebido_por = '00000000-0000-0000-0000-0000000000a1'
               from bpo_fin.documentos where id_documento = (select (v #>> '{}')::uuid from public.r where k = 'p1')), 'anexar marca recebido');
select checar((select ok from bpo_fin.fn_checklist_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01') where item = 'documentos pedidos e não recebidos'), 'checklist libera');
select esperar_erro(format($$select bpo_fin.fn_anexar_documento(%L, '20000000-0000-0000-0000-00000000000b/2026-09/b.pdf', 'b.pdf', 1, 'application/pdf')$$,
                    (select v #>> '{}' from public.r where k = 'p1')), 'já foi recebido');
select esperar_erro(format($$select bpo_fin.fn_validar_documento(%L, false, 'ruim')$$, (select v #>> '{}' from public.r where k = 'p1')), 'por que recusou');
select bpo_fin.fn_validar_documento((select (v #>> '{}')::uuid from public.r where k = 'p1'), false, 'NF ilegível, mandar de novo');
select checar((select status = 'pedido' and storage_path is null and motivo_recusa = 'NF ilegível, mandar de novo'
               from bpo_fin.documentos where id_documento = (select (v #>> '{}')::uuid from public.r where k = 'p1')), 'recusar volta para pedido com motivo');
select checar((select not ok from bpo_fin.fn_checklist_fechamento('20000000-0000-0000-0000-00000000000b', '2026-09-01') where item = 'documentos pedidos e não recebidos'), 'checklist volta a cobrar');
reset role;
select checar((select count(*) >= 1 from bpo_fin.log_eventos where tabela = 'documentos' and antes ->> 'storage_path' like '%a-nf.pdf'), 'caminho recusado fica no log');
select como('00000000-0000-0000-0000-0000000000a1');
select bpo_fin.fn_anexar_documento((select (v #>> '{}')::uuid from public.r where k = 'p1'), '20000000-0000-0000-0000-00000000000b/2026-09/a-nf.pdf', 'nf2.pdf', 999, 'application/pdf');
select como('00000000-0000-0000-0000-0000000000a2');
select bpo_fin.fn_validar_documento((select (v #>> '{}')::uuid from public.r where k = 'p1'), true);
select checar((select status = 'validado' and validado_por = '00000000-0000-0000-0000-0000000000a2' and motivo_recusa is null
               from bpo_fin.documentos where id_documento = (select (v #>> '{}')::uuid from public.r where k = 'p1')), 'revisor valida');
select esperar_erro(format($$select bpo_fin.fn_validar_documento(%L, true)$$, (select v #>> '{}' from public.r where k = 'p1')), 'só documento recebido');

-- 4. AVULSO e DISPENSAR ─────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000a1');
insert into public.r select 'av', to_jsonb(bpo_fin.fn_registrar_documento('20000000-0000-0000-0000-00000000000b', 'boleto', 'Boleto do contador', '2026-10-01', null,
  '20000000-0000-0000-0000-00000000000b/2026-10/c.pdf', 'boleto.pdf', 50, 'application/pdf'));
select checar((select status = 'recebido' from bpo_fin.documentos where id_documento = (select (v #>> '{}')::uuid from public.r where k = 'av')), 'arquivo avulso nasce recebido');
select esperar_erro($$select bpo_fin.fn_registrar_documento('20000000-0000-0000-0000-00000000000b', 'nf', 'pasta errada', null, null, 'xx/c.pdf', 'c.pdf', 1, 'application/pdf')$$, 'fora da pasta');
insert into public.r select 'p2', to_jsonb(bpo_fin.fn_pedir_documento('20000000-0000-0000-0000-00000000000b', 'contrato', 'Contrato errado'));
select esperar_erro(format($$select bpo_fin.fn_dispensar_documento(%L, 'oi')$$, (select v #>> '{}' from public.r where k = 'p2')), 'motivo obrigatório');
select bpo_fin.fn_dispensar_documento((select (v #>> '{}')::uuid from public.r where k = 'p2'), 'pedido por engano');
select checar((select count(*) = 0 from bpo_fin.documentos where id_documento = (select (v #>> '{}')::uuid from public.r where k = 'p2')), 'dispensar apaga o pedido');
select esperar_erro(format($$select bpo_fin.fn_dispensar_documento(%L, 'já tem arquivo')$$, (select v #>> '{}' from public.r where k = 'av')), 'só pedido');
select esperar_erro($$delete from bpo_fin.documentos$$, 'permission denied');
reset role;
select checar((select count(*) = 1 from bpo_fin.log_eventos where tabela = 'documentos' and acao = 'dispensar' and depois ->> 'motivo' = 'pedido por engano'), 'dispensa fica no log');

select checar(true, 'TODOS OS TESTES DA 0009 PASSARAM');
