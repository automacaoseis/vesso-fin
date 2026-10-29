'use server'

// Server Actions de Lançamentos. Toda entrada validada antes de virar caminho/corpo da API.
import { z } from 'zod'
import { bCriarTitulo, qTitulos, zCompetencia, zId } from '@vesso-fin/shared'
import { api, comQuery, tentar } from '@/lib/api'
import type { Detalhe, Filtros, Pagina } from './tipos'

const lista = (idOrg: string, f: Filtros, extra: Record<string, string | number | undefined> = {}) => {
  const v = qTitulos.parse({ ...f, ...extra })
  return api.get<Pagina>(comQuery(`/orgs/${zId.parse(idOrg)}/titulos`, { ...v }))
}

export async function recarregar(idOrg: string, f: Filtros) { return tentar(() => lista(idOrg, f)) }
export async function carregarMais(idOrg: string, f: Filtros, cursor: string) { return tentar(() => lista(idOrg, f, { cursor: z.string().max(200).parse(cursor) })) }
export async function detalhe(idTitulo: string) { return tentar(() => api.get<Detalhe>(`/titulos/${zId.parse(idTitulo)}`)) }

export async function categorizar(idTitulo: string, idPlano: string, competencia?: string) {
  return tentar(() => api.patch(`/titulos/${zId.parse(idTitulo)}/categoria`, { id_plano_conta: zId.parse(idPlano), ...(competencia ? { competencia: zCompetencia.parse(competencia) } : {}) }))
}
export async function categorizarLote(ids: string[], idPlano: string, competencia?: string) {
  return tentar(() => api.post<{ ok: true; qtd: number }>('/titulos/categorizar-lote', {
    ids: z.array(zId).min(1).max(500).parse(ids), id_plano_conta: zId.parse(idPlano), ...(competencia ? { competencia: zCompetencia.parse(competencia) } : {}),
  }))
}
export async function cancelar(idTitulo: string, motivo: string) {
  return tentar(() => api.post(`/titulos/${zId.parse(idTitulo)}/cancelar`, { motivo: z.string().trim().min(5).max(1000).parse(motivo) }))
}
export async function criar(dados: unknown) {
  const b = bCriarTitulo.parse(dados)
  return tentar(() => api.post<{ ok: true; titulos: string[] }>('/titulos', b))
}
export async function buscarContrapartes(idOrg: string, q: string) {
  return tentar(() => api.get<{ id_contraparte: string; nome: string; documento: string | null }[]>(comQuery(`/orgs/${zId.parse(idOrg)}/contrapartes`, { q: q.slice(0, 100) })))
}
