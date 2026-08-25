import { useEffect, useRef } from 'react'
import { keyLayout } from '../Keyboard'
import type { ExpectedNote } from './pattern'

// Notes falling onto the keyboard. Canvas and not SVG because this redraws at
// 60fps: touching SVG attributes through React state at that rate stutters.
//
// The X axis comes from keyLayout, the SAME one the SVG keyboard uses, and both
// elements are width:100% in the same container — so a note lands exactly on its
// own key at any screen width.

export const ROLL_H = 260

export type PlayedMark = {
  midi: number
  beat: number
  /** Deviation in ms against the grid: <0 rushed, >0 dragged. */
  devMs: number
}

type Props = {
  expected: ExpectedNote[]
  low: number
  high: number
  /** Current position in beats. NaN when stopped. */
  getPosition: () => number
  getPlayed: () => PlayedMark[]
  beatsPerBar: number
  /** Length of one rep in beats: the shape repeats every one of them. */
  cycleBeats: number
  /** How many beats fit in the height of the view. */
  windowBeats?: number
  showFingers: boolean
  active: boolean
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function PianoRoll({
  expected,
  low,
  high,
  getPosition,
  getPlayed,
  beatsPerBar,
  cycleBeats,
  windowBeats = 4,
  showFingers,
  active,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const posRef = useRef(getPosition)
  const playedRef = useRef(getPlayed)
  posRef.current = getPosition
  playedRef.current = getPlayed

  const layout = keyLayout(low, high)
  const width = layout.width

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = width * dpr
    canvas.height = ROLL_H * dpr

    const colors = {
      bg: cssVar('--panel', '#1b1e24'),
      dim: cssVar('--dim', '#7a8290'),
      accent: cssVar('--accent', '#6ea8fe'),
      ok: cssVar('--ok', '#35c48a'),
      bad: cssVar('--bad', '#e5544b'),
      miss: cssVar('--miss', '#5a6472'),
    }

    const pxPerBeat = ROLL_H / windowBeats
    // The hit line sits at the bottom, against the keyboard: the note "arrives" there.
    const hitY = ROLL_H - 6

    let raf = 0

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, ROLL_H)
      ctx.fillStyle = colors.bg
      ctx.fillRect(0, 0, width, ROLL_H)

      const pos = posRef.current()
      const p = Number.isFinite(pos) ? pos : 0

      // Black key lanes: they give a pitch reference without cluttering.
      ctx.fillStyle = 'rgba(255,255,255,0.035)'
      for (const k of layout.keys) {
        if (k.black) ctx.fillRect(k.x, 0, k.w, ROLL_H)
      }

      // Beat lines. The downbeat is stronger.
      const first = Math.floor(p)
      for (let b = first; b <= p + windowBeats + 1; b++) {
        const y = hitY - (b - p) * pxPerBeat
        if (y < 0 || y > ROLL_H) continue
        const downbeat = ((b % beatsPerBar) + beatsPerBar) % beatsPerBar === 0
        ctx.strokeStyle = downbeat ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)'
        ctx.lineWidth = downbeat ? 1.5 : 1
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // Expected notes: outline, coloured by hand. The exercise runs in a loop, so
      // it draws the current rep and the next — otherwise the view empties on the second.
      const drawExpected = (e: ExpectedNote, beat: number) => {
        const y = hitY - (beat - p) * pxPerBeat
        if (y < -20 || y > ROLL_H + 20) return
        const x = layout.xOf(e.midi)
        if (!Number.isFinite(x)) return
        const black = [1, 3, 6, 8, 10].includes(e.midi % 12)
        const w = black ? 12 : 18
        ctx.strokeStyle = e.hand === 'l' ? colors.dim : colors.accent
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.roundRect(x - w / 2, y - 9, w, 9, 3)
        ctx.stroke()

        // Finger number. It sits on the note itself, not floating above it: with
        // sixteenths in two hands, a loose number turns into soup.
        if (showFingers && e.finger && y > 4 && y < ROLL_H) {
          ctx.fillStyle = e.hand === 'l' ? colors.dim : colors.accent
          ctx.font = 'bold 13px ui-monospace, SFMono-Regular, monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(e.finger), x, y - 16)
          ctx.textBaseline = 'alphabetic'
        }
      }

      const loop = cycleBeats > 0
      const firstCycle = loop ? Math.floor(p / cycleBeats) : 0
      for (const e of expected) {
        if (!loop) {
          drawExpected(e, e.beat)
          continue
        }
        for (let c = firstCycle; c <= firstCycle + 1; c++) {
          drawExpected(e, e.beat + c * cycleBeats)
        }
      }

      // Played notes: filled dot, coloured by the timing error.
      for (const m of playedRef.current()) {
        const y = hitY - (m.beat - p) * pxPerBeat
        if (y < -10 || y > ROLL_H + 10) continue
        const x = layout.xOf(m.midi)
        if (!Number.isFinite(x)) continue
        const late = m.devMs
        ctx.fillStyle = Math.abs(late) < 25 ? colors.ok : late > 0 ? colors.bad : colors.accent
        ctx.beginPath()
        ctx.arc(x, y - 4, 4, 0, Math.PI * 2)
        ctx.fill()
      }

      // Hit line.
      ctx.strokeStyle = active ? colors.ok : colors.miss
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, hitY)
      ctx.lineTo(width, hitY)
      ctx.stroke()

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
    // expected changes when the exercise or key changes; the rest comes in by ref.
  }, [expected, low, high, width, beatsPerBar, cycleBeats, windowBeats, showFingers, active])

  return (
    <canvas
      ref={ref}
      className="piano-roll"
      style={{ width: '100%', height: 'auto', aspectRatio: `${width} / ${ROLL_H}` }}
      role="img"
      aria-label="falling exercise notes"
    />
  )
}
