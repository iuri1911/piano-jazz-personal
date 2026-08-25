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

const expected = expandPattern(spec, 0, RANGE).notes // 15 semicolcheias subindo

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
  it('um grupo por instante de ataque', () => {
    expect(groupExpected(expected)).toHaveLength(15)
  })
})

describe('grade', () => {
  it('execucao perfeita passa', () => {
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

  it('aguenta jitter humano pequeno sem reprovar', () => {
    // Desvio pequeno e sem padrao, ate 4ms numa semicolcheia de 125ms.
    const jitter = [0, 3, -2, 4, -3, 1, 2, -4, 0, 3, -1, 2, -3, 1, 0]
    const g = grade(expected, perfect((i) => jitter[i]), config)
    expect(g.ioiCv).toBeLessThan(config.maxIoiCv)
    expect(g.passed).toBe(true)
  })

  it('pega balanco sistematico que jitter aleatorio nao dispara', () => {
    // +-6ms alternado nao e ruido: e mancar. Vira 12ms de oscilacao no IOI,
    // ~10% da semicolcheia, e da pra ouvir. Tem que reprovar.
    const g = grade(expected, perfect((i) => (i % 2 ? 6 : -6)), config)
    expect(g.ioiCv).toBeGreaterThan(config.maxIoiCv)
    expect(g.passed).toBe(false)
  })

  it('nota derrubada conta como faltando e nao cascateia', () => {
    const played = perfect().filter((_, i) => i !== 5)
    const g = grade(expected, played, config)
    expect(g.missed).toBe(1)
    expect(g.extra).toBe(0)
    expect(g.status[5]).toBe('missed')
    // As de depois continuam casando: o alinhamento reencontrou a linha.
    expect(g.status.filter((s) => s === 'matched')).toHaveLength(14)
    // Uma nota derrubada cabe no orcamento: exigir execucao perfeita numa volta
    // de 15 notas nao e treino.
    expect(g.passed).toBe(true)
  })

  it('duas notas derrubadas ja estouram o orcamento', () => {
    const played = perfect().filter((_, i) => i !== 5 && i !== 9)
    const g = grade(expected, played, config)
    expect(g.missed).toBe(2)
    expect(g.passed).toBe(false)
  })

  it('nota a mais conta como sobrando e nao cascateia', () => {
    const played = perfect()
    played.splice(6, 0, { midi: 61, velocity: 80, onTime: played[5].onTime + 60 })
    const g = grade(expected, played, config)
    expect(g.extra).toBe(1)
    expect(g.missed).toBe(0)
    expect(g.status.every((s) => s === 'matched')).toBe(true)
  })

  it('nota trocada da uma faltando e uma sobrando, resto intacto', () => {
    const played = perfect()
    played[7] = { ...played[7], midi: played[7].midi + 1 }
    const g = grade(expected, played, config)
    expect(g.missed).toBe(1)
    expect(g.extra).toBe(1)
    expect(g.status[7]).toBe('missed')
    expect(g.status.filter((s) => s === 'matched')).toHaveLength(14)
  })

  it('uniforme mas 20% mais lento reprova pelo andamento, nao pela regularidade', () => {
    const beatMs = 60000 / BPM
    const played = expected.map((e) => ({
      midi: e.midi,
      velocity: 80,
      onTime: ORIGIN + e.beat * beatMs * 1.2,
    }))
    const g = grade(expected, played, config)
    expect(g.ioiCv).toBeCloseTo(0, 6) // regular, so que devagar
    expect(Math.round(g.effectiveBpm)).toBe(100)
    expect(g.passed).toBe(false)
    expect(g.reasons.join(' ')).toMatch(/andamento/)
  })

  it('no andamento certo mas embolado reprova pela regularidade', () => {
    // Mancando: uma nota gruda na anterior, a seguinte estica pra compensar.
    const g = grade(expected, perfect((i) => (i % 2 ? -40 : 0)), config)
    expect(g.ioiCv).toBeGreaterThan(config.maxIoiCv)
    expect(Math.abs(g.effectiveBpm - BPM) / BPM).toBeLessThan(config.maxBpmDeviation)
    expect(g.passed).toBe(false)
    expect(g.reasons.join(' ')).toMatch(/irregular/)
  })

  it('aponta qual nota atrasa', () => {
    // So a nota 9 chega 45ms tarde: o desvio tem que aparecer nela.
    const g = grade(expected, perfect((i) => (i === 9 ? 45 : 0)), config)
    const dev = g.perGroupDevMs
    expect(dev[9]).toBeGreaterThan(30)
    // E a seguinte aparece "adiantada", porque o buraco encurtou.
    expect(dev[10]).toBeLessThan(-30)
    expect(dev[3] ?? 0).toBeLessThan(15)
  })

  it('nao exige ordem entre notas do mesmo grupo', () => {
    const unisono = expandPattern({ ...spec, hands: { kind: 'unison', octaveGap: 1 } }, 0, RANGE)
    const beatMs = 60000 / BPM
    // A esquerda chega 8ms depois da direita, e o MIDI entrega fora de ordem.
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

  it('nao finge medir regularidade quando a cadeia de ataques e curta demais', () => {
    // Notas suficientes pra contar como tentativa, mas em dois pedacos soltos:
    // so sobram 2 intervalos encadeados, e 2 nao da media nenhuma.
    const played = perfect().filter((_, i) => [0, 1, 4, 5].includes(i))
    const g = grade(expected, played, config)
    expect(g.attempted).toBe(true)
    expect(g.reasons.join(' ')).toMatch(/notas de menos/)
  })

  it('mede desigualdade de ataque sem reprovar por isso', () => {
    const played = perfect().map((n, i) => ({ ...n, velocity: i % 4 === 3 ? 40 : 100 }))
    const g = grade(expected, played, config)
    expect(g.velocityStdev).toBeGreaterThan(20)
    expect(g.passed).toBe(true) // diagnostico, nao portao
  })

  it('nao trava com nada tocado', () => {
    const g = grade(expected, [], config)
    expect(g.missed).toBe(15)
    expect(g.accuracy).toBe(0)
    expect(g.passed).toBe(false)
    expect(Number.isFinite(g.ioiCv)).toBe(true)
  })
})

describe('permissividade na entrada da nota', () => {
  it('uma escorregada numa volta curta nao reprova', () => {
    // 15 notas: 3% arredondado da 0 se voce truncar. O orcamento tem piso 1,
    // senao o exercicio exige execucao perfeita e vira loteria.
    const played = perfect()
    played[6] = { ...played[6], midi: played[6].midi + 1 }
    const g = grade(expected, played, { ...config, maxErrorRate: 0.03 })
    expect(g.missed + g.extra).toBe(2)
    // Ainda reprova com duas (uma faltando + uma sobrando), mas so derrubar uma
    // nota passa:
    const semUma = perfect().filter((_, i) => i !== 6)
    expect(grade(expected, semUma, { ...config, maxErrorRate: 0.03 }).passed).toBe(true)
  })

  it('orcamento de erro nunca e zero, por menor que seja o desenho', () => {
    // 15 notas a 3% arredondaria pra 0. O piso de 1 tem que aparecer no limite.
    const played = perfect()
    played[3] = { ...played[3], midi: played[3].midi + 1 }
    played[11] = { ...played[11], midi: played[11].midi + 1 }
    const g = grade(expected, played, { ...config, maxErrorRate: 0.03 })
    expect(g.attempted).toBe(true)
    expect(g.reasons.join(' ')).toMatch(/limite 1/)
  })
})

describe('detecta oitava errada', () => {
  it('tudo uma oitava abaixo vira explicacao, nao erro cru', () => {
    const played = perfect().map((n) => ({ ...n, midi: n.midi - 12 }))
    const g = grade(expected, played, config)
    expect(g.transposeHint).toBe(-12)
    expect(g.reasons.join(' ')).toMatch(/1 oitava abaixo/)
  })

  it('tudo 2 semitons acima tambem', () => {
    const played = perfect().map((n) => ({ ...n, midi: n.midi + 2 }))
    expect(grade(expected, played, config).transposeHint).toBe(2)
  })

  it('nao inventa transporte quando os erros sao avulsos', () => {
    const played = perfect()
    played[3] = { ...played[3], midi: played[3].midi + 1 }
    played[9] = { ...played[9], midi: played[9].midi + 7 }
    expect(grade(expected, played, config).transposeHint).toBeNull()
  })

  it('nao acusa transporte quando a quantidade de notas nao bate', () => {
    const played = perfect().slice(0, 10).map((n) => ({ ...n, midi: n.midi - 12 }))
    expect(grade(expected, played, config).transposeHint).toBeNull()
  })

  it('lista o que faltou e o que sobrou', () => {
    const played = perfect().filter((_, i) => i !== 4)
    const g = grade(expected, played, config)
    expect(g.missedNotes).toEqual([expected[4].midi])
    expect(g.extraNotes).toEqual([])
  })
})

describe('volta sem execucao', () => {
  it('nao tocar nada nao e falha de execucao', () => {
    const g = grade(expected, [], config)
    expect(g.attempted).toBe(false)
    expect(g.reasons).toEqual(['volta sem execucao'])
    expect(g.passed).toBe(false)
  })

  it('duas notas soltas ainda contam como nao tocou', () => {
    expect(grade(expected, perfect().slice(0, 2), config).attempted).toBe(false)
  })

  it('a partir de um quarto do desenho ja e tentativa de verdade', () => {
    const g = grade(expected, perfect().slice(0, 8), config)
    expect(g.attempted).toBe(true)
    expect(g.reasons.join(' ')).toMatch(/erro/) // ai sim reprova pelo que faltou
  })

  it('execucao completa e sempre tentativa', () => {
    expect(grade(expected, perfect(), config).attempted).toBe(true)
  })
})

describe('reencontrar a linha depois de um tropeco', () => {
  it('pular seis notas no meio nao condena o resto da volta', () => {
    // Toca 0-3, derrapa e pula 4-9, volta certinho em 10.
    const played = perfect().filter((_, i) => i < 4 || i >= 10)
    const g = grade(expected, played, config)
    // 6 puladas + 1 gasta percebendo que a linha se perdeu: o reencontro so
    // abre depois de dois ataques sem casar, senao uma nota errada avulsa faria
    // o cursor saltar sozinho.
    expect(g.missed).toBe(7)
    expect(g.extra).toBe(1)
    // O que importa: da nota 11 em diante volta a casar, em vez de tudo virar
    // sobra ate o fim da volta.
    expect(g.status.slice(11).every((s) => s === 'matched')).toBe(true)
  })

  it('uma nota errada isolada nao faz o cursor saltar pra frente', () => {
    const played = perfect()
    played[5] = { ...played[5], midi: 127 } // altura que nao existe no desenho
    const g = grade(expected, played, config)
    expect(g.missed).toBe(1)
    expect(g.extra).toBe(1)
    expect(g.status.filter((s) => s === 'matched')).toHaveLength(14)
  })
})
