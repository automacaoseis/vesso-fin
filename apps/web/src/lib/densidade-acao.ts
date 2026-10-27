'use server'

import { cookies } from 'next/headers'
import { COOKIE_DENSIDADE, COOKIE_DENSIDADE_MAX_AGE, densidadeValida, type Densidade } from './densidade'

/**
 * Grava a densidade escolhida.
 *
 * ⚠️ Como no tema, ela NÃO é o que muda a tela: quem muda é o próprio seletor, escrevendo
 * `data-densidade` no `<html>`. Esta ação só faz a escolha sobreviver à próxima navegação.
 */
export async function salvarDensidade(d: Densidade): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_DENSIDADE, densidadeValida(d), {
    path: '/', maxAge: COOKIE_DENSIDADE_MAX_AGE, sameSite: 'lax', httpOnly: true,
  })
}
