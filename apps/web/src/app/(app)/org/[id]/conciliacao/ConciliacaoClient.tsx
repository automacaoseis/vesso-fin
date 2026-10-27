'use client'

// Conciliação (docs/PROMPT.md §7) — a tela que decide a margem do produto.
// Extrato à esquerda; à direita, sugestões e títulos em aberto na direção do movimento em foco.
// Teclado: j/k · espaço · Enter · 1–5 · L · T · I · U · / · Esc · ?
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { alocar, centavos, fmtBRL, reais, type EstadoMovimento } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'
import type { Resultado } from '@/lib/api'
import * as A from './acoes'
import { ModalAjuda, ModalDesconciliar, ModalIgnorar, ModalLancar, ModalMotivo, ModalTransferir } from './Modais'
import type { Conta, Dados, Filtros, Movimento, PlanoConta, Sugestao, Titulo } from './tipos'

type Desfazer =
  | { tipo: 'conciliar'; baixas: string[]; rotulo: string }
  | { tipo: 'lancar'; idMov: string; idTitulo: string; rotulo: string }
  | { tipo: 'ignorar'; idMov: string; rotulo: string }
  | { tipo: 'transferencia'; id: string; rotulo: string }
  | { tipo: 'sem_desfazer'; rotulo: string }

type Modal = null | 'lancar' | 'ignorar' | 'transferir' | 'desconciliar' | 'desfazer_transf' | 'ajuda'

