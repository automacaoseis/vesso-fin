import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { zId } from '@vesso-fin/shared'
import { api, ErroDaApi } from '@/lib/api'
import { quemEstaLogado } from '@/lib/sessao'
import FechamentoClient, { type DetalheFech, type MesFech } from './FechamentoClient'

export const metadata: Metadata = { title: 'Fechamento' }

function mesAnteriorSP() {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date())
  const d = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 2, 1))
  return d.toISOString().slice(0, 7)
}

export default async function Fechamento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  const { mes: mesQ } = await searchParams
  let org: { id_org: string; nome: string; acoes: string[]; competencia_inicial: string | null }
  try { org = await api.get(`/orgs/${id}`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  // padrão: o mês anterior (é o que se fecha no começo do mês)
  const mes = mesQ && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesQ) ? mesQ : mesAnteriorSP()
  const [meses, detalhe, quem, contas] = await Promise.all([
    api.get<MesFech[]>(`/orgs/${id}/fechamentos`),
    api.get<DetalheFech>(`/orgs/${id}/fechamentos/${mes}-01`),
    quemEstaLogado(),
    api.get<{ id_conta: string; apelido: string }[]>(`/orgs/${id}/contas`),
  ])
  return <FechamentoClient key={mes} org={{ id: org.id_org, nome: org.nome, acoes: org.acoes, competenciaInicial: org.competencia_inicial }}
    mes={`${mes}-01`} meses={meses} detalhe={detalhe} eu={quem?.sub ?? null} contas={contas} />
}
