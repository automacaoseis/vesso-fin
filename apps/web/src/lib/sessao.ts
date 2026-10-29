import 'server-only'
import { cookies } from 'next/headers'
import { auth, COOKIE_AT, COOKIE_RT, expiraEm, opcoesCookie, RT_MAX_AGE, type SessaoAuth } from './sessao-cookies'

export async function gravarSessao(s: SessaoAuth) {
  const jar = await cookies()
  jar.set(COOKIE_AT, s.access_token, opcoesCookie(s.expires_in))
  jar.set(COOKIE_RT, s.refresh_token, opcoesCookie(RT_MAX_AGE))
}

export async function tokenAtual(): Promise<string | null> {
  return (await cookies()).get(COOKIE_AT)?.value ?? null
}

/** E-mail e sub para exibir. NÃO é autenticação (não verifica assinatura) — a API é quem decide. */
export async function quemEstaLogado(): Promise<{ sub: string; email: string | null } | null> {
  const t = await tokenAtual()
  if (!t || expiraEm(t) * 1000 < Date.now()) return null
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1] ?? '', 'base64url').toString())
    return { sub: p.sub, email: p.email ?? null }
  } catch { return null }
}

export async function entrarComSenha(email: string, senha: string): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const r = await auth('/token?grant_type=password', { email, password: senha })
  if (r.status === 400 || r.status === 401) return { ok: false, mensagem: 'E-mail ou senha inválidos.' }
  if (r.status === 429) return { ok: false, mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }
  if (!r.ok) return { ok: false, mensagem: 'Não foi possível entrar agora. Tente de novo em instantes.' }
  await gravarSessao((await r.json()) as SessaoAuth)
  return { ok: true }
}

/** Pede o link de nova senha ao Auth. O link leva à tela de nova senha do site configurado no Supabase (a do admin). */
export async function pedirNovaSenha(email: string): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const r = await auth('/recover', { email })
  if (r.status === 429) return { ok: false, mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }
  return { ok: true }   // não diz se o e-mail existe
}

export async function sair() {
  const jar = await cookies()
  const t = jar.get(COOKIE_AT)?.value
  if (t) await auth('/logout', {}, t).catch(() => {})   // revoga o refresh token no Auth
  jar.delete(COOKIE_AT)
  jar.delete(COOKIE_RT)
}
