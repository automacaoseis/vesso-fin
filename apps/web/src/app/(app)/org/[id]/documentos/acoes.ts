'use server'

import { z } from 'zod'
import { bMotivo, bPedirDocumento, bValidarDocumento, zId } from '@vesso-fin/shared'
import { api, tentar } from '@/lib/api'

const MAX = 5 * 1024 * 1024

export async function pedir(idOrg: string, dados: unknown) {
  return tentar(() => api.post<{ id: string }>(`/orgs/${zId.parse(idOrg)}/documentos/pedir`, bPedirDocumento.parse(dados)))
}

// form: arquivo + (id_documento | tipo, descricao, competencia?)
export async function enviar(idOrg: string, form: FormData) {
  const arquivo = form.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false as const, mensagem: 'escolha um arquivo', status: 422 }
  if (arquivo.size > MAX) return { ok: false as const, mensagem: 'arquivo maior que 5 MB', status: 422 }
  const f = new FormData()
  f.set('arquivo', arquivo, z.string().max(200).parse(arquivo.name))
  for (const k of ['id_documento', 'tipo', 'descricao', 'competencia', 'id_titulo']) {
    const v = form.get(k)
    if (typeof v === 'string' && v.trim()) f.set(k, v.trim())
  }
  return tentar(() => api.postArquivo<{ id: string }>(`/orgs/${zId.parse(idOrg)}/documentos`, f))
}

export async function linkArquivo(id: string) { return tentar(() => api.get<{ url: string }>(`/documentos/${zId.parse(id)}/arquivo`)) }
export async function validar(id: string, aprovar: boolean, motivo?: string) {
  return tentar(() => api.post(`/documentos/${zId.parse(id)}/validar`, bValidarDocumento.parse({ aprovar, ...(motivo?.trim() ? { motivo } : {}) })))
}
export async function dispensar(id: string, motivo: string) { return tentar(() => api.post(`/documentos/${zId.parse(id)}/dispensar`, bMotivo.parse({ motivo }))) }
