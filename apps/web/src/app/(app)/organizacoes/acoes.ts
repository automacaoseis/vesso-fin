'use server'

import { bAtualizarOrg, bCriarConta, bCriarEntidade, bCriarOrg, bLigarPortal, bMotivo, qBuscaCliente, zId } from '@vesso-fin/shared'
import { api, tentar } from '@/lib/api'

export interface ClienteBusca { id_cliente: string; nome: string; id_org: string | null; organizacao: string | null }

export async function buscarClientes(q: string) {
  return tentar(() => api.get<ClienteBusca[]>(`/cadastro/clientes?q=${encodeURIComponent(qBuscaCliente.parse({ q }).q)}`))
}
export async function criarOrg(dados: unknown) { return tentar(() => api.post<{ id: string }>('/orgs', bCriarOrg.parse(dados))) }
export async function atualizarOrg(id: string, dados: unknown) { return tentar(() => api.post(`/orgs/${zId.parse(id)}/atualizar`, bAtualizarOrg.parse(dados))) }
export async function ligarPortal(id: string, idCliente: string | null) { return tentar(() => api.post(`/orgs/${zId.parse(id)}/portal`, bLigarPortal.parse({ id_cliente: idCliente }))) }
export async function criarEntidade(id: string, dados: unknown) { return tentar(() => api.post<{ id: string }>(`/orgs/${zId.parse(id)}/entidades`, bCriarEntidade.parse(dados))) }
export async function criarConta(id: string, dados: unknown) { return tentar(() => api.post<{ id: string }>(`/orgs/${zId.parse(id)}/contas`, bCriarConta.parse(dados))) }
export async function desativarConta(id: string, motivo: string) { return tentar(() => api.post(`/contas/${zId.parse(id)}/desativar`, bMotivo.parse({ motivo }))) }
