'use client'

// Lançamentos (docs/PROMPT.md §7, tela 2): os títulos da organização — consultar, categorizar (inclusive em lote),
// corrigir competência, cancelar e lançar novo (com parcelas). Desenho da Consulta + Categorização do seis-sistema
// (cards de saldo, filtros, gaveta de detalhe, barra de edição em lote), no vocabulário do vesso-admin.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtBRL, SITUACOES_TITULO } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { estiloFiltro } from '@/components/vesso'
import { Aviso, botaoPrimarioCompacto, botaoSecundarioCompacto, campoCompacto, Painel } from '@/components/fin-ui'
import SeletorPlano, { type ContaPlano } from '@/components/SeletorPlano'
import * as A from './acoes'
import type { Entidade, Filtros, Pagina, TituloLinha } from './tipos'
import { assinado, dataBR, Gaveta, mesCurto, ModalNovo, ROT_SIT, situacao, ym } from './pecas'

export default function LancamentosClient({ org, filtros, inicial, plano, entidades, mesAtual, abrir }: {
  org: { id: string; nome: string; acoes: string[] }; filtros: Filtros; inicial: Pagina; plano: ContaPlano[]; entidades: Entidade[]; mesAtual: string
  abrir?: string  // ?titulo= vindo da Fila: abre a gaveta direto
}) {
  const router = useRouter()
  const pode = (a: string) => org.acoes.includes(a)
  const [extras, setExtras] = useState<TituloLinha[]>([])
  const [proximo, setProximo] = useState(inicial.proximo)
  const [sel, setSel] = useState<string[]>([])
  const [aberto, setAberto] = useState<string | null>(abrir ?? null)
  const [novo, setNovo] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [busca, setBusca] = useState(filtros.q ?? '')
  const titulos = useMemo(() => [...inicial.titulos, ...extras], [inicial.titulos, extras])
  // estáveis: a gaveta recarrega o título quando estas mudam
  const fecharGaveta = useCallback(() => setAberto(null), [])
  const avisarErro = useCallback((texto: string) => setAviso({ tipo: 'erro', texto }), [])
  const r = inicial.resumo

  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 8000 : 2500); return () => clearTimeout(t) }, [aviso])

  const url = (p: Partial<Record<keyof Filtros | 'periodo', string | undefined>>) => {
    const atual: Record<string, string | undefined> = {
      tipo: filtros.tipo, situacao: filtros.situacao === 'todos' ? undefined : filtros.situacao, campo: filtros.campo === 'competencia' ? undefined : filtros.campo,
      de: ym(filtros.de), ate: ym(filtros.ate), plano: filtros.plano, q: filtros.q, periodo: !filtros.de && !filtros.ate ? 'todos' : undefined,
    }
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...atual, ...p })) if (v) q.set(k, v)
    return `/org/${org.id}/lancamentos${q.size ? `?${q}` : ''}`
  }
  const depois = (texto: string) => { setAviso({ tipo: 'ok', texto }); setExtras([]); setSel([]); router.refresh() }

  async function maisLinhas() {
    if (!proximo) return
    const res = await A.carregarMais(org.id, filtros, proximo)
    if (!res.ok) return setAviso({ tipo: 'erro', texto: res.mensagem })
    setExtras((e) => [...e, ...res.dados.titulos]); setProximo(res.dados.proximo)
  }

  function exportar() {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const n = (v: number) => v.toFixed(2).replace('.', ',')
    const linhas = [['Competência', 'Vencimento', 'Tipo', 'Descrição', 'Contraparte', 'Conta', 'Valor', 'Baixado', 'Saldo', 'Situação'].map(q).join(';'),
      ...titulos.map((t) => [mesCurto(t.competencia), dataBR(t.data_vencimento), t.tipo, t.descricao, t.contraparte ?? '', t.conta ? `${t.codigo} ${t.conta}` : 'A categorizar',
        n(assinado(t, t.valor)), n(t.valor_baixado), n(t.saldo), situacao(t).texto].map((v) => (/^-?\d+,\d{2}$/.test(v) ? v : q(v))).join(';'))]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `Lançamentos ${org.nome} ${ym(filtros.de) || 'todos'}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const selecionados = titulos.filter((t) => sel.includes(t.id_titulo))
  const todosMarcados = titulos.length > 0 && titulos.every((t) => sel.includes(t.id_titulo) || t.cancelado_em)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: sel.length ? 80 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `1px solid ${theme.borderStrong}` }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent }}>Lançamentos</div>
          <h1 className="v-manchete" style={{ fontFamily: theme.display, fontSize: 32, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '6px 0 0' }}>{org.nome}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportar} style={botaoSecundarioCompacto()}>Exportar CSV</button>
          {pode('lancar') && <button onClick={() => setNovo(true)} style={botaoPrimarioCompacto()}>+ Novo lançamento</button>}
        </div>
      </div>

      {/* cartões de saldo (CardsSaldo do seis-sistema) — o período e o tipo dos filtros valem aqui */}
      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
        <Cartao rotulo="A receber" valor={r.receber} sub={`${fmtBRL(r.receber_aberto)} em aberto`} />
        <Cartao rotulo="A pagar" valor={-r.pagar} sub={`${fmtBRL(r.pagar_aberto)} em aberto`} />
        <Cartao rotulo="Vencidos" contagem={r.vencidos} sub="títulos em aberto após o vencimento" href={url({ situacao: 'vencido' })} alerta={r.vencidos > 0} />
        <Cartao rotulo="A categorizar" contagem={r.sem_categoria} sub={`${r.generica} em conta genérica`} href={url({ situacao: r.sem_categoria ? 'sem_categoria' : 'generica' })} alerta={r.sem_categoria > 0} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {SITUACOES_TITULO.map((s) => (
          <Link key={s} href={url({ situacao: s === 'todos' ? undefined : s })} style={{ ...estiloFiltro(filtros.situacao === s), textDecoration: 'none' }}>{ROT_SIT[s]}</Link>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Tipo" value={filtros.tipo ?? ''} onChange={(e) => router.push(url({ tipo: e.target.value || undefined }))} style={campoCompacto}>
          <option value="">Receber e pagar</option><option value="receber">Só a receber</option><option value="pagar">Só a pagar</option>
        </select>
        <select aria-label="Período por" value={filtros.campo} onChange={(e) => router.push(url({ campo: e.target.value === 'competencia' ? undefined : e.target.value }))} style={campoCompacto}>
          <option value="competencia">Por competência</option><option value="vencimento">Por vencimento</option>
        </select>
        <input type="month" aria-label="De" value={ym(filtros.de)} onChange={(e) => e.target.value && router.push(url({ de: e.target.value, periodo: undefined, ate: ym(filtros.ate) || e.target.value }))} style={campoCompacto} />
        <span style={{ fontSize: 11.5, color: theme.text3 }}>até</span>
        <input type="month" aria-label="Até" value={ym(filtros.ate)} onChange={(e) => e.target.value && router.push(url({ ate: e.target.value, periodo: undefined, de: ym(filtros.de) || e.target.value }))} style={campoCompacto} />
        <Link href={url({ de: ym(mesAtual), ate: ym(mesAtual), periodo: undefined })} style={{ fontSize: 12, color: theme.accent }}>Este mês</Link>
        <Link href={url({ de: undefined, ate: undefined, periodo: 'todos' })} style={{ fontSize: 12, color: theme.accent }}>Todo o período</Link>
        <select aria-label="Conta do plano" value={filtros.plano ?? ''} onChange={(e) => router.push(url({ plano: e.target.value || undefined }))} style={{ ...campoCompacto, maxWidth: 220 }}>
          <option value="">Todas as contas</option>
          {plano.filter((p) => p.aceita_lancamento).map((p) => <option key={p.id_plano_conta} value={p.id_plano_conta}>{p.codigo} {p.nome}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); router.push(url({ q: busca.trim() || undefined })) }} style={{ marginLeft: 'auto' }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição ou contraparte" aria-label="Buscar" style={{ ...campoCompacto, width: 240 }} />
        </form>
      </div>

      <Painel aria-label="Títulos" rotulo={`${titulos.length}${proximo ? '+' : ''} título${titulos.length === 1 ? '' : 's'}${filtros.situacao !== 'todos' ? ` ${ROT_SIT[filtros.situacao as keyof typeof ROT_SIT].toLowerCase()}` : ''}${filtros.de ? ` · ${filtros.campo === 'vencimento' ? 'vencimento' : 'competência'} ${mesCurto(filtros.de)}${filtros.ate && filtros.ate !== filtros.de ? ` a ${mesCurto(filtros.ate)}` : ''}` : ' · todo o período'}`}>
        <div className="v-scroll-x" style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 200, overflowY: 'auto' }}>
          <table className="f-tabela">
            <thead><tr>
              <th style={{ width: 30 }}><input type="checkbox" aria-label="Marcar todos" checked={todosMarcados} onChange={() => setSel(todosMarcados ? [] : titulos.filter((t) => !t.cancelado_em).map((t) => t.id_titulo))} /></th>
              <th style={{ width: 64 }}>Compet.</th><th style={{ width: 84 }}>Vencimento</th><th>Descrição</th><th style={{ width: 230 }}>Conta</th>
              <th className="f-num">R$</th><th style={{ width: 104 }}>Situação</th><th className="f-num">Saldo</th>
            </tr></thead>
            <tbody>
              {titulos.map((t) => {
                const s = situacao(t)
                return (
                  <tr key={t.id_titulo} data-foco={aberto === t.id_titulo ? '1' : undefined} className={t.cancelado_em ? 'f-st-ignorado' : undefined}
                    onClick={() => setAberto(t.id_titulo)} style={{ cursor: 'pointer' }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      {!t.cancelado_em && <input type="checkbox" aria-label={`Marcar ${t.descricao}`} checked={sel.includes(t.id_titulo)} onChange={() => setSel((x) => x.includes(t.id_titulo) ? x.filter((y) => y !== t.id_titulo) : [...x, t.id_titulo])} />}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{mesCurto(t.competencia)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{dataBR(t.data_vencimento)}</td>
                    <td style={{ maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.descricao}>
                      {t.descricao}
                      {t.total_parcelas && <span style={{ color: theme.text3 }}> · {t.parcela}/{t.total_parcelas}</span>}
                      {t.contraparte && <span style={{ color: theme.text3 }}> · {t.contraparte}</span>}
                      {t.origem === 'legado' && <span style={{ color: theme.text3 }}> · histórico</span>}
                    </td>
                    <td style={{ maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.conta
                        ? <><span style={{ color: theme.text3, marginRight: 6 }}>{t.codigo}</span>{t.conta}{t.generica && <span style={{ color: theme.warning }}> · genérica</span>}</>
                        : <span style={{ color: theme.negative, fontWeight: 600 }}>▲ A categorizar</span>}
                    </td>
                    <td className="f-num">{fmtBRL(assinado(t, t.valor))}</td>
                    <td style={{ color: s.cor }}><span aria-hidden>{s.icone}</span> {s.texto}</td>
                    <td className="f-num" style={{ color: t.saldo > 0 && !t.cancelado_em ? undefined : theme.text3 }}>{t.cancelado_em ? '—' : fmtBRL(t.saldo, 'movimento', { zero: 'zero' })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {titulos.length === 0 && <div style={{ padding: 20, fontSize: 12.5, color: theme.text3 }}>Nenhum título neste filtro.</div>}
          {proximo && <div style={{ padding: 12 }}><button onClick={maisLinhas} style={botaoSecundarioCompacto()}>Carregar mais</button></div>}
        </div>
      </Painel>

      {sel.length > 0 && pode('categorizar') && (
        <BarraLote qtd={sel.length} total={selecionados.reduce((s, t) => s + assinado(t, t.saldo), 0)} plano={plano} onLimpar={() => setSel([])}
          onAplicar={async (idPlano, comp) => {
            const res = await A.categorizarLote(sel, idPlano, comp)
            if (!res.ok) return setAviso({ tipo: 'erro', texto: res.mensagem })
            depois(`${res.dados.qtd} título(s) categorizado(s)`)
          }} />
      )}

      {aberto && <Gaveta id={aberto} plano={plano} pode={pode} onFechar={fecharGaveta} onMudou={(texto) => depois(texto)} onErro={avisarErro} />}
      {novo && <ModalNovo org={org} plano={plano} entidades={entidades} mesAtual={mesAtual} onFechar={() => setNovo(false)}
        onCriado={(n) => { setNovo(false); depois(n > 1 ? `${n} parcelas lançadas` : 'Lançamento criado') }} onErro={(texto) => setAviso({ tipo: 'erro', texto })} />}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}

function Cartao({ rotulo, valor, contagem, sub, href, alerta }: { rotulo: string; valor?: number; contagem?: number; sub: string; href?: string; alerta?: boolean }) {
  const conteudo = (
    <div style={{ padding: '14px 16px', background: theme.surface, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${alerta ? theme.negative : theme.border2}`, borderRadius: theme.radiusSm, boxShadow: theme.shadow, height: '100%' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>{rotulo}</div>
      <div style={{ fontFamily: theme.display, fontSize: 26, lineHeight: 1.2, marginTop: 6, fontVariantNumeric: 'tabular-nums', color: theme.text }}>
        {valor !== undefined ? <><span style={{ fontSize: 13, color: theme.text3, marginRight: 4 }}>R$</span>{fmtBRL(valor)}</> : contagem}
      </div>
      <div style={{ fontSize: 11.5, color: theme.text3, marginTop: 3 }}>{alerta && <span style={{ color: theme.negative }}>▲ </span>}{sub}</div>
    </div>
  )
  return href ? <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{conteudo}</Link> : conteudo
}

