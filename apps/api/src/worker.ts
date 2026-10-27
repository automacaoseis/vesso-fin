// Entrypoint do worker (mesmo pacote da API, outro processo na Railway).
// Login vesso_fin_worker: escreve SÓ bronze, prata e jobs. service_role não existe aqui.
import pg from 'pg'
import { z } from 'zod'
import { criarPool } from './db'
import { destravar, rodarUm } from './worker/fila'

const env = z.object({
  DATABASE_URL_WORKER: z.string().url(),
  DATABASE_CA: z.string().optional(),
  INTERVALO_MS: z.coerce.number().int().min(200).default(2000),
}).parse(process.env)

const pool: pg.Pool = criarPool(env.DATABASE_URL_WORKER, env.DATABASE_CA)
const log = (l: Record<string, unknown>) => console.log(JSON.stringify({ ...l, em: new Date().toISOString() }))
let parar = false
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, () => { parar = true })

log({ nivel: 'info', msg: 'worker no ar' })
let ultimaVarredura = 0
while (!parar) {
  try {
    if (Date.now() - ultimaVarredura > 60_000) {
      const n = await destravar(pool)
      if (n) log({ nivel: 'aviso', msg: 'jobs travados devolvidos à fila', n })
      ultimaVarredura = Date.now()
    }
    // esvazia a fila; dorme só quando não há nada
    while (!parar && (await rodarUm(pool, log)));
  } catch (e) {
    log({ nivel: 'erro', msg: 'laço do worker', erro: e instanceof Error ? e.message : String(e) })
  }
  if (!parar) await new Promise((r) => setTimeout(r, env.INTERVALO_MS))
}
await pool.end()
log({ nivel: 'info', msg: 'worker parou' })
