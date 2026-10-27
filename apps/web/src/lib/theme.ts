/**
 * TEMA — fonte única de verdade para cor e tipografia do Vesso Admin.
 *
 * ⚠️ AS CORES AQUI NÃO SÃO VALORES: SÃO PONTEIROS. Cada chave devolve uma `var(--v-…)`, e os
 * valores de verdade moram em `app/globals.css`, em dois blocos — `:root` (claro) e
 * `[data-theme="dark"]` (escuro).
 *
 * POR QUE ASSIM, e não um objeto por tema trocado em React Context (que é o modelo do
 * seis-sistema, em `lib/theme-context.tsx`):
 *
 *   1. **19 arquivos deste app são SERVER COMPONENTS que leem o tema** — `components/ui.tsx`
 *      e `components/PageHero.tsx` entre eles, que são compartilhados por quase tudo. Server
 *      component não consome Context. O modelo de lá obrigaria a virar os 19 em `'use client'`.
 *   2. Context com um objeto trocado **não elimina o flash**: o servidor renderiza um tema e o
 *      navegador troca depois de hidratar. Com `var()`, o `<html data-theme>` já sai do
 *      servidor com a escolha certa (lida do cookie) e a primeira pintura já é a definitiva.
 *   3. São **3.251 usos de `theme.X`** em 91 arquivos. Nenhum precisou mudar: estilo inline
 *      aceita `var()` como qualquer outro valor de cor.
 *
 * ⚠️ O NOME DA VAR É O NOME DA CHAVE, camelCase e tudo (`borderFaint` → `--v-borderFaint`).
 * Feio para quem espera kebab-case em CSS, e deliberado: chave e variável viram o MESMO
 * símbolo, então a auditoria "todo token tem valor nos dois temas" é um grep, e não existe a
 * classe de defeito em que alguém traduz `accentBg2` para `--v-accent-bg-2` e o token cai em
 * `undefined` — que no CSS não dá erro, só some.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * A PALETA É A DO BRANDBOOK, e o escuro também (pastas `02_Cores` na raiz do projeto).
 *
 * A marca tem CINCO cores — off-white `#FFFDF5` · ink `#111719` · petróleo `#587F88` ·
 * creme `#F5EAC4` · cinza `#757575` — e a prancha "Paleta de cores" (p.76) declara a
 * proporção: **40% off-white · 30% ink · 15% petróleo · 15% creme**.
 *
 * ⚠️ **O modo escuro NÃO é um desvio da identidade.** A prancha "Marca aplicada nas cores"
 * (p.77) mostra o ink como o card GRANDE, dominante, com o wordmark em off-white — os outros
 * quatro fundos aparecem como miniaturas embaixo. O manual do vault diz o mesmo: "o logo
 * funciona sobre os 5 fundos da paleta (preto, petróleo, cinza, creme, branco)". A proporção
 * 40/30 descreve uma composição; no escuro os dois papéis trocam, e a marca publicou os dois
 * lados. O que muda de papel é o ACENTO — ver abaixo.
 *
 * ⚠️ **OS DEGRAUS SÃO OFICIAIS, NÃO INVENTADOS.** A Asoma publicou a paleta estendida: 5 cores
 * × 16 amostras × 2 eixos = 160 valores.
 *
 *     "Sombras"    (p.78) — claro ↔ escuro
 *     "Saturação"  (p.79) — vivo  ↔ dessaturado
 *
 * Cada cor do bloco escuro abaixo traz, em comentário, de qual prancha e de qual degrau saiu.
 * Onde não há degrau oficial, está escrito que é derivação e por quê. **A regra: onde existe
 * degrau na prancha, use o degrau da prancha; onde ela não alcança, derive dentro da família
 * e diga que derivou.** Isso torna o tema auditável contra o brandbook, valor a valor.
 *
 * ⚠️ Não copie a paleta escura do `vesso-aulas`. Ela nasceu antes desta conferência e usa
 * `#171E21`, `#1B2326`, `#222B2F`, `#2A353A`, `#0E1416`, `#7FA5AE` — **nenhum deles está em
 * nenhuma das duas rampas**. São vizinhos plausíveis de degraus oficiais, escolhidos quando a
 * escada já existia. Um deles provavelmente reprova: `text4: '#6E6F6A'` é mais escuro que o
 * cinza oficial, e a grade já reprova o cinza oficial sobre ink.
 *
 * ⚠️ **A GRADE DE CONTRASTE (p.81) É A RÉGUA DE ACEITE, e ela já decide o escuro.** Para fundo
 * `#111719` a matriz aprova TRÊS tintas — creme, off-white e branco — e **risca o petróleo
 * `#587F88` e o cinza `#757575`**. Por isso, no escuro:
 *
 *   · o **creme vira o acento** (o papel que a prancha dá a ele: "realce sobre escuro");
 *   · o **petróleo não sai de cena — ele SOBE na própria rampa** de Sombras, para `#7DA2AA`,
 *     onde volta a passar. O que a grade reprova é o petróleo no valor 0%, não o petróleo;
 *   · o **cinza idem**: `#989898` e `#878787` no lugar do `#757575`.
 *
 * ⚠️ **O ÚNICO TOKEN SEM APOIO NO BRANDBOOK É O `positive`.** Não existe verde na paleta nem
 * em nenhum dos 160 degraus — a rampa clara do petróleo é azulada, não verde. Uma tela de
 * operação precisa distinguir "bateu a meta" de "furou", então o verde é decisão de produto,
 * assumida: a marca não tem uma cor para "deu certo". Está derivado do petróleo, dessaturado,
 * como o resto — mas não finja que veio da prancha.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Substituir a identidade = trocar os dois blocos em `globals.css`. Mantenha as chaves.
 */

