import { describe, expect, it } from 'vitest'
import { AdquirenteInvalido, lerAdquirente, lerData, lerValor, montarMovimentos } from '../src/worker/adquirente'

const utf8 = (s: string) => new TextEncoder().encode(s)
const latin1 = (s: string) => Uint8Array.from([...s].map((ch) => ch.charCodeAt(0)))

// estilo Stone: ; + vírgula decimal + R$, colunas com acento, uma cancelada, linha de total no fim
export const STONE = `Relatório de vendas;;;;;;;;
Data da venda;Data de pagamento;Produto;Bandeira;Parcela;Valor bruto;Taxa;Valor líquido;Status;Stone ID
02/11/2026 10:15;03/11/2026;Débito;Visa;1/1;R$ 200,00;R$ 2,00;R$ 198,00;Pago;S1
02/11/2026 11:00;02/12/2026;Crédito;Mastercard;1/2;R$ 500,00;R$ 15,00;R$ 485,00;Previsto;S2
02/11/2026 11:00;02/01/2027;Crédito;Mastercard;2/2;R$ 500,00;R$ 15,00;R$ 485,00;Previsto;S2
02/11/2026 12:30;03/11/2026;Débito;Visa;1/1;R$ 100,00;R$ 1,00;R$ 99,00;Pago;S3
03/11/2026 09:00;04/11/2026;Débito;Elo;1/1;R$ 50,00;R$ 0,50;R$ 49,50;Cancelada;S4
05/11/2026 09:00;06/11/2026;Débito;Visa;1/1;R$ 80,00;R$ 0,80;R$ 79,20;Pago;S5
Total;;;;;R$ 1.430,00;;;;
`
// estilo Cielo: , + ponto decimal, data ISO, só líquido (taxa sai da diferença), latin1
const CIELO = `Data da venda,Data prevista de pagamento,Forma de pagamento,Bandeira,Valor da venda,Valor líquido,NSU
2026-11-02,2026-11-03,Crédito à vista,Visa,300.00,291.00,N1
2026-11-02,2026-11-03,Crédito à vista,Visa,100.00,97.00,N2
`

describe('lerValor / lerData', () => {
  it('formatos brasileiros e internacionais', () => {
    expect(lerValor('R$ 1.234,56')).toBe(1234.56)
    expect(lerValor('-12,30')).toBe(-12.3)
    expect(lerValor('(9,90)')).toBe(-9.9)
    expect(lerValor('1234.5')).toBe(1234.5)
    expect(lerValor('1.234.567')).toBe(1234567)
    expect(lerValor('abc')).toBeNull()
    expect(lerData('02/11/2026 10:15')).toBe('2026-11-02')
    expect(lerData('2/1/27')).toBe('2027-01-02')
    expect(lerData('2026-11-02T13:00:00')).toBe('2026-11-02')
    expect(lerData('ontem')).toBeNull()
  })
})

describe('lerAdquirente', () => {
  it('Stone: acha o cabeçalho abaixo do título, pula cancelada e a linha de total', () => {
    const r = lerAdquirente(utf8(STONE))
    expect(r.vendas).toHaveLength(5)
    expect(r.canceladas).toBe(1)
    expect(r.ignoradas).toBe(1)
    expect(r.colunas).toMatchObject({ dataVenda: 'Data da venda', bruto: 'Valor bruto', taxa: 'Taxa', liquido: 'Valor líquido', id: 'Stone ID' })
    expect(r.vendas[0]).toMatchObject({ dataVenda: '2026-11-02', dataPagamento: '2026-11-03', produto: 'debito', bandeira: 'Visa', bruto: 200, taxa: 2, liquido: 198 })
  })
  it('Cielo: vírgula como separador, só líquido (taxa = bruto − líquido), latin1', () => {
    const r = lerAdquirente(latin1(CIELO))
    expect(r.vendas).toHaveLength(2)
    expect(r.vendas[0]).toMatchObject({ produto: 'credito', bruto: 300, taxa: 9, liquido: 291, id: 'N1' })
  })
  it('arquivo sem as colunas mínimas → erro claro', () => {
    expect(() => lerAdquirente(utf8('nome;idade\nana;3\n'))).toThrow(AdquirenteInvalido)
  })
})

describe('montarMovimentos', () => {
  it('agrega por dia/produto/bandeira; só dias fechados; repasse na data do pagamento; saldo = agenda', () => {
    const { vendas } = lerAdquirente(utf8(STONE))
    const { movimentos, saldo, parciais } = montarMovimentos(vendas, '2026-11-05', '2026-11-01')
    expect(parciais).toBe(1)   // 05/11 = hoje: dia em andamento fica fora
    const por = Object.fromEntries(movimentos.map((m) => [m.chave, m.valor]))
    expect(por['venda|2026-11-02|debito|visa']).toBe('300.00')
    expect(por['taxa|2026-11-02|debito|visa']).toBe('-3.00')
    expect(por['venda|2026-11-02|credito|mastercard']).toBe('1000.00')
    expect(por['taxa|2026-11-02|credito|mastercard']).toBe('-30.00')
    expect(por['repasse|2026-11-03']).toBe('-297.00')          // só os débitos pagos em 03/11
    expect(Object.keys(por).some((k) => k.startsWith('repasse|2026-12'))).toBe(false)   // futuro = agenda, não movimento
    // saldo da conta no fim de 02/11 (último dia fechado com venda): o que foi vendido e cai depois
    expect(saldo).toEqual({ data: '2026-11-02', valor: '1267.00' })   // 297 (cai 03/11) + 485 + 485
    // a conta fecha: vendas − taxas − repasses = agenda
    const soma = movimentos.reduce((s, m) => s + Number(m.valor), 0)
    expect(Math.round(soma * 100) / 100).toBe(1267 - 297)   // no fim de 03/11 o repasse de 297 já saiu
  })
  it('antes da competência inicial não entra', () => {
    const { vendas } = lerAdquirente(utf8(STONE))
    expect(montarMovimentos(vendas, '2026-11-30', '2026-11-03').anteriores).toBe(4)
  })
})
