'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtBRL } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'
import { enviarOfx, extratosDa, type Extrato } from './acoes'

export interface Conexao {
  id_org: string; organizacao: string; id_conexao: string; conta: string; instituicao: string | null
  metodo: string; status: 'ativa' | 'pausada' | 'erro'; ultima_importacao_em: string | null; ultimo_movimento_em: string | null
  erro_msg: string | null; atrasada: boolean; pode_importar: boolean
}

const quando = (iso: string | null) => {
  if (!iso) return 'nunca'
  const d = new Date(iso), min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`
  return d.toLocaleDateString('pt-BR')
}
const br = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')

const ESTADO_EXTRATO: Record<Extrato['status'], string> = { recebido: '○ Na fila', processado: '✓ Processado', erro: '▲ Erro', duplicado: '— Duplicado' }

export default function ConexoesClient({ conexoes }: { conexoes: Conexao[] }) {
  const orgs = [...new Set(conexoes.map((c) => c.organizacao))]
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {orgs.map((o) => (
        <section key={o} aria-label={o} style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ fontFamily: theme.display, fontSize: 19, fontWeight: 500, margin: 0 }}>{o}</h2>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, background: theme.surface }}>
            {conexoes.filter((c) => c.organizacao === o).map((c) => <Linha key={c.id_conexao} c={c} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function Linha({ c }: { c: Conexao }) {
  const router = useRouter()
  const [aberta, setAberta] = useState(false)
  const [extratos, setExtratos] = useState<Extrato[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    const r = await extratosDa(c.id_conexao)
    if (r.ok) setExtratos(r.dados)
    return r.ok ? r.dados : []
  }, [c.id_conexao])

  // acompanha o arquivo que ESTA pessoa enviou até o worker terminar (ele leva segundos)
  const [acompanhando, setAcompanhando] = useState<string | null>(null)
  useEffect(() => {
    if (!acompanhando) return
    let n = 0
    const t = setInterval(async () => {
      const e = (await carregar()).find((x) => x.id_extrato === acompanhando)
      if (e && e.status !== 'recebido') {
        clearInterval(t); setAcompanhando(null); router.refresh()
        setAviso(e.status === 'processado'
          ? { erro: false, texto: `✓ Processado: ${e.linhas_novas ?? 0} novo(s) de ${e.linhas_lidas ?? 0}${e.linhas_removidas ? ` · ${e.linhas_removidas} sumiram da fonte` : ''}.` }
          : { erro: true, texto: e.erro_msg ?? 'falhou ao processar' })
      } else if (++n > 40) {
        clearInterval(t); setAcompanhando(null)
        setAviso({ erro: true, texto: 'Ainda na fila depois de 2 minutos. O processamento pode estar parado — avise o time.' })
      }
    }, 1500)
    return () => clearInterval(t)
  }, [acompanhando, carregar, router])

  async function abrir() {
    const nova = !aberta
    setAberta(nova)
    if (nova && !extratos) await carregar()
  }

  async function enviar(e: React.ChangeEvent<HTMLInputElement>) {
    const arq = e.target.files?.[0]
    e.target.value = ''
    if (!arq) return
    setEnviando(true); setAviso(null)
    const fd = new FormData(); fd.set('arquivo', arq)
    const r = await enviarOfx(c.id_conexao, fd)
    setEnviando(false)
    if (!r.ok) return setAviso({ erro: true, texto: r.mensagem })
    setAviso({ erro: false, texto: r.dados.duplicado ? 'Esse arquivo já tinha sido importado nesta conta — nada muda.' : 'Recebido. Processando…' })
    setAberta(true)
    await carregar()
    if (!r.dados.duplicado) setAcompanhando(r.dados.id_extrato)
  }

  const st = c.status === 'erro' ? { t: '▲ Erro', cor: f.negativeText } : c.status === 'pausada' ? { t: '— Pausada', cor: f.mutedText }
    : c.atrasada ? { t: '▲ Atrasada', cor: f.warningText } : { t: '✓ Em dia', cor: f.positiveText }

  return (
    <div style={{ borderBottom: `1px solid ${theme.borderFaint}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 90px 110px minmax(0,1.3fr) auto', gap: 12, alignItems: 'center', padding: '8px 12px', fontSize: 13 }} className="v-stack">
        <button onClick={abrir} aria-expanded={aberta} style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: theme.text, fontSize: 13 }}>
          <span aria-hidden style={{ color: f.mutedText, display: 'inline-block', width: 14 }}>{aberta ? '▾' : '▸'}</span>
          <strong style={{ fontWeight: 600 }}>{c.conta}</strong> <span style={{ color: f.mutedText }}>· {c.instituicao ?? '—'}</span>
        </button>
        <span style={{ color: f.mutedText, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em' }}>{c.metodo.replace('_', ' ')}</span>
        <span style={{ color: st.cor, fontWeight: 500 }}>{st.t}</span>
        <span style={{ color: theme.text2 }}>
          importado {quando(c.ultima_importacao_em)} · último movimento {br(c.ultimo_movimento_em)}
          {c.status === 'erro' && c.erro_msg && <span style={{ display: 'block', color: f.negativeText }}>{c.erro_msg}</span>}
        </span>
        {c.metodo === 'ofx' && c.pode_importar ? (
          <>
            <input ref={input} type="file" accept=".ofx,application/x-ofx" onChange={enviar} hidden aria-label={`Importar OFX em ${c.conta}`} />
            <button onClick={() => input.current?.click()} disabled={enviando}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: theme.radiusSm, border: 'none', background: theme.text, color: theme.bg, fontWeight: 600, cursor: enviando ? 'wait' : 'pointer' }}>
              {enviando ? 'Enviando…' : 'Importar OFX'}
            </button>
          </>
        ) : <span />}
      </div>
      {aviso && <div role={aviso.erro ? 'alert' : 'status'} style={{ padding: '0 12px 8px 38px', fontSize: 12, color: aviso.erro ? f.negativeText : theme.text2 }}>{aviso.erro ? '▲ ' : ''}{aviso.texto}</div>}
      {aberta && (
        <div style={{ padding: '0 12px 10px 38px' }}>
          {!extratos ? <div style={{ fontSize: 12, color: f.mutedText }}>Carregando…</div>
            : extratos.length === 0 ? <div style={{ fontSize: 12, color: f.mutedText }}>Nenhum arquivo recebido ainda.</div>
            : (
              <table className="f-tabela">
                <thead><tr><th>Arquivo</th><th>Estado</th><th>Recebido</th><th>Período</th><th className="f-num">Lidas</th><th className="f-num">Novas</th><th className="f-num">Sumiram</th><th className="f-num">Saldo R$</th></tr></thead>
                <tbody>
                  {extratos.map((e) => (
                    <tr key={e.id_extrato} className={e.status === 'erro' ? 'f-st-divergente' : e.status === 'recebido' ? 'f-st-pendente' : undefined}>
                      <td title={e.erro_msg ?? undefined} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.arquivo_nome ?? '—'}</td>
                      <td>{ESTADO_EXTRATO[e.status]}{e.status === 'erro' && e.erro_msg && <span className="f-delta"> · {e.erro_msg}</span>}</td>
                      <td>{quando(e.recebido_em)}</td>
                      <td>{e.periodo_inicio ? `${br(e.periodo_inicio)} – ${br(e.periodo_fim)}` : '—'}</td>
                      <td className="f-num">{e.linhas_lidas ?? '—'}</td>
                      <td className="f-num">{e.linhas_novas ?? '—'}</td>
                      <td className="f-num">{e.linhas_removidas ?? '—'}</td>
                      <td className="f-num">{e.saldo_final_informado == null ? '—' : fmtBRL(e.saldo_final_informado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  )
}
