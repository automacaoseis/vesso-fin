'use client'

import React from 'react'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'

/**
 * Peças de tabela compartilhadas pelas telas de análise (criativo a criativo e
 * cliente a cliente). Ficam aqui porque as duas famílias de tela usam a mesma
 * densidade, a mesma ordenação por cabeçalho e o mesmo rodapé de paginação —
 * duplicar significaria ajustar densidade em dois lugares.
 */

export function Th({ children, onClick, ativo, dir, num }: {
  children?: React.ReactNode; onClick?: () => void; ativo?: boolean; dir?: 'asc' | 'desc'; num?: boolean
}) {
  return (
    <th onClick={onClick} style={{
      padding: '6px 8px', textAlign: num ? 'right' : 'left', fontSize: 10, fontWeight: 600,
      letterSpacing: '.05em', textTransform: 'uppercase',
      color: ativo ? f.accentText : f.mutedText, background: theme.surface2,
      cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none',
    }}>
      {children}{ativo && (dir === 'asc' ? ' ↑' : ' ↓')}
    </th>
  )
}

export function Td({ children, num, denso }: { children?: React.ReactNode; num?: boolean; denso?: boolean }) {
  return (
    <td style={{
      // `denso` é para tabelas sem miniatura, onde a altura da linha é só texto e dá para
      // apertar sem os números encostarem.
      padding: denso ? '3px 8px' : '5px 8px',
      textAlign: num ? 'right' : 'left', color: theme.text2,
      verticalAlign: 'middle', whiteSpace: num ? 'nowrap' : undefined,
      lineHeight: denso ? 1.25 : undefined,
    }}>
      {children}
    </td>
  )
}

/**
 * Rodapé de paginação: "1–25 de 69" à esquerda, números à direita. Com muitas páginas
 * mostra uma janela deslizante de 5 em volta da atual (mais as pontas), para a barra não
 * virar uma fileira de 30 botões.
 */
export function Paginacao({ total, inicio, mostrando, pagina, totalPaginas, onIr }: {
  total: number; inicio: number; mostrando: number
  pagina: number; totalPaginas: number; onIr: (p: number) => void
}) {
  const janela: (number | '…')[] = []
  const de = Math.max(0, Math.min(pagina - 2, totalPaginas - 5))
  const ate = Math.min(totalPaginas - 1, Math.max(pagina + 2, 4))
  if (de > 0) janela.push(0)
  if (de > 1) janela.push('…')
  for (let i = de; i <= ate; i++) janela.push(i)
  if (ate < totalPaginas - 2) janela.push('…')
  if (ate < totalPaginas - 1) janela.push(totalPaginas - 1)

  const btn = (ativo: boolean): React.CSSProperties => ({
    minWidth: 24, height: 24, padding: '0 6px', fontSize: 10.5, fontFamily: 'inherit',
    borderRadius: theme.radiusSm, cursor: 'pointer', lineHeight: 1,
    background: ativo ? theme.realceBg : 'transparent',
    border: `1px solid ${ativo ? theme.accentBorder : theme.border}`,
    color: ativo ? theme.accent : theme.text3,
  })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      flexWrap: 'wrap', padding: '8px 12px', borderTop: `1px solid ${theme.borderFaint}`,
    }}>
      <span style={{ fontSize: 10.5, color: f.mutedText, fontVariantNumeric: 'tabular-nums' }}>
        {inicio + 1}–{inicio + mostrando} de {total}
      </span>
      {totalPaginas > 1 && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => onIr(pagina - 1)} disabled={pagina === 0}
            style={{ ...btn(false), opacity: pagina === 0 ? 0.4 : 1, cursor: pagina === 0 ? 'default' : 'pointer' }}>‹</button>
          {janela.map((p, i) =>
            p === '…'
              ? <span key={`e${i}`} style={{ fontSize: 10.5, color: f.mutedText, padding: '0 2px' }}>…</span>
              : <button key={p} onClick={() => onIr(p)} style={btn(p === pagina)}>{p + 1}</button>
          )}
          <button onClick={() => onIr(pagina + 1)} disabled={pagina >= totalPaginas - 1}
            style={{ ...btn(false), opacity: pagina >= totalPaginas - 1 ? 0.4 : 1, cursor: pagina >= totalPaginas - 1 ? 'default' : 'pointer' }}>›</button>
        </div>
      )}
    </div>
  )
}
