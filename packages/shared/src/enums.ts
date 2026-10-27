// Espelho dos CHECKs e estados de sql/0001. Se o banco mudar, mude aqui.

export const ESTADOS_MOVIMENTO = ['conciliado', 'pendente', 'divergente', 'ignorado'] as const
export type EstadoMovimento = (typeof ESTADOS_MOVIMENTO)[number]

export const STATUS_FECHAMENTO = ['aberto', 'em_revisao', 'fechado', 'liberado'] as const
export type StatusFechamento = (typeof STATUS_FECHAMENTO)[number]

export const TIPOS_TITULO = ['pagar', 'receber'] as const
export type TipoTitulo = (typeof TIPOS_TITULO)[number]

export const ACOES = [
  'ver', 'importar', 'conciliar', 'ignorar', 'lancar', 'categorizar',
  'enviar_revisao', 'revisar', 'liberar', 'reabrir', 'configurar_org', 'registrar_tempo',
] as const
export type Acao = (typeof ACOES)[number]

export const PAPEIS = ['leitura', 'analista', 'revisor', 'head'] as const
export type Papel = (typeof PAPEIS)[number]

export const ETAPAS_TEMPO = [
  'importacao', 'conciliacao', 'categorizacao', 'contas_pagar', 'contas_receber',
  'documentos', 'fechamento', 'revisao', 'reuniao_cliente', 'implantacao', 'outro',
] as const
export type EtapaTempo = (typeof ETAPAS_TEMPO)[number]

export const ORIGENS_MOVIMENTO = ['ofx', 'csv', 'asaas', 'open_finance', 'adquirente', 'manual', 'legado'] as const
export type OrigemMovimento = (typeof ORIGENS_MOVIMENTO)[number]

export const TIPOS_ORG = ['cliente', 'casa'] as const
export const STATUS_ORG = ['raio_x', 'onboarding', 'ativa', 'encerrada'] as const
