// Job sync_asaas: extrato do Asaas por API → bronze (extratos) + prata (movimentos) + saldo.
// Endpoints conferidos na documentação em 27/10/2026 (docs.asaas.com):
//   GET {base}/financialTransactions?startDate&finishDate&offset&limit(≤100)&order=asc → { data[], hasMore }
//   GET {base}/finance/balance → { balance }
//   cabeçalhos: access_token (a chave) e User-Agent (obrigatório para contas criadas após 13/06/2024)
// ⚠️ id_externo = o id do Asaas ("ftn_…"), o MESMO que a importação da 0002 gravou a partir do
//    financeiro_seis.extrato_asaas — é o que impede o sync de duplicar o histórico.
// ⚠️ O seq do hash segue a 0002: linhas idênticas ordenadas pelo id.
import { createHash } from 'node:crypto'
import type pg from 'pg'
import { comHash } from '@vesso-fin/shared/hash'
import { ErroPermanente } from './processar-extrato'

export const ASAAS_BASE = process.env.ASAAS_BASE_URL ?? 'https://api.asaas.com/v3'
const USER_AGENT = 'vesso-fin/1.0'

export interface TransacaoAsaas { id: string; value: number; balance?: number; type?: string; date: string; description?: string | null; [k: string]: unknown }

