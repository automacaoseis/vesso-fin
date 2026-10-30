'use client'

// Fechamento do mês (docs/PROMPT.md §7, tela 4). O banco manda: checklist (fn_checklist_fechamento), revisor ≠ executor,
// snapshot do DRE ao fechar, trava do mês fechado, reabrir só com motivo. A tela só mostra o estado e oferece o
// próximo passo que o papel de quem está logado permite. Densidade confortável sempre (§6: nunca a densa aqui).
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { fmtBRL, montarDre, type LinhaDreApi } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloCampo } from '@/components/vesso'
import { Aviso, CampoRotulado, Painel } from '@/components/fin-ui'
import * as A from './acoes'

export interface MesFech { competencia: string; status: Status; executor: string | null; enviado_revisao_em: string | null; revisor: string | null; revisado_em: string | null; liberado_por: string | null; liberado_em: string | null; reaberturas: number }
type Status = 'aberto' | 'em_revisao' | 'fechado' | 'liberado'
export interface DetalheFech {
  fechamento: (MesFech & { id_fechamento: string; nota_revisao: string | null; snapshot: { dre: LinhaDreApi[]; saldos: unknown[]; gerado_em: string } | null }) | null
  checklist: { item: string; ok: boolean; bloqueia: boolean; detalhe: string }[]
  eventos: { de_status: string | null; para_status: string; por: string | null; motivo: string | null; em: string }[]
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const mesCurto = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}`
const mesLongo = (d: string) => { const n = MESES_LONGOS[Number(d.slice(5, 7)) - 1] ?? ''; return `${n.charAt(0).toUpperCase()}${n.slice(1)} de ${d.slice(0, 4)}` }
const desloc = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')
const ETAPAS: { s: Status; rotulo: string }[] = [{ s: 'aberto', rotulo: 'Aberto' }, { s: 'em_revisao', rotulo: 'Em revisão' }, { s: 'fechado', rotulo: 'Fechado' }, { s: 'liberado', rotulo: 'Liberado ao cliente' }]
const ROT_STATUS: Record<Status, string> = { aberto: 'Aberto', em_revisao: 'Em revisão', fechado: 'Fechado', liberado: 'Liberado' }
const ICONE_STATUS: Record<Status, string> = { aberto: '○', em_revisao: '◐', fechado: '✓', liberado: '✓' }

export default function FechamentoClient({ org, mes, meses, detalhe, eu, contas }: {
  org: { id: string; nome: string; acoes: string[]; competenciaInicial: string | null }; mes: string; meses: MesFech[]; detalhe: DetalheFech; eu: string | null
  contas: { id_conta: string; apelido: string }[]
}) {
  const router = useRouter()
  const pode = (a: string) => org.acoes.includes(a)
  const f = detalhe.fechamento
  const status: Status = f?.status ?? 'aberto'
  const [ocupado, setOcupado] = useState(false)
  const [nota, setNota] = useState('')
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 9000 : 3000); return () => clearTimeout(t) }, [aviso])

  const bloqueios = detalhe.checklist.filter((c) => c.bloqueia && !c.ok)
  const quem = (uid: string | null) => (!uid ? '—' : uid === eu ? 'você' : 'outra pessoa')
  const historico = org.competenciaInicial && mes < org.competenciaInicial

  async function agir(fn: () => Promise<{ ok: boolean; mensagem?: string }>, ok: string) {
    setOcupado(true)
    const r = await fn()
    setOcupado(false)
    if (!r.ok) return setAviso({ tipo: 'erro', texto: (r as { mensagem: string }).mensagem })
    setNota(''); setMotivo(''); setAviso({ tipo: 'ok', texto: ok }); router.refresh()
  }

  // atalhos para resolver cada item do checklist
  const ym = mes.slice(0, 7)
  const atalho = (item: string): string | null => {
    if (item === 'movimentos pendentes') return `/org/${org.id}/conciliacao?mes=${ym}&status=pendente`
    if (item === 'movimentos divergentes') return `/org/${org.id}/conciliacao?mes=${ym}&status=divergente`
    if (item === 'títulos sem categoria') return `/org/${org.id}/lancamentos?situacao=sem_categoria&de=${ym}&ate=${ym}`
    if (item.startsWith('títulos em conta genérica')) return `/org/${org.id}/lancamentos?situacao=generica&de=${ym}&ate=${ym}`
    if (item.startsWith('saldo conferido')) return '/conexoes'
    return null
  }

  const mapa = new Map(meses.map((m) => [m.competencia, m]))
  const faixa = Array.from({ length: 12 }, (_, i) => `${desloc(mes, i - 9)}-01`)

  const snap = f?.snapshot ? montarDre(f.snapshot.dre, [mes]) : null
  const v = (k: string) => snap?.find((l) => l.chave === k)?.valores[mes] ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `1px solid ${theme.borderStrong}` }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent }}>Fechamento · {org.nome}</div>
          <h1 className="v-manchete" style={{ fontFamily: theme.display, fontSize: 32, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '6px 0 0' }}>{mesLongo(mes)}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm }}>
          <Link href={`?mes=${desloc(mes, -1)}`} aria-label="Mês anterior" style={{ padding: '6px 12px', color: theme.text2, textDecoration: 'none' }}>‹</Link>
          <span style={{ minWidth: 76, textAlign: 'center', fontSize: 12.5, fontWeight: 700 }}>{mesCurto(mes)}</span>
          <Link href={`?mes=${desloc(mes, 1)}`} aria-label="Próximo mês" style={{ padding: '6px 12px', color: theme.text2, textDecoration: 'none' }}>›</Link>
        </div>
      </div>

      {/* faixa de meses: o status de cada um, a um clique */}
      <nav aria-label="Meses" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {faixa.map((m) => {
          const st: Status = mapa.get(m)?.status ?? 'aberto'
          const ativo = m === mes
          const cor = st === 'liberado' || st === 'fechado' ? theme.positive : st === 'em_revisao' ? theme.warning : theme.text3
          return (
            <Link key={m} href={`?mes=${m.slice(0, 7)}`} aria-current={ativo ? 'page' : undefined} style={{
              flex: '0 0 auto', minWidth: 84, padding: '8px 10px', borderRadius: theme.radiusSm, textDecoration: 'none', textAlign: 'center',
              border: `1px solid ${ativo ? theme.accentBorder : theme.border}`, background: ativo ? theme.realceBg2 : theme.surface,
            }}>
              <div style={{ fontSize: 12.5, fontWeight: ativo ? 700 : 500, color: theme.text }}>{mesCurto(m)}</div>
              <div style={{ fontSize: 10.5, color: cor, marginTop: 2 }}>{ICONE_STATUS[st]} {ROT_STATUS[st]}</div>
            </Link>
          )
        })}
      </nav>

      {/* etapas */}
      <ol aria-label="Etapas" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 0, listStyle: 'none', margin: 0, padding: 0 }} className="v-stack">
        {ETAPAS.map((e, i) => {
          const idx = ETAPAS.findIndex((x) => x.s === status)
          const feito = i < idx || (i === idx && (status === 'liberado'))
          const atual = i === idx
          const sub = e.s === 'aberto' ? (f?.reaberturas ? `reaberto ${f.reaberturas}×` : '')
            : e.s === 'em_revisao' ? (f?.executor ? `enviado por ${quem(f.executor)} · ${quando(f.enviado_revisao_em)}` : '')
            : e.s === 'fechado' ? (f?.revisor ? `revisado por ${quem(f.revisor)} · ${quando(f.revisado_em)}` : '')
            : (f?.liberado_por ? `por ${quem(f.liberado_por)} · ${quando(f.liberado_em)}` : '')
          return (
            <li key={e.s} style={{ padding: '12px 14px', borderTop: `3px solid ${atual ? theme.realce : feito ? theme.positive : theme.border}` }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: atual ? theme.realce : theme.text3 }}>{i + 1} · {e.rotulo}</div>
              <div style={{ fontSize: 11.5, color: theme.text3, marginTop: 4, minHeight: 16 }}>{feito && !atual ? '✓ ' : ''}{sub}</div>
            </li>
          )
        })}
      </ol>

      {historico && (
        <div style={{ fontSize: 12.5, color: theme.text2, padding: '10px 14px', background: theme.surface2, borderRadius: theme.radiusSm }}>
          {mesCurto(mes)} é anterior à competência inicial ({mesCurto(org.competenciaInicial!)}): é histórico importado. Dá para fechar, mas a rotina do BPO começa em {mesCurto(org.competenciaInicial!)}.
        </div>
      )}

      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(320px,1fr)', gap: 16, alignItems: 'start' }}>
        <Painel aria-label="Checklist" rotulo={`Checklist · ${detalhe.checklist.filter((c) => c.ok).length} de ${detalhe.checklist.length} ok`}>
          {detalhe.checklist.map((c) => {
            // saldo de conta: dá para informar aqui mesmo (conta sem extrato/API — PayPal, aplicação); o link é o caminho da fonte
            const conta = !c.ok && status === 'aberto' && pode('conciliar') && c.item.startsWith('saldo conferido: ')
              ? contas.find((x) => x.apelido === c.item.slice('saldo conferido: '.length)) : undefined
            const href = !c.ok && !conta ? atalho(c.item) : null
            return (
              <div key={c.item} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto', gap: 10, alignItems: 'baseline', padding: '12px 16px', borderBottom: `1px solid ${theme.borderFaint}` }}>
                <span aria-hidden style={{ color: c.ok ? theme.positive : c.bloqueia ? theme.negative : theme.warning, fontSize: 14 }}>{c.ok ? '✓' : c.bloqueia ? '▲' : '○'}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: c.ok ? 400 : 600, color: c.ok ? theme.text2 : theme.text, textTransform: 'none' }}>{c.item.charAt(0).toUpperCase() + c.item.slice(1)}</div>
                  <div style={{ fontSize: 11.5, color: theme.text3, marginTop: 2 }}>
                    {c.ok ? 'ok' : detalheLegivel(c.detalhe)}{!c.ok && !c.bloqueia && ' · não impede o fechamento'}
                  </div>
                </div>
                {href && <Link href={href} style={{ fontSize: 12, color: theme.accent, whiteSpace: 'nowrap' }}>Resolver →</Link>}
                {conta && <SaldoManual conta={conta} mes={mes} aoSalvar={(r) => r.ok ? (setAviso({ tipo: 'ok', texto: `Saldo de ${conta.apelido} informado` }), router.refresh()) : setAviso({ tipo: 'erro', texto: r.mensagem ?? 'Não deu' })} />}
              </div>
            )
          })}
        </Painel>

        <Painel aria-label="Próximo passo" rotulo="Próximo passo" style={{ borderColor: theme.borderStrong }}>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>
            {f?.nota_revisao && (
              <div style={{ fontSize: 12.5, padding: '9px 12px', background: theme.surface2, borderRadius: theme.radiusSm }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>Nota da revisão</span>
                <div style={{ marginTop: 4 }}>{f.nota_revisao}</div>
              </div>
            )}

            {status === 'aberto' && (pode('enviar_revisao') ? (
              <>
                <div style={{ fontSize: 13, color: theme.text2 }}>
                  {bloqueios.length ? <><span style={{ color: theme.negative }}>▲ </span>{bloqueios.length} item(ns) do checklist impedem o envio.</> : 'Checklist em ordem. Envie para outra pessoa revisar.'}
                </div>
                <button disabled={ocupado || bloqueios.length > 0} onClick={() => agir(() => A.enviar(org.id, mes), 'Enviado para revisão')} style={{ ...botaoPrimario(ocupado || bloqueios.length > 0), width: '100%' }}>
                  Enviar para revisão
                </button>
              </>
            ) : <Sem>Seu papel nesta organização não envia fechamento para revisão.</Sem>)}

            {status === 'em_revisao' && (f?.executor === eu
              ? <Sem>Você enviou este mês. A revisão precisa ser feita por <strong>outra pessoa</strong> — o banco não deixa o executor revisar.</Sem>
              : pode('revisar') ? (
                <>
                  <CampoRotulado rotulo="Nota" extra={<span style={{ color: theme.text3 }}>obrigatória para devolver</span>}>
                    <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={2000} placeholder="O que você conferiu, ou o que precisa ser corrigido" style={{ ...estiloCampo, resize: 'vertical' }} />
                  </CampoRotulado>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button disabled={ocupado} onClick={() => agir(() => A.revisar(org.id, mes, true, nota), 'Mês fechado')} style={{ ...botaoPrimario(ocupado), flex: 1 }}>Aprovar e fechar</button>
                    <button disabled={ocupado || nota.trim().length < 5} onClick={() => agir(() => A.revisar(org.id, mes, false, nota), 'Devolvido ao executor')} style={{ ...botaoSecundario(), opacity: nota.trim().length < 5 ? 0.45 : 1 }}>Devolver</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: theme.text3 }}>Ao fechar, o DRE e os saldos do mês ficam congelados e nada mais muda nesta competência.</div>
                </>
              ) : <Sem>Aguardando revisão. Seu papel nesta organização não revisa.</Sem>)}

            {status === 'fechado' && (pode('liberar')
              ? <>
                  <div style={{ fontSize: 13, color: theme.text2 }}>Revisado e travado. Liberar deixa o mês visível para o cliente no portal.</div>
                  <button disabled={ocupado} onClick={() => agir(() => A.liberar(org.id, mes), 'Liberado ao cliente')} style={{ ...botaoPrimario(ocupado), width: '100%' }}>Liberar ao cliente</button>
                </>
              : <Sem>Fechado. Liberar ao cliente é com o head do produto ou o dono.</Sem>)}

            {status === 'liberado' && <Sem>✓ Liberado {quando(f?.liberado_em ?? null)}. O cliente já vê este mês.</Sem>}

            {(status === 'fechado' || status === 'liberado') && pode('reabrir') && (
              <div style={{ display: 'grid', gap: 8, paddingTop: 12, borderTop: `1px solid ${theme.borderFaint}` }}>
                <CampoRotulado rotulo="Reabrir o mês" extra={<span style={{ color: theme.text3 }}>motivo de 10+ caracteres, fica registrado</span>}>
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: nota fiscal de setembro chegou depois" style={estiloCampo} />
                </CampoRotulado>
                <button disabled={ocupado || motivo.trim().length < 10} onClick={() => agir(() => A.reabrir(org.id, mes, motivo), 'Mês reaberto')}
                  style={{ ...botaoSecundario(), justifySelf: 'start', color: theme.negative, opacity: motivo.trim().length < 10 ? 0.45 : 1 }}>Reabrir</button>
              </div>
            )}
          </div>
        </Painel>
      </div>

      {snap && (
        <Painel aria-label="Resultado congelado" rotulo={`Resultado congelado no fechamento · ${quando(f!.snapshot!.gerado_em)}`}>
          <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            {([['Receita bruta', 'RECEITA_BRUTA'], ['EBITDA', 'EBITDA'], ['Lucro líquido', 'LUCRO_LIQUIDO'], ['Margem líquida', 'MARGEM_LIQUIDA']] as const).map(([r, k]) => (
              <div key={k} style={{ padding: '14px 16px', borderRight: `1px solid ${theme.borderFaint}` }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>{r}</div>
                <div style={{ fontFamily: theme.display, fontSize: 22, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                  {k === 'MARGEM_LIQUIDA' ? (Number.isFinite(v(k)) ? `${(v(k) * 100).toFixed(1).replace('.', ',')}%` : '—') : fmtBRL(v(k), 'demonstrativo', { zero: 'traco' })}
                </div>
              </div>
            ))}
          </div>
        </Painel>
      )}

      <Painel aria-label="Histórico" rotulo="Histórico do fechamento">
        {detalhe.eventos.length === 0 ? <div style={{ padding: 14, fontSize: 12.5, color: theme.text3 }}>Nenhuma movimentação ainda.</div> : detalhe.eventos.slice().reverse().map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0,1fr)', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${theme.borderFaint}`, fontSize: 12.5 }}>
            <span style={{ color: theme.text3, fontVariantNumeric: 'tabular-nums' }}>{quando(e.em)}</span>
            <span>{ROT_STATUS[(e.de_status ?? 'aberto') as Status]} → <strong>{ROT_STATUS[e.para_status as Status]}</strong> · {quem(e.por)}{e.motivo && <span style={{ color: theme.text2 }}> — {e.motivo}</span>}</span>
          </div>
        ))}
      </Painel>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}

