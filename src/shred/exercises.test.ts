import { describe, expect, it } from 'vitest'
import { EXERCISES, EXERCISE_BY_ID, LEVEL_TOLERANCE } from './exercises'
import { applyHandMode, expandPattern, sourceSteps } from './pattern'
import { grade } from './grade'

// A-49 range: 49 keys, C2..C6.
const RANGE = { low: 36, high: 84 }

describe('exercise table', () => {
  it('unique ids', () => {
    expect(EXERCISE_BY_ID.size).toBe(EXERCISES.length)
  })

  it('target tempo above the start and both plausible', () => {
    for (const e of EXERCISES) {
      expect(e.tempos.target, e.id).toBeGreaterThan(e.tempos.start)
      expect(e.tempos.start, e.id).toBeGreaterThanOrEqual(40)
      expect(e.tempos.target, e.id).toBeLessThanOrEqual(240)
    }
  })

  it('every exercise has a focus and a rationale written down', () => {
    for (const e of EXERCISES) {
      expect(e.focus.length, e.id).toBeGreaterThan(10)
      expect(e.note.length, e.id).toBeGreaterThan(60)
    }
  })
})

describe('expanding the library', () => {
  it('every exercise expands in all 12 keys inside the keyboard', () => {
    for (const e of EXERCISES) {
      for (let pc = 0; pc < 12; pc++) {
        const { notes, groups, beats } = expandPattern(e.pattern, pc, RANGE)
        expect(notes.length, `${e.id} em pc ${pc}`).toBeGreaterThan(6)
        expect(groups, `${e.id} em pc ${pc}`).toBeGreaterThan(4)
        expect(beats, `${e.id} em pc ${pc}`).toBeGreaterThan(0)
        for (const n of notes) {
          expect(n.midi, `${e.id} pc ${pc}: nota fora do teclado`).toBeGreaterThanOrEqual(RANGE.low)
          expect(n.midi, `${e.id} pc ${pc}: nota fora do teclado`).toBeLessThanOrEqual(RANGE.high)
        }
      }
    }
  })

  it('no exercise needs to trim an octave on the A-49', () => {
    for (const e of EXERCISES) {
      for (let pc = 0; pc < 12; pc++) {
        expect(expandPattern(e.pattern, pc, RANGE).warning, `${e.id} em pc ${pc}`).toBeUndefined()
      }
    }
  })

  it('a rep lasts between 1 and 16 bars at the starting tempo', () => {
    for (const e of EXERCISES) {
      const { beats } = expandPattern(e.pattern, 0, RANGE)
      const bars = beats / e.beatsPerBar
      expect(bars, `${e.id}: ${bars.toFixed(1)} compassos`).toBeGreaterThanOrEqual(1)
      expect(bars, `${e.id}: ${bars.toFixed(1)} compassos`).toBeLessThanOrEqual(16)
    }
  })

  it('the notes move forward in time and never go back', () => {
    for (const e of EXERCISES) {
      const { notes } = expandPattern(e.pattern, 0, RANGE)
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i].beat, e.id).toBeGreaterThanOrEqual(notes[i - 1].beat)
      }
    }
  })
})

describe('a perfect performance passes on every exercise', () => {
  it('no exercise is impossible to pass', () => {
    for (const e of EXERCISES) {
      const { notes } = expandPattern(e.pattern, 0, RANGE)
      const bpm = e.tempos.start
      const beatMs = 60000 / bpm
      const played = notes.map((n) => ({
        midi: n.midi,
        velocity: 80,
        onTime: 5000 + n.beat * beatMs,
      }))
      const tol = LEVEL_TOLERANCE[e.level]
      const g = grade(notes, played, {
        bpm,
        originMs: 5000,
        maxErrorRate: tol.maxErrorRate,
        maxIoiCv: tol.maxIoiCv,
        maxBpmDeviation: 0.03,
      })
      expect(g.reasons, e.id).toEqual([])
      expect(g.passed, e.id).toBe(true)
    }
  })
})

