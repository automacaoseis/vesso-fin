'use server'

import { z } from 'zod'
import { zId } from '@vesso-fin/shared'
import { api, tentar } from '@/lib/api'

export interface Extrato {
  id_extrato: string; arquivo_nome: string | null; status: 'recebido' | 'processado' | 'erro' | 'duplicado'
  recebido_em: string; processado_em: string | null; periodo_inicio: string | null; periodo_fim: string | null
  saldo_final_informado: number | null; data_saldo_final: string | null
  linhas_lidas: number | null; linhas_novas: number | null; linhas_removidas: number | null; erro_msg: string | null
}

export async function extratosDa(idConexao: string) {
  return tentar(() => api.get<Extrato[]>(`/conexoes/${zId.parse(idConexao)}/extratos`))
}

export async function enviarOfx(idConexao: string, form: FormData) {
  const id = zId.parse(idConexao)
  const arquivo = form.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false as const, mensagem: 'escolha um arquivo .ofx', status: 422 }
  if (!/\.ofx$/i.test(arquivo.name)) return { ok: false as const, mensagem: 'o arquivo precisa ser .ofx', status: 422 }
  if (arquivo.size > 5 * 1024 * 1024) return { ok: false as const, mensagem: 'arquivo maior que 5 MB', status: 422 }
  const f = new FormData()
  f.set('arquivo', arquivo, z.string().max(200).parse(arquivo.name))
  return tentar(() => api.postArquivo<{ id_extrato: string; duplicado: boolean; id_job: number | null }>(`/conexoes/${id}/extratos`, f))
}
