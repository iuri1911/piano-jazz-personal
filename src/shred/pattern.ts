import { Chord, Interval, Scale } from 'tonal'

// DSL de padrao de shred.
//
// Mesma ideia da tabela de voicings: descrever a FORMA e derivar as notas, em
// vez de escrever nota por nota. Um exercicio vira ~8 linhas de dados e sai nos
// 12 tons, em qualquer numero de oitavas, em qualquer subdivisao.

export type Source =
  /** Nome de escala do tonal: 'minor pentatonic', 'bebop dominant', 'whole tone'. */
  | { kind: 'scale'; name: string }
  /** Nome de acorde do tonal: 'maj7', 'dim7'. */
  | { kind: 'chord'; name: string }
  /** Semitons na mao, pra formas que nao tem nome. */
  | { kind: 'semitones'; steps: number[] }

export type Motion =
  /** 0 1 2 3 4 ... — escala ou arpejo direto. */
  | { kind: 'run' }
  /** Sequencia de N: 0123 1234 2345 ... — o padrao de shred de guitarra. */
  | { kind: 'seq'; group: number; step: number }
  /**
   * Repete uma FORMA subindo de `step` em `step` graus. E o motor do Hanon e de
   * quase todo exercicio sequenciado: [0,2,3,4,5,4,3,2] step 1 e o Hanon 1.
   */
  | { kind: 'shape'; degrees: number[]; step: number }
  /** Tercas (interval 2), quartas (3): 0 2 1 3 2 4 ... */
  | { kind: 'skip'; interval: number }
  /** Nota pedal intercalada: 0 p 1 p 2 p ... */
  | { kind: 'pedal'; pedalIndex: number }
  /** Graus escritos na mao, pra Hanon e figuras autorais. */
  | { kind: 'literal'; degrees: number[] }

export type Hands =
  | { kind: 'rh' }
  | { kind: 'lh' }
  /** Duas maos no mesmo desenho, separadas por N oitavas. */
  | { kind: 'unison'; octaveGap: number }
  /**
   * Alterna a mao a cada `unit` notas. ATENCAO: com lhOctaveShift 0 as duas maos
   * tocam a mesma altura e o MIDI nao distingue quem tocou — a mao vira so
   * indicacao visual. Com -1 da pra separar de verdade.
   */
  | { kind: 'alternate'; unit: number; lhOctaveShift: number }
  /** Esquerda em loop por baixo, direita no padrao principal. */
  | { kind: 'ostinato'; degrees: number[]; subdivision: number; octaveShift: number }

export type Fingering = {
  /** byDegree: indexado pelo grau da escala. bySequence: pela posicao tocada. */
  kind: 'byDegree' | 'bySequence'
  /** Mao direita. */
  fingers: number[]
  /**
   * Mao esquerda, quando a forma dela nao e a mesma. Nao da pra derivar da
   * direita por formula — em Do maior a direita e 1 2 3 1 2 3 4 e a esquerda
   * e 1 4 3 2 1 3 2. Onde nao esta escrito, a esquerda fica sem numero, que e
   * melhor que numero errado.
   */
  lh?: number[]
}

export type PatternSpec = {
  source: Source
  motion: Motion
  hands: Hands
  octaves: number
  direction: 'up' | 'down' | 'updown'
  /** Notas por tempo. 4 = semicolcheia, 3 = tercina, 5 e 7 = agrupamento impar. */
  subdivision: number
  /** MIDI do C da oitava base. A fundamental fica em anchorC + rootPc. */
  anchorC: number
  /** Quantas vezes o desenho inteiro roda numa repeticao. Figura curta precisa. */
  reps?: number
  fingering?: Fingering
}

export type ExpectedNote = {
  index: number
  /** Notas com o mesmo grupo soam juntas. IOI so olha o inicio de cada grupo. */
  group: number
  midi: number
  hand: 'l' | 'r'
  /** Posicao em tempos desde o inicio da repeticao. BPM entra so depois. */
  beat: number
  finger?: number
}

export type Expansion = {
  notes: ExpectedNote[]
  /** Duracao da repeticao em tempos. */
  beats: number
  /** Quantos grupos de ataque — e o denominador da precisao. */
  groups: number
  warning?: string
}

export type Range = { low: number; high: number }

/** Semitons de cada grau dentro de uma oitava, ex.: pentatonica menor -> [0,3,5,7,10]. */
export function sourceSteps(source: Source): number[] {
  if (source.kind === 'semitones') return source.steps
  const intervals =
    source.kind === 'scale'
      ? Scale.get(`C ${source.name}`).intervals
      : Chord.get(`C${source.name}`).intervals
  if (!intervals.length) throw new Error(`fonte desconhecida: ${source.name}`)
  return intervals.map((i) => Interval.semitones(i) ?? 0)
}

