import { describe, expect, it } from 'vitest'
import { DEFAULT_RAMP, accelCurve, bpmAtBeat, newRamp, nextRamp, rampTargets } from './ramp'

describe('nextRamp', () => {
  it('holds the same BPM until the clean streak closes', () => {
    const a = nextRamp(newRamp(120), true)
    expect(a.event).toBe('hold')
    expect(a.state.bpm).toBe(120)
    expect(a.state.cleanStreak).toBe(1)
  })

  it('climbs one step of 10 after two clean reps', () => {
    let s = newRamp(120)
    s = nextRamp(s, true).state
    const b = nextRamp(s, true)
    expect(b.event).toBe('up')
    expect(b.state.bpm).toBe(130)
    expect(b.state.cleanStreak).toBe(0)
  })

  it('one failure in the middle resets the streak', () => {
    let s = newRamp(120)
    s = nextRamp(s, true).state
    s = nextRamp(s, false).state
    expect(s.cleanStreak).toBe(0)
    expect(nextRamp(s, true).state.bpm).toBe(120) // volta a precisar de duas
  })

  it('drops the same step of 10 after two failures', () => {
    let s = newRamp(120)
    s = nextRamp(s, false).state
    const b = nextRamp(s, false)
    expect(b.event).toBe('down')
    expect(b.state.bpm).toBe(110)
  })

  it('climbs and drops on the same grid: failing undoes exactly the last climb', () => {
    let s = newRamp(120)
    s = nextRamp(s, true).state
    s = nextRamp(s, true).state // climbs to 130
    expect(s.bpm).toBe(130)
    s = nextRamp(s, false).state
    s = nextRamp(s, false).state // drops back to 120
    expect(s.bpm).toBe(120)
  })

  it('keeps the highest BPM that passed, not the current one', () => {
    let s = newRamp(120)
    s = nextRamp(s, true).state
    s = nextRamp(s, true).state // climbs to 130
    expect(s.bestCleanBpm).toBe(120)
    s = nextRamp(s, false).state
    s = nextRamp(s, false).state // drops to 120
    expect(s.bestCleanBpm).toBe(120) // the record does not regress
  })

  it('respects the ceiling and the floor', () => {
    let s = { ...newRamp(DEFAULT_RAMP.maxBpm), cleanStreak: 1 }
    expect(nextRamp(s, true).state.bpm).toBe(DEFAULT_RAMP.maxBpm)
    s = { ...newRamp(DEFAULT_RAMP.minBpm), failStreak: 1 }
    expect(nextRamp(s, false).state.bpm).toBe(DEFAULT_RAMP.minBpm)
  })
})

describe('accelCurve', () => {
  it('with start equal to end it becomes the constant grid', () => {
    const curve = accelCurve(120, 120, 16)
    expect(curve(0)).toBe(0)
    expect(curve(4)).toBeCloseTo(2000, 6) // 4 tempos a 120 = 2s
    expect(curve(2.5)).toBeCloseTo(1250, 6)
  })

  it('accelerates: each beat lasts less than the previous one', () => {
    const curve = accelCurve(60, 180, 8)
    const duracoes = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => curve(i + 1) - curve(i))
    for (let i = 1; i < duracoes.length; i++) {
      expect(duracoes[i]).toBeLessThan(duracoes[i - 1])
    }
  })

  it('matches the transport step by step, which schedules beat by beat', () => {
    // The transport does nextAudio += 60/bpm with the bpm of that beat. The curve
    // has to give exactly the same, or grading reports an error where there is none.
    const start = 80
    const end = 160
    const total = 12
    const curve = accelCurve(start, end, total)
    let t = 0
    for (let i = 0; i < total; i++) {
      expect(curve(i)).toBeCloseTo(t, 6)
      t += 60000 / bpmAtBeat(start, end, total, i)
    }
  })

  it('is monotonic and does not blow up past the end', () => {
    const curve = accelCurve(90, 150, 8)
    expect(curve(-1)).toBe(0)
    expect(curve(20)).toBeGreaterThan(curve(8))
    expect(Number.isFinite(curve(20))).toBe(true)
  })
})

describe('bpmAtBeat', () => {
  it('interpolates from start to target and saturates', () => {
    expect(bpmAtBeat(100, 200, 10, 0)).toBe(100)
    expect(bpmAtBeat(100, 200, 10, 5)).toBe(150)
    expect(bpmAtBeat(100, 200, 10, 10)).toBe(200)
    expect(bpmAtBeat(100, 200, 10, 99)).toBe(200)
  })
})

describe('rampTargets', () => {
  it('says where it is going before it happens, in both directions', () => {
    const t = rampTargets(newRamp(120))
    expect(t.up).toBe(130)
    expect(t.down).toBe(110)
  })

  it('saturates at the ceiling and the floor', () => {
    expect(rampTargets(newRamp(DEFAULT_RAMP.maxBpm)).up).toBe(DEFAULT_RAMP.maxBpm)
    expect(rampTargets(newRamp(DEFAULT_RAMP.minBpm)).down).toBe(DEFAULT_RAMP.minBpm)
  })
})

describe('a lowered floor lets the ladder go under the default 40', () => {
  it('drops past 40 when the config says so', () => {
    const slow = { ...DEFAULT_RAMP, minBpm: 20 }
    let s = newRamp(30)
    s = nextRamp(s, false, slow).state
    s = nextRamp(s, false, slow).state
    expect(s.bpm).toBe(20)
  })

  it('still saturates at whatever floor was given', () => {
    const slow = { ...DEFAULT_RAMP, minBpm: 20 }
    let s = newRamp(20)
    s = nextRamp(s, false, slow).state
    s = nextRamp(s, false, slow).state
    expect(s.bpm).toBe(20)
    expect(rampTargets(newRamp(20), slow).down).toBe(20)
  })
})

describe('how many clean reps to climb', () => {
  const withReps = (repsToAdvance: number) => ({ ...DEFAULT_RAMP, repsToAdvance })

  it('with 1, it climbs as soon as you nail one', () => {
    const r = nextRamp(newRamp(100), true, withReps(1))
    expect(r.event).toBe('up')
    expect(r.state.bpm).toBe(110)
  })

  it('with 3, it holds two and climbs on the third', () => {
    let s = newRamp(100)
    s = nextRamp(s, true, withReps(3)).state
    s = nextRamp(s, true, withReps(3)).state
    expect(s.bpm).toBe(100)
    expect(s.cleanStreak).toBe(2)
    const r = nextRamp(s, true, withReps(3))
    expect(r.event).toBe('up')
    expect(r.state.bpm).toBe(110)
  })

  it('one bad rep resets the count, at any setting', () => {
    let s = newRamp(100)
    s = nextRamp(s, true, withReps(3)).state
    s = nextRamp(s, true, withReps(3)).state
    s = nextRamp(s, false, withReps(3)).state
    expect(s.cleanStreak).toBe(0)
    expect(s.bpm).toBe(100) // ainda nao desceu: precisa de duas falhas
  })
})
