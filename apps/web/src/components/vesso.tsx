'use client'

// Cópia de vesso-admin/src/components/vesso.tsx (29/10/2026): o vocabulário visual da Vesso — botões, campo,
// abas, filtros, toggle, título de seção. Sem NomeCliente (é navegação do admin). Mudou lá? Traga para cá.

import { useEffect, useRef, useState } from 'react'
import { theme, alfa } from '@/lib/theme'
import MarcaApoio from '@/components/MarcaApoio'

/**
 * PRIMITIVOS DA IDENTIDADE VESSO — o vocabulário que a home estabeleceu, extraído para as
 * demais telas usarem sem recriar por aproximação.
 *
 * Enquanto esses padrões viviam dentro de `VisaoCarteiraClient`, cada tela nova os refazia de
 * memória e divergia num detalhe: um raio de 6 em vez de 2, um título em sans, um nome de
 * cliente sem serifa. Divergência de sistema de design nasce assim, não por decisão.
 *
 * As três regras que eles carregam:
 *  1. Newsreader identifica (título, nome próprio); Public Sans descreve (rótulo, metadado).
 *  2. Controle é retângulo de raio pequeno; rótulo é pílula.
 *  3. Tabela é fio sobre o papel — caixa só onde a densidade exige contorno.
 */

/** Ângulos distintos do elemento de apoio. Múltiplos de 120° são quase idênticos entre si —
 *  o desenho é simétrico a cada terço de volta; quem varia a silhueta é o quarto. */
export const GIROS = [0, 90, 180, 270] as const

/**
 * Altura da barra de navegação, em px — para quem precisa de `position: sticky` abaixo dela.
 *
 * ⚠️ Media 104px enquanto o cabeçalho eram DUAS barras (faixa escura + abas). Virou uma só, e
 * os `top: 104 / 112 / 116` espalhados pelas telas passaram a parar ~35px abaixo do header,
 * deixando conteúdo rolar visível na fresta entre os dois. Mora aqui para haver um lugar só
 * quando a barra mudar de altura de novo.
 *
 * Conta: padding 27 + 25, rótulo ~13, gap 7 e o marcador de ativo 2.
 */
export const ALTURA_HEADER = 74

/**
 * Título de seção: elemento de apoio + Newsreader, com o subtítulo embaixo (não ao lado).
 * Substitui a tarja de cabeçalho em sans bold que as telas antigas usam dentro do cartão.
 */
