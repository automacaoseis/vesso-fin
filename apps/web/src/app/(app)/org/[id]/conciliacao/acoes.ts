'use server'

// Server Actions da Conciliação. São endpoints públicos (POST na própria rota): toda entrada é validada
// aqui antes de virar caminho da API — um id "../x" mudaria a rota chamada.
import { z } from 'zod'
import { bIgnorar, bLancarEConciliar, ESTADOS_MOVIMENTO, ETAPAS_TEMPO, zData, zId, zValorPositivo } from '@vesso-fin/shared'
import { api, comQuery, tentar, type Resultado } from '@/lib/api'
import type { Baixa, Dados, Filtros, Movimento, PaginaMovimentos, Sugestao, Titulo } from './tipos'

const zFiltros = z.object({ conta: zId, de: zData, ate: zData, status: z.enum(ESTADOS_MOVIMENTO).optional() })
const id = (v: unknown) => zId.parse(v)

async function ler(idOrg: string, filtros: Filtros, limite = 500): Promise<Dados> {
  const fx = zFiltros.parse(filtros)
  const [pagina, titulos] = await Promise.all([
    api.get<PaginaMovimentos>(comQuery(`/orgs/${id(idOrg)}/movimentos`, { ...fx, limite })),
    api.get<Titulo[]>(comQuery(`/orgs/${id(idOrg)}/titulos-abertos`, { limite: 500 })),
  ])
  return { pagina, titulos }
}

/** Executa a escrita e já devolve os dados frescos: uma volta do navegador por ação. */
async function eDepois<T>(idOrg: string, filtros: Filtros, limite: number, fn: () => Promise<T>): Promise<Resultado<{ r: T; dados: Dados }>> {
  return tentar(async () => {
    const r = await fn()
    return { r, dados: await ler(idOrg, filtros, Math.min(Math.max(limite, 1), 500)) }
  })
}

export async function recarregar(idOrg: string, filtros: Filtros, limite: number) {
  return tentar(() => ler(idOrg, filtros, Math.min(Math.max(limite, 1), 500)))
}

export async function carregarMais(idOrg: string, filtros: Filtros, cursor: string) {
  const fx = zFiltros.parse(filtros)
  return tentar(() => api.get<PaginaMovimentos>(comQuery(`/orgs/${id(idOrg)}/movimentos`, { ...fx, limite: 500, cursor: z.string().max(200).parse(cursor) })))
}

export async function sugestoes(idMov: string) {
  return tentar(() => api.get<Sugestao[]>(`/movimentos/${id(idMov)}/sugestoes`))
}

export async function baixasDo(idMov: string) {
  return tentar(() => api.get<Baixa[]>(`/movimentos/${id(idMov)}/baixas`))
}

const zAlocacoes = z.array(z.object({ idMovimento: zId, idTitulo: zId, valor: zValorPositivo })).min(1).max(100)

/**
 * Concilia uma ou mais alocações. 1 movimento → N títulos é UMA chamada (atômica no banco).
 * N movimentos → 1 título são N chamadas, uma por movimento: se uma falhar no meio, as anteriores
 * ficam (o retorno diz quantas) e a tela recarrega o estado real.
 */
export async function conciliar(idOrg: string, filtros: Filtros, limite: number, alocacoes: unknown, origem: 'manual' | 'sugestao') {
  const al = zAlocacoes.parse(alocacoes)
  const porMov = new Map<string, { id_titulo: string; valor: number }[]>()
  for (const a of al) (porMov.get(a.idMovimento) ?? porMov.set(a.idMovimento, []).get(a.idMovimento)!).push({ id_titulo: a.idTitulo, valor: a.valor })
  return eDepois(idOrg, filtros, limite, async () => {
    const baixas: string[] = []
    for (const [mov, itens] of porMov) {
      const r = await api.post<{ baixas: string[] }>(`/movimentos/${mov}/conciliar`, { itens, origem: origem === 'sugestao' ? 'sugestao' : 'manual' })
      baixas.push(...r.baixas)
    }
    return { baixas }
  })
}

