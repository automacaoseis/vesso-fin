'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtBRL } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { estiloAba } from '@/components/vesso'
import { Aviso, botaoPrimarioCompacto, campoCompacto, Painel } from '@/components/fin-ui'
import type { ContaPlano } from '@/components/SeletorPlano'
import { Gaveta, ModalNovo, dataBR, mesCurto } from '../lancamentos/pecas'
import type { Entidade } from '../lancamentos/tipos'

export interface Aberto {
  id_titulo: string; tipo: 'pagar' | 'receber'; descricao: string; competencia: string; data_vencimento: string
  valor: number | string; valor_baixado: number | string; saldo: number | string; dias_atraso: number
  faixa: Faixa; id_plano_conta: string | null; conta: string | null; generica: boolean | null; contraparte: string | null
  parcela: number | null; total_parcelas: number | null
}
type Faixa = 'vencido' | 'hoje' | '7_dias' | '30_dias' | 'depois'
const FAIXAS: { f: Faixa; rotulo: string; cor: string }[] = [
  { f: 'vencido', rotulo: 'Vencido', cor: theme.negative }, { f: 'hoje', rotulo: 'Vence hoje', cor: theme.warning },
  { f: '7_dias', rotulo: 'Próximos 7 dias', cor: theme.text }, { f: '30_dias', rotulo: '8 a 30 dias', cor: theme.text },
  { f: 'depois', rotulo: 'Depois de 30 dias', cor: theme.text },
]
const LIMITE = 500
const n = (v: number | string) => Number(v)
const soma = (l: Aberto[]) => Math.round(l.reduce((s, t) => s + n(t.saldo), 0) * 100) / 100

function quando(t: Aberto) {
  const d = t.dias_atraso
  return d > 0 ? `há ${d} dia${d > 1 ? 's' : ''}` : d === 0 ? 'hoje' : `em ${-d} dia${d < -1 ? 's' : ''}`
}

