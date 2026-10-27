import type { Metadata } from 'next'
import PageHero from '@/components/PageHero'
import { EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import ConexoesClient, { type Conexao } from './ConexoesClient'

export const metadata: Metadata = { title: 'Conexões' }

export default async function Conexoes() {
  const conexoes = await api.get<Conexao[]>('/conexoes')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHero eyebrow="Ingestão" titulo="Conexões" descricao="De onde vem o extrato de cada conta. OFX entra por upload; o processamento roda em segundo plano." />
      {conexoes.length === 0 ? <EmptyState>Nenhuma conexão nas organizações que você vê.</EmptyState> : <ConexoesClient conexoes={conexoes} />}
    </div>
  )
}
