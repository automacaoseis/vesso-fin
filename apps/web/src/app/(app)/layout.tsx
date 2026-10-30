import { redirect } from 'next/navigation'
import Shell, { type OrgResumo } from '@/components/Shell'
import { api } from '@/lib/api'
import { quemEstaLogado } from '@/lib/sessao'
import { lerTema } from '@/lib/tema-servidor'
import { lerDensidade } from '@/lib/densidade-servidor'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const quem = await quemEstaLogado()
  if (!quem) redirect('/login')
  const [{ orgs, eh_dono }, tema, densidade] = await Promise.all([api.get<{ eh_dono: boolean; orgs: OrgResumo[] }>('/orgs'), lerTema(), lerDensidade()])
  return <Shell orgs={orgs} ehDono={eh_dono} email={quem.email} tema={tema} densidade={densidade}>{children}</Shell>
}
