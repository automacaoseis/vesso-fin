// Next 16: "proxy" (ex-middleware). Renova o access token antes que a página o use, e manda para o
// login quem não tem sessão. Server Components não podem gravar cookie — por isso a renovação mora aqui.
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_AT, COOKIE_RT, expiraEm, opcoesCookie, renovar, RT_MAX_AGE } from './lib/sessao-cookies'

const PUBLICAS = ['/login']

export async function proxy(req: NextRequest) {
  const publica = PUBLICAS.some((p) => req.nextUrl.pathname.startsWith(p))
  const at = req.cookies.get(COOKIE_AT)?.value
  const rt = req.cookies.get(COOKIE_RT)?.value
  const valeAinda = expiraEm(at) * 1000 - Date.now() > 120_000

  if (valeAinda || publica && !rt) return NextResponse.next()

  if (rt) {
    const s = await renovar(rt).catch(() => null)
    if (s) {
      // o pedido segue com o token novo (a página já o vê) e a resposta grava os cookies
      req.cookies.set(COOKIE_AT, s.access_token)
      req.cookies.set(COOKIE_RT, s.refresh_token)
      const res = NextResponse.next({ request: { headers: req.headers } })
      res.cookies.set(COOKIE_AT, s.access_token, opcoesCookie(s.expires_in))
      res.cookies.set(COOKIE_RT, s.refresh_token, opcoesCookie(RT_MAX_AGE))
      return res
    }
  }
  if (publica) return NextResponse.next()
  const login = new URL('/login', req.url)
  if (req.nextUrl.pathname !== '/') login.searchParams.set('volta', req.nextUrl.pathname + req.nextUrl.search)
  const res = NextResponse.redirect(login)
  res.cookies.delete(COOKIE_AT)
  res.cookies.delete(COOKIE_RT)
  return res
}

export const config = {
  // Tudo menos estático. Server Actions passam por aqui também (são POST na própria rota).
  // Arquivos públicos (logo, ícones) passam sem sessão — a tela de login precisa deles.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
}
