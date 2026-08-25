import { useEffect, useRef } from 'react'
import { Accidental, Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from 'vexflow'
import { midiToVexKey, type Spelling } from './theory'

const WIDTH = 300
const HEIGHT = 230
const STAVE_WIDTH = 240

type Props = {
  notes: number[]
  spelling?: Spelling
  color?: string
  label?: string
}

/** Grand staff. The split between clefs is by actual pitch (>= C4 goes to treble). */
export function Staff({ notes, spelling = 'flat', color = '#111', label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.innerHTML = ''

    const renderer = new Renderer(host, Renderer.Backends.SVG)
    renderer.resize(WIDTH, HEIGHT)
    const ctx = renderer.getContext()

    const treble = new Stave(10, 10, STAVE_WIDTH).addClef('treble')
    const bass = new Stave(10, 110, STAVE_WIDTH).addClef('bass')
    treble.setContext(ctx).draw()
    bass.setContext(ctx).draw()
    new StaveConnector(treble, bass).setType('brace').setContext(ctx).draw()
    new StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw()

    const sorted = [...notes].sort((a, b) => a - b)
    const split = { treble: sorted.filter((n) => n >= 60), bass: sorted.filter((n) => n < 60) }

    for (const [clef, stave] of [
      ['treble', treble],
      ['bass', bass],
    ] as const) {
      const group = split[clef]
      const note =
        group.length > 0
          ? new StaveNote({
              keys: group.map((n) => midiToVexKey(n, spelling)),
              duration: 'w',
              clef,
            })
          : new StaveNote({ keys: [clef === 'treble' ? 'b/4' : 'd/3'], duration: 'wr', clef })

      group.forEach((n, i) => {
        const acc = midiToVexKey(n, spelling).split('/')[0].slice(1) // "eb" -> "b", "c" -> ""
        if (acc) note.addModifier(new Accidental(acc), i)
      })
      if (group.length > 0) note.setStyle({ fillStyle: color, strokeStyle: color })

      const voice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables([note])
      new Formatter().joinVoices([voice]).format([voice], STAVE_WIDTH - 60)
      voice.draw(ctx, stave)
    }

    if (label) {
      ctx.save()
      ctx.setFont('sans-serif', 13)
      ctx.fillText(label, 12, HEIGHT - 6)
      ctx.restore()
    }
  }, [notes.join(','), spelling, color, label])

  return <div className="staff" ref={hostRef} />
}
