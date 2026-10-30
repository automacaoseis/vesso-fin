'use server'

import { z } from 'zod'
import { bTempoIniciar } from '@vesso-fin/shared'
import { api, tentar } from '@/lib/api'

export async function iniciar(idOrg: string, etapa: string) { return tentar(() => api.post('/tempo/iniciar', bTempoIniciar.parse({ id_org: idOrg, etapa }))) }
export async function parar(nota?: string) {
  return tentar(() => api.post('/tempo/parar', nota?.trim() ? { nota: z.string().trim().max(500).parse(nota) } : {}))
}
