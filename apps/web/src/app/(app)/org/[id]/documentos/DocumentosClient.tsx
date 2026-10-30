'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TIPOS_DOCUMENTO } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloCampo, estiloFiltro } from '@/components/vesso'
import { Aviso, botaoPrimarioCompacto, botaoSecundarioCompacto, CampoRotulado, campoCompacto, Painel } from '@/components/fin-ui'
import { mesAtualSP, mesCurto } from '@/lib/datas'
import * as A from './acoes'

export interface Documento {
  id_documento: string; id_org: string; id_titulo: string | null; titulo: string | null; tipo: Tipo; competencia: string | null
  descricao: string; status: 'pedido' | 'recebido' | 'validado' | 'recusado'; arquivo_nome: string | null; arquivo_bytes: number | null
  arquivo_mime: string | null; tem_arquivo: boolean; motivo_recusa: string | null; pedido_em: string | null; recebido_em: string | null; created_at: string
  organizacao?: string
}
type Tipo = (typeof TIPOS_DOCUMENTO)[number]
type Res = { ok: boolean; mensagem?: string }
export const ROT_TIPO: Record<Tipo, string> = {
  nf: 'Nota fiscal', boleto: 'Boleto', comprovante: 'Comprovante', contrato: 'Contrato', extrato: 'Extrato', guia_imposto: 'Guia de imposto', outro: 'Outro',
}
export const STATUS_DOC = {
  pedido: { icone: '○', rotulo: 'Pedido', cor: theme.warning },
  recebido: { icone: '◐', rotulo: 'Recebido · validar', cor: theme.accent },
  validado: { icone: '✓', rotulo: 'Validado', cor: theme.positive },
  recusado: { icone: '▲', rotulo: 'Recusado', cor: theme.negative },
} as const
const ACEITA = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.xml,.csv,.xls,.xlsx,.ofx,.txt'
const tamanho = (b: number | null) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`)
export const diasDesde = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : null)

/** Abre o arquivo por link assinado. A janela abre ANTES do await para o navegador não bloquear como pop-up. */
export async function abrirArquivo(id: string, onErro: (t: string) => void) {
  const w = window.open('about:blank', '_blank')
  const r = await A.linkArquivo(id)
  if (r.ok) { if (w) w.location.href = r.dados.url; else window.location.href = r.dados.url }
  else { w?.close(); onErro(r.mensagem) }
}

export default function DocumentosClient({ org, docs, statusInicial, competenciaInicial }: {
  org: { id: string; nome: string; acoes: string[] }; docs: Documento[]; statusInicial?: string; competenciaInicial?: string
}) {
  const router = useRouter()
  const pode = (a: string) => org.acoes.includes(a)
  const [status, setStatus] = useState<string | undefined>(statusInicial)
  const [comp, setComp] = useState<string | undefined>(competenciaInicial)
  const [form, setForm] = useState<'pedir' | 'enviar' | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 9000 : 3000); return () => clearTimeout(t) }, [aviso])
  const feito = (r: Res, ok: string) => { if (!r.ok) { setAviso({ tipo: 'erro', texto: r.mensagem ?? 'Não deu' }); return false } setAviso({ tipo: 'ok', texto: ok }); router.refresh(); return true }
  const erro = (t: string) => setAviso({ tipo: 'erro', texto: t })

  const meses = useMemo(() => [...new Set(docs.map((d) => d.competencia?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse(), [docs])
  const daComp = comp ? docs.filter((d) => d.competencia?.startsWith(comp)) : docs
  const vis = status ? daComp.filter((d) => d.status === status) : daComp
  const conta = (s: string) => daComp.filter((d) => d.status === s).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 14, borderBottom: `1px solid ${theme.borderStrong}` }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent }}>Documentos · {org.nome}</div>
          <h1 className="v-manchete" style={{ fontFamily: theme.display, fontSize: 32, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '6px 0 0' }}>Pendências e documentos</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {pode('lancar') && <button onClick={() => setForm(form === 'pedir' ? null : 'pedir')} style={form === 'pedir' ? botaoPrimarioCompacto() : botaoSecundarioCompacto()}>Pedir documento</button>}
          {pode('importar') && <button onClick={() => setForm(form === 'enviar' ? null : 'enviar')} style={form === 'enviar' ? botaoPrimarioCompacto() : botaoSecundarioCompacto()}>Enviar arquivo</button>}
        </div>
      </div>

      {form === 'pedir' && <FormPedir idOrg={org.id} onFeito={(r) => { if (feito(r, 'Documento pedido')) setForm(null) }} />}
      {form === 'enviar' && <FormEnviar idOrg={org.id} onFeito={(r) => { if (feito(r, 'Arquivo enviado')) setForm(null) }} />}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setStatus(undefined)} style={estiloFiltro(!status)}>Todos · {daComp.length}</button>
        <button onClick={() => setStatus('pedido')} style={estiloFiltro(status === 'pedido', theme.warning)}>○ Pedidos · {conta('pedido')}</button>
        <button onClick={() => setStatus('recebido')} style={estiloFiltro(status === 'recebido')}>◐ A validar · {conta('recebido')}</button>
        <button onClick={() => setStatus('validado')} style={estiloFiltro(status === 'validado', theme.positive)}>✓ Validados · {conta('validado')}</button>
        <select value={comp ?? ''} onChange={(e) => setComp(e.target.value || undefined)} aria-label="Competência" style={{ ...campoCompacto, marginLeft: 'auto' }}>
          <option value="">Todas as competências</option>
          {[...new Set([...meses, ...(comp ? [comp] : [])])].map((m) => <option key={m} value={m}>{mesCurto(`${m}-01`)}</option>)}
        </select>
      </div>

      <Painel aria-label="Documentos" rotulo={`${vis.length} documento${vis.length === 1 ? '' : 's'}`}>
        {vis.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: theme.text3 }}>{docs.length === 0 ? 'Nenhum documento ainda. Peça ao cliente o que faltar para fechar o mês, ou envie um arquivo.' : 'Nada neste filtro.'}</div>
          : vis.map((d) => <LinhaDoc key={d.id_documento} d={d} idOrg={org.id} pode={pode} onFeito={feito} onErro={erro} />)}
      </Painel>
      <div style={{ fontSize: 11.5, color: theme.text3 }}>Pedido sem arquivo da competência bloqueia o checklist do fechamento. Recusar devolve o documento para &quot;pedido&quot;, com o motivo. Arquivos até 5 MB: PDF, imagem, XML, planilha ou OFX.</div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}

function LinhaDoc({ d, idOrg, pode, onFeito, onErro }: { d: Documento; idOrg: string; pode: (a: string) => boolean; onFeito: (r: Res, ok: string) => boolean; onErro: (t: string) => void }) {
  const [acao, setAcao] = useState<'recusar' | 'dispensar' | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const arquivo = useRef<HTMLInputElement>(null)
  const st = STATUS_DOC[d.status]
  const rodar = async (fn: () => Promise<unknown>, ok: string) => { setOcupado(true); const r = await fn(); setOcupado(false); if (onFeito(r as Res, ok)) { setAcao(null); setMotivo('') } }
  const dias = diasDesde(d.pedido_em)
  return (
    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.borderFaint}`, display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) auto', gap: 14, alignItems: 'start' }} className="v-stack">
      <div style={{ fontSize: 12.5 }}><span style={{ color: st.cor }}>{st.icone}</span> {st.rotulo}
        {d.status === 'pedido' && dias != null && <div style={{ fontSize: 11, color: dias > 7 ? theme.negative : theme.text3, marginTop: 2 }}>há {dias} dia{dias === 1 ? '' : 's'}</div>}
      </div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.descricao}</div>
        <div style={{ fontSize: 11.5, color: theme.text3, marginTop: 2 }}>
          {ROT_TIPO[d.tipo]}{d.competencia && ` · ${mesCurto(d.competencia)}`}{d.titulo && ` · título: ${d.titulo}`}
          {d.tem_arquivo && <> · <button onClick={() => abrirArquivo(d.id_documento, onErro)} style={{ background: 'none', border: 0, padding: 0, color: theme.accent, cursor: 'pointer', fontSize: 11.5 }}>{d.arquivo_nome ?? 'arquivo'}</button> {tamanho(d.arquivo_bytes)}</>}
        </div>
        {d.status === 'pedido' && d.motivo_recusa && <div style={{ fontSize: 11.5, color: theme.negative, marginTop: 4 }}>▲ arquivo anterior recusado: {d.motivo_recusa}</div>}
        {acao && (
          <form style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }} onSubmit={(e) => {
            e.preventDefault()
            if (acao === 'recusar') rodar(() => A.validar(d.id_documento, false, motivo), 'Recusado: voltou para pedido')
            else rodar(() => A.dispensar(d.id_documento, motivo), 'Pedido dispensado')
          }}>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder={acao === 'recusar' ? 'Por que recusou? (vai para o cliente)' : 'Por que dispensar?'} aria-label="Motivo" style={{ ...campoCompacto, padding: '7px 10px', flex: '1 1 240px' }} />
            <button type="submit" disabled={ocupado || motivo.trim().length < 5} style={botaoPrimario(ocupado || motivo.trim().length < 5)}>{acao === 'recusar' ? 'Recusar' : 'Dispensar'}</button>
            <button type="button" onClick={() => setAcao(null)} style={botaoSecundario()}>Cancelar</button>
          </form>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {d.status === 'pedido' && pode('importar') && <>
          <input ref={arquivo} type="file" accept={ACEITA} hidden onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            const fd = new FormData(); fd.set('arquivo', f); fd.set('id_documento', d.id_documento)
            rodar(() => A.enviar(idOrg, fd), 'Arquivo recebido')
          }} />
          <button disabled={ocupado} onClick={() => arquivo.current?.click()} style={botaoPrimarioCompacto(ocupado)}>{ocupado ? 'Enviando…' : 'Anexar arquivo'}</button>
        </>}
        {d.status === 'pedido' && pode('lancar') && <button onClick={() => setAcao(acao === 'dispensar' ? null : 'dispensar')} style={botaoSecundarioCompacto()}>Dispensar</button>}
        {d.status === 'recebido' && pode('lancar') && <>
          <button disabled={ocupado} onClick={() => rodar(() => A.validar(d.id_documento, true), 'Documento validado')} style={botaoPrimarioCompacto(ocupado)}>Validar</button>
          <button onClick={() => setAcao(acao === 'recusar' ? null : 'recusar')} style={{ ...botaoSecundarioCompacto(), color: theme.negative }}>Recusar</button>
        </>}
      </div>
    </div>
  )
}

