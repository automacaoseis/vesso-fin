import type { Metadata } from 'next'
import LoginClient from './LoginClient'

export const metadata: Metadata = { title: 'Entrar' }

export default async function Login({ searchParams }: { searchParams: Promise<{ volta?: string }> }) {
  const { volta } = await searchParams
  return <LoginClient volta={volta ?? ''} />
}
