'use client'

import Link from 'next/link'
import { useState } from 'react'
import { theme } from '@/lib/theme'
import { Aviso, Painel } from '@/components/fin-ui'
import { mesCurto } from '@/lib/datas'
import { abrirArquivo, diasDesde, ROT_TIPO, STATUS_DOC, type Documento } from '../org/[id]/documentos/DocumentosClient'

export default function PendenciasClient({ docs }: { docs: (Documento & { organizacao: string })[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const porOrg = [...new Map(docs.map((d) => [d.id_org, d.organizacao])).entries()]
    .map(([id, nome]) => ({ id, nome, docs: docs.filter((d) => d.id_org === id) }))
    .sort((a, b) => b.docs.length - a.docs.length)
  const pedidos = docs.filter((d) => d.status === 'pedido').length
  const atrasados = docs.filter((d) => d.status === 'pedido' && (diasDesde(d.pedido_em) ?? 0) > 7).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 13, color: theme.text2 }}>
        <strong>{pedidos}</strong> pedido{pedidos === 1 ? '' : 's'} aguardando o cliente{atrasados > 0 && <> · <span style={{ color: theme.negative }}>▲ {atrasados} há mais de 7 dias</span></>}
        {' '}· <strong>{docs.length - pedidos}</strong> recebido{docs.length - pedidos === 1 ? '' : 's'} para validar
      </div>
      {porOrg.map((o) => (
        <Painel key={o.id} aria-label={o.nome} rotulo={o.nome} direita={<Link href={`/org/${o.id}/documentos`} style={{ fontSize: 12, color: theme.accent }}>Abrir documentos →</Link>}>
          {o.docs.map((d) => {
            const st = STATUS_DOC[d.status]
            const dias = diasDesde(d.status === 'pedido' ? d.pedido_em : d.recebido_em)
            return (
              <div key={d.id_documento} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) 140px', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${theme.borderFaint}`, fontSize: 12.5, alignItems: 'baseline' }} className="v-stack">
                <span><span style={{ color: st.cor }}>{st.icone}</span> {st.rotulo}</span>
                <span>
                  <strong>{d.descricao}</strong>
                  <span style={{ color: theme.text3 }}> · {ROT_TIPO[d.tipo]}{d.competencia && ` · ${mesCurto(d.competencia)}`}</span>
                  {d.tem_arquivo && <> · <button onClick={() => abrirArquivo(d.id_documento, setErro)} style={{ background: 'none', border: 0, padding: 0, color: theme.accent, cursor: 'pointer', fontSize: 12.5 }}>ver arquivo</button></>}
                  {d.motivo_recusa && d.status === 'pedido' && <span style={{ color: theme.negative }}> · recusado antes: {d.motivo_recusa}</span>}
                </span>
                <span style={{ color: d.status === 'pedido' && (dias ?? 0) > 7 ? theme.negative : theme.text3, textAlign: 'right' }}>
                  {dias == null ? '' : `${d.status === 'pedido' ? 'pedido' : 'chegou'} há ${dias} dia${dias === 1 ? '' : 's'}`}
                </span>
              </div>
            )
          })}
        </Painel>
      ))}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  )
}
