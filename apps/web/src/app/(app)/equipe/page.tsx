import type { Metadata } from 'next'
import PageHero from '@/components/PageHero'
import { api } from '@/lib/api'
import { ehMes, mesAtualSP } from '@/lib/datas'
import { quemEstaLogado } from '@/lib/sessao'
import EquipeClient, { type DadosEquipe } from './EquipeClient'

export const metadata: Metadata = { title: 'Equipe' }

// docs/PROMPT.md §7 (Fase 1b): /equipe a partir da v_tempo_org — horas por organização, etapa e pessoa (base de preço).
export default async function Equipe({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes: q } = await searchParams
  const mes = ehMes(q) ? q : mesAtualSP()
  const [dados, orgs, eu] = await Promise.all([
    api.get<DadosEquipe>(`/equipe?de=${mes}-01&ate=${mes}-01`),
    api.get<{ orgs: { id_org: string; nome: string; status: string }[] }>('/orgs'),
    quemEstaLogado(),
  ])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHero eyebrow="Equipe" titulo="Tempo da equipe"
        descricao="Horas por organização, etapa e pessoa — é o número que diz quanto custa atender cada cliente. A Conciliação cronometra sozinha; as outras etapas, pelo cronômetro abaixo." />
      <EquipeClient key={mes} mes={mes} dados={dados} orgs={orgs.orgs.filter((o) => o.status !== 'encerrada')} eu={eu?.sub ?? null} />
    </div>
  )
}
