// Toda consulta roda numa transação "como o usuário":
//   set local role authenticated + request.jwt.claims  →  auth.uid() funciona, a RLS vale, as RPCs checam a ação.
// O login (vesso_fin_api) é NOINHERIT: fora disso não enxerga nada. Funciona no pooler em transaction mode
// porque tudo é LOCAL à transação.
import pg from 'pg'
import type { Claims } from './auth'

// date como texto (o pg converteria para Date no fuso do servidor), numeric e bigint como number.
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(1700, (v) => Number(v))
pg.types.setTypeParser(20, (v) => Number(v))

export type Consulta = <T extends pg.QueryResultRow = Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>

export function criarPool(url: string, ca?: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) })
}

export async function comoUsuario<T>(pool: pg.Pool, claims: Claims, somenteLeitura: boolean, fn: (q: Consulta) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  let quebrada = false
  try {
    await c.query(somenteLeitura ? 'begin read only' : 'begin')
    await c.query(`set local role authenticated`)
    await c.query(`set local statement_timeout = '15s'`)
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify(claims), claims.sub])
    const r = await fn(async (sql, params) => (await c.query(sql, params)).rows)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback').catch(() => { quebrada = true })
    throw e
  } finally {
    c.release(quebrada)
  }
}