function BarraLote({ qtd, total, plano, onLimpar, onAplicar }: { qtd: number; total: number; plano: ContaPlano[]; onLimpar: () => void; onAplicar: (idPlano: string, comp?: string) => Promise<void> }) {
  const [conta, setConta] = useState<string | null>(null)
  const [comp, setComp] = useState('')
  const [ocupado, setOcupado] = useState(false)
  return (
    <div role="region" aria-label="Editar em lote" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 50, width: 'min(940px, calc(100vw - 32px))',
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: theme.surface, border: `1px solid ${theme.borderStrong}`, borderRadius: theme.radius, boxShadow: '0 12px 32px rgba(17,23,25,.25)' }}>
      <div style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}><strong>{qtd}</strong> selecionado{qtd === 1 ? '' : 's'} <span style={{ color: theme.text3 }}>· saldo R$ {fmtBRL(total)}</span></div>
      <SeletorPlano plano={plano} valor={conta} onEscolher={(p) => setConta(p.id_plano_conta)} placeholder="Categorizar como…" largura={300} />
      <input type="month" aria-label="Competência (opcional)" title="Mudar também a competência (opcional)" value={comp} onChange={(e) => setComp(e.target.value)} style={campoCompacto} />
      <button disabled={!conta || ocupado} onClick={async () => { setOcupado(true); await onAplicar(conta!, comp ? `${comp}-01` : undefined); setOcupado(false) }} style={botaoPrimarioCompacto(!conta || ocupado)}>
        {ocupado ? 'Aplicando…' : 'Aplicar'}
      </button>
      <button onClick={onLimpar} style={{ ...botaoSecundarioCompacto(), marginLeft: 'auto' }}>Limpar</button>
    </div>
  )
}

