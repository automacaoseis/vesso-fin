import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { zId } from '@vesso-fin/shared'
import { api, ErroDaApi } from '@/lib/api'
import ResumoClient, { type DadosResumo } from './ResumoClient'

export const metadata: Metadata = { title: 'Resumo' }

export default async function Resumo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  let org: { id_org: string; nome: string; tipo: string; competencia_inicial: string | null }
  try { org = await api.get(`/orgs/${id}`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  const dados = await api.get<DadosResumo>(`/orgs/${id}/resumo`)
  return <ResumoClient org={{ id: org.id_org, nome: org.nome, tipo: org.tipo, competenciaInicial: org.competencia_inicial }} dados={dados} />
}
