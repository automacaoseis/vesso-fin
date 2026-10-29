'use client'

import { useEffect } from 'react'
import { theme } from '@/lib/theme'

/** Moldura de modal no padrão do admin: cartão, título em serifa, Esc e clique fora fecham. */
export default function Modal({ titulo, sub, onFechar, children, largura = 560 }: {
  titulo: string; sub?: React.ReactNode; onFechar: () => void; children: React.ReactNode; largura?: number
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onFechar])
  return (
    <div role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(17,23,25,.45)', display: 'grid', placeItems: 'start center', paddingTop: '8vh' }}>
      <div role="dialog" aria-modal="true" aria-label={titulo} style={{
        width: `min(${largura}px, calc(100vw - 32px))`, maxHeight: '84vh', display: 'flex', flexDirection: 'column',
        background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radius, boxShadow: '0 16px 48px rgba(17,23,25,.3)',
      }}>
        <div style={{ padding: '20px 24px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, borderBottom: `1px solid ${theme.borderFaint}` }}>
          <div>
            <div style={{ fontFamily: theme.display, fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{titulo}</div>
            {sub && <div style={{ fontSize: 12, color: theme.text3, marginTop: 4 }}>{sub}</div>}
          </div>
          <button onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: theme.text3, cursor: 'pointer', padding: 2 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  )
}
