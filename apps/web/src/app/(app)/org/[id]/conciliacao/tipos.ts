import type { EstadoMovimento, TipoTitulo } from '@vesso-fin/shared'

export interface Movimento {
  id_movimento: string; id_conta: string; data_movimento: string; valor: number
  descricao_bruta: string | null; contraparte_nome: string | null; origem: string
  status: EstadoMovimento; motivo_divergencia: string | null
  valor_conciliado: number; diferenca: number; n_titulos: number | null; id_transferencia: string | null
  ignorado_categoria: string | null; ignorado_motivo: string | null; removido_na_fonte_em: string | null
}
export interface PaginaMovimentos { movimentos: Movimento[]; contagem: Partial<Record<EstadoMovimento, number>>; proximo: string | null }
export interface Titulo {
  id_titulo: string; tipo: TipoTitulo; descricao: string; competencia: string; data_vencimento: string
  valor: number; valor_baixado: number; saldo: number; dias_atraso: number; faixa: string
  id_plano_conta: string | null; conta: string | null; contraparte: string | null
}
export interface Sugestao { id_titulo: string; descricao: string; saldo: number; data_vencimento: string; score: number; motivo: string }
export interface Baixa { id_baixa: string; id_titulo: string; valor: number; origem: string; descricao: string; tipo: TipoTitulo; competencia: string; conta: string | null }
export interface Conta { id_conta: string; apelido: string; instituicao: string | null; tipo: string }
export interface PlanoConta {
  id_plano_conta: string; codigo: string; nome: string; natureza: string; aceita_lancamento: boolean
  regra_competencia: string; generica: boolean
}
export interface Filtros { conta: string; de: string; ate: string; status?: EstadoMovimento }
export interface Dados { pagina: PaginaMovimentos; titulos: Titulo[] }
