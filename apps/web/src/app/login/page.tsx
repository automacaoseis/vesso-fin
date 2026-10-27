import type { Metadata } from 'next'
import { APP } from '@/config/app'
import { theme } from '@/lib/theme'
import FormLogin from './FormLogin'

export const metadata: Metadata = { title: 'Entrar' }

export default async function Login({ searchParams }: { searchParams: Promise<{ volta?: string }> }) {
  const { volta } = await searchParams
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: theme.bg, padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ fontFamily: theme.display, fontSize: 30, fontWeight: 500, color: theme.text, marginBottom: 4 }}>{APP.nome}</div>
        <div style={{ fontSize: 13, color: theme.text2, marginBottom: 24 }}>{APP.descricao}</div>
        <FormLogin volta={volta ?? ''} />
      </div>
    </main>
  )
}
