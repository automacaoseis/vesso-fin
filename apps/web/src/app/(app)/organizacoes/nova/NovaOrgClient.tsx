'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { REGIMES } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, estiloCampo, estiloFiltro } from '@/components/vesso'
import { CampoRotulado, Painel } from '@/components/fin-ui'
import BuscaCliente from '../BuscaCliente'
import { criarOrg, type ClienteBusca } from '../acoes'

export interface Opcoes {
  pode_cadastrar: boolean; eh_dono: boolean
  turmas: { codigo: string; nome: string }[]
  modelos: { id_modelo: string; nome: string; itens: number }[]
  orgs_com_plano: { id_org: string; nome: string; tipo: string; itens: number }[]
}
const ROT_REGIME: Record<(typeof REGIMES)[number], string> = { mei: 'MEI', simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' }
const mascaraCnpj = (v: string) => v.replace(/\D/g, '').slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2')

export default function NovaOrgClient({ op, competenciaPadrao }: { op: Opcoes; competenciaPadrao: string }) {
  const router = useRouter()
  const [tipo, setTipo] = useState<'cliente' | 'casa'>('cliente')
  const [cliente, setCliente] = useState<ClienteBusca | null>(null)
  const [nome, setNome] = useState('')
  const [razao, setRazao] = useState('')
  const [fantasia, setFantasia] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [regime, setRegime] = useState<string>('simples')
  const [comp, setComp] = useState(competenciaPadrao)
  const [turma, setTurma] = useState<string>('A')
  const [plano, setPlano] = useState<string>(op.modelos[0] ? `m:${op.modelos[0].id_modelo}` : op.orgs_com_plano[0] ? `o:${op.orgs_com_plano[0].id_org}` : '')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ok = nome.trim().length >= 2 && cnpj.replace(/\D/g, '').length === 14 && comp && (tipo === 'casa' || cliente)

  async function enviar(e: React.FormEvent) {
    e.preventDefault(); if (!ok) return
    setOcupado(true); setErro(null)
    const r = await criarOrg({
      nome, tipo, id_cliente: tipo === 'cliente' ? cliente!.id_cliente : null, razao_social: razao || undefined, nome_fantasia: fantasia || undefined,
      cnpj, regime: regime || null, competencia_inicial: `${comp}-01`, turma: turma || null,
      copiar_plano_de: plano.startsWith('o:') ? plano.slice(2) : null, id_modelo: plano.startsWith('m:') ? plano.slice(2) : null,
    })
    setOcupado(false)
    if (!r.ok) return setErro(r.mensagem)
    router.push(`/org/${r.dados.id}/cadastro`)
    router.refresh()  // o layout (menu) guarda a lista de orgs: sem isto a org nova abre com o menu geral
  }

  return (
    <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      {op.eh_dono && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => setTipo('cliente')} style={estiloFiltro(tipo === 'cliente')}>Cliente do BPO</button>
          <button type="button" onClick={() => { setTipo('casa'); setCliente(null) }} style={estiloFiltro(tipo === 'casa')}>Empresa da casa</button>
        </div>
      )}
      <Painel rotulo="Organização">
        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {tipo === 'cliente' && <CampoRotulado rotulo="Cliente no portal" extra={<span style={{ color: theme.text3 }}>o médico vê o financeiro por ele</span>}><BuscaCliente valor={cliente} onEscolher={(c) => { setCliente(c); if (c && !nome) setNome(c.nome) }} /></CampoRotulado>}
          <CampoRotulado rotulo="Nome (como aparece no sistema)"><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Clínica Dra. Ana" style={estiloCampo} /></CampoRotulado>
          <CampoRotulado rotulo="Competência inicial" extra={<span style={{ color: theme.text3 }}>a partir de quando o BPO cobra rotina</span>}><input type="month" value={comp} onChange={(e) => setComp(e.target.value)} style={estiloCampo} /></CampoRotulado>
          <CampoRotulado rotulo="Turma de fechamento">
            <select value={turma} onChange={(e) => setTurma(e.target.value)} style={estiloCampo}>
              <option value="">Sem turma</option>
              {op.turmas.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
            </select>
          </CampoRotulado>
        </div>
      </Painel>
      <Painel rotulo="Entidade principal (CNPJ)">
        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <CampoRotulado rotulo="CNPJ"><input value={cnpj} onChange={(e) => setCnpj(mascaraCnpj(e.target.value))} placeholder="00.000.000/0000-00" inputMode="numeric" style={estiloCampo} /></CampoRotulado>
          <CampoRotulado rotulo="Razão social" extra={<span style={{ color: theme.text3 }}>vazio = o nome</span>}><input value={razao} onChange={(e) => setRazao(e.target.value)} style={estiloCampo} /></CampoRotulado>
          <CampoRotulado rotulo="Nome fantasia"><input value={fantasia} onChange={(e) => setFantasia(e.target.value)} style={estiloCampo} /></CampoRotulado>
          <CampoRotulado rotulo="Regime tributário">
            <select value={regime} onChange={(e) => setRegime(e.target.value)} style={estiloCampo}>
              <option value="">Não sei ainda</option>
              {REGIMES.map((r) => <option key={r} value={r}>{ROT_REGIME[r]}</option>)}
            </select>
          </CampoRotulado>
        </div>
      </Painel>
      <Painel rotulo="Plano de contas">
        <div style={{ padding: '14px 16px', display: 'grid', gap: 8 }}>
          <select value={plano} onChange={(e) => setPlano(e.target.value)} aria-label="Plano de contas" style={estiloCampo}>
            {op.modelos.map((m) => <option key={m.id_modelo} value={`m:${m.id_modelo}`}>Modelo: {m.nome} ({m.itens} contas)</option>)}
            {op.orgs_com_plano.map((o) => <option key={o.id_org} value={`o:${o.id_org}`}>Copiar de {o.nome}{o.tipo === 'casa' ? ' (casa)' : ''} ({o.itens} contas)</option>)}
            <option value="">Começar vazio</option>
          </select>
          <div style={{ fontSize: 11.5, color: theme.text3 }}>A cópia é independente: mudar o plano desta organização não mexe na de origem.{op.modelos.length === 0 && ' Ainda não há modelo cadastrado (ex.: "Clínica médica").'}</div>
        </div>
      </Painel>
      {erro && <div role="alert" style={{ fontSize: 13, color: theme.negative }}>▲ {erro}</div>}
      <button type="submit" disabled={!ok || ocupado} style={{ ...botaoPrimario(!ok || ocupado), alignSelf: 'flex-start' }}>{ocupado ? 'Criando…' : 'Criar organização'}</button>
    </form>
  )
}
