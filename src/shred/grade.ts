import type { ExpectedNote } from './pattern'

// Avaliacao de uma repeticao.
//
// A pergunta nao e "voce grudou no clique" — e "voce tocou as notas certas, na
// ordem, com espacamento REGULAR, no tempo pedido". Shred embolado quase sempre
// esta no tempo em media e irregular no detalhe, e e isso que a metrica pega.

export type PlayedNote = {
  midi: number
  velocity: number
  onTime: number
  offTime?: number
}

export type NoteStatus = 'matched' | 'missed'

export type GradeConfig = {
  bpm: number
  /** perf time do tempo 0, vindo do transporte. Sem isso o grid e estimado. */
  originMs?: number
  /** Fracao de erros tolerada. 0.02 = 2%. */
  maxErrorRate: number
  /** Teto do coeficiente de variacao dos intervalos entre ataques. */
  maxIoiCv: number
  /** Desvio de andamento tolerado, fracao. 0.03 = 3%. */
  maxBpmDeviation: number
  /**
   * Timing reprova? Com false, regularidade e andamento continuam medidos e
   * exibidos, mas nao seguram a aprovacao — e o modo de quem ainda esta
   * decorando o desenho e nao tem por que brigar com o relogio ainda.
   */
  timingGates?: boolean
  /**
   * Onde cada tempo DEVERIA cair, em ms desde o inicio. O padrao e a grade
   * constante do bpm; o modo accel passa a propria curva. Tudo que depende de
   * tempo esperado sai daqui, entao andamento variavel nao vira caso especial.
   */
  expectedMsAt?: (beat: number) => number
}

export type Grade = {
  /** Situacao de cada nota esperada, por index. */
  status: NoteStatus[]
  /** Indice em `played` de cada nota casada, ou -1. */
  matchOf: number[]
  missed: number
  /** Notas tocadas que nao casaram com nada: erradas ou a mais. */
  extra: number
  errors: number
  accuracy: number
  /** Coeficiente de variacao dos IOIs normalizados. A metrica que decide. */
  ioiCv: number
  /** Desvio em ms do intervalo que CHEGA em cada grupo. Diz qual nota atrasa. */
  perGroupDevMs: (number | null)[]
  effectiveBpm: number
  /** Desvio medio absoluto do grid do metronomo, em ms. Informativo. */
  gridMadMs: number
  velocityStdev: number
  /** Espalhamento medio dentro de um grupo: sincronia das duas maos, em ms. */
  handSpreadMs: number
  /**
   * Alguem tentou tocar esta volta? Volta vazia (ajustando o teclado, lendo a
   * tela, saiu da sala) nao e erro de execucao e nao pode puxar o andamento.
   */
  attempted: boolean
  /** Alturas esperadas que nao vieram, e tocadas que nao casaram. Pra UI mostrar. */
  missedNotes: number[]
  extraNotes: number[]
  /**
   * Se o que faltou e o que sobrou casam por um deslocamento constante, o
   * deslocamento em semitons. E o caso "toquei tudo uma oitava abaixo", que
   * senao aparece como erro puro e a pessoa jura que tocou certo.
   */
  transposeHint: number | null
  passed: boolean
  /** Por que reprovou, pra UI dizer o que corrigir. */
  reasons: string[]
}

/** Quantos grupos a frente o casamento procura no caso normal. */
const LOOKAHEAD = 3
/**
 * Busca larga pra reencontrar a linha depois de um tropeco. Sem isto, pular
 * mais notas que o LOOKAHEAD fazia o cursor travar e TODO o resto da volta
 * virar "sobrando" — a pessoa tocava certo e o app dizia que era tudo errado.
 * Só entra depois de dois ataques seguidos sem casar, senao uma nota errada
 * isolada faria o cursor pular pra frente sozinho.
 */
const RESYNC_LOOKAHEAD = 24
const RESYNC_AFTER = 2
/** Abaixo disso nao da pra falar de regularidade. */
const MIN_GROUPS_FOR_TIMING = 4

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

type Group = { beat: number; notes: ExpectedNote[] }

export function groupExpected(expected: ExpectedNote[]): Group[] {
  const byGroup = new Map<number, Group>()
  for (const e of expected) {
    const g = byGroup.get(e.group)
    if (g) g.notes.push(e)
    else byGroup.set(e.group, { beat: e.beat, notes: [e] })
  }
  return [...byGroup.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g)
}

/**
 * Casa o tocado com o esperado, em ordem, com janela curta de lookahead.
 * Uma nota errada nao cascateia: o algoritmo reencontra a linha no grupo
 * seguinte em vez de dar tudo como errado dali pra frente.
 */
