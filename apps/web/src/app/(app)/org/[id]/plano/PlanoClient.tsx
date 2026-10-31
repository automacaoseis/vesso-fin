'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { LINHAS_DRE, NATUREZAS, REGRAS_COMPETENCIA } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloFiltro } from '@/components/vesso'
import { Aviso, botaoSecundarioCompacto, campoCompacto, Painel } from '@/components/fin-ui'
import * as A from './acoes'

export interface ContaDoPlano {
  id_plano_conta: string; id_pai: string | null; codigo: string; nome: string; natureza: (typeof NATUREZAS)[number]
  aceita_lancamento: boolean; entra_dre: boolean; entra_dfc: boolean; grupo_dfc: string | null; linha_dre: string | null
  regra_competencia: (typeof REGRAS_COMPETENCIA)[number]; generica: boolean; sensivel: boolean; ativa: boolean; titulos: number
}
type Res = { ok: boolean; mensagem?: string }
const ROT_NAT: Record<string, string> = {
  grupo: 'Grupo', receita: 'Receita', deducao: 'Dedução', custo: 'Custo', despesa: 'Despesa', investimento: 'Investimento',
  financeira_receita: 'Receita financeira', financeira_despesa: 'Despesa financeira', imposto: 'Imposto', retirada: 'Retirada do sócio',
  transferencia: 'Transferência', aplicacao: 'Aplicação',
}
const ROT_LINHA: Record<string, string> = {
  RECEITA_BRUTA: 'Receita bruta', DEDUCOES: 'Deduções', CUSTOS_VARIAVEIS: 'Custos variáveis', FOLHA: 'Folha',
  DESPESAS_FIXAS_OUTRAS: 'Despesas fixas', DESPESAS_FIXAS: 'Despesas fixas', INVEST_CRESCIMENTO: 'Investimento em crescimento',
  RECEITAS_FINANCEIRAS: 'Receitas financeiras', DESPESAS_FINANCEIRAS: 'Despesas financeiras', IMPOSTO_LUCRO: 'Imposto',
}
const ROT_REGRA: Record<string, string> = { mes_corrente: 'mês do pagamento', mes_anterior: 'mês anterior ao pagamento', manual: 'escolher a cada lançamento' }
// natureza → linha do DRE sugerida (quem cria pode trocar)
const LINHA_SUGERIDA: Partial<Record<string, string>> = {
  receita: 'RECEITA_BRUTA', deducao: 'DEDUCOES', custo: 'CUSTOS_VARIAVEIS', despesa: 'DESPESAS_FIXAS_OUTRAS', investimento: 'INVEST_CRESCIMENTO',
  financeira_receita: 'RECEITAS_FINANCEIRAS', financeira_despesa: 'DESPESAS_FINANCEIRAS', imposto: 'IMPOSTO_LUCRO',
}
const FORA_DRE = new Set(['grupo', 'transferencia', 'retirada', 'aplicacao'])
const codigoDe = (nome: string, grupo: boolean) =>
  `${grupo ? 'G_' : 'CAT_'}${nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)}`

