import { serve } from '@hono/node-server'
import { criarApp } from './app'
import { verificadorSupabase } from './auth'
import { criarPool } from './db'
import { lerEnv } from './env'

const env = lerEnv()
const pool = criarPool(env.DATABASE_URL, env.DATABASE_CA)
const app = criarApp({ pool, verificarToken: verificadorSupabase(env.SUPABASE_URL), segredoServico: env.VESSO_SERVICE_SECRET })

const server = serve({ fetch: app.fetch, port: env.PORT }, (i) => console.log(JSON.stringify({ nivel: 'info', msg: 'api no ar', porta: i.port })))
for (const sinal of ['SIGTERM', 'SIGINT'] as const)
  process.on(sinal, () => server.close(() => pool.end().then(() => process.exit(0))))
