import Link from 'next/link'
import PageHero from '@/components/PageHero'
import { EmptyState } from '@/components/ui'
import { TituloSecao } from '@/components/vesso'
import { api } from '@/lib/api'
import { theme } from '@/lib/theme'

interface Org { id_org: string; nome: string; tipo: 'cliente' | 'casa'; status: string; turma_fechamento: string | null; competencia_inicial: string | null }

const STATUS: Record<string, string> = { raio_x: 'Raio-X', onboarding: 'Implantação', ativa: 'Ativa', encerrada: 'Encerrada' }
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesCurto = (d: string | null) => (d ? `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}` : null)

export default async function Inicio() {
  const { eh_dono, orgs } = await api.get<{ eh_dono: boolean; orgs: Org[] }>('/orgs')
  const clientes = orgs.filter((o) => o.tipo === 'cliente')
  const casa = orgs.filter((o) => o.tipo === 'casa')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
      <PageHero eyebrow="Vesso Financeiro" titulo="Organizações"
        descricao={eh_dono ? 'Você é dono: vê os clientes do BPO e as empresas da casa.' : 'As organizações em que você tem acesso.'} />
      {orgs.length === 0 && <EmptyState>Nenhuma organização liberada para você. O acesso é por concessão: peça ao head do produto.</EmptyState>}
      {clientes.length > 0 && <Grupo titulo="Clientes" sub={`${clientes.length} no BPO`} giro={0} orgs={clientes} />}
      {casa.length > 0 && <Grupo titulo="Casa" sub="Empresas do grupo — só o dono vê" giro={90} orgs={casa} />}
    </div>
  )
}

function Grupo({ titulo, sub, giro, orgs }: { titulo: string; sub: string; giro: number; orgs: Org[] }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TituloSecao titulo={titulo} sub={sub} giro={giro} />
      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {orgs.map((o) => (
          <Link key={o.id_org} href={`/org/${o.id_org}`} className="f-cartao" style={{
            display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px', textDecoration: 'none', color: theme.text,
            background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radius, boxShadow: theme.shadow,
          }}>
            <div style={{ fontFamily: theme.display, fontSize: 21, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{o.nome}</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: theme.text3 }}>
              <span>{STATUS[o.status] ?? o.status}</span>
              {o.turma_fechamento && <span>Turma {o.turma_fechamento}</span>}
              {o.competencia_inicial && <span>Desde {mesCurto(o.competencia_inicial)}</span>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${theme.borderFaint}` }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.realce }}>Abrir</span>
              <span aria-hidden style={{ color: theme.realce }}>→</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
