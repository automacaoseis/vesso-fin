'use server'

import { redirect } from 'next/navigation'
import { entrarComSenha } from '@/lib/sessao'

export async function entrar(_: { erro?: string } | undefined, form: FormData): Promise<{ erro?: string }> {
  const email = String(form.get('email') ?? '').trim()
  const senha = String(form.get('senha') ?? '')
  if (!email || !senha) return { erro: 'preencha e-mail e senha' }
  const r = await entrarComSenha(email, senha)
  if (!r.ok) return { erro: r.mensagem }
  // só caminho interno: "/x" sim, "//x" e "https://…" não (open redirect)
  const volta = String(form.get('volta') ?? '')
  redirect(/^\/(?!\/)/.test(volta) ? volta : '/')
}
