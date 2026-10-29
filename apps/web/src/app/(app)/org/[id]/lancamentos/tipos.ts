export interface TituloLinha {
  id_titulo: string; tipo: 'pagar' | 'receber'; descricao: string; valor: number; valor_baixado: number; saldo: number
  data_vencimento: string; competencia: string; id_plano_conta: string | null; codigo: string | null; conta: string | null; generica: boolean
  contraparte: string | null; origem: string; observacao: string | null; parcela: number | null; total_parcelas: number | null; cancelado_em: string | null
}
export interface Resumo { qtd: number; receber: number; pagar: number; receber_aberto: number; pagar_aberto: number; sem_categoria: number; generica: number; vencidos: number }
export interface Pagina { titulos: TituloLinha[]; resumo: Resumo; proximo: string | null }
export interface Entidade { id_entidade: string; razao_social: string; nome_fantasia: string | null; cnpj: string }
export interface Detalhe {
  titulo: TituloLinha & { entidade: string; data_emissao: string | null; motivo_cancelamento: string | null; created_at: string }
  baixas: { id_baixa: string; valor: number; origem: string; criado_em: string; revertida_em: string | null; motivo_reversao: string | null; data_movimento: string; descricao_bruta: string | null; valor_movimento: number; conta_bancaria: string }[]
  eventos: { acao: string; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; por: string | null; em: string }[]
}
export interface Filtros { tipo?: 'pagar' | 'receber'; situacao: string; campo: 'competencia' | 'vencimento'; de?: string; ate?: string; plano?: string; q?: string }
