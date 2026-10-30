'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { fmtBRL } from '@vesso-fin/shared'
import { EmptyState } from '@/components/ui'
import { botaoSecundario, estiloFiltro } from '@/components/vesso'
import { Painel } from '@/components/fin-ui'
import { theme } from '@/lib/theme'

export interface ItemFila {
  id_org: string; organizacao: string; tipo_item: string; id_ref: string; descricao: string
  valor: number | string | null; desde: string; peso: number; id_conta: string | null
}

const LIMITE = 500
const POR_VEZ = 50
type Grupo = 'conciliar' | 'pagar' | 'receber' | 'categorizar' | 'conexoes'
const GRUPOS: { g: Grupo; rotulo: string }[] = [
  { g: 'conciliar', rotulo: 'Conciliar' }, { g: 'pagar', rotulo: 'A pagar' }, { g: 'receber', rotulo: 'A receber' },
  { g: 'categorizar', rotulo: 'Categorizar' }, { g: 'conexoes', rotulo: 'Conexões' },
]
const grupoDe = (t: string): Grupo =>
  t.startsWith('movimento_') ? 'conciliar' : t.startsWith('pagar_') ? 'pagar' : t.startsWith('receber_') ? 'receber' : t === 'titulo_sem_categoria' ? 'categorizar' : 'conexoes'
const ROTULO: Record<string, string> = {
  movimento_pendente: 'Movimento sem conciliação', movimento_divergente: 'Conciliação divergente',
  pagar_vencido: 'Conta a pagar vencida', pagar_hoje: 'Conta a pagar vence hoje', pagar_7_dias: 'Conta a pagar em até 7 dias',
  receber_vencido: 'Recebimento atrasado', titulo_sem_categoria: 'Lançamento sem categoria', conexao_atrasada: 'Extrato atrasado ou com erro',
}
// Peso da v_fila: 80+ é urgente (divergência, vencido, conexão parada), 60–79 alto, abaixo disso normal.
const prioridade = (p: number) => (p >= 80 ? { icone: '▲', rotulo: 'Urgente', cor: theme.negative } : p >= 60 ? { icone: '◆', rotulo: 'Alta', cor: theme.warning } : { icone: '○', rotulo: 'Normal', cor: theme.text3 })

function destino(i: ItemFila): string {
  const o = `/org/${i.id_org}`
  switch (grupoDe(i.tipo_item)) {
    case 'conciliar': return `${o}/conciliacao?${new URLSearchParams({ ...(i.id_conta ? { conta: i.id_conta } : {}), mes: i.desde.slice(0, 7), mov: i.id_ref })}`
    case 'pagar': return `${o}/lancamentos?periodo=todos&tipo=pagar&situacao=${i.tipo_item === 'pagar_vencido' ? 'vencido' : 'aberto'}&titulo=${i.id_ref}`
    case 'receber': return `${o}/lancamentos?periodo=todos&tipo=receber&situacao=vencido&titulo=${i.id_ref}`
    case 'categorizar': return `${o}/lancamentos?periodo=todos&situacao=sem_categoria&titulo=${i.id_ref}`
    default: return '/conexoes'
  }
}

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
function desde(d: string) {
  const dias = Math.round((Date.parse(hojeSP()) - Date.parse(d)) / 864e5)
  const br = `${d.slice(8, 10)}/${d.slice(5, 7)}`
  return dias === 0 ? `${br} · hoje` : dias > 0 ? `${br} · há ${dias} d` : `${br} · em ${-dias} d`
}

