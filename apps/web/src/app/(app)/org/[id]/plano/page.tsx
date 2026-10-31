import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { zId } from '@vesso-fin/shared'
import { api, ErroDaApi } from '@/lib/api'
import PlanoClient, { type ContaDoPlano } from './PlanoClient'

export const metadata: Metadata = { title: 'Plano de contas' }

// Plano de contas da org pela tela (0012). Regras no banco: natureza fixa; linha do DRE travada em conta com mês fechado.
export default async function Plano({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  let org: { id_org: string; nome: string; acoes: string[] }
  try { org = await api.get(`/orgs/${id}`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  const plano = await api.get<ContaDoPlano[]>(`/orgs/${id}/plano`)
  return <PlanoClient org={{ id: org.id_org, nome: org.nome, pode: org.acoes.includes('configurar_org') }} plano={plano} />
}
