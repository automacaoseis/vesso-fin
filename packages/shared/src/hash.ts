// Hash natural do movimento — reproduz byte a byte bpo_fin.fn_hash_natural (sql/0001, linha ~587):
//   sha256(id_conta | AAAA-MM-DD | to_char(valor, 'FM999999999990.00') | fn_normalizar_descricao(descricao) | seq)
//
// Detalhes medidos em produção (Postgres 17, locale ICU en-US) em 23/10/2026 — não "simplificar":
// - upper() do ICU = String.prototype.toUpperCase() (ß→SS, ﬁ→FI, ǆ→Ǆ).
// - btrim() sem 2º argumento tira SÓ o espaço U+0020; tab/quebra nas pontas viram um espaço pelo regex depois.
// - \s do regex do Postgres com ICU = u_isspace: propriedade White_Space + U+001C..U+001F.
//   NÃO é o \s do JS (que pega U+FEFF e não pega U+0085).
// - to_char arredonda meio centavo para longe do zero (1.005 → 1.01; -0.005 → -0.01) e -0.004 vira "0.00" sem sinal.
//   Por isso o valor é tratado como texto decimal, nunca com toFixed (que erra 1.005).
// - id_conta::text sai minúsculo e com hífens.
// Só para servidor (node:crypto). O teste compara com o SQL: packages/shared/test/hash*.test.ts.
import { createHash } from 'node:crypto'

const ESPACO_PG = /[\p{White_Space}\u001C-\u001F]+/gu

export function normalizarDescricao(descricao: string | null | undefined): string {
  return (descricao ?? '').toUpperCase().replace(/^ +| +$/g, '').replace(ESPACO_PG, ' ')
}

// numeric(14,2) — o maior valor que cabe em movimentos.valor e no to_char 'FM999999999990.00'.
const MAX_CENTAVOS = 99_999_999_999_999n

/** Valor com 2 casas e ponto, igual ao to_char do SQL. Aceite texto decimal ("−" não; use "-"). */
export function valorHash(valor: string | number): string {
  let s = typeof valor === 'number' ? numeroParaDecimal(valor) : valor.trim()
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`valor inválido para o hash: ${JSON.stringify(valor)}`)
  const negativo = m[1] === '-'
  const frac = (m[3] ?? '').padEnd(3, '0')
  let centavos = BigInt((m[2] || '0') + frac.slice(0, 2))
  if (frac.charCodeAt(2) >= 53 /* '5' */) centavos += 1n
  if (centavos > MAX_CENTAVOS) throw new Error(`valor fora de numeric(14,2): ${s}`)
  const txt = centavos.toString().padStart(3, '0')
  const sinal = negativo && centavos !== 0n ? '-' : ''
  return `${sinal}${txt.slice(0, -2)}.${txt.slice(-2)}`
}

function numeroParaDecimal(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`valor inválido para o hash: ${n}`)
  const s = String(n)
  if (!s.includes('e')) return s
  if (Math.abs(n) < 1) return '0' // 1e-7 etc.: arredonda para zero
  throw new Error(`valor fora de numeric(14,2): ${s}`)
}

function uuidTexto(id: string): string {
  const hex = id.replace(/[{}-]/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`id_conta não é uuid: ${id}`)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function dataTexto(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data)
  const d = m && new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))
  if (!d || d.toISOString().slice(0, 10) !== data) throw new Error(`data inválida (AAAA-MM-DD): ${data}`)
  return data
}

export interface LinhaHash {
  idConta: string
  /** AAAA-MM-DD, sem fuso: é a data do extrato, não um instante. */
  data: string
  /** Com sinal: positivo entra, negativo sai. Prefira o texto da fonte (TRNAMT) a um number. */
  valor: string | number
  descricao: string | null | undefined
  seq: number
}

export function textoHash(l: LinhaHash): string {
  if (!Number.isInteger(l.seq) || l.seq < 0) throw new Error(`seq inválido: ${l.seq}`)
  return [uuidTexto(l.idConta), dataTexto(l.data), valorHash(l.valor), normalizarDescricao(l.descricao), String(l.seq)].join('|')
}

export function hashNatural(l: LinhaHash): string {
  return createHash('sha256').update(textoHash(l), 'utf8').digest('hex')
}

/**
 * Atribui seq (0, 1, 2…) entre linhas idênticas — mesma conta, data, valor (2 casas) e descrição normalizada —
 * na ordem em que chegaram. A ordem tem que ser estável entre reimportações (a do arquivo), senão o hash muda.
 */
export function comHash<T extends Omit<LinhaHash, 'seq'>>(linhas: readonly T[]): (T & { seq: number; hash: string })[] {
  const vistos = new Map<string, number>()
  return linhas.map((l) => {
    const chave = [uuidTexto(l.idConta), l.data, valorHash(l.valor), normalizarDescricao(l.descricao)].join('|')
    const seq = vistos.get(chave) ?? 0
    vistos.set(chave, seq + 1)
    return { ...l, seq, hash: hashNatural({ ...l, seq }) }
  })
}
