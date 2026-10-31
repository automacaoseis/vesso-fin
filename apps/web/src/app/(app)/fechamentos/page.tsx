import type { Metadata } from 'next'
import Link from 'next/link'
import PageHero from '@/components/PageHero'
import { EmptyState } from '@/components/ui'
import { Painel } from '@/components/fin-ui'
import { api } from '@/lib/api'
import { deslocarMes, ehMes, hojeDataSP, mesAnteriorSP, mesCurto } from '@/lib/datas'
import { quemEstaLogado } from '@/lib/sessao'
import { theme } from '@/lib/theme'

export const metadata: Metadata = { title: 'Fechamentos' }

interface LinhaFech {
  id_org: string; nome: string; tipo: 'cliente' | 'casa'; status_org: string; competencia_inicial: string | null
  turma_fechamento: string | null; dia_util_limite: number | null
  status: 'aberto' | 'em_revisao' | 'fechado' | 'liberado'; executor: string | null; enviado_revisao_em: string | null
  revisor: string | null; revisado_em: string | null; liberado_em: string | null; reaberturas: number
  itens: number; itens_ok: number; bloqueios: number
  prazo: string | null   // N-ésimo dia útil do mês seguinte, sem fim de semana nem feriado (bpo_fin.fn_prazo_fechamento, 0012)
}

const STATUS = {
  aberto: { icone: '○', rotulo: 'Aberto', cor: theme.text2 },
  em_revisao: { icone: '◐', rotulo: 'Em revisão', cor: theme.warning },
  fechado: { icone: '✓', rotulo: 'Fechado', cor: theme.positive },
  liberado: { icone: '✓', rotulo: 'Liberado', cor: theme.positive },
} as const

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

