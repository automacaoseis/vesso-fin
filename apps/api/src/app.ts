import { Hono, type Context } from 'hono'
import type pg from 'pg'
import type { z } from 'zod'
import {
  ACOES, bCategorizar, bCategorizarLote, qTitulos, bConciliar, bCriarTitulo, bIgnorar, bLancarEConciliar, bMotivo, bReabrir, bInformarSaldo, qCompetencia, bConcederAcesso, bPedirDocumento, bValidarDocumento, qDocumentos, bCriarOrg, bAtualizarOrg, bLigarPortal, bCriarEntidade, bCriarConta, qBuscaCliente, bCriarPlanoConta, bEditarPlanoConta, bRevisar, bTempoIniciar, bTempoParar,
  bTransferencia, qFato, qMovimentos, qPeriodo, qTitulosAbertos, zCompetencia, zId, type ErroApi,
} from '@vesso-fin/shared'
import { CABECALHO_SERVICO, verificarServico } from '@vesso-fin/shared/servico'
import { AuthIndisponivel, TokenInvalido, type Claims, type VerificarToken } from './auth'
import { comoUsuario, type Consulta } from './db'
import { ErroHttp, erroDoBanco } from './erros'
import type { Storage } from './storage'

export interface Deps {
  pool: pg.Pool
  verificarToken: VerificarToken
  segredoServico: string
  agora?: () => number
  storage?: Storage      // ausente = documentos com arquivo indisponíveis (503)
  log?: (linha: Record<string, unknown>) => void
}