export default function FilaClient({ itens, org, grupo }: { itens: ItemFila[]; org?: string; grupo?: string }) {
  const router = useRouter()
  const path = usePathname()
  const [mostrar, setMostrar] = useState(POR_VEZ)  // o componente remonta ao trocar filtro (key na página), volta a 50
  const ir = (o?: string, g?: string) => {
    const q = new URLSearchParams({ ...(o ? { org: o } : {}), ...(g ? { grupo: g } : {}) }).toString()
    router.replace(q ? `${path}?${q}` : path, { scroll: false })
  }

  if (itens.length === 0) return <EmptyState>Fila vazia: nada pendente nas organizações que você vê.</EmptyState>

  const orgs = [...new Map(itens.map((i) => [i.id_org, i.organizacao])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const daOrg = org ? itens.filter((i) => i.id_org === org) : itens
  const visiveis = grupo ? daOrg.filter((i) => grupoDe(i.tipo_item) === grupo) : daOrg
  const conta = (lista: ItemFila[], g: Grupo) => lista.filter((i) => grupoDe(i.tipo_item) === g).length
  const urgentes = visiveis.filter((i) => i.peso >= 80).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* por organização: onde está o trabalho */}
      <div className="v-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {orgs.map(([id, nome]) => {
          const da = itens.filter((i) => i.id_org === id)
          const urg = da.filter((i) => i.peso >= 80).length
          const ativo = org === id
          return (
            <button key={id} onClick={() => ir(ativo ? undefined : id, grupo)} aria-pressed={ativo} style={{
              textAlign: 'left', padding: '12px 14px', borderRadius: theme.radiusSm, cursor: 'pointer', fontFamily: 'inherit', color: theme.text,
              border: `1px solid ${ativo ? theme.accentBorder : theme.border}`, background: ativo ? theme.realceBg2 : theme.surface,
            }}>
              <div style={{ fontFamily: theme.display, fontSize: 17, lineHeight: 1.2 }}>{nome}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11.5, color: theme.text3 }}>
                <span><strong style={{ color: theme.text }}>{da.length}</strong> itens</span>
                {urg > 0 && <span style={{ color: theme.negative }}>▲ {urg} urgente{urg > 1 ? 's' : ''}</span>}
              </div>
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => ir(org, undefined)} style={estiloFiltro(!grupo)}>Tudo · {daOrg.length}</button>
        {GRUPOS.map(({ g, rotulo }) => {
          const n = conta(daOrg, g)
          return n > 0 || grupo === g ? <button key={g} onClick={() => ir(org, grupo === g ? undefined : g)} style={estiloFiltro(grupo === g)}>{rotulo} · {n}</button> : null
        })}
        {org && <button onClick={() => ir(undefined, grupo)} style={{ ...estiloFiltro(false), marginLeft: 'auto' }}>✕ {orgs.find(([id]) => id === org)?.[1] ?? 'org'}</button>}
      </div>

      <Painel aria-label="Itens da fila" rotulo={`${visiveis.length} ${visiveis.length === 1 ? 'item' : 'itens'}${urgentes ? ` · ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}`}>
        {visiveis.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: theme.text3 }}>Nada neste filtro.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="f-tabela">
              <thead><tr><th>Prioridade</th>{!org && <th>Organização</th>}<th>O quê</th><th>Descrição</th><th className="f-num">Valor</th><th>Data</th><th /></tr></thead>
              <tbody>
                {visiveis.slice(0, mostrar).map((i) => {
                  const p = prioridade(i.peso)
                  const href = destino(i)
                  return (
                    <tr key={i.tipo_item + i.id_ref}>
                      <td title={`peso ${i.peso}`}><span style={{ color: p.cor }}>{p.icone}</span> <span style={{ color: i.peso >= 80 ? theme.text : theme.text2 }}>{p.rotulo}</span></td>
                      {!org && <td>{i.organizacao}</td>}
                      <td>{ROTULO[i.tipo_item] ?? i.tipo_item}</td>
                      <td style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis' }} title={i.descricao}>{i.descricao}</td>
                      <td className="f-num">{i.valor == null ? '—' : fmtBRL(Number(i.valor))}</td>
                      <td style={{ color: theme.text3, fontVariantNumeric: 'tabular-nums' }}>{desde(i.desde)}</td>
                      <td style={{ textAlign: 'right' }}><Link href={href} style={{ fontSize: 12, color: theme.accent }}>Resolver →</Link></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {visiveis.length > mostrar && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setMostrar((m) => m + POR_VEZ)} style={botaoSecundario()}>Mostrar mais {Math.min(POR_VEZ, visiveis.length - mostrar)}</button>
            <span style={{ fontSize: 11.5, color: theme.text3 }}>{mostrar} de {visiveis.length}</span>
          </div>
        )}
        {itens.length >= LIMITE && <div style={{ padding: '10px 16px', fontSize: 11.5, color: theme.text3 }}>A fila traz no máximo os {LIMITE} itens mais urgentes; conforme estes forem resolvidos, os próximos aparecem.</div>}
      </Painel>
    </div>
  )
}
