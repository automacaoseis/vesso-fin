// SÓ PARA TESTE LOCAL. Imita o mínimo do Supabase Auth: JWKS, login por senha, refresh e logout,
// assinando ES256 como o projeto real. Os usuários são os do seed (apps/api/test/seed.sql), senha "senha".
// Uso: pnpm --filter @vesso-fin/api exec tsx scripts/auth-falso.ts · SUPABASE_URL=http://localhost:9999 na API e no web.
import { createServer } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const PORTA = Number(process.env.PORTA ?? 9999)
const BASE = `http://localhost:${PORTA}`
const USUARIOS: Record<string, string> = {
  'dono@x': '00000000-0000-0000-0000-0000000000d0', 'analista@x': '00000000-0000-0000-0000-0000000000a1',
  'revisor@x': '00000000-0000-0000-0000-0000000000a2', 'head@x': '00000000-0000-0000-0000-0000000000b1',
  'gestor_trafego@x': '00000000-0000-0000-0000-0000000000c1',
}

const { privateKey, publicKey } = await generateKeyPair('ES256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'local-1', alg: 'ES256', use: 'sig' }
const sessao = async (email: string) => ({
  access_token: await new SignJWT({ role: 'authenticated', email, session_id: crypto.randomUUID() })
    .setProtectedHeader({ alg: 'ES256', kid: 'local-1' }).setIssuer(`${BASE}/auth/v1`).setAudience('authenticated')
    .setSubject(USUARIOS[email]!).setIssuedAt().setExpirationTime('1h').sign(privateKey),
  refresh_token: Buffer.from(email).toString('base64url'), expires_in: 3600, token_type: 'bearer',
})

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', BASE)
  let corpo = ''
  for await (const c of req) corpo += c
  const json = (s: number, b: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
  if (url.pathname === '/auth/v1/.well-known/jwks.json') return json(200, { keys: [jwk] })
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const b = JSON.parse(corpo || '{}')
    if (url.searchParams.get('grant_type') === 'password')
      return USUARIOS[b.email] && b.password === 'senha' ? json(200, await sessao(b.email)) : json(400, { error: 'invalid_grant' })
    const email = Buffer.from(String(b.refresh_token ?? ''), 'base64url').toString()
    return USUARIOS[email] ? json(200, await sessao(email)) : json(400, { error: 'invalid_grant' })
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end() }
  json(404, {})
}).listen(PORTA, () => console.log(`auth falso em ${BASE}`))
