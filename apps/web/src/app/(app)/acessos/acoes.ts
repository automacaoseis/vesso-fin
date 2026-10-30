'use server'

import { bConcederAcesso, bMotivo, zId } from '@vesso-fin/shared'
import { api, tentar } from '@/lib/api'

export async function conceder(dados: unknown) { return tentar(() => api.post('/acessos', bConcederAcesso.parse(dados))) }
export async function revogar(id: string, motivo: string) {
  return tentar(() => api.post(`/acessos/${zId.parse(id)}/revogar`, bMotivo.parse({ motivo })))
}
