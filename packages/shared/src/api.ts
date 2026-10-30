// Contrato da API (docs/PROMPT.md §8): entrada de cada rota, validada na API e reaproveitada no web.
import { z } from 'zod'
import { ESTADOS_MOVIMENTO, ETAPAS_TEMPO, TIPOS_TITULO } from './enums'

// z.guid e não z.uuid: o zod 4 recusa uuid fora das versões RFC, e o Postgres aceita qualquer um.
export const zId = z.guid()
export const zData = z.iso.date()
export const zCompetencia = zData.refine((d) => d.endsWith('-01'), 'competência é sempre o dia 1 do mês')
const zCentavos = z.number().refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'no máximo 2 casas decimais')
export const zValorPositivo = zCentavos.refine((v) => v > 0 && v < 1e12, 'valor tem que ser positivo')
// Mínimos iguais aos do banco: ignorar e reabrir pedem 10; desconciliar e cancelar, 5.
const zMotivo = z.string().trim().min(10, 'motivo com pelo menos 10 caracteres').max(1000)
const zMotivoCurto = z.string().trim().min(5, 'motivo com pelo menos 5 caracteres').max(1000)

export const CATEGORIAS_IGNORADO = ['duplicado_na_fonte', 'fora_do_escopo', 'estorno_compensado', 'legado', 'outro'] as const
export const FAIXAS_TITULO = ['vencido', 'hoje', '7_dias', '30_dias', 'depois'] as const

export const qMovimentos = z.object({
  conta: zId.optional(),
  de: zData.optional(),
  ate: zData.optional(),
  status: z.enum(ESTADOS_MOVIMENTO).optional(),
  q: z.string().trim().max(100).optional(),
  /** valor absoluto exato — usado para achar o par de uma transferência em outra conta */
  valor: z.coerce.number().positive().optional(),
  cursor: z.string().max(200).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
})
export const qTitulosAbertos = z.object({
  tipo: z.enum(TIPOS_TITULO).optional(),
  faixa: z.enum(FAIXAS_TITULO).optional(),
  q: z.string().trim().max(100).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
})
export const qPeriodo = z.object({ de: zCompetencia, ate: zCompetencia })
/** Detalhamento de uma célula do DRE/DFC: os lançamentos das contas `planos` no período. */
export const qFato = z.object({
  regime: z.enum(['competencia', 'caixa']),
  de: zCompetencia, ate: zCompetencia,
  planos: z.string().max(8000).transform((v) => v.split(',').filter(Boolean)).pipe(z.array(zId).min(1).max(200)),
})

export const bConciliar = z.object({
  itens: z.array(z.object({ id_titulo: zId, valor: zValorPositivo })).min(1).max(100),
  origem: z.enum(['manual', 'sugestao']).default('manual'),
})
export const bLancarEConciliar = z.object({
  id_plano_conta: zId,
  descricao: z.string().trim().min(1).max(300),
  id_centro_custo: zId.optional(),
  id_contraparte: zId.optional(),
  competencia: zCompetencia.optional(),
  valor: zValorPositivo.optional(),
})
export const bIgnorar = z.object({ categoria: z.enum(CATEGORIAS_IGNORADO), motivo: zMotivo })
export const bTransferencia = z.object({ id_mov_saida: zId, id_mov_entrada: zId })
export const bMotivo = z.object({ motivo: zMotivoCurto })
export const bReabrir = z.object({ motivo: zMotivo })
export const qCompetencia = z.object({ competencia: zCompetencia })
// Saldo da conta informado à mão (0007): conta sem extrato/API. Pode ser negativo (cheque especial, cartão).
export const bInformarSaldo = z.object({ data: zData, saldo: zCentavos.refine((v) => Math.abs(v) < 1e12, 'saldo fora do limite') })
export const bCriarTitulo = z.object({
  id_org: zId,
  id_entidade: zId,
  tipo: z.enum(TIPOS_TITULO),
  descricao: z.string().trim().min(1).max(300),
  valor: zValorPositivo,
  data_vencimento: zData,
  competencia: zCompetencia,
  id_plano_conta: zId.optional(),
  id_centro_custo: zId.optional(),
  id_contraparte: zId.optional(),
  parcelas: z.number().int().min(1).max(120).default(1),
})
export const bCategorizar = z.object({ id_plano_conta: zId, id_centro_custo: zId.optional(), competencia: zCompetencia.optional() })
export const SITUACOES_TITULO = ['todos', 'aberto', 'vencido', 'quitado', 'sem_categoria', 'generica', 'cancelado'] as const
export const qTitulos = z.object({
  tipo: z.enum(TIPOS_TITULO).optional(),
  situacao: z.enum(SITUACOES_TITULO).default('todos'),
  campo: z.enum(['competencia', 'vencimento']).default('competencia'),
  de: zCompetencia.optional(), ate: zCompetencia.optional(),
  plano: zId.optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
})
export const bCategorizarLote = z.object({ ids: z.array(zId).min(1).max(500), id_plano_conta: zId, competencia: zCompetencia.optional() })
export const bRevisar = z.object({ aprovar: z.boolean(), nota: z.string().trim().max(2000).optional() })
export const bTempoIniciar = z.object({ id_org: zId, etapa: z.enum(ETAPAS_TEMPO), competencia: zCompetencia.optional() })
export const bTempoParar = z.object({ nota: z.string().trim().max(1000).optional() })

/** Corpo de erro de toda resposta 4xx/5xx. `mensagem` já é texto para o usuário. */
export interface ErroApi { erro: 'nao_autenticado' | 'sem_permissao' | 'regra' | 'entrada_invalida' | 'nao_encontrado' | 'interno'; mensagem: string; campos?: Record<string, string[]> }
