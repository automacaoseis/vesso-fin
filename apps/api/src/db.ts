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

// Raiz pública do Supabase ("Supabase Root 2021 CA", válida até 26/04/2031) — a mesma do certificado que o painel
// oferece em Settings → Database → SSL. Fica no código para a conexão nunca depender de colar um PEM numa variável:
// em 29/10/2026 um DATABASE_CA mal colado derrubou o TLS sem deixar rastro no log do pooler.
export const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`

/** TLS verificado sempre que o host é do Supabase. DATABASE_CA (opcional) soma uma raiz extra; se não for PEM, é ignorado. */
export function criarPool(url: string, caExtra?: string, log: (l: Record<string, unknown>) => void = (l) => console.log(JSON.stringify(l))): pg.Pool {
  const host = new URL(url).hostname
  const supabase = /\.supabase\.(com|co)$/.test(host)
  const extra = caExtra?.includes('-----BEGIN CERTIFICATE-----') ? [caExtra] : []
  if (caExtra && !extra.length) log({ nivel: 'aviso', msg: 'DATABASE_CA não é um certificado PEM; ignorado (a raiz do Supabase já vem no código)' })
  const ssl = supabase || extra.length ? { ssl: { ca: [SUPABASE_ROOT_CA, ...extra], rejectUnauthorized: true, servername: host } } : {}
  return new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, ...ssl })
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
