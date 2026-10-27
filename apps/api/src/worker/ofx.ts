// Leitor de OFX — 1.x (SGML, tags de campo sem fechamento) e 2.x (XML). Sem dependência externa:
// o formato que importa aqui é pequeno, e banco brasileiro foge do padrão de jeitos que biblioteca nenhuma cobre:
//   · Latin-1/Windows-1252 com frequência (CHARSET:1252), às vezes sem declarar;
//   · valor com vírgula decimal ("-50,00");
//   · FITID repetido no mesmo arquivo (o hash natural é a rede de segurança).

export interface TransacaoOfx {
  fitid: string | null
  data: string            // AAAA-MM-DD (DTPOSTED, sem fuso: é a data do extrato)
  valor: string           // texto decimal com ponto, sinal da fonte — vai direto para o hash
  descricao: string | null
  contraparte: string | null
  tipo: string | null     // TRNTYPE
  bruto: Record<string, string>
}

export interface Ofx {
  codificacao: 'utf-8' | 'windows-1252'
  banco: string | null    // BANKID
  conta: string | null    // ACCTID
  periodo: { inicio: string; fim: string } | null
  saldo: { valor: string; data: string } | null
  transacoes: TransacaoOfx[]
}

export class OfxInvalido extends Error {}

export function decodificar(bytes: Uint8Array): { texto: string; codificacao: Ofx['codificacao'] } {
  const cabeca = new TextDecoder('latin1').decode(bytes.subarray(0, 512))
  const declaraUtf8 = /ENCODING:\s*UTF-?8|encoding=["']utf-8["']/i.test(cabeca) || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  const declara1252 = /CHARSET:\s*(1252|ISO-?8859-?1)/i.test(cabeca)
  if (!declara1252) {
    try {
      return { texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), codificacao: 'utf-8' }
    } catch {
      if (declaraUtf8) throw new OfxInvalido('arquivo declara UTF-8 mas tem bytes inválidos')
    }
  }
  return { texto: new TextDecoder('windows-1252').decode(bytes), codificacao: 'windows-1252' }
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function limpar(v: string): string {
  return v.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTIDADES[e.toLowerCase()] ?? m
  }).trim()
}

/** Valor de um campo: em SGML vai até o próximo "<" ou fim de linha; em XML, até o fechamento. */
function campo(bloco: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(bloco)
  if (!m) return null
  const v = limpar(m[1]!)
  return v === '' ? null : v
}

export function dataOfx(v: string | null): string | null {
  if (!v) return null
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v)
  if (!m) return null
  const d = `${m[1]}-${m[2]}-${m[3]}`
  const dt = new Date(`${d}T00:00:00Z`)
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d ? d : null
}

/** "-1.234,56" · "-1234,56" · "-1234.56" · "+50" → texto decimal com ponto. */
export function valorOfx(v: string | null): string | null {
  if (!v) return null
  let s = v.replace(/\s/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  return /^[+-]?\d+(\.\d+)?$/.test(s) ? s.replace(/^\+/, '') : null
}

export function lerOfx(bytes: Uint8Array): Ofx {
  const { texto, codificacao } = decodificar(bytes)
  if (!/<OFX>/i.test(texto)) throw new OfxInvalido('não é um arquivo OFX (falta <OFX>)')

  const lista = /<BANKTRANLIST>([\s\S]*?)(<\/BANKTRANLIST>|$)/i.exec(texto)?.[1] ?? ''
  const blocos = [...texto.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1]!)
  // SGML sem </STMTTRN>: corta no próximo <STMTTRN> ou no fim da lista
  const semFechamento = blocos.length === 0 && /<STMTTRN>/i.test(texto)
    ? lista.split(/<STMTTRN>/i).slice(1) : blocos

  const transacoes: TransacaoOfx[] = semFechamento.map((b, i) => {
    const data = dataOfx(campo(b, 'DTPOSTED'))
    const valor = valorOfx(campo(b, 'TRNAMT'))
    if (!data) throw new OfxInvalido(`transação ${i + 1}: DTPOSTED inválido (${campo(b, 'DTPOSTED')})`)
    if (valor === null) throw new OfxInvalido(`transação ${i + 1}: TRNAMT inválido (${campo(b, 'TRNAMT')})`)
    const memo = campo(b, 'MEMO'), nome = campo(b, 'NAME')
    const bruto: Record<string, string> = {}
    for (const m of b.matchAll(/<([A-Z0-9.]+)>([^<\r\n]*)/gi)) if (m[2]!.trim()) bruto[m[1]!.toUpperCase()] = limpar(m[2]!)
    return {
      fitid: campo(b, 'FITID'), data, valor,
      descricao: memo ?? nome,
      contraparte: memo && nome && nome !== memo ? nome : null,
      tipo: campo(b, 'TRNTYPE'), bruto,
    }
  })

  const ini = dataOfx(campo(lista, 'DTSTART')), fim = dataOfx(campo(lista, 'DTEND'))
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(texto)?.[1] ?? ''
  const saldoValor = valorOfx(campo(ledger, 'BALAMT')), saldoData = dataOfx(campo(ledger, 'DTASOF'))

  return {
    codificacao,
    banco: campo(texto, 'BANKID'),
    conta: campo(texto, 'ACCTID'),
    periodo: ini && fim && ini <= fim ? { inicio: ini, fim } : null,
    saldo: saldoValor !== null && saldoData ? { valor: saldoValor, data: saldoData } : null,
    transacoes,
  }
}