// docs/PROMPT.md §7 (Fase 1b): todas as orgs no mês, por turma. O detalhe e as ações ficam em /org/[id]/fechamento.
export default async function Fechamentos({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes: q } = await searchParams
  const mes = ehMes(q) ? q : mesAnteriorSP()
  const comp = `${mes}-01`
  const [linhas, quem] = await Promise.all([api.get<LinhaFech[]>(`/fechamentos?competencia=${comp}`), quemEstaLogado()])
  const hoje = hojeDataSP()
  const quemFoi = (u: string | null) => (!u ? null : u === quem?.sub ? 'você' : 'outra pessoa')

  const comPrazo = linhas.map((l) => {
    const historico = !!l.competencia_inicial && comp < l.competencia_inicial
    const limite = !historico ? l.prazo?.slice(0, 10) ?? null : null
    const atrasado = !!limite && limite < hoje && (l.status === 'aberto' || l.status === 'em_revisao')
    return { ...l, historico, limite, atrasado }
  })
  // atrasados primeiro, depois por prazo, histórico por último
  comPrazo.sort((a, b) => Number(b.atrasado) - Number(a.atrasado) || Number(a.historico) - Number(b.historico)
    || (a.limite ?? '9999').localeCompare(b.limite ?? '9999') || a.nome.localeCompare(b.nome))
  const n = (s: LinhaFech['status']) => linhas.filter((l) => l.status === s).length
  const atrasados = comPrazo.filter((l) => l.atrasado).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHero eyebrow="Fechamento do mês" titulo="Fechamentos"
        descricao="Todas as organizações na competência escolhida: status, checklist e prazo da turma. Para enviar, revisar ou liberar, abra a organização."
        right={
          <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm }}>
            <Link href={`?mes=${deslocarMes(mes, -1)}`} aria-label="Mês anterior" style={{ padding: '6px 12px', color: theme.text2, textDecoration: 'none' }}>‹</Link>
            <span style={{ minWidth: 76, textAlign: 'center', fontSize: 12.5, fontWeight: 700 }}>{mesCurto(mes)}</span>
            <Link href={`?mes=${deslocarMes(mes, 1)}`} aria-label="Próximo mês" style={{ padding: '6px 12px', color: theme.text2, textDecoration: 'none' }}>›</Link>
          </div>
        } />

      {linhas.length === 0 ? <EmptyState>Nenhuma organização ativa que você veja.</EmptyState> : (
        <>
          <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', border: `1px solid ${theme.border}`, borderRadius: theme.radius, background: theme.surface }}>
            {([['Abertos', n('aberto'), theme.text], ['Em revisão', n('em_revisao'), theme.text], ['Fechados', n('fechado'), theme.text], ['Liberados', n('liberado'), theme.text], ['Atrasados', atrasados, atrasados ? theme.negative : theme.text]] as const).map(([r, v, cor], i) => (
              <div key={r} style={{ padding: '14px 16px', borderLeft: i ? `1px solid ${theme.borderFaint}` : undefined }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>{r}</div>
                <div style={{ fontFamily: theme.display, fontSize: 26, marginTop: 4, color: cor, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              </div>
            ))}
          </div>

          <Painel aria-label="Organizações" rotulo={`${linhas.length} organizaç${linhas.length === 1 ? 'ão' : 'ões'} · ${mesCurto(mes)}`}>
            <div style={{ overflowX: 'auto' }}>
              <table className="f-tabela">
                <thead><tr><th>Organização</th><th>Turma</th><th>Prazo</th><th>Status</th><th>Checklist</th><th>Andamento</th><th /></tr></thead>
                <tbody>
                  {comPrazo.map((l) => {
                    const st = STATUS[l.status]
                    const andamento = l.status === 'liberado' ? `liberado ${dataHora(l.liberado_em)}`
                      : l.status === 'fechado' ? `revisado por ${quemFoi(l.revisor)} · ${dataHora(l.revisado_em)}`
                      : l.status === 'em_revisao' ? `enviado por ${quemFoi(l.executor)} · ${dataHora(l.enviado_revisao_em)}`
                      : l.reaberturas ? `reaberto ${l.reaberturas}×` : ''
                    return (
                      <tr key={l.id_org} className={l.atrasado ? 'f-st-divergente' : undefined} style={{ opacity: l.historico ? 0.6 : 1 }}>
                        <td>
                          <Link href={`/org/${l.id_org}/fechamento?mes=${mes}`} style={{ color: theme.text, fontWeight: 600, textDecoration: 'none' }}>{l.nome}</Link>
                          {l.tipo === 'casa' && <span style={{ marginLeft: 8, fontSize: 10.5, color: theme.text3 }}>casa</span>}
                        </td>
                        <td>{l.turma_fechamento ?? <span style={{ color: theme.text3 }}>sem turma</span>}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {l.historico ? <span style={{ color: theme.text3 }}>histórico</span>
                            : l.limite ? <>{br(l.limite)}{l.atrasado && <span style={{ marginLeft: 6 }}>▲ atrasado</span>}</> : <span style={{ color: theme.text3 }}>—</span>}
                        </td>
                        <td><span style={{ color: st.cor }}>{st.icone}</span> {st.rotulo}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {l.status === 'fechado' || l.status === 'liberado' ? <span style={{ color: theme.text3 }}>congelado</span>
                            : <>{l.itens_ok}/{l.itens} ok{l.bloqueios > 0 && <span style={{ color: theme.negative, marginLeft: 6 }}>▲ {l.bloqueios} bloqueia{l.bloqueios > 1 ? 'm' : ''}</span>}</>}
                        </td>
                        <td style={{ color: theme.text3 }}>{andamento}</td>
                        <td style={{ textAlign: 'right' }}><Link href={`/org/${l.id_org}/fechamento?mes=${mes}`} style={{ fontSize: 12, color: theme.accent }}>Abrir →</Link></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Painel>
          <div style={{ fontSize: 11.5, color: theme.text3 }}>Prazo = dia útil limite da turma (A: 6º, B: 10º, C: 14º) no mês seguinte, contando dia útil: sem fim de semana nem feriado nacional/bancário (Carnaval, Sexta-feira Santa e Corpus Christi inclusos). Feriado municipal ainda não entra.</div>
        </>
      )}
    </div>
  )
}
