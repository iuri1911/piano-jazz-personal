// The 10 voicings, written as DEGREES (not semitones) so that the same shape
// works over m7, 7 and maj7 without repeating the table.
//
// Syntax of a degree: number + optional octave suffix.
//   "3"   = third in the base octave
//   "3'"  = third one octave up
//   "5,"  = fifth one octave down
// The alteration (b3 vs 3, b7 vs 7) comes from the chord quality, not the token.

export type Quality = 'm7' | '7' | 'maj7'

export const QUALITIES: Quality[] = ['m7', '7', 'maj7']

export const QUALITY_LABEL: Record<Quality, string> = {
  m7: 'm7',
  '7': '7',
  maj7: 'maj7',
}

// Semitones above the root for each degree, by quality.
const DEGREE_SEMITONES: Record<Quality, Record<number, number>> = {
  m7: { 1: 0, 3: 3, 5: 7, 7: 10, 9: 14, 11: 17, 13: 21 },
  '7': { 1: 0, 3: 4, 5: 7, 7: 10, 9: 14, 11: 18, 13: 21 }, // 11 = #11 on a dominant
  maj7: { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14, 11: 18, 13: 21 }, // same on maj7
}

export type Voicing = {
  id: string
  label: string
  qualities: Quality[]
  lh: string[]
  rh: string[]
  note?: string
}

// TWEAK HERE. These are the starting values; if one does not match what you
// practise, edit only this table — the rest of the app derives from it.
// Reference: root at C3 (MIDI 48).
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
    note: 'Two stacked fifths in each hand. Only makes sense on a minor chord.',
  },
  {
    id: 'rootless-a',
    label: 'Rootless A',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ["3'", "5'", "7'", "9'"], // Cm7: C3 / Eb4 G4 Bb4 D5
    note: 'Bill Evans A: 3-5-7-9 starting from the third.',
  },
  {
    id: 'rootless-b',
    label: 'Rootless B',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['7', '9', "3'", "5'"], // Cm7: C3 / Bb3 D4 Eb4 G4
    note: 'Bill Evans B: same notes, inverted to start from the seventh.',
  },
  {
    id: 'crunch-1',
    label: 'Crunch 1',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['5', '7', '9', "3'"], // Cm7: C3 / G3 Bb3 D4 Eb4
    note: 'Cluster: 9 and 3 rubbing against each other at the top.',
  },
  {
    id: 'crunch-2',
    label: 'Crunch 2',
    qualities: QUALITIES,
    lh: ['1'],
    rh: ['9', "3'", "5'", "7'"], // Cm7: C3 / D4 Eb4 G4 Bb4
    note: 'Same cluster, now with the 9 below the 3.',
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
    note: 'Three perfect fourths + a major third on top.',
  },
]

export const VOICING_BY_ID = new Map(VOICINGS.map((v) => [v.id, v]))

const DEGREE_RE = /^(\d+)('*)(,*)$/

/** "3'" on m7 -> 15 semitones above the root. */
export function degreeToSemitones(token: string, quality: Quality): number {
  const m = DEGREE_RE.exec(token)
  if (!m) throw new Error(`invalid degree: ${token}`)
  const base = DEGREE_SEMITONES[quality][Number(m[1])]
  if (base === undefined) throw new Error(`degree ${m[1]} does not exist on ${quality}`)
  return base + 12 * (m[2].length - m[3].length)
}

/** MIDI notes of the voicing, sorted. rootMidi = root (e.g. C3 = 48). */
export function voicingToMidi(voicing: Voicing, quality: Quality, rootMidi: number): number[] {
  return [...voicing.lh, ...voicing.rh]
    .map((d) => rootMidi + degreeToSemitones(d, quality))
    .sort((a, b) => a - b)
}

/** Semitone offsets from the lowest note — the signature of the voicing. */
export function voicingShape(voicing: Voicing, quality: Quality): number[] {
  const midi = voicingToMidi(voicing, quality, 0)
  return midi.map((n) => n - midi[0])
}
