// sync_asaas × banco × Asaas falso (HTTP local). Conecta como vesso_fin_worker; a chave sai do Vault (stub).
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criarPool } from '../src/db'
import { saldosPorDia, syncAsaas, type TransacaoAsaas } from '../src/worker/sync-asaas'
import { ErroPermanente } from '../src/worker/processar-extrato'
import { rodarUm } from '../src/worker/fila'

const url = process.env.DATABASE_URL_WORKER
const ORG = '20000000-0000-0000-0000-00000000000c', CONTA = '40000000-0000-0000-0000-0000000000c2', CX = '60000000-0000-0000-0000-0000000000c2'
const AGORA = new Date('2026-10-27T15:00:00Z')   // hoje em SP = 27/10; janela padrão 15 dias → 12/10 a 27/10

// 150 transações (2 páginas) + duas idênticas no mesmo dia (seq 0/1)
function gerar(): TransacaoAsaas[] {
  const ts: TransacaoAsaas[] = []
  let saldo = 1000
  for (let i = 0; i < 150; i++) {
    const value = i % 3 === 0 ? 200 : -0.55
    saldo = Math.round((saldo + value) * 100) / 100
    ts.push({ id: `ftn_${String(1000 + i).padStart(12, '0')}`, value, balance: saldo, type: i % 3 === 0 ? 'PAYMENT_RECEIVED' : 'PAYMENT_FEE',
      date: `2026-10-${String(13 + Math.floor(i / 10)).padStart(2, '0')}`, description: i % 3 === 0 ? `Cobrança recebida ${i}` : 'Taxa de notificação por WhatsApp' })
  }
  return ts
}
let dados = gerar()
let pedidos: { path: string; chave: string | undefined; ua: string | undefined }[] = []
let forcarStatus: number | null = null

