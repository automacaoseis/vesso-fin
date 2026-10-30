import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ESTADOS_MOVIMENTO, zId, type EstadoMovimento } from '@vesso-fin/shared'
import { EmptyState } from '@/components/ui'
import { api, comQuery, ErroDaApi } from '@/lib/api'
import ConciliacaoClient from './ConciliacaoClient'
import Cronometro from './Cronometro'
import type { Conta, Filtros, PaginaMovimentos, PlanoConta, Titulo } from './tipos'

export const metadata: Metadata = { title: 'Conciliação' }

interface Org { id_org: string; nome: string; tipo: string; acoes: string[] }

function mesAtual(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date())
}
function limitesMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number) as [number, number]
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { de: `${mes}-01`, ate: `${mes}-${String(ult).padStart(2, '0')}` }
}

export default async function Conciliacao({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ conta?: string; mes?: string; status?: string; mov?: string }>
}) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  const sp = await searchParams

  let org: Org
  try { org = await api.get<Org>(`/orgs/${id}`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  const [contas, plano] = await Promise.all([
    api.get<Conta[]>(`/orgs/${id}/contas`), api.get<PlanoConta[]>(`/orgs/${id}/plano-contas`),
  ])
  if (contas.length === 0) return <EmptyState>{org.nome} ainda não tem conta cadastrada.</EmptyState>

  const conta = contas.find((c) => c.id_conta === sp.conta)?.id_conta ?? contas[0]!.id_conta
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? '') ? sp.mes! : mesAtual()
  const status = (ESTADOS_MOVIMENTO as readonly string[]).includes(sp.status ?? '') ? (sp.status as EstadoMovimento) : undefined
  const filtros: Filtros = { conta, ...limitesMes(mes), ...(status ? { status } : {}) }

  const [pagina, titulos] = await Promise.all([
    api.get<PaginaMovimentos>(comQuery(`/orgs/${id}/movimentos`, { ...filtros, limite: 500 })),
    api.get<Titulo[]>(comQuery(`/orgs/${id}/titulos-abertos`, { limite: 500 })),
  ])

  return (
    <>
    <Cronometro idOrg={org.id_org} />
    <ConciliacaoClient
      key={`${conta}|${mes}|${status ?? ''}|${sp.mov ?? ''}`}
      org={{ id: org.id_org, nome: org.nome, acoes: org.acoes }}
      contas={contas} plano={plano} mes={mes} filtros={filtros}
      inicial={{ pagina, titulos }}
      focoInicial={zId.safeParse(sp.mov).success ? sp.mov : undefined}
    />
    </>
  )
}
