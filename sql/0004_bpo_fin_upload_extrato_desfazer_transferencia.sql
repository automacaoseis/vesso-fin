-- 0004 · Upload de extrato (OFX) pela API e desfazer transferência.
-- Por quê: na 0001 só o worker escreve em extratos/fila_jobs, e transferência não tinha reversão —
-- uma transferência registrada por engano ficava presa. As duas entradas são RPCs com checagem de
-- ação, como o resto (docs/PROMPT.md §2: "se algo parecer exigir service_role, a resposta é uma RPC").
-- Aplicada em produção em 26/10/2026 como 20261026153011_bpo_fin_0004_upload_extrato_desfazer_transferencia.
begin;

-- O arquivo bruto vai no payload (bronze imutável): o worker lê só do banco, sem Storage na Fase 1a.
-- O sha256 é calculado AQUI, sobre os bytes — o valor do cliente não é confiável.
-- Mesmo arquivo na mesma conexão = devolve o extrato existente com duplicado=true e não cria job
-- (a unique (id_conexao, arquivo_sha256) da 0001 impede uma 2ª linha com status 'duplicado').
create function bpo_fin.fn_registrar_extrato(p_id_conexao uuid, p_arquivo_nome text, p_conteudo_base64 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cx bpo_fin.conexoes%rowtype; v_bytes bytea; v_sha text; v_id uuid; v_job bigint;
begin
  select * into v_cx from bpo_fin.conexoes where id_conexao = p_id_conexao;
  if not found then raise exception 'conexão não encontrada'; end if;
  perform bpo_fin.fn_exigir(v_cx.id_org, 'importar');
  if v_cx.metodo <> 'ofx' then raise exception 'esta conexão não recebe arquivo OFX (método %)', v_cx.metodo; end if;
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
  values (v_cx.id_org, p_id_conexao, 'ofx', left(nullif(btrim(p_arquivo_nome), ''), 200), v_sha,
          jsonb_build_object('formato', 'ofx', 'base64', p_conteudo_base64, 'bytes', length(v_bytes)), auth.uid())
  returning id_extrato into v_id;

  insert into bpo_fin.fila_jobs (tipo, id_org, payload)
  values ('processar_extrato', v_cx.id_org, jsonb_build_object('id_extrato', v_id))
  returning id_job into v_job;

  return jsonb_build_object('id_extrato', v_id, 'duplicado', false, 'id_job', v_job);
end $$;

-- Reverter transferência: marca revertida (nunca apaga). O trigger transferencia_valida da 0001
-- já recusa UPDATE em mês fechado/liberado, então a trava de mês vale aqui sem código novo.
create function bpo_fin.fn_desfazer_transferencia(p_id_transferencia uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_rev timestamptz;
begin
  select t.id_org, t.revertida_em into v_org, v_rev from bpo_fin.transferencias t where t.id_transferencia = p_id_transferencia;
  if v_org is null then raise exception 'transferência não encontrada'; end if;
  perform bpo_fin.fn_exigir(v_org, 'conciliar');
  if v_rev is not null then raise exception 'transferência já revertida'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'motivo obrigatório'; end if;
  update bpo_fin.transferencias set revertida_em = now(), revertida_por = auth.uid(), motivo_reversao = p_motivo
   where id_transferencia = p_id_transferencia;
end $$;

revoke execute on function bpo_fin.fn_registrar_extrato(uuid, text, text), bpo_fin.fn_desfazer_transferencia(uuid, text) from public;
grant execute on function bpo_fin.fn_registrar_extrato(uuid, text, text), bpo_fin.fn_desfazer_transferencia(uuid, text) to authenticated;

-- O período e o saldo final saem do arquivo, que só o worker lê. Derivados do payload imutável;
-- o trigger extrato_imutavel continua barrando payload, sha, storage_path e conexão.
grant update (periodo_inicio, periodo_fim, saldo_final_informado, data_saldo_final) on bpo_fin.extratos to vesso_fin_worker;

commit;
