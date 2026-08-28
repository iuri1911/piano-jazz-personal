import { describe, expect, it } from 'vitest'
import { EXERCISES, EXERCISE_BY_ID, LEVEL_TOLERANCE } from './exercises'
import { expandPattern } from './pattern'
import { grade } from './grade'
import { boundaryBeats } from './Shred'

const RANGE = { low: 36, high: 84 }

/**
 * Toca N voltas em loop, perfeitas, e avalia cada uma como o app avalia: janela
 * [repStart - cut, repEnd - cut), e o que caiu na janela sai do buffer.
 */
function playLoop(id: string, reps: number) {
  const e = EXERCISE_BY_ID.get(id)!
  const x = expandPattern(e.pattern, 0, RANGE)
  const repBeats = Math.max(1, Math.ceil(x.beats / e.beatsPerBar)) * e.beatsPerBar
  const lastBeat = x.notes.reduce((m, n) => Math.max(m, n.beat), 0)
  const bpm = e.tempos.start
  const beatMs = 60000 / bpm
  const cut = beatMs * boundaryBeats(repBeats, lastBeat)
  const tol = LEVEL_TOLERANCE[e.level]

  let buffer = Array.from({ length: reps + 1 }, (_, c) =>
    x.notes.map((n) => ({ midi: n.midi, velocity: 80, onTime: (c * repBeats + n.beat) * beatMs })),
  ).flat()

  return Array.from({ length: reps }, (_, r) => {
    const repStart = r * repBeats * beatMs
    const end = (r + 1) * repBeats * beatMs - cut
    const win = buffer.filter((n) => n.onTime >= repStart - cut && n.onTime < end)
    buffer = buffer.filter((n) => n.onTime >= end)
    return grade(x.notes, win, {
      bpm,
      originMs: repStart,
      maxErrorRate: tol.maxErrorRate,
      maxIoiCv: tol.maxIoiCv,
      maxBpmDeviation: 0.05,
      timingGates: true,
    })
  })
}

describe('fronteira entre voltas', () => {
  it('a volta seguinte comeca exatamente onde esta acaba', () => {
    // Meio caminho entre a ultima nota e o fim da volta, no maximo um quarto de tempo.
    expect(boundaryBeats(4, 3.667)).toBeCloseTo(0.1665, 3)
    expect(boundaryBeats(40, 39.75)).toBeCloseTo(0.125, 3)
    expect(boundaryBeats(8, 6.75)).toBe(0.25) // sobra folga: fica no teto
    expect(boundaryBeats(4, 4)).toBe(0) // desenho que enche a volta inteira
  })

  it('tocar em loop perfeito passa em TODA volta, nao so na primeira', () => {
    // O defeito: a primeira nota da volta seguinte caia dentro desta janela, e como
    // a janela tambem e descartada, a volta seguinte perdia a propria primeira nota.
    // Dois erros garantidos por volta — mais que o orcamento inteiro de um exercicio
    // curto, entao a triade quebrada reprovava tocada perfeitamente.
    for (const e of EXERCISES) {
      for (const g of playLoop(e.id, 4)) {
        expect(g.missed, `${e.id}: faltando`).toBe(0)
        expect(g.extra, `${e.id}: sobrando`).toBe(0)
        expect(g.passed, `${e.id}: ${g.reasons.join(' · ')}`).toBe(true)
      }
    }
  })

  it('a triade quebrada em particular, que era o caso relatado', () => {
    const gs = playLoop('broken-triad', 5)
    expect(gs.every((g) => g.passed)).toBe(true)
    expect(gs.every((g) => g.errors === 0)).toBe(true)
  })
})
