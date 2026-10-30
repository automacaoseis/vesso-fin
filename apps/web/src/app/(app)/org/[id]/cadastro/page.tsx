import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { zId } from '@vesso-fin/shared'
import { api, ErroDaApi } from '@/lib/api'
import CadastroClient, { type DadosCadastro } from './CadastroClient'

export const metadata: Metadata = { title: 'Cadastro' }

// Cadastro da organização (0011): dados, ligação com o portal, entidades, contas e conexões.
export default async function Cadastro({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  let d: DadosCadastro
  try { d = await api.get<DadosCadastro>(`/orgs/${id}/cadastro`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  const { turmas } = await api.get<{ turmas: { codigo: string; nome: string }[] }>('/cadastro/opcoes')
  return <CadastroClient d={d} turmas={turmas} />
}
