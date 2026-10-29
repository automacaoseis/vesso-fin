// Peças de tela do Vesso FIN montadas SOBRE o vocabulário do vesso-admin (components/vesso.tsx).
// Nada de cor ou raio novo aqui: só tamanhos compactos para telas de operação densas.
import React from 'react'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloCampo } from './vesso'

/** Botões do admin em tamanho de barra de ferramentas (o admin faz o mesmo override no AcessosPortal). */
export const botaoPrimarioCompacto = (desabilitado = false): React.CSSProperties => ({ ...botaoPrimario(desabilitado), padding: '6px 13px', fontSize: 12 })
export const botaoSecundarioCompacto = (desabilitado = false): React.CSSProperties => ({
  ...botaoSecundario(), padding: '6px 12px', fontSize: 12,
  opacity: desabilitado ? 0.45 : 1, cursor: desabilitado ? 'not-allowed' : 'pointer',
})
export const campoCompacto: React.CSSProperties = { ...estiloCampo, width: 'auto', padding: '6px 10px', fontSize: 12.5 }

/** Rótulo de seção — caixa-alta miúda do admin (DivisorFeed, rótulos do login). */
export function RotuloSecao({ children, direita }: { children: React.ReactNode; direita?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${theme.borderFaint}` }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>{children}</span>
      {direita}
    </div>
  )
}

/** Painel = o cartão do admin (papel, fio, raio, sombra) sem preenchimento interno. */
export function Painel({ children, style, rotulo, direita, 'aria-label': ariaLabel }: { children: React.ReactNode; style?: React.CSSProperties; rotulo?: React.ReactNode; direita?: React.ReactNode; 'aria-label'?: string }) {
  return (
    <section aria-label={ariaLabel} style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radius, boxShadow: theme.shadow, overflow: 'hidden', ...style }}>
      {rotulo && <RotuloSecao direita={direita}>{rotulo}</RotuloSecao>}
      {children}
    </section>
  )
}

/** Rótulo de campo de formulário (o mesmo do login). */
export function CampoRotulado({ rotulo, extra, children }: { rotulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>
        {rotulo}{extra && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, marginLeft: 6 }}>{extra}</span>}
      </span>
      {children}
    </label>
  )
}

/** Aviso flutuante — superfície invertida (escura nos dois temas), como os blocos ink do admin. */
export function Aviso({ tipo, children }: { tipo: 'ok' | 'erro'; children: React.ReactNode }) {
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 60, maxWidth: 560,
      padding: '10px 16px', fontSize: 13, borderRadius: theme.radiusSm, background: theme.invBg, color: theme.invText,
      boxShadow: '0 8px 24px rgba(17,23,25,.22)', display: 'flex', gap: 8, alignItems: 'baseline',
    }}>
      <span aria-hidden style={{ color: tipo === 'erro' ? theme.negative : theme.creme }}>{tipo === 'erro' ? '▲' : '✓'}</span>
      <span>{children}</span>
    </div>
  )
}
