import { theme } from '@/lib/theme'

/**
 * Elemento de apoio da marca (04_Elemento_de_apoio) — a marca tri-radial que aparece acima
 * dos títulos em praticamente toda peça da identidade.
 *
 * **Rotação**: a marca usa o elemento em ângulos diferentes lado a lado — no footer, cada uma
 * das três colunas (NÚCLEO · SOBRE NÓS · CASES) tem o seu, virado para um lado; na home, três
 * aparecem em fila acima da manchete. O desenho NÃO é simétrico a 120° (a haste é mais longa
 * que os braços), então cada terço de volta dá uma silhueta diferente — é de propósito.
 *
 * A moldura é quadrada e centrada no desenho (que ocupa 600×524 dentro dela) para o giro não
 * cortar nada: girar uma caixa retangular jogaria as pontas para fora.
 */
export default function MarcaApoio({
  size = 12,
  cor = theme.text4,
  rotacao = 0,
}: {
  size?: number
  cor?: string
  /**
   * Graus. ⚠️ Não use múltiplos de 120: o desenho é quase simétrico a cada terço de volta e
   * esses ângulos devolvem praticamente a mesma silhueta (conferido rasterizando a volta
   * inteira). Quem muda a leitura é o QUARTO de volta — 0 (Y de pé), 90 (deitado),
   * 180 (invertido), que é o trio que o footer da marca usa lado a lado.
   */
  rotacao?: number
}) {
  return (
    <svg width={size} height={size} viewBox="240 240 600 600" aria-hidden
      style={{ display: 'block', flexShrink: 0, transform: rotacao ? `rotate(${rotacao}deg)` : undefined }}>
      <path
        d="M570.59,801.2h-61.17v-143.16c0-104.94-55.68-201.9-146.07-254.37l-123.34-71.6,30.59-53.26,123.34,71.6c90.39,52.47,201.76,52.47,292.15,0l123.34-71.6,30.59,53.26-123.34,71.6c-90.39,52.47-146.07,149.43-146.07,254.37v143.16Z"
        fill={cor}
      />
    </svg>
  )
}