/**
 * Grau -> semitons acima da fundamental, deixando o indice passar de uma oitava.
 * O grau 5 numa pentatonica de 5 notas e a tonica uma oitava acima.
 */
export function degreeSemitone(steps: number[], i: number): number {
  const n = steps.length
  const oct = Math.floor(i / n)
  const idx = ((i % n) + n) % n
  return steps[idx] + 12 * oct
}

/** A forma do movimento como lista de graus, antes de virar altura. */
export function degreeSequence(motion: Motion, top: number): number[] {
  switch (motion.kind) {
    case 'run': {
      const out: number[] = []
      for (let i = 0; i <= top; i++) out.push(i)
      return out
    }
    case 'seq': {
      const out: number[] = []
      for (let start = 0; start + motion.group - 1 <= top; start += motion.step) {
        for (let k = 0; k < motion.group; k++) out.push(start + k)
      }
      return out
    }
    case 'skip': {
      const out: number[] = []
      for (let i = 0; i + motion.interval <= top; i++) {
        out.push(i, i + motion.interval)
      }
      return out
    }
    case 'pedal': {
      const out: number[] = []
      for (let i = 0; i <= top; i++) {
        if (i === motion.pedalIndex) continue
        out.push(i, motion.pedalIndex)
      }
      return out
    }
    case 'shape': {
      const out: number[] = []
      const span = Math.max(...motion.degrees)
      if (motion.step <= 0) return [...motion.degrees] // passo 0 nao sobe: nao pode virar loop infinito
      for (let r = 0; span + r * motion.step <= top; r += 1) {
        for (const d of motion.degrees) out.push(d + r * motion.step)
      }
      return out
    }
    case 'literal':
      return [...motion.degrees]
  }
}

function applyDirection(
  seq: number[],
  direction: PatternSpec['direction'],
  top: number,
): number[] {
  if (direction === 'up') return seq
  if (direction === 'down') return [...seq].reverse()

  // A volta e o ESPELHO em torno do topo, nao o retrogrado.
  //
  // Pra desenho simetrico (escala, arpejo, tercas) da exatamente no mesmo. Pra
  // figura assimetrica os dois divergem, e o espelho e o certo: no Hanon 1, a
  // parte descendente e a figura refletida, nao a figura tocada de tras pra
  // frente.
  const mirror = seq.map((g) => top - g)

  // Nao repete o pico nem o vale: o exercicio roda em loop, entao a ultima nota
  // da descida emenda na primeira da subida seguinte.
  let inicio = 0
  while (inicio < mirror.length && mirror[inicio] === seq[seq.length - 1]) inicio++
  let fim = mirror.length
  while (fim > inicio && mirror[fim - 1] === seq[0]) fim--

  return [...seq, ...mirror.slice(inicio, fim)]
}

function fingerFor(
  fingering: Fingering | undefined,
  degree: number,
  position: number,
  n: number,
  hand: 'l' | 'r',
) {
  if (!fingering) return undefined
  const list = hand === 'l' ? fingering.lh : fingering.fingers
  if (!list || !list.length) return undefined
  return fingering.kind === 'byDegree'
    ? list[((degree % n) + n) % n % list.length]
    : list[position % list.length]
}

/**
 * Padrao -> notas com altura e posicao no tempo.
 * `range` e o teclado disponivel: se o desenho nao couber, desce oitava, e se
 * ainda nao couber, corta uma oitava do padrao e avisa.
 */
export function expandPattern(spec: PatternSpec, rootPc: number, range: Range): Expansion {
  let octaves = Math.max(1, spec.octaves)
  let warning: string | undefined

  for (;;) {
    const built = build(spec, rootPc, octaves)
    const lows = built.map((e) => e.midi)
    const min = Math.min(...lows)
    const max = Math.max(...lows)

    // Cabe transpondo por oitavas?
    let shift = 0
    if (max > range.high) shift -= 12 * Math.ceil((max - range.high) / 12)
    if (min + shift < range.low) shift += 12 * Math.ceil((range.low - (min + shift)) / 12)

    if (min + shift >= range.low && max + shift <= range.high) {
      const notes = built.map((e) => ({ ...e, midi: e.midi + shift }))
      const groups = new Set(notes.map((n) => n.group)).size
      const beats = Math.max(...notes.map((n) => n.beat)) + 1 / spec.subdivision
      return { notes, beats, groups, warning }
    }

    if (octaves <= 1) {
      // Desenho largo demais pro teclado mesmo em uma oitava: entrega assim
      // mesmo, transposto pro que der, com o aviso.
      const notes = built.map((e) => ({ ...e, midi: e.midi + shift }))
      const groups = new Set(notes.map((n) => n.group)).size
      const beats = Math.max(...notes.map((n) => n.beat)) + 1 / spec.subdivision
      return { notes, beats, groups, warning: 'Padrao nao cabe no teclado configurado.' }
    }

    octaves -= 1
    warning = `Reduzido pra ${octaves} oitava${octaves > 1 ? 's' : ''}: nao cabe no teclado.`
  }
}

