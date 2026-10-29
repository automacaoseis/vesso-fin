'use server'

import { z } from 'zod'
import { zCompetencia, zId } from '@vesso-fin/shared'
import { api, comQuery, tentar } from '@/lib/api'

export interface LinhaFato {
  regime: string; mes: string; data_ref: string; valor: number; origem: string; id_titulo: string; id_movimento: string | null
  descricao: string; contraparte: string | null; codigo: string | null; conta: string | null; descricao_extrato: string | null
}

/** Detalhamento de uma célula: os lançamentos das contas no período (competência = títulos; caixa = baixas). */
export async function detalhar(idOrg: string, regime: 'competencia' | 'caixa', de: string, ate: string, planos: string[]) {
  const p = z.array(zId).min(1).max(200).parse(planos)
  return tentar(() => api.get<LinhaFato[]>(comQuery(`/orgs/${zId.parse(idOrg)}/fato`, {
    regime: z.enum(['competencia', 'caixa']).parse(regime), de: zCompetencia.parse(de), ate: zCompetencia.parse(ate), planos: p.join(','),
  })))
}
