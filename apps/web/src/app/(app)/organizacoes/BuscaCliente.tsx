'use client'

import { useEffect, useState } from 'react'
import { theme } from '@/lib/theme'
import { estiloCampo } from '@/components/vesso'
import { buscarClientes, type ClienteBusca } from './acoes'

/** Busca no cadastro de clientes do portal (app_seis.clientes) — quem já tem organização aparece, mas não dá para escolher. */
export default function BuscaCliente({ valor, onEscolher }: { valor: ClienteBusca | null; onEscolher: (c: ClienteBusca | null) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ClienteBusca[]>([])
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    if (q.trim().length < 2) return
    let vivo = true
    const t = setTimeout(async () => {
      const r = await buscarClientes(q)
      if (!vivo) return
      if (r.ok) { setRes(r.dados); setErro(null) } else setErro(r.mensagem)
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [q])

  const lista = q.trim().length < 2 ? [] : res
  if (valor) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, ...estiloCampo }}>
      <span>{valor.nome}</span>
      <button type="button" onClick={() => onEscolher(null)} style={{ background: 'none', border: 0, color: theme.accent, cursor: 'pointer', fontSize: 12 }}>trocar</button>
    </div>
  )
  return (
    <div style={{ position: 'relative' }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pelo nome do cliente no portal" aria-label="Cliente do portal" style={estiloCampo} />
      {(lista.length > 0 || erro) && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: theme.surface, border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm, boxShadow: theme.shadow, maxHeight: 260, overflowY: 'auto' }}>
          {erro && <div style={{ padding: 10, fontSize: 12, color: theme.negative }}>{erro}</div>}
          {lista.map((c) => (
            <button key={c.id_cliente} type="button" role="option" aria-selected={false} disabled={!!c.id_org} onClick={() => { onEscolher(c); setQ(''); setRes([]) }}
              style={{ display: 'flex', justifyContent: 'space-between', width: '100%', textAlign: 'left', gap: 10, padding: '9px 12px', border: 0, borderBottom: `1px solid ${theme.borderFaint}`,
                background: 'transparent', cursor: c.id_org ? 'not-allowed' : 'pointer', fontSize: 13, color: c.id_org ? theme.text3 : theme.text, fontFamily: 'inherit' }}>
              <span>{c.nome}</span>{c.organizacao && <span style={{ fontSize: 11 }}>já é {c.organizacao}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
