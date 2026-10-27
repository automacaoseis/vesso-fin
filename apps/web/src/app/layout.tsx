import type { Metadata, Viewport } from 'next'
import { Public_Sans, Newsreader } from 'next/font/google'
import './globals.css'
import { APP } from '@/config/app'
import { lerTema } from '@/lib/tema-servidor'
import { atributoTema } from '@/lib/tema'
import { lerDensidade } from '@/lib/densidade-servidor'

const publicSans = Public_Sans({ variable: '--font-sans', subsets: ['latin'], weight: ['400', '500', '600', '700'] })
const newsreader = Newsreader({ variable: '--font-serif', subsets: ['latin'], weight: ['400', '500', '600'], style: ['normal', 'italic'] })

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }
export const metadata: Metadata = { title: { template: `%s · ${APP.nome}`, default: APP.nome }, description: APP.descricao }

// Tema e densidade vêm do cookie no servidor: a primeira pintura já é a definitiva (sem flash).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [tema, densidade] = await Promise.all([lerTema(), lerDensidade()])
  return (
    <html lang="pt-BR" data-theme={atributoTema(tema)} data-densidade={densidade}>
      <body className={`${publicSans.variable} ${newsreader.variable}`}>{children}</body>
    </html>
  )
}
