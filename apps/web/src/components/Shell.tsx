'use client'

// Fork enxuto do Shell do vesso-admin: mesma barra (logo · nav centrada · conta), sem a nav de tráfego.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'
import type { Densidade } from '@/lib/densidade'
import type { Tema } from '@/lib/tema'
import AlternarTema from './AlternarTema'
import AlternarDensidade from './AlternarDensidade'
import { acaoSair } from '@/app/sair'

export interface OrgResumo { id_org: string; nome: string; tipo: 'cliente' | 'casa' }

const ABAS = [
  { seg: 'conciliacao', rotulo: 'Conciliação', pronta: true },
  { seg: 'lancamentos', rotulo: 'Lançamentos', pronta: false },
  { seg: 'relatorios', rotulo: 'Relatórios', pronta: false },
  { seg: 'fechamento', rotulo: 'Fechamento', pronta: false },
]

export default function Shell({ orgs, email, tema, densidade, children }: {
  orgs: OrgResumo[]; email: string | null; tema: Tema; densidade: Densidade; children: React.ReactNode
}) {
  const path = usePathname()
  const router = useRouter()
  const m = /^\/org\/([^/]+)(?:\/([^/]+))?/.exec(path)
  const orgAtual = m ? orgs.find((o) => o.id_org === m[1]) : undefined
  const largo = m?.[2] === 'conciliacao'
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [menu])

  const largura = largo ? '100%' : 'var(--v-frame)'
  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: theme.bg, borderBottom: `1px solid ${theme.borderFaint}` }}>
        <div className="v-header-grid" style={{ maxWidth: largura, margin: '0 auto', padding: '0 24px', height: 52, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: theme.text }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/vesso-logo-ink.svg" alt="Vesso" className="f-logo" style={{ height: 20, width: 'auto' }} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', color: f.accentText }}>FIN</span>
            </Link>
            {orgs.length > 0 && (
              <select aria-label="Organização" value={orgAtual?.id_org ?? ''}
                onChange={(e) => e.target.value && router.push(`/org/${e.target.value}/${m?.[2] ?? 'conciliacao'}`)}
                style={{ maxWidth: 240, fontSize: 13, fontFamily: theme.display, padding: '4px 6px', background: 'transparent', color: theme.text, border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm }}>
                <option value="">Organizações…</option>
                {orgs.map((o) => <option key={o.id_org} value={o.id_org}>{o.nome}{o.tipo === 'casa' ? ' (casa)' : ''}</option>)}
              </select>
            )}
          </div>

          <nav style={{ display: 'flex', gap: 22, alignItems: 'center' }} aria-label="Seções">
            {!orgAtual && (
              <Link href="/conexoes" aria-current={path === '/conexoes' ? 'page' : undefined}
                style={{ fontSize: 13, fontWeight: path === '/conexoes' ? 600 : 400, color: path === '/conexoes' ? f.accentText : theme.text2, textDecoration: 'none', borderBottom: path === '/conexoes' ? `2px solid ${f.accentText}` : '2px solid transparent', paddingBottom: 2 }}>
                Conexões
              </Link>
            )}
            {orgAtual && ABAS.map((a) => {
              const ativa = m?.[2] === a.seg
              if (!a.pronta) return <span key={a.seg} title="Ainda não construída" style={{ fontSize: 13, color: f.mutedText, opacity: .6 }}>{a.rotulo}</span>
              return (
                <Link key={a.seg} href={`/org/${orgAtual.id_org}/${a.seg}`} aria-current={ativa ? 'page' : undefined}
                  style={{ fontSize: 13, fontWeight: ativa ? 600 : 400, color: ativa ? f.accentText : theme.text2, textDecoration: 'none', borderBottom: ativa ? `2px solid ${f.accentText}` : '2px solid transparent', paddingBottom: 2 }}>
                  {a.rotulo}
                </Link>
              )
            })}
          </nav>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
            <AlternarTema inicial={tema} />
            <div ref={ref} style={{ position: 'relative' }}>
              <button onClick={() => setMenu(!menu)} aria-expanded={menu}
                style={{ fontSize: 12, padding: '4px 8px', background: 'transparent', border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm, color: theme.text2, cursor: 'pointer', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {email ?? 'Conta'}
              </button>
              {menu && (
                <div style={{ position: 'absolute', right: 0, top: '110%', width: 240, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, boxShadow: '0 8px 24px rgba(17,23,25,.22)', zIndex: 45 }}>
                  <AlternarDensidade inicial={densidade} />
                  <form action={acaoSair}>
                    <button type="submit" style={{ width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 13, background: 'transparent', border: 'none', color: theme.text, cursor: 'pointer' }}>Sair</button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main style={{ maxWidth: largura, margin: '0 auto', padding: largo ? '16px 24px 24px' : '32px 24px 64px' }}>{children}</main>
    </div>
  )
}
