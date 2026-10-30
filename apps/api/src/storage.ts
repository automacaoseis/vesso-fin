// Storage do Supabase (bucket bpo-fin) chamado COM O JWT DO USUÁRIO: quem decide é a policy por prefixo id_org/
// da 0009 — a API não tem service_role (docs/PROMPT.md §2). A chave publicável só identifica o projeto no gateway.
import { ErroHttp } from './erros'

export const BUCKET = 'bpo-fin'

export interface Storage {
  enviar(token: string, caminho: string, bytes: Uint8Array, mime: string): Promise<void>
  /** URL assinada de leitura, válida por `segundos`. */
  assinar(token: string, caminho: string, segundos: number): Promise<string>
}

const enc = (caminho: string) => caminho.split('/').map(encodeURIComponent).join('/')

export function storageSupabase(url: string, chavePublicavel: string): Storage {
  const base = `${url.replace(/\/$/, '')}/storage/v1`
  const h = (token: string) => ({ authorization: `Bearer ${token}`, apikey: chavePublicavel })
  async function falha(r: Response, acao: string): Promise<never> {
    const corpo = (await r.json().catch(() => ({}))) as { message?: string; statusCode?: string }
    const negado = r.status === 403 || corpo.statusCode === '403' || /row-level security/i.test(corpo.message ?? '')
    if (negado) throw new ErroHttp(403, { erro: 'sem_permissao', mensagem: `sem permissão para ${acao} arquivos desta organização` })
    if (r.status === 413 || /size/i.test(corpo.message ?? '')) throw new ErroHttp(413, { erro: 'entrada_invalida', mensagem: 'arquivo grande demais (máx. 5 MB)' })
    if (/mime/i.test(corpo.message ?? '')) throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'tipo de arquivo não aceito (PDF, imagem, XML, planilha, OFX)' })
    throw new ErroHttp(502, { erro: 'interno', mensagem: `storage respondeu ${r.status}: ${corpo.message ?? 'erro'}` })
  }
  return {
    async enviar(token, caminho, bytes, mime) {
      const r = await fetch(`${base}/object/${BUCKET}/${enc(caminho)}`, {
        method: 'POST', headers: { ...h(token), 'content-type': mime || 'application/octet-stream', 'x-upsert': 'false' }, body: bytes,
      })
      if (!r.ok) await falha(r, 'enviar')
    },
    async assinar(token, caminho, segundos) {
      const r = await fetch(`${base}/object/sign/${BUCKET}/${enc(caminho)}`, {
        method: 'POST', headers: { ...h(token), 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: segundos }),
      })
      if (!r.ok) await falha(r, 'ler')
      const { signedURL } = (await r.json()) as { signedURL: string }
      return `${base}${signedURL}`
    },
  }
}
