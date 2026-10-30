'use client'

// Peças da tela de Lançamentos usadas também em A pagar / A receber: gaveta do título e modal de novo lançamento.
import { useEffect, useState } from 'react'
import { fmtBRL, SITUACOES_TITULO } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, estiloFiltro } from '@/components/vesso'
import { botaoPrimarioCompacto, botaoSecundarioCompacto, CampoRotulado, campoCompacto } from '@/components/fin-ui'
import Modal from '@/components/Modal'
import SeletorPlano, { type ContaPlano } from '@/components/SeletorPlano'
import * as A from './acoes'
import type { Detalhe, Entidade, TituloLinha } from './tipos'

export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const mesCurto = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}`
export const dataBR = (d: string) => d.split('-').reverse().join('/')
export const ym = (d?: string) => (d ? d.slice(0, 7) : '')
export const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
export const assinado = (t: TituloLinha, v: number) => (t.tipo === 'pagar' ? -v : v)

export const ROT_SIT: Record<(typeof SITUACOES_TITULO)[number], string> = {
  todos: 'Todos', aberto: 'Em aberto', vencido: 'Vencidos', quitado: 'Quitados', sem_categoria: 'A categorizar', generica: 'Em conta genérica', cancelado: 'Cancelados',
}

export function situacao(t: TituloLinha) {
  if (t.cancelado_em) return { icone: '—', texto: 'Cancelado', cor: theme.text3 }
  if (t.saldo <= 0) return { icone: '✓', texto: 'Quitado', cor: theme.positive }
  if (t.data_vencimento < hoje()) return { icone: '▲', texto: 'Vencido', cor: theme.negative }
  if (t.valor_baixado > 0) return { icone: '◐', texto: 'Parcial', cor: theme.warning }
  return { icone: '○', texto: 'Em aberto', cor: theme.text2 }
}

export function Gaveta({ id, plano, pode, onFechar, onMudou, onErro }: {
  id: string; plano: ContaPlano[]; pode: (a: string) => boolean; onFechar: () => void; onMudou: (t: string) => void; onErro: (t: string) => void
}) {
  const [d, setD] = useState<Detalhe | null>(null)
  const [conta, setConta] = useState<string | null>(null)
  const [comp, setComp] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    let vivo = true
    A.detalhe(id).then((r) => {
      if (!vivo) return
      if (!r.ok) { onErro(r.mensagem); onFechar(); return }
      setD(r.dados); setConta(r.dados.titulo.id_plano_conta); setComp(ym(r.dados.titulo.competencia))
    })
    return () => { vivo = false }
  }, [id, onErro, onFechar])
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onFechar])

  const t = d?.titulo
  const mudouCateg = t && (conta !== t.id_plano_conta || `${comp}-01` !== t.competencia)
  const salvar = async () => {
    if (!t || !conta) return
    setOcupado(true)
    const r = await A.categorizar(t.id_titulo, conta, `${comp}-01` !== t.competencia ? `${comp}-01` : undefined)
    setOcupado(false)
    if (r.ok) onMudou('Título atualizado'); else onErro(r.mensagem)
  }
  const cancelarTitulo = async () => {
    if (!t) return
    setOcupado(true)
    const r = await A.cancelar(t.id_titulo, motivo)
    setOcupado(false)
    if (r.ok) { onMudou('Título cancelado'); onFechar() } else onErro(r.mensagem)
  }

  return (
    <div role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onFechar()} style={{ position: 'fixed', inset: 0, zIndex: 65, background: 'rgba(17,23,25,.25)' }}>
      <aside role="dialog" aria-label="Detalhe do lançamento" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)', background: theme.surface, borderLeft: `1px solid ${theme.border}`, boxShadow: '-12px 0 32px rgba(17,23,25,.18)', overflowY: 'auto' }}>
        {!t ? <div style={{ padding: 24, fontSize: 12.5, color: theme.text3 }}>Carregando…</div> : (
          <div style={{ display: 'grid', gap: 18, padding: '22px 24px 32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>{t.tipo === 'receber' ? 'A receber' : 'A pagar'}{t.total_parcelas ? ` · parcela ${t.parcela}/${t.total_parcelas}` : ''}</div>
                <div style={{ fontFamily: theme.display, fontSize: 22, lineHeight: 1.25, marginTop: 4 }}>{t.descricao}</div>
              </div>
              <button onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', fontSize: 20, color: theme.text3, cursor: 'pointer', alignSelf: 'flex-start' }}>×</button>
            </div>
            <div style={{ fontFamily: theme.display, fontSize: 30, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontSize: 14, color: theme.text3, marginRight: 6 }}>R$</span>{fmtBRL(t.tipo === 'pagar' ? -t.valor : t.valor)}
              <span style={{ fontFamily: 'inherit', fontSize: 12.5, color: theme.text3, marginLeft: 10 }}>{t.saldo > 0 ? `saldo ${fmtBRL(t.saldo)}` : 'quitado'}</span>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 12.5, margin: 0 }}>
              <dt style={{ color: theme.text3 }}>Vencimento</dt><dd style={{ margin: 0 }}>{dataBR(t.data_vencimento)}</dd>
              <dt style={{ color: theme.text3 }}>Competência</dt><dd style={{ margin: 0 }}>{mesCurto(t.competencia)}</dd>
              <dt style={{ color: theme.text3 }}>Contraparte</dt><dd style={{ margin: 0 }}>{t.contraparte ?? '—'}</dd>
              <dt style={{ color: theme.text3 }}>Entidade</dt><dd style={{ margin: 0 }}>{t.entidade}</dd>
              <dt style={{ color: theme.text3 }}>Origem</dt><dd style={{ margin: 0 }}>{t.origem === 'legado' ? 'Histórico (financeiro_seis)' : t.origem}</dd>
              {t.observacao && <><dt style={{ color: theme.text3 }}>Observação</dt><dd style={{ margin: 0 }}>{t.observacao.replaceAll('_', ' ')}</dd></>}
              {t.cancelado_em && <><dt style={{ color: theme.text3 }}>Cancelado</dt><dd style={{ margin: 0 }}>{dataBR(t.cancelado_em.slice(0, 10))} — {t.motivo_cancelamento}</dd></>}
            </dl>

            {!t.cancelado_em && pode('categorizar') && (
              <section style={{ display: 'grid', gap: 10, padding: 14, background: theme.surface2, borderRadius: theme.radiusSm }}>
                <CampoRotulado rotulo="Conta do plano"><SeletorPlano plano={plano} valor={conta} onEscolher={(p) => setConta(p.id_plano_conta)} /></CampoRotulado>
                <CampoRotulado rotulo="Competência"><input type="month" value={comp} onChange={(e) => setComp(e.target.value)} style={{ ...campoCompacto, width: '100%', padding: '8px 11px' }} /></CampoRotulado>
                <button disabled={!mudouCateg || !conta || ocupado} onClick={salvar} style={{ ...botaoPrimario(!mudouCateg || !conta || ocupado), justifySelf: 'start' }}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
              </section>
            )}

            <section style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>Baixas · {d.baixas.filter((b) => !b.revertida_em).length}</div>
              {d.baixas.length === 0 ? <div style={{ fontSize: 12.5, color: theme.text3 }}>Nenhuma. Concilie na tela de Conciliação.</div> : d.baixas.map((b) => (
                <div key={b.id_baixa} style={{ fontSize: 12.5, display: 'flex', justifyContent: 'space-between', gap: 10, opacity: b.revertida_em ? 0.55 : 1, textDecoration: b.revertida_em ? 'line-through' : undefined }}>
                  <span>{dataBR(b.data_movimento)} · {b.conta_bancaria} · <span style={{ color: theme.text3 }}>{b.descricao_bruta}</span></span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(b.valor)}</span>
                </div>
              ))}
            </section>

            <section style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>Histórico</div>
              {d.eventos.length === 0 ? <div style={{ fontSize: 12.5, color: theme.text3 }}>Sem alterações registradas.</div> : d.eventos.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: theme.text2 }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: theme.text3 }}>{new Date(e.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span> · {descreverEvento(e, plano)}
                </div>
              ))}
            </section>

            {!t.cancelado_em && pode('lancar') && (
              <section style={{ display: 'grid', gap: 8, paddingTop: 14, borderTop: `1px solid ${theme.borderFaint}` }}>
                <CampoRotulado rotulo="Cancelar título" extra={<span style={{ color: theme.text3 }}>motivo obrigatório</span>}>
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: lançado em duplicidade" style={{ ...campoCompacto, width: '100%', padding: '8px 11px' }} />
                </CampoRotulado>
                <button disabled={motivo.trim().length < 5 || ocupado} onClick={cancelarTitulo} style={{ ...botaoSecundarioCompacto(motivo.trim().length < 5 || ocupado), justifySelf: 'start', color: theme.negative }}>Cancelar título</button>
              </section>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

function descreverEvento(e: Detalhe['eventos'][number], plano: ContaPlano[]): string {
  if (e.acao.toLowerCase() === 'insert') return 'Lançado'
  const a = e.antes ?? {}, n = e.depois ?? {}
  const partes: string[] = []
  const nome = (id: unknown) => { const p = plano.find((x) => x.id_plano_conta === id); return p ? `${p.codigo} ${p.nome}` : 'sem conta' }
  if (a.id_plano_conta !== n.id_plano_conta) partes.push(`conta: ${nome(a.id_plano_conta)} → ${nome(n.id_plano_conta)}`)
  if (a.competencia !== n.competencia && n.competencia) partes.push(`competência: ${mesCurto(String(a.competencia))} → ${mesCurto(String(n.competencia))}`)
  if (!a.cancelado_em && n.cancelado_em) partes.push(`cancelado (${n.motivo_cancelamento})`)
  if (a.valor !== n.valor) partes.push(`valor: ${fmtBRL(Number(a.valor))} → ${fmtBRL(Number(n.valor))}`)
  return partes.length ? partes.join(' · ') : 'Atualizado'
}

export function ModalNovo({ org, plano, entidades, mesAtual, onFechar, onCriado, onErro, tipoInicial = 'pagar' }: {
  org: { id: string }; plano: ContaPlano[]; entidades: Entidade[]; mesAtual: string; onFechar: () => void; onCriado: (n: number) => void; onErro: (t: string) => void
  tipoInicial?: 'pagar' | 'receber'
}) {
  const [tipo, setTipo] = useState<'pagar' | 'receber'>(tipoInicial)
  const [descricao, setDescricao] = useState('')
  const [valorTxt, setValorTxt] = useState('')
  const [venc, setVenc] = useState(hoje())
  const [comp, setComp] = useState(ym(mesAtual))
  const [conta, setConta] = useState<string | null>(null)
  const [entidade, setEntidade] = useState(entidades[0]?.id_entidade ?? '')
  const [parcelas, setParcelas] = useState(1)
  const [ocupado, setOcupado] = useState(false)
  const valor = Number(valorTxt.replace(/\./g, '').replace(',', '.'))
  const valorOk = Number.isFinite(valor) && valor > 0 && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6
  const ok = descricao.trim() && valorOk && venc && comp && entidade && parcelas >= 1 && parcelas <= 120
  const parcela = valorOk ? Math.round((valor / parcelas) * 100) / 100 : 0

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!ok) return
    setOcupado(true)
    const r = await A.criar({ id_org: org.id, id_entidade: entidade, tipo, descricao: descricao.trim(), valor, data_vencimento: venc, competencia: `${comp}-01`,
      ...(conta ? { id_plano_conta: conta } : {}), parcelas })
    setOcupado(false)
    if (r.ok) onCriado(r.dados.titulos.length); else onErro(r.mensagem)
  }

  return (
    <Modal titulo="Novo lançamento" sub="Um título a pagar ou a receber. Ele aparece na Conciliação para casar com o extrato." onFechar={onFechar} largura={560}>
      <form onSubmit={enviar} style={{ display: 'grid', gap: 14, padding: '18px 24px 22px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['pagar', 'receber'] as const).map((k) => (
            <button type="button" key={k} onClick={() => setTipo(k)} style={estiloFiltro(tipo === k)}>{k === 'pagar' ? 'A pagar' : 'A receber'}</button>
          ))}
        </div>
        <CampoRotulado rotulo="Descrição"><input autoFocus value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={300} style={{ ...campoCompacto, width: '100%', padding: '8px 11px' }} /></CampoRotulado>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <CampoRotulado rotulo="Valor total (R$)"><input value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} inputMode="decimal" placeholder="0,00" style={{ ...campoCompacto, width: '100%', padding: '8px 11px', textAlign: 'right' }} /></CampoRotulado>
          <CampoRotulado rotulo="1º vencimento"><input type="date" value={venc} onChange={(e) => { setVenc(e.target.value); if (e.target.value) setComp(e.target.value.slice(0, 7)) }} style={{ ...campoCompacto, width: '100%', padding: '8px 11px' }} /></CampoRotulado>
          <CampoRotulado rotulo="Competência"><input type="month" value={comp} onChange={(e) => setComp(e.target.value)} style={{ ...campoCompacto, width: '100%', padding: '8px 11px' }} /></CampoRotulado>
        </div>
        <CampoRotulado rotulo="Conta do plano" extra={<span style={{ color: theme.text3 }}>pode ficar para depois</span>}><SeletorPlano plano={plano} valor={conta} onEscolher={(p) => setConta(p.id_plano_conta)} /></CampoRotulado>
        <div style={{ display: 'grid', gridTemplateColumns: entidades.length > 1 ? '1fr 140px' : '140px', gap: 10 }}>
          {entidades.length > 1 && (
            <CampoRotulado rotulo="Empresa (CNPJ)">
              <select value={entidade} onChange={(e) => setEntidade(e.target.value)} style={{ ...campoCompacto, width: '100%', padding: '8px 11px' }}>
                {entidades.map((x) => <option key={x.id_entidade} value={x.id_entidade}>{x.nome_fantasia ?? x.razao_social}</option>)}
              </select>
            </CampoRotulado>
          )}
          <CampoRotulado rotulo="Parcelas"><input type="number" min={1} max={120} value={parcelas} onChange={(e) => setParcelas(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} style={{ ...campoCompacto, width: '100%', padding: '8px 11px' }} /></CampoRotulado>
        </div>
        {parcelas > 1 && valorOk && <div style={{ fontSize: 12, color: theme.text2 }}>{parcelas} parcelas mensais de R$ {fmtBRL(parcela)} (a última leva os centavos), uma por competência a partir de {mesCurto(`${comp}-01`)}.</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onFechar} style={botaoSecundarioCompacto()}>Cancelar</button>
          <button type="submit" disabled={!ok || ocupado} style={botaoPrimarioCompacto(!ok || ocupado)}>{ocupado ? 'Lançando…' : parcelas > 1 ? `Lançar ${parcelas} parcelas` : 'Lançar'}</button>
        </div>
      </form>
    </Modal>
  )
}
