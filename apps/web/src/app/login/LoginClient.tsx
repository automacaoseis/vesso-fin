'use client'

// Mesma tela do vesso-admin (app/login/LoginClient.tsx): metade da marca em ink + formulário.
// Diferença deliberada: e-mail e senha vão para uma Server Action do Vesso FIN — o navegador não fala com o Supabase.
import { useActionState, useState } from 'react'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloCampo } from '@/components/vesso'
import MarcaApoio from '@/components/MarcaApoio'
import { APP } from '@/config/app'
import { entrar, recuperar } from './acoes'

export default function LoginClient({ volta }: { volta: string }) {
  const [modo, setModo] = useState<'entrar' | 'recuperar'>('entrar')
  const [estadoEntrar, acaoEntrar, entrando] = useActionState(entrar, undefined)
  const [estadoRec, acaoRec, enviando] = useActionState(recuperar, undefined)
  const erro = modo === 'entrar' ? estadoEntrar?.erro : estadoRec?.erro
  const carregando = modo === 'entrar' ? entrando : enviando

  return (
    <div className="login-split" style={{ minHeight: '100vh', background: theme.bg, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      {/* Metade da marca: superfície invertida (ink nos dois temas), wordmark off-white, frase em serifa. */}
      <aside className="login-marca" style={{ background: theme.invBg, padding: '46px 52px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 40 }}>
        <div className="login-marca-apoio" style={{ display: 'flex', gap: 10 }}>
          {[0, 90, 180].map((giro) => <MarcaApoio key={giro} size={15} cor={theme.creme} rotacao={giro} />)}
        </div>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vesso-logo.svg" alt="Vesso" style={{ height: 46, width: 'auto', display: 'block' }} />
          <div style={{ width: 54, height: 1, background: 'rgba(255,253,245,0.26)', margin: '24px 0 20px' }} />
          <p className="login-marca-frase" style={{ fontFamily: theme.display, fontSize: 20, lineHeight: 1.45, color: theme.invText, margin: 0, maxWidth: 320 }}>
            {APP.descricao}
          </p>
        </div>
        <div className="login-marca-rodape" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,253,245,0.42)' }}>
          Vesso · Financeiro · {APP.ano}
        </div>
      </aside>

      <main style={{ display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
        {modo === 'recuperar' && estadoRec?.enviadoPara ? (
          <div style={{ width: '100%', maxWidth: 340 }}>
            <h1 style={{ fontFamily: theme.display, fontSize: 27, fontWeight: 400, color: theme.text, margin: 0, lineHeight: 1.2 }}>Confira seu e-mail</h1>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: theme.text2, margin: '10px 0 0' }}>
              Se houver uma conta em <strong style={{ fontWeight: 600 }}>{estadoRec.enviadoPara}</strong>, o link para criar uma
              nova senha chega em alguns minutos. Ele vale por 1 hora e só pode ser usado uma vez.
            </p>
            <button type="button" onClick={() => setModo('entrar')} style={{ ...botaoSecundario(), marginTop: 22 }}>Voltar</button>
          </div>
        ) : (
          <form action={modo === 'entrar' ? acaoEntrar : acaoRec} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input type="hidden" name="volta" value={volta} />
            <div style={{ marginBottom: 6 }}>
              <h1 style={{ fontFamily: theme.display, fontSize: 27, fontWeight: 400, color: theme.text, margin: 0, lineHeight: 1.2 }}>
                {modo === 'recuperar' ? 'Recuperar senha' : 'Entrar'}
              </h1>
              <div style={{ fontSize: 12.5, color: theme.text3, marginTop: 7 }}>
                {modo === 'recuperar' ? 'Enviamos um link para você criar uma nova.' : 'Acesso restrito a quem tem convite.'}
              </div>
            </div>

            <Campo rotulo="E-mail">
              <input className="login-campo" name="email" type="email" required autoComplete="email" autoFocus style={estiloCampo} />
            </Campo>
            {modo === 'entrar' && (
              <Campo rotulo="Senha">
                <input className="login-campo" name="senha" type="password" required autoComplete="current-password" style={estiloCampo} />
              </Campo>
            )}

            {erro && (
              <div role="alert" style={{ fontSize: 12, color: theme.negative, background: theme.negativeBg, padding: '9px 11px', borderRadius: theme.radiusSm }}>{erro}</div>
            )}

            <button type="submit" disabled={carregando}
              style={{ ...botaoPrimario(carregando), marginTop: 4, width: '100%', padding: '12px 16px', fontSize: 13 }}>
              {carregando ? (modo === 'recuperar' ? 'Enviando…' : 'Entrando…') : (modo === 'recuperar' ? 'Enviar link' : 'Entrar')}
            </button>

            <button type="button" onClick={() => setModo(modo === 'recuperar' ? 'entrar' : 'recuperar')}
              style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 12.5, color: theme.accent, cursor: 'pointer', alignSelf: 'center', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              {modo === 'recuperar' ? 'Voltar para o login' : 'Esqueci minha senha'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.text3 }}>{rotulo}</span>
      {children}
    </label>
  )
}
