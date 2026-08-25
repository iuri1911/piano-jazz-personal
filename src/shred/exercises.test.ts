import { describe, expect, it } from 'vitest'
import { EXERCISES, EXERCISE_BY_ID, LEVEL_TOLERANCE } from './exercises'
import { applyHandMode, expandPattern, sourceSteps } from './pattern'
import { grade } from './grade'

// Range do A-49: 49 teclas, C2..C6.
const RANGE = { low: 36, high: 84 }

describe('tabela de exercicios', () => {
  it('ids unicos', () => {
    expect(EXERCISE_BY_ID.size).toBe(EXERCISES.length)
  })

  it('tempo alvo acima do inicial e ambos plausiveis', () => {
    for (const e of EXERCISES) {
      expect(e.tempos.target, e.id).toBeGreaterThan(e.tempos.start)
      expect(e.tempos.start, e.id).toBeGreaterThanOrEqual(40)
      expect(e.tempos.target, e.id).toBeLessThanOrEqual(240)
    }
  })

  it('todo exercicio tem foco e justificativa escritos', () => {
    for (const e of EXERCISES) {
      expect(e.focus.length, e.id).toBeGreaterThan(10)
      expect(e.note.length, e.id).toBeGreaterThan(60)
    }
  })
})

describe('expansao da biblioteca', () => {
  it('todo exercicio expande nos 12 tons dentro do teclado', () => {
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

  it('nenhum exercicio precisa cortar oitava no A-49', () => {
    for (const e of EXERCISES) {
      for (let pc = 0; pc < 12; pc++) {
        expect(expandPattern(e.pattern, pc, RANGE).warning, `${e.id} em pc ${pc}`).toBeUndefined()
      }
    }
  })

  it('repeticao dura entre 1 e 16 compassos no tempo inicial', () => {
    for (const e of EXERCISES) {
      const { beats } = expandPattern(e.pattern, 0, RANGE)
      const bars = beats / e.beatsPerBar
      expect(bars, `${e.id}: ${bars.toFixed(1)} compassos`).toBeGreaterThanOrEqual(1)
      expect(bars, `${e.id}: ${bars.toFixed(1)} compassos`).toBeLessThanOrEqual(16)
    }
  })

  it('as notas sobem no tempo e nunca voltam', () => {
    for (const e of EXERCISES) {
      const { notes } = expandPattern(e.pattern, 0, RANGE)
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i].beat, e.id).toBeGreaterThanOrEqual(notes[i - 1].beat)
      }
    }
  })
})

