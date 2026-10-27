// JWT do usuário. O projeto assina sessões com ES256 (signing keys) — conferido nos logs de produção em 23/10/2026:
// kid 0180e603-…, issuer https://<ref>.supabase.co/auth/v1. Por isso JWKS e nada de JWT secret: HS256 é recusado.
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'

export interface Claims extends JWTPayload { sub: string; role: string; email?: string; session_id?: string; is_anonymous?: boolean }
export type VerificarToken = (token: string) => Promise<Claims>

export class TokenInvalido extends Error {}
/** O JWKS não respondeu: não é culpa do token, e o usuário não deve ser deslogado por isso. */
export class AuthIndisponivel extends Error {}

export function verificadorJwt(chaves: JWTVerifyGetKey, issuer: string): VerificarToken {
  return async (token) => {
    let payload: JWTPayload
    try {
      ;({ payload } = await jwtVerify(token, chaves, { issuer, audience: 'authenticated', algorithms: ['ES256', 'RS256', 'EdDSA'] }))
    } catch (e) {
      if (e instanceof errors.JWKSTimeout || !(e instanceof errors.JOSEError)) throw new AuthIndisponivel(String(e))
      throw new TokenInvalido(e.code)
    }
    if (typeof payload.sub !== 'string' || payload.role !== 'authenticated') throw new TokenInvalido('token sem usuário autenticado')
    if (payload.is_anonymous === true) throw new TokenInvalido('login anônimo não acessa o Vesso FIN')
    return payload as Claims
  }
}

export function verificadorSupabase(supabaseUrl: string): VerificarToken {
  const base = supabaseUrl.replace(/\/$/, '')
  return verificadorJwt(createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`)), `${base}/auth/v1`)
}
