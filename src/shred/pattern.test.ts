import { describe, expect, it } from 'vitest'
import {
  applyHandMode,
  degreeSemitone,
  degreeSequence,
  expandPattern,
  sourceSteps,
  type PatternSpec,
} from './pattern'

const RANGE = { low: 36, high: 84 } // 49 keys, C2..C6

describe('sourceSteps', () => {
  it('reads a scale from tonal', () => {
    expect(sourceSteps({ kind: 'scale', name: 'minor pentatonic' })).toEqual([0, 3, 5, 7, 10])
    expect(sourceSteps({ kind: 'scale', name: 'major' })).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(sourceSteps({ kind: 'scale', name: 'whole tone' })).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('reads a chord from tonal', () => {
    expect(sourceSteps({ kind: 'chord', name: 'maj7' })).toEqual([0, 4, 7, 11])
    expect(sourceSteps({ kind: 'chord', name: 'dim7' })).toEqual([0, 3, 6, 9])
  })

  it('accepts hand-written semitones', () => {
    expect(sourceSteps({ kind: 'semitones', steps: [0, 1, 2] })).toEqual([0, 1, 2])
  })
})

describe('degreeSemitone', () => {
  it('crosses an octave when the degree runs past the scale', () => {
    const pent = [0, 3, 5, 7, 10]
    expect(degreeSemitone(pent, 0)).toBe(0)
    expect(degreeSemitone(pent, 4)).toBe(10)
    expect(degreeSemitone(pent, 5)).toBe(12) // tonic one octave up
    expect(degreeSemitone(pent, 6)).toBe(15)
  })
})

describe('degreeSequence', () => {
  it('run is the plain scale', () => {
    expect(degreeSequence({ kind: 'run' }, 4)).toEqual([0, 1, 2, 3, 4])
  })

  it('groups of 4 move one at a time', () => {
    expect(degreeSequence({ kind: 'seq', group: 4, step: 1 }, 5)).toEqual([
      0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5,
    ])
  })

  it('skip 2 gives thirds', () => {
    expect(degreeSequence({ kind: 'skip', interval: 2 }, 4)).toEqual([0, 2, 1, 3, 2, 4])
  })

  it('pedal interleaves and does not repeat the pedal note itself', () => {
    expect(degreeSequence({ kind: 'pedal', pedalIndex: 4 }, 4)).toEqual([0, 4, 1, 4, 2, 4, 3, 4])
  })
})

const base: PatternSpec = {
  source: { kind: 'scale', name: 'major' },
  motion: { kind: 'run' },
  hands: { kind: 'rh' },
  octaves: 1,
  direction: 'up',
  subdivision: 4,
  anchorC: 48,
}

describe('expandPattern', () => {
  it('C major scale, one octave, climbs C3 to C4', () => {
    const { notes, groups } = expandPattern(base, 0, RANGE)
    expect(notes.map((n) => n.midi)).toEqual([48, 50, 52, 53, 55, 57, 59, 60])
    expect(groups).toBe(8)
  })

  it('positions in time by the subdivision', () => {
    const { notes, beats } = expandPattern(base, 0, RANGE)
    expect(notes.map((n) => n.beat)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75])
    expect(beats).toBe(2) // 8 sixteenths = 2 beats
  })

  it('updown repeats neither the top nor the bottom', () => {
    // The exercise runs in a loop: the last note of the descent joins the first of
    // the next ascent, so repeating the tonic at both ends would sound doubled.
    const { notes } = expandPattern({ ...base, direction: 'updown' }, 0, RANGE)
    expect(notes.map((n) => n.midi)).toEqual([
      48, 50, 52, 53, 55, 57, 59, 60, 59, 57, 55, 53, 52, 50,
    ])
  })

  it('the descent is the mirror, not the figure played backwards', () => {
    // Hanon 1: figure [0,2,3,4,5,4,3,2] climbing degree by degree. The real
    // descent is the same figure reflected — it starts at the top and comes down.
    // The retrograde would start on the penultimate note of the ascent, which is a
    // different exercise.
    const hanon: PatternSpec = {
      ...base,
      motion: { kind: 'shape', degrees: [0, 2, 3, 4, 5, 4, 3, 2], step: 1 },
      octaves: 1,
      direction: 'updown',
    }
    const graus = expandPattern(hanon, 0, RANGE).notes.map((n) => n.midi)
    const subida = expandPattern({ ...hanon, direction: 'up' }, 0, RANGE).notes.map((n) => n.midi)
    const descida = graus.slice(subida.length)
    // First note of the descent = the top of the scale (C one octave up), not the
    // penultimate note of the ascent.
    expect(descida[0]).toBe(60)
    expect(descida[0]).not.toBe(subida[subida.length - 2])
  })

  it('a symmetric shape gives the same mirror and retrograde', () => {
    // On a plain scale the two coincide — the change only shows up on an
    // asymmetric figure, so nothing that already worked changes shape.
    const { notes } = expandPattern({ ...base, direction: 'updown' }, 0, RANGE)
    const midi = notes.map((n) => n.midi)
    const ascent = midi.slice(0, 8)
    expect(midi.slice(8)).toEqual([...ascent].reverse().slice(1, -1))
  })

  it('preserves the interval shape in all 12 keys', () => {
    const shape = (pc: number) => {
      const notes = expandPattern(base, pc, RANGE).notes.map((n) => n.midi)
      return notes.map((n) => n - notes[0])
    }
    const reference = shape(0)
    for (let pc = 1; pc < 12; pc++) expect(shape(pc)).toEqual(reference)
  })

  it('unison puts both hands on the same beat, in the same group', () => {
    const { notes } = expandPattern({ ...base, hands: { kind: 'unison', octaveGap: 1 } }, 0, RANGE)
    const first = notes.filter((n) => n.group === 0)
    expect(first).toHaveLength(2)
    expect(first.map((n) => n.midi).sort((a, b) => a - b)).toEqual([36, 48])
    expect(first.every((n) => n.beat === 0)).toBe(true)
  })

  it('alternate swaps the hand and drops the left an octave', () => {
    const { notes } = expandPattern(
      { ...base, hands: { kind: 'alternate', unit: 1, lhOctaveShift: -1 } },
      0,
      RANGE,
    )
    expect(notes.map((n) => n.hand)).toEqual(['r', 'l', 'r', 'l', 'r', 'l', 'r', 'l'])
    expect(notes[1].midi).toBe(50 - 12)
  })

  it('ostinato runs the left loop over the right hand line', () => {
    const { notes } = expandPattern(
      {
        ...base,
        hands: { kind: 'ostinato', degrees: [0, 4], subdivision: 1, octaveShift: -1 },
      },
      0,
      RANGE,
    )
    const lh = notes.filter((n) => n.hand === 'l')
    expect(lh.map((n) => n.midi)).toEqual([36, 43]) // C2 and G2, one per beat over 2 beats
    expect(lh.map((n) => n.beat)).toEqual([0, 1])
    // The first left hand note lands together with the first right hand note.
    expect(notes.filter((n) => n.group === 0)).toHaveLength(2)
  })

  it('transposes down when it runs off the top of the keyboard', () => {
    const high: PatternSpec = { ...base, anchorC: 84 }
    const { notes } = expandPattern(high, 11, RANGE)
    expect(Math.max(...notes.map((n) => n.midi))).toBeLessThanOrEqual(RANGE.high)
    expect(Math.min(...notes.map((n) => n.midi))).toBeGreaterThanOrEqual(RANGE.low)
  })

  it('trims an octave and warns when the pattern does not fit', () => {
    const wide: PatternSpec = { ...base, octaves: 4, anchorC: 48 }
    const r = expandPattern(wide, 0, { low: 48, high: 72 })
    expect(r.warning).toMatch(/octave/)
    expect(Math.max(...r.notes.map((n) => n.midi))).toBeLessThanOrEqual(72)
  })
})

describe('degreeSequence shape', () => {
  it('repeats the shape climbing degree by degree', () => {
    // Hanon 1: climbs the 8-note figure one note at a time.
    expect(degreeSequence({ kind: 'shape', degrees: [0, 2, 3, 4], step: 1 }, 6)).toEqual([
      0, 2, 3, 4, 1, 3, 4, 5, 2, 4, 5, 6,
    ])
  })

  it('stops when the shape would pass the top', () => {
    expect(degreeSequence({ kind: 'shape', degrees: [0, 1], step: 1 }, 2)).toEqual([0, 1, 1, 2])
  })

  it('grouping by 5 over a subdivision of 4 displaces the accent', () => {
    const seq = degreeSequence({ kind: 'shape', degrees: [0, 1, 2, 3, 4], step: 1 }, 9)
    // 5 notes per group against 4 per beat: the group onset walks through the bar.
    expect(seq.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 1, 2, 3, 4, 5])
    expect(seq.length % 5).toBe(0)
  })
})

