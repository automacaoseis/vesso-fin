import { Hono, type Context } from 'hono'
import type pg from 'pg'
import type { z } from 'zod'
import {
  ACOES, bCategorizar, bConciliar, bCriarTitulo, bIgnorar, bLancarEConciliar, bMotivo, bReabrir, bRevisar, bTempoIniciar, bTempoParar,
  bTransferencia, qFato, qMovimentos, qPeriodo, qTitulosAbertos, zCompetencia, zId, type ErroApi,
} from '@vesso-fin/shared'
import { CABECALHO_SERVICO, verificarServico } from '@vesso-fin/shared/servico'
import { AuthIndisponivel, TokenInvalido, type Claims, type VerificarToken } from './auth'
import { comoUsuario, type Consulta } from './db'
import { ErroHttp, erroDoBanco } from './erros'

export interface Deps {
  pool: pg.Pool
  verificarToken: VerificarToken
  segredoServico: string
  agora?: () => number
  log?: (linha: Record<string, unknown>) => void
}

type Vars = { Variables: { claims: Claims; corpo: Uint8Array } }

/** Teto de corpo: OFX até 5 MB + folga do multipart. Checado ANTES de ler (a assinatura lê o corpo todo). */
const MAX_CORPO = 6 * 1024 * 1024

export function criarApp(deps: Deps) {
  const app = new Hono<Vars>()
  const log = deps.log ?? ((l) => console.log(JSON.stringify(l)))

  app.get('/health', (c) => c.text('ok'))

  app.onError((e, c) => {
    const http = e instanceof ErroHttp ? e : erroDoBanco(e)
    if (http) return c.json(http.corpo, http.status as 401)
    log({ nivel: 'erro', rota: c.req.path, erro: e instanceof Error ? e.message : String(e), code: (e as any)?.code })
    return c.json({ erro: 'interno', mensagem: 'erro interno' } satisfies ErroApi, 500)
  })

  // 1. assinatura de serviço — antes de tudo, inclusive do JWT
  // 2. JWT do usuário
  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next()
    const inicio = Date.now()
    const url = new URL(c.req.url)
    if (Number(c.req.header('content-length') ?? 0) > MAX_CORPO) throw new ErroHttp(413, { erro: 'entrada_invalida', mensagem: 'arquivo grande demais (máx. 5 MB)' })
    const corpo = new Uint8Array(await c.req.arrayBuffer())
    if (corpo.byteLength > MAX_CORPO) throw new ErroHttp(413, { erro: 'entrada_invalida', mensagem: 'arquivo grande demais (máx. 5 MB)' })
    c.set('corpo', corpo)
    const s = verificarServico(deps.segredoServico, c.req.header(CABECALHO_SERVICO), c.req.method, url.pathname + url.search, corpo, deps.agora?.())
    if (!s.ok) throw new ErroHttp(401, { erro: 'nao_autenticado', mensagem: s.motivo })

    const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')
    if (!m) throw new ErroHttp(401, { erro: 'nao_autenticado', mensagem: 'sem sessão' })
    try {
      c.set('claims', await deps.verificarToken(m[1]!))
    } catch (e) {
      if (e instanceof TokenInvalido) throw new ErroHttp(401, { erro: 'nao_autenticado', mensagem: 'sessão inválida ou expirada' })
      if (e instanceof AuthIndisponivel) {
        log({ nivel: 'erro', msg: 'JWKS indisponível', erro: e.message })
        throw new ErroHttp(503, { erro: 'interno', mensagem: 'login temporariamente indisponível; tente de novo' })
      }
      throw e
    }
    await next()
    log({ nivel: 'info', metodo: c.req.method, rota: url.pathname, status: c.res.status, ms: Date.now() - inicio, sub: c.get('claims')?.sub })
  })

  const ler = <T,>(c: Context<Vars>, fn: (q: Consulta) => Promise<T>) => comoUsuario(deps.pool, c.get('claims'), true, fn)
  const escrever = <T,>(c: Context<Vars>, fn: (q: Consulta) => Promise<T>) => comoUsuario(deps.pool, c.get('claims'), false, fn)

  // ─── organizações ────────────────────────────────────────────────────────────────
  app.get('/orgs', async (c) => c.json(await ler(c, async (q) => ({
    eh_dono: (await q<{ d: boolean }>(`select bpo_fin.fn_eh_dono() d`))[0]!.d,
    orgs: await q(`select id_org, nome, tipo, status, turma_fechamento, competencia_inicial
                     from bpo_fin.organizacoes order by tipo desc, nome`),
  }))))

  app.get('/orgs/:id', async (c) => {
    const id = param(c, 'id')
    const r = await ler(c, async (q) => {
      const [org] = await q(`select id_org, nome, tipo, status, turma_fechamento, competencia_inicial
                               from bpo_fin.organizacoes where id_org = $1`, [id])
      if (!org) return null
      const acoes = await q<{ a: string }>(`select a from unnest($2::text[]) a where bpo_fin.fn_pode($1, a)`, [id, ACOES])
      return { ...org, acoes: acoes.map((x) => x.a) }
    })
    if (!r) throw naoEncontrado('organização')
    return c.json(r)
  })

  app.get('/orgs/:id/contas', async (c) => c.json(await ler(c, (q) => q(
    `select id_conta, apelido, instituicao, tipo, saldo_inicial, data_saldo_inicial
       from bpo_fin.contas where id_org = $1 order by apelido`, [param(c, 'id')]))))

  app.get('/orgs/:id/plano-contas', async (c) => c.json(await ler(c, (q) => q(
    `select id_plano_conta, id_pai, codigo, nome, natureza, aceita_lancamento, regra_competencia, generica, entra_dre, entra_dfc
       from bpo_fin.plano_contas where id_org = $1 order by codigo`, [param(c, 'id')]))))

  // ─── conciliação ─────────────────────────────────────────────────────────────────
  app.get('/orgs/:id/movimentos', async (c) => {
    const id = param(c, 'id')
    const f = query(c, qMovimentos)
    const cur = f.cursor ? lerCursor(f.cursor) : null
    const busca = f.q ? `%${f.q.replace(/[\\%_]/g, (x) => '\\' + x)}%` : null
    const filtros = `id_org = $1 and ($2::uuid is null or id_conta = $2) and ($3::date is null or data_movimento >= $3)
                     and ($4::date is null or data_movimento <= $4)
                     and ($5::text is null or descricao_bruta ilike $5 or contraparte_nome ilike $5)
                     and ($6::numeric is null or abs(valor) = $6)`
    const base = [id, f.conta ?? null, f.de ?? null, f.ate ?? null, busca, f.valor ?? null]
    return c.json(await ler(c, async (q) => {
      const linhas = await q(
        `select id_movimento, id_conta, data_movimento, valor, descricao_bruta, contraparte_nome, origem, status,
                motivo_divergencia, valor_conciliado, diferenca, n_titulos, id_transferencia,
                ignorado_categoria, ignorado_motivo, removido_na_fonte_em
           from bpo_fin.v_movimento_status
          where ${filtros} and ($7::text is null or status = $7)
            and ($8::date is null or (data_movimento, id_movimento) > ($8::date, $9::uuid))
          order by data_movimento, id_movimento
          limit $10`, [...base, f.status ?? null, cur?.d ?? null, cur?.id ?? null, f.limite + 1])
      const contagem = await q(`select status, count(*) as n from bpo_fin.v_movimento_status where ${filtros} group by status`, base)
      const mais = linhas.length > f.limite
      const pagina = mais ? linhas.slice(0, f.limite) : linhas
      const ult = pagina.at(-1)
      return {
        movimentos: pagina,
        contagem: Object.fromEntries(contagem.map((x) => [x.status, x.n])),
        proximo: mais && ult ? escreverCursor(ult.data_movimento, ult.id_movimento) : null,
      }
    }))
  })

  app.get('/orgs/:id/titulos-abertos', async (c) => {
    const f = query(c, qTitulosAbertos)
    const busca = f.q ? `%${f.q.replace(/[\\%_]/g, (x) => '\\' + x)}%` : null
    return c.json(await ler(c, (q) => q(
      `select a.id_titulo, a.tipo, a.descricao, a.competencia, a.data_vencimento, a.valor, a.valor_baixado, a.saldo,
              a.dias_atraso, a.faixa, a.id_plano_conta, pc.nome as conta, ct.nome as contraparte
         from bpo_fin.v_titulos_abertos a
         left join bpo_fin.plano_contas pc on pc.id_plano_conta = a.id_plano_conta
         left join bpo_fin.contrapartes ct on ct.id_contraparte = a.id_contraparte
        where a.id_org = $1 and ($2::text is null or a.tipo = $2) and ($3::text is null or a.faixa = $3)
          and ($4::text is null or a.descricao ilike $4 or ct.nome ilike $4)
        order by a.data_vencimento, a.id_titulo limit $5`,
      [param(c, 'id'), f.tipo ?? null, f.faixa ?? null, busca, f.limite])))
  })

  app.get('/movimentos/:id/sugestoes', async (c) => c.json(await ler(c, (q) =>
    q(`select * from bpo_fin.fn_sugerir_pares($1, 5)`, [param(c, 'id')]))))

  // O que está ligado ao movimento hoje — a tela usa para desconciliar e para o "desfazer" (U).
  app.get('/movimentos/:id/baixas', async (c) => c.json(await ler(c, (q) => q(
    `select b.id_baixa, b.id_titulo, b.valor, b.origem, b.criado_em, t.descricao, t.tipo, t.competencia, pc.nome as conta
       from bpo_fin.baixas b
       join bpo_fin.titulos t on t.id_titulo = b.id_titulo
       left join bpo_fin.plano_contas pc on pc.id_plano_conta = t.id_plano_conta
      where b.id_movimento = $1 and b.revertida_em is null
      order by b.criado_em`, [param(c, 'id')]))))

  app.post('/movimentos/:id/conciliar', async (c) => {
    const b = await corpo(c, bConciliar)
    const ids = await escrever(c, (q) => q<{ id: string }>(`select bpo_fin.fn_conciliar($1, $2::jsonb, $3) id`,
      [param(c, 'id'), JSON.stringify(b.itens), b.origem]))
    return c.json({ ok: true, baixas: ids.map((x) => x.id) })
  })

  app.post('/movimentos/:id/lancar-e-conciliar', async (c) => {
    const b = await corpo(c, bLancarEConciliar)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_lancar_e_conciliar($1, $2, $3, $4, $5, $6, $7) as id`,
      [param(c, 'id'), b.id_plano_conta, b.descricao, b.id_centro_custo ?? null, b.id_contraparte ?? null, b.competencia ?? null, b.valor ?? null]))
    return c.json({ ok: true, id: r?.id ?? null })
  })

  app.post('/movimentos/:id/ignorar', async (c) => {
    const b = await corpo(c, bIgnorar)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_ignorar($1, $2, $3) as id`, [param(c, 'id'), b.categoria, b.motivo]))
    return c.json({ ok: true, id: r!.id })
  })

  app.post('/movimentos/:id/desfazer-ignorar', async (c) => {
    await escrever(c, (q) => q(`select bpo_fin.fn_desfazer_ignorar($1)`, [param(c, 'id')]))
    return c.json({ ok: true })
  })

  app.post('/transferencias', async (c) => {
    const b = await corpo(c, bTransferencia)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_registrar_transferencia($1, $2) as id`, [b.id_mov_saida, b.id_mov_entrada]))
    return c.json({ ok: true, id: r!.id })
  })

  app.post('/transferencias/:id/desfazer', async (c) => {
    const b = await corpo(c, bMotivo)
    await escrever(c, (q) => q(`select bpo_fin.fn_desfazer_transferencia($1, $2)`, [param(c, 'id'), b.motivo]))
    return c.json({ ok: true })
  })

  app.post('/baixas/:id/desconciliar', async (c) => {
    const b = await corpo(c, bMotivo)
    await escrever(c, (q) => q(`select bpo_fin.fn_desconciliar($1, $2)`, [param(c, 'id'), b.motivo]))
    return c.json({ ok: true })
  })

  // ─── títulos ─────────────────────────────────────────────────────────────────────
  app.post('/titulos', async (c) => {
    const b = await corpo(c, bCriarTitulo)
    const ids = await escrever(c, (q) => q<{ id: string }>(
      `select bpo_fin.fn_criar_titulo($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) id`,
      [b.id_org, b.id_entidade, b.tipo, b.descricao, b.valor, b.data_vencimento, b.competencia,
       b.id_plano_conta ?? null, b.id_centro_custo ?? null, b.id_contraparte ?? null, b.parcelas]))
    return c.json({ ok: true, titulos: ids.map((x) => x.id) })
  })

  app.patch('/titulos/:id/categoria', async (c) => {
    const b = await corpo(c, bCategorizar)
    await escrever(c, (q) => q(`select bpo_fin.fn_categorizar_titulo($1, $2, $3, $4)`,
      [param(c, 'id'), b.id_plano_conta, b.id_centro_custo ?? null, b.competencia ?? null]))
    return c.json({ ok: true })
  })

  app.post('/titulos/:id/cancelar', async (c) => {
    const b = await corpo(c, bMotivo)
    await escrever(c, (q) => q(`select bpo_fin.fn_cancelar_titulo($1, $2)`, [param(c, 'id'), b.motivo]))
    return c.json({ ok: true })
  })

  // ─── relatórios ──────────────────────────────────────────────────────────────────
  app.get('/orgs/:id/dre', async (c) => {
    const p = query(c, qPeriodo)
    return c.json(await ler(c, (q) => q(
      `select competencia, linha_dre, ordem_dre, id_plano_conta, codigo, conta, natureza, valor, qtd_titulos
         from bpo_fin.v_dre where id_org = $1 and competencia between $2 and $3
        order by ordem_dre, codigo, competencia`, [param(c, 'id'), p.de, p.ate])))
  })

  app.get('/orgs/:id/dfc', async (c) => {
    const p = query(c, qPeriodo)
    return c.json(await ler(c, (q) => q(
      `select mes, grupo_dfc, id_plano_conta, codigo, conta, valor, qtd_baixas
         from bpo_fin.v_dfc where id_org = $1 and mes between $2 and $3
        order by grupo_dfc, codigo, mes`, [param(c, 'id'), p.de, p.ate])))
  })

  app.get('/orgs/:id/fluxo', async (c) => {
    const p = query(c, qPeriodo)
    return c.json(await ler(c, (q) => q(
      `select data_ref as data,
              coalesce(sum(valor) filter (where valor > 0), 0) as entradas,
              coalesce(sum(valor) filter (where valor < 0), 0) as saidas
         from bpo_fin.v_fato where regime = 'projetado' and id_org = $1 and mes between $2 and $3
        group by data_ref order by data_ref`, [param(c, 'id'), p.de, p.ate])))
  })

  // Detalhamento (drill-down) do DRE/DFC: o que compõe um número. Competência = títulos; caixa = baixas.
  app.get('/orgs/:id/fato', async (c) => {
    const f = query(c, qFato)
    return c.json(await ler(c, (q) => q(
      `select f.regime, f.mes, f.data_ref, f.valor, f.origem, f.id_titulo, f.id_movimento,
              t.descricao, ct.nome as contraparte, pc.codigo, pc.nome as conta, m.descricao_bruta as descricao_extrato
         from bpo_fin.v_fato f
         join bpo_fin.titulos t on t.id_titulo = f.id_titulo
         left join bpo_fin.plano_contas pc on pc.id_plano_conta = f.id_plano_conta
         left join bpo_fin.contrapartes ct on ct.id_contraparte = f.id_contraparte
         left join bpo_fin.movimentos m on m.id_movimento = f.id_movimento
        where f.id_org = $1 and f.regime = $2 and f.mes between $3 and $4 and f.id_plano_conta = any($5::uuid[])
        order by f.data_ref, f.valor limit 1000`, [param(c, 'id'), f.regime, f.de, f.ate, f.planos])))
  })

  // ─── fechamento ──────────────────────────────────────────────────────────────────
  app.get('/orgs/:id/fechamentos/:competencia', async (c) => {
    const id = param(c, 'id')
    const comp = competencia(c)
    return c.json(await ler(c, async (q) => {
      const [f] = await q(`select * from bpo_fin.fechamento_mensal where id_org = $1 and competencia = $2`, [id, comp])
      return {
        fechamento: f ?? null,
        checklist: await q(`select * from bpo_fin.fn_checklist_fechamento($1, $2)`, [id, comp]),
        eventos: f ? await q(`select de_status, para_status, por, motivo, em from bpo_fin.fechamento_eventos
                                where id_fechamento = $1 order by em`, [f.id_fechamento]) : [],
      }
    }))
  })

  app.post('/orgs/:id/fechamentos/:competencia/:acao', async (c) => {
    const id = param(c, 'id')
    const comp = competencia(c)
    const acao = c.req.param('acao')
    if (acao === 'enviar') await escrever(c, (q) => q(`select bpo_fin.fn_enviar_revisao($1, $2)`, [id, comp]))
    else if (acao === 'revisar') {
      const b = await corpo(c, bRevisar)
      await escrever(c, (q) => q(`select bpo_fin.fn_revisar_fechamento($1, $2, $3, $4)`, [id, comp, b.aprovar, b.nota ?? null]))
    } else if (acao === 'liberar') await escrever(c, (q) => q(`select bpo_fin.fn_liberar_fechamento($1, $2)`, [id, comp]))
    else if (acao === 'reabrir') {
      const b = await corpo(c, bReabrir)
      await escrever(c, (q) => q(`select bpo_fin.fn_reabrir_mes($1, $2, $3)`, [id, comp, b.motivo]))
    } else throw naoEncontrado('ação')
    return c.json({ ok: true })
  })

  // ─── tempo ───────────────────────────────────────────────────────────────────────
  app.post('/tempo/iniciar', async (c) => {
    const b = await corpo(c, bTempoIniciar)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_tempo_iniciar($1, $2, $3) as id`, [b.id_org, b.etapa, b.competencia ?? null]))
    return c.json({ ok: true, id: r!.id })
  })

  app.post('/tempo/parar', async (c) => {
    const b = await corpo(c, bTempoParar)
    await escrever(c, (q) => q(`select bpo_fin.fn_tempo_parar($1)`, [b.nota ?? null]))
    return c.json({ ok: true })
  })

  // ─── painéis ─────────────────────────────────────────────────────────────────────
  app.get('/fila', async (c) => c.json(await ler(c, (q) => q(`select * from bpo_fin.v_fila order by peso desc, desde limit 500`))))

  app.get('/conexoes', async (c) => c.json(await ler(c, (q) => q(
    `select s.*, o.nome as organizacao, bpo_fin.fn_pode(s.id_org, 'importar') as pode_importar
       from bpo_fin.v_saude_conexoes s join bpo_fin.organizacoes o on o.id_org = s.id_org
      order by o.nome, s.conta`))))

  // Extratos recebidos de uma conexão — sem o payload (o arquivo), que pode ter megabytes.
  app.get('/conexoes/:id/extratos', async (c) => c.json(await ler(c, (q) => q(
    `select id_extrato, arquivo_nome, status, recebido_em, processado_em, periodo_inicio, periodo_fim,
            saldo_final_informado, data_saldo_final, linhas_lidas, linhas_novas, linhas_removidas, erro_msg
       from bpo_fin.extratos where id_conexao = $1 order by recebido_em desc limit 20`, [param(c, 'id')]))))

  // Só o dono: compara com o financeiro_seis, que é da casa (Agência Seis e Task SV, uma org cada).
  app.get('/conferencia-seis', async (c) => c.json(await ler(c, async (q) => {
    if (!(await q<{ d: boolean }>(`select bpo_fin.fn_eh_dono() d`))[0]!.d)
      throw new ErroHttp(403, { erro: 'sem_permissao', mensagem: 'só o dono vê a conferência da Seis' })
    return q(`select * from bpo_fin.v_conferencia_dre_seis order by organizacao, competencia`)   // uma linha por org casa × mês (0006)
  })))

  // Upload de OFX (multipart, campo "arquivo"). Grava o bronze e enfileira o processamento — quem lê o
  // arquivo é o worker. O sha256 é calculado no banco; mesmo arquivo de novo volta com duplicado=true.
  app.post('/conexoes/:id/extratos', async (c) => {
    const id = param(c, 'id')
    let arquivo: File | null = null
    try {
      // o corpo já foi lido pela assinatura: refaz o FormData a partir dos bytes guardados
      const form = await new Response(c.get('corpo'), { headers: { 'content-type': c.req.header('content-type') ?? '' } }).formData()
      const v = form.get('arquivo')
      arquivo = v instanceof File ? v : null
    } catch { /* cai no erro abaixo */ }
    if (!arquivo) throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'envie o arquivo no campo "arquivo"' })
    if (!/\.ofx$/i.test(arquivo.name)) throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'o arquivo precisa ser .ofx' })
    const b64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64')
    const [r] = await escrever(c, (q) => q<{ r: { id_extrato: string; duplicado: boolean; id_job: number | null } }>(
      `select bpo_fin.fn_registrar_extrato($1, $2, $3) r`, [id, arquivo!.name, b64]))
    return c.json(r!.r, r!.r.duplicado ? 200 : 201)
  })

  app.notFound((c) => c.json({ erro: 'nao_encontrado', mensagem: 'rota inexistente' } satisfies ErroApi, 404))

  return app
}

