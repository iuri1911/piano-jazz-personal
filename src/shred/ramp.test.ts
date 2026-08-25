import { describe, expect, it } from 'vitest'
import { DEFAULT_RAMP, accelCurve, bpmAtBeat, newRamp, nextRamp, rampTargets } from './ramp'

describe('nextRamp', () => {
  it('segura no mesmo BPM ate fechar a sequencia de limpas', () => {
    const a = nextRamp(newRamp(120), true)
    expect(a.event).toBe('hold')
    expect(a.state.bpm).toBe(120)
    expect(a.state.cleanStreak).toBe(1)
  })

  it('sobe um passo de 10 depois de duas limpas', () => {
    let s = newRamp(120)
    s = nextRamp(s, true).state
    const b = nextRamp(s, true)
    expect(b.event).toBe('up')
    expect(b.state.bpm).toBe(130)
    expect(b.state.cleanStreak).toBe(0)
  })

  it('uma falha no meio zera a sequencia', () => {
    let s = newRamp(120)
    s = nextRamp(s, true).state
    s = nextRamp(s, false).state
    expect(s.cleanStreak).toBe(0)
    expect(nextRamp(s, true).state.bpm).toBe(120) // volta a precisar de duas
  })

  it('desce o mesmo passo de 10 depois de duas falhas', () => {
    let s = newRamp(120)
    s = nextRamp(s, false).state
    const b = nextRamp(s, false)
    expect(b.event).toBe('down')
    expect(b.state.bpm).toBe(110)
  })

  it('sobe e desce na mesma grade: falhar desfaz exatamente a ultima subida', () => {
    let s = newRamp(120)
    s = nextRamp(s, true).state
    s = nextRamp(s, true).state // sobe pra 130
    expect(s.bpm).toBe(130)
    s = nextRamp(s, false).state
    s = nextRamp(s, false).state // desce de volta pra 120
    expect(s.bpm).toBe(120)
  })

  it('guarda o maior BPM aprovado, nao o atual', () => {
    let s = newRamp(120)
    s = nextRamp(s, true).state
    s = nextRamp(s, true).state // sobe pra 130
    expect(s.bestCleanBpm).toBe(120)
    s = nextRamp(s, false).state
    s = nextRamp(s, false).state // desce pra 120
    expect(s.bestCleanBpm).toBe(120) // o recorde nao regride
  })

  it('respeita o teto e o piso', () => {
    let s = { ...newRamp(DEFAULT_RAMP.maxBpm), cleanStreak: 1 }
    expect(nextRamp(s, true).state.bpm).toBe(DEFAULT_RAMP.maxBpm)
    s = { ...newRamp(DEFAULT_RAMP.minBpm), failStreak: 1 }
    expect(nextRamp(s, false).state.bpm).toBe(DEFAULT_RAMP.minBpm)
  })
})

describe('accelCurve', () => {
  it('com inicio igual ao fim vira a grade constante', () => {
    const curve = accelCurve(120, 120, 16)
    expect(curve(0)).toBe(0)
    expect(curve(4)).toBeCloseTo(2000, 6) // 4 tempos a 120 = 2s
    expect(curve(2.5)).toBeCloseTo(1250, 6)
  })

  it('acelera: cada tempo dura menos que o anterior', () => {
    const curve = accelCurve(60, 180, 8)
    const duracoes = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => curve(i + 1) - curve(i))
    for (let i = 1; i < duracoes.length; i++) {
      expect(duracoes[i]).toBeLessThan(duracoes[i - 1])
    }
  })

  it('bate com o passo a passo do transporte, que agenda tempo a tempo', () => {
    // O transporte faz nextAudio += 60/bpm com o bpm daquele tempo. A curva tem
    // que dar exatamente o mesmo, senao a avaliacao acusa erro onde nao tem.
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

  it('e monotona e nao explode depois do fim', () => {
    const curve = accelCurve(90, 150, 8)
    expect(curve(-1)).toBe(0)
    expect(curve(20)).toBeGreaterThan(curve(8))
    expect(Number.isFinite(curve(20))).toBe(true)
  })
})

describe('bpmAtBeat', () => {
  it('interpola do inicio ao alvo e satura', () => {
    expect(bpmAtBeat(100, 200, 10, 0)).toBe(100)
    expect(bpmAtBeat(100, 200, 10, 5)).toBe(150)
    expect(bpmAtBeat(100, 200, 10, 10)).toBe(200)
    expect(bpmAtBeat(100, 200, 10, 99)).toBe(200)
  })
})

describe('rampTargets', () => {
  it('diz pra onde vai antes de acontecer, nos dois sentidos', () => {
    const t = rampTargets(newRamp(120))
    expect(t.up).toBe(130)
    expect(t.down).toBe(110)
  })

  it('satura no teto e no piso', () => {
    expect(rampTargets(newRamp(DEFAULT_RAMP.maxBpm)).up).toBe(DEFAULT_RAMP.maxBpm)
    expect(rampTargets(newRamp(DEFAULT_RAMP.minBpm)).down).toBe(DEFAULT_RAMP.minBpm)
  })
})

describe('quantas limpas para subir', () => {
  const com = (repsToAdvance: number) => ({ ...DEFAULT_RAMP, repsToAdvance })

  it('com 1, sobe assim que acerta', () => {
    const r = nextRamp(newRamp(100), true, com(1))
    expect(r.event).toBe('up')
    expect(r.state.bpm).toBe(110)
  })

  it('com 3, segura duas e sobe na terceira', () => {
    let s = newRamp(100)
    s = nextRamp(s, true, com(3)).state
    s = nextRamp(s, true, com(3)).state
    expect(s.bpm).toBe(100)
    expect(s.cleanStreak).toBe(2)
    const r = nextRamp(s, true, com(3))
    expect(r.event).toBe('up')
    expect(r.state.bpm).toBe(110)
  })

  it('uma volta ruim zera a contagem, em qualquer ajuste', () => {
    let s = newRamp(100)
    s = nextRamp(s, true, com(3)).state
    s = nextRamp(s, true, com(3)).state
    s = nextRamp(s, false, com(3)).state
    expect(s.cleanStreak).toBe(0)
    expect(s.bpm).toBe(100) // ainda nao desceu: precisa de duas falhas
  })
})
