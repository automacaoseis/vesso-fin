'use server'

import { redirect } from 'next/navigation'
import { entrarComSenha, pedirNovaSenha } from '@/lib/sessao'

export type EstadoLogin = { erro?: string; enviadoPara?: string } | undefined

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get('email') ?? '').trim()
  const senha = String(form.get('senha') ?? '')
  if (!email || !senha) return { erro: 'Preencha e-mail e senha.' }
  const r = await entrarComSenha(email, senha)
  if (!r.ok) return { erro: r.mensagem }
  // só caminho interno: "/x" sim, "//x" e "https://…" não (open redirect)
  const volta = String(form.get('volta') ?? '')
  redirect(/^\/(?!\/)/.test(volta) ? volta : '/')
}

export async function recuperar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get('email') ?? '').trim()
  if (!email) return { erro: 'Informe o e-mail.' }
  const r = await pedirNovaSenha(email)
  return r.ok ? { enviadoPara: email } : { erro: r.mensagem }
}