type Vars = { Variables: { claims: Claims; corpo: Uint8Array; token: string } }

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
      c.set('token', m[1]!)  // o Storage (documentos) é chamado com o JWT do próprio usuário
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
    `select id_plano_conta, id_pai, codigo, nome, natureza, aceita_lancamento, regra_competencia, generica, entra_dre, entra_dfc, ativa
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
              a.dias_atraso, a.faixa, a.id_plano_conta, pc.nome as conta, pc.generica, ct.nome as contraparte,
              t.parcela, t.total_parcelas
         from bpo_fin.v_titulos_abertos a
         join bpo_fin.titulos t on t.id_titulo = a.id_titulo
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

  // Conta sem extrato nem API (PayPal, aplicação): o saldo do fim do mês entra à mão para o checklist do fechamento (0007).
  app.post('/contas/:id/saldos', async (c) => {
    const b = await corpo(c, bInformarSaldo)
    await escrever(c, (q) => q(`select bpo_fin.fn_informar_saldo($1, $2, $3)`, [param(c, 'id'), b.data, b.saldo]))
    return c.json({ ok: true })
  })

  app.post('/baixas/:id/desconciliar', async (c) => {
    const b = await corpo(c, bMotivo)
    await escrever(c, (q) => q(`select bpo_fin.fn_desconciliar($1, $2)`, [param(c, 'id'), b.motivo]))
    return c.json({ ok: true })
  })

  // ─── resumo da organização (tela 5) ────────────────────────────────────────────
  // Uma chamada: saldos por conta (sistema × fonte), abertos por faixa, série diária (30 dias realizados +
  // 60 projetados pelos títulos em aberto), DRE do mês e do anterior, pendências da fila.
  app.get('/orgs/:id/resumo', async (c) => {
    const id = param(c, 'id')
    return c.json(await ler(c, async (q) => {
      const mov = `select m.data_movimento as d, sum(m.valor) as v,
                          sum(m.valor) filter (where m.valor > 0) as ent, sum(m.valor) filter (where m.valor < 0) as sai
                     from bpo_fin.movimentos m join bpo_fin.contas ct on ct.id_conta = m.id_conta and ct.ativa
                    where m.id_org = $1 and m.data_movimento > ct.data_saldo_inicial and m.removido_na_fonte_em is null
                      and not exists (select 1 from bpo_fin.movimentos_ignorados i where i.id_movimento = m.id_movimento
                                       and i.revertido_em is null and i.categoria = 'duplicado_na_fonte')
                    group by 1`
      const contas = await q(
        `select ct.id_conta, ct.apelido, ct.instituicao, ct.tipo, ct.saldo_inicial, ct.data_saldo_inicial,
                ct.saldo_inicial + coalesce(s.hoje, 0) as saldo_sistema,
                f.data as fonte_data, f.saldo as fonte_saldo,
                case when f.data is not null then ct.saldo_inicial + coalesce(s.na_fonte, 0) end as sistema_na_data_fonte
           from bpo_fin.contas ct
           left join lateral (select x.data, x.saldo from bpo_fin.saldos_extrato x where x.id_conta = ct.id_conta order by x.data desc limit 1) f on true
           left join lateral (
             select sum(m.valor) filter (where m.data_movimento <= current_date) as hoje,
                    sum(m.valor) filter (where m.data_movimento <= f.data) as na_fonte
               from bpo_fin.movimentos m
              where m.id_conta = ct.id_conta and m.data_movimento > ct.data_saldo_inicial and m.removido_na_fonte_em is null
                and not exists (select 1 from bpo_fin.movimentos_ignorados i where i.id_movimento = m.id_movimento
                                 and i.revertido_em is null and i.categoria = 'duplicado_na_fonte')) s on true
          where ct.id_org = $1 and ct.ativa order by ct.apelido`, [id])
      const abertos = await q(
        `select tipo, faixa, count(*)::int as qtd, sum(saldo) as total from bpo_fin.v_titulos_abertos where id_org = $1 group by 1, 2`, [id])
      const serie = await q(
        `with mov as (${mov}),
              ini as (select coalesce(sum(saldo_inicial), 0) as si from bpo_fin.contas where id_org = $1 and ativa),
              antes as (select coalesce(sum(v), 0) as v from mov where d < current_date - 30),
              passado as (
                select g::date as data, 'realizado' as tipo, coalesce(m.ent, 0) as entradas, coalesce(m.sai, 0) as saidas,
                       (select si from ini) + (select v from antes) + sum(coalesce(m.v, 0)) over (order by g) as saldo
                  from generate_series(current_date - 30, current_date, interval '1 day') g left join mov m on m.d = g::date),
              proj as (select data_ref as d, sum(valor) as v, sum(valor) filter (where valor > 0) as ent, sum(valor) filter (where valor < 0) as sai
                         from bpo_fin.v_fato where regime = 'projetado' and id_org = $1 and data_ref <= current_date + 60 group by 1),
              futuro as (
                select g::date as data, 'projetado' as tipo, coalesce(p.ent, 0) as entradas, coalesce(p.sai, 0) as saidas,
                       (select saldo from passado where data = current_date) + sum(coalesce(p.v, 0)) over (order by g) as saldo
                  from generate_series(current_date, current_date + 60, interval '1 day') g left join proj p on p.d = g::date)
         select * from passado union all select * from futuro order by data, tipo desc`, [id])
      const dre = await q(
        `select competencia, linha_dre, ordem_dre, id_plano_conta, codigo, conta, natureza, valor, qtd_titulos from bpo_fin.v_dre
          where id_org = $1 and competencia between (date_trunc('month', current_date) - interval '1 month')::date and date_trunc('month', current_date)::date`, [id])
      const pendencias = await q(`select tipo_item, count(*)::int as qtd, coalesce(sum(abs(valor)), 0) as valor from bpo_fin.v_fila where id_org = $1 group by 1`, [id])
      const [fech] = await q(
        `select competencia, status from bpo_fin.fechamento_mensal where id_org = $1 order by competencia desc limit 1`, [id])
      const [hoje] = await q(`select current_date::text as hoje`)
      return { hoje: hoje!.hoje, contas, abertos, serie, dre, pendencias, ultimo_fechamento: fech ?? null }
    }))
  })

  // ─── lançamentos (títulos) ───────────────────────────────────────────────────────
  // Lista com filtros + resumo para os cartões. Período pela competência ou pelo vencimento.
  app.get('/orgs/:id/titulos', async (c) => {
    const id = param(c, 'id')
    const f = query(c, qTitulos)
    const cur = f.cursor ? lerCursor(f.cursor) : null
    const busca = f.q ? `%${f.q.replace(/[\\%_]/g, (x) => '\\' + x)}%` : null
    const data = f.campo === 'vencimento' ? 't.data_vencimento' : 't.competencia'
    const base = `
      from bpo_fin.titulos t
      left join lateral (select coalesce(sum(b.valor), 0) pago from bpo_fin.baixas b where b.id_titulo = t.id_titulo and b.revertida_em is null) b on true
      left join bpo_fin.plano_contas pc on pc.id_plano_conta = t.id_plano_conta
      left join bpo_fin.contrapartes ct on ct.id_contraparte = t.id_contraparte
      where t.id_org = $1 and ($2::text is null or t.tipo = $2)
        and ($3::date is null or ${data} >= $3) and ($4::date is null or ${data} <= ($4::date + interval '1 month' - interval '1 day'))
        and ($5::uuid is null or t.id_plano_conta = $5)
        and ($6::text is null or t.descricao ilike $6 or ct.nome ilike $6 or t.observacao ilike $6)`
    const sit = {
      todos: 't.cancelado_em is null', cancelado: 't.cancelado_em is not null',
      aberto: 't.cancelado_em is null and t.valor > b.pago', quitado: 't.cancelado_em is null and t.valor <= b.pago',
      vencido: 't.cancelado_em is null and t.valor > b.pago and t.data_vencimento < current_date',
      sem_categoria: 't.cancelado_em is null and t.id_plano_conta is null',
      generica: 't.cancelado_em is null and pc.generica',
    }[f.situacao]
    const params = [id, f.tipo ?? null, f.de ?? null, f.ate ?? null, f.plano ?? null, busca]
    return c.json(await ler(c, async (q) => {
      const linhas = await q(
        `select t.id_titulo, t.tipo, t.descricao, t.valor, b.pago as valor_baixado, t.valor - b.pago as saldo,
                t.data_vencimento, t.competencia, t.id_plano_conta, pc.codigo, pc.nome as conta, coalesce(pc.generica, false) as generica,
                ct.nome as contraparte, t.origem, t.observacao, t.parcela, t.total_parcelas, t.cancelado_em, ${data} as data_ref
         ${base} and ${sit}
           and ($7::date is null or (${data}, t.id_titulo) > ($7::date, $8::uuid))
         order by ${data}, t.id_titulo limit $9`, [...params, cur?.d ?? null, cur?.id ?? null, f.limite + 1])
      const [resumo] = await q(
        `select count(*) filter (where t.cancelado_em is null) as qtd,
                coalesce(sum(t.valor) filter (where t.cancelado_em is null and t.tipo = 'receber'), 0) as receber,
                coalesce(sum(t.valor) filter (where t.cancelado_em is null and t.tipo = 'pagar'), 0) as pagar,
                coalesce(sum(t.valor - b.pago) filter (where t.cancelado_em is null and t.tipo = 'receber' and t.valor > b.pago), 0) as receber_aberto,
                coalesce(sum(t.valor - b.pago) filter (where t.cancelado_em is null and t.tipo = 'pagar' and t.valor > b.pago), 0) as pagar_aberto,
                count(*) filter (where t.cancelado_em is null and t.id_plano_conta is null) as sem_categoria,
                count(*) filter (where t.cancelado_em is null and pc.generica) as generica,
                count(*) filter (where t.cancelado_em is null and t.valor > b.pago and t.data_vencimento < current_date) as vencidos
         ${base}`, params)
      const mais = linhas.length > f.limite
      const pagina = mais ? linhas.slice(0, f.limite) : linhas
      const ult = pagina.at(-1)
      return { titulos: pagina, resumo, proximo: mais && ult ? escreverCursor(ult.data_ref, ult.id_titulo) : null }
    }))
  })

  // Detalhe: o título, as baixas (com o movimento do extrato) e o histórico da auditoria.
  app.get('/titulos/:id', async (c) => {
    const id = param(c, 'id')
    const r = await ler(c, async (q) => {
      const [t] = await q(
        `select t.*, pc.codigo, pc.nome as conta, coalesce(pc.generica, false) as generica, ct.nome as contraparte, en.razao_social as entidade,
                b.pago as valor_baixado, t.valor - b.pago as saldo
           from bpo_fin.titulos t
           left join lateral (select coalesce(sum(x.valor), 0) pago from bpo_fin.baixas x where x.id_titulo = t.id_titulo and x.revertida_em is null) b on true
           left join bpo_fin.plano_contas pc on pc.id_plano_conta = t.id_plano_conta
           left join bpo_fin.contrapartes ct on ct.id_contraparte = t.id_contraparte
           left join bpo_fin.entidades en on en.id_entidade = t.id_entidade
          where t.id_titulo = $1`, [id])
      if (!t) return null
      const baixas = await q(
        `select b.id_baixa, b.valor, b.origem, b.criado_em, b.revertida_em, b.motivo_reversao,
                m.data_movimento, m.descricao_bruta, m.valor as valor_movimento, co.apelido as conta_bancaria
           from bpo_fin.baixas b join bpo_fin.movimentos m on m.id_movimento = b.id_movimento
           join bpo_fin.contas co on co.id_conta = m.id_conta
          where b.id_titulo = $1 order by b.criado_em`, [id])
      const eventos = await q(
        `select acao, antes, depois, por, em from bpo_fin.log_eventos
          where tabela = 'titulos' and id_registro = $1 order by em desc limit 50`, [id])
      return { titulo: t, baixas, eventos }
    })
    if (!r) throw naoEncontrado('título')
    return c.json(r)
  })

  // Categorizar em lote: tudo ou nada (uma transação; se um título falhar, nenhum muda).
  app.post('/titulos/categorizar-lote', async (c) => {
    const b = await corpo(c, bCategorizarLote)
    await escrever(c, async (q) => {
      for (const id of b.ids) await q(`select bpo_fin.fn_categorizar_titulo($1, $2, null, $3)`, [id, b.id_plano_conta, b.competencia ?? null])
    })
    return c.json({ ok: true, qtd: b.ids.length })
  })

  app.get('/orgs/:id/entidades', async (c) => c.json(await ler(c, (q) => q(
    `select id_entidade, razao_social, nome_fantasia, cnpj from bpo_fin.entidades where id_org = $1 order by razao_social`, [param(c, 'id')]))))

  app.get('/orgs/:id/contrapartes', async (c) => {
    const busca = (c.req.query('q') ?? '').trim().slice(0, 100)
    return c.json(await ler(c, (q) => q(
      `select id_contraparte, nome, documento, tipo from bpo_fin.contrapartes
        where id_org = $1 and ($2 = '' or nome ilike $3 or documento like $3) order by nome limit 30`,
      [param(c, 'id'), busca, `%${busca.replace(/[\\%_]/g, (x) => '\\' + x)}%`])))
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
  // Meses com fechamento iniciado (a tela mostra os demais como "aberto").
  app.get('/orgs/:id/fechamentos', async (c) => c.json(await ler(c, (q) => q(
    `select competencia, status, executor, enviado_revisao_em, revisor, revisado_em, liberado_por, liberado_em, reaberturas
       from bpo_fin.fechamento_mensal where id_org = $1 order by competencia desc limit 36`, [param(c, 'id')]))))

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

  // ─── acessos (0008) ──────────────────────────────────────────────────────────────
  app.get('/acessos', async (c) => c.json(await ler(c, async (q) => {
    const [d] = await q<{ eh_dono: boolean }>(`select bpo_fin.fn_eh_dono() as eh_dono`)
    return {
      eh_dono: d!.eh_dono,
      acessos: await q(`select * from bpo_fin.fn_listar_acessos()`),
      // onde quem chama pode conceder (o formulário só oferece estas)
      orgs: await q(`select id_org, nome, tipo from bpo_fin.organizacoes where bpo_fin.fn_pode(id_org, 'configurar_org') order by tipo desc, nome`),
    }
  })))

  app.post('/acessos', async (c) => {
    const b = await corpo(c, bConcederAcesso)
    // validade vale até o fim do dia escolhido, no fuso de São Paulo
    const expira = b.expira_em ? `${b.expira_em}T23:59:59-03:00` : null
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_conceder_acesso($1, $2, $3, $4, $5) as id`, [b.email, b.id_org, b.papel, b.motivo, expira]))
    return c.json({ ok: true, id: r!.id })
  })

  app.post('/acessos/:id/revogar', async (c) => {
    const b = await corpo(c, bMotivo)
    await escrever(c, (q) => q(`select bpo_fin.fn_revogar_acesso($1, $2)`, [param(c, 'id'), b.motivo]))
    return c.json({ ok: true })
  })

  // ─── equipe: tempo por org × etapa × pessoa (v_tempo_org) + quem está com cronômetro aberto ─
  app.get('/equipe', async (c) => {
    const f = query(c, qPeriodo)
    return c.json(await ler(c, async (q) => {
      const tempo = await q<{ user_auth_id: string }>(
        `select v.id_org, o.nome as organizacao, v.competencia, v.etapa, v.user_auth_id, v.minutos::int, v.sessoes::int
           from bpo_fin.v_tempo_org v join bpo_fin.organizacoes o on o.id_org = v.id_org
          where v.competencia between $1 and $2
          order by o.nome, v.competencia, v.etapa`, [f.de, f.ate])
      const agora = await q<{ user_auth_id: string }>(
        `select t.id_org, o.nome as organizacao, t.etapa, t.user_auth_id, t.inicio
           from bpo_fin.tempo_tarefa t join bpo_fin.organizacoes o on o.id_org = t.id_org
          where t.fim is null and t.inicio > now() - interval '12 hours' order by t.inicio`)
      const ids = [...new Set([...tempo, ...agora].map((x) => x.user_auth_id))]
      const pessoas = ids.length ? await q(`select * from bpo_fin.fn_pessoas($1::uuid[])`, [ids]) : []
      return { tempo, agora, pessoas }
    }))
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
  // id_conta do movimento: a tela abre a Conciliação já na conta e no mês do item.
  app.get('/fila', async (c) => c.json(await ler(c, (q) => q(
    `select f.*, m.id_conta from bpo_fin.v_fila f
       left join bpo_fin.movimentos m on f.tipo_item like 'movimento\\_%' and m.id_movimento::text = f.id_ref
      order by f.peso desc, f.desde limit 500`))))

  // Fechamentos de todas as orgs visíveis numa competência: status + resumo do checklist (bloqueios) + turma.
  app.get('/fechamentos', async (c) => {
    const { competencia: comp } = query(c, qCompetencia)
    return c.json(await ler(c, (q) => q(
      `select o.id_org, o.nome, o.tipo, o.status as status_org, o.competencia_inicial, o.turma_fechamento, t.dia_util_limite,
              coalesce(f.status, 'aberto') as status, f.executor, f.enviado_revisao_em, f.revisor, f.revisado_em,
              f.liberado_em, coalesce(f.reaberturas, 0) as reaberturas,
              ck.total::int as itens, ck.ok::int as itens_ok, ck.bloqueios::int as bloqueios,
              case when t.dia_util_limite is not null then bpo_fin.fn_prazo_fechamento($1, t.dia_util_limite) end as prazo  -- com feriados (0012)
         from bpo_fin.organizacoes o
         left join bpo_fin.turmas_fechamento t on t.codigo = o.turma_fechamento
         left join bpo_fin.fechamento_mensal f on f.id_org = o.id_org and f.competencia = $1
         cross join lateral (select count(*) as total, count(*) filter (where k.ok) as ok,
                                    count(*) filter (where k.bloqueia and not k.ok) as bloqueios
                               from bpo_fin.fn_checklist_fechamento(o.id_org, $1) k) ck
        where o.status in ('onboarding', 'ativa')
        order by o.tipo desc, o.nome`, [comp])))
  })

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

  // ─── cadastro (0011) ──────────────────────────────────────────────────────────────
  app.get('/cadastro/opcoes', async (c) => c.json(await ler(c, async (q) => {
    const [p] = await q<{ pode: boolean; dono: boolean }>(`select bpo_fin.fn_pode_cadastrar() pode, bpo_fin.fn_eh_dono() dono`)
    return {
      pode_cadastrar: p!.pode, eh_dono: p!.dono,
      turmas: await q(`select codigo, nome, dia_util_limite from bpo_fin.turmas_fechamento where ativa order by codigo`),
      modelos: await q(`select m.id_modelo, m.nome, m.descricao, (select count(*)::int from bpo_fin.plano_contas p where p.id_modelo = m.id_modelo) itens
                          from bpo_fin.plano_contas_modelos m order by m.nome`),
      // de onde copiar o plano: orgs que eu vejo e que têm plano
      orgs_com_plano: await q(`select o.id_org, o.nome, o.tipo, count(p.*)::int itens from bpo_fin.organizacoes o
                                 join bpo_fin.plano_contas p on p.id_org = o.id_org group by 1, 2, 3 order by o.tipo desc, o.nome`),
    }
  })))

  app.get('/cadastro/clientes', async (c) => {
    const f = query(c, qBuscaCliente)
    return c.json(await ler(c, (q) => q(`select * from bpo_fin.fn_buscar_clientes($1)`, [f.q])))
  })

  app.post('/orgs', async (c) => {
    const b = await corpo(c, bCriarOrg)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_criar_organizacao($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as id`,
      [b.nome, b.tipo, b.id_cliente, b.razao_social ?? null, b.nome_fantasia ?? null, b.cnpj, b.regime, b.competencia_inicial, b.turma,
       b.copiar_plano_de ?? null, b.id_modelo ?? null]))
    return c.json({ ok: true, id: r!.id }, 201)
  })

  app.get('/orgs/:id/cadastro', async (c) => {
    const id = param(c, 'id')
    return c.json(await ler(c, async (q) => {
      const [org] = await q(`select id_org, nome, tipo, status, turma_fechamento, competencia_inicial, id_cliente, id_cliente_portal, created_at
                               from bpo_fin.organizacoes where id_org = $1`, [id])
      if (!org) throw new ErroHttp(404, { erro: 'nao_encontrado', mensagem: 'organização não encontrada' })
      const [[cliente], entidades, contas, [plano], [pode]] = await Promise.all([
        q(`select * from bpo_fin.fn_cliente_da_org($1)`, [id]),
        q(`select id_entidade, razao_social, nome_fantasia, cnpj, regime_tributario, ativa from bpo_fin.entidades where id_org = $1 order by created_at`, [id]),
        q(`select ct.id_conta, ct.id_entidade, ct.tipo, ct.instituicao, ct.apelido, ct.numero_final, ct.saldo_inicial, ct.data_saldo_inicial, ct.ativa,
                  coalesce(json_agg(json_build_object('metodo', x.metodo, 'status', x.status)) filter (where x.id_conexao is not null), '[]') conexoes
             from bpo_fin.contas ct left join bpo_fin.conexoes x on x.id_conta = ct.id_conta
            where ct.id_org = $1 group by ct.id_conta order by ct.ativa desc, ct.apelido`, [id]),
        q(`select count(*)::int itens, count(*) filter (where aceita_lancamento)::int analiticas from bpo_fin.plano_contas where id_org = $1`, [id]),
        q(`select bpo_fin.fn_pode($1, 'configurar_org') configurar, bpo_fin.fn_eh_dono() dono`, [id]),
      ])
      return { org, cliente: cliente ?? null, entidades, contas, plano, pode }
    }))
  })

  app.post('/orgs/:id/atualizar', async (c) => {
    const b = await corpo(c, bAtualizarOrg)
    await escrever(c, (q) => q(`select bpo_fin.fn_atualizar_organizacao($1, $2, $3, $4, $5)`, [param(c, 'id'), b.nome, b.status, b.turma, b.competencia_inicial]))
    return c.json({ ok: true })
  })

  app.post('/orgs/:id/portal', async (c) => {
    const b = await corpo(c, bLigarPortal)
    await escrever(c, (q) => q(`select bpo_fin.fn_ligar_portal($1, $2)`, [param(c, 'id'), b.id_cliente]))
    return c.json({ ok: true })
  })

  app.post('/orgs/:id/entidades', async (c) => {
    const b = await corpo(c, bCriarEntidade)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_criar_entidade($1, $2, $3, $4, $5) as id`, [param(c, 'id'), b.razao_social, b.nome_fantasia ?? null, b.cnpj, b.regime]))
    return c.json({ ok: true, id: r!.id }, 201)
  })

  app.post('/orgs/:id/contas', async (c) => {
    const b = await corpo(c, bCriarConta)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_criar_conta($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`,
      [param(c, 'id'), b.id_entidade, b.tipo, b.instituicao, b.apelido, b.numero_final ?? null, b.saldo_inicial, b.data_saldo_inicial, b.metodo]))
    return c.json({ ok: true, id: r!.id }, 201)
  })

  app.post('/contas/:id/desativar', async (c) => {
    const b = await corpo(c, bMotivo)
    await escrever(c, (q) => q(`select bpo_fin.fn_desativar_conta($1, $2)`, [param(c, 'id'), b.motivo]))
    return c.json({ ok: true })
  })

  // ─── plano de contas pela tela (0012) ─────────────────────────────────────────────
  app.get('/orgs/:id/plano', async (c) => c.json(await ler(c, (q) => q(
    `select p.id_plano_conta, p.id_pai, p.codigo, p.nome, p.natureza, p.aceita_lancamento, p.entra_dre, p.entra_dfc, p.grupo_dfc,
            p.linha_dre, p.regra_competencia, p.generica, p.sensivel, p.ativa,
            (select count(*)::int from bpo_fin.titulos t where t.id_plano_conta = p.id_plano_conta and t.cancelado_em is null) as titulos
       from bpo_fin.plano_contas p where p.id_org = $1 order by p.codigo`, [param(c, 'id')]))))

  app.post('/orgs/:id/plano', async (c) => {
    const b = await corpo(c, bCriarPlanoConta)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_criar_plano_conta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id`,
      [param(c, 'id'), b.codigo, b.nome, b.id_pai, b.natureza, b.linha_dre, b.grupo_dfc, b.regra, b.generica, b.sensivel]))
    return c.json({ ok: true, id: r!.id }, 201)
  })

  app.post('/plano/:id/editar', async (c) => {
    const b = await corpo(c, bEditarPlanoConta)
    await escrever(c, (q) => q(`select bpo_fin.fn_editar_plano_conta($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [param(c, 'id'), b.nome, b.id_pai, b.linha_dre, b.grupo_dfc, b.regra, b.generica, b.sensivel, b.ativa]))
    return c.json({ ok: true })
  })

  // ─── documentos (0009) ───────────────────────────────────────────────────────────
  const COLS_DOC = `d.id_documento, d.id_org, d.id_titulo, t.descricao as titulo, d.tipo, d.competencia, d.descricao, d.status,
         d.arquivo_nome, d.arquivo_bytes, d.arquivo_mime, d.storage_path is not null as tem_arquivo, d.motivo_recusa,
         d.pedido_em, d.pedido_por, d.recebido_em, d.recebido_por, d.validado_por, d.created_at`
  app.get('/orgs/:id/documentos', async (c) => {
    const f = query(c, qDocumentos)
    return c.json(await ler(c, (q) => q(
      `select ${COLS_DOC} from bpo_fin.documentos d left join bpo_fin.titulos t on t.id_titulo = d.id_titulo
        where d.id_org = $1 and ($2::text is null or d.status = $2) and ($3::date is null or d.competencia = $3)
        order by (d.status = 'pedido') desc, coalesce(d.recebido_em, d.pedido_em, d.created_at) desc limit 500`,
      [param(c, 'id'), f.status ?? null, f.competencia ?? null])))
  })

  // Pendências de todas as orgs visíveis: pedidos sem arquivo e recebidos aguardando validação.
  app.get('/pendencias', async (c) => c.json(await ler(c, (q) => q(
    `select ${COLS_DOC}, o.nome as organizacao from bpo_fin.documentos d
       join bpo_fin.organizacoes o on o.id_org = d.id_org
       left join bpo_fin.titulos t on t.id_titulo = d.id_titulo
      where d.status in ('pedido', 'recebido') and o.status in ('onboarding', 'ativa')
      order by (d.status = 'pedido') desc, coalesce(d.pedido_em, d.recebido_em) limit 500`))))

  app.post('/orgs/:id/documentos/pedir', async (c) => {
    const b = await corpo(c, bPedirDocumento)
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_pedir_documento($1, $2, $3, $4, $5) as id`,
      [param(c, 'id'), b.tipo, b.descricao, b.competencia ?? null, b.id_titulo ?? null]))
    return c.json({ ok: true, id: r!.id })
  })

  // Arquivo (multipart): campo "arquivo" + id_documento (atende um pedido) OU tipo/descricao/competencia/id_titulo (avulso).
  // Sobe para o Storage com o JWT do usuário (a policy confere 'importar' na org) e depois registra no banco.
  app.post('/orgs/:id/documentos', async (c) => {
    const idOrg = param(c, 'id')
    if (!deps.storage) throw new ErroHttp(503, { erro: 'interno', mensagem: 'armazenamento de arquivos não configurado na API' })
    let form: FormData
    try { form = await new Response(c.get('corpo'), { headers: { 'content-type': c.req.header('content-type') ?? '' } }).formData() }
    catch { throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'envie o arquivo no campo "arquivo"' }) }
    const arquivo = form.get('arquivo')
    if (!(arquivo instanceof File) || arquivo.size === 0) throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'envie o arquivo no campo "arquivo"' })
    const texto = (k: string) => { const v = form.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined }
    const idDoc = texto('id_documento')
    if (idDoc && !zId.safeParse(idDoc).success) throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'id_documento inválido' })
    const avulso = idDoc ? null : bPedirDocumento.safeParse({ tipo: texto('tipo'), descricao: texto('descricao'), competencia: texto('competencia'), id_titulo: texto('id_titulo') })
    if (avulso && !avulso.success) throw invalido(avulso.error)
    const nome = arquivo.name.normalize('NFC').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(-120) || 'arquivo'
    const pasta = (avulso?.data?.competencia ?? new Date().toISOString()).slice(0, 7)
    const caminho = `${idOrg}/${pasta}/${crypto.randomUUID()}-${nome}`
    await deps.storage.enviar(c.get('token'), caminho, new Uint8Array(await arquivo.arrayBuffer()), arquivo.type)
    if (idDoc) {
      await escrever(c, (q) => q(`select bpo_fin.fn_anexar_documento($1, $2, $3, $4, $5)`, [idDoc, caminho, arquivo.name, arquivo.size, arquivo.type]))
      return c.json({ ok: true, id: idDoc }, 201)
    }
    const b = avulso!.data!
    const [r] = await escrever(c, (q) => q(`select bpo_fin.fn_registrar_documento($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`,
      [idOrg, b.tipo, b.descricao, b.competencia ?? null, b.id_titulo ?? null, caminho, arquivo.name, arquivo.size, arquivo.type]))
    return c.json({ ok: true, id: r!.id }, 201)
  })

  // Link assinado de 2 minutos (a leitura também passa pela policy do bucket).
  app.get('/documentos/:id/arquivo', async (c) => {
    if (!deps.storage) throw new ErroHttp(503, { erro: 'interno', mensagem: 'armazenamento de arquivos não configurado na API' })
    const [d] = await ler(c, (q) => q<{ storage_path: string | null }>(`select storage_path from bpo_fin.documentos where id_documento = $1`, [param(c, 'id')]))
    if (!d) throw new ErroHttp(404, { erro: 'nao_encontrado', mensagem: 'documento não encontrado' })
    if (!d.storage_path) throw new ErroHttp(422, { erro: 'entrada_invalida', mensagem: 'este documento ainda não tem arquivo' })
    return c.json({ url: await deps.storage.assinar(c.get('token'), d.storage_path, 120) })
  })

  app.post('/documentos/:id/validar', async (c) => {
    const b = await corpo(c, bValidarDocumento)
    await escrever(c, (q) => q(`select bpo_fin.fn_validar_documento($1, $2, $3)`, [param(c, 'id'), b.aprovar, b.motivo ?? null]))
    return c.json({ ok: true })
  })

  app.post('/documentos/:id/dispensar', async (c) => {
    const b = await corpo(c, bMotivo)
    await escrever(c, (q) => q(`select bpo_fin.fn_dispensar_documento($1, $2)`, [param(c, 'id'), b.motivo]))
    return c.json({ ok: true })
  })

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
