import { describe, expect, it } from 'vitest'
import { alocar, centavos, competenciaSugerida } from '../src/conciliacao'

describe('competenciaSugerida = fn_competencia_sugerida', () => {
  it('mes_corrente / mes_anterior / manual', () => {
    expect(competenciaSugerida('mes_corrente', '2026-09-12')).toBe('2026-09-01')
    expect(competenciaSugerida('mes_anterior', '2026-09-05')).toBe('2026-08-01')
    expect(competenciaSugerida('mes_anterior', '2026-01-10')).toBe('2025-12-01')
    expect(competenciaSugerida('manual', '2026-09-05')).toBeNull()
  })
})

describe('alocar', () => {
  it('centavos sem erro de float', () => expect(centavos(0.1) + centavos(0.2)).toBe(30))
  it('1 → N exato', () => {
    const r = alocar([{ id: 'm', restante: 5000_00 }], [{ id: 'a', saldo: 3000_00 }, { id: 'b', saldo: 2000_00 }])
    expect(r).toEqual({ alocacoes: [{ idMovimento: 'm', idTitulo: 'a', centavos: 3000_00 }, { idMovimento: 'm', idTitulo: 'b', centavos: 2000_00 }], delta: 0 })
  })
  it('1 → N com títulos maiores que o movimento: corta no último, Δ negativo', () => {
    const r = alocar([{ id: 'm', restante: 100_00 }], [{ id: 'a', saldo: 80_00 }, { id: 'b', saldo: 50_00 }])
    expect(r.alocacoes.map((a) => a.centavos)).toEqual([80_00, 20_00])
    expect(r.delta).toBe(-30_00)
  })
  it('N → 1 parcial: Δ positivo, movimento fica divergente', () => {
    const r = alocar([{ id: 'm1', restante: 2400_00 }, { id: 'm2', restante: 2400_00 }], [{ id: 't', saldo: 5000_00 }])
    expect(r.alocacoes.map((a) => a.centavos)).toEqual([2400_00, 2400_00])
    expect(r.delta).toBe(-200_00)
  })
  it('N × M recusa', () => expect(alocar([{ id: 'a', restante: 1 }, { id: 'b', restante: 1 }], [{ id: 'x', saldo: 1 }, { id: 'y', saldo: 1 }]).erro).toBeTruthy())
})