describe('execucao perfeita passa em todos os exercicios', () => {
  it('nenhum exercicio e impossivel de aprovar', () => {
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

describe('detalhes musicais', () => {
  it('a envolvente bebop cerca cada nota do arpejo de m7', () => {
    const ex = EXERCISE_BY_ID.get('bebop-enclosure')!
    const { notes } = expandPattern(ex.pattern, 0, RANGE)
    const rel = notes.slice(0, 12).map((n) => n.midi - notes[2].midi)
    // Alvos em 0 (C), 3 (Eb), 7 (G), 10 (Bb), cada um precedido de cima e baixo.
    expect(rel).toEqual([2, -1, 0, 5, 2, 3, 9, 6, 7, 12, 9, 10])
  })

  it('o arpejo diminuto repete a mesma forma a cada 3 semitons', () => {
    const ex = EXERCISE_BY_ID.get('dim7-arpeggio')!
    const shape = (pc: number) => {
      const m = expandPattern(ex.pattern, pc, RANGE).notes.map((n) => n.midi)
      return m.map((n) => n - m[0])
    }
    expect(shape(3)).toEqual(shape(0))
    expect(shape(6)).toEqual(shape(0))
  })

  it('oitavas mao-a-mao alternam as maos e separam por uma oitava', () => {
    const ex = EXERCISE_BY_ID.get('hand-to-hand-octaves')!
    const { notes } = expandPattern(ex.pattern, 0, RANGE)
    expect(notes.slice(0, 4).map((n) => n.hand)).toEqual(['r', 'l', 'r', 'l'])
    expect(notes[0].midi - notes[1].midi).toBe(12)
  })

  it('o ostinato da esquerda cai no tempo enquanto a direita corre', () => {
    const ex = EXERCISE_BY_ID.get('ostinato-lick')!
    const { notes } = expandPattern(ex.pattern, 0, RANGE)
    const lh = notes.filter((n) => n.hand === 'l')
    const rh = notes.filter((n) => n.hand === 'r')
    expect(lh.every((n) => Number.isInteger(n.beat))).toBe(true) // esquerda no tempo
    expect(rh.length).toBeGreaterThan(lh.length * 3) // direita bem mais densa
    expect(Math.max(...lh.map((n) => n.midi))).toBeLessThan(Math.min(...rh.map((n) => n.midi)))
  })

  it('o grupo de 5 desloca o acento em relacao ao tempo', () => {
    const ex = EXERCISE_BY_ID.get('group5-over-4')!
    const { notes } = expandPattern(ex.pattern, 0, RANGE)
    // Inicio de cada grupo de 5, em tempos: 0, 1.25, 2.5, 3.75 — nunca dois
    // seguidos na mesma posicao do tempo.
    const inicios = [0, 5, 10, 15].map((i) => notes[i].beat % 1)
    expect(new Set(inicios).size).toBe(4)
  })
})

describe('a biblioteca inteira em cada arranjo de maos', () => {
  const modos = ['as-is', 'rh', 'lh', 'both'] as const

  it('expande nos 12 tons sem sair do teclado', () => {
    for (const e of EXERCISES) {
      for (const modo of modos) {
        const spec = applyHandMode(e.pattern, modo)
        for (let pc = 0; pc < 12; pc++) {
          const { notes } = expandPattern(spec, pc, RANGE)
          expect(notes.length, `${e.id}/${modo} pc ${pc}`).toBeGreaterThan(4)
          for (const n of notes) {
            expect(n.midi, `${e.id}/${modo} pc ${pc}`).toBeGreaterThanOrEqual(RANGE.low)
            expect(n.midi, `${e.id}/${modo} pc ${pc}`).toBeLessThanOrEqual(RANGE.high)
          }
        }
      }
    }
  })

  it('mao separada sempre cabe, sem precisar cortar oitava', () => {
    for (const e of EXERCISES) {
      for (const modo of ['rh', 'lh'] as const) {
        for (let pc = 0; pc < 12; pc++) {
          const r = expandPattern(applyHandMode(e.pattern, modo), pc, RANGE)
          expect(r.warning, `${e.id}/${modo} pc ${pc}`).toBeUndefined()
        }
      }
    }
  })

  it('avisa em vez de estourar quando o dobro nao cabe em 49 teclas', () => {
    // 3 oitavas em oitavas dobradas pedem 48 semitons, que e o A-49 inteiro:
    // so caberia em C. O ajustador tem que cortar e dizer por que.
    const dim = EXERCISE_BY_ID.get('dim7-arpeggio')!
    const emC = expandPattern(applyHandMode(dim.pattern, 'both'), 0, RANGE)
    expect(emC.warning).toBeUndefined()
    const emD = expandPattern(applyHandMode(dim.pattern, 'both'), 2, RANGE)
    expect(emD.warning).toMatch(/oitava/)
    expect(Math.max(...emD.notes.map((n) => n.midi))).toBeLessThanOrEqual(RANGE.high)
    expect(Math.min(...emD.notes.map((n) => n.midi))).toBeGreaterThanOrEqual(RANGE.low)
  })

  it('execucao perfeita passa em qualquer arranjo', () => {
    for (const e of EXERCISES) {
      for (const modo of modos) {
        const { notes } = expandPattern(applyHandMode(e.pattern, modo), 0, RANGE)
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
        expect(g.reasons, `${e.id}/${modo}`).toEqual([])
      }
    }
  })
})

describe('dedilhado', () => {
  const SEM_DEDILHADO = new Set([
    'hand-to-hand-octaves', // maos alternando: o dedo depende de onde a mao chega
    'toccata',
    'ostinato-lick',
    'bebop-enclosure',
  ])

  it('todo exercicio ou traz dedilhado ou diz na nota por que nao traz', () => {
    for (const e of EXERCISES) {
      if (SEM_DEDILHADO.has(e.id)) {
        expect(e.pattern.fingering, e.id).toBeUndefined()
        expect(e.note, e.id).toMatch(/Sem dedilhado na tela/)
      } else {
        expect(e.pattern.fingering, e.id).toBeDefined()
        expect(e.pattern.fingering!.fingers.length, e.id).toBeGreaterThan(0)
      }
    }
  })

  it('so usa dedo de 1 a 5', () => {
    for (const e of EXERCISES) {
      const f = e.pattern.fingering
      if (!f) continue
      for (const d of [...f.fingers, ...(f.lh ?? [])]) {
        expect(d, `${e.id}: dedo ${d}`).toBeGreaterThanOrEqual(1)
        expect(d, `${e.id}: dedo ${d}`).toBeLessThanOrEqual(5)
      }
    }
  })

  it('byDegree cobre todos os graus da fonte, senao um grau ficaria sem dedo', () => {
    for (const e of EXERCISES) {
      const f = e.pattern.fingering
      if (!f || f.kind !== 'byDegree') continue
      const graus = sourceSteps(e.pattern.source).length
      expect(f.fingers.length, `${e.id}: ${f.fingers.length} dedos para ${graus} graus`).toBe(graus)
      if (f.lh) expect(f.lh.length, e.id).toBe(graus)
    }
  })

  it('a nota do piano-roll recebe o dedo, e cada mao recebe o seu', () => {
    const cinco = EXERCISE_BY_ID.get('five-finger')!
    const { notes } = expandPattern(cinco.pattern, 0, RANGE)
    const primeiro = notes.filter((n) => n.group === 0)
    expect(primeiro.find((n) => n.hand === 'r')!.finger).toBe(1)
    expect(primeiro.find((n) => n.hand === 'l')!.finger).toBe(5)
  })

  it('esquerda sem dedilhado proprio nao herda o numero da direita', () => {
    const pent = EXERCISE_BY_ID.get('pentatonic-box')! // so tem lista de direita
    const { notes } = expandPattern(applyHandMode(pent.pattern, 'lh'), 0, RANGE)
    expect(notes.every((n) => n.hand === 'l')).toBe(true)
    expect(notes.every((n) => n.finger === undefined)).toBe(true)
  })

  it('escala maior: direita e esquerda tem desenhos diferentes', () => {
    const esc = EXERCISE_BY_ID.get('major-scale-2oct')!
    const rh = expandPattern(applyHandMode(esc.pattern, 'rh'), 0, RANGE).notes
    const lh = expandPattern(applyHandMode(esc.pattern, 'lh'), 0, RANGE).notes
    expect(rh.slice(0, 7).map((n) => n.finger)).toEqual([1, 2, 3, 1, 2, 3, 4])
    expect(lh.slice(0, 7).map((n) => n.finger)).toEqual([1, 4, 3, 2, 1, 3, 2])
  })
})
