'use client'

// Cabeçalho no padrão do vesso-admin (components/Shell.tsx de lá): claro, sem fio embaixo, logo à esquerda,
// nav ao centro em caixa-alta (ativo em `realce` com traço de 2px, inativos em text3) e a conta à direita.
// Só aparece na nav o que já existe — aba "em breve" é ruído numa tela de operação.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { theme } from '@/lib/theme'
import type { Densidade } from '@/lib/densidade'
import type { Tema } from '@/lib/tema'
import AlternarTema from './AlternarTema'
import AlternarDensidade from './AlternarDensidade'
import { ALTURA_HEADER } from './vesso'
import { acaoSair } from '@/app/sair'

export interface OrgResumo { id_org: string; nome: string; tipo: 'cliente' | 'casa' }

const FOLGA = 32

export default function Shell({ orgs, email, tema, densidade, children }: {
  orgs: OrgResumo[]; email: string | null; tema: Tema; densidade: Densidade; children: React.ReactNode
}) {
  const path = usePathname()
  const m = /^\/org\/([^/]+)(?:\/([^/]+))?/.exec(path)
  const orgAtual = m ? orgs.find((o) => o.id_org === m[1]) : undefined
  const largo = m?.[2] === 'conciliacao' || m?.[2] === 'relatorios'
  const largura = largo ? '100%' : 'var(--v-frame)'

  const itens: { href: string; rotulo: string; ativo: boolean }[] = orgAtual
    ? [
        { href: '/', rotulo: 'Organizações', ativo: false },
        { href: `/org/${orgAtual.id_org}/conciliacao`, rotulo: 'Conciliação', ativo: m?.[2] === 'conciliacao' },
        { href: `/org/${orgAtual.id_org}/relatorios`, rotulo: 'Relatórios', ativo: m?.[2] === 'relatorios' },
        { href: '/conexoes', rotulo: 'Conexões', ativo: false },
      ]
    : [
        { href: '/', rotulo: 'Organizações', ativo: path === '/' },
        { href: '/conexoes', rotulo: 'Conexões', ativo: path.startsWith('/conexoes') },
      ]

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: theme.bg }}>
        <div className="v-header-grid" style={{ maxWidth: largura, margin: '0 auto', padding: `0 ${FOLGA}px`, minHeight: ALTURA_HEADER, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 20 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }} aria-label="Vesso Financeiro — início">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/vesso-logo-ink.svg" alt="Vesso" className="f-logo" style={{ height: 24, width: 'auto', flexShrink: 0 }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.text3, paddingLeft: 12, borderLeft: `1px solid ${theme.border2}`, lineHeight: '16px' }}>Financeiro</span>
          </Link>

          <nav aria-label="Seções" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
            {itens.map((i) => (
              <Link key={i.rotulo} href={i.href} aria-current={i.ativo ? 'page' : undefined} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '27px 0 25px',
                fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: i.ativo ? 700 : 500,
                color: i.ativo ? theme.realce : theme.text3, whiteSpace: 'nowrap', textDecoration: 'none',
              }}>
                {i.rotulo}
                <span style={{ display: 'block', height: 2, width: '100%', background: i.ativo ? theme.realce : 'transparent' }} />
              </Link>
            ))}
          </nav>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14 }}>
            <AlternarTema inicial={tema} />
            <Conta email={email} densidade={densidade} />
          </div>
        </div>
      </header>
      <main style={{ maxWidth: largura, margin: '0 auto', padding: largo ? `8px ${FOLGA}px 40px` : `24px ${FOLGA}px 96px` }}>{children}</main>
    </div>
  )
}

function Conta({ email, densidade }: { email: string | null; densidade: Densidade }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])
  const inicial = (email ?? '?').trim().charAt(0).toUpperCase()

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setAberto(!aberto)} aria-expanded={aberto} aria-label="Conta" title={email ?? 'Conta'} style={{
        width: 32, height: 32, borderRadius: '50%', border: `1px solid ${theme.border2}`, background: theme.surface2,
        color: theme.text2, fontSize: 13, fontWeight: 600, fontFamily: theme.display, cursor: 'pointer', display: 'grid', placeItems: 'center',
      }}>{inicial}</button>
      {aberto && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 260, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, boxShadow: '0 8px 24px rgba(17,23,25,.22)', zIndex: 45, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme.borderFaint}` }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>Conectado como</div>
            <div style={{ fontSize: 13, color: theme.text, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email ?? '—'}</div>
          </div>
          <AlternarDensidade inicial={densidade} />
          <form action={acaoSair}>
            <button type="submit" style={{ width: '100%', textAlign: 'left', padding: '11px 14px', fontSize: 13, fontFamily: 'inherit', background: 'transparent', border: 'none', color: theme.text, cursor: 'pointer' }}>Sair</button>
          </form>
        </div>
      )}
    </div>
  )
}
