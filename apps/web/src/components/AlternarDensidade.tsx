'use client'

import { useState, useTransition } from 'react'
import { theme } from '@/lib/theme'
import { f } from '@/lib/fin'
import { salvarDensidade } from '@/lib/densidade-acao'
import { FATOR, ROTULO, type Densidade } from '@/lib/densidade'

/**
 * Compacto · Confortável · Amplo — o tamanho do app, por pessoa.
 *
 * ⚠️ **Aqui os três botões TÊM rótulo, ao contrário do tema**, que é só um ícone ao lado do
 * nome. A diferença é o que a escolha exige de quem escolhe: tema é binário e auto-evidente
 * (o ícone diz para onde vai). Tamanho tem três paradas e nenhuma delas se adivinha por
 * símbolo — um par de lupas ± faria a pessoa clicar às cegas até acertar.
 *
 * ⚠️ E ganha uma LINHA do menu porque é a escolha que ainda não foi feita: quem abre o app num
 * monitor externo pela primeira vez precisa TOPAR com ela. O tema, que já vem no padrão certo
 * para quase todo mundo, pode se esconder num canto.
 *
 * ⚠️ A troca é imediata (escreve `data-densidade` no `<html>`) e a ação de servidor só grava o
 * cookie. Mesma mecânica do tema — ver `AlternarTema`.
 */
export default function AlternarDensidade({ inicial }: { inicial: Densidade }) {
  const [dens, setDens] = useState<Densidade>(inicial)
  const [pendente, iniciar] = useTransition()

  function escolher(nova: Densidade) {
    if (nova === dens || pendente) return
    const anterior = dens

    setDens(nova)
    document.documentElement.setAttribute('data-densidade', nova)

    iniciar(() => {
      salvarDensidade(nova).catch((e) => {
        console.error('[densidade/salvar]', e)
        setDens(anterior)
        document.documentElement.setAttribute('data-densidade', anterior)
      })
    })
  }

  return (
    <div style={{ borderBottom: `1px solid ${theme.borderFaint}`, padding: '10px 14px' }}>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: f.mutedText, marginBottom: 5 }}>
        Tamanho
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {(Object.keys(FATOR) as Densidade[]).map((d) => {
          const ativo = dens === d
          return (
            <button
              key={d}
              onClick={() => escolher(d)}
              disabled={pendente}
              aria-pressed={ativo}
              title={`${ROTULO[d]} · ${Math.round(FATOR[d] * 100)}%`}
              style={{
                padding: '5px 4px', fontSize: 11, fontFamily: 'inherit', fontWeight: 500,
                borderRadius: theme.radiusSm,
                border: `1px solid ${ativo ? theme.accentBorder : theme.border2}`,
                background: ativo ? theme.realceBg2 : 'transparent',
                color: ativo ? theme.realce : theme.text3,
                cursor: pendente ? 'wait' : 'pointer', outline: 'none', whiteSpace: 'nowrap',
              }}>
              {ROTULO[d]}
            </button>
          )
        })}
      </div>
      {/* ⚠️ A dica existe porque o problema é DE QUEM NÃO SABE que tem problema: a pessoa em
          monitor externo acha que o sistema é assim e não reclama — só usa menos. */}
      <div style={{ fontSize: 10, color: f.mutedText, marginTop: 6, lineHeight: 1.45 }}>
        Em monitor externo, Confortável costuma cair melhor.
      </div>
    </div>
  )
}