function FormPedir({ idOrg, onFeito }: { idOrg: string; onFeito: (r: Res) => void }) {
  const [tipo, setTipo] = useState<Tipo>('nf')
  const [descricao, setDescricao] = useState('')
  const [comp, setComp] = useState(mesAtualSP())
  const [ocupado, setOcupado] = useState(false)
  return (
    <Painel aria-label="Pedir documento" rotulo="Pedir documento ao cliente">
      <form style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '180px minmax(0,1fr) 160px auto', gap: 12, alignItems: 'end' }} className="v-stack"
        onSubmit={async (e) => {
          e.preventDefault(); setOcupado(true)
          const r = await A.pedir(idOrg, { tipo, descricao, ...(comp ? { competencia: `${comp}-01` } : {}) })
          setOcupado(false); onFeito(r as Res)
        }}>
        <CampoRotulado rotulo="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} style={estiloCampo}>{TIPOS_DOCUMENTO.map((t) => <option key={t} value={t}>{ROT_TIPO[t]}</option>)}</select></CampoRotulado>
        <CampoRotulado rotulo="O que falta"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: NF da compra de material, 12/09, R$ 840" style={estiloCampo} /></CampoRotulado>
        <CampoRotulado rotulo="Competência"><input type="month" value={comp} onChange={(e) => setComp(e.target.value)} style={estiloCampo} /></CampoRotulado>
        <button type="submit" disabled={ocupado || descricao.trim().length < 3} style={botaoPrimario(ocupado || descricao.trim().length < 3)}>Pedir</button>
      </form>
    </Painel>
  )
}

