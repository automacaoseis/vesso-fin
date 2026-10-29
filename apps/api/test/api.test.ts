// Integração: API real × Postgres local (scripts/test-api.sh). Conecta como vesso_fin_api; tokens ES256 locais.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assinarServico } from '@vesso-fin/shared/servico'
import { criarApp } from '../src/app'
import { verificadorJwt } from '../src/auth'
import { criarPool } from '../src/db'

const url = process.env.DATABASE_URL_API
const ISS = 'https://teste.supabase.co/auth/v1'
const SEGREDO = 'segredo-de-servico-de-teste-com-32+caracteres'
const U = {
  dono: '00000000-0000-0000-0000-0000000000d0', analista: '00000000-0000-0000-0000-0000000000a1',
  revisor: '00000000-0000-0000-0000-0000000000a2', head: '00000000-0000-0000-0000-0000000000b1',
  gestor: '00000000-0000-0000-0000-0000000000c1',
}
const ORG = { casa: '20000000-0000-0000-0000-00000000000a', b: '20000000-0000-0000-0000-00000000000b', c: '20000000-0000-0000-0000-00000000000c' }
const MOV = (n: number) => `80000000-0000-0000-0000-00000000000${n}`
const TIT = (n: number) => `90000000-0000-0000-0000-00000000000${n}`