function Sem({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: theme.text2, lineHeight: 1.5 }}>{children}</div>
}

// O banco formata a diferença com to_char (separador do locale do servidor, en-US em produção) → reescreve em R$.
// dif = saldo da fonte − saldo do sistema.
function detalheLegivel(d: string) {
  const m = /^diferença (-?[\d.,]+)$/.exec(d)
  if (!m) return d
  const n = Number(m[1]!.replace(/,/g, ''))
  return `saldo da conta R$ ${fmtBRL(Math.abs(n))} ${n > 0 ? 'acima' : 'abaixo'} do sistema — falta lançar ou conciliar algo`
}

// Último dia do mês (ou hoje, se o mês ainda corre) — é a data que o checklist confere (últimos 3 dias).
function dataPadrao(mes: string) {
  const fim = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10)
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  return fim < hoje ? fim : hoje
}
// "1.234,56" / "-12,5" / "1234.56" → número; vazio ou lixo → null
function lerValor(t: string): number | null {
  const s = t.trim().replace(/\s|R\$/g, '')
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return s && Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function SaldoManual({ conta, mes, aoSalvar }: { conta: { id_conta: string; apelido: string }; mes: string; aoSalvar: (r: { ok: boolean; mensagem?: string }) => void }) {
  const [aberto, setAberto] = useState(false)
  const [data, setData] = useState(() => dataPadrao(mes))
  const [valor, setValor] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const n = lerValor(valor)
  if (!aberto) return <button onClick={() => setAberto(true)} style={{ fontSize: 12, color: theme.accent, background: 'none', border: 0, padding: 0, cursor: 'pointer', whiteSpace: 'nowrap' }}>Informar saldo</button>
  return (
    <form aria-label={`Informar saldo de ${conta.apelido}`} style={{ gridColumn: '2 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}
      onSubmit={async (e) => {
        e.preventDefault(); if (n === null) return
        setOcupado(true); const r = await A.informarSaldo(conta.id_conta, data, n); setOcupado(false)
        aoSalvar(r as { ok: boolean; mensagem?: string }); if (r.ok) setAberto(false)
      }}>
      <input type="date" value={data} onChange={(e) => setData(e.target.value)} aria-label="Data do saldo" style={{ ...estiloCampo, width: 150 }} />
      <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="Saldo, ex.: 1.234,56" aria-label="Saldo" autoFocus style={{ ...estiloCampo, width: 170, fontVariantNumeric: 'tabular-nums' }} />
      <button type="submit" disabled={ocupado || n === null} style={botaoPrimario(ocupado || n === null)}>Salvar</button>
      <button type="button" onClick={() => setAberto(false)} style={botaoSecundario()}>Cancelar</button>
      <span style={{ flexBasis: '100%', fontSize: 11.5, color: theme.text3 }}>Saldo da conta no fim do dia, como aparece no app do banco ou da plataforma. Fica registrado quem informou.</span>
    </form>
  )
}
