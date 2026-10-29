// DRE (competência) e DFC (caixa) montados a partir das linhas agregadas de bpo_fin.v_dre / v_dfc.
// Estrutura do DRE portada do seis-sistema (components/financeiro/dre/DreClient.tsx, DRE_ROWS) — mesma ordem,
// mesmos subtotais. Convenção do banco: receita positiva, saída NEGATIVA; subtotal = soma simples.
// Puro: sem rede, sem React. Valores em reais (number); somas arredondadas em centavos.

export interface LinhaDreApi {
  competencia: string; linha_dre: string | null; ordem_dre: number | null
  id_plano_conta: string; codigo: string; conta: string; natureza: string; valor: number; qtd_titulos: number
}
export interface LinhaDfcApi {
  mes: string; grupo_dfc: string | null; id_plano_conta: string; codigo: string; conta: string; valor: number; qtd_baixas: number
}

export interface ContaDemo { id_plano_conta: string; codigo: string; conta: string; valores: Record<string, number>; total: number }
export interface LinhaDemo {
  chave: string; rotulo: string
  tipo: 'dados' | 'calculo' | 'percentual' | 'espaco'
  destaque?: boolean; sub?: boolean
  valores: Record<string, number>; total: number
  /** linhas de dados: as contas do plano que compõem a linha (para abrir e para o detalhamento) */
  contas?: ContaDemo[]
  /** linhas de dados: quais linha_dre do plano entram aqui */
  linhasDre?: string[]
}

const c = (v: number) => Math.round(v * 100) / 100
const soma = (a: number, b: number) => c(a + b)

