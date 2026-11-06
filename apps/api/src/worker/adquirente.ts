// Adapter de maquininha / adquirente (0015): o CSV de vendas/recebíveis vira movimentos na CONTA da maquininha.
// Sem tabela nova (docs/PROMPT.md §5). Por DIA, três tipos de movimento:
//   venda    + bruto  (data da venda, por produto/bandeira)   → concilia com o título de receita
//   taxa     − MDR    (data da venda, por produto/bandeira)   → lança como despesa financeira
//   repasse  − líquido (data do pagamento)                    → TRANSFERÊNCIA para o banco (casa com o depósito)
// O saldo da conta é a agenda de recebíveis: o que foi vendido e ainda não caiu. O arquivo informa isso (soma do
// líquido com pagamento futuro), e é esse número que vai para saldos_extrato — a fonte confere o sistema.
//
// Cada adquirente exporta de um jeito; o leitor reconhece os nomes de coluna mais comuns (Stone, Cielo, Rede,
// PagSeguro, Getnet, SumUp) e o formato brasileiro ("R$ 1.234,56", dd/mm/aaaa, separador ; ou ,).

export class AdquirenteInvalido extends Error {}

export interface VendaCartao {
  dataVenda: string            // AAAA-MM-DD
  dataPagamento: string | null // AAAA-MM-DD (prevista ou efetiva)
  bruto: number; taxa: number; liquido: number
  produto: string              // credito | debito | pix | voucher | outro
  bandeira: string | null
  parcela: string | null
  id: string | null            // NSU / autorização / id da transação
  linha: number
}

// nomes aceitos por campo (comparados sem acento, minúsculos, sem pontuação)
const COLUNAS: Record<string, string[]> = {
  dataVenda: ['data da venda', 'data venda', 'data de venda', 'dt venda', 'data da transacao', 'data transacao', 'data de transacao', 'data e hora da venda', 'data/hora', 'data hora', 'data'],
  dataPagamento: ['data de pagamento', 'data pagamento', 'data do pagamento', 'previsao de pagamento', 'data prevista', 'data prevista de pagamento', 'previsao', 'data de recebimento', 'data do recebimento', 'data de liquidacao', 'data liquidacao', 'vencimento', 'data de vencimento', 'data do credito'],
  bruto: ['valor bruto', 'vlr bruto', 'valor da venda', 'valor venda', 'valor bruto da parcela', 'valor da parcela', 'valor total', 'bruto', 'valor'],
  taxa: ['taxa', 'taxas', 'valor da taxa', 'valor taxa', 'tarifa', 'tarifas', 'mdr', 'valor mdr', 'desconto', 'valor do desconto', 'custo'],
  liquido: ['valor liquido', 'vlr liquido', 'valor liquido da parcela', 'liquido', 'valor a receber', 'valor recebido', 'valor creditado'],
  produto: ['produto', 'tipo', 'modalidade', 'forma de pagamento', 'tipo de transacao', 'tipo de venda', 'meio de pagamento', 'tipo de pagamento'],
  bandeira: ['bandeira', 'brand', 'cartao'],
  parcela: ['parcela', 'n parcela', 'numero da parcela', 'numero parcela', 'parcelas', 'plano'],
  id: ['nsu', 'stone id', 'stone code', 'id da transacao', 'id transacao', 'codigo da transacao', 'tid', 'cv nsu', 'nsu cv', 'autorizacao', 'codigo de autorizacao', 'codigo da venda'],
  status: ['status', 'situacao', 'status da venda', 'status do pagamento'],
}
const CANCELADO = /cancel|estorn|chargeback|contesta|negad|recusad|desfeit/

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim()

function decodificar(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // planilha exportada do Windows costuma vir em latin1: "Ã§" no lugar de "ç" denuncia leitura errada
  const texto = utf8.includes('�') ? new TextDecoder('latin1').decode(bytes) : utf8
  return texto.replace(/^﻿/, '')
}

