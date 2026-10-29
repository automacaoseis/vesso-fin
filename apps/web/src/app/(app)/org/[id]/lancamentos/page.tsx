import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { qTitulos, zId } from '@vesso-fin/shared'
import { api, comQuery, ErroDaApi } from '@/lib/api'
import type { ContaPlano } from '@/components/SeletorPlano'
import LancamentosClient from './LancamentosClient'
import type { Entidade, Filtros, Pagina } from './tipos'

export const metadata: Metadata = { title: 'Lançamentos' }

const mes = (m?: string) => (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? `${m}-01` : undefined)
function hojeSP() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()) }

export default async function Lancamentos({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>
}) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  const sp = await searchParams
  let org: { id_org: string; nome: string; acoes: string[] }
  try { org = await api.get(`/orgs/${id}`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  const atual = hojeSP()
  // período padrão: o mês corrente pela competência ("todos" = sem período)
  const semPeriodo = sp.periodo === 'todos'
  const cand = {
    tipo: sp.tipo, situacao: sp.situacao, campo: sp.campo, plano: sp.plano, q: sp.q,
    de: semPeriodo ? undefined : mes(sp.de) ?? `${atual}-01`, ate: semPeriodo ? undefined : mes(sp.ate) ?? `${atual}-01`,
  }
  const r = qTitulos.safeParse(cand)
  const f = (r.success ? r.data : qTitulos.parse({ de: `${atual}-01`, ate: `${atual}-01` })) as Filtros & { limite: number }
  const [pagina, plano, entidades] = await Promise.all([
    api.get<Pagina>(comQuery(`/orgs/${id}/titulos`, { ...f })),
    api.get<ContaPlano[]>(`/orgs/${id}/plano-contas`),
    api.get<Entidade[]>(`/orgs/${id}/entidades`),
  ])
  const { limite: _l, ...filtros } = f
  void _l
  return <LancamentosClient key={JSON.stringify(filtros)} org={{ id: org.id_org, nome: org.nome, acoes: org.acoes }}
    filtros={filtros} inicial={pagina} plano={plano} entidades={entidades} mesAtual={`${atual}-01`} />
}
