import Link from 'next/link'
import PageHero from '@/components/PageHero'
import { Card, CardGrid, EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'

interface Org { id_org: string; nome: string; tipo: 'cliente' | 'casa'; status: string; turma_fechamento: string | null; competencia_inicial: string | null }

export default async function Inicio() {
  const { eh_dono, orgs } = await api.get<{ eh_dono: boolean; orgs: Org[] }>('/orgs')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHero eyebrow="Vesso FIN" titulo="Organizações" descricao={eh_dono ? 'Você é dono: vê todas, inclusive as da casa.' : undefined} />
      {orgs.length === 0
        ? <EmptyState>Nenhuma organização liberada para você. O acesso é por concessão: peça ao head do produto.</EmptyState>
        : (
          <CardGrid>
            {orgs.map((o) => (
              <Link key={o.id_org} href={`/org/${o.id_org}/conciliacao`} style={{ textDecoration: 'none' }}>
                <Card pad={16}>
                  <div style={{ fontFamily: theme.display, fontSize: 19, color: theme.text }}>{o.nome}</div>
                  <div style={{ fontSize: 12, color: f.mutedText, marginTop: 6 }}>
                    {o.tipo === 'casa' ? 'Casa' : 'Cliente'} · {o.status}{o.turma_fechamento ? ` · turma ${o.turma_fechamento}` : ''}
                  </div>
                </Card>
              </Link>
            ))}
          </CardGrid>
        )}
    </div>
  )
}
