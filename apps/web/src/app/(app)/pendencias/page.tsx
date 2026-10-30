import type { Metadata } from 'next'
import PageHero from '@/components/PageHero'
import { EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import type { Documento } from '../org/[id]/documentos/DocumentosClient'
import PendenciasClient from './PendenciasClient'

export const metadata: Metadata = { title: 'Pendências' }

// docs/PROMPT.md §7 (Fase 1b): /pendencias — o que foi pedido aos clientes e ainda não chegou, e o que chegou e falta validar.
export default async function Pendencias() {
  const docs = await api.get<(Documento & { organizacao: string })[]>('/pendencias')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHero eyebrow="Documentos" titulo="Pendências"
        descricao="O que foi pedido aos clientes e ainda não chegou, e o que chegou e falta validar — de todas as organizações que você atende. Pedido sem arquivo bloqueia o fechamento do mês." />
      {docs.length === 0 ? <EmptyState>Nenhuma pendência: nada pedido em aberto nem arquivo esperando validação.</EmptyState> : <PendenciasClient docs={docs} />}
    </div>
  )
}
