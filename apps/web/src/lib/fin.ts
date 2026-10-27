/**
 * Tokens da camada financeira (--f-*, valores em globals.css). O `theme` do vesso-admin vem
 * intacto; isto mora por cima. Mesma regra de lá: chave = nome da var.
 * ⚠️ `theme.text4` não aparece no Vesso FIN (2,57:1 no claro) — use `f.mutedText`.
 */
const v = (nome: string) => `var(--f-${nome})`

export const f = {
  accentText: v('accentText'),
  positiveText: v('positiveText'),
  warningText: v('warningText'),
  negativeText: v('negativeText'),
  mutedText: v('mutedText'),
  money: v('money'),
  dueToday: v('due-today'),
  dueLate: v('due-late'),
  rowSelected: v('row-selected'),
  thSize: v('th-size'),
  numCol: v('num-col'),
} as const