export default function PlanoClient({ org, plano }: { org: { id: string; nome: string; pode: boolean }; plano: ContaDoPlano[] }) {
  const router = useRouter()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 9000 : 3000); return () => clearTimeout(t) }, [aviso])
  const feito = (r: Res, ok: string) => { if (!r.ok) { setAviso({ tipo: 'erro', texto: r.mensagem ?? 'Não deu' }); return false } setAviso({ tipo: 'ok', texto: ok }); router.refresh(); return true }
  const [inativas, setInativas] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [criandoEm, setCriandoEm] = useState<string | null | undefined>(undefined)  // undefined = fechado; null = grupo novo
  const grupos = useMemo(() => plano.filter((p) => p.natureza === 'grupo'), [plano])
  const vis = (p: ContaDoPlano) => inativas || p.ativa
  const blocos = [
    ...grupos.filter(vis).map((g) => ({ grupo: g as ContaDoPlano | null, contas: plano.filter((p) => p.id_pai === g.id_plano_conta && p.natureza !== 'grupo' && vis(p)) })),
    { grupo: null, contas: plano.filter((p) => p.natureza !== 'grupo' && (!p.id_pai || !grupos.some((g) => g.id_plano_conta === p.id_pai)) && vis(p)) },
  ].filter((b) => b.grupo || b.contas.length)
  const genericas = plano.filter((p) => p.generica && p.ativa).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `1px solid ${theme.borderStrong}` }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent }}>
            <Link href={`/org/${org.id}/cadastro`} style={{ color: 'inherit', textDecoration: 'none' }}>Cadastro</Link> · {org.nome}
          </div>
          <h1 className="v-manchete" style={{ fontFamily: theme.display, fontSize: 32, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '6px 0 0' }}>Plano de contas</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setInativas(!inativas)} style={estiloFiltro(inativas)}>Mostrar desativadas</button>
          {org.pode && <button onClick={() => setCriandoEm(criandoEm === null ? undefined : null)} style={botaoSecundarioCompacto()}>+ Grupo</button>}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: theme.text2 }}>
        {plano.filter((p) => p.aceita_lancamento && p.ativa).length} contas recebem lançamento, em {grupos.length} grupo{grupos.length === 1 ? '' : 's'}.
        {genericas > 0 && <> {genericas} genérica{genericas > 1 ? 's' : ''} (&quot;Outros&quot;): lançamento nelas bloqueia o fechamento até ser reclassificado.</>}
      </div>
      {criandoEm === null && org.pode && <FormNova idOrg={org.id} pai={null} grupo onFeito={(r) => { if (feito(r, 'Grupo criado')) setCriandoEm(undefined) }} onCancelar={() => setCriandoEm(undefined)} />}

      {blocos.map(({ grupo, contas }) => (
        <Painel key={grupo?.id_plano_conta ?? 'sem'} aria-label={grupo?.nome ?? 'Sem grupo'}
          rotulo={<span style={{ opacity: grupo && !grupo.ativa ? 0.5 : 1 }}>{grupo ? grupo.nome : 'Sem grupo'}{grupo && !grupo.ativa && ' (desativado)'} · {contas.length}</span>}
          direita={org.pode && grupo ? (
            <span style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setEditando(editando === grupo.id_plano_conta ? null : grupo.id_plano_conta)} style={botaoSecundarioCompacto()}>Editar grupo</button>
              {grupo.ativa && <button onClick={() => setCriandoEm(criandoEm === grupo.id_plano_conta ? undefined : grupo.id_plano_conta)} style={botaoSecundarioCompacto()}>+ Conta</button>}
            </span>) : undefined}>
          {grupo && editando === grupo.id_plano_conta && <FormEditar c={grupo} grupos={grupos} onFeito={(r) => { if (feito(r, 'Grupo salvo')) setEditando(null) }} onCancelar={() => setEditando(null)} />}
          {contas.map((c) => (
            <div key={c.id_plano_conta}>
              <div onClick={org.pode ? () => setEditando(editando === c.id_plano_conta ? null : c.id_plano_conta) : undefined}
                style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2.2fr) 1.1fr 1.3fr 1.4fr 70px', gap: 10, padding: '9px 16px', borderBottom: `1px solid ${theme.borderFaint}`,
                  fontSize: 12.5, cursor: org.pode ? 'pointer' : 'default', opacity: c.ativa ? 1 : 0.5, background: editando === c.id_plano_conta ? theme.surface2 : 'transparent' }}>
                <span><strong style={{ fontWeight: 600 }}>{c.nome}</strong> <span style={{ color: theme.text3, fontSize: 11 }}>{c.codigo}</span>
                  {c.generica && <span style={{ color: theme.warning }}> · genérica</span>}{c.sensivel && <span style={{ color: theme.text3 }}> · sensível</span>}{!c.ativa && <span> · desativada</span>}</span>
                <span style={{ color: theme.text2 }}>{ROT_NAT[c.natureza]}</span>
                <span style={{ color: c.linha_dre ? theme.text : theme.text3 }}>{c.linha_dre ? ROT_LINHA[c.linha_dre] ?? c.linha_dre : 'fora do DRE'}</span>
                <span style={{ color: theme.text3 }}>{ROT_REGRA[c.regra_competencia]}</span>
                <span style={{ color: theme.text3, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.titulos || '—'}</span>
              </div>
              {editando === c.id_plano_conta && <FormEditar c={c} grupos={grupos} onFeito={(r) => { if (feito(r, 'Conta salva')) setEditando(null) }} onCancelar={() => setEditando(null)} />}
            </div>
          ))}
          {grupo && criandoEm === grupo.id_plano_conta && <FormNova idOrg={org.id} pai={grupo.id_plano_conta} onFeito={(r) => { if (feito(r, 'Conta criada')) setCriandoEm(undefined) }} onCancelar={() => setCriandoEm(undefined)} />}
          {contas.length === 0 && !(grupo && criandoEm === grupo.id_plano_conta) && <div style={{ padding: '10px 16px', fontSize: 12, color: theme.text3 }}>Grupo vazio.</div>}
        </Painel>
      ))}
      <div style={{ fontSize: 11.5, color: theme.text3, lineHeight: 1.6 }}>
        Colunas: conta · natureza · linha do DRE · competência sugerida · títulos lançados. A natureza não muda depois de criada (mudaria o sinal do que já foi lançado);
        a linha do DRE não muda em conta com lançamento em mês fechado — crie uma conta nova ou reabra o mês. Desativar tira a conta dos seletores; o histórico continua.
      </div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}

