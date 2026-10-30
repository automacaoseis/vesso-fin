import type { Metadata } from 'next'
import PageHero from '@/components/PageHero'
import { api } from '@/lib/api'
import FilaClient, { type ItemFila } from './FilaClient'

export const metadata: Metadata = { title: 'Fila' }

// Home do analista (docs/PROMPT.md §7, Fase 1b): tudo que precisa de humano, de todas as orgs visíveis (v_fila).
export default async function Fila({ searchParams }: { searchParams: Promise<{ org?: string; grupo?: string }> }) {
  const [itens, sp] = await Promise.all([api.get<ItemFila[]>('/fila'), searchParams])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHero eyebrow="Fila de trabalho" titulo="Fila"
        descricao="Tudo que precisa de alguém, nas organizações que você atende, do mais urgente para o menos. Meses antes da competência inicial de cada org são histórico e não entram." />
      <FilaClient key={`${sp.org ?? ''}|${sp.grupo ?? ''}`} itens={itens} org={sp.org} grupo={sp.grupo} />
    </div>
  )
}
