import type { Metadata } from 'next'
import PageHero from '@/components/PageHero'
import { EmptyState } from '@/components/ui'
import { api, ErroDaApi } from '@/lib/api'
import ConferenciaClient, { type LinhaConf } from './ConferenciaClient'

export const metadata: Metadata = { title: 'Conferência' }

// docs/PROMPT.md §7 (tela 7, só o dono): DRE do financeiro_seis × DRE do Vesso FIN, por empresa da casa e mês (v_conferencia_dre_seis).
export default async function Conferencia() {
  let linhas: LinhaConf[]
  try { linhas = await api.get<LinhaConf[]>('/conferencia-seis') } catch (e) {
    if (e instanceof ErroDaApi && e.status === 403) return <EmptyState>A conferência com o financeiro da Seis é só do dono.</EmptyState>
    throw e
  }
  const { orgs } = await api.get<{ orgs: { id_org: string; competencia_inicial: string | null }[] }>('/orgs')
  const inicio = Object.fromEntries(orgs.map((o) => [o.id_org, o.competencia_inicial]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHero eyebrow="Só o dono" titulo="Conferência"
        descricao="O DRE do sistema antigo (financeiro_seis) contra o DRE do Vesso FIN, mês a mês, para cada empresa da casa. Diferença só é aceita quando explicada pelos casos da importação; o que sobra é defeito ou lançamento novo no sistema antigo." />
      {linhas.length === 0 ? <EmptyState>Nada para conferir: a importação do histórico ainda não rodou.</EmptyState> : <ConferenciaClient linhas={linhas} inicio={inicio} />}
    </div>
  )
}