function Campos({ v, set, natureza }: { v: Record<string, unknown>; set: (k: string, x: unknown) => void; natureza: string }) {
  const grupo = natureza === 'grupo'
  return (
    <>
      {!grupo && (
        <select value={(v.linha_dre as string) ?? ''} onChange={(e) => set('linha_dre', e.target.value || null)} aria-label="Linha do DRE" disabled={FORA_DRE.has(natureza)} style={{ ...campoCompacto, padding: '7px 10px' }}>
          <option value="">Fora do DRE</option>
          {LINHAS_DRE.filter((l) => l !== 'DESPESAS_FIXAS').map((l) => <option key={l} value={l}>{ROT_LINHA[l]}</option>)}
        </select>
      )}
      {!grupo && (
        <select value={(v.regra as string) ?? 'mes_corrente'} onChange={(e) => set('regra', e.target.value)} aria-label="Competência sugerida" style={{ ...campoCompacto, padding: '7px 10px' }}>
          {REGRAS_COMPETENCIA.map((r) => <option key={r} value={r}>Competência: {ROT_REGRA[r]}</option>)}
        </select>
      )}
      {!grupo && <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={!!v.generica} onChange={(e) => set('generica', e.target.checked)} /> genérica (&quot;Outros&quot;)</label>}
      {!grupo && <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={!!v.sensivel} onChange={(e) => set('sensivel', e.target.checked)} /> sensível</label>}
    </>
  )
}

