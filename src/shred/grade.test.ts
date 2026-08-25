import { describe, expect, it } from 'vitest'
import { expandPattern, type PatternSpec } from './pattern'
import { grade, groupExpected, type GradeConfig, type PlayedNote } from './grade'

const RANGE = { low: 36, high: 84 }
const BPM = 120
const ORIGIN = 10_000

const spec: PatternSpec = {
  source: { kind: 'scale', name: 'major' },
  motion: { kind: 'run' },
  hands: { kind: 'rh' },
  octaves: 2,
  direction: 'up',
  subdivision: 4,
  anchorC: 48,
}

const expected = expandPattern(spec, 0, RANGE).notes // 15 sixteenths climbing

const config: GradeConfig = {
  bpm: BPM,
  originMs: ORIGIN,
  maxErrorRate: 0.02,
  maxIoiCv: 0.08,
  maxBpmDeviation: 0.03,
}

/** Execucao perfeita: cada nota exatamente na sua casa do grid. */
function perfect(offset: (i: number) => number = () => 0): PlayedNote[] {
  const beatMs = 60000 / BPM
  return expected.map((e, i) => ({
    midi: e.midi,
    velocity: 80,
    onTime: ORIGIN + e.beat * beatMs + offset(i),
  }))
}

describe('groupExpected', () => {
  it('one group per onset instant', () => {
    expect(groupExpected(expected)).toHaveLength(15)
  })
})

