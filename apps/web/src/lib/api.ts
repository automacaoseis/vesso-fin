import 'server-only'
import { redirect } from 'next/navigation'
import type { ErroApi } from '@vesso-fin/shared'
import { assinarServico } from '@vesso-fin/shared/servico'
import { tokenAtual } from './sessao'

export class ErroDaApi extends Error {
  constructor(readonly status: number, readonly corpo: ErroApi | null) { super(corpo?.mensagem ?? `erro ${status}`) }
}

function env() {
  const url = process.env.VESSO_API_URL, segredo = process.env.VESSO_SERVICE_SECRET
  if (!url || !segredo) throw new Error('VESSO_API_URL / VESSO_SERVICE_SECRET ausentes')
  return { url: url.replace(/\/$/, ''), segredo }
}

async function chamar<T>(metodo: 'GET' | 'POST' | 'PATCH', caminho: string, corpo?: unknown, form?: FormData): Promise<T> {
  const token = await tokenAtual()
  if (!token) redirect('/login')
  const { url, segredo } = env()
  // multipart: serializa uma vez para assinar exatamente os bytes que vão no fio
  let bytes: Uint8Array | string = corpo === undefined ? '' : JSON.stringify(corpo)
  let tipo: string | null = bytes ? 'application/json' : null
  if (form) {
    const req = new Request('http://local', { method: 'POST', body: form })
    bytes = new Uint8Array(await req.arrayBuffer())
    tipo = req.headers.get('content-type')
  }
  const r = await fetch(url + caminho, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      'x-vesso-service': assinarServico(segredo, metodo, caminho, bytes),
      ...(tipo ? { 'content-type': tipo } : {}),
    },
    body: bytes.length ? (bytes as BodyInit) : undefined,
    cache: 'no-store',
  })
  if (r.status === 401) redirect('/login')
  const json = await r.json().catch(() => null)
  if (!r.ok) throw new ErroDaApi(r.status, json)
  return json as T
}

/** caminho com query: monte com `comQuery` para a assinatura bater com o que a API vê. */
export const api = {
  get: <T,>(caminho: string) => chamar<T>('GET', caminho),
  post: <T = { ok: true },>(caminho: string, corpo: unknown = {}) => chamar<T>('POST', caminho, corpo),
  patch: <T = { ok: true },>(caminho: string, corpo: unknown) => chamar<T>('PATCH', caminho, corpo),
  postArquivo: <T,>(caminho: string, form: FormData) => chamar<T>('POST', caminho, undefined, form),
}

export function comQuery(caminho: string, q: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `${caminho}?${s}` : caminho
}

export type Resultado<T = unknown> = { ok: true; dados: T } | { ok: false; mensagem: string; status: number }

/** Para Server Actions: erro de regra vira resultado (a tela mostra a mensagem do banco); redirect passa. */
export async function tentar<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, dados: await fn() }
  } catch (e) {
    if (e instanceof ErroDaApi) return { ok: false, mensagem: e.corpo?.mensagem ?? 'erro inesperado', status: e.status }
    throw e
  }
}