/** Meses (AAAA-MM-01) de `de` até `ate`, inclusive. */
export function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = []
  let [a, m] = de.split('-').map(Number) as [number, number]
  const [af, mf] = ate.split('-').map(Number) as [number, number]
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, '0')}-01`)
    if (++m > 12) { m = 1; a++ }
    if (out.length > 120) break
  }
  return out
}

type Def =
  | { chave: string; rotulo: string; tipo: 'dados'; linhas: string[]; destaque?: boolean; sub?: boolean }
  | { chave: string; rotulo: string; tipo: 'calculo'; fn: (v: Record<string, number>) => number; destaque?: boolean }
  | { chave: string; rotulo: string; tipo: 'percentual'; fn: (v: Record<string, number>) => number | null; sub?: boolean }
  | { chave: string; tipo: 'espaco' }

const pct = (num: number, base: number) => (base ? num / base : null)

/** Linhas de DRE conhecidas. `DESPESAS_FIXAS` (sem _OUTRAS) entra como apelido — é o nome do modelo de cliente. */
const DESP_FIXAS = ['FOLHA', 'DESPESAS_FIXAS_OUTRAS', 'DESPESAS_FIXAS']
export const LINHAS_DRE_CONHECIDAS = new Set([
  'RECEITA_BRUTA', 'DEDUCOES', 'CUSTOS_VARIAVEIS', ...DESP_FIXAS, 'INVEST_CRESCIMENTO',
  'RECEITAS_FINANCEIRAS', 'DESPESAS_FINANCEIRAS', 'IMPOSTO_LUCRO',
])

const DEFS: Def[] = [
  { chave: 'RECEITA_BRUTA', rotulo: 'Receita operacional bruta', tipo: 'dados', linhas: ['RECEITA_BRUTA'], destaque: true },
  { chave: 'DEDUCOES', rotulo: '(−) Deduções e descontos', tipo: 'dados', linhas: ['DEDUCOES'] },
  { chave: 'RECEITA_LIQUIDA', rotulo: 'Receita operacional líquida', tipo: 'calculo', fn: (v) => soma(v.RECEITA_BRUTA!, v.DEDUCOES!), destaque: true },
  { chave: 'CUSTOS_VARIAVEIS', rotulo: '(−) Custos variáveis', tipo: 'dados', linhas: ['CUSTOS_VARIAVEIS'] },
  { chave: 'LUCRO_BRUTO', rotulo: 'Lucro bruto', tipo: 'calculo', fn: (v) => soma(v.RECEITA_LIQUIDA!, v.CUSTOS_VARIAVEIS!), destaque: true },
  { chave: 'MARGEM_BRUTA', rotulo: '% Margem bruta', tipo: 'percentual', fn: (v) => pct(v.LUCRO_BRUTO!, v.RECEITA_BRUTA!) },
  { chave: 'e1', tipo: 'espaco' },
  { chave: 'DESPESAS_FIXAS', rotulo: '(−) Despesas fixas operacionais', tipo: 'dados', linhas: DESP_FIXAS },
  { chave: 'FOLHA', rotulo: 'Folha de pagamento', tipo: 'dados', linhas: ['FOLHA'], sub: true },
  { chave: 'PCT_FOLHA', rotulo: '% Folha', tipo: 'percentual', fn: (v) => pct(Math.abs(v.FOLHA!), v.RECEITA_BRUTA!), sub: true },
  { chave: 'EBITDA', rotulo: 'EBITDA', tipo: 'calculo', fn: (v) => soma(v.LUCRO_BRUTO!, v.DESPESAS_FIXAS!), destaque: true },
  { chave: 'MARGEM_EBITDA', rotulo: '% Margem EBITDA', tipo: 'percentual', fn: (v) => pct(v.EBITDA!, v.RECEITA_BRUTA!) },
  { chave: 'e2', tipo: 'espaco' },
  { chave: 'INVEST_CRESCIMENTO', rotulo: '(−) Investimento em crescimento', tipo: 'dados', linhas: ['INVEST_CRESCIMENTO'] },
  { chave: 'RECEITAS_FINANCEIRAS', rotulo: '(+) Receitas financeiras', tipo: 'dados', linhas: ['RECEITAS_FINANCEIRAS'] },
  { chave: 'DESPESAS_FINANCEIRAS', rotulo: '(−) Despesas financeiras', tipo: 'dados', linhas: ['DESPESAS_FINANCEIRAS'] },
  { chave: 'OUTRAS', rotulo: 'Outras (conta sem linha de DRE padrão)', tipo: 'dados', linhas: [] },
  { chave: 'LUCRO_ANTES_IR', rotulo: 'Lucro antes do imposto', tipo: 'calculo', destaque: true,
    fn: (v) => [v.INVEST_CRESCIMENTO!, v.RECEITAS_FINANCEIRAS!, v.DESPESAS_FINANCEIRAS!, v.OUTRAS!].reduce(soma, v.EBITDA!) },
  { chave: 'IMPOSTO_LUCRO', rotulo: '(−) Imposto sobre lucro/faturamento', tipo: 'dados', linhas: ['IMPOSTO_LUCRO'] },
  { chave: 'LUCRO_LIQUIDO', rotulo: 'Lucro líquido', tipo: 'calculo', fn: (v) => soma(v.LUCRO_ANTES_IR!, v.IMPOSTO_LUCRO!), destaque: true },
  { chave: 'MARGEM_LIQUIDA', rotulo: '% Margem líquida', tipo: 'percentual', fn: (v) => pct(v.LUCRO_LIQUIDO!, v.RECEITA_BRUTA!) },
]

/**
 * Monta o DRE mês a mês. Linha de DRE que o padrão não conhece (plano de contas de cliente com código próprio)
 * cai em "Outras" — nunca some. `Total` é calculado sobre os totais (margem do período, não média de margens).
 */
export function montarDre(rows: LinhaDreApi[], meses: string[]): LinhaDemo[] {
  const contasPorLinha = new Map<string, Map<string, ContaDemo>>()
  for (const r of rows) {
    const linha = r.linha_dre && LINHAS_DRE_CONHECIDAS.has(r.linha_dre) ? r.linha_dre : 'OUTRAS'
    const mapa = contasPorLinha.get(linha) ?? contasPorLinha.set(linha, new Map()).get(linha)!
    const conta = mapa.get(r.id_plano_conta) ?? mapa.set(r.id_plano_conta, { id_plano_conta: r.id_plano_conta, codigo: r.codigo, conta: r.conta, valores: {}, total: 0 }).get(r.id_plano_conta)!
    conta.valores[r.competencia] = soma(conta.valores[r.competencia] ?? 0, r.valor)
    conta.total = soma(conta.total, r.valor)
  }
  const colunas = [...meses, 'TOTAL']
  const porColuna: Record<string, Record<string, number>> = Object.fromEntries(colunas.map((m) => [m, {}]))
  const saida: LinhaDemo[] = []
  for (const d of DEFS) {
    if (d.tipo === 'espaco') { saida.push({ chave: d.chave, rotulo: '', tipo: 'espaco', valores: {}, total: 0 }); continue }
    const valores: Record<string, number> = {}
    let contas: ContaDemo[] | undefined
    if (d.tipo === 'dados') {
      const linhas = d.chave === 'OUTRAS' ? ['OUTRAS'] : d.linhas
      contas = linhas.flatMap((l) => [...(contasPorLinha.get(l)?.values() ?? [])]).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
      for (const col of colunas) valores[col] = c(contas.reduce((s, k) => s + (col === 'TOTAL' ? k.total : k.valores[col] ?? 0), 0))
    } else {
      for (const col of colunas) { const v = d.fn(porColuna[col]!); valores[col] = v ?? NaN }
    }
    for (const col of colunas) porColuna[col]![d.chave] = valores[col]!
    // "Outras" só aparece se tiver movimento — não polui o DRE padrão
    if (d.chave === 'OUTRAS' && !contas?.length) continue
    const { TOTAL, ...porMes } = valores
    saida.push({ chave: d.chave, rotulo: d.rotulo, tipo: d.tipo, destaque: 'destaque' in d ? d.destaque : undefined, sub: 'sub' in d ? d.sub : undefined,
      valores: porMes, total: TOTAL!, contas, linhasDre: d.tipo === 'dados' ? (d.chave === 'OUTRAS' ? [] : d.linhas) : undefined })
  }
  return saida
}

const GRUPOS_DFC: [string, string][] = [['operacional', 'Atividades operacionais'], ['investimento', 'Atividades de investimento'], ['financiamento', 'Atividades de financiamento']]

/** DFC pelo método direto: grupos do plano (grupo_dfc) com as contas, subtotal por grupo e a variação de caixa. */
export function montarDfc(rows: LinhaDfcApi[], meses: string[]): LinhaDemo[] {
  const colunas = [...meses, 'TOTAL']
  const saida: LinhaDemo[] = []
  const totalGeral: Record<string, number> = Object.fromEntries(colunas.map((m) => [m, 0]))
  const grupos = [...GRUPOS_DFC, ...(rows.some((r) => !r.grupo_dfc || !GRUPOS_DFC.some(([g]) => g === r.grupo_dfc)) ? [['outros', 'Sem grupo de DFC'] as [string, string]] : [])]
  for (const [g, rotulo] of grupos) {
    const doGrupo = rows.filter((r) => (g === 'outros' ? !r.grupo_dfc || !GRUPOS_DFC.some(([x]) => x === r.grupo_dfc) : r.grupo_dfc === g))
    const contas = new Map<string, ContaDemo>()
    for (const r of doGrupo) {
      const k = contas.get(r.id_plano_conta) ?? contas.set(r.id_plano_conta, { id_plano_conta: r.id_plano_conta, codigo: r.codigo, conta: r.conta, valores: {}, total: 0 }).get(r.id_plano_conta)!
      k.valores[r.mes] = soma(k.valores[r.mes] ?? 0, r.valor); k.total = soma(k.total, r.valor)
    }
    const lista = [...contas.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
    const valores: Record<string, number> = {}
    for (const col of colunas) {
      valores[col] = c(lista.reduce((s, k) => s + (col === 'TOTAL' ? k.total : k.valores[col] ?? 0), 0))
      totalGeral[col] = soma(totalGeral[col]!, valores[col]!)
    }
    const { TOTAL, ...porMes } = valores
    saida.push({ chave: `G_${g}`, rotulo, tipo: 'dados', valores: porMes, total: TOTAL!, contas: lista })
  }
  const { TOTAL, ...porMes } = totalGeral
  saida.push({ chave: 'VARIACAO', rotulo: 'Variação de caixa no período', tipo: 'calculo', destaque: true, valores: porMes, total: TOTAL! })
  return saida
}

/** CSV no padrão do seis-sistema (consulta/exportCsv.ts): BOM, ';', campos entre aspas, vírgula decimal. */
export function demonstrativoCsv(linhas: LinhaDemo[], meses: string[], rotuloMes: (m: string) => string): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const num = (v: number, tipo: LinhaDemo['tipo']) => (Number.isNaN(v) ? '' : tipo === 'percentual' ? (v * 100).toFixed(1).replace('.', ',') + '%' : v.toFixed(2).replace('.', ','))
  const out = [[q('Linha'), ...meses.map((m) => q(rotuloMes(m))), q('Total')].join(';')]
  for (const l of linhas) {
    if (l.tipo === 'espaco') continue
    out.push([q(l.rotulo), ...meses.map((m) => num(l.valores[m] ?? 0, l.tipo)), num(l.total, l.tipo)].join(';'))
    for (const k of l.contas ?? []) out.push([q(`   ${k.codigo} ${k.conta}`), ...meses.map((m) => num(k.valores[m] ?? 0, 'dados')), num(k.total, 'dados')].join(';'))
  }
  return '﻿' + out.join('\r\n')
}