const v = (nome: string) => `var(--v-${nome})`

export const theme = {
  // ── Superfícies ─────────────────────────────────────────────────────────────
  //
  // CLARO: uma rampa quente, SEM branco puro. Branco seria a única cor da tela fora da marca
  // — a paleta vai de off-white a ink passando por creme, e esse eixo inteiro é quente; um
  // retângulo branco sobre off-white não lê como papel destacado, lê como furo frio no papel.
  //
  // ESCURO: a mesma ideia, espelhada. O que está EM CIMA recebe mais luz, em vez de menos.
  //
  // ⚠️ Nos DOIS o degrau do cartão é curto de propósito (~2 pontos de luminância). Quem separa
  // cartão de página é o FIO, não o preenchimento — com degrau maior a tela vira um xadrez de
  // retângulos, e são muitos cartões por tela.
  bg: v('bg'),
  panel: v('panel'),
  card: v('card'),
  surface: v('surface'),
  surface2: v('surface2'),
  surface3: v('surface3'),
  surface4: v('surface4'),
  topbar: v('topbar'),

  // ── Bordas ───────────────────────────────────────────────────────────────────
  // Fio quente nos dois temas: no claro, off-white escurecido; no escuro, off-white com alfa.
  // ⚠️ NUNCA cinza frio — é o que faria a tela escura parecer de outra marca.
  borderFaint: v('borderFaint'),
  border: v('border'),
  borderMid: v('borderMid'),
  border2: v('border2'),
  border3: v('border3'),
  borderStrong: v('borderStrong'),
  borderVivid: v('borderVivid'),
  borderBtn: v('borderBtn'),

  // ── Texto ────────────────────────────────────────────────────────────────────
  text: v('text'),
  text2: v('text2'),
  text3: v('text3'),
  text4: v('text4'),

  // ── Acento ───────────────────────────────────────────────────────────────────
  /**
   * Creme oficial da marca.
   * ⚠️ NO CLARO é realce quente pontual; NO ESCURO **ele é o acento**, porque a grade de
   * contraste reprova o petróleo 0% sobre ink. É o papel que a prancha da marca já lhe dá.
   */
  creme: v('creme'),

  /**
   * REALCE — a cor do estado ATIVO (aba selecionada, filtro marcado).
   *
   * ⚠️ No ESCURO os dois viram CREME, e é aí que está a razão de existirem. O brandbook pede
   * petróleo e creme a **15% cada**, e o app estava em 293 usos de petróleo contra 16 de creme
   * — quase 18 para 1. Pior: a grade de contraste (p.81) RISCA o petróleo sobre ink e aprova o
   * creme, cujo papel na prancha é literalmente "realce sobre escuro". O creme tinha o token
   * certo e nenhum uso.
   *
   * ⚠️ Só no REALCE, não em tudo. Trocar `accent` inteiro por creme amarelaria fio, borda,
   * link e ícone em 293 pontos — o acento estrutural continua petróleo (`#7DA2AA`, degrau
   * oficial da rampa de Sombras, ~6,4:1). Creme onde o olho PROCURA o destaque; petróleo onde
   * a cor só desenha estrutura.
   *
   * ⚠️ **São DOIS tokens porque o CLARO não pode mudar.** Lá o estado ativo é ink em uns
   * controles (`estiloAba`, o default de `estiloFiltro`) e petróleo em outros — e os dois
   * convergem para creme só no escuro. Um token só forçaria a escolher, e a escolha mudaria o
   * tema claro em um dos dois grupos.
   */
  realce: v('realce'),
  realceAcento: v('realceAcento'),
  /** Fundo do estado ativo — item de menu selecionado, linha escolhida, opção marcada. */
  realceBg: v('realceBg'),
  realceBg2: v('realceBg2'),
  /**
   * Faixa que AGRUPA linhas numa tabela densa — cabeçalho de especialidade na Progressão,
   * de seção em Resultados, de bloco no CRM.
   *
   * ⚠️ Era `alfa(theme.creme, 40)` cravado em 9 lugares, e o creme a 40% se comporta de
   * forma OPOSTA nos dois temas: sobre off-white é um bege que mal se nota e agrupa; sobre
   * ink é uma barra amarela luminosa que grita mais alto que o dado da tabela. Mesma
   * declaração, efeitos contrários — que é exatamente o que um token existe para resolver.
   */
  faixaGrupo: v('faixaGrupo'),

  accent: v('accent'),
  accentHover: v('accentHover'),
  accentBg: v('accentBg'),
  accentBg2: v('accentBg2'),
  accentBg3: v('accentBg3'),
  accentBg4: v('accentBg4'),
  accentBorder: v('accentBorder'),

  // ── Status ───────────────────────────────────────────────────────────────────
  // Nenhum é semáforo saturado: a prancha de Saturação da marca pede sobriedade.
  positive: v('positive'),
  positiveBg: v('positiveBg'),
  positiveBg2: v('positiveBg2'),
  positiveBg3: v('positiveBg3'),

  warning: v('warning'),
  warningBg: v('warningBg'),
  warningBg2: v('warningBg2'),
  warningBg3: v('warningBg3'),

  negative: v('negative'),
  negativeBg: v('negativeBg'),
  negativeBg2: v('negativeBg2'),
  negativeBg3: v('negativeBg3'),
  negativeBg4: v('negativeBg4'),

  danger: v('danger'),
  dangerBg: v('dangerBg'),

  // ── Institucional / séries de gráfico ────────────────────────────────────────
  verde: v('verde'),
  blue: v('blue'),
  purple: v('purple'),
  coral: v('coral'),

  // ── Superfícies sutis / overlays ─────────────────────────────────────────────
  hoverBg: v('hoverBg'),
  subtleBg: v('subtleBg'),
  overlay: v('overlay'),
  overlay2: v('overlay2'),

  // ── SUPERFÍCIE INVERTIDA ─────────────────────────────────────────────────────
  //
  // ⚠️ Tokens NOVOS, e a razão é o único lugar em que "escuro" não é troca de valor: as peças
  // que já eram ESCURAS no tema claro, de propósito — a faixa de KPIs da home, a metade ink do
  // login, o cartão em destaque do portal.
  //
  // Elas existem porque, no claro, ink sob numeral grande é o que a marca manda (a prancha de
  // contraste reprova off-white sobre petróleo em texto pequeno; sobre ink dá ~15:1). Se
  // ficassem em ink no tema escuro, encostariam na página e o destaque simplesmente sumiria —
  // e sumiria em silêncio, que é o defeito que este projeto persegue.
  //
  // Então elas não seguem `bg`: seguem a PRÓPRIA rampa, que no claro afunda (ink sobre papel)
  // e no escuro sobe (`#28363B`, Sombras ink +12,5%). Em ambos, o texto continua off-white e o
  // acento continua creme — que é exatamente a linha aprovada da grade de contraste.
  //
  // ⚠️ Quem for pintar peça escura NOVA usa estes tokens, não `theme.text`/`theme.bg`
  // invertidos na mão. Foi a mão que produziu os hexes crus que esta rodada recolheu.
  /**
   * Bloco CHEIO em acento — o "Na Trilha" da home, os cards de destaque do brandbook.
   *
   * ⚠️ NÃO é `accent`, e a diferença só aparece no escuro: lá o petróleo SOBE na rampa para
   * poder ser texto (`#7DA2AA`), e um bloco preenchido com esse tom levaria texto off-white
   * sobre fundo claro — ~2:1, ilegível. Como preenchimento ele precisa ir para o outro lado
   * da mesma rampa. Mesma cor da marca, degrau oposto, porque o papel é oposto: aqui ele é
   * FUNDO, não tinta.
   */
  invAccentBg: v('invAccentBg'),
  /** Paradas do gradiente de acento (card em destaque do portal). Ver `invAccentBg`. */
  invAccentGrad1: v('invAccentGrad1'),
  invAccentGrad2: v('invAccentGrad2'),
  invBg: v('invBg'),
  invBg2: v('invBg2'),
  invText: v('invText'),
  invText3: v('invText3'),
  invAccent: v('invAccent'),
  invPositive: v('invPositive'),
  invNegative: v('invNegative'),

  // ── Tipografia ───────────────────────────────────────────────────────────────
  //
  // A prancha da marca é explícita, e a hierarquia NÃO é a convenção usual de app:
  //   Newsreader  → "fonte PRINCIPAL para todo o sistema da Vesso"
  //   Public Sans → "fonte de APOIO para textos e subtítulos"
  //
  // A serifa é a voz; o sans é o suporte. Newsreader carrega o que IDENTIFICA — título de tela
  // e de seção, NOME DE CLIENTE, número de manchete. Public Sans carrega o que DESCREVE —
  // rótulo, metadado, chip, botão e coluna numérica, onde figura tabular importa mais que voz.
  //
  // ⚠️ Não viram `var()`: não mudam com o tema, e passar por variável só acrescentaria uma
  // indireção onde não há escolha a fazer.
  mono: 'var(--font-sans), system-ui, sans-serif',
  sans: 'var(--font-sans), system-ui, sans-serif',
  display: 'var(--font-serif), Georgia, "Times New Roman", serif',
  serif: 'var(--font-serif), Georgia, "Times New Roman", serif',

  // ── Raios / sombra ───────────────────────────────────────────────────────────
  // Canto quase reto: numa ferramenta densa — tudo é caixa dentro de caixa — raio generoso
  // vira gordura. A cápsula (999) fica reservada a RÓTULO; controle usa estes valores.
  // ⚠️ Números, não strings: são usados em aritmética de layout, e `var()` não soma.
  radius: 8,
  radiusSm: 5,
  /** ⚠️ Este É `var()`: no escuro a sombra some — quem eleva é a borda clara, não o preto. */
  shadow: v('shadow'),
} as const

