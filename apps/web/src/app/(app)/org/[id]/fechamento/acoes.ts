'use server'

import { z } from 'zod'
import { bInformarSaldo, zCompetencia, zId } from '@vesso-fin/shared'
import { api, tentar } from '@/lib/api'

const base = (idOrg: string, comp: string) => `/orgs/${zId.parse(idOrg)}/fechamentos/${zCompetencia.parse(comp)}`

export async function enviar(idOrg: string, comp: string) { return tentar(() => api.post(`${base(idOrg, comp)}/enviar`)) }
export async function revisar(idOrg: string, comp: string, aprovar: boolean, nota?: string) {
  return tentar(() => api.post(`${base(idOrg, comp)}/revisar`, { aprovar: z.boolean().parse(aprovar), ...(nota?.trim() ? { nota: z.string().trim().max(2000).parse(nota) } : {}) }))
}
export async function liberar(idOrg: string, comp: string) { return tentar(() => api.post(`${base(idOrg, comp)}/liberar`)) }
export async function reabrir(idOrg: string, comp: string, motivo: string) {
  return tentar(() => api.post(`${base(idOrg, comp)}/reabrir`, { motivo: z.string().trim().min(10).max(1000).parse(motivo) }))
}
// Saldo de conta sem extrato/API (0007): entra à mão para o checklist conferir.
export async function informarSaldo(idConta: string, data: string, saldo: number) {
  return tentar(() => api.post(`/contas/${zId.parse(idConta)}/saldos`, bInformarSaldo.parse({ data, saldo })))
}
