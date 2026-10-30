// Datas no fuso de São Paulo (o servidor roda em UTC na Vercel).
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** 'YYYY-MM' do mês corrente em São Paulo. */
export function mesAtualSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date())
}
/** 'YYYY-MM-DD' de hoje em São Paulo. */
export function hojeDataSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}
/** 'YYYY-MM' + n meses. */
export function deslocarMes(ym: string, n: number) {
  return new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)
}
/** O mês que se fecha agora: o anterior ao corrente. */
export function mesAnteriorSP() { return deslocarMes(mesAtualSP(), -1) }
/** 'YYYY-MM[-DD]' → 'out/26' */
export function mesCurto(d: string) { return `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}` }
export const ehMes = (m?: string): m is string => !!m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