const ESTADO: Record<EstadoMovimento, { icone: string; rotulo: string; classe: string; ic: string }> = {
  conciliado: { icone: '✓', rotulo: 'Conciliado', classe: 'f-st-conciliado', ic: 'f-ic-ok' },
  pendente: { icone: '○', rotulo: 'Pendente', classe: 'f-st-pendente', ic: 'f-ic-pend' },
  divergente: { icone: '▲', rotulo: 'Divergente', classe: 'f-st-divergente', ic: 'f-ic-div' },
  ignorado: { icone: '—', rotulo: 'Ignorado', classe: 'f-st-ignorado', ic: '' },
}
const ABERTO = (m: Movimento) => m.status === 'pendente' || m.status === 'divergente'
/** O que falta conciliar no movimento, em reais, sem sinal. */
const restante = (m: Movimento) => (m.status === 'pendente' ? Math.abs(m.valor) : Math.max(0, m.diferenca))
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
/** "Δ −R$ 12,40": sinal do lado do movimento (saída negativa). */
export const deltaTxt = (c: number) => `Δ ${c < 0 ? '−' : ''}R$ ${fmtBRL(Math.abs(c) / 100)}`
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function digitando(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

export default function ConciliacaoClient({ org, contas, plano, mes, filtros, inicial }: {
  org: { id: string; nome: string; acoes: string[] }
  contas: Conta[]; plano: PlanoConta[]; mes: string; filtros: Filtros; inicial: Dados
}) {
  const router = useRouter()
  const pode = (a: string) => org.acoes.includes(a)

  const [movs, setMovs] = useState(inicial.pagina.movimentos)
  const [proximo, setProximo] = useState(inicial.pagina.proximo)
  const [contagem, setContagem] = useState(inicial.pagina.contagem)
  const [titulos, setTitulos] = useState(inicial.titulos)
  const [busca, setBusca] = useState('')
  const [buscaTit, setBuscaTit] = useState('')
  const [focoId, setFocoId] = useState<string | null>(inicial.pagina.movimentos.find(ABERTO)?.id_movimento ?? inicial.pagina.movimentos[0]?.id_movimento ?? null)
  const [selMov, setSelMov] = useState<string[]>([])
  const [selTit, setSelTit] = useState<string[]>([])
  const [daSugestao, setDaSugestao] = useState(false)
  const [sugs, setSugs] = useState<Record<string, Sugestao[] | 'carregando'>>({})
  const [modal, setModal] = useState<Modal>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [pilha, setPilha] = useState<Desfazer[]>([])
  const refBusca = useRef<HTMLInputElement>(null)
  const linhas = useRef(new Map<string, HTMLTableRowElement>())

  // ─── derivados ───────────────────────────────────────────────────────────────────
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? movs.filter((m) => `${m.descricao_bruta ?? ''} ${m.contraparte_nome ?? ''}`.toLowerCase().includes(q)) : movs
  }, [movs, busca])
  const idxFoco = Math.max(0, visiveis.findIndex((m) => m.id_movimento === focoId))
  const focado: Movimento | undefined = visiveis[idxFoco]
  const direcao = focado ? (focado.valor < 0 ? 'pagar' : 'receber') : null
  const sugFoco = focado ? sugs[focado.id_movimento] : undefined

  const titulosVis = useMemo(() => {
    const q = buscaTit.trim().toLowerCase()
    return titulos.filter((t) => t.tipo === direcao && (!q || `${t.descricao} ${t.contraparte ?? ''} ${t.conta ?? ''}`.toLowerCase().includes(q)))
  }, [titulos, direcao, buscaTit])

  const movsSel = useMemo(() => {
    if (selMov.length) return selMov.map((id) => movs.find((m) => m.id_movimento === id)).filter((m): m is Movimento => !!m)
    return focado && ABERTO(focado) ? [focado] : []
  }, [selMov, movs, focado])
  const titsSel = useMemo(() => selTit.map((id) => titulos.find((t) => t.id_titulo === id)).filter((t): t is Titulo => !!t), [selTit, titulos])
  const sinais = new Set(movsSel.map((m) => Math.sign(m.valor)))
  const tiposTit = new Set(titsSel.map((t) => t.tipo))
  const erroDirecao = sinais.size > 1 ? 'movimentos de entrada e saída misturados'
    : titsSel.length && movsSel.length && [...tiposTit].some((t) => t !== (movsSel[0]!.valor < 0 ? 'pagar' : 'receber')) ? 'título na direção errada' : null
  const aloc = alocar(movsSel.map((m) => ({ id: m.id_movimento, restante: centavos(restante(m)) })), titsSel.map((t) => ({ id: t.id_titulo, saldo: centavos(t.saldo) })))
  const deltaAssinado = movsSel[0] && movsSel[0].valor < 0 ? -aloc.delta : aloc.delta
  const podeConciliar = !ocupado && pode('conciliar') && movsSel.length > 0 && !erroDirecao
    && (titsSel.length > 0 || (Array.isArray(sugFoco) && sugFoco.length > 0))

  // ─── efeitos ─────────────────────────────────────────────────────────────────────
  useEffect(() => { linhas.current.get(focoId ?? '')?.scrollIntoView({ block: 'nearest' }) }, [focoId])

  useEffect(() => {
    if (!focado || !ABERTO(focado) || sugs[focado.id_movimento]) return
    const id = focado.id_movimento
    const t = setTimeout(async () => {
      setSugs((s) => ({ ...s, [id]: 'carregando' }))
      const r = await A.sugestoes(id)
      setSugs((s) => ({ ...s, [id]: r.ok ? r.dados : [] }))
    }, 120)
    return () => clearTimeout(t)
  }, [focado, sugs])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 8000 : 2500)
    return () => clearTimeout(t)
  }, [aviso])

  // ─── execução ────────────────────────────────────────────────────────────────────
  const aplicar = useCallback((d: Dados) => {
    setMovs(d.pagina.movimentos)
    setProximo(d.pagina.proximo)
    setContagem(d.pagina.contagem)
    setTitulos(d.titulos)
    setSugs({})
  }, [])

  async function executar<T>(fn: () => Promise<Resultado<{ r: T; dados: Dados }>>, ok: string, desfazer?: (r: T) => Desfazer, avancar = true) {
    if (ocupado) return
    setOcupado(true)
    const idAntes = focoId
    const res = await fn().catch((e) => ({ ok: false as const, mensagem: e instanceof Error ? e.message : 'erro', status: 0 }))
    setOcupado(false)
    if (!res.ok) { setAviso({ tipo: 'erro', texto: res.mensagem }); return false }
    const lista = res.dados.dados.pagina.movimentos
    aplicar(res.dados.dados)
    setSelMov([]); setSelTit([]); setDaSugestao(false); setModal(null)
    if (desfazer) setPilha((p) => [...p.slice(-19), desfazer(res.dados.r)])
    setAviso({ tipo: 'ok', texto: ok })
    if (avancar) {
      // segue para o próximo em aberto depois do que estava em foco — o ritmo da tela é este
      const i = Math.max(0, movs.findIndex((m) => m.id_movimento === idAntes))
      const prox = lista.slice(i).find((m) => ABERTO(m) && m.id_movimento !== idAntes) ?? lista.find(ABERTO)
      setFocoId(prox?.id_movimento ?? lista[0]?.id_movimento ?? null)
    }
    return true
  }
  const lim = () => movs.length

  function conciliarSelecao(usarSugestao1 = false) {
    if (!pode('conciliar')) return setAviso({ tipo: 'erro', texto: 'sem permissão para conciliar nesta organização' })
    let tits = titsSel
    let origem: 'manual' | 'sugestao' = daSugestao ? 'sugestao' : 'manual'
    if (!tits.length && usarSugestao1) {
      const s1 = Array.isArray(sugFoco) ? sugFoco[0] : undefined
      if (!s1) return setAviso({ tipo: 'erro', texto: 'sem sugestão para este movimento — escolha um título ou use L para lançar' })
      tits = [{ id_titulo: s1.id_titulo, saldo: s1.saldo } as Titulo]
      origem = 'sugestao'
    }
    if (erroDirecao) return setAviso({ tipo: 'erro', texto: erroDirecao })
    const r = alocar(movsSel.map((m) => ({ id: m.id_movimento, restante: centavos(restante(m)) })), tits.map((t) => ({ id: t.id_titulo, saldo: centavos(t.saldo) })))
    if (r.erro || !r.alocacoes.length) return setAviso({ tipo: 'erro', texto: r.erro ?? 'nada a conciliar' })
    const al = r.alocacoes.map((a) => ({ idMovimento: a.idMovimento, idTitulo: a.idTitulo, valor: reais(a.centavos) }))
    const rot = r.delta === 0 ? 'Conciliado' : `Conciliado parcial · ${deltaTxt(movsSel[0]!.valor < 0 ? -r.delta : r.delta)}`
    executar(() => A.conciliar(org.id, filtros, lim(), al, origem), rot, (x) => ({ tipo: 'conciliar', baixas: x.baixas, rotulo: 'conciliação' }))
  }

  async function desfazerUltimo() {
    const u = pilha.at(-1)
    if (!u) return setAviso({ tipo: 'erro', texto: 'nada para desfazer' })
    if (u.tipo === 'sem_desfazer') {
      setPilha((p) => p.slice(0, -1))
      return setAviso({ tipo: 'erro', texto: `${u.rotulo} não tem desfazer — reverta pela linha` })
    }
    const fn = u.tipo === 'conciliar' ? () => A.desconciliar(org.id, filtros, lim(), u.baixas, 'desfeito na conciliação (atalho U)')
      : u.tipo === 'lancar' ? () => A.desfazerLancamento(org.id, filtros, lim(), u.idMov, u.idTitulo)
      : u.tipo === 'transferencia' ? () => A.desfazerTransferencia(org.id, filtros, lim(), u.id, 'desfeito na conciliação (atalho U)')
      : () => A.desfazerIgnorar(org.id, filtros, lim(), u.idMov)
    if (await executar<unknown>(fn, `Desfeito: ${u.rotulo}`, undefined, false)) setPilha((p) => p.slice(0, -1))
  }

  async function maisLinhas() {
    if (!proximo || ocupado) return
    setOcupado(true)
    const r = await A.carregarMais(org.id, filtros, proximo)
    setOcupado(false)
    if (!r.ok) return setAviso({ tipo: 'erro', texto: r.mensagem })
    setMovs((m) => [...m, ...r.dados.movimentos])
    setProximo(r.dados.proximo)
  }

  // ─── teclado ─────────────────────────────────────────────────────────────────────
  const teclas = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    teclas.current = (e: KeyboardEvent) => {
      if (modal || e.metaKey || e.ctrlKey || e.altKey) return
      if (digitando(e)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      const ir = (d: number) => { const m = visiveis[Math.min(visiveis.length - 1, Math.max(0, idxFoco + d))]; if (m) setFocoId(m.id_movimento) }
      const k = e.key
      if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); ir(1) }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); ir(-1) }
      else if (k === ' ') {
        e.preventDefault()
        if (focado && ABERTO(focado)) setSelMov((s) => s.includes(focado.id_movimento) ? s.filter((x) => x !== focado.id_movimento) : [...s, focado.id_movimento])
      }
      else if (k === 'Enter') { e.preventDefault(); conciliarSelecao(true) }
      else if (/^[1-5]$/.test(k)) {
        const s = Array.isArray(sugFoco) ? sugFoco[Number(k) - 1] : undefined
        if (s) { setSelTit((t) => t.includes(s.id_titulo) ? t.filter((x) => x !== s.id_titulo) : [...t, s.id_titulo]); setDaSugestao(true) }
      }
      else if (k === 'l' || k === 'L') { if (focado && ABERTO(focado) && pode('lancar')) { e.preventDefault(); setModal('lancar') } }
      else if (k === 't' || k === 'T') { if (focado && focado.status === 'pendente' && pode('conciliar')) { e.preventDefault(); setModal('transferir') } }
      else if (k === 'i' || k === 'I') { if (focado?.status === 'pendente' && pode('ignorar')) { e.preventDefault(); setModal('ignorar') } }
      else if (k === 'u' || k === 'U') { e.preventDefault(); desfazerUltimo() }
      else if (k === '/') { e.preventDefault(); refBusca.current?.focus() }
      else if (k === '?') setModal('ajuda')
      else if (k === 'Escape') { setSelMov([]); setSelTit([]); setDaSugestao(false) }
    }
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => teclas.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ─── navegação de filtro (URL) ───────────────────────────────────────────────────
  const url = (p: Partial<{ conta: string; mes: string; status: string | undefined }>) => {
    const q = new URLSearchParams({ conta: filtros.conta, mes, ...(filtros.status ? { status: filtros.status } : {}) })
    for (const [k, v] of Object.entries(p)) { if (v) q.set(k, v); else q.delete(k) }
    return `/org/${org.id}/conciliacao?${q}`
  }
  const [ano, mm] = mes.split('-').map(Number) as [number, number]
  const mesDesloc = (d: number) => { const x = new Date(Date.UTC(ano, mm - 1 + d, 1)); return x.toISOString().slice(0, 7) }
  const total = Object.values(contagem).reduce((s, n) => s + (n ?? 0), 0)

  // ─── render ──────────────────────────────────────────────────────────────────────
  const botao = (ativo = true): React.CSSProperties => ({
    fontSize: 12, padding: '4px 10px', borderRadius: theme.radiusSm, fontFamily: 'inherit',
    border: `1px solid ${theme.border2}`, background: 'transparent', color: ativo ? theme.text : f.mutedText,
    cursor: ativo && !ocupado ? 'pointer' : 'default',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy={ocupado}>
      {/* barra de filtros */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: theme.display, fontSize: 22, fontWeight: 500, margin: 0 }}>{org.nome}</h1>
        <select aria-label="Conta" value={filtros.conta} onChange={(e) => router.push(url({ conta: e.target.value }))}
          style={{ fontSize: 12, padding: '4px 6px', background: 'transparent', color: theme.text, border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm }}>
          {contas.map((c) => <option key={c.id_conta} value={c.id_conta}>{c.apelido}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <Link href={url({ mes: mesDesloc(-1) })} aria-label="Mês anterior" className="f-link" style={{ textDecoration: 'none', padding: '0 4px' }}>‹</Link>
          <span style={{ minWidth: 64, textAlign: 'center', fontWeight: 600 }}>{MESES[mm - 1]}/{ano}</span>
          <Link href={url({ mes: mesDesloc(1) })} aria-label="Próximo mês" className="f-link" style={{ textDecoration: 'none', padding: '0 4px' }}>›</Link>
        </div>
        <nav aria-label="Filtrar por estado" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {([undefined, 'pendente', 'divergente', 'conciliado', 'ignorado'] as const).map((s) => {
            const ativo = filtros.status === s
            const n = s ? contagem[s] ?? 0 : total
            return (
              <Link key={s ?? 'todos'} href={url({ status: s })} aria-current={ativo ? 'true' : undefined}
                style={{ fontSize: 12, padding: '3px 8px', borderRadius: theme.radiusSm, textDecoration: 'none',
                  border: `1px solid ${ativo ? theme.accentBorder : 'transparent'}`, background: ativo ? theme.realceBg2 : 'transparent',
                  color: ativo ? theme.text : theme.text2 }}>
                {s ? `${ESTADO[s].icone} ${ESTADO[s].rotulo}` : 'Todos'} <span style={{ fontVariantNumeric: 'tabular-nums', color: f.mutedText }}>{n}</span>
              </Link>
            )
          })}
        </nav>
        <input ref={refBusca} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição  /"
          aria-label="Buscar no extrato" style={{ fontSize: 12, padding: '4px 8px', width: 200, background: 'transparent', color: theme.text, border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm }} />
        <button onClick={() => setModal('ajuda')} style={{ ...botao(), marginLeft: 'auto' }} aria-label="Atalhos de teclado"><kbd className="f-kbd">?</kbd> atalhos</button>
      </div>

      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(340px,2fr)', gap: 14, alignItems: 'start' }}>
        {/* extrato */}
        <section aria-label="Extrato" style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, background: theme.surface, overflow: 'hidden' }}>
          <div className="v-scroll-x" style={{ maxHeight: 'calc(100vh - 170px)', overflowY: 'auto' }}>
            <table className="f-tabela" role="grid" aria-rowcount={visiveis.length}>
              <thead>
                <tr>
                  <th style={{ width: 28 }} aria-label="Selecionado" />
                  <th style={{ width: 110 }}>Estado</th>
                  <th style={{ width: 52 }}>Data</th>
                  <th>Descrição</th>
                  <th className="f-num">R$</th>
                  <th className="f-num" style={{ width: '18ch' }}>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((m) => {
                  const e = ESTADO[m.status]
                  const sel = selMov.includes(m.id_movimento)
                  const foco = m.id_movimento === focado?.id_movimento
                  return (
                    <tr key={m.id_movimento} ref={(el) => { if (el) linhas.current.set(m.id_movimento, el); else linhas.current.delete(m.id_movimento) }}
                      className={e.classe} data-foco={foco ? '1' : undefined} aria-selected={sel}
                      onClick={() => setFocoId(m.id_movimento)}
                      onDoubleClick={() => ABERTO(m) && setSelMov((s) => sel ? s.filter((x) => x !== m.id_movimento) : [...s, m.id_movimento])}
                      style={{ cursor: 'default' }}>
                      <td style={{ textAlign: 'center' }}>{sel ? '■' : ''}</td>
                      <td><span className={e.ic} aria-hidden>{e.icone}</span> {e.rotulo}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{dataBR(m.data_movimento)}</td>
                      <td style={{ maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.descricao_bruta ?? ''}>
                        {m.descricao_bruta ?? '(sem descrição)'}
                        {m.contraparte_nome && <span style={{ color: f.mutedText }}> · {m.contraparte_nome}</span>}
                        {m.status === 'ignorado' && m.ignorado_motivo && <span> — {m.ignorado_motivo}</span>}
                        {m.id_transferencia && <span style={{ color: f.mutedText }}> · transferência</span>}
                        {m.removido_na_fonte_em && <span className="f-delta"> · sumiu do extrato na fonte</span>}
                      </td>
                      <td className="f-num">{fmtBRL(m.valor)}</td>
                      <td className="f-num">
                        {m.status === 'divergente'
                          ? <span className="f-delta">{deltaTxt(centavos(m.valor < 0 ? -m.diferenca : m.diferenca))}</span>
                          : m.status === 'conciliado' ? <span style={{ color: f.mutedText }}>0,00</span> : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {visiveis.length === 0 && <div style={{ padding: 24, fontSize: 13, color: f.mutedText }}>Nenhum movimento neste filtro.</div>}
            {proximo && <button onClick={maisLinhas} style={{ ...botao(), margin: 10 }}>Carregar mais</button>}
          </div>
        </section>

        {/* painel direito */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 64 }}>
          <PainelFoco m={focado} />

          <section aria-label="Sugestões" style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, background: theme.surface }}>
            <Cabecalho>Sugestões</Cabecalho>
            {!focado || !ABERTO(focado) ? <Vazio>{focado ? 'Movimento já resolvido.' : 'Nenhum movimento em foco.'}</Vazio>
              : sugFoco === 'carregando' || sugFoco === undefined ? <Vazio>Buscando…</Vazio>
              : sugFoco.length === 0 ? <Vazio>Sem sugestão. <kbd className="f-kbd">L</kbd> lança e concilia.</Vazio>
              : (
                <table className="f-tabela"><tbody>
                  {sugFoco.map((s, i) => {
                    const sel = selTit.includes(s.id_titulo)
                    return (
                      <tr key={s.id_titulo} data-foco={sel ? '1' : undefined} onClick={() => { setSelTit((t) => sel ? t.filter((x) => x !== s.id_titulo) : [...t, s.id_titulo]); setDaSugestao(true) }} style={{ cursor: 'pointer' }}>
                        <td style={{ width: 26 }}><kbd className="f-kbd">{i + 1}</kbd></td>
                        <td style={{ maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${s.descricao} — ${s.motivo}`}>
                          {s.descricao} <span style={{ color: f.mutedText }}>· {s.motivo}</span>
                        </td>
                        <td className="f-num" style={{ width: '6ch', color: f.mutedText }}>{s.score}</td>
                        <td className="f-num">{fmtBRL(s.saldo)}</td>
                      </tr>
                    )
                  })}
                </tbody></table>
              )}
          </section>

          <section aria-label="Títulos em aberto" style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, background: theme.surface }}>
            <Cabecalho direita={<input value={buscaTit} onChange={(e) => setBuscaTit(e.target.value)} placeholder="filtrar" aria-label="Filtrar títulos"
              style={{ fontSize: 11, padding: '2px 6px', width: 120, background: 'transparent', color: theme.text, border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm }} />}>
              Títulos a {direcao === 'pagar' ? 'pagar' : direcao === 'receber' ? 'receber' : '—'} · {titulosVis.length}
            </Cabecalho>
            <div style={{ maxHeight: 'calc(100vh - 520px)', minHeight: 120, overflowY: 'auto' }}>
              <table className="f-tabela"><tbody>
                {titulosVis.map((t) => {
                  const sel = selTit.includes(t.id_titulo)
                  return (
                    <tr key={t.id_titulo} data-foco={sel ? '1' : undefined} aria-selected={sel} style={{ cursor: 'pointer' }}
                      onClick={() => { setSelTit((x) => sel ? x.filter((y) => y !== t.id_titulo) : [...x, t.id_titulo]); setDaSugestao(false) }}>
                      <td style={{ width: 20, textAlign: 'center' }}>{sel ? '■' : ''}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', width: 44, color: t.faixa === 'vencido' ? f.dueLate : t.faixa === 'hoje' ? f.dueToday : undefined }}
                        title={t.faixa === 'vencido' ? `vencido há ${t.dias_atraso} dia(s)` : t.faixa === 'hoje' ? 'vence hoje' : undefined}>
                        {t.faixa === 'vencido' ? '▲ ' : ''}{dataBR(t.data_vencimento)}
                      </td>
                      <td style={{ maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.descricao}>
                        {t.descricao}{t.contraparte && <span style={{ color: f.mutedText }}> · {t.contraparte}</span>}
                      </td>
                      <td className="f-num">{fmtBRL(t.saldo)}</td>
                    </tr>
                  )
                })}
              </tbody></table>
              {direcao && titulosVis.length === 0 && <Vazio>Nenhum título em aberto nesta direção.</Vazio>}
            </div>
          </section>

          {/* seleção e Δ ao vivo */}
          <section aria-label="Seleção" aria-live="polite" style={{ border: `1px solid ${theme.borderStrong}`, borderRadius: theme.radiusSm, background: theme.surface, padding: 10, display: 'grid', gap: 6 }}>
            <Linha rotulo={`Movimento${movsSel.length > 1 ? `s (${movsSel.length})` : ''}`} valor={movsSel.reduce((s, m) => s + restante(m), 0)} />
            <Linha rotulo={`Título${titsSel.length > 1 ? `s (${titsSel.length})` : ''}`} valor={titsSel.reduce((s, t) => s + t.saldo, 0)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, borderTop: `1px solid ${theme.borderFaint}`, paddingTop: 6 }}>
              <span>Diferença</span>
              {/* Δ só depois de escolher título: antes disso a "diferença" é o movimento inteiro, e em tijolo assusta à toa */}
              <span className={titsSel.length && aloc.delta !== 0 ? 'f-delta' : undefined} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {!titsSel.length ? '—' : aloc.delta === 0 ? '0,00' : deltaTxt(deltaAssinado)}
              </span>
            </div>
            {(erroDirecao || (aloc.erro && titsSel.length > 0 && movsSel.length > 0)) && <div style={{ fontSize: 12, color: f.negativeText }}>▲ {erroDirecao ?? aloc.erro}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button disabled={!podeConciliar} onClick={() => conciliarSelecao(true)}
                style={{ ...botao(podeConciliar), background: podeConciliar ? theme.text : 'transparent', color: podeConciliar ? theme.bg : f.mutedText,
                  border: podeConciliar ? 'none' : `1px solid ${theme.border2}`, fontWeight: 600 }}>
                {titsSel.length && aloc.delta !== 0 ? 'Conciliar parcial' : titsSel.length ? 'Conciliar' : 'Conciliar com a sugestão 1'} <kbd className="f-kbd">↵</kbd>
              </button>
              {pode('lancar') && <button disabled={ocupado || !focado || !ABERTO(focado)} onClick={() => setModal('lancar')} style={botao(!!focado && ABERTO(focado))}>Lançar <kbd className="f-kbd">L</kbd></button>}
              {pode('conciliar') && <button disabled={ocupado || focado?.status !== 'pendente'} onClick={() => setModal('transferir')} style={botao(focado?.status === 'pendente')}>Transferência <kbd className="f-kbd">T</kbd></button>}
              {pode('ignorar') && <button disabled={ocupado || focado?.status !== 'pendente'} onClick={() => setModal('ignorar')} style={botao(focado?.status === 'pendente')}>Ignorar <kbd className="f-kbd">I</kbd></button>}
              {focado?.status === 'ignorado' && pode('ignorar') && (
                <button disabled={ocupado} onClick={() => executar(() => A.desfazerIgnorar(org.id, filtros, lim(), focado.id_movimento), 'Voltou a pendente', undefined, false)} style={botao()}>Desfazer ignorar</button>
              )}
              {focado?.id_transferencia && pode('conciliar') && (
                <button disabled={ocupado} onClick={() => setModal('desfazer_transf')} style={botao()}>Desfazer transferência…</button>
              )}
              {(focado?.status === 'conciliado' || focado?.status === 'divergente') && !focado.id_transferencia && pode('conciliar') && (
                <button disabled={ocupado} onClick={() => setModal('desconciliar')} style={botao()}>Desconciliar…</button>
              )}
              <button disabled={ocupado || !pilha.length} onClick={desfazerUltimo} style={botao(!!pilha.length)} title={pilha.at(-1) ? `Desfazer ${pilha.at(-1)!.rotulo}` : undefined}>Desfazer <kbd className="f-kbd">U</kbd></button>
            </div>
          </section>
        </aside>
      </div>

      {aviso && (
        <div role={aviso.tipo === 'erro' ? 'alert' : 'status'} style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 60,
          padding: '8px 14px', fontSize: 13, borderRadius: theme.radiusSm, background: theme.text, color: theme.bg, boxShadow: '0 8px 24px rgba(17,23,25,.22)', maxWidth: 560 }}>
          {aviso.tipo === 'erro' ? '▲ ' : '✓ '}{aviso.texto}
        </div>
      )}

      {modal === 'ajuda' && <ModalAjuda onFechar={() => setModal(null)} />}
      {modal === 'lancar' && focado && (
        <ModalLancar m={focado} restante={restante(focado)} plano={plano} ocupado={ocupado} onFechar={() => setModal(null)}
          onConfirmar={(dados) => executar(() => A.lancar(org.id, filtros, lim(), focado.id_movimento, dados), 'Lançado e conciliado',
            (r) => ({ tipo: 'lancar', idMov: focado.id_movimento, idTitulo: r.id, rotulo: 'lançamento' }))} />
      )}
      {modal === 'ignorar' && focado && (
        <ModalIgnorar m={focado} ocupado={ocupado} onFechar={() => setModal(null)}
          onConfirmar={(dados) => executar(() => A.ignorar(org.id, filtros, lim(), focado.id_movimento, dados), 'Ignorado',
            () => ({ tipo: 'ignorar', idMov: focado.id_movimento, rotulo: 'ignorar' }))} />
      )}
      {modal === 'transferir' && focado && (
        <ModalTransferir m={focado} idOrg={org.id} contas={contas} ocupado={ocupado} onFechar={() => setModal(null)}
          onConfirmar={(par) => {
            const [saida, entrada] = focado.valor < 0 ? [focado.id_movimento, par] : [par, focado.id_movimento]
            executar(() => A.transferir(org.id, filtros, lim(), saida, entrada), 'Transferência registrada', (r) => ({ tipo: 'transferencia', id: r.id, rotulo: 'transferência' }))
          }} />
      )}
      {modal === 'desfazer_transf' && focado?.id_transferencia && (
        <ModalMotivo titulo="Desfazer transferência" m={focado} ocupado={ocupado} minimo={5} rotuloOk="Desfazer" onFechar={() => setModal(null)}
          aviso="As duas pontas voltam a pendente."
          onConfirmar={(motivo) => executar(() => A.desfazerTransferencia(org.id, filtros, lim(), focado.id_transferencia!, motivo), 'Transferência desfeita', () => ({ tipo: 'sem_desfazer', rotulo: 'desfazer transferência' }), false)} />
      )}
      {modal === 'desconciliar' && focado && (
        <ModalDesconciliar m={focado} ocupado={ocupado} onFechar={() => setModal(null)}
          onConfirmar={(ids, motivo) => executar(() => A.desconciliar(org.id, filtros, lim(), ids, motivo), 'Desconciliado', () => ({ tipo: 'sem_desfazer', rotulo: 'desconciliação' }), false)} />
      )}
    </div>
  )
}

function PainelFoco({ m }: { m: Movimento | undefined }) {
  if (!m) return null
  const e = ESTADO[m.status]
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, background: theme.surface, padding: '8px 10px', fontSize: 12, display: 'grid', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.descricao_bruta ?? '(sem descrição)'}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>R$ {fmtBRL(m.valor)}</span>
      </div>
      <div style={{ color: f.mutedText }}>
        <span className={e.ic}>{e.icone}</span> {e.rotulo} · {m.data_movimento.split('-').reverse().join('/')} · {m.origem}
        {m.status === 'divergente' && m.motivo_divergencia && <> · {m.motivo_divergencia === 'removido_na_fonte' ? 'sumiu do extrato na fonte' : 'conciliação parcial'}</>}
        {m.valor_conciliado > 0 && <> · conciliado R$ {fmtBRL(m.valor_conciliado)}</>}
      </div>
    </div>
  )
}

function Cabecalho({ children, direita }: { children: React.ReactNode; direita?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid ${theme.borderFaint}` }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: f.mutedText }}>{children}</span>
      {direita}
    </div>
  )
}
function Vazio({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '10px', fontSize: 12, color: f.mutedText }}>{children}</div>
}
function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: theme.text2 }}>{rotulo}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(valor)}</span>
    </div>
  )
}