// ─── helpers ───────────────────────────────────────────────────────────────────────
function naoEncontrado(o: string) { return new ErroHttp(404, { erro: 'nao_encontrado', mensagem: `${o} não encontrada` }) }

function invalido(e: z.ZodError): ErroHttp {
  const campos: Record<string, string[]> = {}
  for (const i of e.issues) (campos[i.path.join('.') || '_'] ??= []).push(i.message)
  return new ErroHttp(422, { erro: 'entrada_invalida', mensagem: e.issues[0]?.message ?? 'entrada inválida', campos })
}

function param(c: Context, nome: string): string {
  const r = zId.safeParse(c.req.param(nome))
  if (!r.success) throw invalido(r.error)
  return r.data
}

function competencia(c: Context): string {
  const r = zCompetencia.safeParse(c.req.param('competencia'))
  if (!r.success) throw invalido(r.error)
  return r.data
}

function query<S extends z.ZodType>(c: Context, s: S): z.infer<S> {
  const r = s.safeParse(c.req.query())
  if (!r.success) throw invalido(r.error)
  return r.data
}

async function corpo<S extends z.ZodType>(c: Context, s: S): Promise<z.infer<S>> {
  let json: unknown
  try { json = await c.req.json() } catch { throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'corpo não é JSON' }) }
  const r = s.safeParse(json)
  if (!r.success) throw invalido(r.error)
  return r.data
}

function escreverCursor(d: string, id: string) { return Buffer.from(`${d}|${id}`).toString('base64url') }
function lerCursor(s: string): { d: string; id: string } {
  const [d, id] = Buffer.from(s, 'base64url').toString().split('|')
  if (!d || !id || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !zId.safeParse(id).success)
    throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'cursor inválido' })
  return { d, id }
}
