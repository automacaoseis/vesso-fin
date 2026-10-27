import { cookies } from 'next/headers'
import { COOKIE_DENSIDADE, densidadeValida, type Densidade } from './densidade'

/** A densidade desta requisição. Lida no layout raiz, antes da primeira pintura. */
export async function lerDensidade(): Promise<Densidade> {
  const jar = await cookies()
  return densidadeValida(jar.get(COOKIE_DENSIDADE)?.value)
}