describe('grade', () => {
  it('a perfect performance passes', () => {
    const g = grade(expected, perfect(), config)
    expect(g.missed).toBe(0)
    expect(g.extra).toBe(0)
    expect(g.accuracy).toBe(1)
    expect(g.ioiCv).toBeCloseTo(0, 6)
    expect(Math.round(g.effectiveBpm)).toBe(BPM)
    expect(g.gridMadMs).toBeCloseTo(0, 6)
    expect(g.passed).toBe(true)
    expect(g.reasons).toEqual([])
  })

  it('tolerates small human jitter without failing', () => {
    // Small deviation with no pattern, up to 4ms on a 125ms sixteenth.
    const jitter = [0, 3, -2, 4, -3, 1, 2, -4, 0, 3, -1, 2, -3, 1, 0]
    const g = grade(expected, perfect((i) => jitter[i]), config)
    expect(g.ioiCv).toBeLessThan(config.maxIoiCv)
    expect(g.passed).toBe(true)
  })

  it('catches a systematic swing that random jitter does not trigger', () => {
    // Alternating +-6ms is not noise: it is a limp. It becomes 12ms of IOI
    // oscillation, ~10% of the sixteenth, and it is audible. It has to fail.
    const g = grade(expected, perfect((i) => (i % 2 ? 6 : -6)), config)
    expect(g.ioiCv).toBeGreaterThan(config.maxIoiCv)
    expect(g.passed).toBe(false)
  })

  it('a dropped note counts as missing and does not cascade', () => {
    const played = perfect().filter((_, i) => i !== 5)
    const g = grade(expected, played, config)
    expect(g.missed).toBe(1)
    expect(g.extra).toBe(0)
    expect(g.status[5]).toBe('missed')
    // The ones after keep matching: the alignment found the line again.
    expect(g.status.filter((s) => s === 'matched')).toHaveLength(14)
    // One dropped note fits the budget: demanding a perfect performance on a
    // 15-note rep is not practice.
    expect(g.passed).toBe(true)
  })

  it('two dropped notes already blow the budget', () => {
    const played = perfect().filter((_, i) => i !== 5 && i !== 9)
    const g = grade(expected, played, config)
    expect(g.missed).toBe(2)
    expect(g.passed).toBe(false)
  })

  it('an extra note counts as extra and does not cascade', () => {
    const played = perfect()
    played.splice(6, 0, { midi: 61, velocity: 80, onTime: played[5].onTime + 60 })
    const g = grade(expected, played, config)
    expect(g.extra).toBe(1)
    expect(g.missed).toBe(0)
    expect(g.status.every((s) => s === 'matched')).toBe(true)
  })

  it('a swapped note gives one missing and one extra, the rest intact', () => {
    const played = perfect()
    played[7] = { ...played[7], midi: played[7].midi + 1 }
    const g = grade(expected, played, config)
    expect(g.missed).toBe(1)
    expect(g.extra).toBe(1)
    expect(g.status[7]).toBe('missed')
    expect(g.status.filter((s) => s === 'matched')).toHaveLength(14)
  })

  it('even but 20% slower fails on tempo, not on evenness', () => {
    const beatMs = 60000 / BPM
    const played = expected.map((e) => ({
      midi: e.midi,
      velocity: 80,
      onTime: ORIGIN + e.beat * beatMs * 1.2,
    }))
    const g = grade(expected, played, config)
    expect(g.ioiCv).toBeCloseTo(0, 6) // even, just slow
    expect(Math.round(g.effectiveBpm)).toBe(100)
    expect(g.passed).toBe(false)
    expect(g.reasons.join(' ')).toMatch(/tempo/)
  })

  it('at the right tempo but sloppy fails on evenness', () => {
    // Limping: one note sticks to the previous, the next stretches to compensate.
    const g = grade(expected, perfect((i) => (i % 2 ? -40 : 0)), config)
    expect(g.ioiCv).toBeGreaterThan(config.maxIoiCv)
    expect(Math.abs(g.effectiveBpm - BPM) / BPM).toBeLessThan(config.maxBpmDeviation)
    expect(g.passed).toBe(false)
    expect(g.reasons.join(' ')).toMatch(/uneven/)
  })

  it('points out which note drags', () => {
    // Only note 9 arrives 45ms late: the deviation has to show up on it.
    const g = grade(expected, perfect((i) => (i === 9 ? 45 : 0)), config)
    const dev = g.perGroupDevMs
    expect(dev[9]).toBeGreaterThan(30)
    // And the next one shows up "early", because the gap shortened.
    expect(dev[10]).toBeLessThan(-30)
    expect(dev[3] ?? 0).toBeLessThan(15)
  })

  it('does not demand an order between notes of the same group', () => {
    const unisono = expandPattern({ ...spec, hands: { kind: 'unison', octaveGap: 1 } }, 0, RANGE)
    const beatMs = 60000 / BPM
    // The left hand arrives 8ms after the right, and MIDI delivers them out of order.
    const played: PlayedNote[] = unisono.notes.map((e) => ({
      midi: e.midi,
      velocity: 80,
      onTime: ORIGIN + e.beat * beatMs + (e.hand === 'l' ? 8 : 0),
    }))
    const g = grade(unisono.notes, played, config)
    expect(g.missed).toBe(0)
    expect(g.extra).toBe(0)
    expect(g.handSpreadMs).toBeCloseTo(8, 6)
    expect(g.passed).toBe(true)
  })

  it('does not pretend to measure evenness when the onset chain is too short', () => {
    // Enough notes to count as an attempt, but in two loose pieces: only 2 chained
    // intervals are left, and 2 make no average at all.
    const played = perfect().filter((_, i) => [0, 1, 4, 5].includes(i))
    const g = grade(expected, played, config)
    expect(g.attempted).toBe(true)
    expect(g.reasons.join(' ')).toMatch(/too few notes/)
  })

  it('measures attack unevenness without failing you for it', () => {
    const played = perfect().map((n, i) => ({ ...n, velocity: i % 4 === 3 ? 40 : 100 }))
    const g = grade(expected, played, config)
    expect(g.velocityStdev).toBeGreaterThan(20)
    expect(g.passed).toBe(true) // diagnosis, not a gate
  })

  it('does not choke with nothing played', () => {
    const g = grade(expected, [], config)
    expect(g.missed).toBe(15)
    expect(g.accuracy).toBe(0)
    expect(g.passed).toBe(false)
    expect(Number.isFinite(g.ioiCv)).toBe(true)
  })
})

