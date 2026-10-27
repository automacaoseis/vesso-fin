import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * REGRA DE SEGURANÇA (docs/PROMPT.md §2, bloqueia merge): o navegador NUNCA fala com *.supabase.co.
 * - nada de @supabase/* no apps/web — nem no servidor: o login fala com o Auth por fetch numa Server
 *   Action (lib/sessao.ts), e os dados vêm da API do Vesso FIN;
 * - nada de NEXT_PUBLIC_SUPABASE_* (o next.config.ts também recusa o build se existir);
 * - lib/api.ts e lib/sessao.ts importam 'server-only': um Client Component que os importe quebra o build.
 */
const semSupabase = {
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{ group: ['@supabase/*'], message: 'Vesso FIN não usa Supabase no web: dados pela API, login por lib/sessao.ts.' }],
    }],
    'no-restricted-syntax': ['error',
      { selector: "MemberExpression[property.name=/^NEXT_PUBLIC_SUPABASE/]", message: 'NEXT_PUBLIC_SUPABASE_* é proibido no Vesso FIN.' },
      { selector: "Literal[value=/supabase\\.co/]", message: 'URL do Supabase no código do web — o navegador não pode ver isso. Use env de servidor.' },
    ],
  },
}

const config = [
  ...coreWebVitals,
  ...typescript,
  semSupabase,
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
]

export default config
