'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ETAPAS_TEMPO, type EtapaTempo } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloCampo } from '@/components/vesso'
import { Aviso, Painel } from '@/components/fin-ui'
import { deslocarMes, mesCurto } from '@/lib/datas'
import * as A from './acoes'

interface LinhaTempo { id_org: string; organizacao: string; competencia: string; etapa: EtapaTempo; user_auth_id: string; minutos: number; sessoes: number }
interface Aberta { id_org: string; organizacao: string; etapa: EtapaTempo; user_auth_id: string; inicio: string }
export interface DadosEquipe { tempo: LinhaTempo[]; agora: Aberta[]; pessoas: { user_auth_id: string; email: string }[] }

const ROT_ETAPA: Record<EtapaTempo, string> = {
  importacao: 'Importação', conciliacao: 'Conciliação', categorizacao: 'Categorização', contas_pagar: 'Contas a pagar',
  contas_receber: 'Contas a receber', documentos: 'Documentos', fechamento: 'Fechamento', revisao: 'Revisão',
  reuniao_cliente: 'Reunião com cliente', implantacao: 'Implantação', outro: 'Outro',
}
const horas = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`)
const decorrido = (iso: string, agora: number) => horas(Math.max(0, Math.round((agora - Date.parse(iso)) / 60000)))

export default function EquipeClient({ mes, dados, orgs, eu }: {
  mes: string; dados: DadosEquipe; orgs: { id_org: string; nome: string }[]; eu: string | null
}) {
  const router = useRouter()
  const email = useMemo(() => new Map(dados.pessoas.map((p) => [p.user_auth_id, p.email])), [dados.pessoas])
  const quem = (id: string) => (id === eu ? 'você' : email.get(id) ?? 'pessoa sem acesso visível')
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30000); return () => clearInterval(t) }, [])
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 9000 : 3000); return () => clearTimeout(t) }, [aviso])

  const minha = dados.agora.find((a) => a.user_auth_id === eu)
  const outros = dados.agora.filter((a) => a.user_auth_id !== eu)

  // por organização × etapa
  const etapasUsadas = ETAPAS_TEMPO.filter((e) => dados.tempo.some((t) => t.etapa === e))
  const porOrg = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; etapa: Partial<Record<EtapaTempo, number>>; pessoas: Set<string> }>()
    for (const t of dados.tempo) {
      const o = m.get(t.id_org) ?? { nome: t.organizacao, total: 0, etapa: {}, pessoas: new Set<string>() }
      o.total += t.minutos; o.etapa[t.etapa] = (o.etapa[t.etapa] ?? 0) + t.minutos; o.pessoas.add(t.user_auth_id)
      m.set(t.id_org, o)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [dados.tempo])
  const porPessoa = useMemo(() => {
    const m = new Map<string, { total: number; orgs: Map<string, number> }>()
    for (const t of dados.tempo) {
      const p = m.get(t.user_auth_id) ?? { total: 0, orgs: new Map<string, number>() }
      p.total += t.minutos; p.orgs.set(t.organizacao, (p.orgs.get(t.organizacao) ?? 0) + t.minutos)
      m.set(t.user_auth_id, p)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [dados.tempo])
  const total = porOrg.reduce((s, [, o]) => s + o.total, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <Cronometro minha={minha} orgs={orgs} agora={agora} onFeito={(r, ok) => { if (!r.ok) return setAviso({ tipo: 'erro', texto: r.mensagem ?? 'Não deu' }); setAviso({ tipo: 'ok', texto: ok }); router.refresh() }} />
        <Painel aria-label="Trabalhando agora" rotulo={`Trabalhando agora · ${outros.length}`}>
          {outros.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: theme.text3 }}>Ninguém mais com cronômetro aberto.</div> : outros.map((a) => (
            <div key={a.user_auth_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${theme.borderFaint}`, fontSize: 12.5 }}>
              <span><strong>{quem(a.user_auth_id)}</strong> <span style={{ color: theme.text2 }}>· {a.organizacao} · {ROT_ETAPA[a.etapa]}</span></span>
              <span style={{ color: theme.text3, fontVariantNumeric: 'tabular-nums' }}>há {decorrido(a.inicio, agora)}</span>
            </div>
          ))}
        </Painel>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: theme.text2 }}>
          <strong style={{ fontFamily: theme.display, fontSize: 22, color: theme.text, fontWeight: 500 }}>{horas(total)}</strong> registradas em {mesCurto(mes)}
          {porOrg.length > 0 && <> · {porOrg.length} organizaç{porOrg.length === 1 ? 'ão' : 'ões'} · {porPessoa.length} pessoa{porPessoa.length === 1 ? '' : 's'}</>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm }}>
          <Link href={`?mes=${deslocarMes(mes, -1)}`} aria-label="Mês anterior" style={{ padding: '6px 12px', color: theme.text2, textDecoration: 'none' }}>‹</Link>
          <span style={{ minWidth: 76, textAlign: 'center', fontSize: 12.5, fontWeight: 700 }}>{mesCurto(mes)}</span>
          <Link href={`?mes=${deslocarMes(mes, 1)}`} aria-label="Próximo mês" style={{ padding: '6px 12px', color: theme.text2, textDecoration: 'none' }}>›</Link>
        </div>
      </div>

      <Painel aria-label="Horas por organização" rotulo="Horas por organização">
        {porOrg.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: theme.text3 }}>Nenhum tempo registrado em {mesCurto(mes)}.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="f-tabela">
              <thead><tr><th>Organização</th><th className="f-num">Total</th><th className="f-num">% do mês</th>{etapasUsadas.map((e) => <th key={e} className="f-num">{ROT_ETAPA[e]}</th>)}<th className="f-num">Pessoas</th></tr></thead>
              <tbody>
                {porOrg.map(([id, o]) => (
                  <tr key={id}>
                    <td style={{ fontWeight: 600 }}>{o.nome}</td>
                    <td className="f-num" style={{ fontWeight: 600 }}>{horas(o.total)}</td>
                    <td className="f-num">{total ? `${Math.round((o.total / total) * 100)}%` : '—'}</td>
                    {etapasUsadas.map((e) => <td key={e} className="f-num">{o.etapa[e] ? horas(o.etapa[e]!) : '—'}</td>)}
                    <td className="f-num">{o.pessoas.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>

      {porPessoa.length > 0 && (
        <Painel aria-label="Horas por pessoa" rotulo="Horas por pessoa">
          {porPessoa.map(([id, p]) => (
            <div key={id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 90px minmax(0,2fr)', gap: 12, alignItems: 'baseline', padding: '10px 16px', borderBottom: `1px solid ${theme.borderFaint}`, fontSize: 12.5 }} className="v-stack">
              <strong>{quem(id)}</strong>
              <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{horas(p.total)}</span>
              <span style={{ color: theme.text3 }}>{[...p.orgs.entries()].sort((a, b) => b[1] - a[1]).map(([o, m]) => `${o} ${horas(m)}`).join(' · ')}</span>
            </div>
          ))}
        </Painel>
      )}
      <div style={{ fontSize: 11.5, color: theme.text3 }}>Conta só sessão encerrada. Cronômetro aberto há mais de 12 horas não aparece em &quot;trabalhando agora&quot; (provável esquecido).</div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}

function Cronometro({ minha, orgs, agora, onFeito }: {
  minha?: Aberta; orgs: { id_org: string; nome: string }[]; agora: number; onFeito: (r: { ok: boolean; mensagem?: string }, ok: string) => void
}) {
  const [org, setOrg] = useState(orgs[0]?.id_org ?? '')
  const [etapa, setEtapa] = useState<EtapaTempo>('categorizacao')
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const rodar = async (fn: () => Promise<unknown>, ok: string) => { setOcupado(true); const r = await fn(); setOcupado(false); setNota(''); onFeito(r as { ok: boolean; mensagem?: string }, ok) }
  return (
    <Painel aria-label="Meu cronômetro" rotulo="Meu cronômetro" style={{ borderColor: minha ? theme.accentBorder : undefined }}>
      <div style={{ padding: '14px 16px', display: 'grid', gap: 10 }}>
        {minha ? (
          <>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: theme.positive }}>●</span> Contando <strong>{ROT_ETAPA[minha.etapa]}</strong> em <strong>{minha.organizacao}</strong>
              <span style={{ fontFamily: theme.display, fontSize: 20, marginLeft: 10, fontVariantNumeric: 'tabular-nums' }}>{decorrido(minha.inicio, agora)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional): o que foi feito" aria-label="Nota" style={{ ...estiloCampo, flex: 1 }} />
              <button disabled={ocupado} onClick={() => rodar(() => A.parar(nota), 'Cronômetro parado')} style={botaoPrimario(ocupado)}>Parar</button>
            </div>
            <div style={{ fontSize: 11.5, color: theme.text3 }}>Iniciar outra etapa encerra esta automaticamente.</div>
          </>
        ) : <div style={{ fontSize: 13, color: theme.text2 }}>Parado. Escolha a organização e a etapa:</div>}
        {orgs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Organização" style={{ ...estiloCampo, flex: '1 1 160px', width: 'auto' }}>
              {orgs.map((o) => <option key={o.id_org} value={o.id_org}>{o.nome}</option>)}
            </select>
            <select value={etapa} onChange={(e) => setEtapa(e.target.value as EtapaTempo)} aria-label="Etapa" style={{ ...estiloCampo, flex: '1 1 160px', width: 'auto' }}>
              {ETAPAS_TEMPO.map((e) => <option key={e} value={e}>{ROT_ETAPA[e]}</option>)}
            </select>
            <button disabled={ocupado || !org} onClick={() => rodar(() => A.iniciar(org, etapa), 'Cronômetro iniciado')} style={minha ? botaoSecundario() : botaoPrimario(ocupado || !org)}>{minha ? 'Trocar' : 'Iniciar'}</button>
          </div>
        )}
      </div>
    </Painel>
  )
}