describe('reps', () => {
  it('runs the whole shape N times in a row', () => {
    const spec: PatternSpec = {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'literal', degrees: [0, 1, 2] },
      hands: { kind: 'rh' },
      octaves: 1,
      direction: 'up',
      subdivision: 4,
      anchorC: 48,
      reps: 3,
    }
    const { notes } = expandPattern(spec, 0, RANGE)
    expect(notes.map((n) => n.midi)).toEqual([48, 50, 52, 48, 50, 52, 48, 50, 52])
    // Time keeps running: the second pass does not go back to beat 0.
    expect(notes.map((n) => n.beat)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])
  })
})

describe('shape with a zero step', () => {
  it('does not become an infinite loop', () => {
    expect(degreeSequence({ kind: 'shape', degrees: [0, 1], step: 0 }, 8)).toEqual([0, 1])
  })
})

describe('applyHandMode', () => {
  const base: PatternSpec = {
    source: { kind: 'scale', name: 'major' },
    motion: { kind: 'run' },
    hands: { kind: 'unison', octaveGap: 1 },
    octaves: 1,
    direction: 'up',
    subdivision: 4,
    anchorC: 60,
  }

  it('as-is does not touch the arrangement of the exercise', () => {
    expect(applyHandMode(base, 'as-is')).toBe(base)
  })

  it('right hand only stays in the anchored octave', () => {
    const { notes } = expandPattern(applyHandMode(base, 'rh'), 0, RANGE)
    expect(notes.every((n) => n.hand === 'r')).toBe(true)
    expect(notes[0].midi).toBe(60)
  })

  it('left hand only drops an octave', () => {
    const { notes } = expandPattern(applyHandMode(base, 'lh'), 0, RANGE)
    expect(notes.every((n) => n.hand === 'l')).toBe(true)
    expect(notes[0].midi).toBe(48)
  })

  it('both doubles the note count without changing the onsets', () => {
    const one = expandPattern(applyHandMode(base, 'rh'), 0, RANGE)
    const two = expandPattern(applyHandMode(base, 'both'), 0, RANGE)
    expect(two.notes).toHaveLength(one.notes.length * 2)
    expect(two.groups).toBe(one.groups) // same rhythm, just in octaves
    expect(two.beats).toBe(one.beats)
  })

  it('preserves shape, subdivision and fingering', () => {
    const withFinger: PatternSpec = {
      ...base,
      hands: { kind: 'alternate', unit: 1, lhOctaveShift: -1 },
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3, 4] },
    }
    const rh = applyHandMode(withFinger, 'rh')
    expect(rh.fingering).toBe(withFinger.fingering)
    expect(rh.motion).toBe(withFinger.motion)
    expect(rh.subdivision).toBe(withFinger.subdivision)
    const notes = expandPattern(rh, 0, RANGE).notes
    expect(notes[0].finger).toBe(1)
  })
})
