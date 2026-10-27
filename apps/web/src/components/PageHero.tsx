import { theme } from '@/lib/theme'

/**
 * Cabeçalho padrão das telas: eyebrow (petróleo, caixa-alta) + título em Newsreader +
 * subtítulo, com controles opcionais à direita e régua embaixo.
 *
 * O título é a manchete da marca: **serifa em caixa normal**, não caixa-alta. A identidade
 * usa caixa-alta só em rótulos curtos (nav, botões, eyebrow) — a manchete é sempre sentence
 * case, como em "Somos um núcleo de crescimento médico". Antes daqui o título era um sans
 * em caixa-alta, que era o oposto das duas regras.
 */
export default function PageHero({ eyebrow, titulo, descricao, right }: { eyebrow: string; titulo?: string; descricao?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16, borderBottom: `1px solid ${theme.borderStrong}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent, fontFamily: theme.mono }}>{eyebrow}</div>
          {/* `titulo` é opcional: quando a nav já marca a página ativa e o eyebrow repete o
              nome, um terceiro rótulo em serifa 38 é eco, não hierarquia. */}
          {titulo && <div className="v-manchete" style={{ fontFamily: theme.display, fontSize: 38, fontWeight: 500, color: theme.text, letterSpacing: '-0.015em', lineHeight: 1.1, marginTop: 8 }}>{titulo}</div>}
        </div>
        {right}
      </div>
      {descricao && <div style={{ fontSize: 14, color: theme.text3, lineHeight: 1.5, maxWidth: 620 }}>{descricao}</div>}
    </div>
  )
}