function FormEnviar({ idOrg, onFeito }: { idOrg: string; onFeito: (r: Res) => void }) {
  const [tipo, setTipo] = useState<Tipo>('comprovante')
  const [descricao, setDescricao] = useState('')
  const [comp, setComp] = useState(mesAtualSP())
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const ok = arquivo && descricao.trim().length >= 3
  return (
    <Painel aria-label="Enviar arquivo" rotulo="Enviar arquivo (sem pedido antes)">
      <form style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '170px minmax(0,1fr) 150px minmax(0,1fr) auto', gap: 12, alignItems: 'end' }} className="v-stack"
        onSubmit={async (e) => {
          e.preventDefault(); if (!ok) return
          const fd = new FormData(); fd.set('arquivo', arquivo); fd.set('tipo', tipo); fd.set('descricao', descricao); if (comp) fd.set('competencia', `${comp}-01`)
          setOcupado(true); const r = await A.enviar(idOrg, fd); setOcupado(false); onFeito(r as Res)
        }}>
        <CampoRotulado rotulo="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} style={estiloCampo}>{TIPOS_DOCUMENTO.map((t) => <option key={t} value={t}>{ROT_TIPO[t]}</option>)}</select></CampoRotulado>
        <CampoRotulado rotulo="Descrição"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: comprovante do aluguel" style={estiloCampo} /></CampoRotulado>
        <CampoRotulado rotulo="Competência"><input type="month" value={comp} onChange={(e) => setComp(e.target.value)} style={estiloCampo} /></CampoRotulado>
        <CampoRotulado rotulo="Arquivo (até 5 MB)"><input type="file" accept={ACEITA} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} style={{ ...estiloCampo, padding: '6px 8px' }} /></CampoRotulado>
        <button type="submit" disabled={!ok || ocupado} style={botaoPrimario(!ok || ocupado)}>{ocupado ? 'Enviando…' : 'Enviar'}</button>
      </form>
    </Painel>
  )
}
