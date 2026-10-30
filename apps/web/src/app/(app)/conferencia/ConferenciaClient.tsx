'use client'

import { useMemo, useState } from 'react'
import { fmtBRL } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { estiloAba, estiloFiltro } from '@/components/vesso'
import { Painel } from '@/components/fin-ui'
import { mesCurto } from '@/lib/datas'

export interface LinhaConf {
  id_org: string; organizacao: string; competencia: string
  dre_financeiro_seis: string | number | null; dre_vesso_fin: string | number | null; diferenca: string | number
  explicado_caso_e: string | number; explicado_caso_i: string | number; nao_explicado: string | number
}
const n = (v: string | number | null) => (v == null ? null : Number(v))
const brl = (v: number | null) => (v == null ? '—' : fmtBRL(v, 'demonstrativo', { zero: 'traco' }))
const zero = (v: string | number) => Math.abs(Number(v)) < 0.005

export default function ConferenciaClient({ linhas, inicio }: { linhas: LinhaConf[]; inicio: Record<string, string | null> }) {
  const orgs = useMemo(() => [...new Map(linhas.map((l) => [l.id_org, l.organizacao])).entries()], [linhas])
  const [org, setOrg] = useState(orgs[0]![0])
  const [soDif, setSoDif] = useState(true)
  const ini = inicio[org] ?? '9999-12-01'
  const daOrg = linhas.filter((l) => l.id_org === org)
  const historico = daOrg.filter((l) => l.competencia < ini)
  const paralelo = daOrg.filter((l) => l.competencia >= ini)
  const resumo = (l: LinhaConf[]) => ({
    meses: l.length, comDif: l.filter((x) => !zero(x.nao_explicado)).length,
    naoExplicado: l.reduce((s, x) => s + Number(x.nao_explicado), 0),
    e: l.reduce((s, x) => s + Number(x.explicado_caso_e), 0), i: l.reduce((s, x) => s + Number(x.explicado_caso_i), 0),
  })
  const rh = resumo(historico), rp = resumo(paralelo)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <nav aria-label="Empresa" style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${theme.border}` }}>
        {orgs.map(([id, nome]) => {
          const dif = linhas.filter((l) => l.id_org === id && l.competencia < (inicio[id] ?? '9999') && !zero(l.nao_explicado)).length
          return <button key={id} onClick={() => setOrg(id)} style={{ ...estiloAba(id === org), fontSize: 14 }}>{nome}{dif > 0 && <span style={{ color: theme.negative }}> ▲ {dif}</span>}</button>
        })}
      </nav>

      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Resumo titulo={`Histórico importado · até ${ini === '9999-12-01' ? '—' : mesCurto(new Date(Date.UTC(+ini.slice(0, 4), +ini.slice(5, 7) - 2, 1)).toISOString())}`}
          r={rh} ok="Bate com o sistema antigo em todos os meses (o que difere está explicado)."
          ruim="Meses com diferença não explicada: o sistema antigo mudou depois da importação, ou é defeito." />
        <Resumo titulo={`Em paralelo · desde ${ini === '9999-12-01' ? '—' : mesCurto(ini)}`} r={rp}
          ok="Os dois sistemas estão iguais."
          ruim="Esperado enquanto o financeiro_seis continuar recebendo lançamentos: aqui o Vesso FIN é a fonte, e o antigo deixa de valer." paralelo />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => setSoDif(true)} style={estiloFiltro(soDif)}>Só meses com diferença</button>
        <button onClick={() => setSoDif(false)} style={estiloFiltro(!soDif)}>Todos os meses · {daOrg.length}</button>
      </div>

      {([['Histórico importado', historico, false], ['Em paralelo (a partir da competência inicial)', paralelo, true]] as const).map(([titulo, l, par]) => {
        const vis = soDif ? l.filter((x) => !zero(x.nao_explicado) || !zero(x.diferenca)) : l
        if (l.length === 0) return null
        return (
          <Painel key={titulo} aria-label={titulo} rotulo={`${titulo} · ${vis.length} de ${l.length} meses`}>
            {vis.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: theme.text3 }}>✓ Nenhuma diferença.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="f-tabela">
                  <thead><tr><th>Mês</th><th className="f-num">financeiro_seis</th><th className="f-num">Vesso FIN</th><th className="f-num">Diferença</th><th className="f-num">Caso E</th><th className="f-num">Caso I</th><th className="f-num">Não explicado</th><th /></tr></thead>
                  <tbody>
                    {vis.map((x) => {
                      const ruim = !zero(x.nao_explicado)
                      return (
                        <tr key={x.competencia} className={ruim && !par ? 'f-st-divergente' : undefined}>
                          <td>{mesCurto(x.competencia)}</td>
                          <td className="f-num">{brl(n(x.dre_financeiro_seis))}</td>
                          <td className="f-num">{brl(n(x.dre_vesso_fin))}</td>
                          <td className="f-num">{brl(n(x.diferenca))}</td>
                          <td className="f-num">{brl(n(x.explicado_caso_e))}</td>
                          <td className="f-num">{brl(n(x.explicado_caso_i))}</td>
                          <td className="f-num" style={{ fontWeight: 600 }}>{brl(n(x.nao_explicado))}</td>
                          <td>{ruim ? <span style={{ color: par ? theme.text3 : theme.negative }}>{par ? '○ paralelo' : '▲ verificar'}</span> : <span style={{ color: theme.positive }}>✓</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Painel>
        )
      })}

      <div style={{ fontSize: 11.5, color: theme.text3, lineHeight: 1.6, maxWidth: 820 }}>
        <strong>Caso E</strong> — linha do Asaas em categoria que o financeiro_seis tira do DRE, sem lançamento manual correspondente: o pagamento existiu, então o Vesso FIN conta.
        {' '}<strong>Caso I</strong> — categoria &quot;Preencher manualmente&quot; nunca corrigida: lá fica sem competência; aqui entra no mês da transação.
        {' '}Valores no sentido do resultado (receita +, despesa −). Diferença = Vesso FIN − financeiro_seis.
      </div>
    </div>
  )
}

function Resumo({ titulo, r, ok, ruim, paralelo }: { titulo: string; r: { meses: number; comDif: number; naoExplicado: number; e: number; i: number }; ok: string; ruim: string; paralelo?: boolean }) {
  const bom = r.comDif === 0
  return (
    <div style={{ padding: '14px 16px', border: `1px solid ${theme.border}`, borderRadius: theme.radius, background: theme.surface, borderLeft: `3px solid ${bom ? theme.positive : paralelo ? theme.warning : theme.negative}` }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>{titulo}</div>
      {r.meses === 0 ? <div style={{ fontSize: 12.5, color: theme.text3, marginTop: 6 }}>Nenhum mês.</div> : <>
        <div style={{ fontFamily: theme.display, fontSize: 24, marginTop: 4 }}>
          {bom ? <span style={{ color: theme.positive }}>✓ {r.meses} meses</span> : <span style={{ color: paralelo ? theme.text : theme.negative }}>{r.comDif} de {r.meses} meses</span>}
        </div>
        <div style={{ fontSize: 12, color: theme.text2, marginTop: 4 }}>{bom ? ok : ruim}</div>
        <div style={{ fontSize: 11.5, color: theme.text3, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
          explicado: caso E {fmtBRL(r.e)} · caso I {fmtBRL(r.i)}{!bom && <> · não explicado {fmtBRL(r.naoExplicado)}</>}
        </div>
      </>}
    </div>
  )
}
