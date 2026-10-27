// Job processar_extrato: bronze (extratos.payload) → prata (movimentos) + saldo da fonte.
// Roda como vesso_fin_worker — sem acesso a título, baixa nem fechamento (GRANTs da 0001).
// Idempotente: reprocessar o mesmo extrato não cria nada (upsert por hash natural / FITID).
import type pg from 'pg'
import { comHash } from '@vesso-fin/shared/hash'
import { lerOfx, OfxInvalido } from './ofx'

/** Erro do arquivo ou do cadastro: tentar de novo não resolve. */
export class ErroPermanente extends Error {}

export interface ResultadoExtrato {
  lidas: number; novas: number; ja_existiam: number; removidas: number; reapareceram: number
  anteriores_ao_corte: number; zeradas: number; fitid_repetido: number
}

export async function processarExtrato(c: pg.ClientBase, idExtrato: string): Promise<ResultadoExtrato> {
  const { rows: [x] } = await c.query(
    `select e.id_extrato, e.id_org, e.payload, e.status, cx.id_conexao, cx.id_conta, ct.numero_final, o.competencia_inicial
       from bpo_fin.extratos e
       join bpo_fin.conexoes cx on cx.id_conexao = e.id_conexao
       join bpo_fin.contas ct on ct.id_conta = cx.id_conta
       join bpo_fin.organizacoes o on o.id_org = e.id_org
      where e.id_extrato = $1`, [idExtrato])
  if (!x) throw new ErroPermanente('extrato não encontrado')
  if (x.payload?.formato !== 'ofx' || typeof x.payload.base64 !== 'string') throw new ErroPermanente('extrato sem arquivo OFX no payload')

  let ofx
  try { ofx = lerOfx(Buffer.from(x.payload.base64, 'base64')) } catch (e) {
    if (e instanceof OfxInvalido) throw new ErroPermanente(e.message)
    throw e
  }

  // Arquivo da conta errada é o erro mais caro (dinheiro de um cliente no extrato de outro): recusa.
  if (x.numero_final && ofx.conta) {
    const so = (s: string) => s.replace(/[^0-9Xx]/g, '').toUpperCase()
    if (!so(ofx.conta).endsWith(so(x.numero_final)))
      throw new ErroPermanente(`o arquivo é da conta final ${so(ofx.conta).slice(-4)}, a conexão é da conta final ${x.numero_final}`)
  }

  // Antes da competência inicial é histórico (importação da 0002): não entra, senão duplica o legado.
  const corte: string | null = x.competencia_inicial
  const r: ResultadoExtrato = { lidas: ofx.transacoes.length, novas: 0, ja_existiam: 0, removidas: 0, reapareceram: 0, anteriores_ao_corte: 0, zeradas: 0, fitid_repetido: 0 }
  const validas = ofx.transacoes.filter((t) => {
    if (corte && t.data < corte) { r.anteriores_ao_corte++; return false }
    if (/^-?0*(\.0*)?$/.test(t.valor)) { r.zeradas++; return false }   // movimentos.valor <> 0
    return true
  })

  // FITID repetido no arquivo: só o primeiro guarda id_externo (o índice único é por conta+origem+FITID).
  const contFitid = new Map<string, number>()
  for (const t of validas) if (t.fitid) contFitid.set(t.fitid, (contFitid.get(t.fitid) ?? 0) + 1)
  const fitidUsado = new Set<string>()
  const linhas = comHash(validas.map((t) => ({ idConta: x.id_conta as string, data: t.data, valor: t.valor, descricao: t.descricao, t }))).map((l) => {
    let idExterno: string | null = null
    if (l.t.fitid && !fitidUsado.has(l.t.fitid)) { idExterno = l.t.fitid; fitidUsado.add(l.t.fitid) }
    if (l.t.fitid && (contFitid.get(l.t.fitid) ?? 0) > 1) r.fitid_repetido++
    return {
      id_externo: idExterno, hash_natural: l.hash, data_movimento: l.data, valor: l.valor,
      descricao_bruta: l.t.descricao, contraparte_nome: l.t.contraparte,
      payload_raw: { ofx: l.t.bruto, seq: l.seq, codificacao: ofx.codificacao },
    }
  })

  const { rows: novas } = await c.query(
    `insert into bpo_fin.movimentos (id_org, id_conta, id_extrato, origem, id_externo, hash_natural, data_movimento, valor,
                                     descricao_bruta, contraparte_nome, payload_raw)
     select $1, $2, $3, 'ofx', l.id_externo, l.hash_natural, l.data_movimento, l.valor, l.descricao_bruta, l.contraparte_nome, l.payload_raw
       from jsonb_to_recordset($4::jsonb) as l(id_externo text, hash_natural text, data_movimento date, valor numeric,
                                                descricao_bruta text, contraparte_nome text, payload_raw jsonb)
     on conflict do nothing
     returning id_movimento`, [x.id_org, x.id_conta, idExtrato, JSON.stringify(linhas)])
  r.novas = novas.length
  r.ja_existiam = linhas.length - novas.length

  // "Visto" = está no arquivo, pelo hash ou pelo FITID (o banco pode reescrever a descrição de uma linha).
  const hashes = linhas.map((l) => l.hash_natural)
  const fitids = linhas.map((l) => l.id_externo).filter((v): v is string => !!v)
  const visto = `id_conta = $1 and (hash_natural = any($2::text[]) or (origem = 'ofx' and id_externo = any($3::text[])))`
  r.reapareceram = (await c.query(
    `update bpo_fin.movimentos set removido_na_fonte_em = null, updated_at = now()
      where ${visto} and removido_na_fonte_em is not null`, [x.id_conta, hashes, fitids])).rowCount ?? 0

  // Sumiu da fonte: linha OFX da conta, dentro do período do arquivo (e depois do corte), que não veio de novo.
  if (ofx.periodo) {
    const ini = corte && corte > ofx.periodo.inicio ? corte : ofx.periodo.inicio
    r.removidas = (await c.query(
      `update bpo_fin.movimentos set removido_na_fonte_em = now(), updated_at = now()
        where id_conta = $1 and origem = 'ofx' and removido_na_fonte_em is null
          and data_movimento between $4 and $5
          and not (${visto.replace('id_conta = $1 and ', '')})`, [x.id_conta, hashes, fitids, ini, ofx.periodo.fim])).rowCount ?? 0
  }

  if (ofx.saldo) {
    await c.query(
      `insert into bpo_fin.saldos_extrato (id_conta, data, saldo, id_extrato) values ($1, $2, $3, $4)
       on conflict (id_conta, data) do update set saldo = excluded.saldo, id_extrato = excluded.id_extrato`,
      [x.id_conta, ofx.saldo.data, ofx.saldo.valor, idExtrato])
  }

  await c.query(
    `update bpo_fin.extratos set status = 'processado', processado_em = now(), erro_msg = null,
            linhas_lidas = $2, linhas_novas = $3, linhas_removidas = $4,
            periodo_inicio = $5, periodo_fim = $6, saldo_final_informado = $7, data_saldo_final = $8
      where id_extrato = $1`,
    [idExtrato, r.lidas, r.novas, r.removidas, ofx.periodo?.inicio ?? null, ofx.periodo?.fim ?? null, ofx.saldo?.valor ?? null, ofx.saldo?.data ?? null])

  const ultimo = linhas.reduce<string | null>((m, l) => (!m || l.data_movimento > m ? l.data_movimento : m), null)
  await c.query(
    `update bpo_fin.conexoes set ultima_importacao_em = now(), status = 'ativa', erro_msg = null,
            ultimo_movimento_em = greatest(ultimo_movimento_em, $2::date)
      where id_conexao = $1`, [x.id_conexao, ultimo])
  return r
}