describe('musical details', () => {
  it('the bebop enclosure surrounds every note of the m7 arpeggio', () => {
    const ex = EXERCISE_BY_ID.get('bebop-enclosure')!
    const { notes } = expandPattern(ex.pattern, 0, RANGE)
    const rel = notes.slice(0, 12).map((n) => n.midi - notes[2].midi)
    // Targets at 0 (C), 3 (Eb), 7 (G), 10 (Bb), each preceded from above and below.
    expect(rel).toEqual([2, -1, 0, 5, 2, 3, 9, 6, 7, 12, 9, 10])
  })

  it('the diminished arpeggio repeats the same shape every 3 semitones', () => {
    const ex = EXERCISE_BY_ID.get('dim7-arpeggio')!
    const shape = (pc: number) => {
      const m = expandPattern(ex.pattern, pc, RANGE).notes.map((n) => n.midi)
      return m.map((n) => n - m[0])
    }
    expect(shape(3)).toEqual(shape(0))
    expect(shape(6)).toEqual(shape(0))
  })

  it('hand-to-hand octaves alternate the hands and separate them by an octave', () => {
    const ex = EXERCISE_BY_ID.get('hand-to-hand-octaves')!
    const { notes } = expandPattern(ex.pattern, 0, RANGE)
    expect(notes.slice(0, 4).map((n) => n.hand)).toEqual(['r', 'l', 'r', 'l'])
    expect(notes[0].midi - notes[1].midi).toBe(12)
  })

  it('the left hand ostinato lands on the beat while the right runs', () => {
    const ex = EXERCISE_BY_ID.get('ostinato-lick')!
    const { notes } = expandPattern(ex.pattern, 0, RANGE)
    const lh = notes.filter((n) => n.hand === 'l')
    const rh = notes.filter((n) => n.hand === 'r')
    expect(lh.every((n) => Number.isInteger(n.beat))).toBe(true) // left hand on the beat
    expect(rh.length).toBeGreaterThan(lh.length * 3) // right hand far denser
    expect(Math.max(...lh.map((n) => n.midi))).toBeLessThan(Math.min(...rh.map((n) => n.midi)))
  })

  it('the group of 5 displaces the accent against the beat', () => {
    const ex = EXERCISE_BY_ID.get('group5-over-4')!
    const { notes } = expandPattern(ex.pattern, 0, RANGE)
    // Onset of each group of 5, in beats: 0, 1.25, 2.5, 3.75 — never two in a row
    // at the same position within the beat.
    const onsets = [0, 5, 10, 15].map((i) => notes[i].beat % 1)
    expect(new Set(onsets).size).toBe(4)
  })
})

describe('the whole library in every hand arrangement', () => {
  const modes = ['as-is', 'rh', 'lh', 'both'] as const

  it('expands in all 12 keys without leaving the keyboard', () => {
    for (const e of EXERCISES) {
      for (const mode of modes) {
        const spec = applyHandMode(e.pattern, mode)
        for (let pc = 0; pc < 12; pc++) {
          const { notes } = expandPattern(spec, pc, RANGE)
          expect(notes.length, `${e.id}/${mode} pc ${pc}`).toBeGreaterThan(4)
          for (const n of notes) {
            expect(n.midi, `${e.id}/${mode} pc ${pc}`).toBeGreaterThanOrEqual(RANGE.low)
            expect(n.midi, `${e.id}/${mode} pc ${pc}`).toBeLessThanOrEqual(RANGE.high)
          }
        }
      }
    }
  })

  it('a single hand always fits, with no octave trimming', () => {
    for (const e of EXERCISES) {
      for (const mode of ['rh', 'lh'] as const) {
        for (let pc = 0; pc < 12; pc++) {
          const r = expandPattern(applyHandMode(e.pattern, mode), pc, RANGE)
          expect(r.warning, `${e.id}/${mode} pc ${pc}`).toBeUndefined()
        }
      }
    }
  })

  it('warns instead of blowing up when doubling does not fit 49 keys', () => {
    // 3 octaves doubled in octaves need 48 semitones, which is the whole A-49:
    // it would only fit in C. The fitter has to trim and say why.
    const dim = EXERCISE_BY_ID.get('dim7-arpeggio')!
    const inC = expandPattern(applyHandMode(dim.pattern, 'both'), 0, RANGE)
    expect(inC.warning).toBeUndefined()
    const inD = expandPattern(applyHandMode(dim.pattern, 'both'), 2, RANGE)
    expect(inD.warning).toMatch(/octave/)
    expect(Math.max(...inD.notes.map((n) => n.midi))).toBeLessThanOrEqual(RANGE.high)
    expect(Math.min(...inD.notes.map((n) => n.midi))).toBeGreaterThanOrEqual(RANGE.low)
  })

  it('a perfect performance passes in any arrangement', () => {
    for (const e of EXERCISES) {
      for (const mode of modes) {
        const { notes } = expandPattern(applyHandMode(e.pattern, mode), 0, RANGE)
        const bpm = e.tempos.start
        const beatMs = 60000 / bpm
        const played = notes.map((n) => ({
          midi: n.midi,
          velocity: 80,
          onTime: 5000 + n.beat * beatMs,
        }))
        const tol = LEVEL_TOLERANCE[e.level]
        const g = grade(notes, played, {
          bpm,
          originMs: 5000,
          maxErrorRate: tol.maxErrorRate,
          maxIoiCv: tol.maxIoiCv,
          maxBpmDeviation: 0.03,
        })
        expect(g.reasons, `${e.id}/${mode}`).toEqual([])
      }
    }
  })
})

