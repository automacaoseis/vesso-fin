import { describe, expect, it } from 'vitest'
import { comHash, hashNatural, normalizarDescricao, textoHash, valorHash } from '../src/hash'
import fixtures from './hash.fixtures.json'

describe('hash natural × vetores de produção', () => {
  it('vetor do STATUS.md', () => {
    expect(hashNatural({ idConta: '00000000-0000-0000-0000-000000000001', data: '2026-10-01', valor: -50, descricao: '  pix   teste ', seq: 0 }))
      .toBe('7fce8b012c186feb30c5c55b5a80e57e3468f10762833ec3a157e499efb85974')
    expect(textoHash({ idConta: '00000000-0000-0000-0000-000000000001', data: '2026-10-01', valor: -50, descricao: '  pix   teste ', seq: 0 }))
      .toBe('00000000-0000-0000-0000-000000000001|2026-10-01|-50.00|PIX TESTE|0')
  })

  for (const v of fixtures.vetores) {
    it(`${JSON.stringify(v.descricao)} · ${v.valor}`, () => {
      expect(hashNatural({ idConta: v.id_conta, data: v.data, valor: v.valor, descricao: v.descricao, seq: v.seq })).toBe(v.hash)
    })
  }
})

describe('valorHash = to_char(valor, FM999999999990.00)', () => {
  it.each([
    ['-50', '-50.00'], ['1.005', '1.01'], ['-1.005', '-1.01'], ['0.004', '0.00'], ['-0.004', '0.00'],
    ['0', '0.00'], ['-0.005', '-0.01'], ['123456789.995', '123456790.00'], ['2.675', '2.68'],
    ['999999999999.99', '999999999999.99'], ['.5', '0.50'], ['+7', '7.00'], ['007.1', '7.10'],
  ])('%s → %s', (entrada, saida) => expect(valorHash(entrada)).toBe(saida))

  it('number usa a representação decimal, não binária (1.005 → 1.01, diferente de toFixed)', () => {
    expect((1.005).toFixed(2)).toBe('1.00')
    expect(valorHash(1.005)).toBe('1.01')
    expect(valorHash(-12.9)).toBe('-12.90')
    expect(valorHash(1e-7)).toBe('0.00')
  })

  it('recusa o que o banco recusaria', () => {
    for (const x of ['1e3', '1.2.3', '', '-', 'abc', '1,50', '999999999999.995', '1000000000000']) expect(() => valorHash(x)).toThrow()
    expect(() => valorHash(NaN)).toThrow()
    expect(() => valorHash(1e21)).toThrow()
  })
})

describe('normalizarDescricao = fn_normalizar_descricao', () => {
  it('btrim só tira espaço; tab nas pontas vira espaço', () => expect(normalizarDescricao('\tpix\t a ')).toBe(' PIX A'))
  it('NBSP no fim sobrevive como espaço (btrim roda antes do regex)', () => expect(normalizarDescricao('a b ')).toBe('A B '))
  it('NEL e U+001F são espaço; ZWSP e BOM não', () => {
    expect(normalizarDescricao('a\u0085b\u001fc')).toBe('A B C')
    expect(normalizarDescricao('a​b﻿c')).toBe('A​B﻿C')
  })
  it('null → vazio', () => expect(normalizarDescricao(null)).toBe(''))
})

describe('entrada inválida', () => {
  const base = { idConta: '00000000-0000-0000-0000-000000000001', data: '2026-10-01', valor: '1', descricao: 'x', seq: 0 }
  it('data', () => { for (const data of ['2026-02-30', '2026-1-01', '01/10/2026']) expect(() => hashNatural({ ...base, data })).toThrow() })
  it('uuid', () => expect(() => hashNatural({ ...base, idConta: 'nao-e-uuid' })).toThrow())
  it('seq', () => { for (const seq of [-1, 1.5]) expect(() => hashNatural({ ...base, seq })).toThrow() })
  it('uuid aceita maiúsculo e sem hífen como o ::uuid do Postgres', () =>
    expect(hashNatural({ ...base, idConta: '{00000000000000000000000000000001}' })).toBe(hashNatural(base)))
})

describe('comHash: seq entre linhas idênticas', () => {
  it('conta repetições pela chave normalizada, na ordem de chegada', () => {
    const c = '00000000-0000-0000-0000-000000000001'
    const r = comHash([
      { idConta: c, data: '2026-10-01', valor: '-5', descricao: 'tarifa' },
      { idConta: c, data: '2026-10-01', valor: '-5.00', descricao: ' TARIFA ' },
      { idConta: c, data: '2026-10-01', valor: '-5', descricao: 'outra' },
      { idConta: c, data: '2026-10-02', valor: '-5', descricao: 'tarifa' },
      { idConta: c, data: '2026-10-01', valor: -5, descricao: 'Tarifa' },
    ])
    expect(r.map((x) => x.seq)).toEqual([0, 1, 0, 0, 2])
    expect(new Set(r.map((x) => x.hash)).size).toBe(5)
  })
})
