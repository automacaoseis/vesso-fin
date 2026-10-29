'use client'

// Relatórios (docs/PROMPT.md §7, tela 3): DRE por competência e DFC por caixa, mês a mês.
// Grade portada do seis-sistema (DreClient): coluna de rótulo e Total fixas, subtotais em destaque,
// linhas de % sobre a receita bruta, clique na célula = os lançamentos que compõem o número.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { demonstrativoCsv, fmtBRL, type ContaDemo, type LinhaDemo } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { estiloAba, estiloFiltro } from '@/components/vesso'
import { Aviso, botaoSecundarioCompacto, campoCompacto } from '@/components/fin-ui'
import Modal from '@/components/Modal'
import { detalhar, type LinhaFato } from './acoes'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
const ym = (m: string) => m.slice(0, 7)
const desloc = (m: string, n: number) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7) }
const valor = (v: number) => fmtBRL(v, 'demonstrativo', { zero: 'traco' })
const percentual = (v: number) => (Number.isFinite(v) ? `${v < 0 ? '\u2212' : ''}${Math.abs(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—')

interface Detalhe { titulo: string; sub: string; planos: string[]; de: string; ate: string }

export default function RelatoriosClient({ org, aba, meses, linhas, mesAtual }: {
  org: { id: string; nome: string }; aba: 'dre' | 'dfc'; meses: string[]; linhas: LinhaDemo[]; mesAtual: string
}) {
  const router = useRouter()
  const [abertas, setAbertas] = useState<Set<string>>(new Set())
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const fechar = useCallback(() => setDetalhe(null), [])
  const de = meses[0]!, ate = meses.at(-1)!
  const url = (p: Partial<{ aba: string; de: string; ate: string }>) => {
    const q = new URLSearchParams({ aba, de: ym(de), ate: ym(ate), ...p })
    return `/org/${org.id}/relatorios?${q}`
  }
  const receitaTotal = linhas.find((l) => l.chave === 'RECEITA_BRUTA')?.total ?? 0
  const presets: [string, string, string][] = [
    ['Este ano', `${mesAtual.slice(0, 4)}-01`, ym(mesAtual)],
    ['Últimos 12 meses', desloc(mesAtual, -11), ym(mesAtual)],
    ['Ano passado', `${+mesAtual.slice(0, 4) - 1}-01`, `${+mesAtual.slice(0, 4) - 1}-12`],
    ['Últimos 3 meses', desloc(mesAtual, -2), ym(mesAtual)],
  ]

  function exportar() {
    const csv = demonstrativoCsv(linhas, meses, rotuloMes)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `${aba.toUpperCase()} ${org.nome} ${ym(de)} a ${ym(ate)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const abrirDetalhe = (rotulo: string, contas: ContaDemo[], mes: string | null) => {
    if (!contas.length) return
    setDetalhe({
      titulo: rotulo, planos: contas.map((k) => k.id_plano_conta),
      sub: `${org.nome} · ${mes ? rotuloMes(mes) : `${rotuloMes(de)} a ${rotuloMes(ate)}`} · ${aba === 'dre' ? 'por competência' : 'por caixa'}`,
      de: mes ?? de, ate: mes ?? ate,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `1px solid ${theme.borderStrong}` }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent }}>Relatórios</div>
          <h1 className="v-manchete" style={{ fontFamily: theme.display, fontSize: 32, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '6px 0 0' }}>{org.nome}</h1>
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          {([['dre', 'DRE · competência'], ['dfc', 'DFC · caixa']] as const).map(([k, r]) => (
            <Link key={k} href={url({ aba: k })} style={{ ...estiloAba(aba === k), textDecoration: 'none' }}>{r}</Link>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {presets.map(([r, d, a]) => (
          <Link key={r} href={url({ de: d, ate: a })} style={{ ...estiloFiltro(ym(de) === d && ym(ate) === a), textDecoration: 'none' }}>{r}</Link>
        ))}
        <span style={{ fontSize: 11.5, color: theme.text3, marginLeft: 8 }}>de</span>
        <input type="month" aria-label="Mês inicial" value={ym(de)} onChange={(e) => e.target.value && router.push(url({ de: e.target.value }))} style={campoCompacto} />
        <span style={{ fontSize: 11.5, color: theme.text3 }}>até</span>
        <input type="month" aria-label="Mês final" value={ym(ate)} onChange={(e) => e.target.value && router.push(url({ ate: e.target.value }))} style={campoCompacto} />
        <button onClick={exportar} style={{ ...botaoSecundarioCompacto(), marginLeft: 'auto' }}>Exportar CSV</button>
      </div>

      <section aria-label={aba === 'dre' ? 'DRE' : 'DFC'} style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radius, boxShadow: theme.shadow, overflow: 'hidden' }}>
        <div className="v-scroll-x" style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto' }}>
          <table className="f-demo">
            <thead>
              <tr>
                <th className="f-demo-rotulo">{aba === 'dre' ? 'Demonstração do resultado' : 'Fluxo de caixa (método direto)'}</th>
                {meses.map((m) => <th key={m} className={m > mesAtual ? 'f-demo-futuro' : undefined}>{rotuloMes(m)}</th>)}
                <th className="f-demo-total">Total</th>
                {aba === 'dre' && <th>% receita</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                if (l.tipo === 'espaco') return <tr key={l.chave} className="f-demo-espaco"><td colSpan={meses.length + 3} /></tr>
                const temContas = !!l.contas?.length
                const aberta = abertas.has(l.chave)
                const fmt = l.tipo === 'percentual' ? percentual : valor
                const clicavel = l.tipo === 'dados' && temContas
                return [
                  <tr key={l.chave} className={[l.destaque && 'f-demo-destaque', l.tipo === 'percentual' && 'f-demo-pct', l.sub && 'f-demo-sub'].filter(Boolean).join(' ')}>
                    <td className="f-demo-rotulo">
                      {temContas
                        ? <button onClick={() => setAbertas((s) => { const n = new Set(s); if (n.has(l.chave)) n.delete(l.chave); else n.add(l.chave); return n })}
                            aria-expanded={aberta} className="f-demo-abrir">
                            <span aria-hidden className="f-demo-seta">{aberta ? '▾' : '▸'}</span>{l.rotulo}
                            <span className="f-demo-qtd">{l.contas!.length}</span>
                          </button>
                        : <span style={{ paddingLeft: l.tipo === 'dados' ? 18 : 0 }}>{l.rotulo}</span>}
                    </td>
                    {meses.map((m) => (
                      <td key={m} className={m > mesAtual ? 'f-demo-futuro' : undefined}>
                        {clicavel && l.valores[m] ? <button className="f-demo-valor" onClick={() => abrirDetalhe(l.rotulo, l.contas!, m)}>{fmt(l.valores[m]!)}</button> : fmt(l.valores[m] ?? 0)}
                      </td>
                    ))}
                    <td className="f-demo-total">
                      {clicavel && l.total ? <button className="f-demo-valor" onClick={() => abrirDetalhe(l.rotulo, l.contas!, null)}>{fmt(l.total)}</button> : fmt(l.total)}
                    </td>
                    {aba === 'dre' && <td className="f-demo-pctcol">{l.tipo === 'percentual' ? '' : percentual(receitaTotal ? l.total / receitaTotal : NaN)}</td>}
                  </tr>,
                  ...(aberta ? l.contas!.map((k) => (
                    <tr key={`${l.chave}:${k.id_plano_conta}`} className="f-demo-conta">
                      <td className="f-demo-rotulo"><span style={{ paddingLeft: 30 }}><span style={{ color: theme.text3, marginRight: 8 }}>{k.codigo}</span>{k.conta}</span></td>
                      {meses.map((m) => (
                        <td key={m} className={m > mesAtual ? 'f-demo-futuro' : undefined}>
                          {k.valores[m] ? <button className="f-demo-valor" onClick={() => abrirDetalhe(k.conta, [k], m)}>{valor(k.valores[m]!)}</button> : '—'}
                        </td>
                      ))}
                      <td className="f-demo-total">{k.total ? <button className="f-demo-valor" onClick={() => abrirDetalhe(k.conta, [k], null)}>{valor(k.total)}</button> : '—'}</td>
                      {aba === 'dre' && <td className="f-demo-pctcol">{percentual(receitaTotal ? k.total / receitaTotal : NaN)}</td>}
                    </tr>
                  )) : []),
                ]
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div style={{ fontSize: 11.5, color: theme.text3 }}>
        {aba === 'dre'
          ? 'Por competência: cada título no mês a que pertence, pago ou não. Clique num valor para ver os lançamentos.'
          : 'Por caixa: o que entrou e saiu de fato, pela data do extrato. Transferências entre contas próprias não entram.'}
      </div>

      {detalhe && <ModalDetalhe idOrg={org.id} regime={aba === 'dre' ? 'competencia' : 'caixa'} d={detalhe} onFechar={fechar} onErro={setAviso} />}
      {aviso && <Aviso tipo="erro">{aviso}</Aviso>}
    </div>
  )
}

function ModalDetalhe({ idOrg, regime, d, onFechar, onErro }: { idOrg: string; regime: 'competencia' | 'caixa'; d: Detalhe; onFechar: () => void; onErro: (m: string) => void }) {
  const [linhas, setLinhas] = useState<LinhaFato[] | null>(null)
  useEffect(() => {
    let vivo = true
    detalhar(idOrg, regime, d.de, d.ate, d.planos).then((r) => {
      if (!vivo) return
      if (r.ok) setLinhas(r.dados); else { onErro(r.mensagem); onFechar() }
    })
    return () => { vivo = false }
  }, [idOrg, regime, d, onErro, onFechar])
  const total = linhas?.reduce((s, l) => Math.round((s + l.valor) * 100) / 100, 0) ?? 0
  return (
    <Modal titulo={d.titulo} sub={d.sub} onFechar={onFechar} largura={820}>
      {!linhas ? <div style={{ padding: 20, fontSize: 12.5, color: theme.text3 }}>Carregando…</div>
        : linhas.length === 0 ? <div style={{ padding: 20, fontSize: 12.5, color: theme.text3 }}>Nenhum lançamento.</div>
        : (
          <table className="f-tabela">
            <thead><tr><th style={{ width: 80 }}>{regime === 'competencia' ? 'Vencimento' : 'Data'}</th><th>Descrição</th><th style={{ width: 180 }}>Conta</th><th className="f-num">R$</th></tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={`${l.id_titulo}:${l.id_movimento ?? ''}:${i}`}>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{l.data_ref.split('-').reverse().join('/')}</td>
                  <td style={{ maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.descricao_extrato ?? l.descricao}>
                    {l.descricao}{l.contraparte && <span style={{ color: theme.text3 }}> · {l.contraparte}</span>}
                    {l.origem === 'legado' && <span style={{ color: theme.text3 }}> · histórico</span>}
                  </td>
                  <td style={{ maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: theme.text2 }}>{l.codigo} {l.conta}</td>
                  <td className="f-num">{fmtBRL(l.valor, 'demonstrativo')}</td>
                </tr>
              ))}
              <tr><td colSpan={3} style={{ fontWeight: 700 }}>Total · {linhas.length} lançamento{linhas.length === 1 ? '' : 's'}{linhas.length === 1000 ? ' (limite de 1.000)' : ''}</td><td className="f-num" style={{ fontWeight: 700 }}>{fmtBRL(total, 'demonstrativo')}</td></tr>
            </tbody>
          </table>
        )}
    </Modal>
  )
}
