// TS × SQL ao vivo: compara hashNatural e normalizarDescricao com o banco em DATABASE_URL_HASH,
// que precisa ter bpo_fin (sql/0001 + 0003) e locale ICU como produção. Quem prepara: scripts/test-sql.sh.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashNatural, normalizarDescricao, valorHash } from '../src/hash'

const url = process.env.DATABASE_URL_HASH

// gerador determinístico, para a falha ser reproduzível
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
}
const PEDACOS = ['pix', 'PIX', 'Recebido', 'tarifa', 'João', 'açaí', 'Ñ', 'straße', 'ﬁ', 'ǆ', 'µ', 'ı', '-', '/', '#123', '0,50',
  ' ', '  ', '\t', '\n', '\r\n', ' ', '\u0085', ' ', '　', '\u001c', '​', '﻿', '᠎', '😀']

function vetores(n: number) {
  const r = rng(42)
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]!
  return Array.from({ length: n }, () => {
    const hex = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('')
    const d = new Date(Date.UTC(2020, 0, 1) + Math.floor(r() * 3650) * 86400000).toISOString().slice(0, 10)
    const inteiro = Math.floor(r() ** 4 * 1e9)
    const frac = String(Math.floor(r() * 1000)).padStart(3, '0').slice(0, 1 + Math.floor(r() * 3))
    const valor = `${r() < 0.6 ? '-' : ''}${inteiro}.${frac}`
    const descricao = r() < 0.05 ? null : Array.from({ length: Math.floor(r() * 8) }, () => pick(PEDACOS)).join('')
    return { idConta: r() < 0.3 ? hex.toUpperCase() : hex, data: d, valor, descricao, seq: Math.floor(r() * 4) }
  })
}

describe.skipIf(!url)('hash TS × fn_hash_natural (banco ao vivo)', () => {
  const client = new pg.Client({ connectionString: url })
  beforeAll(async () => {
    await client.connect()
    const { rows } = await client.query(`select datlocprovider from pg_database where datname = current_database()`)
    if (rows[0]?.datlocprovider !== 'i') throw new Error('o banco de teste precisa de locale ICU (produção é ICU en-US)')
  })
  afterAll(() => client.end())

  it('2.000 linhas aleatórias batem byte a byte', async () => {
    const vs = vetores(2000)
    const { rows } = await client.query(
      `select bpo_fin.fn_hash_natural(x.c::uuid, x.d::date, x.v::numeric, x.s, x.q) as h,
              bpo_fin.fn_normalizar_descricao(x.s) as n, to_char(x.v::numeric, 'FM999999999990.00') as vt
         from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[]) with ordinality as x(c, d, v, s, q, i)
        order by x.i`,
      [vs.map((v) => v.idConta), vs.map((v) => v.data), vs.map((v) => v.valor), vs.map((v) => v.descricao), vs.map((v) => v.seq)],
    )
    const erros = vs.flatMap((v, i) => {
      const db = rows[i]
      const ts = { h: hashNatural(v), n: normalizarDescricao(v.descricao), vt: valorHash(v.valor) }
      return ts.h === db.h ? [] : [{ v, ts, db }]
    })
    expect(erros.slice(0, 5)).toEqual([])
  })
})
