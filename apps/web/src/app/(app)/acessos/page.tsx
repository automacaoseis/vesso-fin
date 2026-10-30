import type { Metadata } from 'next'
import PageHero from '@/components/PageHero'
import { api } from '@/lib/api'
import AcessosClient, { type DadosAcessos } from './AcessosClient'

export const metadata: Metadata = { title: 'Acessos' }

// docs/PROMPT.md §7 (Fase 1b): concessões — só dono e head. As regras moram no banco (0008: fn_conceder_acesso).
export default async function Acessos() {
  const dados = await api.get<DadosAcessos>('/acessos')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHero eyebrow="Equipe" titulo="Acessos"
        descricao="Quem vê e opera cada organização. Acesso é por concessão, com motivo, e toda mudança fica registrada. O dono concede qualquer papel; o head concede leitura, analista e revisor nas organizações que configura." />
      <AcessosClient dados={dados} />
    </div>
  )
}