async function asaas<T>(base: string, chave: string, caminho: string): Promise<T> {
  const r = await fetch(`${base}${caminho}`, {
    headers: { access_token: chave, 'User-Agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (r.status === 401 || r.status === 403) throw new ErroPermanente(`Asaas recusou a chave (HTTP ${r.status}) — confira o segredo no Vault`)
  if (!r.ok) throw new Error(`Asaas respondeu HTTP ${r.status} em ${caminho.split('?')[0]}`)  // 429/5xx: tenta de novo depois
  return (await r.json()) as T
}

export async function buscarAsaas(base: string, chave: string, de: string, ate: string) {
  const transacoes: TransacaoAsaas[] = []
  for (let offset = 0; ; offset += 100) {
    const p = await asaas<{ data: TransacaoAsaas[]; hasMore: boolean }>(base, chave,
      `/financialTransactions?startDate=${de}&finishDate=${ate}&offset=${offset}&limit=100&order=asc`)
    transacoes.push(...p.data)
    if (!p.hasMore || p.data.length === 0) break
    if (offset > 50_000) throw new Error('paginação do Asaas não terminou (mais de 50 mil linhas)')
  }
  const { balance } = await asaas<{ balance: number }>(base, chave, '/finance/balance')
  return { transacoes, saldo: balance }
}

/** Saldo de fim de dia a partir do `balance` de cada transação — só se a cadeia fecha (ordem confiável). */
export function saldosPorDia(ts: TransacaoAsaas[]): { data: string; saldo: number }[] {
  const c = (v: number) => Math.round(v * 100)
  for (let i = 1; i < ts.length; i++) {
    const a = ts[i - 1]!, b = ts[i]!
    if (a.balance == null || b.balance == null || c(a.balance) + c(b.value) !== c(b.balance)) return []
  }
  const fim = new Map<string, number>()
  for (const t of ts) if (t.balance != null) fim.set(t.date, t.balance)
  return [...fim].map(([data, saldo]) => ({ data, saldo }))
}

export function hojeSP(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}
const menosDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10)

export interface ResultadoAsaas { lidas: number; novas: number; ja_existiam: number; removidas: number; reapareceram: number; zeradas: number; saldos: number; extrato_repetido: boolean; conflito_hash: number }

/** Fase 1, fora de transação: segredo + API. Fase 2: grava tudo numa transação curta. */
export async function syncAsaas(pool: pg.Pool, idConexao: string, base = ASAAS_BASE, agora = new Date()): Promise<ResultadoAsaas> {
  const { rows: [cx] } = await pool.query(
    `select cx.id_conexao, cx.id_org, cx.id_conta, cx.janela_reprocesso_dias, cx.metodo from bpo_fin.conexoes cx where cx.id_conexao = $1`, [idConexao])
  if (!cx) throw new ErroPermanente('conexão não encontrada')
  let chave: string
  try {
    chave = (await pool.query(`select bpo_fin.fn_segredo_da_conexao($1) s`, [idConexao])).rows[0].s
  } catch (e) { throw new ErroPermanente(e instanceof Error ? e.message : String(e)) }

  const ate = hojeSP(agora), de = menosDias(ate, cx.janela_reprocesso_dias)
  const api = await buscarAsaas(base, chave, de, ate)
  // ordem do hash = a da 0002: por data e, entre idênticas, pelo id
  const ordenadas = [...api.transacoes].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const r: ResultadoAsaas = { lidas: ordenadas.length, novas: 0, ja_existiam: 0, removidas: 0, reapareceram: 0, zeradas: 0, saldos: 0, extrato_repetido: false, conflito_hash: 0 }
  const validas = ordenadas.filter((t) => (t.value === 0 ? (r.zeradas++, false) : true))
  const linhas = comHash(validas.map((t) => ({ idConta: cx.id_conta as string, data: t.date, valor: t.value, descricao: t.description ?? null, t }))).map((l) => ({
    id_externo: l.t.id, hash_natural: l.hash, data_movimento: l.data, valor: l.t.value,
    descricao_bruta: l.t.description ?? null, payload_raw: { asaas: l.t, seq: l.seq },
  }))
  const saldos = [...saldosPorDia(api.transacoes), { data: ate, saldo: api.saldo }]

  const payload = { formato: 'asaas', janela: { de, ate }, transacoes: api.transacoes, saldo: api.saldo }
  const sha = createHash('sha256').update(JSON.stringify(payload)).digest('hex')

  const c = await pool.connect()
  try {
    await c.query('begin')
    const { rows: [ext] } = await c.query(
      `insert into bpo_fin.extratos (id_org, id_conexao, origem, arquivo_nome, arquivo_sha256, payload, periodo_inicio, periodo_fim,
                                     saldo_final_informado, data_saldo_final)
       values ($1, $2, 'asaas', $3, $4, $5, $6, $7, $8, $7) on conflict (id_conexao, arquivo_sha256) do nothing returning id_extrato`,
      [cx.id_org, idConexao, `sync ${de} a ${ate}`, sha, payload, de, ate, api.saldo])
    r.extrato_repetido = !ext
    const idExtrato: string | null = ext?.id_extrato ?? null

    const { rows: novas } = await c.query(
      `insert into bpo_fin.movimentos (id_org, id_conta, id_extrato, origem, id_externo, hash_natural, data_movimento, valor, descricao_bruta, payload_raw)
       select $1, $2, $3, 'asaas', l.id_externo, l.hash_natural, l.data_movimento, l.valor, l.descricao_bruta, l.payload_raw
         from jsonb_to_recordset($4::jsonb) as l(id_externo text, hash_natural text, data_movimento date, valor numeric, descricao_bruta text, payload_raw jsonb)
       on conflict do nothing returning id_movimento`, [cx.id_org, cx.id_conta, idExtrato, JSON.stringify(linhas)])
    r.novas = novas.length

    // No Asaas o id é a identidade: "visto" é pelo id. O hash muda quando uma linha idêntica do mesmo dia
    // some (o seq das outras desloca), então não serve para isso aqui — só para linha sem id (histórico antigo).
    const ids = linhas.map((l) => l.id_externo), hashes = linhas.map((l) => l.hash_natural)
    const visto = `(id_externo = any($3::text[]) or (id_externo is null and hash_natural = any($2::text[])))`
    const { rows: [{ n: existentes }] } = await c.query(
      `select count(*)::int n from bpo_fin.movimentos where id_conta = $1 and origem = 'asaas' and id_externo = any($2::text[])`, [cx.id_conta, ids])
    r.ja_existiam = existentes - r.novas
    // id novo que não entrou = bateu no hash de OUTRA linha (seq deslocado). Não some calado: conta e loga.
    r.conflito_hash = linhas.length - existentes
    r.reapareceram = (await c.query(`update bpo_fin.movimentos set removido_na_fonte_em = null, updated_at = now()
       where id_conta = $1 and ${visto} and removido_na_fonte_em is not null`, [cx.id_conta, hashes, ids])).rowCount ?? 0
    // Sumiu do Asaas dentro da janela. Só o que veio da API: linha do histórico (payload_raw.legado) pode ter
    // id que a API não conhece (lançamentos "manu…" do financeiro_seis) e não é marcada.
    r.removidas = (await c.query(`update bpo_fin.movimentos set removido_na_fonte_em = now(), updated_at = now()
       where id_conta = $1 and origem = 'asaas' and removido_na_fonte_em is null and not (payload_raw ? 'legado')
         and data_movimento between $4 and $5 and not ${visto}`, [cx.id_conta, hashes, ids, de, ate])).rowCount ?? 0

    for (const s of saldos)
      await c.query(`insert into bpo_fin.saldos_extrato (id_conta, data, saldo, id_extrato) values ($1, $2, $3, $4)
                     on conflict (id_conta, data) do update set saldo = excluded.saldo, id_extrato = coalesce(excluded.id_extrato, bpo_fin.saldos_extrato.id_extrato)`,
        [cx.id_conta, s.data, s.saldo, idExtrato])
    r.saldos = saldos.length

    if (idExtrato)
      await c.query(`update bpo_fin.extratos set status = 'processado', processado_em = now(), linhas_lidas = $2, linhas_novas = $3, linhas_removidas = $4
                     where id_extrato = $1`, [idExtrato, r.lidas, r.novas, r.removidas])
    const ultimo = linhas.at(-1)?.data_movimento ?? null
    await c.query(`update bpo_fin.conexoes set ultima_importacao_em = now(), status = 'ativa', erro_msg = null,
                          ultimo_movimento_em = greatest(ultimo_movimento_em, $2::date) where id_conexao = $1`, [idConexao, ultimo])
    await c.query('commit')
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
  return r
}
