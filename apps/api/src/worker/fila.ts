// Fila em Postgres (bpo_fin.fila_jobs): SELECT … FOR UPDATE SKIP LOCKED, sem Redis.
// Cada job roda na sua transação; erro transitório volta para a fila com espera crescente,
// erro permanente (arquivo ruim, conta errada) falha na hora e fica visível em Conexões.
import type pg from 'pg'
import { ErroPermanente, processarExtrato } from './processar-extrato'
import { syncAsaas } from './sync-asaas'

export const TIPOS_SUPORTADOS = ['processar_extrato', 'sync_asaas'] as const
const MAX_TENTATIVAS = 3
const TRAVADO_MIN = 10

export type Log = (l: Record<string, unknown>) => void

interface Job { id_job: number; tipo: string; id_org: string | null; payload: any; tentativas: number }

/** Pega e executa UM job. Devolve false se a fila está vazia. */
export async function rodarUm(pool: pg.Pool, log: Log): Promise<boolean> {
  const c = await pool.connect()
  try {
    const { rows: [job] } = await c.query<Job>(
      `update bpo_fin.fila_jobs j set status = 'rodando', iniciado_em = now(), tentativas = j.tentativas + 1
        where j.id_job = (select id_job from bpo_fin.fila_jobs
                           where status = 'pendente' and agendado_para <= now() and tipo = any($1::text[])
                           order by agendado_para, id_job for update skip locked limit 1)
        returning j.id_job, j.tipo, j.id_org, j.payload, j.tentativas`, [TIPOS_SUPORTADOS])
    if (!job) return false
    const inicio = Date.now()
    try {
      const r = await executar(pool, c, job)
      await c.query(`update bpo_fin.fila_jobs set status = 'ok', terminado_em = now(), erro_msg = null where id_job = $1`, [job.id_job])
      log({ nivel: 'info', job: job.id_job, tipo: job.tipo, ms: Date.now() - inicio, resultado: r })
    } catch (e) {
      await falhou(c, job, e, log)
    }
    return true
  } finally {
    c.release()
  }
}

// Cada executor cuida da própria transação: o do Asaas faz rede ANTES de abrir a sua (não prende
// conexão do pooler esperando a API). Se o worker morrer entre gravar e marcar 'ok', o job volta
// pela destravar() e roda de novo — os dois executores são idempotentes.
async function executar(pool: pg.Pool, c: pg.PoolClient, job: Job) {
  if (job.tipo === 'processar_extrato') {
    if (typeof job.payload?.id_extrato !== 'string') throw new ErroPermanente('job sem id_extrato')
    await c.query('begin')
    try {
      const r = await processarExtrato(c, job.payload.id_extrato)
      await c.query('commit')
      return r
    } catch (e) { await c.query('rollback').catch(() => {}); throw e }
  }
  if (job.tipo === 'sync_asaas') {
    if (typeof job.payload?.id_conexao !== 'string') throw new ErroPermanente('job sem id_conexao')
    return syncAsaas(pool, job.payload.id_conexao)
  }
  throw new ErroPermanente(`tipo de job sem executor: ${job.tipo}`)
}

async function falhou(c: pg.ClientBase, job: Job, e: unknown, log: Log) {
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 1000)
  const definitivo = e instanceof ErroPermanente || job.tentativas >= MAX_TENTATIVAS
  log({ nivel: 'erro', job: job.id_job, tipo: job.tipo, tentativa: job.tentativas, definitivo, erro: msg })
  await c.query(
    `update bpo_fin.fila_jobs set status = $2, erro_msg = $3, terminado_em = case when $2 = 'erro' then now() end,
            agendado_para = case when $2 = 'pendente' then now() + make_interval(mins => power(2, tentativas)::int) else agendado_para end
      where id_job = $1`, [job.id_job, definitivo ? 'erro' : 'pendente', msg])
  if (definitivo && job.tipo === 'sync_asaas' && job.payload?.id_conexao)
    await c.query(`update bpo_fin.conexoes set status = 'erro', erro_msg = $2 where id_conexao = $1`, [job.payload.id_conexao, msg])
  if (definitivo && job.tipo === 'processar_extrato' && job.payload?.id_extrato) {
    await c.query(`update bpo_fin.extratos set status = 'erro', erro_msg = $2 where id_extrato = $1`, [job.payload.id_extrato, msg])
    await c.query(
      `update bpo_fin.conexoes set status = 'erro', erro_msg = $2
        where id_conexao = (select id_conexao from bpo_fin.extratos where id_extrato = $1)`, [job.payload.id_extrato, msg])
  }
}

/** Job "rodando" há mais de 10 min = worker morreu no meio. Volta para a fila. */
export async function destravar(pool: pg.Pool): Promise<number> {
  const r = await pool.query(
    `update bpo_fin.fila_jobs set status = 'pendente', agendado_para = now()
      where status = 'rodando' and iniciado_em < now() - make_interval(mins => $1)`, [TRAVADO_MIN])
  return r.rowCount ?? 0
}