export type Theme = typeof theme

/** Cor do sinaleiro — ver a nota sobre semânticos no topo. */
export const sinaleiroCor = {
  verde: theme.positive,
  amarelo: theme.warning,
  vermelho: theme.negative,
  neutro: theme.text4,
} as const

/**
 * `alfa(cor, pct)` — a MESMA cor, com opacidade.
 *
 * ⚠️ Existe porque o app fazia isso concatenando alfa hexadecimal ao token:
 * `theme.negative + '55'`, `1px solid ${theme.warning}44`. Funcionava enquanto o token era um
 * hex de 6 dígitos — e parou de funcionar quando o tema virou CSS custom property.
 *
 * `'var(--v-negative)' + '55'` é `"var(--v-negative)55"`: CSS inválido. E o navegador
 * **descarta a declaração inteira sem erro nenhum** — a borda simplesmente some. É o defeito
 * que este projeto já registra cinco vezes: a tela carrega, parece certa, e mostra menos do
 * que deveria. Por isso os 43 pontos foram convertidos ANTES de o tema virar variável, com o
 * app ainda claro, para o commit da troca não carregar correção junto.
 *
 * `color-mix` porque é o único jeito de aplicar opacidade a uma `var()` sem saber o valor dela
 * em tempo de escrita — que é justamente o ponto de a cor virar variável.
 *
 * ⚠️ NÃO troque por um token `*Bg` já existente sem medir: os alfas em uso (6,3% · 7,1% ·
 * 7,8% · 20% · 26,7% · 33,3% · 40% · 60%) não coincidem com os degraus fixos da paleta, e
 * "arredondar para o token mais próximo" mudaria a tela em 43 lugares de uma vez.
 */
export function alfa(cor: string, pct: number): string {
  return `color-mix(in srgb, ${cor} ${pct}%, transparent)`
}
