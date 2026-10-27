'use server'

import { cookies } from 'next/headers'
import { COOKIE_TEMA, COOKIE_TEMA_MAX_AGE, temaValido, type Tema } from './tema'

/**
 * Grava a escolha de tema.
 *
 * ⚠️ Ela NÃO é o que muda a tela. Quem troca a cor na hora é o próprio botão, mexendo em
 * `document.documentElement.dataset.theme` — instantâneo, sem ida ao servidor. Esta ação
 * existe para a escolha SOBREVIVER: sem ela a próxima navegação renderizaria no servidor com
 * o tema antigo e a tela piscaria de volta.
 *
 * ⚠️ Sem `revalidatePath`, de propósito: o tema não muda dado nenhum. Invalidar o cache aqui
 * jogaria fora todas as páginas por uma troca de cor.
 */
export async function salvarTema(tema: Tema): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_TEMA, temaValido(tema), {
    path: '/',
    maxAge: COOKIE_TEMA_MAX_AGE,
    sameSite: 'lax',
    // ⚠️ `httpOnly` porque quem lê é o servidor. O navegador não precisa ler: o estado
    // inicial chega como prop, e a troca é feita no `<html>` direto.
    httpOnly: true,
  })
}