export async function lancar(idOrg: string, filtros: Filtros, limite: number, idMov: string, dados: unknown) {
  const b = bLancarEConciliar.parse(dados)
  return eDepois(idOrg, filtros, limite, () => api.post<{ id: string }>(`/movimentos/${id(idMov)}/lancar-e-conciliar`, b))
}

export async function ignorar(idOrg: string, filtros: Filtros, limite: number, idMov: string, dados: unknown) {
  const b = bIgnorar.parse(dados)
  return eDepois(idOrg, filtros, limite, () => api.post(`/movimentos/${id(idMov)}/ignorar`, b))
}

export async function desfazerIgnorar(idOrg: string, filtros: Filtros, limite: number, idMov: string) {
  return eDepois(idOrg, filtros, limite, () => api.post(`/movimentos/${id(idMov)}/desfazer-ignorar`))
}

export async function transferir(idOrg: string, filtros: Filtros, limite: number, saida: string, entrada: string) {
  return eDepois(idOrg, filtros, limite, () => api.post<{ id: string }>('/transferencias', { id_mov_saida: id(saida), id_mov_entrada: id(entrada) }))
}

export async function desfazerTransferencia(idOrg: string, filtros: Filtros, limite: number, idTransf: string, motivo: string) {
  const m = z.string().trim().min(5).max(1000).parse(motivo)
  return eDepois(idOrg, filtros, limite, () => api.post(`/transferencias/${id(idTransf)}/desfazer`, { motivo: m }))
}

export async function desconciliar(idOrg: string, filtros: Filtros, limite: number, idsBaixa: string[], motivo: string) {
  const ids = z.array(zId).min(1).max(100).parse(idsBaixa)
  const m = z.string().trim().min(5).max(1000).parse(motivo)
  return eDepois(idOrg, filtros, limite, async () => { for (const b of ids) await api.post(`/baixas/${b}/desconciliar`, { motivo: m }) })
}

/** Desfazer "lançar e conciliar": desconcilia a baixa do título criado e cancela o título. */
export async function desfazerLancamento(idOrg: string, filtros: Filtros, limite: number, idMov: string, idTitulo: string) {
  const [mov, tit] = [id(idMov), id(idTitulo)]
  return eDepois(idOrg, filtros, limite, async () => {
    const baixas = await api.get<Baixa[]>(`/movimentos/${mov}/baixas`)
    for (const b of baixas.filter((x) => x.id_titulo === tit))
      await api.post(`/baixas/${b.id_baixa}/desconciliar`, { motivo: 'desfeito na conciliação (atalho U)' })
    await api.post(`/titulos/${tit}/cancelar`, { motivo: 'desfeito na conciliação (atalho U)' })
  })
}

/** Par de uma transferência: mesmo valor absoluto, sinal oposto, outra conta, até 5 dias de distância. */
export async function candidatosTransferencia(idOrg: string, idMov: string, valor: number, data: string, conta: string) {
  const d = new Date(`${zData.parse(data)}T12:00:00Z`)
  const dia = (n: number) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10)
  const v = z.number().parse(valor)
  return tentar(async () => {
    const p = await api.get<PaginaMovimentos>(comQuery(`/orgs/${id(idOrg)}/movimentos`,
      { valor: Math.abs(v), de: dia(-5), ate: dia(5), status: 'pendente', limite: 50 }))
    return p.movimentos.filter((m: Movimento) => m.id_movimento !== idMov && m.id_conta !== conta && Math.sign(m.valor) === -Math.sign(v))
  })
}

export async function tempoIniciar(idOrg: string) {
  return tentar(() => api.post<{ id: string }>('/tempo/iniciar', { id_org: id(idOrg), etapa: z.enum(ETAPAS_TEMPO).parse('conciliacao') }))
}

export async function tempoParar() {
  return tentar(() => api.post('/tempo/parar', {}))
}