describe.skipIf(!url)('sync_asaas', () => {
  const pool = criarPool(url ?? '')
  let srv: Server, base = ''
  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows

  beforeAll(async () => {
    srv = createServer((req, res) => {
      const u = new URL(req.url!, 'http://x')
      pedidos.push({ path: u.pathname, chave: req.headers['access_token'] as string, ua: req.headers['user-agent'] })
      if (forcarStatus) { res.writeHead(forcarStatus); return res.end('{}') }
      if (req.headers['access_token'] !== 'chave-c2') { res.writeHead(401); return res.end('{}') }
      res.setHeader('content-type', 'application/json')
      if (u.pathname === '/v3/finance/balance') return res.end(JSON.stringify({ balance: dados.at(-1)!.balance }))
      const de = u.searchParams.get('startDate')!, ate = u.searchParams.get('finishDate')!
      const off = Number(u.searchParams.get('offset')), lim = Math.min(100, Number(u.searchParams.get('limit')))
      const f = dados.filter((t) => t.date >= de && t.date <= ate)
      res.end(JSON.stringify({ object: 'list', hasMore: off + lim < f.length, totalCount: f.length, limit: lim, offset: off, data: f.slice(off, off + lim) }))
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(srv.address() as any).port}/v3`
    // conexão asaas_api da org C, com a chave no Vault (o seed cria as linhas; a chave entra aqui pelo stub)
    expect((await q('select current_user u'))[0].u).toBe('vesso_fin_worker')
  })
  afterAll(async () => { await pool.end(); srv.close() })

  it('saldosPorDia: confia só numa cadeia de balance que fecha', () => {
    expect(saldosPorDia([{ id: 'a', value: 10, balance: 110, date: '2026-10-01' }, { id: 'b', value: -5, balance: 105, date: '2026-10-01' }, { id: 'c', value: 1, balance: 106, date: '2026-10-02' }]))
      .toEqual([{ data: '2026-10-01', saldo: 105 }, { data: '2026-10-02', saldo: 106 }])
    expect(saldosPorDia([{ id: 'a', value: 10, balance: 110, date: '2026-10-01' }, { id: 'b', value: -5, balance: 999, date: '2026-10-01' }])).toEqual([])
  })

  it('1º sync: pagina, manda chave e User-Agent, grava movimentos, saldos e extrato', async () => {
    const r = await syncAsaas(pool, CX, base, AGORA)
    expect(r).toMatchObject({ lidas: 150, novas: 149, ja_existiam: 1, removidas: 0, conflito_hash: 0 })   // 1 já veio do histórico (seed)
    const fin = pedidos.filter((p) => p.path.endsWith('/financialTransactions'))
    expect(fin).toHaveLength(2)
    expect(pedidos.every((p) => p.chave === 'chave-c2' && p.ua?.startsWith('vesso-fin'))).toBe(true)
    expect((await q(`select count(*)::int n from bpo_fin.movimentos where id_conta = $1`, [CONTA]))[0].n).toBe(150)
    const [e] = await q(`select status, linhas_lidas, linhas_novas, periodo_inicio::text de, periodo_fim::text ate from bpo_fin.extratos where id_conexao = $1`, [CX])
    expect(e).toEqual({ status: 'processado', linhas_lidas: 150, linhas_novas: 149, de: '2026-10-12', ate: '2026-10-27' })
    const s = await q(`select data::text, saldo::float from bpo_fin.saldos_extrato where id_conta = $1 order by data`, [CONTA])
    expect(s.at(-1)).toEqual({ data: '2026-10-27', saldo: dados.at(-1)!.balance })
    expect(s.find((x) => x.data === '2026-10-13')!.saldo).toBe(dados.filter((t) => t.date === '2026-10-13').at(-1)!.balance)
  })

  it('hash = fn_hash_natural com o seq, inclusive no movimento que veio do histórico', async () => {
    const [r] = await q(`select count(*)::int total, count(*) filter (where hash_natural = bpo_fin.fn_hash_natural(id_conta, data_movimento, valor, descricao_bruta, coalesce((payload_raw->>'seq')::int, 0)))::int iguais
                           from bpo_fin.movimentos where id_conta = $1`, [CONTA])
    expect(r).toEqual({ total: 150, iguais: 150 })
    const seqs = await q(`select payload_raw->>'seq' s from bpo_fin.movimentos where id_conta = $1 and data_movimento = '2026-10-13' and valor = -0.55 order by id_externo`, [CONTA])
    expect(seqs.map((x) => x.s)).toEqual(['0', '1', '2', '3', '4', '5'])
  })

  it('2º sync igual: extrato repetido, nada novo', async () => {
    const r = await syncAsaas(pool, CX, base, AGORA)
    expect(r).toMatchObject({ extrato_repetido: true, novas: 0, ja_existiam: 150, removidas: 0 })
    expect((await q(`select count(*)::int n from bpo_fin.extratos where id_conexao = $1`, [CX]))[0].n).toBe(1)
  })

  it('transação que some do Asaas é marcada; a do histórico não', async () => {
    const some = dados[10]!.id
    dados = dados.filter((t) => t.id !== some && t.id !== 'ftn_000000001000')   // a 1000 é a do histórico
    const r = await syncAsaas(pool, CX, base, AGORA)
    expect(r).toMatchObject({ novas: 0, removidas: 1, conflito_hash: 0 })
    expect((await q(`select id_externo from bpo_fin.movimentos where id_conta = $1 and removido_na_fonte_em is not null`, [CONTA])).map((x) => x.id_externo)).toEqual([some])
    dados = gerar()
    expect(await syncAsaas(pool, CX, base, AGORA)).toMatchObject({ reapareceram: 1, removidas: 0 })
  })

  it('chave recusada → erro permanente; 429/5xx → transitório', async () => {
    forcarStatus = 401
    await expect(syncAsaas(pool, CX, base, AGORA)).rejects.toBeInstanceOf(ErroPermanente)
    forcarStatus = 429
    const e = await syncAsaas(pool, CX, base, AGORA).catch((x) => x)
    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(ErroPermanente)
    forcarStatus = null
  })

  it('conexão sem segredo → erro permanente antes de chamar a API', async () => {
    const antes = pedidos.length
    await expect(syncAsaas(pool, '60000000-0000-0000-0000-0000000000c3', base, AGORA)).rejects.toThrow(/sem segredo/)
    expect(pedidos.length).toBe(antes)
  })

  it('pela fila: job de conexão sem chave termina em erro e a conexão fica em erro', async () => {
    await q(`update bpo_fin.fila_jobs set status = 'ok' where status = 'pendente'`)
    await q(`insert into bpo_fin.fila_jobs (tipo, id_org, payload) values ('sync_asaas', $1, $2)`, [ORG, { id_conexao: '60000000-0000-0000-0000-0000000000c3' }])
    expect(await rodarUm(pool, () => {})).toBe(true)
    expect((await q(`select status, tentativas, erro_msg from bpo_fin.fila_jobs where tipo = 'sync_asaas' order by id_job desc limit 1`))[0])
      .toMatchObject({ status: 'erro', tentativas: 1 })
    expect((await q(`select status, erro_msg from bpo_fin.conexoes where id_conexao = '60000000-0000-0000-0000-0000000000c3'`))[0])
      .toMatchObject({ status: 'erro', erro_msg: expect.stringMatching(/sem segredo/) })
  })
})
