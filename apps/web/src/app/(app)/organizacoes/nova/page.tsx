import type { Metadata } from 'next'
import PageHero from '@/components/PageHero'
import { EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import { deslocarMes, mesAtualSP } from '@/lib/datas'
import NovaOrgClient, { type Opcoes } from './NovaOrgClient'

export const metadata: Metadata = { title: 'Nova organização' }

// docs/PROMPT.md §7 (Fase 1b): cadastro mínimo. Regras no banco (0011: fn_criar_organizacao).
export default async function NovaOrg() {
  const op = await api.get<Opcoes>('/cadastro/opcoes')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHero eyebrow="Cadastro" titulo="Nova organização"
        descricao="Uma organização por CNPJ principal. Ela nasce em implantação, com a entidade e o plano de contas; contas bancárias e conexões você acrescenta na página de cadastro dela." />
      {op.pode_cadastrar ? <NovaOrgClient op={op} competenciaPadrao={deslocarMes(mesAtualSP(), 1)} />
        : <EmptyState>Cadastrar organização é com o dono ou o head do produto.</EmptyState>}
    </div>
  )
}
