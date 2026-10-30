import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { zId } from '@vesso-fin/shared'
import type { ContaPlano } from '@/components/SeletorPlano'
import { api, ErroDaApi } from '@/lib/api'
import { mesAtualSP } from '@/lib/datas'
import type { Entidade } from '../lancamentos/tipos'
import VencimentosClient, { type Aberto } from './VencimentosClient'

export const metadata: Metadata = { title: 'A pagar e a receber' }

// A pagar / A receber (docs/PROMPT.md §7, Fase 1b): títulos em aberto por faixa de vencimento (v_titulos_abertos).
// Lançar novo (com parcelamento via fn_criar_titulo) e a gaveta do título são as mesmas peças de Lançamentos.
export default async function Vencimentos({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; faixa?: string }>
}) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  const sp = await searchParams
  let org: { id_org: string; nome: string; acoes: string[] }
  try { org = await api.get(`/orgs/${id}`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  const tipo = sp.tipo === 'receber' ? 'receber' : 'pagar'
  const [pagar, receber, plano, entidades] = await Promise.all([
    api.get<Aberto[]>(`/orgs/${id}/titulos-abertos?tipo=pagar&limite=500`),
    api.get<Aberto[]>(`/orgs/${id}/titulos-abertos?tipo=receber&limite=500`),
    api.get<ContaPlano[]>(`/orgs/${id}/plano-contas`),
    api.get<Entidade[]>(`/orgs/${id}/entidades`),
  ])
  return <VencimentosClient key={tipo} org={{ id: org.id_org, nome: org.nome, acoes: org.acoes }} tipo={tipo} faixaInicial={sp.faixa}
    abertos={{ pagar, receber }} plano={plano} entidades={entidades} mesAtual={`${mesAtualSP()}-01`} />
}
