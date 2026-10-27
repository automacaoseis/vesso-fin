/**
 * TEMA — claro ou escuro, por pessoa.
 *
 * Este arquivo é ISOMORFO de propósito (nada de `next/headers`, nada de `'use server'`):
 * o `<html>` do servidor e o botão do menu precisam dos mesmos nomes, e um enum duplicado
 * em dois lugares é como as duas pontas passam a discordar.
 *
 * ⚠️ **O CLARO É O PADRÃO, e é decisão de marca — não inércia.** A prancha "Paleta de cores"
 * (p.76) declara 40% off-white contra 30% ink: o fundo dominante da Vesso é o papel. Quem
 * nunca escolheu nada — e todo mundo que abre o app pela primeira vez — vê a identidade na
 * proporção em que ela foi desenhada. O escuro é uma preferência que se liga.
 *
 * ⚠️ **`prefers-color-scheme` NÃO decide sozinho, e isso é deliberado.** Seria o reflexo
 * comum, e contradiria o parágrafo acima: metade do time usa o sistema em escuro e abriria o
 * app em escuro sem nunca ter pedido. A preferência do SO é sobre o SO. Aqui a escolha é
 * explícita, e enquanto não houver escolha vale o papel.
 *
 * ⚠️ **COOKIE, e não `localStorage`.** É o que permite ao layout — que é server component —
 * emitir `<html data-theme>` já no HTML, e a primeira pintura sair na cor certa. Com
 * `localStorage` o servidor não sabe do tema: a página pintaria clara e viraria escura depois
 * da hidratação, em TODA navegação. É o mesmo motivo pelo qual o tema não passa por Context
 * (ver a nota no topo de `lib/theme.ts`).
 */

export type Tema = 'claro' | 'escuro'

export const COOKIE_TEMA = 'vesso-tema'

/** Ver a nota acima antes de trocar. */
export const TEMA_PADRAO: Tema = 'claro'

/** Um ano: a escolha de tema não expira sozinha — ninguém "revisa" tema. */
export const COOKIE_TEMA_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Qualquer coisa que não seja exatamente `'escuro'` cai no padrão.
 * ⚠️ Cookie é entrada externa: a pessoa pode editá-lo no navegador, e um valor estranho não
 * pode virar `data-theme="qualquer-coisa"` — que não casaria com nenhum bloco do CSS e
 * deixaria a página com TODOS os tokens sem valor, sem erro nenhum.
 */
export function temaValido(cru: string | undefined | null): Tema {
  return cru === 'escuro' ? 'escuro' : TEMA_PADRAO
}

/** O valor de `data-theme` no `<html>` — é ele que casa com os blocos de `globals.css`. */
export function atributoTema(tema: Tema): 'dark' | 'light' {
  return tema === 'escuro' ? 'dark' : 'light'
}
