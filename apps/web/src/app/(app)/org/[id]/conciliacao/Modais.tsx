'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIAS_IGNORADO, centavos, competenciaSugerida, fmtBRL } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloCampo } from '@/components/vesso'
import { f } from '@/lib/fin'
import * as A from './acoes'
import type { Baixa, Conta, Movimento, PlanoConta } from './tipos'

function Modal({ titulo, onFechar, children, largura = 520 }: { titulo: string; onFechar: () => void; children: React.ReactNode; largura?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onFechar])
  return (
    <div role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(17,23,25,.45)', display: 'grid', placeItems: 'start center', paddingTop: '10vh' }}>
      <div role="dialog" aria-modal="true" aria-label={titulo}
        style={{ width: `min(${largura}px, calc(100vw - 32px))`, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radius, boxShadow: '0 16px 48px rgba(17,23,25,.3)', padding: '22px 24px', display: 'grid', gap: 14 }}>
        <div style={{ fontFamily: theme.display, fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{titulo}</div>
        {children}
      </div>
    </div>
  )
}

// Campo, rótulo e botões = os do vesso-admin (components/vesso.tsx).
const campo: React.CSSProperties = { ...estiloCampo, padding: '8px 11px' }
const rotulo: React.CSSProperties = { display: 'grid', gap: 6, fontSize: 12.5, color: theme.text2 }
// a caixa-alta vai SÓ no texto do rótulo — no <label> ela escorria para a busca e para a lista do plano de contas
const rotuloTexto: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }
function Botoes({ ocupado, ok, rotuloOk, onFechar }: { ocupado: boolean; ok: boolean; rotuloOk: string; onFechar: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
      <button type="button" onClick={onFechar} style={botaoSecundario()}>Cancelar <kbd className="f-kbd">Esc</kbd></button>
      <button type="submit" disabled={ocupado || !ok} style={botaoPrimario(ocupado || !ok)}>
        {ocupado ? 'Salvando…' : rotuloOk} <kbd className="f-kbd">↵</kbd>
      </button>
    </div>
  )
}
function Resumo({ m }: { m: Movimento }) {
  return (
    <div style={{ fontSize: 12.5, color: theme.text2, display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 12px', background: theme.surface2, borderRadius: theme.radiusSm }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.data_movimento.split('-').reverse().join('/')} · {m.descricao_bruta}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>R$ {fmtBRL(m.valor)}</span>
    </div>
  )
}

// ─── Lançar e conciliar (L) ─────────────────────────────────────────────────────────
export function ModalLancar({ m, restante, plano, ocupado, onFechar, onConfirmar }: {
  m: Movimento; restante: number; plano: PlanoConta[]; ocupado: boolean; onFechar: () => void
  onConfirmar: (d: { id_plano_conta: string; descricao: string; competencia?: string; valor?: number }) => void
}) {
  const natOk = m.valor < 0 ? (n: string) => !['receita', 'financeira_receita'].includes(n) : (n: string) => !['custo', 'despesa', 'financeira_despesa', 'imposto', 'deducao'].includes(n)
  const opcoes = useMemo(() => plano.filter((p) => p.aceita_lancamento && natOk(p.natureza)), [plano]) // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [escolhido, setEscolhido] = useState<PlanoConta | null>(null)
  const [descricao, setDescricao] = useState(m.descricao_bruta ?? '')
  const [valorTxt, setValorTxt] = useState(fmtBRL(restante))
  const [compManual, setCompManual] = useState('')
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return opcoes.filter((p) => !t || `${p.codigo} ${p.nome}`.toLowerCase().includes(t)).slice(0, 50)
  }, [opcoes, q])
  const sugerida = escolhido ? competenciaSugerida(escolhido.regra_competencia, m.data_movimento) : null
  const competencia = compManual ? `${compManual}-01` : sugerida
  const valor = Number(valorTxt.replace(/\./g, '').replace(',', '.'))
  const valorOk = Number.isFinite(valor) && valor > 0 && centavos(valor) <= centavos(restante) && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6
  const ok = !!escolhido && !!competencia && valorOk && descricao.trim().length > 0

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!ok || !escolhido) return
    onConfirmar({
      id_plano_conta: escolhido.id_plano_conta, descricao: descricao.trim(),
      ...(competencia !== sugerida ? { competencia: competencia! } : {}),
      ...(centavos(valor) !== centavos(restante) ? { valor } : {}),
    })
  }

  return (
    <Modal titulo="Lançar e conciliar" onFechar={onFechar} largura={600}>
      <Resumo m={m} />
      <form onSubmit={enviar} style={{ display: 'grid', gap: 10 }}>
        {!escolhido ? (
          <label style={rotulo}><span style={rotuloTexto}>Plano de contas</span>
            <input autoFocus value={q} placeholder="buscar por código ou nome" style={campo}
              onChange={(e) => { setQ(e.target.value); setIdx(0) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(lista.length - 1, i + 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
                else if (e.key === 'Enter') { e.preventDefault(); if (lista[idx]) setEscolhido(lista[idx]!) }
              }} />
            <div role="listbox" style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${theme.borderFaint}`, borderRadius: theme.radiusSm }}>
              {lista.map((p, i) => (
                <div key={p.id_plano_conta} role="option" aria-selected={i === idx} onMouseDown={() => setEscolhido(p)}
                  style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer', background: i === idx ? theme.realceBg2 : 'transparent', display: 'flex', gap: 8 }}>
                  <span style={{ color: f.mutedText, fontVariantNumeric: 'tabular-nums', minWidth: 48 }}>{p.codigo}</span>
                  <span>{p.nome}</span>
                  {p.generica && <span style={{ color: f.warningText }}>· genérica</span>}
                </div>
              ))}
              {lista.length === 0 && <div style={{ padding: 8, fontSize: 12, color: f.mutedText }}>Nenhuma conta.</div>}
            </div>
          </label>
        ) : (
          <>
            <div style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><span style={{ color: f.mutedText }}>{escolhido.codigo}</span> {escolhido.nome}
                {escolhido.generica && <span style={{ color: f.warningText }}> · genérica (o checklist vai cobrar)</span>}</span>
              <button type="button" onClick={() => setEscolhido(null)} className="f-link" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>trocar</button>
            </div>
            <label style={rotulo}><span style={rotuloTexto}>Descrição</span>
              <input autoFocus value={descricao} onChange={(e) => setDescricao(e.target.value)} style={campo} maxLength={300} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={rotulo}><span><span style={rotuloTexto}>Competência</span> {sugerida && !compManual && <span style={{ color: f.mutedText }}>(pela regra: {sugerida.slice(5, 7)}/{sugerida.slice(0, 4)})</span>}</span>
                <input type="month" value={compManual || (sugerida ? sugerida.slice(0, 7) : '')} required={!sugerida}
                  onChange={(e) => setCompManual(e.target.value)} style={campo} />
              </label>
              <label style={rotulo}><span style={rotuloTexto}>Valor (R$)</span>
                <input value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} inputMode="decimal" style={{ ...campo, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
                {!valorOk && <span style={{ color: f.negativeText }}>▲ entre 0,01 e {fmtBRL(restante)}</span>}
                {valorOk && centavos(valor) < centavos(restante) && <span style={{ color: f.warningText }}>parcial: o movimento fica divergente</span>}
              </label>
            </div>
          </>
        )}
        <Botoes ocupado={ocupado} ok={ok} rotuloOk="Lançar e conciliar" onFechar={onFechar} />
      </form>
    </Modal>
  )
}

// ─── Ignorar (I) ───────────────────────────────────────────────────────────────────
const ROT_IGN: Record<(typeof CATEGORIAS_IGNORADO)[number], string> = {
  duplicado_na_fonte: 'Duplicado na fonte', fora_do_escopo: 'Fora do escopo', estorno_compensado: 'Estorno compensado',
  legado: 'Legado', outro: 'Outro',
}
export function ModalIgnorar({ m, ocupado, onFechar, onConfirmar }: {
  m: Movimento; ocupado: boolean; onFechar: () => void; onConfirmar: (d: { categoria: string; motivo: string }) => void
}) {
  const [categoria, setCategoria] = useState<string>('duplicado_na_fonte')
  const [motivo, setMotivo] = useState('')
  const n = motivo.trim().length
  return (
    <Modal titulo="Ignorar movimento" onFechar={onFechar}>
      <Resumo m={m} />
      <div style={{ fontSize: 12, color: f.warningText }}>Ignorar tira o dinheiro da conciliação. O motivo fica registrado.</div>
      <form onSubmit={(e) => { e.preventDefault(); if (n >= 10) onConfirmar({ categoria, motivo: motivo.trim() }) }} style={{ display: 'grid', gap: 10 }}>
        <label style={rotulo}><span style={rotuloTexto}>Categoria</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={campo}>
            {CATEGORIAS_IGNORADO.map((c) => <option key={c} value={c}>{ROT_IGN[c]}</option>)}
          </select>
        </label>
        <label style={rotulo}><span style={rotuloTexto}>Motivo</span><span style={{ color: n >= 10 ? f.mutedText : f.negativeText }}>({n}/10 mín.)</span>
          <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={1000} style={campo}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (n >= 10) onConfirmar({ categoria, motivo: motivo.trim() }) } }} />
        </label>
        <Botoes ocupado={ocupado} ok={n >= 10} rotuloOk="Ignorar" onFechar={onFechar} />
      </form>
    </Modal>
  )
}

// ─── Transferência (T) ─────────────────────────────────────────────────────────────
export function ModalTransferir({ m, idOrg, contas, ocupado, onFechar, onConfirmar }: {
  m: Movimento; idOrg: string; contas: Conta[]; ocupado: boolean; onFechar: () => void; onConfirmar: (idPar: string) => void
}) {
  const [cands, setCands] = useState<Movimento[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const pedido = useRef(false)
  useEffect(() => {
    if (pedido.current) return
    pedido.current = true
    A.candidatosTransferencia(idOrg, m.id_movimento, m.valor, m.data_movimento, m.id_conta).then((r) => {
      if (r.ok) setCands(r.dados); else setErro(r.mensagem)
    })
  }, [idOrg, m])
  const nomeConta = (id: string) => contas.find((c) => c.id_conta === id)?.apelido ?? '—'
  return (
    <Modal titulo="Registrar transferência entre contas" onFechar={onFechar} largura={600}>
      <Resumo m={m} />
      <div style={{ fontSize: 12, color: theme.text2 }}>
        Par: {m.valor < 0 ? 'entrada' : 'saída'} de R$ {fmtBRL(Math.abs(m.valor))} em outra conta, até 5 dias de distância, ainda pendente.
      </div>
      <form onSubmit={(e) => { e.preventDefault(); const c = cands?.[sel]; if (c) onConfirmar(c.id_movimento) }} style={{ display: 'grid', gap: 10 }}>
        {erro ? <div style={{ fontSize: 12, color: f.negativeText }}>▲ {erro}</div>
          : !cands ? <div style={{ fontSize: 12, color: f.mutedText }}>Procurando…</div>
          : cands.length === 0 ? <div style={{ fontSize: 12, color: f.mutedText }}>Nenhum par encontrado. O outro lado já foi importado?</div>
          : (
            <div role="listbox" tabIndex={0} autoFocus
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setSel((i) => Math.min(cands.length - 1, i + 1)) }
                if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)) }
              }}
              style={{ border: `1px solid ${theme.borderFaint}`, borderRadius: theme.radiusSm, outline: 'none' }}>
              {cands.map((c, i) => (
                <div key={c.id_movimento} role="option" aria-selected={i === sel} onMouseDown={() => setSel(i)}
                  style={{ padding: '5px 8px', fontSize: 12, display: 'flex', gap: 10, cursor: 'pointer', background: i === sel ? theme.realceBg2 : 'transparent' }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{c.data_movimento.split('-').reverse().join('/')}</span>
                  <span style={{ minWidth: 90 }}>{nomeConta(c.id_conta)}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descricao_bruta}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(c.valor)}</span>
                </div>
              ))}
            </div>
          )}
        <Botoes ocupado={ocupado} ok={!!cands?.length} rotuloOk="Registrar" onFechar={onFechar} />
      </form>
    </Modal>
  )
}

// ─── Desconciliar ──────────────────────────────────────────────────────────────────
export function ModalDesconciliar({ m, ocupado, onFechar, onConfirmar }: {
  m: Movimento; ocupado: boolean; onFechar: () => void; onConfirmar: (ids: string[], motivo: string) => void
}) {
  const [baixas, setBaixas] = useState<Baixa[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [motivo, setMotivo] = useState('')
  const pedido = useRef(false)
  useEffect(() => {
    if (pedido.current) return
    pedido.current = true
    A.baixasDo(m.id_movimento).then((r) => {
      if (r.ok) { setBaixas(r.dados); setSel(r.dados.map((b) => b.id_baixa)) } else setErro(r.mensagem)
    })
  }, [m])
  const ok = sel.length > 0 && motivo.trim().length >= 5
  return (
    <Modal titulo="Desconciliar" onFechar={onFechar}>
      <Resumo m={m} />
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onConfirmar(sel, motivo.trim()) }} style={{ display: 'grid', gap: 10 }}>
        {erro ? <div style={{ fontSize: 12, color: f.negativeText }}>▲ {erro}</div>
          : !baixas ? <div style={{ fontSize: 12, color: f.mutedText }}>Carregando…</div>
          : baixas.map((b) => (
            <label key={b.id_baixa} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={sel.includes(b.id_baixa)} onChange={(e) => setSel((s) => e.target.checked ? [...s, b.id_baixa] : s.filter((x) => x !== b.id_baixa))} />
              <span style={{ flex: 1 }}>{b.descricao}{b.conta && <span style={{ color: f.mutedText }}> · {b.conta}</span>}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(b.valor)}</span>
            </label>
          ))}
        <label style={rotulo}><span style={rotuloTexto}>Motivo (mín. 5)</span>
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} style={campo} />
        </label>
        <Botoes ocupado={ocupado} ok={ok} rotuloOk="Desconciliar" onFechar={onFechar} />
      </form>
    </Modal>
  )
}

// ─── Motivo genérico (desfazer transferência…) ──────────────────────────────────────
export function ModalMotivo({ titulo, m, minimo, rotuloOk, aviso, ocupado, onFechar, onConfirmar }: {
  titulo: string; m: Movimento; minimo: number; rotuloOk: string; aviso?: string; ocupado: boolean
  onFechar: () => void; onConfirmar: (motivo: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  const n = motivo.trim().length
  return (
    <Modal titulo={titulo} onFechar={onFechar}>
      <Resumo m={m} />
      {aviso && <div style={{ fontSize: 12, color: theme.text2 }}>{aviso}</div>}
      <form onSubmit={(e) => { e.preventDefault(); if (n >= minimo) onConfirmar(motivo.trim()) }} style={{ display: 'grid', gap: 10 }}>
        <label style={rotulo}><span style={rotuloTexto}>Motivo</span><span style={{ color: n >= minimo ? f.mutedText : f.negativeText }}>({n}/{minimo} mín.)</span>
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} style={campo} />
        </label>
        <Botoes ocupado={ocupado} ok={n >= minimo} rotuloOk={rotuloOk} onFechar={onFechar} />
      </form>
    </Modal>
  )
}

// ─── Atalhos (?) ───────────────────────────────────────────────────────────────────
export function ModalAjuda({ onFechar }: { onFechar: () => void }) {
  const itens: [string, string][] = [
    ['j / k', 'próximo / anterior'], ['espaço', 'marca vários movimentos'], ['↵', 'concilia com o(s) título(s) marcado(s) ou a sugestão 1'],
    ['1–5', 'marca a sugestão N (combine várias para 1 → N)'], ['L', 'lançar e conciliar'], ['T', 'transferência entre contas'],
    ['I', 'ignorar (motivo obrigatório)'], ['U', 'desfaz a última ação'], ['/', 'busca no extrato'], ['Esc', 'limpa a seleção'],
  ]
  return (
    <Modal titulo="Atalhos" onFechar={onFechar} largura={420}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13 }}>
        {itens.map(([k, d]) => <div key={k} style={{ display: 'contents' }}><kbd className="f-kbd" style={{ justifySelf: 'start' }}>{k}</kbd><span>{d}</span></div>)}
      </div>
    </Modal>
  )
}