describe('permissiveness on note entry', () => {
  it('one slip on a short rep does not fail you', () => {
    // 15 notes: 3% rounded gives 0 if you truncate. The budget has a floor of 1,
    // otherwise the exercise demands a perfect performance and becomes a lottery.
    const played = perfect()
    played[6] = { ...played[6], midi: played[6].midi + 1 }
    const g = grade(expected, played, { ...config, maxErrorRate: 0.03 })
    expect(g.missed + g.extra).toBe(2)
    // It still fails with two (one missing + one extra), but merely dropping one
    // note passes:
    const semUma = perfect().filter((_, i) => i !== 6)
    expect(grade(expected, semUma, { ...config, maxErrorRate: 0.03 }).passed).toBe(true)
  })

  it('the error budget is never zero, however small the shape', () => {
    // 15 notes at 3% would round to 0. The floor of 1 has to show up in the limit.
    const played = perfect()
    played[3] = { ...played[3], midi: played[3].midi + 1 }
    played[11] = { ...played[11], midi: played[11].midi + 1 }
    const g = grade(expected, played, { ...config, maxErrorRate: 0.03 })
    expect(g.attempted).toBe(true)
    expect(g.reasons.join(' ')).toMatch(/limit 1/)
  })
})

describe('detects the wrong octave', () => {
  it('everything an octave down becomes an explanation, not raw error', () => {
    const played = perfect().map((n) => ({ ...n, midi: n.midi - 12 }))
    const g = grade(expected, played, config)
    expect(g.transposeHint).toBe(-12)
    expect(g.reasons.join(' ')).toMatch(/1 octave down/)
  })

  it('everything 2 semitones up as well', () => {
    const played = perfect().map((n) => ({ ...n, midi: n.midi + 2 }))
    expect(grade(expected, played, config).transposeHint).toBe(2)
  })

  it('does not invent a transposition when the errors are scattered', () => {
    const played = perfect()
    played[3] = { ...played[3], midi: played[3].midi + 1 }
    played[9] = { ...played[9], midi: played[9].midi + 7 }
    expect(grade(expected, played, config).transposeHint).toBeNull()
  })

  it('does not report a transposition when the note count does not match', () => {
    const played = perfect().slice(0, 10).map((n) => ({ ...n, midi: n.midi - 12 }))
    expect(grade(expected, played, config).transposeHint).toBeNull()
  })

  it('lists what was missing and what was extra', () => {
    const played = perfect().filter((_, i) => i !== 4)
    const g = grade(expected, played, config)
    expect(g.missedNotes).toEqual([expected[4].midi])
    expect(g.extraNotes).toEqual([])
  })
})

describe('rep with nothing played', () => {
  it('playing nothing is not a performance failure', () => {
    const g = grade(expected, [], config)
    expect(g.attempted).toBe(false)
    expect(g.reasons).toEqual(['rep with nothing played'])
    expect(g.passed).toBe(false)
  })

  it('two loose notes still count as nothing played', () => {
    expect(grade(expected, perfect().slice(0, 2), config).attempted).toBe(false)
  })

  it('from a quarter of the shape on it is a real attempt', () => {
    const g = grade(expected, perfect().slice(0, 8), config)
    expect(g.attempted).toBe(true)
    expect(g.reasons.join(' ')).toMatch(/error/) // now it does fail for what was missing
  })

  it('a complete performance is always an attempt', () => {
    expect(grade(expected, perfect(), config).attempted).toBe(true)
  })
})

describe('finding the line again after a stumble', () => {
  it('skipping six notes in the middle does not condemn the rest of the rep', () => {
    // Plays 0-3, slips and skips 4-9, comes back cleanly at 10.
    const played = perfect().filter((_, i) => i < 4 || i >= 10)
    const g = grade(expected, played, config)
    // 6 skipped + 1 spent noticing the line was lost: the resync only opens after
    // two unmatched onsets, otherwise one stray wrong note would send the cursor
    // jumping on its own.
    expect(g.missed).toBe(7)
    expect(g.extra).toBe(1)
    // What matters: from note 11 on it matches again, instead of everything
    // turning into extra until the end of the rep.
    expect(g.status.slice(11).every((s) => s === 'matched')).toBe(true)
  })

  it('one isolated wrong note does not send the cursor jumping ahead', () => {
    const played = perfect()
    played[5] = { ...played[5], midi: 127 } // a pitch that does not exist in the shape
    const g = grade(expected, played, config)
    expect(g.missed).toBe(1)
    expect(g.extra).toBe(1)
    expect(g.status.filter((s) => s === 'matched')).toHaveLength(14)
  })
})
