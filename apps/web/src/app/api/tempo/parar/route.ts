// Para o cronômetro quando a aba fecha (navigator.sendBeacon não chama Server Action).
// Só aceita da própria origem: o beacon manda os cookies, então outra origem poderia disparar isto.
import { api } from '@/lib/api'

export async function POST(req: Request) {
  const origem = req.headers.get('origin')
  if (!origem || new URL(origem).host !== req.headers.get('host')) return new Response(null, { status: 403 })
  await api.post('/tempo/parar', {}).catch(() => {})
  return new Response(null, { status: 204 })
}
