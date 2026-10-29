import type { NextConfig } from 'next'

// O navegador nunca fala com o Supabase (docs/PROMPT.md §2). Variável pública com esse nome é
// erro de configuração — recusa o build em vez de vazar a URL/chave para o bundle.
const proibidas = Object.keys(process.env).filter((k) => k.startsWith('NEXT_PUBLIC_SUPABASE'))
if (proibidas.length) throw new Error(`variáveis proibidas no Vesso FIN: ${proibidas.join(', ')}`)

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pasta de build trocável: permite um 2º servidor de dev (ambiente de teste local) ao lado do principal.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@vesso-fin/shared'],
  // Upload de OFX passa por Server Action (o navegador só fala com este app): até 5 MB + folga.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  // Headers de segurança: os mesmos do vesso-admin (ver os comentários lá), com uma diferença que é
  // o ponto do Vesso FIN: `connect-src 'self'` — sem *.supabase.co, porque nada no navegador fala com ele.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        // ⚠️ Sem `default-src` no enforced: ele é fallback de style/script e o app é estilo inline
        //    (derrubou os dois apps do admin em 25/08/2026). Só diretivas que não herdam.
        { key: 'Content-Security-Policy', value: [
          "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
          "connect-src 'self'",
        ].join('; ') },
        { key: 'Content-Security-Policy-Report-Only', value: [
          "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'",
          "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
        ].join('; ') },
        { key: 'Cache-Control', value: 'private, no-store' },
      ],
    }]
  },
}

export default nextConfig
