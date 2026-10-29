'use client'

// Resumo da organização (docs/PROMPT.md §7, tela 5) — o Fluxo de Caixa do seis-sistema (FluxoProjecaoChart,
// FluxoCardsTopo, FluxoSaldoCaixa, CardsResultadoMes) sobre os dados do Vesso FIN, no vocabulário do admin.
// Gráfico: UMA série (saldo diário), realizado em linha cheia e projetado tracejado — sem legenda (o título nomeia),
// referência no zero e em "hoje", dica ao passar o mouse e tabela equivalente.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtBRL, montarDre, type LinhaDreApi } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimarioCompacto, botaoSecundarioCompacto, Painel } from '@/components/fin-ui'

interface Conta { id_conta: string; apelido: string; instituicao: string; tipo: string; saldo_inicial: number; data_saldo_inicial: string; saldo_sistema: number; fonte_data: string | null; fonte_saldo: number | null; sistema_na_data_fonte: number | null }
interface Ponto { data: string; tipo: 'realizado' | 'projetado'; entradas: number; saidas: number; saldo: number }
export interface DadosResumo {
  hoje: string; contas: Conta[]; abertos: { tipo: 'pagar' | 'receber'; faixa: string; qtd: number; total: number }[]
  serie: Ponto[]; dre: LinhaDreApi[]; pendencias: { tipo_item: string; qtd: number; valor: number }[]
  ultimo_fechamento: { competencia: string; status: string } | null
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesCurto = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}`
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const compacto = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  return a >= 1e6 ? `${s}${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : a >= 1e3 ? `${s}${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : `${s}${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}
const FAIXAS: [string, string][] = [['vencido', 'Vencido'], ['hoje', 'Hoje'], ['7_dias', 'Até 7 dias'], ['30_dias', 'Até 30 dias'], ['depois', 'Depois']]
const STATUS_FECH: Record<string, string> = { aberto: 'aberto', em_revisao: 'em revisão', fechado: 'fechado', liberado: 'liberado ao cliente' }

export default function ResumoClient({ org, dados }: { org: { id: string; nome: string; tipo: string; competenciaInicial: string | null }; dados: DadosResumo }) {
  const [verTabela, setVerTabela] = useState(false)
  const saldoTotal = dados.contas.reduce((s, c) => s + c.saldo_sistema, 0)
  const conferidas = dados.contas.filter((c) => c.fonte_data)
  const totalAberto = (tipo: string, faixa?: string) => dados.abertos.filter((a) => a.tipo === tipo && (!faixa || a.faixa === faixa)).reduce((s, a) => s + a.total, 0)

  // resultado do mês (competência) e do anterior — mesma montagem do DRE dos Relatórios
  const mesAtual = `${dados.hoje.slice(0, 7)}-01`
  const mesAnt = (() => { const d = new Date(Date.UTC(+dados.hoje.slice(0, 4), +dados.hoje.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 10) })()
  const dre = useMemo(() => montarDre(dados.dre, [mesAnt, mesAtual]), [dados.dre, mesAnt, mesAtual])
  const linha = (k: string, m: string) => dre.find((l) => l.chave === k)?.valores[m] ?? 0

  // série: uma linha por dia; hoje tem os dois pontos (o projetado parte do realizado)
  const pontos = useMemo(() => {
    const m = new Map<string, { data: string; realizado?: number; projetado?: number; entradas: number; saidas: number }>()
    for (const p of dados.serie) {
      const x = m.get(p.data) ?? m.set(p.data, { data: p.data, entradas: 0, saidas: 0 }).get(p.data)!
      if (p.tipo === 'realizado') x.realizado = p.saldo; else x.projetado = p.saldo
      x.entradas += p.entradas; x.saidas += p.saidas
    }
    return [...m.values()]
  }, [dados.serie])
  const futuro = pontos.filter((p) => p.projetado !== undefined)
  const menor = futuro.reduce<typeof futuro[number] | null>((min, p) => (!min || p.projetado! < min.projetado! ? p : min), null)

  const pend = (t: string) => dados.pendencias.find((p) => p.tipo_item === t)
  const itensPend: { rotulo: string; qtd: number; valor?: number; href: string; alerta: boolean }[] = [
    { rotulo: 'Movimentos a conciliar', qtd: pend('movimento_pendente')?.qtd ?? 0, href: `/org/${org.id}/conciliacao?status=pendente`, alerta: false },
    { rotulo: 'Movimentos divergentes', qtd: pend('movimento_divergente')?.qtd ?? 0, href: `/org/${org.id}/conciliacao?status=divergente`, alerta: true },
    { rotulo: 'Contas a pagar vencidas', qtd: pend('pagar_vencido')?.qtd ?? 0, valor: pend('pagar_vencido')?.valor, href: `/org/${org.id}/lancamentos?situacao=vencido&tipo=pagar&periodo=todos`, alerta: true },
    { rotulo: 'Recebimentos vencidos', qtd: pend('receber_vencido')?.qtd ?? 0, valor: pend('receber_vencido')?.valor, href: `/org/${org.id}/lancamentos?situacao=vencido&tipo=receber&periodo=todos`, alerta: true },
    { rotulo: 'Títulos a categorizar', qtd: pend('titulo_sem_categoria')?.qtd ?? 0, href: `/org/${org.id}/lancamentos?situacao=sem_categoria&periodo=todos`, alerta: false },
    { rotulo: 'Conexões atrasadas', qtd: pend('conexao_atrasada')?.qtd ?? 0, href: '/conexoes', alerta: true },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `1px solid ${theme.borderStrong}` }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent }}>Resumo{org.tipo === 'casa' ? ' · casa' : ''}</div>
          <h1 className="v-manchete" style={{ fontFamily: theme.display, fontSize: 32, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '6px 0 0' }}>{org.nome}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/org/${org.id}/lancamentos`} style={{ ...botaoSecundarioCompacto(), textDecoration: 'none' }}>Lançamentos</Link>
          <Link href={`/org/${org.id}/conciliacao`} style={{ ...botaoPrimarioCompacto(), textDecoration: 'none' }}>Conciliar</Link>
        </div>
      </div>

      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
        <Cartao rotulo="Saldo em contas" valor={saldoTotal}
          sub={conferidas.length === dados.contas.length && dados.contas.length ? `conferido com a fonte em ${diaMes(conferidas.map((c) => c.fonte_data!).sort()[0]!)}` : `${dados.contas.length - conferidas.length} de ${dados.contas.length} conta(s) sem saldo da fonte`}
          alerta={conferidas.length < dados.contas.length} />
        <Cartao rotulo="A receber em aberto" valor={totalAberto('receber')} sub={totalAberto('receber', 'vencido') ? `${fmtBRL(totalAberto('receber', 'vencido'))} vencido` : 'nada vencido'} alerta={totalAberto('receber', 'vencido') > 0} />
        <Cartao rotulo="A pagar em aberto" valor={-totalAberto('pagar')} sub={totalAberto('pagar', 'vencido') ? `${fmtBRL(totalAberto('pagar', 'vencido'))} vencido` : 'nada vencido'} alerta={totalAberto('pagar', 'vencido') > 0} />
        <Cartao rotulo={`Resultado de ${mesCurto(mesAtual)}`} valor={linha('LUCRO_LIQUIDO', mesAtual)}
          sub={`margem ${Number.isFinite(linha('MARGEM_LIQUIDA', mesAtual)) ? `${(linha('MARGEM_LIQUIDA', mesAtual) * 100).toFixed(1).replace('.', ',')}%` : '—'} · ${mesCurto(mesAnt)}: ${fmtBRL(linha('LUCRO_LIQUIDO', mesAnt))}`} />
      </div>

      <Painel aria-label="Saldo diário" rotulo="Saldo diário · 30 dias realizados e 60 projetados pelos títulos em aberto"
        direita={<button onClick={() => setVerTabela((v) => !v)} style={{ ...botaoSecundarioCompacto(), padding: '3px 10px', fontSize: 11.5 }}>{verTabela ? 'Ver gráfico' : 'Ver tabela'}</button>}>
        {!verTabela ? (
          <div style={{ padding: '16px 12px 8px' }}>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pontos} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="var(--v-borderFaint)" vertical={false} />
                  <XAxis dataKey="data" tickFormatter={diaMes} interval={14} tick={{ fontSize: 11, fill: 'var(--v-text3)' }} axisLine={{ stroke: 'var(--v-border2)' }} tickLine={false} />
                  <YAxis tickFormatter={compacto} width={64} tick={{ fontSize: 11, fill: 'var(--v-text3)' }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={0} stroke="var(--v-border3)" />
                  <ReferenceLine x={dados.hoje} stroke="var(--v-border3)" strokeDasharray="3 3" label={{ value: 'hoje', position: 'insideTopRight', fontSize: 11, fill: 'var(--v-text3)' }} />
                  <Tooltip content={<Dica />} cursor={{ stroke: 'var(--v-border3)' }} />
                  <Line dataKey="realizado" stroke="var(--v-realce)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--v-surface)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="projetado" stroke="var(--v-realce)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: 'var(--v-surface)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: theme.text3, padding: '6px 8px 4px' }}>
              <span><svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="var(--v-realce)" strokeWidth="2" /></svg> realizado (extrato)</span>
              <span><svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="var(--v-realce)" strokeWidth="2" strokeDasharray="5 4" /></svg> projetado (títulos em aberto; vencidos contam hoje)</span>
              {menor && <span style={{ marginLeft: 'auto', color: menor.projetado! < 0 ? theme.negative : theme.text3 }}>
                {menor.projetado! < 0 ? '▲ ' : ''}menor saldo projetado: R$ {fmtBRL(menor.projetado!)} em {diaMes(menor.data)}
              </span>}
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table className="f-tabela">
              <thead><tr><th>Dia</th><th>Tipo</th><th className="f-num">Entradas</th><th className="f-num">Saídas</th><th className="f-num">Saldo</th></tr></thead>
              <tbody>{dados.serie.map((p) => (
                <tr key={`${p.data}${p.tipo}`}><td>{p.data.split('-').reverse().join('/')}</td><td>{p.tipo}</td>
                  <td className="f-num">{fmtBRL(p.entradas, 'movimento', { zero: 'traco' })}</td><td className="f-num">{fmtBRL(p.saidas, 'movimento', { zero: 'traco' })}</td><td className="f-num">{fmtBRL(p.saldo)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Painel>

      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <Painel aria-label="Saldo por conta" rotulo="Saldo por conta">
          <table className="f-tabela">
            <thead><tr><th>Conta</th><th className="f-num">Sistema</th><th className="f-num">Fonte</th><th style={{ width: 150 }}>Conferência</th></tr></thead>
            <tbody>{dados.contas.map((c) => {
              const dif = c.fonte_saldo !== null && c.sistema_na_data_fonte !== null ? Math.round((c.sistema_na_data_fonte - c.fonte_saldo) * 100) / 100 : null
              return (
                <tr key={c.id_conta}>
                  <td>{c.apelido}</td>
                  <td className="f-num">{fmtBRL(c.saldo_sistema)}</td>
                  <td className="f-num">{c.fonte_saldo !== null ? fmtBRL(c.fonte_saldo) : '—'}</td>
                  <td style={{ color: dif === null ? theme.text3 : dif === 0 ? theme.positive : theme.negative }}>
                    {dif === null ? '— sem saldo da fonte' : dif === 0 ? `✓ bate em ${diaMes(c.fonte_data!)}` : <span className="f-delta">▲ Δ {fmtBRL(dif)} em {diaMes(c.fonte_data!)}</span>}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
          {dados.contas.some((c) => !c.fonte_data) && (
            <div style={{ padding: '10px 14px', fontSize: 11.5, color: theme.text3, borderTop: `1px solid ${theme.borderFaint}` }}>
              Sem o saldo informado pela fonte (OFX ou Asaas), o saldo do sistema depende do saldo inicial da conta estar certo.
            </div>
          )}
        </Painel>

        <Painel aria-label="Em aberto por vencimento" rotulo="Em aberto por vencimento">
          <table className="f-tabela">
            <thead><tr><th>Vencimento</th><th className="f-num">A receber</th><th className="f-num">A pagar</th></tr></thead>
            <tbody>{FAIXAS.map(([k, r]) => (
              <tr key={k}>
                <td style={{ color: k === 'vencido' && (totalAberto('receber', k) || totalAberto('pagar', k)) ? theme.negative : undefined }}>{k === 'vencido' ? '▲ ' : ''}{r}</td>
                <td className="f-num">{fmtBRL(totalAberto('receber', k), 'movimento', { zero: 'traco' })}</td>
                <td className="f-num">{fmtBRL(-totalAberto('pagar', k), 'movimento', { zero: 'traco' })}</td>
              </tr>
            ))}
              <tr><td style={{ fontWeight: 700 }}>Total</td><td className="f-num" style={{ fontWeight: 700 }}>{fmtBRL(totalAberto('receber'), 'movimento', { zero: 'traco' })}</td><td className="f-num" style={{ fontWeight: 700 }}>{fmtBRL(-totalAberto('pagar'), 'movimento', { zero: 'traco' })}</td></tr>
            </tbody>
          </table>
        </Painel>
      </div>

      <Painel aria-label="Pendências" rotulo={`Pendências${org.competenciaInicial ? ` · a partir de ${mesCurto(org.competenciaInicial)} (antes disso é histórico)` : ''}`} direita={dados.ultimo_fechamento && <span style={{ fontSize: 11.5, color: theme.text3 }}>último fechamento: {mesCurto(dados.ultimo_fechamento.competencia)} · {STATUS_FECH[dados.ultimo_fechamento.status] ?? dados.ultimo_fechamento.status}</span>}>
        <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          {itensPend.map((p) => (
            <Link key={p.rotulo} href={p.href} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '14px 16px', textDecoration: 'none', color: theme.text, borderTop: `1px solid ${theme.borderFaint}`, borderRight: `1px solid ${theme.borderFaint}` }}>
              <span style={{ fontSize: 12.5 }}>{p.qtd > 0 && p.alerta ? <span style={{ color: theme.negative }}>▲ </span> : p.qtd === 0 ? <span style={{ color: theme.positive }}>✓ </span> : '○ '}{p.rotulo}</span>
              <span style={{ fontFamily: theme.display, fontSize: 20, color: p.qtd ? theme.text : theme.text3 }}>{p.qtd}{p.valor ? <span style={{ fontFamily: 'inherit', fontSize: 11.5, color: theme.text3, marginLeft: 6 }}>R$ {fmtBRL(p.valor)}</span> : null}</span>
            </Link>
          ))}
        </div>
      </Painel>
    </div>
  )
}

function Cartao({ rotulo, valor, sub, alerta }: { rotulo: string; valor: number; sub: string; alerta?: boolean }) {
  return (
    <div style={{ padding: '14px 16px', background: theme.surface, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${alerta ? theme.negative : theme.border2}`, borderRadius: theme.radiusSm, boxShadow: theme.shadow }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>{rotulo}</div>
      <div style={{ fontFamily: theme.display, fontSize: 26, lineHeight: 1.2, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: 13, color: theme.text3, marginRight: 4 }}>R$</span>{fmtBRL(valor)}
      </div>
      <div style={{ fontSize: 11.5, color: theme.text3, marginTop: 3 }}>{alerta && <span style={{ color: theme.negative }}>▲ </span>}{sub}</div>
    </div>
  )
}

interface PontoDica { data: string; realizado?: number; projetado?: number; entradas: number; saidas: number }
function Dica({ active, payload }: { active?: boolean; payload?: { payload: PontoDica }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0]!.payload
  const saldo = p.projetado ?? p.realizado ?? 0
  return (
    <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, boxShadow: '0 8px 24px rgba(17,23,25,.18)', padding: '9px 12px', fontSize: 12, minWidth: 180 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.data.split('-').reverse().join('/')} · {p.projetado !== undefined && p.realizado === undefined ? 'projetado' : p.realizado !== undefined && p.projetado !== undefined ? 'hoje' : 'realizado'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 14px', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: theme.text3 }}>Entradas</span><span>{fmtBRL(p.entradas, 'movimento', { zero: 'traco' })}</span>
        <span style={{ color: theme.text3 }}>Saídas</span><span>{fmtBRL(p.saidas, 'movimento', { zero: 'traco' })}</span>
        <span style={{ color: theme.text3 }}>Saldo</span><span style={{ fontWeight: 700 }}>{fmtBRL(saldo)}</span>
      </div>
    </div>
  )
}