function separarLinhas(texto: string, sep: string): string[][] {
  const out: string[][] = []
  let campo = '', linha: string[] = [], aspas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++ } else aspas = false } else campo += ch
    } else if (ch === '"') aspas = true
    else if (ch === sep) { linha.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some((c) => c.trim() !== '')) out.push(linha)
      linha = []
    } else campo += ch
  }
  linha.push(campo)
  if (linha.some((c) => c.trim() !== '')) out.push(linha)
  return out
}

/** "R$ -1.234,56" → -1234.56 · "1234.56" → 1234.56 · "(12,30)" → -12.3 */
export function lerValor(s: string | undefined): number | null {
  if (s == null) return null
  let t = s.trim().replace(/R\$|\s/g, '')
  if (!t) return null
  let neg = false
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1) }
  if (t.startsWith('-')) { neg = true; t = t.slice(1) }
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1) }
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Math.round(Number(t) * 100) / 100
  return neg ? -n : n
}

/** dd/mm/aaaa[ hh:mm], dd/mm/aa, aaaa-mm-dd[Thh:mm] → AAAA-MM-DD */
export function lerData(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t)
  if (!m) return null
  const ano = m[3]!.length === 2 ? `20${m[3]}` : m[3]!
  const d = `${ano}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  return Number.isNaN(Date.parse(d)) ? null : d
}

function produtoDe(s: string | undefined): string {
  const t = norm(s ?? '')
  if (/debit/.test(t)) return 'debito'
  if (/pix/.test(t)) return 'pix'
  if (/voucher|vale|refei|alimenta/.test(t)) return 'voucher'
  if (/credit|parcel|a vista/.test(t)) return 'credito'
  return t ? 'outro' : 'credito'
}

export interface LeituraAdquirente { vendas: VendaCartao[]; canceladas: number; ignoradas: number; colunas: Record<string, string> }

export function lerAdquirente(bytes: Uint8Array): LeituraAdquirente {
  const texto = decodificar(bytes)
  const primeira = texto.split(/\r?\n/).find((l) => l.trim()) ?? ''
  const sep = [';', '\t', ','].map((s) => [s, primeira.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0]
  const linhas = separarLinhas(texto, sep)
  // cabeçalho: a primeira das 10 primeiras linhas que tenha data, bruto e (taxa ou líquido)
  let ic = -1, mapa: Record<string, number> = {}
  for (let i = 0; i < Math.min(linhas.length, 10) && ic < 0; i++) {
    const cab = linhas[i]!.map(norm)
    const m: Record<string, number> = {}
    for (const [campo, nomes] of Object.entries(COLUNAS)) {
      for (const nome of nomes) {           // nomes em ordem de preferência: o primeiro que existir ganha
        const j = cab.findIndex((c, k) => c === nome && !Object.values(m).includes(k))
        if (j >= 0) { m[campo] = j; break }
      }
    }
    if (m.dataVenda !== undefined && m.bruto !== undefined && (m.taxa !== undefined || m.liquido !== undefined)) { ic = i; mapa = m }
  }
  if (ic < 0) throw new AdquirenteInvalido('não reconheci as colunas do arquivo: preciso de data da venda, valor bruto e taxa ou valor líquido (CSV exportado do portal da maquininha)')

  const cab = linhas[ic]!
  const colunas = Object.fromEntries(Object.entries(mapa).map(([k, j]) => [k, cab[j]!.trim()]))
  const vendas: VendaCartao[] = []
  let canceladas = 0, ignoradas = 0
  for (let i = ic + 1; i < linhas.length; i++) {
    const l = linhas[i]!
    const v = (campo: string) => (mapa[campo] === undefined ? undefined : l[mapa[campo]!])
    if (mapa.status !== undefined && CANCELADO.test(norm(v('status') ?? ''))) { canceladas++; continue }
    const dataVenda = lerData(v('dataVenda'))
    const bruto = lerValor(v('bruto'))
    let taxa = lerValor(v('taxa'))
    let liquido = lerValor(v('liquido'))
    if (!dataVenda || bruto === null || (taxa === null && liquido === null)) { ignoradas++; continue }   // total, subtotal, linha em branco
    taxa = taxa === null ? Math.round((Math.abs(bruto) - Math.abs(liquido!)) * 100) / 100 : Math.abs(taxa)
    liquido = liquido === null ? Math.round((Math.abs(bruto) - taxa) * 100) / 100 : Math.abs(liquido)
    if (bruto < 0) { canceladas++; continue }   // linha negativa = estorno no relatório de vendas
    vendas.push({
      dataVenda, dataPagamento: lerData(v('dataPagamento')), bruto, taxa, liquido,
      produto: produtoDe(v('produto')), bandeira: v('bandeira')?.trim() || null, parcela: v('parcela')?.trim() || null,
      id: v('id')?.trim() || null, linha: i + 1,
    })
  }
  if (vendas.length === 0) throw new AdquirenteInvalido('o arquivo não tem nenhuma venda válida')
  return { vendas, canceladas, ignoradas, colunas }
}

export interface MovimentoAdquirente { chave: string; tipo: 'venda' | 'taxa' | 'repasse'; data: string; valor: string; descricao: string; qtd: number }

const dinheiro = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const ROT_PRODUTO: Record<string, string> = { credito: 'crédito', debito: 'débito', pix: 'PIX', voucher: 'voucher', outro: 'outros' }

/**
 * Agrega por dia. ⚠️ Só DIAS FECHADOS (anteriores a `hoje`): o total de um dia ainda em andamento muda na próxima
 * exportação, e o movimento é imutável — um total parcial viraria diferença eterna. Repasse idem: só com data de
 * pagamento já passada (o futuro é agenda, e entra no saldo, não em movimento).
 * Dias antes do `corte` (competência inicial da org) também não entram — são histórico.
 */
export function montarMovimentos(vendas: VendaCartao[], hoje: string, corte: string | null) {
  const grupos = new Map<string, MovimentoAdquirente & { soma: number }>()
  const somar = (chave: string, tipo: MovimentoAdquirente['tipo'], data: string, valor: number, descricao: string) => {
    const g = grupos.get(chave) ?? { chave, tipo, data, valor: '0', descricao, qtd: 0, soma: 0 }
    g.soma += valor; g.qtd++; grupos.set(chave, g)
  }
  let parciais = 0, anteriores = 0
  for (const x of vendas) {
    if (corte && x.dataVenda < corte) { anteriores++; continue }
    if (x.dataVenda >= hoje) { parciais++; continue }
    const bandeira = x.bandeira ? norm(x.bandeira).replace(/ /g, '-') : 'sem-bandeira'
    const rot = `${ROT_PRODUTO[x.produto] ?? x.produto}${x.bandeira ? ` ${x.bandeira}` : ''}`
    somar(`venda|${x.dataVenda}|${x.produto}|${bandeira}`, 'venda', x.dataVenda, x.bruto, `Vendas cartão ${rot}`)
    if (x.taxa > 0) somar(`taxa|${x.dataVenda}|${x.produto}|${bandeira}`, 'taxa', x.dataVenda, -x.taxa, `Taxa da maquininha ${rot}`)
    if (x.dataPagamento && x.dataPagamento < hoje && (!corte || x.dataPagamento >= corte))
      somar(`repasse|${x.dataPagamento}`, 'repasse', x.dataPagamento, -x.liquido, 'Repasse da maquininha para o banco')
  }
  const movimentos = [...grupos.values()].filter((g) => Math.abs(g.soma) >= 0.005)
    .map(({ soma, ...g }) => ({ ...g, valor: dinheiro(soma), descricao: `${g.descricao} (${g.qtd} ${g.tipo === 'repasse' ? 'parcela' : 'venda'}${g.qtd > 1 ? 's' : ''})` }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.chave.localeCompare(b.chave))
  // agenda de recebíveis no fim do último dia fechado: vendido até lá e com pagamento depois
  const dias = vendas.map((x) => x.dataVenda).filter((d) => d < hoje)
  const ultimoDia = dias.length ? dias.reduce((a, b) => (a > b ? a : b)) : null
  const saldo = ultimoDia ? {
    data: ultimoDia,
    valor: dinheiro(vendas.filter((x) => x.dataVenda <= ultimoDia && x.dataPagamento && x.dataPagamento > ultimoDia).reduce((s, x) => s + x.liquido, 0)),
  } : null
  return { movimentos, saldo, parciais, anteriores }
}
