import { describe, expect, it } from 'vitest'
import {
  applyHandMode,
  degreeSemitone,
  degreeSequence,
  expandPattern,
  sourceSteps,
  type PatternSpec,
} from './pattern'

const RANGE = { low: 36, high: 84 } // 49 teclas, C2..C6

describe('sourceSteps', () => {
  it('le escala do tonal', () => {
    expect(sourceSteps({ kind: 'scale', name: 'minor pentatonic' })).toEqual([0, 3, 5, 7, 10])
    expect(sourceSteps({ kind: 'scale', name: 'major' })).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(sourceSteps({ kind: 'scale', name: 'whole tone' })).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('le acorde do tonal', () => {
    expect(sourceSteps({ kind: 'chord', name: 'maj7' })).toEqual([0, 4, 7, 11])
    expect(sourceSteps({ kind: 'chord', name: 'dim7' })).toEqual([0, 3, 6, 9])
  })

  it('aceita semitons na mao', () => {
    expect(sourceSteps({ kind: 'semitones', steps: [0, 1, 2] })).toEqual([0, 1, 2])
  })
})

describe('degreeSemitone', () => {
  it('passa de oitava quando o grau estoura a escala', () => {
    const pent = [0, 3, 5, 7, 10]
    expect(degreeSemitone(pent, 0)).toBe(0)
    expect(degreeSemitone(pent, 4)).toBe(10)
    expect(degreeSemitone(pent, 5)).toBe(12) // tonica uma oitava acima
    expect(degreeSemitone(pent, 6)).toBe(15)
  })
})

describe('degreeSequence', () => {
  it('run e a escala direta', () => {
    expect(degreeSequence({ kind: 'run' }, 4)).toEqual([0, 1, 2, 3, 4])
  })

  it('sequencia de 4 anda de um em um', () => {
    expect(degreeSequence({ kind: 'seq', group: 4, step: 1 }, 5)).toEqual([
      0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5,
    ])
  })

  it('skip 2 da tercas', () => {
    expect(degreeSequence({ kind: 'skip', interval: 2 }, 4)).toEqual([0, 2, 1, 3, 2, 4])
  })

  it('pedal intercala e nao repete a propria nota pedal', () => {
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
  it('escala de C maior, uma oitava, sobe C3 a C4', () => {
    const { notes, groups } = expandPattern(base, 0, RANGE)
    expect(notes.map((n) => n.midi)).toEqual([48, 50, 52, 53, 55, 57, 59, 60])
    expect(groups).toBe(8)
  })

  it('posiciona no tempo pela subdivisao', () => {
    const { notes, beats } = expandPattern(base, 0, RANGE)
    expect(notes.map((n) => n.beat)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75])
    expect(beats).toBe(2) // 8 semicolcheias = 2 tempos
  })

  it('updown nao repete nem o topo nem o vale', () => {
    // O exercicio roda em loop: a ultima nota da descida emenda na primeira da
    // subida seguinte, entao repetir a tonica nas duas pontas soaria dobrado.
    const { notes } = expandPattern({ ...base, direction: 'updown' }, 0, RANGE)
    expect(notes.map((n) => n.midi)).toEqual([
      48, 50, 52, 53, 55, 57, 59, 60, 59, 57, 55, 53, 52, 50,
    ])
  })

  it('a descida e o espelho, nao a figura tocada de tras pra frente', () => {
    // Hanon 1: figura [0,2,3,4,5,4,3,2] subindo de grau em grau. A descida de
    // verdade e a mesma figura refletida — comeca no topo e desce. O retrogrado
    // comecaria na penultima nota da subida, que e outro exercicio.
    const hanon: PatternSpec = {
      ...base,
      motion: { kind: 'shape', degrees: [0, 2, 3, 4, 5, 4, 3, 2], step: 1 },
      octaves: 1,
      direction: 'updown',
    }
    const graus = expandPattern(hanon, 0, RANGE).notes.map((n) => n.midi)
    const subida = expandPattern({ ...hanon, direction: 'up' }, 0, RANGE).notes.map((n) => n.midi)
    const descida = graus.slice(subida.length)
    // Primeira nota da descida = topo da escala (C uma oitava acima), nao a
    // penultima nota da subida.
    expect(descida[0]).toBe(60)
    expect(descida[0]).not.toBe(subida[subida.length - 2])
  })

  it('desenho simetrico da o mesmo espelho e retrogrado', () => {
    // Numa escala corrida os dois coincidem — a mudanca so aparece em figura
    // assimetrica, entao nada que ja funcionava muda de forma.
    const { notes } = expandPattern({ ...base, direction: 'updown' }, 0, RANGE)
    const midi = notes.map((n) => n.midi)
    const subida = midi.slice(0, 8)
    expect(midi.slice(8)).toEqual([...subida].reverse().slice(1, -1))
  })

  it('preserva a forma interválica nos 12 tons', () => {
    const shape = (pc: number) => {
      const notes = expandPattern(base, pc, RANGE).notes.map((n) => n.midi)
      return notes.map((n) => n - notes[0])
    }
    const reference = shape(0)
    for (let pc = 1; pc < 12; pc++) expect(shape(pc)).toEqual(reference)
  })

  it('unison poe as duas maos no mesmo tempo, no mesmo grupo', () => {
    const { notes } = expandPattern({ ...base, hands: { kind: 'unison', octaveGap: 1 } }, 0, RANGE)
    const primeiro = notes.filter((n) => n.group === 0)
    expect(primeiro).toHaveLength(2)
    expect(primeiro.map((n) => n.midi).sort((a, b) => a - b)).toEqual([36, 48])
    expect(primeiro.every((n) => n.beat === 0)).toBe(true)
  })

  it('alternate troca a mao e desce a oitava da esquerda', () => {
    const { notes } = expandPattern(
      { ...base, hands: { kind: 'alternate', unit: 1, lhOctaveShift: -1 } },
      0,
      RANGE,
    )
    expect(notes.map((n) => n.hand)).toEqual(['r', 'l', 'r', 'l', 'r', 'l', 'r', 'l'])
    expect(notes[1].midi).toBe(50 - 12)
  })

  it('ostinato roda o loop da esquerda sobre a linha da direita', () => {
    const { notes } = expandPattern(
      {
        ...base,
        hands: { kind: 'ostinato', degrees: [0, 4], subdivision: 1, octaveShift: -1 },
      },
      0,
      RANGE,
    )
    const lh = notes.filter((n) => n.hand === 'l')
    expect(lh.map((n) => n.midi)).toEqual([36, 43]) // C2 e G2, um por tempo em 2 tempos
    expect(lh.map((n) => n.beat)).toEqual([0, 1])
    // A primeira nota da esquerda cai junto com a primeira da direita.
    expect(notes.filter((n) => n.group === 0)).toHaveLength(2)
  })

  it('transpoe pra baixo quando estoura o agudo do teclado', () => {
    const alto: PatternSpec = { ...base, anchorC: 84 }
    const { notes } = expandPattern(alto, 11, RANGE)
    expect(Math.max(...notes.map((n) => n.midi))).toBeLessThanOrEqual(RANGE.high)
    expect(Math.min(...notes.map((n) => n.midi))).toBeGreaterThanOrEqual(RANGE.low)
  })

  it('corta oitava e avisa quando o padrao nao cabe', () => {
    const largo: PatternSpec = { ...base, octaves: 4, anchorC: 48 }
    const r = expandPattern(largo, 0, { low: 48, high: 72 })
    expect(r.warning).toMatch(/oitava/)
    expect(Math.max(...r.notes.map((n) => n.midi))).toBeLessThanOrEqual(72)
  })
})

describe('degreeSequence shape', () => {
  it('repete a forma subindo de grau em grau', () => {
    // Hanon 1: sobe a figura de 8 notas uma nota por vez.
    expect(degreeSequence({ kind: 'shape', degrees: [0, 2, 3, 4], step: 1 }, 6)).toEqual([
      0, 2, 3, 4, 1, 3, 4, 5, 2, 4, 5, 6,
    ])
  })

  it('para quando a forma passaria do topo', () => {
    expect(degreeSequence({ kind: 'shape', degrees: [0, 1], step: 1 }, 2)).toEqual([0, 1, 1, 2])
  })

  it('agrupamento de 5 sobre subdivisao de 4 desloca o acento', () => {
    const seq = degreeSequence({ kind: 'shape', degrees: [0, 1, 2, 3, 4], step: 1 }, 9)
    // 5 notas por grupo contra 4 por tempo: o inicio do grupo anda pelo compasso.
    expect(seq.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 1, 2, 3, 4, 5])
    expect(seq.length % 5).toBe(0)
  })
})

describe('reps', () => {
  it('roda o desenho inteiro N vezes seguidas', () => {
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
    // O tempo segue correndo: a segunda volta nao volta pro tempo 0.
    expect(notes.map((n) => n.beat)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])
  })
})

describe('shape com passo zero', () => {
  it('nao vira loop infinito', () => {
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

  it('as-is nao mexe no arranjo do exercicio', () => {
    expect(applyHandMode(base, 'as-is')).toBe(base)
  })

  it('so direita fica na oitava ancorada', () => {
    const { notes } = expandPattern(applyHandMode(base, 'rh'), 0, RANGE)
    expect(notes.every((n) => n.hand === 'r')).toBe(true)
    expect(notes[0].midi).toBe(60)
  })

  it('so esquerda desce uma oitava', () => {
    const { notes } = expandPattern(applyHandMode(base, 'lh'), 0, RANGE)
    expect(notes.every((n) => n.hand === 'l')).toBe(true)
    expect(notes[0].midi).toBe(48)
  })

  it('as duas dobra o numero de notas sem mudar os ataques', () => {
    const uma = expandPattern(applyHandMode(base, 'rh'), 0, RANGE)
    const duas = expandPattern(applyHandMode(base, 'both'), 0, RANGE)
    expect(duas.notes).toHaveLength(uma.notes.length * 2)
    expect(duas.groups).toBe(uma.groups) // mesmo ritmo, so que em oitavas
    expect(duas.beats).toBe(uma.beats)
  })

  it('preserva desenho, subdivisao e dedilhado', () => {
    const comDedo: PatternSpec = {
      ...base,
      hands: { kind: 'alternate', unit: 1, lhOctaveShift: -1 },
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3, 4] },
    }
    const rh = applyHandMode(comDedo, 'rh')
    expect(rh.fingering).toBe(comDedo.fingering)
    expect(rh.motion).toBe(comDedo.motion)
    expect(rh.subdivision).toBe(comDedo.subdivision)
    const notes = expandPattern(rh, 0, RANGE).notes
    expect(notes[0].finger).toBe(1)
  })
})
