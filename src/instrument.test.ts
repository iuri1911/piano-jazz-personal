import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SOUND,
  leadCutoff,
  midiToFreq,
  partialFreq,
  partialShape,
  pianoDecay,
  velocityToGain,
} from './instrument'

const A4 = 69
const C4 = 60
const A0 = 21
const C8 = 108

describe('pitch', () => {
  it('anchors on A4 = 440Hz', () => {
    expect(midiToFreq(A4)).toBeCloseTo(440, 6)
  })

  it('an octave doubles', () => {
    expect(midiToFreq(A4 + 12)).toBeCloseTo(880, 6)
    expect(midiToFreq(A4 - 12)).toBeCloseTo(220, 6)
  })
})

describe('velocity', () => {
  it('rises with how hard the key is struck', () => {
    expect(velocityToGain(100)).toBeGreaterThan(velocityToGain(40))
  })

  it('keeps a feather touch audible', () => {
    expect(velocityToGain(1)).toBeGreaterThan(0.05)
  })

  it('stays inside the range even for junk input', () => {
    for (const v of [-20, 0, 64, 127, 999]) {
      expect(velocityToGain(v)).toBeGreaterThan(0)
      expect(velocityToGain(v)).toBeLessThanOrEqual(1)
    }
  })

  it('is curved, not linear — mezzo sits below the midpoint', () => {
    const mid = velocityToGain(64)
    const linear = (velocityToGain(0) + velocityToGain(127)) / 2
    expect(mid).toBeLessThan(linear)
  })
})

describe('lead filter', () => {
  it('opens as the pitch rises', () => {
    expect(leadCutoff(C4)).toBeGreaterThan(leadCutoff(C4 - 24))
  })

  // The whole reason this function exists: the voice plays under an exercise for
  // a long stretch, and unclamped pitch tracking is what makes that unbearable.
  it('never gets shrill, however high the note', () => {
    for (let midi = A0; midi <= C8; midi++) {
      expect(leadCutoff(midi)).toBeLessThanOrEqual(2600)
    }
  })

  it('stays open enough for the lowest notes to be audible', () => {
    expect(leadCutoff(A0)).toBeGreaterThanOrEqual(320)
  })
})

describe('piano decay', () => {
  it('rings far longer in the bass than in the treble', () => {
    expect(pianoDecay(A0)).toBeGreaterThan(pianoDecay(C8) * 4)
  })

  it('falls monotonically across the keyboard', () => {
    for (let midi = A0; midi < C8; midi++) {
      expect(pianoDecay(midi + 1)).toBeLessThanOrEqual(pianoDecay(midi))
    }
  })

  it('stays within sane bounds', () => {
    for (let midi = A0; midi <= C8; midi++) {
      expect(pianoDecay(midi)).toBeGreaterThanOrEqual(0.7)
      expect(pianoDecay(midi)).toBeLessThanOrEqual(12)
    }
  })
})

describe('piano partials', () => {
  // Exactly, not approximately: the first partial IS the perceived pitch, so any
  // drift here detunes every note the instrument plays.
  it('the first partial is the fundamental', () => {
    expect(partialFreq(440, 1)).toBeCloseTo(440, 9)
    expect(partialFreq(261.63, 1)).toBeCloseTo(261.63, 9)
  })

  // Stiff strings stretch the series: partial n sits ABOVE n x fundamental.
  it('stretches sharp of the exact harmonic series', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      expect(partialFreq(440, n)).toBeGreaterThan(440 * n)
    }
  })

  it('the stretch grows with the partial number', () => {
    const drift = (n: number) => partialFreq(440, n) / (440 * n)
    expect(drift(6)).toBeGreaterThan(drift(2))
  })

  it('upper partials are quieter', () => {
    for (let n = 1; n < 6; n++) {
      expect(partialShape(n + 1).gain).toBeLessThan(partialShape(n).gain)
    }
  })

  // This is what separates a piano from an organ with a volume pedal.
  it('upper partials die faster than the fundamental', () => {
    expect(partialShape(1).decayScale).toBeCloseTo(1, 6)
    for (let n = 1; n < 6; n++) {
      expect(partialShape(n + 1).decayScale).toBeLessThan(partialShape(n).decayScale)
    }
  })
})

describe('defaults', () => {
  it('ships with a voice on, so the app makes sound out of the box', () => {
    expect(DEFAULT_SOUND.voice).toBe('lead')
    expect(DEFAULT_SOUND.level).toBeGreaterThan(0)
  })
})
