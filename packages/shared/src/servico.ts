// Assinatura de serviço web → API (cabeçalho X-Vesso-Service). Só servidor (node:crypto).
// Prova que a chamada saiu do apps/web (que tem o segredo), não de um navegador com um JWT roubado.
//   X-Vesso-Service: t=<unix s>,v1=<hex HMAC-SHA256(segredo, "t\nMÉTODO\ncaminho?query\nsha256(corpo)")>
// Assina também método e caminho (o prompt fala em corpo + timestamp): sem isso, um corpo assinado
// para uma rota poderia ser reenviado para outra dentro da janela.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const CABECALHO_SERVICO = 'x-vesso-service'
export const JANELA_SERVICO_S = 300

function base(t: number, metodo: string, caminho: string, corpo: Uint8Array | string): string {
  const h = createHash('sha256').update(corpo).digest('hex')
  return `${t}\n${metodo.toUpperCase()}\n${caminho}\n${h}`
}

/** caminho = pathname + search, exatamente como a API vai ver (ex.: "/orgs/x/movimentos?de=2026-10-01"). */
export function assinarServico(segredo: string, metodo: string, caminho: string, corpo: Uint8Array | string = '', agora = Date.now()): string {
  const t = Math.floor(agora / 1000)
  const v1 = createHmac('sha256', segredo).update(base(t, metodo, caminho, corpo)).digest('hex')
  return `t=${t},v1=${v1}`
}

export type ResultadoServico = { ok: true } | { ok: false; motivo: string }

export function verificarServico(
  segredo: string, cabecalho: string | null | undefined, metodo: string, caminho: string,
  corpo: Uint8Array | string, agora = Date.now(),
): ResultadoServico {
  if (!cabecalho) return { ok: false, motivo: 'sem assinatura de serviço' }
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(cabecalho)
  if (!m) return { ok: false, motivo: 'assinatura de serviço malformada' }
  const t = Number(m[1])
  if (Math.abs(agora / 1000 - t) > JANELA_SERVICO_S) return { ok: false, motivo: 'assinatura de serviço expirada' }
  const esperado = createHmac('sha256', segredo).update(base(t, metodo, caminho, corpo)).digest()
  const recebido = Buffer.from(m[2]!, 'hex')
  return timingSafeEqual(esperado, recebido) ? { ok: true } : { ok: false, motivo: 'assinatura de serviço inválida' }
}
