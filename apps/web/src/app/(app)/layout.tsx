import { redirect } from 'next/navigation'
import Shell, { type OrgResumo } from '@/components/Shell'
import { api } from '@/lib/api'
import { quemEstaLogado } from '@/lib/sessao'
import { lerTema } from '@/lib/tema-servidor'
import { lerDensidade } from '@/lib/densidade-servidor'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const quem = await quemEstaLogado()
  if (!quem) redirect('/login')
  const [{ orgs }, tema, densidade] = await Promise.all([api.get<{ orgs: OrgResumo[] }>('/orgs'), lerTema(), lerDensidade()])
  return <Shell orgs={orgs} email={quem.email} tema={tema} densidade={densidade}>{children}</Shell>
}
