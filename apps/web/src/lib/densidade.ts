/**
 * DENSIDADE — o tamanho do app, por pessoa.
 *
 * ⚠️ **POR QUE ISTO EXISTE.** O André abriu o sistema num monitor de 23" e achou tudo pequeno;
 * o Luiz, no MacBook, acha excelente. Não é preferência — é física, e medida:
 *
 *   corpo de 11px (o 2º mais usado do app, 164 ocorrências)
 *
 *                          altura física   ângulo visual   px REAIS desenhando
 *     MacBook 14" Retina      2,29 mm          17,5'             22
 *     Monitor 23" 1080p       2,92 mm          14,3'             11
 *
 * São **duas** perdas somadas, e a segunda é a invisível: no monitor a letra é 18% menor em
 * ângulo (o monitor fica mais longe, ~70cm contra ~45cm), **e é desenhada com metade dos
 * pixels**. Num corpo de 11px isso é a diferença entre nítido e borrado — e quem sente
 * descreve como "pequeno", porque é assim que parece.
 *
 * ⚠️ **Quem está no Retina NÃO CONSEGUE reproduzir o problema.** Por isso o relato ficou
 * parado: uma pessoa reclama, a outra olha e não vê nada de errado. `17,5 ÷ 14,3 = 122%` é
 * exatamente o zoom que iguala os dois — o que confirma que o relato estava certo e o número
 * dele também.
 *
 * ⚠️ **`zoom` e não `font-size`.** O app tem **1.248 `fontSize` inline, todos em px e nenhum
 * em `rem`** — mudar a raiz não moveria nada. `zoom` escala o layout inteiro (corpo, espaço,
 * ícone, borda) exatamente como o Ctrl+ do navegador, e os 1.248 vêm de graça.
 *
 * ⚠️ **`compacto` é o padrão porque é o que existe hoje.** Quem já usa não vê diferença; quem
 * precisa, aumenta. O contrário mudaria a tela de todo mundo para resolver o caso de alguns.
 */

export type Densidade = 'compacto' | 'confortavel' | 'amplo'

export const COOKIE_DENSIDADE = 'vesso-densidade'
export const DENSIDADE_PADRAO: Densidade = 'compacto'
export const COOKIE_DENSIDADE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * ⚠️ Os passos são de ~15%, e o teto é 130% de propósito. O cálculo acima pede 122% para o
 * caso do monitor de 23"; acima de ~130% uma tabela de 10 meses começa a rolar de lado num
 * 1080p, e trocar rolagem vertical por horizontal numa tela de comparação é pior negócio.
 */
export const FATOR: Record<Densidade, number> = {
  compacto: 1,
  confortavel: 1.15,
  amplo: 1.3,
}

export const ROTULO: Record<Densidade, string> = {
  compacto: 'Compacto',
  confortavel: 'Confortável',
  amplo: 'Amplo',
}

/** ⚠️ Cookie é entrada externa — valor estranho não pode virar um `data-densidade` sem regra. */
export function densidadeValida(cru: string | undefined | null): Densidade {
  return cru === 'confortavel' || cru === 'amplo' ? cru : DENSIDADE_PADRAO
}
