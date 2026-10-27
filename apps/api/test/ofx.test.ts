import { describe, expect, it } from 'vitest'
import { lerOfx, OfxInvalido, valorOfx } from '../src/worker/ofx'

const latin1 = (s: string) => Uint8Array.from([...s].map((ch) => ch.charCodeAt(0)))
export const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0260<ACCTID>99881234</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001000000[-3:BRT]<DTEND>20261031000000[-3:BRT]
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005000000[-3:BRT]<TRNAMT>-1.234,56<FITID>A1<MEMO>Pagamento de boleto &amp; tarifa</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261006<TRNAMT>500.00<FITID>A2<NAME>JOÃO DA SILVA<MEMO>Transferência recebida</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-9,90<FITID>A3<MEMO>Tarifa</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-9,90<FITID>A3<MEMO>Tarifa</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>10.000,00<DTASOF>20261031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

describe('lerOfx', () => {
  it('SGML em Windows-1252, vírgula decimal, entidades, FITID repetido', () => {
    const o = lerOfx(latin1(SGML))
    expect(o.codificacao).toBe('windows-1252')
    expect(o.conta).toBe('99881234')
    expect(o.periodo).toEqual({ inicio: '2026-10-01', fim: '2026-10-31' })
    expect(o.saldo).toEqual({ valor: '10000.00', data: '2026-10-31' })
    expect(o.transacoes.map((t) => [t.data, t.valor, t.descricao, t.contraparte, t.fitid])).toEqual([
      ['2026-10-05', '-1234.56', 'Pagamento de boleto & tarifa', null, 'A1'],
      ['2026-10-06', '500.00', 'Transferência recebida', 'JOÃO DA SILVA', 'A2'],
      ['2026-10-06', '-9.90', 'Tarifa', null, 'A3'],
      ['2026-10-06', '-9.90', 'Tarifa', null, 'A3'],
    ])
  })
  it('XML (OFX 2) em UTF-8', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="220"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>1234</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101</DTSTART><DTEND>20261130</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261102120000</DTPOSTED><TRNAMT>-77.10</TRNAMT><FITID>X9</FITID><MEMO>Açaí</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
    const o = lerOfx(new TextEncoder().encode(xml))
    expect(o.codificacao).toBe('utf-8')
    expect(o.transacoes).toHaveLength(1)
    expect(o.transacoes[0]).toMatchObject({ data: '2026-11-02', valor: '-77.10', descricao: 'Açaí', fitid: 'X9' })
    expect(o.saldo).toBeNull()
  })
  it('Latin-1 sem declarar cai para Windows-1252', () => {
    const o = lerOfx(latin1('<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20261001<TRNAMT>-1<MEMO>Pão</STMTTRN></BANKTRANLIST></OFX>'))
    expect(o.transacoes[0]!.descricao).toBe('Pão')
  })
  it('recusa o que não é OFX ou tem campo inválido', () => {
    expect(() => lerOfx(latin1('data,valor\n2026-10-01,-5'))).toThrow(OfxInvalido)
    expect(() => lerOfx(latin1('<OFX><STMTTRN><DTPOSTED>20261340<TRNAMT>-1</STMTTRN></OFX>'))).toThrow(/DTPOSTED/)
    expect(() => lerOfx(latin1('<OFX><STMTTRN><DTPOSTED>20261001<TRNAMT>abc</STMTTRN></OFX>'))).toThrow(/TRNAMT/)
  })
  it('valorOfx', () => {
    expect(valorOfx('-1.234,56')).toBe('-1234.56')
    expect(valorOfx('+50')).toBe('50')
    expect(valorOfx('1234.5')).toBe('1234.5')
    expect(valorOfx('12a')).toBeNull()
  })
})