export function TituloSecao({
  titulo, sub, giro = 0, right,
}: {
  titulo: string
  sub?: string
  /** Graus — use 0 / 90 / 180 / 270. */
  giro?: number
  right?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MarcaApoio size={12} rotacao={giro} cor={theme.text4} />
          <span style={{ fontFamily: theme.serif, fontSize: 19, fontWeight: 400, letterSpacing: '-0.01em', color: theme.text }}>
            {titulo}
          </span>
        </div>
        {sub && <div style={{ fontSize: 11.5, color: theme.text4, marginTop: 3 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

/**
 * Botão de filtro. Raio 2, não pílula: a marca reserva a cápsula para RÓTULO (chip de status,
 * botão do newsletter) e usa retângulo de raio pequeno para CONTROLE (o "QUERO CONHECER" do
 * header e o CTA da home). Filtro é controle.
 *
 * Ligado, acende na cor do próprio significado; desligado, fica cinza com fio.
 */
export function estiloFiltro(ativo: boolean, cor: string = theme.realce): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '5px 11px', fontSize: 11.5, fontFamily: 'inherit', lineHeight: 1.5,
    borderRadius: theme.radiusSm, cursor: 'pointer',
    border: `1px solid ${ativo ? alfa(cor, 33.3) : theme.border2}`,
    background: ativo ? alfa(cor, 7.1) : 'transparent',
    color: ativo ? cor : theme.text3,
    fontWeight: ativo ? 700 : 500,
  }
}

/**
 * Aba de texto com sublinhado — a navegação da marca (ativo escuro, inativos cinza), no lugar
 * do grupo segmentado encaixotado. Use dentro de um contêiner com `borderBottom`.
 */
export function estiloAba(ativo: boolean): React.CSSProperties {
  return {
    padding: '6px 2px', fontSize: 12.5, fontFamily: 'inherit',
    fontWeight: ativo ? 700 : 500,
    border: 'none', borderBottom: `2px solid ${ativo ? theme.realce : 'transparent'}`,
    background: 'transparent', cursor: 'pointer',
    color: ativo ? theme.realce : theme.text3,
  }
}

/** Tabela sem caixa: fundo e borda saem, ficam o fio do cabeçalho e as hairlines das linhas. */
export const ESTILO_TABELA: React.CSSProperties = { background: 'transparent', border: 'none', borderRadius: theme.radiusSm }

/** Nome próprio (cliente, colaborador) — Newsreader, porque identifica. */
export function estiloNome(tamanho = 14): React.CSSProperties {
  return {
    fontFamily: theme.serif, fontSize: tamanho, color: theme.text,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }
}

/**
 * Botão primário — INK, não petróleo.
 *
 * ⚠️ Off-white sobre petróleo dá **4,4:1** e a régua WCAG AA para texto pequeno é 4,5:1.
 * Rótulo de botão tem 12–13px, então o par branco-sobre-petróleo que estava espalhado em uma
 * dúzia de telas reprovava por pouco — e "por pouco" num botão é justamente onde se lê pior,
 * porque o texto é curto e não há contexto para adivinhar. Sobre ink o mesmo off-white dá
 * ~15:1. O petróleo continua sendo o acento da marca em aba ativa, marcador e link, onde o
 * corpo é maior ou a cor é do próprio texto sobre papel.
 *
 * Raio pequeno porque botão é CONTROLE — a cápsula da marca é reservada para rótulo.
 */
export function botaoPrimario(desabilitado = false): React.CSSProperties {
  return {
    fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', lineHeight: 1.5,
    padding: '9px 17px', borderRadius: theme.radiusSm, border: 'none',
    background: theme.text, color: theme.bg,
    cursor: desabilitado ? 'not-allowed' : 'pointer', opacity: desabilitado ? 0.45 : 1,
    whiteSpace: 'nowrap',
  }
}

/** Botão secundário — papel com fio, mesmo raio do primário. */
export function botaoSecundario(): React.CSSProperties {
  return {
    fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', lineHeight: 1.5,
    padding: '9px 16px', borderRadius: theme.radiusSm,
    border: `1px solid ${theme.border2}`, background: 'transparent', color: theme.text2,
    cursor: 'pointer', whiteSpace: 'nowrap',
  }
}

/**
 * Campo de entrada (input, select, textarea) — controle, logo raio pequeno.
 *
 * ⚠️ Fundo TRANSPARENTE, não `surface2`. O campo herda a cor de quem o contém e fica definido
 * pelo fio — que é como a marca desenha controle sobre papel. Preenchido com o tom recuado
 * ele virava uma mancha escura dentro do cartão: recuo é o gesto certo para um CONTÊINER
 * (seção, painel), e errado para um controle, que está na mesma camada do papel em que se
 * escreve. Herdar também faz o campo funcionar igual dentro do cartão, do modal e da página,
 * sem precisar de uma variante por fundo.
 */
export const estiloCampo: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
  borderRadius: theme.radiusSm, border: `1px solid ${theme.border2}`,
  background: 'transparent', color: theme.text, outline: 'none',
}

/**
 * Divisor de seção do feed: rótulo curto à esquerda e fio até a margem.
 *
 * Era um rótulo centralizado solto no meio da coluna. Centralizado ele não pertence a nada —
 * a marca ancora rótulo à esquerda e usa o fio para levar o olho até a borda, que é o mesmo
 * gesto do cabeçalho de tabela.
 */
export function DivisorFeed({ children, cor }: { children: React.ReactNode; cor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 0' }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: cor ?? theme.text3, whiteSpace: 'nowrap' }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: cor ? alfa(cor, 20) : theme.borderFaint }} />
    </div>
  )
}

/**
 * TOGGLE de recorte — retângulo, não cápsula.
 *
 * ⚠️ Nasceu dentro do `OVerso` e subiu para cá quando a tela de Mídia passou a usá-lo. Enquanto
 * viveu lá, a Mídia refazia o mesmo controle de memória com pílulas `estiloFiltro`, e as duas
 * telas — que mostram a mesma família de tabela, uma ao lado da outra na nav — falavam
 * dialetos diferentes. A régua da marca é a de sempre: escolher recorte é AÇÃO, e ação é
 * retângulo; cápsula fica para rótulo.
 */
export function Toggle({ ativo, onClick, children, desabilitado, titulo }: {
  ativo: boolean; onClick: () => void; children: React.ReactNode; desabilitado?: boolean; titulo?: string
}) {
  return (
    <button onClick={onClick} disabled={desabilitado} title={titulo}
      style={{
        fontSize: 11.5, padding: '5px 11px', borderRadius: theme.radiusSm,
        cursor: desabilitado ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
        border: `1px solid ${ativo ? theme.accentBorder : theme.border2}`,
        background: desabilitado ? theme.surface2 : ativo ? theme.realceBg2 : theme.surface,
        color: desabilitado ? theme.text4 : ativo ? theme.accent : theme.text2,
        fontWeight: 600,
      }}>
      {children}
    </button>
  )
}

/**
 * Seletor de PERÍODO — rótulo em caixa-alta miúda + select sem cromo.
 *
 * ⚠️ Um `<select>` e não três botões lado a lado. As lentes de período são mutuamente
 * exclusivas e crescem ("Tudo (15)" vira "Tudo (17)" sozinho): em botões, elas ocupam um terço
 * da barra de controles para uma escolha que se faz uma vez por visita. O rótulo fixo é o que
 * permite ao valor ser curto sem virar adivinhação.
 */
export function SeletorPeriodo<T extends string>({ valor, opcoes, onChange }: {
  valor: T; opcoes: { valor: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm, padding: '4px 12px' }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text4 }}>Período</span>
      <select value={valor} onChange={(e) => onChange(e.target.value as T)} aria-label="Período"
        style={{ appearance: 'none', background: 'transparent', border: 'none', color: theme.text2, fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
      </select>
    </label>
  )
}

/**
 * SELETOR MÚLTIPLO em dropdown — "o que aparece na tabela".
 *
 * ⚠️ Nasceu como o "Colunas (14)" do `OVerso` e subiu para cá quando a Mídia precisou do mesmo
 * controle para os blocos do funil. As duas telas ficam a um clique uma da outra e mostram a
 * mesma família de tabela; ter o mesmo controle em duas formas — lá um dropdown à direita, cá
 * quatro botões soltos à esquerda — é o que faz as barras parecerem de apps diferentes.
 *
 * ⚠️ Dropdown e não botões em linha, mesmo com poucos itens. Os itens nascem TODOS ligados (o
 * padrão é ver tudo), e botão ligado é botão preenchido: quatro retângulos em petróleo claro
 * viravam o elemento mais pesado de uma barra que existe para não pesar. Fechado, o dropdown
 * diz o essencial — quantos estão visíveis — em um controle do tamanho dos outros.
 *
 * ⚠️ O último item não desliga: sem isso o filtro vira beco sem saída, com a tela vazia e nada
 * explicando por quê.
 */
export function SeletorMulti({ rotulo, itens, visiveis, onToggle }: {
  rotulo: string
  itens: { chave: string; label: string }[]
  visiveis: Set<string>
  onToggle: (chave: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function fora(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Retângulo: escolher o que aparece é AÇÃO. Cápsula fica para rótulo. */}
      <button onClick={() => setAberto((v) => !v)} aria-haspopup="menu" aria-expanded={aberto}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', fontSize: 11.5, borderRadius: theme.radiusSm, border: `1px solid ${aberto ? theme.accentBorder : theme.border2}`, background: aberto ? theme.accentBg2 : theme.surface, color: theme.text2, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
        {rotulo} ({visiveis.size})
        <span style={{ fontSize: 8, color: theme.text3 }}>▼</span>
      </button>
      {aberto && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 30, minWidth: 220, maxHeight: 340, overflowY: 'auto', background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6 }}>
          {itens.map((it) => {
            const on = visiveis.has(it.chave)
            const ultimo = on && visiveis.size === 1
            return (
              <label key={it.chave}
                title={ultimo ? 'Pelo menos um precisa ficar visível' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, color: ultimo ? theme.text4 : theme.text2, cursor: ultimo ? 'not-allowed' : 'pointer', borderRadius: theme.radiusSm }}>
                <input type="checkbox" checked={on} disabled={ultimo} onChange={() => onToggle(it.chave)} />
                {it.label}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
