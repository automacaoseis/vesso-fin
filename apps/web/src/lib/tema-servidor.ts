import { cookies } from 'next/headers'
import { COOKIE_TEMA, temaValido, type Tema } from './tema'

/**
 * O tema desta requisição, lido do cookie.
 *
 * ⚠️ Chamada no layout raiz, ANTES de renderizar — é o que faz o `data-theme` sair no HTML
 * do servidor e a primeira pintura já ser a definitiva. Ver a nota em `lib/tema.ts` sobre por
 * que isto é cookie e não `localStorage`.
 */
export async function lerTema(): Promise<Tema> {
  const jar = await cookies()
  return temaValido(jar.get(COOKIE_TEMA)?.value)
}
