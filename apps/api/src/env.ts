import { z } from 'zod'

const Env = z.object({
  DATABASE_URL: z.string().url(),                       // pooler do Supabase (transaction mode), usuário vesso_fin_api
  DATABASE_CA: z.string().optional(),                   // PEM do CA do Supabase (Settings → Database → SSL)
  SUPABASE_URL: z.string().url(),                       // só para o JWKS e o issuer — a API não usa a API REST
  VESSO_SERVICE_SECRET: z.string().min(32),             // o mesmo do apps/web
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(), // pública; só identifica o projeto no Storage (documentos)
  PORT: z.coerce.number().int().default(8080),
})
export type Env = z.infer<typeof Env>

export function lerEnv(fonte: NodeJS.ProcessEnv = process.env): Env {
  const r = Env.safeParse(fonte)
  if (!r.success) throw new Error(`env inválido: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`)
  return r.data
}
