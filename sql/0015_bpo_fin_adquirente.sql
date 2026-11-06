-- 0015 · Maquininha / adquirente (Stone, Cielo, Rede, PagSeguro, Getnet…) como ADAPTER, sem tabela nova.
-- Por quê: docs/PROMPT.md §5 — "adquirentes entram como novos adapters, sem tabela nova". A maquininha é uma CONTA
-- (tipo 'adquirente') e o arquivo dela é um EXTRATO, processado pelo worker como o OFX. Por dia, o worker gera:
--   vendas (+ bruto)  ·  taxa (− MDR)  ·  repasse ao banco (− líquido, na data do pagamento)
-- O repasse casa com o depósito no banco como TRANSFERÊNCIA entre contas; o saldo da conta da maquininha é a agenda
-- de recebíveis (o que ainda vai cair), conferido com o saldo que o próprio arquivo informa.
-- Esta migration só abre a porta: o upload aceita conexão 'arquivo_adquirente' (formato 'adquirente_csv') e o cadastro
-- cria conta com essa conexão. O resto é código do worker (apps/api/src/worker/adquirente.ts).
begin;

create or replace function bpo_fin.fn_registrar_extrato(p_id_conexao uuid, p_arquivo_nome text, p_conteudo_base64 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cx bpo_fin.conexoes%rowtype; v_bytes bytea; v_sha text; v_id uuid; v_job bigint; v_formato text;
begin
  select * into v_cx from bpo_fin.conexoes where id_conexao = p_id_conexao;
  if not found then raise exception 'conexão não encontrada'; end if;
  perform bpo_fin.fn_exigir(v_cx.id_org, 'importar');
  -- 0015: além do OFX do banco, o arquivo (CSV) da maquininha/adquirente
  if v_cx.metodo not in ('ofx', 'arquivo_adquirente') then raise exception 'esta conexão não recebe arquivo (método %)', v_cx.metodo; end if;
  v_formato := case v_cx.metodo when 'ofx' then 'ofx' else 'adquirente_csv' end;
  if v_cx.status = 'pausada' then raise exception 'conexão pausada: reative antes de importar'; end if;
  begin
    v_bytes := decode(p_conteudo_base64, 'base64');
  exception when others then
    raise exception 'arquivo ilegível';
  end;
  if v_bytes is null or length(v_bytes) = 0 then raise exception 'arquivo vazio'; end if;
  if length(v_bytes) > 5 * 1024 * 1024 then raise exception 'arquivo maior que 5 MB'; end if;
  v_sha := encode(sha256(v_bytes), 'hex');

  select e.id_extrato into v_id from bpo_fin.extratos e where e.id_conexao = p_id_conexao and e.arquivo_sha256 = v_sha;
  if found then
    return jsonb_build_object('id_extrato', v_id, 'duplicado', true, 'id_job', null);
  end if;

  insert into bpo_fin.extratos (id_org, id_conexao, origem, arquivo_nome, arquivo_sha256, payload, recebido_por)
  values (v_cx.id_org, p_id_conexao, case v_formato when 'ofx' then 'ofx' else 'adquirente' end, left(nullif(btrim(p_arquivo_nome), ''), 200), v_sha,
          jsonb_build_object('formato', v_formato, 'base64', p_conteudo_base64, 'bytes', length(v_bytes)), auth.uid())
  returning id_extrato into v_id;

  insert into bpo_fin.fila_jobs (tipo, id_org, payload)
  values ('processar_extrato', v_cx.id_org, jsonb_build_object('id_extrato', v_id))
  returning id_job into v_job;

  return jsonb_build_object('id_extrato', v_id, 'duplicado', false, 'id_job', v_job);
end $$;

create or replace function bpo_fin.fn_criar_conta(p_id_org uuid, p_id_entidade uuid, p_tipo text, p_instituicao text, p_apelido text,
  p_numero_final text, p_saldo_inicial numeric, p_data_saldo_inicial date, p_metodo text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'configurar_org');
  if p_apelido is null or length(btrim(p_apelido)) < 2 then raise exception 'apelido obrigatório'; end if;
  if p_instituicao is null or length(btrim(p_instituicao)) < 2 then raise exception 'instituição obrigatória'; end if;
  if p_data_saldo_inicial is null then raise exception 'data do saldo inicial obrigatória'; end if;
  if p_metodo is not null and p_metodo not in ('ofx', 'manual', 'arquivo_adquirente') then raise exception 'pela tela só OFX, arquivo da maquininha ou manual; API (Asaas) é configurada à parte'; end if;
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

commit;
