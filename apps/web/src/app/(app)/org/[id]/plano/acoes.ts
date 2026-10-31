'use server'

import { bCriarPlanoConta, bEditarPlanoConta, zId } from '@vesso-fin/shared'
import { api, tentar } from '@/lib/api'

export async function criarConta(idOrg: string, dados: unknown) { return tentar(() => api.post<{ id: string }>(`/orgs/${zId.parse(idOrg)}/plano`, bCriarPlanoConta.parse(dados))) }
export async function editarConta(id: string, dados: unknown) { return tentar(() => api.post(`/plano/${zId.parse(id)}/editar`, bEditarPlanoConta.parse(dados))) }
