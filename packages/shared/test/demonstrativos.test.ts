import { describe, expect, it } from 'vitest'
import { demonstrativoCsv, mesesEntre, montarDfc, montarDre, type LinhaDreApi } from '../src/demonstrativos'

const r = (competencia: string, linha_dre: string | null, codigo: string, valor: number): LinhaDreApi =>
  ({ competencia, linha_dre, ordem_dre: 1, id_plano_conta: codigo, codigo, conta: `Conta ${codigo}`, natureza: 'x', valor, qtd_titulos: 1 })
const S = '2026-09-01', O = '2026-10-01'
const linha = (ls: ReturnType<typeof montarDre>, k: string) => ls.find((l) => l.chave === k)!

describe('montarDre', () => {
  const rows = [r(S, 'RECEITA_BRUTA', '3.1', 10000), r(S, 'DEDUCOES', '3.9', -500), r(S, 'CUSTOS_VARIAVEIS', '4.0', -1500),
    r(S, 'FOLHA', '4.2', -2000), r(S, 'DESPESAS_FIXAS', '4.1', -3000), r(S, 'DESPESAS_FINANCEIRAS', '5.9', -12.9),
    r(S, 'IMPOSTO_LUCRO', '6.1', -600), r(O, 'RECEITA_BRUTA', '3.1', 5000), r(O, 'LINHA_DO_CLIENTE', '7.7', -100)]
  const d = montarDre(rows, [S, O])
  it('subtotais na ordem do seis-sistema', () => {
    expect(linha(d, 'RECEITA_LIQUIDA').valores[S]).toBe(9500)
    expect(linha(d, 'LUCRO_BRUTO').valores[S]).toBe(8000)
    expect(linha(d, 'DESPESAS_FIXAS').valores[S]).toBe(-5000)          // FOLHA + DESPESAS_FIXAS (apelido)
    expect(linha(d, 'EBITDA').valores[S]).toBe(3000)
    expect(linha(d, 'LUCRO_ANTES_IR').valores[S]).toBe(2987.1)
    expect(linha(d, 'LUCRO_LIQUIDO').valores[S]).toBe(2387.1)
  })
  it('margens sobre a receita bruta; total é margem do período, não média', () => {
    expect(linha(d, 'MARGEM_LIQUIDA').valores[S]).toBeCloseTo(0.23871)
    expect(linha(d, 'PCT_FOLHA').valores[S]).toBeCloseTo(0.2)
    expect(linha(d, 'LUCRO_LIQUIDO').total).toBe(2387.1 + 5000 - 100)
    expect(linha(d, 'MARGEM_LIQUIDA').total).toBeCloseTo((2387.1 + 4900) / 15000)
  })
  it('linha fora do padrão cai em "Outras" e entra no lucro (não some)', () => {
    expect(linha(d, 'OUTRAS').valores[O]).toBe(-100)
    expect(linha(d, 'LUCRO_LIQUIDO').valores[O]).toBe(4900)
    expect(montarDre([r(S, 'RECEITA_BRUTA', '3.1', 1)], [S]).some((l) => l.chave === 'OUTRAS')).toBe(false)
  })
  it('margem sem receita é NaN (a tela mostra —); contas ordenadas por código numérico', () => {
    expect(Number.isNaN(linha(montarDre([r(S, 'FOLHA', '4.2', -1)], [S]), 'MARGEM_LIQUIDA').valores[S])).toBe(true)
    const dd = montarDre([r(S, 'DESPESAS_FIXAS', '4.10', -1), r(S, 'DESPESAS_FIXAS', '4.9', -1)], [S])
    expect(linha(dd, 'DESPESAS_FIXAS').contas!.map((k) => k.codigo)).toEqual(['4.9', '4.10'])
  })
  it('centavos sem erro de float', () => {
    const dd = montarDre([r(S, 'RECEITA_BRUTA', '3.1', 0.1), r(S, 'RECEITA_BRUTA', '3.2', 0.2)], [S])
    expect(linha(dd, 'RECEITA_BRUTA').valores[S]).toBe(0.3)
  })
})

describe('montarDfc', () => {
  it('grupos, subtotais e variação de caixa; conta sem grupo aparece separada', () => {
    const d = montarDfc([
      { mes: S, grupo_dfc: 'operacional', id_plano_conta: 'a', codigo: '3.1', conta: 'Receita', valor: 5000, qtd_baixas: 1 },
      { mes: S, grupo_dfc: 'operacional', id_plano_conta: 'b', codigo: '4.1', conta: 'Aluguel', valor: -3000, qtd_baixas: 1 },
      { mes: S, grupo_dfc: 'financiamento', id_plano_conta: 'c', codigo: '8.1', conta: 'Retirada', valor: -800, qtd_baixas: 1 },
      { mes: S, grupo_dfc: null, id_plano_conta: 'd', codigo: '9.9', conta: 'Sem grupo', valor: -10, qtd_baixas: 1 },
    ], [S])
    expect(d.map((l) => [l.chave, l.valores[S]])).toEqual([['G_operacional', 2000], ['G_investimento', 0], ['G_financiamento', -800], ['G_outros', -10], ['VARIACAO', 1190]])
  })
})

describe('auxiliares', () => {
  it('mesesEntre atravessa o ano', () => expect(mesesEntre('2025-11-01', '2026-02-01')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']))
  it('CSV com BOM, ponto e vírgula, vírgula decimal e as contas', () => {
    const csv = demonstrativoCsv(montarDre([r(S, 'RECEITA_BRUTA', '3.1', 1234.5)], [S]), [S], () => 'set/26')
    expect(csv.startsWith('﻿"Linha";"set/26";"Total"')).toBe(true)
    expect(csv).toContain('"Receita operacional bruta";1234,50;1234,50')
    expect(csv).toContain('"   3.1 Conta 3.1";1234,50;1234,50')
    expect(csv).toContain('"% Margem bruta";100,0%;100,0%')
  })
})
