'use client'

// Seletor do plano de contas com busca (código ou nome) e teclado. Só contas analíticas.
// Equivalente ao DropdownCategoria do seis-sistema, sobre o plano do Vesso FIN.
import { useId, useMemo, useState } from 'react'
import { theme } from '@/lib/theme'
import { campoCompacto } from './fin-ui'

export interface ContaPlano { id_plano_conta: string; codigo: string; nome: string; natureza: string; aceita_lancamento: boolean; regra_competencia: string; generica: boolean; ativa?: boolean }

export default function SeletorPlano({ plano, valor, onEscolher, autoFocus, placeholder = 'Buscar conta por código ou nome', largura = '100%' }: {
  plano: ContaPlano[]; valor: string | null; onEscolher: (c: ContaPlano) => void; autoFocus?: boolean; placeholder?: string; largura?: number | string
}) {
  const idLista = useId()
  const atual = plano.find((p) => p.id_plano_conta === valor)
  const [q, setQ] = useState('')
  const [aberto, setAberto] = useState(false)
  const [idx, setIdx] = useState(0)
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    // conta desativada (0012) some do seletor; o que já foi lançado nela continua mostrando o nome
    return plano.filter((p) => p.aceita_lancamento && p.ativa !== false && (!t || `${p.codigo} ${p.nome}`.toLowerCase().includes(t))).slice(0, 60)
  }, [plano, q])
  const escolher = (p: ContaPlano) => { onEscolher(p); setQ(''); setAberto(false) }
  return (
    <div style={{ position: 'relative', width: largura }}>
      <input value={aberto ? q : atual ? `${atual.codigo} ${atual.nome}` : ''} placeholder={placeholder} autoFocus={autoFocus}
        onFocus={() => { setAberto(true); setIdx(0) }} onBlur={() => setTimeout(() => setAberto(false), 120)}
        onChange={(e) => { setQ(e.target.value); setIdx(0); setAberto(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(lista.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && aberto && lista[idx]) { e.preventDefault(); escolher(lista[idx]!) }
          else if (e.key === 'Escape' && aberto) { e.stopPropagation(); setAberto(false) }
        }}
        role="combobox" aria-expanded={aberto} aria-controls={idLista} aria-label="Conta do plano"
        style={{ ...campoCompacto, width: '100%', padding: '8px 11px', fontSize: 13 }} />
      {aberto && (
        <div id={idLista} role="listbox" style={{ position: 'absolute', zIndex: 80, left: 0, right: 0, top: 'calc(100% + 4px)', maxHeight: 260, overflowY: 'auto', background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, boxShadow: '0 8px 24px rgba(17,23,25,.22)' }}>
          {lista.map((p, i) => (
            <div key={p.id_plano_conta} role="option" aria-selected={i === idx} onMouseDown={(e) => { e.preventDefault(); escolher(p) }}
              style={{ padding: '6px 10px', fontSize: 12.5, cursor: 'pointer', display: 'flex', gap: 10, background: i === idx ? theme.realceBg2 : 'transparent' }}>
              <span style={{ color: theme.text3, minWidth: 54, fontVariantNumeric: 'tabular-nums' }}>{p.codigo}</span>
              <span style={{ flex: 1 }}>{p.nome}</span>
              {p.generica && <span style={{ color: theme.warning, fontSize: 11 }}>genérica</span>}
            </div>
          ))}
          {lista.length === 0 && <div style={{ padding: 10, fontSize: 12, color: theme.text3 }}>Nenhuma conta.</div>}
        </div>
      )}
    </div>
  )
}
