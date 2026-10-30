import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { zId } from '@vesso-fin/shared'
import { api, ErroDaApi } from '@/lib/api'
import { ehMes } from '@/lib/datas'
import DocumentosClient, { type Documento } from './DocumentosClient'

export const metadata: Metadata = { title: 'Documentos' }

// docs/PROMPT.md §7 (Fase 1b): pendências e documentos da org — pedir ao cliente, receber o arquivo, validar ou recusar.
export default async function Documentos({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; competencia?: string }>
}) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  const sp = await searchParams
  let org: { id_org: string; nome: string; acoes: string[] }
  try { org = await api.get(`/orgs/${id}`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  const docs = await api.get<Documento[]>(`/orgs/${id}/documentos`)
  const status = ['pedido', 'recebido', 'validado'].includes(sp.status ?? '') ? sp.status : undefined
  return <DocumentosClient org={{ id: org.id_org, nome: org.nome, acoes: org.acoes }} docs={docs}
    statusInicial={status} competenciaInicial={ehMes(sp.competencia) ? sp.competencia : undefined} />
}
