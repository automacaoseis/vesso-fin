import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { mesesEntre, montarDfc, montarDre, zId, type LinhaDfcApi, type LinhaDreApi } from '@vesso-fin/shared'
import { api, comQuery, ErroDaApi } from '@/lib/api'
import RelatoriosClient from './RelatoriosClient'

export const metadata: Metadata = { title: 'Relatórios' }

const mesOk = (m?: string) => (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : undefined)
function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date())
}

export default async function Relatorios({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string; de?: string; ate?: string }>
}) {
  const { id } = await params
  if (!zId.safeParse(id).success) notFound()
  const sp = await searchParams
  let org: { id_org: string; nome: string }
  try { org = await api.get(`/orgs/${id}`) } catch (e) {
    if (e instanceof ErroDaApi && (e.status === 404 || e.status === 403)) notFound()
    throw e
  }
  const aba = sp.aba === 'dfc' ? 'dfc' : 'dre'
  const atual = hojeSP()
  const ate = mesOk(sp.ate) ?? atual
  const de = mesOk(sp.de) ?? `${ate.slice(0, 4)}-01`
  const [deC, ateC] = de <= ate ? [`${de}-01`, `${ate}-01`] : [`${ate}-01`, `${de}-01`]
  const meses = mesesEntre(deC, ateC).slice(-24)   // teto de 24 colunas: além disso a grade deixa de ser legível
  const q = { de: meses[0]!, ate: meses.at(-1)! }
  const linhas = aba === 'dre'
    ? montarDre(await api.get<LinhaDreApi[]>(comQuery(`/orgs/${id}/dre`, q)), meses)
    : montarDfc(await api.get<LinhaDfcApi[]>(comQuery(`/orgs/${id}/dfc`, q)), meses)
  return <RelatoriosClient key={`${aba}|${q.de}|${q.ate}`} org={{ id: org.id_org, nome: org.nome }} aba={aba} meses={meses} linhas={linhas} mesAtual={`${atual}-01`} />
}
