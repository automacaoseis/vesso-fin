'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { PAPEIS, type Papel } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloCampo, estiloFiltro } from '@/components/vesso'
import { Aviso, botaoSecundarioCompacto, CampoRotulado, campoCompacto, Painel } from '@/components/fin-ui'
import * as A from './acoes'

interface Acesso {
  id_acesso: string; user_auth_id: string; email: string; id_org: string | null; organizacao: string | null; papel: Papel
  motivo: string | null; concedido_por_email: string | null; created_at: string; expira_em: string | null; ativo: boolean
  revogado_em: string | null; revogado_por_email: string | null; motivo_revogacao: string | null; pode_administrar: boolean
}
export interface DadosAcessos { eh_dono: boolean; acessos: Acesso[]; orgs: { id_org: string; nome: string; tipo: string }[] }

const ROT_PAPEL: Record<Papel, string> = { leitura: 'Leitura', analista: 'Analista', revisor: 'Revisor', head: 'Head' }
const DESC_PAPEL: Record<Papel, string> = {
  leitura: 'vê, não altera', analista: 'executa a rotina', revisor: 'analista + revisa fechamento de outra pessoa',
  head: 'revisor + libera ao cliente, reabre, configura',
}
const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
const TODAS = '__todas__'

export default function AcessosClient({ dados }: { dados: DadosAcessos }) {
  const router = useRouter()
  const { eh_dono, acessos, orgs } = dados
  const podeConceder = eh_dono || orgs.length > 0
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 9000 : 3000); return () => clearTimeout(t) }, [aviso])
  const [historico, setHistorico] = useState(false)
  const [revogando, setRevogando] = useState<string | null>(null)
  const [trocando, setTrocando] = useState<string | null>(null)

  const resultado = (r: { ok: boolean; mensagem?: string }, ok: string) => {
    if (!r.ok) { setAviso({ tipo: 'erro', texto: r.mensagem ?? 'Não deu' }); return false }
    setAviso({ tipo: 'ok', texto: ok }); router.refresh(); return true
  }

  // ativos agrupados por pessoa
  const ativos = acessos.filter((a) => a.ativo)
  const pessoas = useMemo(() => {
    const m = new Map<string, Acesso[]>()
    for (const a of ativos) m.set(a.email, [...(m.get(a.email) ?? []), a])
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]))
  }, [ativos])
  const inativos = acessos.filter((a) => !a.ativo)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {podeConceder ? <FormConceder eh_dono={eh_dono} orgs={orgs} onFeito={resultado} />
        : <div style={{ fontSize: 13, color: theme.text2, padding: '12px 16px', background: theme.surface2, borderRadius: theme.radiusSm }}>Você só vê o próprio acesso. Conceder é com o head do produto ou o dono.</div>}

      <Painel aria-label="Acessos ativos" rotulo={`${pessoas.length} pessoa${pessoas.length === 1 ? '' : 's'} com acesso`}>
        {pessoas.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: theme.text3 }}>Ninguém com acesso ativo que você administre.</div> : pessoas.map(([email, lista]) => (
          <div key={email} style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.borderFaint}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{email}</div>
            {lista.map((a) => (
              <div key={a.id_acesso} style={{ display: 'grid', gridTemplateColumns: '220px 300px minmax(0,1fr) 210px', gap: 12, alignItems: 'center', padding: '8px 0 0' }} className="v-stack">
                <span style={{ fontSize: 12.5 }}>{a.id_org ? a.organizacao : <em style={{ color: theme.accent, fontStyle: 'normal', fontWeight: 600 }}>Todas as organizações cliente</em>}</span>
                <span style={{ fontSize: 12.5 }}><strong>{ROT_PAPEL[a.papel]}</strong> <span style={{ color: theme.text3 }}>· {DESC_PAPEL[a.papel]}</span></span>
                <span style={{ fontSize: 11.5, color: theme.text3 }}>
                  {a.concedido_por_email ? `por ${a.concedido_por_email} · ` : ''}{data(a.created_at)}{a.motivo ? ` — ${a.motivo}` : ''}
                  {a.expira_em && <span style={{ color: theme.warning }}> · vale até {data(a.expira_em)}</span>}
                </span>
                <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {a.pode_administrar && <>
                    <button onClick={() => { setTrocando(trocando === a.id_acesso ? null : a.id_acesso); setRevogando(null) }} style={botaoSecundarioCompacto()}>Trocar papel</button>
                    <button onClick={() => { setRevogando(revogando === a.id_acesso ? null : a.id_acesso); setTrocando(null) }} style={{ ...botaoSecundarioCompacto(), color: theme.negative }}>Revogar</button>
                  </>}
                </span>
                {trocando === a.id_acesso && <TrocarPapel acesso={a} eh_dono={eh_dono} onFeito={(r) => { if (resultado(r, 'Papel trocado')) setTrocando(null) }} />}
                {revogando === a.id_acesso && <Revogar acesso={a} onFeito={(r) => { if (resultado(r, 'Acesso revogado')) setRevogando(null) }} />}
              </div>
            ))}
          </div>
        ))}
      </Painel>

      {inativos.length > 0 && (
        <div>
          <button onClick={() => setHistorico(!historico)} style={estiloFiltro(historico)}>{historico ? '▾' : '▸'} Histórico · {inativos.length} revogado{inativos.length === 1 ? '' : 's'} ou substituído{inativos.length === 1 ? '' : 's'}</button>
          {historico && (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table className="f-tabela">
                <thead><tr><th>Pessoa</th><th>Organização</th><th>Papel</th><th>Concedido</th><th>Revogado</th><th>Motivo</th></tr></thead>
                <tbody>
                  {inativos.map((a) => (
                    <tr key={a.id_acesso} style={{ color: theme.text3 }}>
                      <td>{a.email}</td><td>{a.organizacao ?? 'Todas'}</td><td>{ROT_PAPEL[a.papel]}</td>
                      <td>{data(a.created_at)}</td><td>{a.revogado_em ? `${data(a.revogado_em)}${a.revogado_por_email ? ` · ${a.revogado_por_email}` : ''}` : '—'}</td>
                      <td style={{ whiteSpace: 'normal' }}>{a.motivo_revogacao ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}

function papeisPermitidos(eh_dono: boolean, idOrg: string | null) {
  return PAPEIS.filter((p) => eh_dono || (idOrg !== null && p !== 'head'))
}

function FormConceder({ eh_dono, orgs, onFeito }: { eh_dono: boolean; orgs: DadosAcessos['orgs']; onFeito: (r: { ok: boolean; mensagem?: string }, ok: string) => boolean }) {
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState(orgs[0]?.id_org ?? (eh_dono ? TODAS : ''))
  const [papel, setPapel] = useState<Papel>('analista')
  const [motivo, setMotivo] = useState('')
  const [validade, setValidade] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const idOrg = org === TODAS ? null : org
  const ok = /^[^\s@]+@[^\s@]+$/.test(email.trim()) && org && motivo.trim().length >= 5 && papeisPermitidos(eh_dono, idOrg).includes(papel)
  return (
    <Painel aria-label="Conceder acesso" rotulo="Conceder acesso">
      <form style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}
        onSubmit={async (e) => {
          e.preventDefault(); if (!ok) return
          setOcupado(true)
          const r = await A.conceder({ email, id_org: idOrg, papel, motivo, ...(validade ? { expira_em: validade } : {}) })
          setOcupado(false)
          if (onFeito(r as { ok: boolean; mensagem?: string }, `Acesso concedido a ${email.trim()}`)) { setEmail(''); setMotivo(''); setValidade('') }
        }}>
        <CampoRotulado rotulo="E-mail do login Vesso"><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="pessoa@seis.com.br" style={estiloCampo} /></CampoRotulado>
        <CampoRotulado rotulo="Organização">
          <select value={org} onChange={(e) => { setOrg(e.target.value); if (e.target.value === TODAS && !eh_dono) setPapel('analista') }} style={estiloCampo}>
            {eh_dono && <option value={TODAS}>Todas as organizações cliente</option>}
            {orgs.map((o) => <option key={o.id_org} value={o.id_org}>{o.nome}{o.tipo === 'casa' ? ' (casa)' : ''}</option>)}
          </select>
        </CampoRotulado>
        <CampoRotulado rotulo="Papel">
          <select value={papel} onChange={(e) => setPapel(e.target.value as Papel)} style={estiloCampo}>
            {papeisPermitidos(eh_dono, idOrg).map((p) => <option key={p} value={p}>{ROT_PAPEL[p]} — {DESC_PAPEL[p]}</option>)}
          </select>
        </CampoRotulado>
        <CampoRotulado rotulo="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: assume a carteira da turma B" style={estiloCampo} /></CampoRotulado>
        <CampoRotulado rotulo="Vale até" extra={<span style={{ color: theme.text3 }}>opcional</span>}><input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} style={estiloCampo} /></CampoRotulado>
        <button type="submit" disabled={!ok || ocupado} style={botaoPrimario(!ok || ocupado)}>Conceder</button>
        <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: theme.text3 }}>
          A pessoa precisa já ter login no Vesso. Se ela já tem acesso nesta organização, o papel é trocado e o anterior vai para o histórico.
        </div>
      </form>
    </Painel>
  )
}

function TrocarPapel({ acesso, eh_dono, onFeito }: { acesso: Acesso; eh_dono: boolean; onFeito: (r: { ok: boolean; mensagem?: string }) => void }) {
  const opcoes = papeisPermitidos(eh_dono, acesso.id_org).filter((p) => p !== acesso.papel)
  const [papel, setPapel] = useState<Papel>(opcoes[0] ?? acesso.papel)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  return (
    <form style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0 4px' }}
      onSubmit={async (e) => {
        e.preventDefault(); setOcupado(true)
        const r = await A.conceder({ email: acesso.email, id_org: acesso.id_org, papel, motivo })
        setOcupado(false); onFeito(r as { ok: boolean; mensagem?: string })
      }}>
      <select value={papel} onChange={(e) => setPapel(e.target.value as Papel)} aria-label="Novo papel" style={{ ...campoCompacto, padding: '7px 10px' }}>
        {opcoes.map((p) => <option key={p} value={p}>{ROT_PAPEL[p]}</option>)}
      </select>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo da troca" aria-label="Motivo da troca" style={{ ...campoCompacto, padding: '7px 10px', flex: '1 1 220px' }} />
      <button type="submit" disabled={ocupado || motivo.trim().length < 5} style={botaoPrimario(ocupado || motivo.trim().length < 5)}>Trocar</button>
    </form>
  )
}

function Revogar({ acesso, onFeito }: { acesso: Acesso; onFeito: (r: { ok: boolean; mensagem?: string }) => void }) {
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  return (
    <form style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0 4px' }}
      onSubmit={async (e) => {
        e.preventDefault(); setOcupado(true)
        const r = await A.revogar(acesso.id_acesso, motivo)
        setOcupado(false); onFeito(r as { ok: boolean; mensagem?: string })
      }}>
      <span style={{ fontSize: 12.5, color: theme.text2 }}>Revogar {ROT_PAPEL[acesso.papel].toLowerCase()} de {acesso.email} em {acesso.organizacao ?? 'todas as organizações'}?</span>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" aria-label="Motivo da revogação" style={{ ...campoCompacto, padding: '7px 10px', flex: '1 1 200px' }} />
      <button type="submit" disabled={ocupado || motivo.trim().length < 5} style={{ ...botaoSecundario(), color: theme.negative, opacity: motivo.trim().length < 5 ? 0.45 : 1 }}>Revogar</button>
    </form>
  )
}