function build(spec: PatternSpec, rootPc: number, octaves: number): ExpectedNote[] {
  const steps = sourceSteps(spec.source)
  const root = spec.anchorC + rootPc
  const top = octaves * steps.length
  const once = applyDirection(degreeSequence(spec.motion, top), spec.direction, top)
  const seq = Array.from({ length: Math.max(1, spec.reps ?? 1) }, () => once).flat()

  const events: { midi: number; hand: 'l' | 'r'; beat: number; finger?: number }[] = []
  const h = spec.hands

  seq.forEach((degree, i) => {
    const beat = i / spec.subdivision
    const midi = root + degreeSemitone(steps, degree)
    const dedo = (hand: 'l' | 'r') => fingerFor(spec.fingering, degree, i, steps.length, hand)

    switch (h.kind) {
      case 'rh':
        events.push({ midi, hand: 'r', beat, finger: dedo('r') })
        break
      case 'lh':
        events.push({ midi: midi - 12, hand: 'l', beat, finger: dedo('l') })
        break
      case 'unison':
        events.push({ midi, hand: 'r', beat, finger: dedo('r') })
        events.push({ midi: midi - 12 * h.octaveGap, hand: 'l', beat, finger: dedo('l') })
        break
      case 'alternate': {
        const left = Math.floor(i / h.unit) % 2 === 1
        events.push({
          midi: left ? midi + 12 * h.lhOctaveShift : midi,
          hand: left ? 'l' : 'r',
          beat,
          finger: dedo(left ? 'l' : 'r'),
        })
        break
      }
      case 'ostinato':
        events.push({ midi, hand: 'r', beat, finger: dedo('r') })
        break
    }
  })

  // Ostinato: a esquerda roda o proprio loop por cima da mesma linha do tempo.
  if (h.kind === 'ostinato' && h.degrees.length) {
    const totalBeats = seq.length / spec.subdivision
    const count = Math.round(totalBeats * h.subdivision)
    for (let i = 0; i < count; i++) {
      const degree = h.degrees[i % h.degrees.length]
      events.push({
        midi: root + degreeSemitone(steps, degree) + 12 * h.octaveShift,
        hand: 'l',
        beat: i / h.subdivision,
      })
    }
  }

  // Ordena por tempo e agrupa o que e simultaneo — a avaliacao nao pode exigir
  // ordem entre duas notas que deveriam soar juntas.
  events.sort((a, b) => a.beat - b.beat || a.midi - b.midi)

  let group = -1
  let lastBeat = Number.NaN
  return events.map((e, index) => {
    if (e.beat !== lastBeat) {
      group += 1
      lastBeat = e.beat
    }
    return { index, group, midi: e.midi, hand: e.hand, beat: e.beat, finger: e.finger }
  })
}

/**
 * Sobreposicao de maos escolhida na hora, por cima do que a tabela diz.
 * 'as-is' respeita o arranjo do exercicio; os outros forcam.
 */
export type HandMode = 'as-is' | 'rh' | 'lh' | 'both'

export const HAND_MODE_LABEL: Record<HandMode, string> = {
  'as-is': 'como escrito',
  rh: 'so direita',
  lh: 'so esquerda',
  both: 'as duas em oitava',
}

/**
 * Mao separada e depois junta e a ordem normal de estudar qualquer passagem, e
 * so o arranjo muda — o desenho, a subdivisao e o dedilhado continuam os mesmos.
 */
export function applyHandMode(spec: PatternSpec, mode: HandMode): PatternSpec {
  switch (mode) {
    case 'as-is':
      return spec
    case 'rh':
      return { ...spec, hands: { kind: 'rh' } }
    case 'lh':
      return { ...spec, hands: { kind: 'lh' } }
    case 'both':
      return { ...spec, hands: { kind: 'unison', octaveGap: 1 } }
  }
}