export default function VencimentosClient({ org, tipo, faixaInicial, abertos, plano, entidades, mesAtual }: {
  org: { id: string; nome: string; acoes: string[] }; tipo: 'pagar' | 'receber'; faixaInicial?: string
  abertos: { pagar: Aberto[]; receber: Aberto[] }; plano: ContaPlano[]; entidades: Entidade[]; mesAtual: string
}) {
  const router = useRouter()
  const pode = (a: string) => org.acoes.includes(a)
  const lista = abertos[tipo]
  const [faixa, setFaixa] = useState<Faixa | null>(FAIXAS.some((x) => x.f === faixaInicial) ? (faixaInicial as Faixa) : null)
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 9000 : 3000); return () => clearTimeout(t) }, [aviso])
  const depois = (texto: string) => { setAviso({ tipo: 'ok', texto }); router.refresh() }
  // estáveis: a Gaveta refaz a busca quando estes mudam
  const fecharGaveta = useCallback(() => setAberto(null), [])
  const avisarErro = useCallback((texto: string) => setAviso({ tipo: 'erro', texto }), [])

  const porFaixa = useMemo(() => Object.fromEntries(FAIXAS.map(({ f }) => [f, lista.filter((t) => t.faixa === f)])) as Record<Faixa, Aberto[]>, [lista])
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (faixa ? porFaixa[faixa] : lista).filter((t) => !q || t.descricao.toLowerCase().includes(q) || (t.contraparte ?? '').toLowerCase().includes(q) || (t.conta ?? '').toLowerCase().includes(q))
  }, [faixa, busca, lista, porFaixa])
  const total = soma(lista)
  const outro = tipo === 'pagar' ? 'receber' : 'pagar'
  const proximos30 = soma([...porFaixa.hoje, ...porFaixa['7_dias'], ...porFaixa['30_dias']])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `1px solid ${theme.borderStrong}` }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent }}>Vencimentos · {org.nome}</div>
          <nav aria-label="Tipo" style={{ display: 'flex', gap: 22, marginTop: 8 }}>
            {(['pagar', 'receber'] as const).map((t) => (
              <Link key={t} href={`?tipo=${t}`} aria-current={t === tipo ? 'page' : undefined} style={{ ...estiloAba(t === tipo), fontFamily: theme.display, fontSize: 26, fontWeight: 500, textDecoration: 'none', padding: '0 0 4px' }}>
                {t === 'pagar' ? 'A pagar' : 'A receber'}
              </Link>
            ))}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>Total em aberto</div>
            <div style={{ fontFamily: theme.display, fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>R$ {fmtBRL(total)}</div>
            <div style={{ fontSize: 11, color: theme.text3 }}>a {outro}: R$ {fmtBRL(soma(abertos[outro]))}</div>
          </div>
          {pode('lancar') && <button onClick={() => setNovo(true)} style={botaoPrimarioCompacto()}>+ Novo {tipo === 'pagar' ? 'a pagar' : 'a receber'}</button>}
        </div>
      </div>

      {/* faixas de vencimento — clicar filtra */}
      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 10 }}>
        {FAIXAS.map(({ f, rotulo, cor }) => {
          const l = porFaixa[f]; const ativo = faixa === f
          return (
            <button key={f} onClick={() => setFaixa(ativo ? null : f)} aria-pressed={ativo} style={{
              textAlign: 'left', padding: '12px 14px', borderRadius: theme.radiusSm, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${ativo ? theme.accentBorder : theme.border}`, background: ativo ? theme.realceBg2 : theme.surface, color: theme.text,
            }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: l.length && f === 'vencido' ? theme.negative : theme.text3 }}>
                {f === 'vencido' && l.length > 0 ? '▲ ' : ''}{rotulo}
              </div>
              <div style={{ fontFamily: theme.display, fontSize: 21, marginTop: 4, fontVariantNumeric: 'tabular-nums', color: l.length ? cor : theme.text3 }}>{l.length ? `R$ ${fmtBRL(soma(l))}` : '—'}</div>
              <div style={{ fontSize: 11, color: theme.text3, marginTop: 2 }}>{l.length} título{l.length === 1 ? '' : 's'}</div>
            </button>
          )
        })}
      </div>
      {proximos30 > 0 && <div style={{ fontSize: 12, color: theme.text2 }}>Nos próximos 30 dias {tipo === 'pagar' ? 'saem' : 'entram'} <strong>R$ {fmtBRL(proximos30)}</strong>{porFaixa.vencido.length > 0 && <>, além de <strong style={{ color: theme.negative }}>R$ {fmtBRL(soma(porFaixa.vencido))}</strong> já vencidos</>}.</div>}

      <Painel aria-label="Títulos em aberto" rotulo={`${visiveis.length} em aberto${faixa ? ` · ${FAIXAS.find((x) => x.f === faixa)!.rotulo.toLowerCase()}` : ''}`}
        direita={<input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição, contraparte, categoria" aria-label="Buscar" style={{ ...campoCompacto, width: 260 }} />}>
        {visiveis.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: theme.text3 }}>{lista.length === 0 ? `Nada ${tipo === 'pagar' ? 'a pagar' : 'a receber'} em aberto.` : 'Nada neste filtro.'}</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="f-tabela">
              <thead><tr><th>Vencimento</th><th>Descrição</th><th>{tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}</th><th>Categoria</th><th>Compet.</th><th className="f-num">Valor</th><th className="f-num">Baixado</th><th className="f-num">Saldo</th></tr></thead>
              <tbody>
                {visiveis.map((t) => (
                  <tr key={t.id_titulo} tabIndex={0} onClick={() => setAberto(t.id_titulo)} onKeyDown={(e) => { if (e.key === 'Enter') setAberto(t.id_titulo) }}
                    data-foco={aberto === t.id_titulo ? '1' : undefined} className={t.faixa === 'vencido' ? 'f-st-divergente' : undefined} style={{ cursor: 'pointer' }}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{dataBR(t.data_vencimento)} <span style={{ color: theme.text3 }}>· {quando(t)}</span></td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.descricao}>
                      {t.descricao}{t.total_parcelas && <span style={{ color: theme.text3 }}> · {t.parcela}/{t.total_parcelas}</span>}
                    </td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.contraparte ?? <span style={{ color: theme.text3 }}>—</span>}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.conta ? <>{t.conta}{t.generica && <span style={{ color: theme.warning }}> · genérica</span>}</> : <span style={{ color: theme.warning }}>○ sem categoria</span>}
                    </td>
                    <td>{mesCurto(t.competencia)}</td>
                    <td className="f-num">{fmtBRL(n(t.valor))}</td>
                    <td className="f-num">{n(t.valor_baixado) ? fmtBRL(n(t.valor_baixado)) : '—'}</td>
                    <td className="f-num" style={{ fontWeight: 600 }}>{fmtBRL(n(t.saldo))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lista.length >= LIMITE && <div style={{ padding: '10px 16px', fontSize: 11.5, color: theme.text3 }}>Mostrando os {LIMITE} primeiros por vencimento; os totais acima contam só estes. A lista completa está em Lançamentos.</div>}
      </Painel>
      <div style={{ fontSize: 11.5, color: theme.text3 }}>
        A baixa acontece na Conciliação, ao casar o título com o movimento do extrato. Clique numa linha para ver o detalhe, categorizar ou cancelar.
      </div>

      {aberto && <Gaveta id={aberto} plano={plano} pode={pode} onFechar={fecharGaveta} onMudou={(texto) => depois(texto)} onErro={avisarErro} />}
      {novo && <ModalNovo org={org} plano={plano} entidades={entidades} mesAtual={mesAtual} tipoInicial={tipo} onFechar={() => setNovo(false)}
        onCriado={(q) => { setNovo(false); depois(q > 1 ? `${q} parcelas lançadas` : 'Lançamento criado') }} onErro={(texto) => setAviso({ tipo: 'erro', texto })} />}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}
