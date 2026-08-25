// Os 10 voicings do print, escritos como GRAUS (nao semitons) para que o mesmo
// desenho sirva em m7, 7 e maj7 sem repetir tabela.
//
// Sintaxe de um grau: numero + sufixo de oitava opcional.
//   "3"   = terca na oitava base
//   "3'"  = terca uma oitava acima
//   "5,"  = quinta uma oitava abaixo
// A alteracao (b3 vs 3, b7 vs 7) vem da qualidade do acorde, nao do token.

export type Quality = 'm7' | '7' | 'maj7'

export const QUALITIES: Quality[] = ['m7', '7', 'maj7']

export const QUALITY_LABEL: Record<Quality, string> = {
  m7: 'm7',
  '7': '7',
  maj7: 'maj7',
}

// Semitons acima da fundamental para cada grau, por qualidade.
const DEGREE_SEMITONES: Record<Quality, Record<number, number>> = {
  m7: { 1: 0, 3: 3, 5: 7, 7: 10, 9: 14, 11: 17, 13: 21 },
  '7': { 1: 0, 3: 4, 5: 7, 7: 10, 9: 14, 11: 18, 13: 21 }, // 11 = #11 em dominante
  maj7: { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14, 11: 18, 13: 21 }, // idem em maj7
}

export type Voicing = {
  id: string
  label: string
  qualities: Quality[]
  lh: string[]
  rh: string[]
  note?: string
}

// AJUSTE AQUI. Estes sao os valores de partida; se algum nao bater com o que
// voce pratica, mexer so nesta tabela — todo o resto do app deriva dela.
// Referencia: fundamental em C3 (MIDI 48).
export const VOICINGS: Voicing[] = [
  {
    id: 'shell-b',
    label: 'Shell B',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['3', '7'], // Cm7: C3 / Eb3 Bb3
  },
  {
    id: 'shell-a',
    label: 'Shell A',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['7', "3'"], // Cm7: C3 / Bb3 Eb4
  },
  {
    id: 'open',
    label: 'Open',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['7', "3'", "5'"], // Cm7: C3 / Bb3 Eb4 G4
  },
  {
    id: 'kenny-barron',
    label: 'Kenny Barron',
    qualities: ['m7'],
    lh: ['1', '5', '9'],
    rh: ["3'", "7'", "11'"], // Cm7: C3 G3 D4 / Eb4 Bb4 F5
    note: 'Duas quintas empilhadas em cada mao. So faz sentido em menor.',
  },
  {
    id: 'rootless-a',
    label: 'Rootless A',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ["3'", "5'", "7'", "9'"], // Cm7: C3 / Eb4 G4 Bb4 D5
    note: 'Bill Evans A: 3-5-7-9 a partir da terca.',
  },
  {
    id: 'rootless-b',
    label: 'Rootless B',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['7', '9', "3'", "5'"], // Cm7: C3 / Bb3 D4 Eb4 G4
    note: 'Bill Evans B: mesma nota, invertida a partir da setima.',
  },
  {
    id: 'crunch-1',
    label: 'Crunch 1',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['5', '7', '9', "3'"], // Cm7: C3 / G3 Bb3 D4 Eb4
    note: 'Cluster: 9 e 3 encostadas no topo.',
  },
  {
    id: 'crunch-2',
    label: 'Crunch 2',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['9', "3'", "5'", "7'"], // Cm7: C3 / D4 Eb4 G4 Bb4
    note: 'Mesmo cluster, agora com a 9 embaixo da 3.',
  },
  {
    id: 'fourths',
    label: '4ths',
    qualities: ['m7', '7'],
    lh: ['7', "3'"],
    rh: ["5'", "1''", "11''"], // Cm7: Bb3 Eb4 / G4 C5 F5
    note: 'Quartal.',
  },
  {
    id: 'so-what',
    label: 'So What',
    qualities: ['m7', '7'],
    lh: ['5,', '1'],
    rh: ['11,', '7', '9'], // Cm7: G2 C3 / F3 Bb3 D4
    note: 'Tres quartas justas + uma terca maior no topo.',
  },
]

export const VOICING_BY_ID = new Map(VOICINGS.map((v) => [v.id, v]))

const DEGREE_RE = /^(\d+)('*)(,*)$/

/** "3'" em m7 -> 15 semitons acima da fundamental. */
export function degreeToSemitones(token: string, quality: Quality): number {
  const m = DEGREE_RE.exec(token)
  if (!m) throw new Error(`grau invalido: ${token}`)
  const base = DEGREE_SEMITONES[quality][Number(m[1])]
  if (base === undefined) throw new Error(`grau ${m[1]} nao existe em ${quality}`)
  return base + 12 * (m[2].length - m[3].length)
}

/** Notas MIDI do voicing, ordenadas. rootMidi = fundamental (ex.: C3 = 48). */
export function voicingToMidi(voicing: Voicing, quality: Quality, rootMidi: number): number[] {
  return [...voicing.lh, ...voicing.rh]
    .map((d) => rootMidi + degreeToSemitones(d, quality))
    .sort((a, b) => a - b)
}

/** Offsets em semitons a partir da nota mais grave — a assinatura do voicing. */
export function voicingShape(voicing: Voicing, quality: Quality): number[] {
  const midi = voicingToMidi(voicing, quality, 0)
  return midi.map((n) => n - midi[0])
}
