// Erro do Postgres → HTTP (docs/PROMPT.md §8). As mensagens das RPCs já são texto para o usuário.
import type { ErroApi } from '@vesso-fin/shared'

export class ErroHttp extends Error {
  constructor(readonly status: number, readonly corpo: ErroApi) { super(corpo.mensagem) }
}

export function erroDoBanco(e: unknown): ErroHttp | null {
  if (!e || typeof e !== 'object' || !('code' in e) || typeof (e as any).code !== 'string') return null
  const { code, message } = e as { code: string; message: string }
  switch (code) {
    case '28000': return new ErroHttp(401, { erro: 'nao_autenticado', mensagem: 'sessão expirada; entre de novo' })
    case '42501':
      // "permission denied for table x" é do Postgres (GRANT), não de uma RPC: não expõe o nome da tabela.
      return new ErroHttp(403, { erro: 'sem_permissao', mensagem: message.startsWith('permission denied') ? 'sem permissão' : message })
    case 'P0001': return new ErroHttp(422, { erro: 'regra', mensagem: message })
    case '23505': return new ErroHttp(422, { erro: 'regra', mensagem: 'registro duplicado' })
    case '23503': return new ErroHttp(422, { erro: 'regra', mensagem: 'referência inexistente ou de outra organização' })
    case '23502': case '23514': case '23P01':
      return new ErroHttp(422, { erro: 'regra', mensagem: 'os dados violam uma regra do banco' })
    case '22P02': case '22007': case '22008': case '22003':
      return new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'valor em formato inválido' })
    case '57014': return new ErroHttp(503, { erro: 'interno', mensagem: 'a consulta demorou demais; tente de novo' })
    default: return null
  }
}
