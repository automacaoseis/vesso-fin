'use client'

import { useActionState } from 'react'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'
import { entrar } from './acoes'

// O formulário posta para uma Server Action: e-mail e senha vão ao NOSSO servidor, que fala com o Auth.
export default function FormLogin({ volta }: { volta: string }) {
  const [estado, acao, pendente] = useActionState(entrar, undefined)
  const campo: React.CSSProperties = {
    width: '100%', padding: '9px 10px', fontSize: 14, background: 'transparent', color: theme.text,
    border: `1px solid ${theme.border2}`, borderRadius: theme.radiusSm,
  }
  return (
    <form action={acao} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="hidden" name="volta" value={volta} />
      <label style={{ fontSize: 12, color: theme.text2, display: 'grid', gap: 4 }}>E-mail
        <input name="email" type="email" autoComplete="username" required autoFocus style={campo} />
      </label>
      <label style={{ fontSize: 12, color: theme.text2, display: 'grid', gap: 4 }}>Senha
        <input name="senha" type="password" autoComplete="current-password" required style={campo} />
      </label>
      {estado?.erro && <div role="alert" style={{ fontSize: 13, color: f.negativeText }}>▲ {estado.erro}</div>}
      <button type="submit" disabled={pendente} style={{
        padding: '10px 12px', fontSize: 14, fontWeight: 600, borderRadius: theme.radiusSm, border: 'none',
        background: theme.text, color: theme.bg, cursor: pendente ? 'wait' : 'pointer',
      }}>{pendente ? 'Entrando…' : 'Entrar'}</button>
    </form>
  )
}