export function grade(
  expected: ExpectedNote[],
  played: PlayedNote[],
  config: GradeConfig,
): Grade {
  const groups = groupExpected(expected)
  const status: NoteStatus[] = expected.map(() => 'missed')
  const matchOf: number[] = expected.map(() => -1)
  const byIndex = new Map(expected.map((e) => [e.index, e]))
  const notes = [...played].sort((a, b) => a.onTime - b.onTime)

  let cursor = 0
  let extra = 0
  let semCasar = 0

  const procurar = (note: PlayedNote, ate: number): [number, number] => {
    for (let k = cursor; k < ate; k++) {
      for (const e of groups[k].notes) {
        // Dentro de um grupo a ordem nao importa: sao notas que deveriam soar
        // juntas, e o MIDI sempre entrega uma antes da outra.
        if (status[e.index] === 'missed' && matchOf[e.index] === -1 && e.midi === note.midi) {
          return [k, e.index]
        }
      }
    }
    return [-1, -1]
  }

  for (let p = 0; p < notes.length; p++) {
    const note = notes[p]
    let [hitGroup, hitIndex] = procurar(note, Math.min(groups.length, cursor + LOOKAHEAD + 1))

    if (hitGroup < 0 && semCasar >= RESYNC_AFTER - 1) {
      // Perdeu a linha: abre a janela pra reencontrar em vez de dar tudo que
      // vem depois como erro.
      ;[hitGroup, hitIndex] = procurar(note, Math.min(groups.length, cursor + RESYNC_LOOKAHEAD + 1))
    }

    if (hitGroup < 0) {
      extra++
      semCasar++
      continue
    }
    semCasar = 0

    status[hitIndex] = 'matched'
    matchOf[hitIndex] = p
    cursor = hitGroup
    // Grupo completo: anda pro proximo que ainda tem nota pendente.
    while (cursor < groups.length && groups[cursor].notes.every((e) => status[e.index] === 'matched')) {
      cursor++
    }
  }

  const missed = status.filter((s) => s === 'missed').length
  const errors = missed + extra
  const accuracy = expected.length ? (expected.length - missed) / expected.length : 0

  // --- tempo -------------------------------------------------------------
  const beatMs = 60000 / config.bpm
  const expectedMsAt = config.expectedMsAt ?? ((beat: number) => beat * beatMs)

  // Ataque de cada grupo = a primeira nota casada dele. Grupo sem nota casada
  // quebra a cadeia e nao entra em nenhum IOI.
  const onsets: (number | null)[] = groups.map((g) => {
    const times = g.notes
      .filter((e) => status[e.index] === 'matched')
      .map((e) => notes[matchOf[e.index]].onTime)
    return times.length ? Math.min(...times) : null
  })

  const spreads: number[] = []
  groups.forEach((g) => {
    const times = g.notes
      .filter((e) => status[e.index] === 'matched')
      .map((e) => notes[matchOf[e.index]].onTime)
    if (times.length > 1) spreads.push(Math.max(...times) - Math.min(...times))
  })

  const normalized: number[] = []
  const perGroupDevMs: (number | null)[] = groups.map(() => null)
  const rawIoi: { at: number; actual: number; expected: number }[] = []

  for (let k = 1; k < groups.length; k++) {
    const a = onsets[k - 1]
    const b = onsets[k]
    if (a === null || b === null) continue
    const expectedMs = expectedMsAt(groups[k].beat) - expectedMsAt(groups[k - 1].beat)
    if (expectedMs <= 0) continue
    // Normalizar pelo intervalo esperado faz a mesma metrica servir pra ritmo
    // uniforme e pra agrupamento irregular, sem caso especial.
    normalized.push((b - a) / expectedMs)
    rawIoi.push({ at: k, actual: b - a, expected: expectedMs })
  }

  const ioiMean = mean(normalized)
  const ioiCv = ioiMean > 0 ? stdev(normalized) / ioiMean : 0

  // Desvio em ms contra o espacamento MEDIO da propria pessoa, nao contra o
  // ideal: interessa saber qual nota destoa do resto, nao que tudo esta lento.
  for (const r of rawIoi) {
    perGroupDevMs[r.at] = r.actual - r.expected * ioiMean
  }

  const firstIdx = onsets.findIndex((o) => o !== null)
  const lastIdx = onsets.length - 1 - [...onsets].reverse().findIndex((o) => o !== null)
  // Andamento efetivo como razao entre o tempo que ISSO deveria durar e o que
  // durou. Com bpm constante da o bpm real; com curva, da o bpm equivalente.
  let effectiveBpm = 0
  if (firstIdx >= 0 && lastIdx > firstIdx) {
    const elapsed = (onsets[lastIdx] as number) - (onsets[firstIdx] as number)
    const span = expectedMsAt(groups[lastIdx].beat) - expectedMsAt(groups[firstIdx].beat)
    if (elapsed > 0 && span > 0) effectiveBpm = (config.bpm * span) / elapsed
  }

  // Grid: se o transporte deu o instante do tempo 0, mede contra ele. Senao
  // ancora na primeira nota — vira medida de forma, nao de entrada.
  const origin =
    config.originMs ??
    (firstIdx >= 0 ? (onsets[firstIdx] as number) - expectedMsAt(groups[firstIdx].beat) : 0)
  const gridErrors: number[] = []
  groups.forEach((g, k) => {
    const o = onsets[k]
    if (o === null) return
    gridErrors.push(Math.abs(o - (origin + expectedMsAt(g.beat))))
  })

  const velocities = expected
    .filter((e) => status[e.index] === 'matched')
    .map((e) => notes[matchOf[e.index]].velocity)

  const missedNotes = expected.filter((e) => status[e.index] === 'missed').map((e) => e.midi)
  const matchedPlayed = new Set(matchOf.filter((i) => i >= 0))
  const extraNotes = notes.filter((_, i) => !matchedPlayed.has(i)).map((n) => n.midi)
  // Compara a execucao INTEIRA, nao o que sobrou do casamento: numa escala
  // transposta o matcher casa varias notas por coincidencia diatonica, e o
  // residuo nunca fecha — mesmo com a pessoa tendo tocado tudo na oitava errada.
  const transposeHint = detectTranspose(
    expected.map((e) => e.midi),
    notes.map((n) => n.midi),
  )

  // --- veredito ----------------------------------------------------------
  const reasons: string[] = []
  // Nunca zero: num desenho de 17 notas, 2% arredondado pra baixo exigiria
  // execucao perfeita, e isso nao e treino, e loteria.
  const errorBudget = Math.max(1, Math.round(config.maxErrorRate * expected.length))
  const attempted = expected.length - missed >= Math.max(3, expected.length * 0.25)

  if (!attempted) {
    return {
      status, matchOf, missed, extra, errors, accuracy, ioiCv, perGroupDevMs,
      effectiveBpm, gridMadMs: mean(gridErrors), velocityStdev: stdev(velocities),
      handSpreadMs: mean(spreads), attempted, missedNotes, extraNotes, transposeHint,
      passed: false,
      reasons: ['volta sem execucao'],
    }
  }
  const judgeable = normalized.length >= MIN_GROUPS_FOR_TIMING - 1

  if (errors > errorBudget) {
    reasons.push(
      `${errors} erro${errors > 1 ? 's' : ''} (${missed} faltando, ${extra} sobrando) — limite ${errorBudget}`,
    )
    if (transposeHint !== null) {
      const oitavas = transposeHint % 12 === 0 ? Math.abs(transposeHint) / 12 : 0
      reasons.push(
        oitavas
          ? `voce tocou tudo ${oitavas} oitava${oitavas > 1 ? 's' : ''} ${transposeHint < 0 ? 'abaixo' : 'acima'}`
          : `voce tocou tudo ${Math.abs(transposeHint)} semitons ${transposeHint < 0 ? 'abaixo' : 'acima'}`,
      )
    }
  }
  const timingGates = config.timingGates ?? true

  if (!timingGates) {
    // Nada de timing entra no veredito.
  } else if (!judgeable) {
    reasons.push('notas de menos pra medir regularidade')
  } else {
    if (ioiCv > config.maxIoiCv) {
      reasons.push(`irregular: CV ${(ioiCv * 100).toFixed(1)}% — limite ${(config.maxIoiCv * 100).toFixed(0)}%`)
    }
    const drift = Math.abs(effectiveBpm - config.bpm) / config.bpm
    if (drift > config.maxBpmDeviation) {
      reasons.push(
        `fora do andamento: ${Math.round(effectiveBpm)} BPM contra ${Math.round(config.bpm)} pedidos`,
      )
    }
  }

  return {
    status,
    matchOf,
    missed,
    extra,
    errors,
    accuracy,
    ioiCv,
    perGroupDevMs,
    effectiveBpm,
    gridMadMs: mean(gridErrors),
    velocityStdev: stdev(velocities),
    handSpreadMs: mean(spreads),
    attempted,
    missedNotes,
    extraNotes,
    transposeHint,
    passed: reasons.length === 0,
    reasons,
  }
}

/**
 * O que foi tocado e o desenho esperado deslocado por igual?
 * Compara como conjunto ordenado, entao nao depende da ordem de chegada de
 * notas que soam juntas. Devolve o deslocamento em semitons, ou null.
 */
export function detectTranspose(expected: number[], played: number[]): number | null {
  if (expected.length < 3 || expected.length !== played.length) return null
  const a = [...expected].sort((x, y) => x - y)
  const b = [...played].sort((x, y) => x - y)
  const shift = b[0] - a[0]
  if (shift === 0) return null
  return a.every((n, i) => b[i] - n === shift) ? shift : null
}

/** Nota esperada -> nome do dedo/mao pra UI. Pequeno, mas usado em dois lugares. */
export function noteLabel(e: ExpectedNote): string {
  return e.finger ? `${e.hand === 'l' ? 'ME' : 'MD'} ${e.finger}` : e.hand === 'l' ? 'ME' : 'MD'
}
