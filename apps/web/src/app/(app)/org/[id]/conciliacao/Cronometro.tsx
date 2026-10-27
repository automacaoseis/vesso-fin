'use client'

// Tempo por etapa (docs/PROMPT.md §7): sem isto não há número para precificar.
// Inicia ao entrar, para ao sair, ao trocar de organização ou ao fechar a aba (beacon).
// Fica FORA do componente com `key` da tela: trocar de mês/filtro não reinicia a sessão.
import { useEffect } from 'react'
import { tempoIniciar, tempoParar } from './acoes'

export default function Cronometro({ idOrg }: { idOrg: string }) {
  useEffect(() => {
    tempoIniciar(idOrg).catch(() => {})
    const parar = () => navigator.sendBeacon('/api/tempo/parar')
    const voltar = (e: PageTransitionEvent) => { if (e.persisted) tempoIniciar(idOrg).catch(() => {}) }
    window.addEventListener('pagehide', parar)
    window.addEventListener('pageshow', voltar)
    return () => {
      window.removeEventListener('pagehide', parar)
      window.removeEventListener('pageshow', voltar)
      tempoParar().catch(() => {})
    }
  }, [idOrg])
  return null
}
