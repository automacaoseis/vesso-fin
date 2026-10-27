// Regras puras da tela de Conciliação, em CENTAVOS inteiros (nada de somar float de dinheiro).

export const centavos = (v: number): number => Math.round(v * 100)
export const reais = (c: number): number => c / 100

/** Espelho de bpo_fin.fn_competencia_sugerida. `manual` → null (o banco exige competência informada). */
export function competenciaSugerida(regra: 'mes_corrente' | 'mes_anterior' | 'manual' | string, data: string): string | null {
  const [a, m] = data.split('-').map(Number) as [number, number]
  if (regra === 'mes_corrente') return `${a}-${String(m).padStart(2, '0')}-01`
  if (regra === 'mes_anterior') {
    const [aa, mm] = m === 1 ? [a - 1, 12] : [a, m - 1]
    return `${aa}-${String(mm).padStart(2, '0')}-01`
  }
  return null
}

export interface Alocacao { idMovimento: string; idTitulo: string; centavos: number }

/**
 * Seleção múltipla → baixas. Só 1×N ou N×1 (N×M é ambíguo: qual movimento paga qual título?).
 * Distribui na ordem da seleção, sem passar do restante de nenhum dos lados. Δ = movimentos − títulos:
 * ≠ 0 vira "conciliar parcial" e a linha fica divergente até fechar.
 */
export function alocar(
  movs: { id: string; restante: number }[],
  titulos: { id: string; saldo: number }[],
): { alocacoes: Alocacao[]; delta: number; erro?: string } {
  const somaM = movs.reduce((s, m) => s + m.restante, 0)
  const somaT = titulos.reduce((s, t) => s + t.saldo, 0)
  const delta = somaM - somaT
  if (!movs.length || !titulos.length) return { alocacoes: [], delta, erro: 'selecione movimento e título' }
  if (movs.length > 1 && titulos.length > 1) return { alocacoes: [], delta, erro: 'selecione um só de um dos lados (1 → N ou N → 1)' }
  const alocacoes: Alocacao[] = []
  if (movs.length === 1) {
    let resta = movs[0]!.restante
    for (const t of titulos) {
      const c = Math.min(resta, t.saldo)
      if (c > 0) alocacoes.push({ idMovimento: movs[0]!.id, idTitulo: t.id, centavos: c })
      resta -= c
    }
  } else {
    let resta = titulos[0]!.saldo
    for (const m of movs) {
      const c = Math.min(resta, m.restante)
      if (c > 0) alocacoes.push({ idMovimento: m.id, idTitulo: titulos[0]!.id, centavos: c })
      resta -= c
    }
  }
  return { alocacoes, delta }
}
