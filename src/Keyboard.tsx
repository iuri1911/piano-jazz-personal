import { midiToName } from './theory'

export type KeyMark = 'held' | 'correct' | 'extra' | 'missing'

const BLACK_PCS = new Set([1, 3, 6, 8, 10])

// Geometria exportada porque o piano-roll desenha em cima do mesmo eixo: se as
// duas coisas tivessem cada uma a sua conta, as notas cairiam fora da tecla.
export const KEY_W = 26 // largura da tecla branca
export const KEY_H = 120
export const KEY_BW = 16 // largura da tecla preta
export const KEY_BH = 76

const W = KEY_W
const H = KEY_H
const BW = KEY_BW
const BH = KEY_BH

export type KeyGeom = { midi: number; x: number; w: number; black: boolean }
export type Layout = { keys: KeyGeom[]; width: number; xOf: (midi: number) => number }

/** Posicao de cada tecla no intervalo. Fonte unica do eixo horizontal. */
export function keyLayout(low: number, high: number): Layout {
  const keys: KeyGeom[] = []
  let whiteCount = 0
  for (let midi = low; midi <= high; midi++) {
    if (BLACK_PCS.has(midi % 12)) {
      keys.push({ midi, x: whiteCount * W - BW / 2, w: BW, black: true })
    } else {
      keys.push({ midi, x: whiteCount * W, w: W, black: false })
      whiteCount++
    }
  }
  const byMidi = new Map(keys.map((k) => [k.midi, k]))
  return {
    keys,
    width: whiteCount * W,
    xOf: (midi) => {
      const k = byMidi.get(midi)
      return k ? k.x + k.w / 2 : Number.NaN
    },
  }
}

type Props = {
  marks: Map<number, KeyMark>
  low?: number
  high?: number
  showNoteNames?: boolean
}

export function Keyboard({ marks, low = 36, high = 96, showNoteNames = true }: Props) {
  const layout = keyLayout(low, high)
  const whites = layout.keys.filter((k) => !k.black)
  const blacks = layout.keys.filter((k) => k.black)
  const width = layout.width
  const labelY = H + 16

  return (
    <svg
      className="keyboard"
      viewBox={`0 0 ${width} ${labelY + 6}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="teclado"
    >
      {whites.map(({ midi, x }) => (
        <rect
          key={midi}
          className={`key white ${marks.get(midi) ?? ''}`}
          x={x}
          y={0}
          width={W}
          height={H}
          rx={3}
        />
      ))}
      {blacks.map(({ midi, x }) => (
        <rect
          key={midi}
          className={`key black ${marks.get(midi) ?? ''}`}
          x={x}
          y={0}
          width={BW}
          height={BH}
          rx={2}
        />
      ))}
      {showNoteNames &&
        whites
          .filter(({ midi }) => midi % 12 === 0 || marks.has(midi))
          .map(({ midi, x }) => (
            <text key={midi} className="key-label" x={x + W / 2} y={labelY} textAnchor="middle">
              {midiToName(midi)}
            </text>
          ))}
    </svg>
  )
}

/** Monta o mapa de marcacao a partir do resultado de compareToTarget. */
export function marksFromComparison(c: {
  correct: number[]
  extra: number[]
  missing: number[]
}): Map<number, KeyMark> {
  const m = new Map<number, KeyMark>()
  for (const n of c.missing) m.set(n, 'missing')
  for (const n of c.correct) m.set(n, 'correct')
  for (const n of c.extra) m.set(n, 'extra')
  return m
}

export function marksFromHeld(notes: number[]): Map<number, KeyMark> {
  return new Map(notes.map((n) => [n, 'held' as KeyMark]))
}
