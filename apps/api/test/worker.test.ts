// Worker × banco (scripts/test-api.sh). Upload como analista (via RPC, como a API faz) e processa como vesso_fin_worker.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { comoUsuario, criarPool } from '../src/db'
import { rodarUm } from '../src/worker/fila'
import { SGML } from './ofx.test'

const urlApi = process.env.DATABASE_URL_API, urlWorker = process.env.DATABASE_URL_WORKER
const HEAD = { sub: '00000000-0000-0000-0000-0000000000b1', role: 'authenticated' }   // head vê as orgs cliente
const CX = '60000000-0000-0000-0000-0000000000c1', CONTA = '40000000-0000-0000-0000-0000000000c1', ORG = '20000000-0000-0000-0000-00000000000c'
const latin1 = (s: string) => Buffer.from(Uint8Array.from([...s].map((ch) => ch.charCodeAt(0))))

describe.skipIf(!urlApi || !urlWorker)('worker: processar_extrato', () => {
  const api = criarPool(urlApi ?? ''), worker = criarPool(urlWorker ?? '')
  const logs: any[] = []
  const log = (l: any) => logs.push(l)
  const subir = (conteudo: Buffer, nome = 'nubank.ofx', cx = CX) => comoUsuario(api, HEAD, false, async (q) =>
    (await q(`select bpo_fin.fn_registrar_extrato($1, $2, $3) r`, [cx, nome, conteudo.toString('base64')]))[0]!.r)
  const q = async (sql: string, p: unknown[] = []) => (await worker.query(sql, p)).rows

  beforeAll(async () => {
    expect((await q('select current_user u'))[0].u).toBe('vesso_fin_worker')
    // jobs deixados pelo teste da API (upload na org B) sairiam na frente: tira da fila
    await q(`update bpo_fin.fila_jobs set status = 'ok', terminado_em = now() where status = 'pendente'`)
  })
  afterAll(async () => { await api.end(); await worker.end() })

  // ⚠️ o arquivo do teste é da conta final 1234 (ACCTID 99881234) e a org C tem competência inicial 01/09/2026
  it('1º arquivo: grava movimentos, saldo, período e status', async () => {
    const up = await subir(latin1(SGML))
    expect(up.duplicado).toBe(false)
    expect(await rodarUm(worker, log)).toBe(true)
    const [e] = await q(`select status, linhas_lidas, linhas_novas, linhas_removidas, periodo_inicio::text, periodo_fim::text, saldo_final_informado
                           from bpo_fin.extratos where id_extrato = $1`, [up.id_extrato])
    expect(e).toMatchObject({ status: 'processado', linhas_lidas: 4, linhas_novas: 4, linhas_removidas: 0, periodo_inicio: '2026-10-01', periodo_fim: '2026-10-31' })
    expect(Number(e.saldo_final_informado)).toBe(10000)
    const movs = await q(`select valor::text, descricao_bruta, id_externo, payload_raw->>'seq' seq from bpo_fin.movimentos where id_conta = $1 order by data_movimento, valor, payload_raw->>'seq'`, [CONTA])
    expect(movs.map((m) => [m.valor, m.id_externo, m.seq])).toEqual([['-1234.56', 'A1', '0'], ['-9.90', 'A3', '0'], ['-9.90', null, '1'], ['500.00', 'A2', '0']])
    expect((await q(`select saldo::text from bpo_fin.saldos_extrato where id_conta = $1 and data = '2026-10-31'`, [CONTA]))[0].saldo).toBe('10000.00')
    expect((await q(`select status, ultimo_movimento_em::text u from bpo_fin.conexoes where id_conexao = $1`, [CX]))[0]).toEqual({ status: 'ativa', u: '2026-10-06' })
  })

  it('hash do TS = fn_hash_natural do banco, linha a linha (com o seq)', async () => {
    const [r] = await q(`select count(*)::int total,
                                count(*) filter (where hash_natural = bpo_fin.fn_hash_natural(id_conta, data_movimento, valor, descricao_bruta, (payload_raw->>'seq')::int))::int iguais
                           from bpo_fin.movimentos where id_conta = $1`, [CONTA])
    expect(r).toEqual({ total: 4, iguais: 4 })
  })

  it('mesmo arquivo de novo: duplicado, sem job; reprocessar o extrato não cria nada', async () => {
    const up = await subir(latin1(SGML), 'outro-nome.ofx')
    expect(up).toMatchObject({ duplicado: true, id_job: null })
    expect(await rodarUm(worker, log)).toBe(false)
    // reprocessa à força (como um retry faria)
    await q(`insert into bpo_fin.fila_jobs (tipo, id_org, payload) values ('processar_extrato', $2, $1)`, [{ id_extrato: up.id_extrato }, ORG])
    expect(await rodarUm(worker, log)).toBe(true)
    expect((await q(`select linhas_novas from bpo_fin.extratos where id_extrato = $1`, [up.id_extrato]))[0].linhas_novas).toBe(0)
    expect((await q(`select count(*)::int n from bpo_fin.movimentos where id_conta = $1`, [CONTA]))[0].n).toBe(4)
  })

  it('arquivo novo do mesmo período: linha que sumiu é marcada, linha nova entra, a de antes do corte não', async () => {
    const v2 = SGML
      .replace(/<STMTTRN><TRNTYPE>CREDIT[\s\S]*?<\/STMTTRN>\n/, '')                       // some o crédito de 500
      .replace('</BANKTRANLIST>', '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261020<TRNAMT>-42,00<FITID>A9<MEMO>Nova</STMTTRN>\n'
        + '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260815<TRNAMT>-1,00<FITID>A0<MEMO>Antes do corte</STMTTRN>\n</BANKTRANLIST>')
    const up = await subir(latin1(v2), 'nubank-v2.ofx')
    expect(await rodarUm(worker, log)).toBe(true)
    const [e] = await q(`select linhas_lidas, linhas_novas, linhas_removidas from bpo_fin.extratos where id_extrato = $1`, [up.id_extrato])
    expect(e).toEqual({ linhas_lidas: 5, linhas_novas: 1, linhas_removidas: 1 })
    const removido = await q(`select descricao_bruta from bpo_fin.movimentos where id_conta = $1 and removido_na_fonte_em is not null`, [CONTA])
    expect(removido.map((m) => m.descricao_bruta)).toEqual(['Transferência recebida'])
    expect((await q(`select count(*)::int n from bpo_fin.movimentos where id_conta = $1 and data_movimento < '2026-09-01'`, [CONTA]))[0].n).toBe(0)
    expect(logs.at(-1).resultado).toMatchObject({ anteriores_ao_corte: 1, removidas: 1, novas: 1 })
  })

  it('a linha que sumiu e volta é desmarcada', async () => {
    const v3 = SGML.replace('</BANKTRANLIST>', '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261020<TRNAMT>-42,00<FITID>A9<MEMO>Nova</STMTTRN>\n</BANKTRANLIST>')
    await subir(latin1(v3), 'nubank-v3.ofx')
    expect(await rodarUm(worker, log)).toBe(true)
    expect(logs.at(-1).resultado).toMatchObject({ reapareceram: 1, removidas: 0, novas: 0 })
    expect((await q(`select count(*)::int n from bpo_fin.movimentos where id_conta = $1 and removido_na_fonte_em is not null`, [CONTA]))[0].n).toBe(0)
  })

  it('arquivo de outra conta: erro definitivo, nada gravado, conexão em erro', async () => {
    const antes = (await q(`select count(*)::int n from bpo_fin.movimentos`))[0].n
    const up = await subir(latin1(SGML.replace('99881234', '55550000').replace('-9,90', '-9,91')), 'errado.ofx')
    expect(await rodarUm(worker, log)).toBe(true)
    const [e] = await q(`select status, erro_msg from bpo_fin.extratos where id_extrato = $1`, [up.id_extrato])
    expect(e.status).toBe('erro')
    expect(e.erro_msg).toMatch(/conta final 0000.*1234/)
    expect((await q(`select status from bpo_fin.fila_jobs where payload->>'id_extrato' = $1`, [up.id_extrato]))[0].status).toBe('erro')
    expect((await q(`select status from bpo_fin.conexoes where id_conexao = $1`, [CX]))[0].status).toBe('erro')
    expect((await q(`select count(*)::int n from bpo_fin.movimentos`))[0].n).toBe(antes)
  })

  it('arquivo ilegível: erro definitivo na 1ª tentativa', async () => {
    const up = await subir(Buffer.from('isto não é ofx'), 'lixo.ofx')
    expect(await rodarUm(worker, log)).toBe(true)
    const [j] = await q(`select status, tentativas from bpo_fin.fila_jobs where payload->>'id_extrato' = $1`, [up.id_extrato])
    expect(j).toEqual({ status: 'erro', tentativas: 1 })
  })

  it('o worker não alcança título, baixa nem fechamento', async () => {
    for (const t of ['titulos', 'baixas', 'fechamento_mensal'])
      await expect(q(`select 1 from bpo_fin.${t} limit 1`)).rejects.toThrow(/permission denied/)
  })
})
