import { describe, expect, it } from 'vitest'
import { fmtBRL } from '../src/fmtBRL'

describe('fmtBRL', () => {
  it('positivo sem sinal, com centavos acima de mil (o fmtMoney do admin cortava)', () => {
    expect(fmtBRL(1234.5)).toBe('1.234,50')
    expect(fmtBRL(1234567.891)).toBe('1.234.567,89')
    expect(fmtBRL(0.1)).toBe('0,10')
  })
  it('negativo com U+2212 em movimento e portal, parênteses em demonstrativo', () => {
    expect(fmtBRL(-12.4)).toBe('−12,40')
    expect(fmtBRL(-12.4, 'portal')).toBe('−12,40')
    expect(fmtBRL(-1234.5, 'demonstrativo')).toBe('(1.234,50)')
    expect(fmtBRL(-12.4)).not.toContain('-')
  })
  it('zero: "0,00" por padrão (conciliação), traço no DRE', () => {
    expect(fmtBRL(0)).toBe('0,00')
    expect(fmtBRL(-0)).toBe('0,00')
    expect(fmtBRL(0, 'demonstrativo', { zero: 'traco' })).toBe('—')
  })
  it('menos de meio centavo é zero, nunca "−0,00"', () => {
    expect(fmtBRL(-0.004)).toBe('0,00')
    expect(fmtBRL(-0.004, 'demonstrativo', { zero: 'traco' })).toBe('—')
    expect(fmtBRL(-0.006)).toBe('−0,01')
  })
  it('ausente ou não finito → traço', () => {
    for (const v of [null, undefined, NaN, Infinity]) expect(fmtBRL(v)).toBe('—')
  })
})
