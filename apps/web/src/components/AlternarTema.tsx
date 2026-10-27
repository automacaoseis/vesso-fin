'use client'

import { useState, useTransition } from 'react'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'
import { salvarTema } from '@/lib/tema-acao'
import { atributoTema, type Tema } from '@/lib/tema'

/**
 * Claro · Escuro — ícone sozinho, sem moldura e sem rótulo.
 *
 * ⚠️ **Discreto de propósito, e é o mesmo desenho do seis-sistema** (`ShellClient`, o par
 * sol/lua ao lado do sino): botão de ícone em `text3`, que clareia para `text` no hover.
 *
 * A primeira versão era um bloco "TEMA" com dois botões `Claro | Escuro`, no traje dos
 * seletores vizinhos. Estava errado por uma razão de FREQUÊNCIA: lente e "Ver como" se
 * escolhem toda semana e merecem rótulo; **tema se escolhe uma vez e nunca mais**. Um bloco
 * de duas linhas para isso ocupava, todo dia, o espaço de algo que se usa uma vez na vida.
 *
 * ⚠️ Por isso ele também não gasta uma LINHA do menu: mora no canto do bloco de identidade,
 * ao lado do nome. Preferência pessoal, junto de quem a tem.
 *
 * ⚠️ **NÃO vai para a barra do topo**, onde o seis o coloca. Aqui a barra já perdeu a lente
 * por disputar atenção com a navegação o dia inteiro (ver a nota em `LenteProduto`), e tema é
 * escolha ainda mais rara que lente. O desenho do seis é a referência; o LUGAR é deste app.
 *
 * ⚠️ **A troca é imediata e não espera o servidor.** O clique escreve
 * `document.documentElement.dataset.theme` na hora — todos os tokens são `var()` no `<html>`,
 * então a página repinta num quadro, sem re-render de React e sem ida à rede. A ação de
 * servidor grava o cookie em paralelo, só para a escolha sobreviver à próxima navegação.
 *
 * ⚠️ **Se a gravação falhar, o estado volta.** Um botão que fica no escuro e reverte na
 * próxima navegação é pior que um que não mudou: a pessoa clica de novo achando que não pegou.
 */
export default function AlternarTema({ inicial }: { inicial: Tema }) {
  const [tema, setTema] = useState<Tema>(inicial)
  const [pendente, iniciar] = useTransition()
  const escuro = tema === 'escuro'

  function alternar() {
    if (pendente) return
    const novo: Tema = escuro ? 'claro' : 'escuro'
    const anterior = tema

    setTema(novo)
    document.documentElement.setAttribute('data-theme', atributoTema(novo))

    iniciar(() => {
      salvarTema(novo).catch((e) => {
        console.error('[tema/salvar]', e)
        setTema(anterior)
        document.documentElement.setAttribute('data-theme', atributoTema(anterior))
      })
    })
  }

  return (
    <button
      onClick={alternar}
      aria-label={escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
      title={escuro ? 'Tema claro' : 'Tema escuro'}
      style={{
        background: 'none', border: 'none', padding: 4, margin: 0, flexShrink: 0,
        display: 'flex', alignItems: 'center', color: f.mutedText,
        cursor: pendente ? 'wait' : 'pointer', transition: 'color .15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = theme.text2 }}
      onMouseLeave={(e) => { e.currentTarget.style.color = f.mutedText }}
    >
      {escuro ? <IconeSol /> : <IconeLua />}
    </button>
  )
}

/* ⚠️ `currentColor` nos dois: é o que faz o hover do botão alcançar o traço do ícone. Um
   `stroke` fixo aqui deixaria o ícone parado enquanto o resto do botão clareia — e, pior,
   fixaria uma cor que não existe nos dois temas. */
const TRACO = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const }

/** Mostrado no tema ESCURO: o clique leva ao claro. */
function IconeSol() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden {...TRACO}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </svg>
  )
}

/** Mostrado no tema CLARO: o clique leva ao escuro. */
function IconeLua() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden {...TRACO}>
      <path d="M20.5 14.2A8.6 8.6 0 1 1 9.8 3.5a6.9 6.9 0 0 0 10.7 10.7Z" />
    </svg>
  )
}