function FormEditar({ c, grupos, onFeito, onCancelar }: { c: ContaDoPlano; grupos: ContaDoPlano[]; onFeito: (r: Res) => void; onCancelar: () => void }) {
  const [v, setV] = useState<Record<string, unknown>>({ nome: c.nome, id_pai: c.id_pai, linha_dre: c.linha_dre, grupo_dfc: c.grupo_dfc, regra: c.regra_competencia, generica: c.generica, sensivel: c.sensivel, ativa: c.ativa })
  const set = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x }))
  const [ocupado, setOcupado] = useState(false)
  return (
    <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 16px', background: theme.surface2, borderBottom: `1px solid ${theme.border}` }}
      onSubmit={async (e) => { e.preventDefault(); setOcupado(true); const r = await A.editarConta(c.id_plano_conta, v); setOcupado(false); onFeito(r as Res) }}>
      <input value={v.nome as string} onChange={(e) => set('nome', e.target.value)} aria-label="Nome" style={{ ...campoCompacto, padding: '7px 10px', flex: '1 1 220px' }} />
      {c.natureza !== 'grupo' && (
        <select value={(v.id_pai as string) ?? ''} onChange={(e) => set('id_pai', e.target.value || null)} aria-label="Grupo" style={{ ...campoCompacto, padding: '7px 10px' }}>
          <option value="">Sem grupo</option>
          {grupos.map((g) => <option key={g.id_plano_conta} value={g.id_plano_conta}>{g.nome}</option>)}
        </select>
      )}
      <Campos v={v} set={set} natureza={c.natureza} />
      <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={!!v.ativa} onChange={(e) => set('ativa', e.target.checked)} /> ativa</label>
      <button type="submit" disabled={ocupado} style={botaoPrimario(ocupado)}>Salvar</button>
      <button type="button" onClick={onCancelar} style={botaoSecundario()}>Cancelar</button>
      {c.titulos > 0 && <span style={{ flexBasis: '100%', fontSize: 11.5, color: theme.text3 }}>{c.titulos} título{c.titulos > 1 ? 's' : ''} nesta conta. Natureza: {ROT_NAT[c.natureza]} (fixa).</span>}
    </form>
  )
}

function FormNova({ idOrg, pai, grupo, onFeito, onCancelar }: { idOrg: string; pai: string | null; grupo?: boolean; onFeito: (r: Res) => void; onCancelar: () => void }) {
  const [natureza, setNatureza] = useState<string>(grupo ? 'grupo' : 'despesa')
  const [v, setV] = useState<Record<string, unknown>>({ nome: '', linha_dre: grupo ? null : 'DESPESAS_FIXAS_OUTRAS', regra: 'mes_corrente', generica: false, sensivel: false })
  const [codigo, setCodigo] = useState('')
  const set = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x }))
  const [ocupado, setOcupado] = useState(false)
  const cod = codigo || codigoDe((v.nome as string) ?? '', !!grupo)
  return (
    <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 16px', background: theme.surface2, borderBottom: `1px solid ${theme.border}` }}
      onSubmit={async (e) => {
        e.preventDefault(); setOcupado(true)
        const r = await A.criarConta(idOrg, { ...v, codigo: cod, natureza, id_pai: pai, grupo_dfc: null, linha_dre: FORA_DRE.has(natureza) ? null : v.linha_dre })
        setOcupado(false); onFeito(r as Res)
      }}>
      <input value={v.nome as string} onChange={(e) => set('nome', e.target.value)} placeholder={grupo ? 'Nome do grupo' : 'Nome da conta'} autoFocus aria-label="Nome" style={{ ...campoCompacto, padding: '7px 10px', flex: '1 1 200px' }} />
      <input value={cod} onChange={(e) => setCodigo(e.target.value.toUpperCase())} aria-label="Código" title="código (gerado do nome)" style={{ ...campoCompacto, padding: '7px 10px', width: 200, fontSize: 11 }} />
      {!grupo && (
        <select value={natureza} onChange={(e) => { setNatureza(e.target.value); set('linha_dre', LINHA_SUGERIDA[e.target.value] ?? null) }} aria-label="Natureza" style={{ ...campoCompacto, padding: '7px 10px' }}>
          {NATUREZAS.filter((n) => n !== 'grupo').map((n) => <option key={n} value={n}>{ROT_NAT[n]}</option>)}
        </select>
      )}
      <Campos v={v} set={set} natureza={natureza} />
      <button type="submit" disabled={ocupado || ((v.nome as string) ?? '').trim().length < 2} style={botaoPrimario(ocupado || ((v.nome as string) ?? '').trim().length < 2)}>Criar</button>
      <button type="button" onClick={onCancelar} style={botaoSecundario()}>Cancelar</button>
    </form>
  )
}