describe.skipIf(!url)('API × banco', () => {
  const pool = criarPool(url ?? '')
  let app: ReturnType<typeof criarApp>
  let chave: CryptoKey
  const tokens: Record<string, string> = {}

  const token = (sub: string, extra: Record<string, unknown> = {}, k: CryptoKey = chave, iss = ISS, exp: string | number = '1h') =>
    new SignJWT({ role: 'authenticated', ...extra }).setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(iss).setAudience('authenticated').setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(k)

  async function chamar(metodo: string, caminho: string, quem: string | null, corpo?: unknown, assinatura?: string | null) {
    const txt = corpo === undefined ? '' : JSON.stringify(corpo)
    const h: Record<string, string> = { 'content-type': 'application/json' }
    const ass = assinatura === undefined ? assinarServico(SEGREDO, metodo, caminho, txt) : assinatura
    if (ass) h['x-vesso-service'] = ass
    if (quem) h.authorization = `Bearer ${tokens[quem] ?? quem}`
    const r = await app.request(caminho, { method: metodo, headers: h, body: txt || undefined })
    return { status: r.status, json: (await r.json().catch(() => null)) as any }
  }
  const get = (c: string, quem: string) => chamar('GET', c, quem)
  const post = (c: string, quem: string, b: unknown = {}) => chamar('POST', c, quem, b)

  beforeAll(async () => {
    const par = await generateKeyPair('ES256')
    chave = par.privateKey
    const jwk = { ...(await exportJWK(par.publicKey)), kid: 'k1', alg: 'ES256' }
    app = criarApp({ pool, verificarToken: verificadorJwt(createLocalJWKSet({ keys: [jwk] }), ISS), segredoServico: SEGREDO, log: () => {} })
    for (const [nome, sub] of Object.entries(U)) tokens[nome] = await token(sub)
    const [{ u }] = (await pool.query('select current_user u')).rows
    expect(u).toBe('vesso_fin_api')   // garante que o teste não roda como superusuário
  })
  afterAll(() => pool.end())

  describe('portão: assinatura de serviço e JWT', () => {
    it('/health dispensa tudo', async () => expect((await app.request('/health')).status).toBe(200))
    it('sem assinatura → 401', async () => expect((await chamar('GET', '/orgs', 'dono', undefined, null)).json.mensagem).toBe('sem assinatura de serviço'))
    it('assinatura de outra rota → 401', async () =>
      expect((await chamar('GET', '/orgs', 'dono', undefined, assinarServico(SEGREDO, 'GET', '/fila'))).status).toBe(401))
    it('assinatura com outro segredo → 401', async () =>
      expect((await chamar('GET', '/orgs', 'dono', undefined, assinarServico('x'.repeat(40), 'GET', '/orgs'))).status).toBe(401))
    it('assinatura vencida → 401', async () =>
      expect((await chamar('GET', '/orgs', 'dono', undefined, assinarServico(SEGREDO, 'GET', '/orgs', '', Date.now() - 301_000))).json.mensagem)
        .toBe('assinatura de serviço expirada'))
    it('corpo adulterado → 401', async () => {
      const ass = assinarServico(SEGREDO, 'POST', '/tempo/parar', JSON.stringify({ nota: 'a' }))
      expect((await chamar('POST', '/tempo/parar', 'analista', { nota: 'b' }, ass)).status).toBe(401)
    })
    it('sem Bearer → 401', async () => expect((await chamar('GET', '/orgs', null)).json.mensagem).toBe('sem sessão'))
    it('HS256 (JWT secret) é recusado', async () => {
      const hs = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISS)
        .setAudience('authenticated').setSubject(U.dono).setExpirationTime('1h').sign(new TextEncoder().encode('segredo'))
      expect((await get('/orgs', hs)).status).toBe(401)
    })
    it('outra chave, outro issuer, vencido, anônimo → 401', async () => {
      const outra = (await generateKeyPair('ES256')).privateKey
      for (const t of [await token(U.dono, {}, outra), await token(U.dono, {}, chave, 'https://outro.supabase.co/auth/v1'),
        await token(U.dono, {}, chave, ISS, Math.floor(Date.now() / 1000) - 10), await token(U.dono, { is_anonymous: true }),
        await token(U.dono, { role: 'anon' })])
        expect((await get('/orgs', t)).status).toBe(401)
    })
  })

  describe('isolamento', () => {
    it('gestor de tráfego sem concessão: zero organizações, 404 pela URL, 403 ao agir', async () => {
      expect((await get('/orgs', 'gestor')).json).toEqual({ eh_dono: false, orgs: [] })
      expect((await get(`/orgs/${ORG.b}`, 'gestor')).status).toBe(404)
      expect((await get(`/orgs/${ORG.b}/movimentos`, 'gestor')).json.movimentos).toEqual([])
      expect((await get(`/orgs/${ORG.b}/titulos-abertos`, 'gestor')).json).toEqual([])
      expect((await post(`/movimentos/${MOV(1)}/conciliar`, 'gestor', { itens: [{ id_titulo: TIT(1), valor: 3000 }] })).status).toBe(403)
      expect((await post('/tempo/iniciar', 'gestor', { id_org: ORG.b, etapa: 'conciliacao' })).status).toBe(403)
      expect((await get('/conferencia-seis', 'gestor')).status).toBe(403)
    })
    it('analista vê só a org dele; a outra dá 404 e lista vazia', async () => {
      expect((await get('/orgs', 'analista')).json.orgs.map((o: any) => o.id_org)).toEqual([ORG.b])
      expect((await get(`/orgs/${ORG.c}`, 'analista')).status).toBe(404)
      expect((await get(`/orgs/${ORG.casa}/contas`, 'analista')).json).toEqual([])
    })
    it('head vê as clientes e não a casa; dono vê as três', async () => {
      expect((await get('/orgs', 'head')).json.orgs.map((o: any) => o.id_org).sort()).toEqual([ORG.b, ORG.c])
      const d = (await get('/orgs', 'dono')).json
      expect(d.eh_dono).toBe(true)
      expect(d.orgs).toHaveLength(3)
    })
    it('ações por papel: analista concilia mas não revisa', async () => {
      const { acoes } = (await get(`/orgs/${ORG.b}`, 'analista')).json
      expect(acoes).toContain('conciliar')
      expect(acoes).not.toContain('revisar')
      expect((await get(`/orgs/${ORG.b}`, 'revisor')).json.acoes).toContain('revisar')
    })
  })

  describe('conciliação', () => {
    let baixaAluguel = ''
    it('lista com contagem por estado e paginação por cursor', async () => {
      const r = (await get(`/orgs/${ORG.b}/movimentos`, 'analista')).json
      expect(r.movimentos).toHaveLength(6)
      expect(r.contagem).toEqual({ pendente: 6 })
      expect(r.movimentos[0]).not.toHaveProperty('payload_raw')
      const vistos: string[] = []
      let cursor: string | null = null
      do {
        const p: any = (await get(`/orgs/${ORG.b}/movimentos?limite=4${cursor ? `&cursor=${cursor}` : ''}`, 'analista')).json
        vistos.push(...p.movimentos.map((m: any) => m.id_movimento))
        cursor = p.proximo
      } while (cursor)
      expect(vistos).toEqual(r.movimentos.map((m: any) => m.id_movimento))
    })
    it('filtros: conta, período, busca (com % literal)', async () => {
      const conta = '40000000-0000-0000-0000-0000000000b2'
      expect((await get(`/orgs/${ORG.b}/movimentos?conta=${conta}`, 'analista')).json.movimentos).toHaveLength(1)
      expect((await get(`/orgs/${ORG.b}/movimentos?de=2026-10-01&ate=2026-10-31`, 'analista')).json.movimentos.map((m: any) => m.id_movimento)).toEqual([MOV(6)])
      expect((await get(`/orgs/${ORG.b}/movimentos?q=aluguel`, 'analista')).json.movimentos.map((m: any) => m.id_movimento)).toEqual([MOV(1)])
      expect((await get(`/orgs/${ORG.b}/movimentos?q=%25`, 'analista')).json.movimentos).toEqual([])
      expect((await get(`/orgs/${ORG.b}/movimentos?valor=1000`, 'analista')).json.movimentos.map((m: any) => m.id_movimento)).toEqual([MOV(4), MOV(5)])
    })
    it('sugestões trazem o título certo', async () => {
      const s = (await get(`/movimentos/${MOV(1)}/sugestoes`, 'analista')).json
      expect(s[0].id_titulo).toBe(TIT(1))
    })
    it('conciliar → conciliado; excesso → 422 com a mensagem do banco', async () => {
      const r = await post(`/movimentos/${MOV(1)}/conciliar`, 'analista', { itens: [{ id_titulo: TIT(1), valor: 3000 }], origem: 'sugestao' })
      expect(r.status).toBe(200)
      expect(r.json.baixas).toHaveLength(1)
      baixaAluguel = r.json.baixas[0]
      const ex = await post(`/movimentos/${MOV(2)}/conciliar`, 'analista', { itens: [{ id_titulo: TIT(2), valor: 6000 }] })
      expect(ex.status).toBe(422)
      expect(ex.json.erro).toBe('regra')
      const st = (await get(`/orgs/${ORG.b}/movimentos?status=conciliado`, 'analista')).json
      expect(st.movimentos.map((m: any) => m.id_movimento)).toEqual([MOV(1)])
    })
    it('parcial fica divergente com Δ', async () => {
      await post(`/movimentos/${MOV(2)}/conciliar`, 'analista', { itens: [{ id_titulo: TIT(2), valor: 4800 }] })
      const m = (await get(`/orgs/${ORG.b}/movimentos?status=divergente`, 'analista')).json.movimentos[0]
      expect(m).toMatchObject({ id_movimento: MOV(2), diferenca: 200, motivo_divergencia: 'conciliacao_parcial' })
    })
    it('entrada inválida → 422 com campos', async () => {
      const r = await post(`/movimentos/${MOV(3)}/conciliar`, 'analista', { itens: [{ id_titulo: TIT(1), valor: -1 }] })
      expect(r.status).toBe(422)
      expect(r.json.erro).toBe('entrada_invalida')
      expect(Object.keys(r.json.campos)).toContain('itens.0.valor')
      expect((await post(`/movimentos/${MOV(3)}/conciliar`, 'analista', { itens: [{ id_titulo: TIT(1), valor: 1.005 }] })).status).toBe(422)
      expect((await get(`/orgs/nao-e-uuid/movimentos`, 'analista')).status).toBe(422)
      expect((await get(`/orgs/${ORG.b}/movimentos?cursor=lixo`, 'analista')).status).toBe(422)
    })
    it('lançar e conciliar a tarifa', async () => {
      const r = await post(`/movimentos/${MOV(3)}/lancar-e-conciliar`, 'analista',
        { id_plano_conta: '50000000-0000-0000-0000-000000000003', descricao: 'Tarifa pacote' })
      expect(r.status).toBe(200)
    })
    it('transferência entre contas', async () =>
      expect((await post('/transferencias', 'analista', { id_mov_saida: MOV(4), id_mov_entrada: MOV(5) })).status).toBe(200))
    it('ignorar exige motivo de 10+; desfazer volta a pendente', async () => {
      expect((await post(`/movimentos/${MOV(6)}/ignorar`, 'analista', { categoria: 'duplicado_na_fonte', motivo: 'dup' })).status).toBe(422)
      expect((await post(`/movimentos/${MOV(6)}/ignorar`, 'analista', { categoria: 'duplicado_na_fonte', motivo: 'linha repetida no OFX' })).status).toBe(200)
      expect((await get(`/orgs/${ORG.b}/movimentos?status=ignorado`, 'analista')).json.movimentos[0].ignorado_motivo).toBe('linha repetida no OFX')
      expect((await post(`/movimentos/${MOV(6)}/desfazer-ignorar`, 'analista')).status).toBe(200)
    })
    it('desconciliar exige motivo e reabre o movimento; conciliar de novo funciona', async () => {
      const ligadas = (await get(`/movimentos/${MOV(1)}/baixas`, 'analista')).json
      expect(ligadas.map((b: any) => [b.id_baixa, b.valor, b.descricao])).toEqual([[baixaAluguel, 3000, 'Aluguel agosto']])
      expect((await get(`/movimentos/${MOV(1)}/baixas`, 'gestor')).json).toEqual([])
      expect((await post(`/baixas/${baixaAluguel}/desconciliar`, 'analista', { motivo: 'abc' })).status).toBe(422)
      expect((await post(`/baixas/${baixaAluguel}/desconciliar`, 'gestor', { motivo: 'tentativa sem acesso' })).status).toBe(403)
      expect((await post(`/baixas/${baixaAluguel}/desconciliar`, 'analista', { motivo: 'título errado, refazer' })).status).toBe(200)
      const m = (await get(`/orgs/${ORG.b}/movimentos?q=aluguel`, 'analista')).json.movimentos[0]
      expect(m.status).toBe('pendente')
      expect((await post(`/movimentos/${MOV(1)}/conciliar`, 'analista', { itens: [{ id_titulo: TIT(1), valor: 3000 }] })).status).toBe(200)
    })
    it('títulos em aberto por tipo', async () => {
      const t = (await get(`/orgs/${ORG.b}/titulos-abertos?tipo=receber`, 'analista')).json
      expect(t.map((x: any) => [x.id_titulo, x.saldo])).toEqual([[TIT(2), 200]])
    })
  })

  describe('lançamentos', () => {
    it('lista com resumo, situação e período; outro usuário não vê', async () => {
      const r = (await get(`/orgs/${ORG.b}/titulos?de=2026-08-01&ate=2026-12-01`, 'analista')).json
      expect(r.titulos.length).toBeGreaterThanOrEqual(2)
      expect(r.resumo).toMatchObject({ qtd: expect.any(Number), receber: expect.any(Number), pagar: expect.any(Number) })
      expect(r.titulos.every((t: any) => t.cancelado_em === null)).toBe(true)
      const aberto = (await get(`/orgs/${ORG.b}/titulos?situacao=aberto`, 'analista')).json.titulos
      expect(aberto.every((t: any) => t.saldo > 0)).toBe(true)
      const receber = (await get(`/orgs/${ORG.b}/titulos?tipo=receber&campo=vencimento&de=2026-09-01&ate=2026-09-01`, 'analista')).json.titulos
      expect(receber.map((t: any) => t.descricao)).toContain('Consultas 1ª quinzena')
      expect((await get(`/orgs/${ORG.b}/titulos`, 'gestor')).json.titulos).toEqual([])
      expect((await get(`/orgs/${ORG.b}/titulos?situacao=xpto`, 'analista')).status).toBe(422)
    })
    it('detalhe traz baixas e histórico; de outra org dá 404', async () => {
      const d = (await get(`/titulos/${TIT(1)}`, 'analista')).json
      expect(d.titulo.descricao).toBe('Aluguel agosto')
      expect(d.titulo).toMatchObject({ valor: 3000, saldo: expect.any(Number), valor_baixado: expect.any(Number) })
      expect(d.baixas.length).toBeGreaterThan(0)
      expect(d.baixas[0]).toHaveProperty('descricao_bruta')
      expect(Array.isArray(d.eventos)).toBe(true)
      expect((await get(`/titulos/${TIT(1)}`, 'gestor')).status).toBe(404)
    })
    it('criar parcelado, categorizar em lote (tudo ou nada) e cancelar', async () => {
      const ent = (await get(`/orgs/${ORG.b}/entidades`, 'analista')).json
      const novo = await post('/titulos', 'analista', { id_org: ORG.b, id_entidade: ent[0].id_entidade, tipo: 'pagar', descricao: 'Software anual',
        valor: 1200, data_vencimento: '2026-11-10', competencia: '2026-11-01', parcelas: 3 })
      expect(novo.status).toBe(200)
      expect(novo.json.titulos).toHaveLength(3)
      const sem = (await get(`/orgs/${ORG.b}/titulos?situacao=sem_categoria`, 'analista')).json
      expect(sem.resumo.sem_categoria).toBeGreaterThanOrEqual(3)
      // um id inválido (de outra org) derruba o lote inteiro
      const ruim = await post('/titulos/categorizar-lote', 'analista', { ids: [...novo.json.titulos, '90000000-0000-0000-0000-0000000000ff'], id_plano_conta: '50000000-0000-0000-0000-000000000002' })
      expect(ruim.status).toBe(422)
      expect((await get(`/orgs/${ORG.b}/titulos?situacao=sem_categoria`, 'analista')).json.resumo.sem_categoria).toBe(sem.resumo.sem_categoria)
      const okLote = await post('/titulos/categorizar-lote', 'analista', { ids: novo.json.titulos, id_plano_conta: '50000000-0000-0000-0000-000000000009' })
      expect(okLote.json).toEqual({ ok: true, qtd: 3 })
      expect((await get(`/orgs/${ORG.b}/titulos?situacao=generica`, 'analista')).json.titulos.length).toBeGreaterThanOrEqual(3)
      expect((await post(`/titulos/${novo.json.titulos[2]}/cancelar`, 'analista', { motivo: 'lançado em duplicidade' })).status).toBe(200)
      expect((await get(`/orgs/${ORG.b}/titulos?situacao=cancelado`, 'analista')).json.titulos.map((t: any) => t.id_titulo)).toContain(novo.json.titulos[2])
      expect((await get(`/titulos/${novo.json.titulos[0]}`, 'analista')).json.eventos.length).toBeGreaterThan(0)
    })
    it('contrapartes com busca', async () => {
      expect((await get(`/orgs/${ORG.b}/contrapartes?q=a`, 'analista')).status).toBe(200)
    })
  })

  describe('resumo', () => {
    it('saldos, abertos, série de 92 pontos, DRE e pendências; outro usuário vê vazio', async () => {
      const r = (await get(`/orgs/${ORG.b}/resumo`, 'analista')).json
      expect(r.contas.length).toBeGreaterThan(0)
      expect(r.contas[0]).toHaveProperty('saldo_sistema')
      expect(r.serie.filter((p: any) => p.tipo === 'realizado')).toHaveLength(31)
      expect(r.serie.filter((p: any) => p.tipo === 'projetado')).toHaveLength(61)
      const hojeR = r.serie.find((p: any) => p.tipo === 'realizado' && p.data === r.hoje)
      const hojeP = r.serie.find((p: any) => p.tipo === 'projetado' && p.data === r.hoje)
      expect(hojeP.saldo).toBeCloseTo(hojeR.saldo + hojeP.entradas + hojeP.saidas)   // projetado parte do realizado de hoje
      expect(Array.isArray(r.pendencias)).toBe(true)
      const g = (await get(`/orgs/${ORG.b}/resumo`, 'gestor')).json
      expect(g.contas).toEqual([])
    })
  })

  describe('relatórios', () => {
    it('DRE e detalhamento por competência; outro usuário não vê', async () => {
      const dre = (await get(`/orgs/${ORG.b}/dre?de=2026-08-01&ate=2026-09-01`, 'analista')).json
      expect(dre.length).toBeGreaterThan(0)
      const planos = [...new Set(dre.map((r: any) => r.id_plano_conta))].join(',')
      const fato = (await get(`/orgs/${ORG.b}/fato?regime=competencia&de=2026-08-01&ate=2026-09-01&planos=${planos}`, 'analista')).json
      expect(fato.length).toBeGreaterThan(0)
      expect(fato[0]).toHaveProperty('descricao')
      expect(fato.reduce((s: number, f: any) => s + f.valor, 0)).toBeCloseTo(dre.reduce((s: number, r: any) => s + r.valor, 0))
      expect((await get(`/orgs/${ORG.b}/fato?regime=competencia&de=2026-08-01&ate=2026-09-01&planos=${planos}`, 'gestor')).json).toEqual([])
    })
    it('detalhamento valida a entrada', async () => {
      expect((await get(`/orgs/${ORG.b}/fato?regime=x&de=2026-08-01&ate=2026-09-01&planos=a`, 'analista')).status).toBe(422)
      expect((await get(`/orgs/${ORG.b}/fato?regime=caixa&de=2026-08-01&ate=2026-09-01&planos=`, 'analista')).status).toBe(422)
    })
  })

  describe('fechamento e tempo', () => {
    it('checklist vem junto; enviar com bloqueio → 422 com o motivo', async () => {
      const f = (await get(`/orgs/${ORG.b}/fechamentos/2026-09-01`, 'analista')).json
      expect(f.fechamento).toBeNull()
      expect(f.checklist.length).toBeGreaterThan(0)
      const r = await post(`/orgs/${ORG.b}/fechamentos/2026-09-01/enviar`, 'analista')
      expect(r.status).toBe(422)
      expect(r.json.mensagem).toMatch(/divergentes|saldo/)
    })
    it('lista de fechamentos da org (vazia no início)', async () => {
      expect((await get(`/orgs/${ORG.b}/fechamentos`, 'analista')).json).toEqual([])
      expect((await get(`/orgs/${ORG.b}/fechamentos`, 'gestor')).json).toEqual([])
    })
    it('competência fora do dia 1 → 422; ação desconhecida → 404', async () => {
      expect((await get(`/orgs/${ORG.b}/fechamentos/2026-09-15`, 'analista')).status).toBe(422)
      expect((await post(`/orgs/${ORG.b}/fechamentos/2026-09-01/apagar`, 'analista')).status).toBe(404)
    })
    it('analista não libera nem reabre', async () => {
      expect((await post(`/orgs/${ORG.b}/fechamentos/2026-09-01/liberar`, 'analista')).status).toBe(403)
      expect((await post(`/orgs/${ORG.b}/fechamentos/2026-09-01/reabrir`, 'analista', { motivo: 'teste de permissão' })).status).toBe(403)
    })
    it('cronômetro inicia e para', async () => {
      expect((await post('/tempo/iniciar', 'analista', { id_org: ORG.b, etapa: 'conciliacao' })).status).toBe(200)
      expect((await post('/tempo/parar', 'analista', {})).status).toBe(200)
    })
  })

  describe('0004: upload de OFX e desfazer transferência', () => {
    async function enviar(quem: string, nome: string, conteudo: string, conexao = '60000000-0000-0000-0000-0000000000b1') {
      const form = new FormData()
      form.set('arquivo', new File([conteudo], nome, { type: 'application/x-ofx' }))
      const req = new Request('http://x', { method: 'POST', body: form })
      const bytes = new Uint8Array(await req.arrayBuffer())
      const caminho = `/conexoes/${conexao}/extratos`
      const r = await app.request(caminho, { method: 'POST', body: bytes, headers: {
        'content-type': req.headers.get('content-type')!, authorization: `Bearer ${tokens[quem]}`,
        'x-vesso-service': assinarServico(SEGREDO, 'POST', caminho, bytes),
      } })
      return { status: r.status, json: (await r.json()) as any }
    }
    it('primeiro envio cria extrato e job (201); o mesmo arquivo volta como duplicado (200)', async () => {
      const a = await enviar('analista', 'nubank-out.ofx', 'OFXHEADER:100\n<OFX>x</OFX>')
      expect(a.status).toBe(201)
      expect(a.json).toMatchObject({ duplicado: false })
      expect(a.json.id_job).toBeTruthy()
      const b = await enviar('analista', 'outro-nome.OFX', 'OFXHEADER:100\n<OFX>x</OFX>')
      expect(b.status).toBe(200)
      expect(b.json).toMatchObject({ duplicado: true, id_extrato: a.json.id_extrato, id_job: null })
    })
    it('lista de conexões e extratos recentes, sem o arquivo', async () => {
      const cx = (await get('/conexoes', 'analista')).json
      expect(cx.every((x: any) => x.organizacao === 'Clínica X' && x.pode_importar === true)).toBe(true)
      expect((await get('/conexoes', 'gestor')).json).toEqual([])
      const ex = (await get('/conexoes/60000000-0000-0000-0000-0000000000b1/extratos', 'analista')).json
      expect(ex.some((e: any) => e.arquivo_nome === 'nubank-out.ofx' && e.status === 'recebido')).toBe(true)
      expect(ex[0]).not.toHaveProperty('payload')
      expect((await get('/conexoes/60000000-0000-0000-0000-0000000000b1/extratos', 'gestor')).json).toEqual([])
    })
    it('gestor sem concessão → 403; extensão errada e campo ausente → 422', async () => {
      expect((await enviar('gestor', 'a.ofx', 'abc')).status).toBe(403)
      expect((await enviar('analista', 'a.csv', 'abc')).status).toBe(422)
      expect((await post('/conexoes/60000000-0000-0000-0000-0000000000b1/extratos', 'analista', {})).status).toBe(422)
    })
    it('corpo acima de 6 MB → 413 sem ler', async () => {
      const r = await app.request('/conexoes/60000000-0000-0000-0000-0000000000b1/extratos', { method: 'POST', headers: { 'content-length': String(7 * 1024 * 1024) } })
      expect(r.status).toBe(413)
    })
    it('desfazer transferência: motivo, permissão, volta a pendente', async () => {
      const t = (await get(`/orgs/${ORG.b}/movimentos?valor=1000`, 'analista')).json.movimentos[0].id_transferencia
      expect(t).toBeTruthy()
      expect((await post(`/transferencias/${t}/desfazer`, 'gestor', { motivo: 'sem acesso aqui' })).status).toBe(403)
      expect((await post(`/transferencias/${t}/desfazer`, 'analista', { motivo: 'abc' })).status).toBe(422)
      expect((await post(`/transferencias/${t}/desfazer`, 'analista', { motivo: 'par errado' })).status).toBe(200)
      const ms = (await get(`/orgs/${ORG.b}/movimentos?valor=1000`, 'analista')).json.movimentos
      expect(ms.map((m: any) => m.status)).toEqual(['pendente', 'pendente'])
      expect((await post(`/transferencias/${t}/desfazer`, 'analista', { motivo: 'de novo' })).json.mensagem).toBe('transferência já revertida')
    })
  })

  it('rota inexistente → 404 (depois do portão)', async () => expect((await get('/nada', 'analista')).status).toBe(404))
})

describe('JWKS fora do ar', () => {
  it('vira 503, não 401 (não desloga o usuário por queda do Auth)', async () => {
    const { verificadorSupabase } = await import('../src/auth')
    const app = criarApp({ pool: {} as any, verificarToken: verificadorSupabase('http://127.0.0.1:9'), segredoServico: SEGREDO, log: () => {} })
    const k = (await generateKeyPair('ES256')).privateKey
    const t = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'x' }).setIssuer('http://127.0.0.1:9/auth/v1')
      .setAudience('authenticated').setSubject(U.dono).setExpirationTime('1h').sign(k)
    const r = await app.request('/orgs', { headers: { 'x-vesso-service': assinarServico(SEGREDO, 'GET', '/orgs'), authorization: `Bearer ${t}` } })
    expect(r.status).toBe(503)
  })
})
