import React from 'react'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'

// Fork enxuto de vesso-admin/src/components/ui.tsx: sem StatCard/Thumb/SinalDot/FunilBadge (tráfego),
// e sem text4 (ver lib/fin.ts).

/** Card branco (usado em tabelas / gráficos). */
export function Card({ children, style, pad = 20, className }: { children: React.ReactNode; style?: React.CSSProperties; pad?: number; className?: string }) {
  return (
    // borda em longhand de propósito: quem usa o Card sobrescreve só o borderColor
    // (ex.: post fixado na Trilha). Misturar o shorthand `border` com o longhand faz o
    // React avisar quando o override some no rerender.
    // `className` existe para a camada responsiva (globals.css): o app é todo estilo
    // inline, e inline não faz media query — quem depende de largura precisa de classe.
    <div className={className} style={{ background: theme.surface, borderWidth: 1, borderStyle: 'solid', borderColor: theme.border, borderRadius: theme.radius, boxShadow: theme.shadow, padding: pad, ...style }}>
      {children}
    </div>
  )
}

/**
 * Card-filtro clicável dos painéis (contador grande + faixa lateral colorida): clicar liga
 * ou desliga aquele filtro na tabela abaixo.
 *
 * Bordas em longhand pelo mesmo motivo do `Card` acima — a faixa esquerda tem cor própria e
 * as outras três mudam quando o card vira o filtro ativo. Misturar o shorthand `border` com
 * `borderLeft` faz o React avisar a cada troca de filtro.
 */
export function estiloCardFiltro(ativo: boolean, cor: string): React.CSSProperties {
  const b = `1px solid ${ativo ? theme.borderVivid : theme.border}`
  return {
    textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
    background: ativo ? theme.surface2 : theme.card,
    borderTop: b, borderRight: b, borderBottom: b,
    borderLeft: `3px solid ${cor}`,
    // Raio da marca: o card é CONTROLE (clicar liga o filtro), e controle é retângulo de
    // raio pequeno. Estava em 8, herdado da direção anterior.
    borderRadius: theme.radiusSm, padding: '15px 16px',
  }
}

/** Chevron para cabeçalhos de seção (estático, apontando pra baixo). */
function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={f.mutedText} strokeWidth="2.5" style={{ flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * Cabeçalho de seção no estilo do Nível Seis: chevron + rótulo caixa-alta com
 * tracking. `dot` desenha um ponto colorido (subseções de canal, ex. Meta/Google).
 */
export function Secao({ titulo, dot, right, children, sub }: { titulo: string; dot?: string; right?: React.ReactNode; children?: React.ReactNode; sub?: string }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Chevron />
          {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
          <span style={{ fontSize: dot ? 12 : 11, fontWeight: 600, letterSpacing: dot ? '0' : '.12em', textTransform: dot ? 'none' : 'uppercase', color: dot ? theme.text2 : theme.text3 }}>
            {titulo}
          </span>
          {sub && <span style={{ fontSize: 11, color: f.mutedText, fontFamily: theme.mono, marginLeft: 4 }}>{sub}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

/** Grid responsivo de cards. */
export function CardGrid({ children, min = 240 }: { children: React.ReactNode; min?: number }) {
  // auto-fill (não auto-fit): mantém a largura da coluna constante entre seções —
  // a seção com menos cards deixa espaço à direita em vez de esticar os cards.
  // min 240 → ~4 colunas no container do painel (seções de 4 preenchem a linha).
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 14 }}>{children}</div>
}

/** Cabeçalho simples de página (abas que não são o Painel). */
export function PageHeader({ titulo, descricao, right }: { titulo: string; descricao?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: theme.text }}>{titulo}</h1>
        {descricao && <p style={{ fontSize: 13, color: theme.text3, margin: '4px 0 0' }}>{descricao}</p>}
      </div>
      {right}
    </div>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card style={{ textAlign: 'center', padding: '48px 24px' }}>
      <p style={{ fontSize: 14, color: theme.text3, margin: 0 }}>{children}</p>
    </Card>
  )
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: theme.text }}>{children}</h2>
      {right}
    </div>
  )
}