describe('fingering', () => {
  const NO_FINGERING = new Set([
    'hand-to-hand-octaves', // alternating hands: the finger depends on where the hand arrives
    'toccata',
    'ostinato-lick',
    'bebop-enclosure',
  ])

  it('every exercise either carries fingering or says in its note why not', () => {
    for (const e of EXERCISES) {
      if (NO_FINGERING.has(e.id)) {
        expect(e.pattern.fingering, e.id).toBeUndefined()
        expect(e.note, e.id).toMatch(/No fingering on screen/)
      } else {
        expect(e.pattern.fingering, e.id).toBeDefined()
        expect(e.pattern.fingering!.fingers.length, e.id).toBeGreaterThan(0)
      }
    }
  })

  it('only uses fingers 1 to 5', () => {
    for (const e of EXERCISES) {
      const f = e.pattern.fingering
      if (!f) continue
      const perKey = Object.values(f.byRoot ?? {}).flatMap((k) => [
        ...(k?.fingers ?? []),
        ...(k?.lh ?? []),
      ])
      for (const d of [...f.fingers, ...(f.lh ?? []), ...perKey]) {
        expect(d, `${e.id}: finger ${d}`).toBeGreaterThanOrEqual(1)
        expect(d, `${e.id}: finger ${d}`).toBeLessThanOrEqual(5)
      }
    }
  })

  it('byDegree covers every degree of the source, or a degree would have no finger', () => {
    for (const e of EXERCISES) {
      const f = e.pattern.fingering
      if (!f || f.kind !== 'byDegree') continue
      const degrees = sourceSteps(e.pattern.source).length
      expect(
        f.fingers.length,
        `${e.id}: ${f.fingers.length} fingers for ${degrees} degrees`,
      ).toBe(degrees)
      if (f.lh) expect(f.lh.length, e.id).toBe(degrees)
      for (const [pc, k] of Object.entries(f.byRoot ?? {})) {
        if (k?.fingers) expect(k.fingers.length, `${e.id} em pc ${pc}`).toBe(degrees)
        if (k?.lh) expect(k.lh.length, `${e.id} em pc ${pc}`).toBe(degrees)
      }
    }
  })

  it('the piano roll note gets the finger, and each hand gets its own', () => {
    const five = EXERCISE_BY_ID.get('five-finger')!
    const { notes } = expandPattern(five.pattern, 0, RANGE)
    const first = notes.filter((n) => n.group === 0)
    expect(first.find((n) => n.hand === 'r')!.finger).toBe(1)
    expect(first.find((n) => n.hand === 'l')!.finger).toBe(5)
  })

  it('a left hand with no fingering of its own does not inherit the right hand number', () => {
    const pent = EXERCISE_BY_ID.get('pentatonic-box')! // only has a right hand list
    const { notes } = expandPattern(applyHandMode(pent.pattern, 'lh'), 0, RANGE)
    expect(notes.every((n) => n.hand === 'l')).toBe(true)
    expect(notes.every((n) => n.finger === undefined)).toBe(true)
  })

  it('major scale: right and left hand have different shapes', () => {
    const scale = EXERCISE_BY_ID.get('major-scale-2oct')!
    const rh = expandPattern(applyHandMode(scale.pattern, 'rh'), 0, RANGE).notes
    const lh = expandPattern(applyHandMode(scale.pattern, 'lh'), 0, RANGE).notes
    expect(rh.slice(0, 7).map((n) => n.finger)).toEqual([1, 2, 3, 1, 2, 3, 4])
    expect(lh.slice(0, 7).map((n) => n.finger)).toEqual([1, 4, 3, 2, 1, 3, 2])
  })

  it('major scale: the fingering changes with the key, F is not the same as C', () => {
    const scale = EXERCISE_BY_ID.get('major-scale-2oct')!
    const rhIn = (pc: number) =>
      expandPattern(applyHandMode(scale.pattern, 'rh'), pc, RANGE)
        .notes.slice(0, 7)
        .map((n) => n.finger)
    const lhIn = (pc: number) =>
      expandPattern(applyHandMode(scale.pattern, 'lh'), pc, RANGE)
        .notes.slice(0, 7)
        .map((n) => n.finger)

    // F: 4 on the Bb, thumb crossing one degree later than in C.
    expect(rhIn(5)).toEqual([1, 2, 3, 4, 1, 2, 3])
    expect(lhIn(5)).toEqual([1, 4, 3, 2, 1, 3, 2]) // left hand as in C
    // Bb starts on 4, Eb on 3, Ab on 3, Db on 2, Gb on 2: the thumb avoids the black key.
    expect(rhIn(10)).toEqual([4, 1, 2, 3, 1, 2, 3])
    expect(rhIn(3)).toEqual([3, 1, 2, 3, 4, 1, 2])
    expect(rhIn(1)).toEqual([2, 3, 1, 2, 3, 4, 1])
    // B: right hand as in C, left hand its own.
    expect(rhIn(11)).toEqual([1, 2, 3, 1, 2, 3, 4])
    expect(lhIn(11)).toEqual([1, 3, 2, 1, 4, 3, 2])
  })

  it('no key would be better served by starting the cycle elsewhere', () => {
    // The rule behind every fingering table: the thumb does not go on a black
    // key. Where one lands on black — Gb triad, Eb pentatonic — it is because
    // the shape has no white note to put it on, not because the table is stale.
    const white = new Set([0, 2, 4, 5, 7, 9, 11])
    const onWhite = (list: number[], steps: number[], pc: number) =>
      list.filter((f, d) => f === 1 && white.has((pc + steps[d]) % 12)).length

    for (const e of EXERCISES) {
      const f = e.pattern.fingering
      if (!f || f.kind !== 'byDegree') continue
      const steps = sourceSteps(e.pattern.source)
      for (let pc = 0; pc < 12; pc++) {
        const perKey = f.byRoot?.[pc]
        for (const list of [perKey?.fingers ?? f.fingers, perKey?.lh ?? f.lh]) {
          if (!list) continue
          const n = list.length
          const chosen = onWhite(list, steps, pc)
          for (let r = 1; r < n; r++) {
            const rotated = list.map((_, d) => list[(((d - r) % n) + n) % n])
            expect(
              onWhite(rotated, steps, pc),
              `${e.id} em pc ${pc}: ${rotated.join('')} puts the thumb on more white keys than ${list.join('')}`,
            ).toBeLessThanOrEqual(chosen)
          }
        }
      }
    }
  })

  it('arpeggios follow the published charts, key by key', () => {
    const at = (id: string, pc: number) => EXERCISE_BY_ID.get(id)!.pattern.fingering!.byRoot![pc]!

    // Major triad: the chart gives Bb right hand 4 1 2 and left hand 3 2 1.
    expect(at('broken-triad', 0)).toEqual({ fingers: [1, 2, 3], lh: [1, 4, 2] }) // C
    expect(at('broken-triad', 10)).toEqual({ fingers: [4, 1, 2], lh: [3, 2, 1] }) // Bb
    expect(at('broken-triad', 2).lh).toEqual([1, 3, 2]) // D: 3 on the black third

    // Seventh arpeggios: the thumb on the white note, and the two hands are
    // allowed to disagree about which one — Bbm7 has only the F.
    expect(at('seventh-arpeggio', 0)).toEqual({ fingers: [1, 2, 3, 4], lh: [1, 4, 3, 2] }) // Cm7
    expect(at('seventh-arpeggio', 10)).toEqual({ fingers: [3, 4, 1, 2], lh: [3, 2, 1, 4] }) // Bbm7
    expect(at('seventh-arpeggio', 1).lh).toEqual([4, 3, 2, 1]) // Dbm7: left thumb on the B
    expect(at('dim7-arpeggio', 1)).toEqual({ fingers: [4, 1, 2, 3], lh: [3, 2, 1, 4] }) // Db dim7
  })

  it('pentatonic, blues and whole tone rotate instead of keeping the C shape', () => {
    const at = (id: string, pc: number) => EXERCISE_BY_ID.get(id)!.pattern.fingering!.byRoot![pc]!
    expect(at('pentatonic-box', 0).fingers).toEqual([1, 2, 3, 1, 2]) // C: as written
    expect(at('pentatonic-box', 1).fingers).toEqual([2, 1, 2, 3, 1]) // Db: thumbs on E and B
    expect(at('blues-run', 2).fingers).toEqual([3, 1, 2, 3, 1, 2]) // D: thumbs on F and A
    expect(at('whole-tone', 1).fingers).toEqual([2, 3, 1, 2, 3, 1]) // Db: thumbs on F and B
  })

  it('the thumb never lands on a black key in the major scale', () => {
    const scale = EXERCISE_BY_ID.get('major-scale-2oct')!
    const black = new Set([1, 3, 6, 8, 10])
    for (let pc = 0; pc < 12; pc++) {
      for (const mode of ['rh', 'lh'] as const) {
        for (const n of expandPattern(applyHandMode(scale.pattern, mode), pc, RANGE).notes) {
          if (n.finger !== 1) continue
          expect(black.has(((n.midi % 12) + 12) % 12), `${mode} em pc ${pc}: ${n.midi}`).toBe(
            false,
          )
        }
      }
    }
  })
})
