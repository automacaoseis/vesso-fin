// Maquininha × banco (0015): conta + conexão 'arquivo_adquirente' pelo cadastro, upload do CSV, worker processa.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { comoUsuario, criarPool } from '../src/db'
import { rodarUm } from '../src/worker/fila'

const urlApi = process.env.DATABASE_URL_API, urlWorker = process.env.DATABASE_URL_WORKER
const HEAD = { sub: '00000000-0000-0000-0000-0000000000b1', role: 'authenticated' }
const ORG = '20000000-0000-0000-0000-00000000000c'
// datas relativas a hoje (São Paulo): o teste não envelhece
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const dia = (n: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const br = (d: string) => d.split('-').reverse().join('/')
const CSV = `Data da venda;Data de pagamento;Produto;Bandeira;Valor bruto;Taxa;Valor líquido;Status
${br(dia(-4))};${br(dia(-3))};Débito;Visa;R$ 200,00;R$ 2,00;R$ 198,00;Pago
${br(dia(-4))};${br(dia(26))};Crédito;Master;R$ 500,00;R$ 15,00;R$ 485,00;Previsto
${br(dia(-2))};${br(dia(-1))};Débito;Visa;R$ 80,00;R$ 0,80;R$ 79,20;Pago
${br(dia(0))};${br(dia(1))};Débito;Visa;R$ 999,00;R$ 9,99;R$ 989,01;Pago
`

describe.skipIf(!urlApi || !urlWorker)('worker: arquivo da maquininha (0015)', () => {
  const api = criarPool(urlApi ?? ''), worker = criarPool(urlWorker ?? '')
  const comoHead = <T,>(fn: (q: any) => Promise<T>) => comoUsuario(api, HEAD, false, fn)
  const q = async (sql: string, p: unknown[] = []) => (await worker.query(sql, p)).rows
  let conta = '', conexao = ''

  beforeAll(async () => {
    await q(`update bpo_fin.fila_jobs set status = 'ok', terminado_em = now() where status = 'pendente'`)
    conta = await comoHead(async (qq) => {
      const [e] = await qq(`select id_entidade from bpo_fin.entidades where id_org = $1 limit 1`, [ORG])
      return (await qq(`select bpo_fin.fn_criar_conta($1, $2, 'adquirente', 'Stone', 'Stone (maquininha)', null, 0, $3, 'arquivo_adquirente') id`,
        [ORG, e.id_entidade, dia(-30)]))[0].id
    })
    conexao = (await q(`select id_conexao from bpo_fin.conexoes where id_conta = $1`, [conta]))[0].id_conexao
  })
  afterAll(async () => { await api.end(); await worker.end() })
  const subir = (txt: string, nome = 'stone.csv') => comoHead(async (qq) =>
    (await qq(`select bpo_fin.fn_registrar_extrato($1, $2, $3) r`, [conexao, nome, Buffer.from(txt).toString('base64')]))[0].r)

  it('vendas, taxas e repasses por dia; dia de hoje fica fora; saldo = agenda de recebíveis', async () => {
    const up = await subir(CSV)
    expect(up.duplicado).toBe(false)
    expect(await rodarUm(worker, () => {})).toBe(true)
    const [e] = await q(`select status, linhas_lidas, linhas_novas, erro_msg from bpo_fin.extratos where id_extrato = $1`, [up.id_extrato])
    expect(e).toMatchObject({ status: 'processado', linhas_lidas: 4, linhas_novas: 8, erro_msg: null })
    const movs = await q(`select id_externo, valor::text, origem from bpo_fin.movimentos where id_conta = $1 order by data_movimento, id_externo`, [conta])
    expect(movs.every((m) => m.origem === 'adquirente')).toBe(true)
    // id_externo = tipo|dia|produto|bandeira (repasse: repasse|dia)
    expect(Object.fromEntries(movs.map((m) => [m.id_externo, m.valor]))).toEqual({
      [`venda|${dia(-4)}|credito|master`]: '500.00', [`taxa|${dia(-4)}|credito|master`]: '-15.00',
      [`venda|${dia(-4)}|debito|visa`]: '200.00', [`taxa|${dia(-4)}|debito|visa`]: '-2.00',
      [`repasse|${dia(-3)}`]: '-198.00',
      [`venda|${dia(-2)}|debito|visa`]: '80.00', [`taxa|${dia(-2)}|debito|visa`]: '-0.80',
      [`repasse|${dia(-1)}`]: '-79.20',
    })
    // saldo da fonte no fim do último dia fechado com venda (−2): vendido até lá e que cai depois =
    // 485 (crédito, cai em +26) + 79,20 (débito do próprio dia −2, cai em −1)
    expect((await q(`select data::text, saldo::text from bpo_fin.saldos_extrato where id_conta = $1`, [conta]))).toEqual([{ data: dia(-2), saldo: '564.20' }])
    // e o sistema concorda: saldo_inicial 0 + movimentos até −2 = 500 − 15 + 200 − 2 − 198 + 80 − 0,80
    expect((await q(`select sum(valor)::text s from bpo_fin.movimentos where id_conta = $1 and data_movimento <= $2`, [conta, dia(-2)]))[0].s).toBe('564.20')
  })

  it('mesmo período reexportado (arquivo diferente): nada duplica; dia que mudou é apontado, não reescrito', async () => {
    const outro = CSV.replace('R$ 80,00;R$ 0,80;R$ 79,20', 'R$ 70,00;R$ 0,70;R$ 69,30') + '\n'
    await subir(outro, 'stone-2.csv')
    expect(await rodarUm(worker, () => {})).toBe(true)
    expect((await q(`select count(*)::int n from bpo_fin.movimentos where id_conta = $1`, [conta]))[0].n).toBe(8)
    const [e] = await q(`select linhas_novas, erro_msg from bpo_fin.extratos where id_conexao = $1 order by recebido_em desc limit 1`, [conexao])
    expect(e.linhas_novas).toBe(0)
    expect(e.erro_msg).toMatch(/^3 dia\(s\) já importado/)   // venda, taxa e repasse daquele dia
  })

  it('arquivo que não é de maquininha: erro permanente com mensagem clara', async () => {
    const up = await subir('nome;idade\nana;3\n', 'errado.csv')
    expect(await rodarUm(worker, () => {})).toBe(true)
    const [e] = await q(`select status, erro_msg from bpo_fin.extratos where id_extrato = $1`, [up.id_extrato])
    expect(e.status).toBe('erro')
    expect(e.erro_msg).toMatch(/não reconheci as colunas/)
  })
})
