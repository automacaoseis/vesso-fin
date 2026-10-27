// Formatação de dinheiro do Vesso FIN (docs/PROMPT.md §6).
// "R$" vai no cabeçalho da coluna, nunca no número. A direção vem do sinal, não da cor.
//   movimento     → 1.234,56 · −1.234,56   (U+2212, não hífen)
//   demonstrativo → 1.234,56 · (1.234,56)
//   portal        → igual a movimento
// Na conciliação, diferença zero mostra "0,00" (o zero é a informação). No DRE, linha vazia usa { zero: 'traco' }.

export type EstiloBRL = 'movimento' | 'demonstrativo' | 'portal'

const MENOS = '−'

export function fmtBRL(
  v: number | null | undefined,
  estilo: EstiloBRL = 'movimento',
  opts?: { zero?: 'traco' | 'zero' },
): string {
  if (v == null || !Number.isFinite(v)) return '—'
  // Abaixo de meio centavo o número impresso seria 0,00: trata como zero para não sair "−0,00".
  if (Math.abs(v) < 0.005) return opts?.zero === 'traco' ? '—' : '0,00'
  const abs = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (v > 0) return abs
  return estilo === 'demonstrativo' ? `(${abs})` : `${MENOS}${abs}`
}
