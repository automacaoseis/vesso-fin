// Nomes e opções dos cookies de sessão — compartilhado entre proxy.ts (edge/node) e lib/sessao.ts.
export const COOKIE_AT = 'vf_at'
export const COOKIE_RT = 'vf_rt'
/** O refresh token vale bem mais que o access (1h); 30 dias é o teto de "lembrar". */
export const RT_MAX_AGE = 60 * 60 * 24 * 30

export function opcoesCookie(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge }
}

export interface SessaoAuth { access_token: string; refresh_token: string; expires_in: number }

/** Lê o `exp` do JWT SEM verificar — só para decidir quando renovar. Quem verifica é a API. */
export function expiraEm(token: string | undefined): number {
  if (!token) return 0
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
    return typeof p.exp === 'number' ? p.exp : 0
  } catch { return 0 }
}

function envAuth() {
  const url = process.env.SUPABASE_URL, chave = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY ausentes')
  return { url: url.replace(/\/$/, ''), chave }
}

/** Chamada ao Auth do Supabase — só do servidor. O navegador nunca vê esta URL. */
export async function auth(caminho: string, corpo: unknown, token?: string): Promise<Response> {
  const { url, chave } = envAuth()
  return fetch(`${url}/auth/v1${caminho}`, {
    method: 'POST',
    headers: { apikey: chave, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(corpo),
    cache: 'no-store',
  })
}

export async function renovar(refresh: string): Promise<SessaoAuth | null> {
  const r = await auth('/token?grant_type=refresh_token', { refresh_token: refresh })
  return r.ok ? ((await r.json()) as SessaoAuth) : null
}
