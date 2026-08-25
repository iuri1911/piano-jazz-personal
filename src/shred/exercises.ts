import type { PatternSpec } from './pattern'

// THE LIBRARY. Single source of truth for the exercises — editing here changes
// the whole app, same as the voicings table. Each entry says what it trains and
// WHY it exists: a speed exercise without a purpose is just fast noise.

export type Family = 'technique' | 'prog' | 'guitar' | 'bebop'

export const FAMILY_LABEL: Record<Family, string> = {
  technique: 'Technique',
  prog: 'Prog / ELP',
  guitar: 'Guitar',
  bebop: 'Bebop',
}

export type Level = 1 | 2 | 3 | 4 | 5

export const LEVEL_LABEL: Record<Level, string> = {
  1: '1 · Foundation',
  2: '2 · Scales',
  3: '3 · Sequences',
  4: '4 · Symmetry',
  5: '5 · Hands',
}

/**
 * What counts as clean at each level. Only the CV tightens: wrong notes never
 * get cheaper. CV 0.07 at level 5 is ~9ms of deviation on a sixteenth at 160 —
 * hard, and that is the point.
 */
export const LEVEL_TOLERANCE: Record<Level, { maxIoiCv: number; maxErrorRate: number }> = {
  1: { maxIoiCv: 0.14, maxErrorRate: 0.03 },
  2: { maxIoiCv: 0.12, maxErrorRate: 0.03 },
  3: { maxIoiCv: 0.1, maxErrorRate: 0.03 },
  4: { maxIoiCv: 0.08, maxErrorRate: 0.03 },
  5: { maxIoiCv: 0.07, maxErrorRate: 0.03 },
}

/** How permissive the verdict is, on top of the level default. */
export type Strictness = 'learning' | 'loose' | 'standard' | 'strict'

export const STRICTNESS_LABEL: Record<Strictness, string> = {
  learning: 'learning',
  loose: 'loose',
  standard: 'level default',
  strict: 'strict',
}

export const STRICTNESS_HELP: Record<Strictness, string> = {
  learning:
    'Only the notes count. Evenness and tempo are still measured and shown on screen, but they do not fail you — for while you are still memorizing the shape.',
  loose: 'Wide tolerance on everything. Good for a new tempo, where the hand is still sorting itself out.',
  standard: 'The limit for the level of the exercise.',
  strict: 'Tightens all three limits. Use it to confirm a tempo really is under control.',
}

export type Tolerance = {
  maxErrorRate: number
  maxIoiCv: number
  maxBpmDeviation: number
  timingGates: boolean
}

/**
 * The exercise level gives the baseline; the chosen strictness scales from it.
 * That way "loose" is still tighter on a level 5 exercise than on a level 1 one,
 * which is what makes sense.
 */
export function toleranceFor(level: Level, strictness: Strictness): Tolerance {
  const base = LEVEL_TOLERANCE[level]
  switch (strictness) {
    case 'learning':
      return { maxErrorRate: base.maxErrorRate * 3, maxIoiCv: 1, maxBpmDeviation: 1, timingGates: false }
    case 'loose':
      return {
        maxErrorRate: base.maxErrorRate * 2,
        maxIoiCv: base.maxIoiCv * 1.6,
        maxBpmDeviation: 0.1,
        timingGates: true,
      }
    case 'standard':
      return { ...base, maxBpmDeviation: 0.05, timingGates: true }
    case 'strict':
      return {
        maxErrorRate: base.maxErrorRate * 0.5,
        maxIoiCv: base.maxIoiCv * 0.75,
        maxBpmDeviation: 0.03,
        timingGates: true,
      }
  }
}

export type Exercise = {
  id: string
  label: string
  family: Family
  level: Level
  /** One line: what the hand learns here. */
  focus: string
  /** Why the exercise exists and how to practise it. Shown on screen. */
  note: string
  pattern: PatternSpec
  tempos: { start: number; target: number }
  beatsPerBar: number
}

const C3 = 48
const C4 = 60

export const EXERCISES: Exercise[] = [
  // --- Level 1: foundation -------------------------------------------------
  {
    id: 'five-finger',
    label: 'Five fingers in one position',
    family: 'technique',
    level: 1,
    focus: 'Finger independence, even attack',
    note: 'C D E F G F E D C, both hands an octave apart. The goal is not speed — it is finger 4 coming out as strong as the others. Watch the attack unevenness number: if it does not drop, raising the BPM only records the flaw faster. Wrist still, fingers barely lifting.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'literal', degrees: [0, 1, 2, 3, 4, 3, 2, 1] },
      hands: { kind: 'unison', octaveGap: 1 },
      octaves: 1,
      direction: 'up',
      subdivision: 2,
      anchorC: C4,
      reps: 4,
      // Exact mirror: the hands make the same movement in opposite directions.
      fingering: {
        kind: 'bySequence',
        fingers: [1, 2, 3, 4, 5, 4, 3, 2],
        lh: [5, 4, 3, 2, 1, 2, 3, 4],
      },
    },
    tempos: { start: 60, target: 120 },
    beatsPerBar: 4,
  },
  {
    id: 'hanon-1',
    label: 'Hanon nº 1',
    family: 'technique',
    level: 1,
    focus: 'Stamina, the 8-note figure climbing',
    note: 'The figure climbs one degree at a time. It is boring on purpose: the value is in surviving the repetition without the hand stiffening up. If the forearm tires, stop — accumulated tension is what caps speed, not lack of practice.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'shape', degrees: [0, 2, 3, 4, 5, 4, 3, 2], step: 1 },
      hands: { kind: 'unison', octaveGap: 1 },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C4,
      fingering: {
        kind: 'bySequence',
        fingers: [1, 2, 3, 4, 5, 4, 3, 2],
        lh: [5, 4, 3, 2, 1, 2, 3, 4],
      },
    },
    tempos: { start: 60, target: 132 },
    beatsPerBar: 4,
  },
  {
    id: 'broken-triad',
    label: 'Broken triad',
    family: 'technique',
    level: 1,
    focus: 'Thumb crossing without an accent',
    note: 'Fingering 1-2-3-5 going up. The classic mistake is the thumb hitting harder than the rest as the octave turns over — the app measures that. Think of rotating the forearm instead of stretching the thumb.',
    pattern: {
      source: { kind: 'chord', name: '' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 3,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3], lh: [1, 4, 2] },
    },
    tempos: { start: 66, target: 144 },
    beatsPerBar: 4,
  },

  // --- Level 2: scales and the thumb ---------------------------------------
  {
    id: 'major-scale-2oct',
    label: 'Major scale, 2 octaves',
    family: 'technique',
    level: 2,
    focus: 'The thumb crossing at speed',
    note: 'The most revealing exercise on the list. Almost everyone has a timing hole right after the thumb crosses, and the per-note reading shows exactly which degree it is. If the diagnosis keeps pointing at the same note, the problem is mechanical: prepare the thumb BEFORE, under the palm, instead of stretching for it at the last moment.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      // Major scale: the left hand does not follow from the right by any formula —
      // they are two different shapes that happen to close on the same octave.
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3, 4], lh: [1, 4, 3, 2, 1, 3, 2] },
    },
    tempos: { start: 80, target: 152 },
    beatsPerBar: 4,
  },
  {
    id: 'pentatonic-box',
    label: 'Minor pentatonic, box',
    family: 'guitar',
    level: 2,
    focus: 'The guitar box translated to the keyboard',
    note: 'A C D E G — the first pentatonic box, the one every guitarist plays. On the keyboard it does not fall under the hand the same way, which is why it is worth isolating: it alternates tone and third leaps, and the fingering changes every octave. Memorize the shape before speeding up.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2] },
    },
    tempos: { start: 84, target: 168 },
    beatsPerBar: 4,
  },
  {
    id: 'seventh-arpeggio',
    label: 'Seventh arpeggio, 2 octaves',
    family: 'bebop',
    level: 2,
    focus: 'Wide leap with a relaxed hand',
    note: 'Minor seventh arpeggio. Unlike a scale, here the hand OPENS — and the wrong reflex is to clench. Play with the arm carrying the hand, not with the finger stretching. This is the same chord you drill on the Drill tab, now laid out horizontally.',
    pattern: {
      source: { kind: 'chord', name: 'm7' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 4] },
    },
    tempos: { start: 80, target: 160 },
    beatsPerBar: 4,
  },

  // --- Level 3: sequences --------------------------------------------------
  {
    id: 'pent-seq4',
    label: 'Groups of 4 on the pentatonic',
    family: 'guitar',
    level: 3,
    focus: 'The guitar shred pattern',
    note: '0123 1234 2345... In sixteenths this IS the generic rock lick — Zakk Wylde, Paul Gilbert, any fast pentatonic solo. Since the group has 4 notes and the beat has 4, the accent always lands in the same place: it is the easiest of the sequenced patterns to feel. Start here.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'shape', degrees: [0, 1, 2, 3], step: 1 },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2] },
    },
    tempos: { start: 90, target: 176 },
    beatsPerBar: 4,
  },
  {
    id: 'scale-thirds',
    label: 'Scale in thirds',
    family: 'technique',
    level: 3,
    focus: 'Breaking the dependence on stepwise motion',
    note: '1-3-2-4-3-5. A hand that only walks by neighbouring degrees seizes up here, and that is exactly what we want to find out. Thirds at speed are what make a scale sound like a phrase instead of an exercise.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'skip', interval: 2 },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3, 4] },
    },
    tempos: { start: 80, target: 152 },
    beatsPerBar: 4,
  },
  {
    id: 'blues-run',
    label: 'Blues run with the blue note',
    family: 'prog',
    level: 3,
    focus: 'Pentatonic + b5 at speed',
    note: 'Minor pentatonic with the flat fifth in the middle. It is Keith Emerson\'s language in the fast sections of Rondo and Tarkus. The b5 is chromatic against its neighbours, so the fingering bunches up there — and that is where the timing slips.',
    pattern: {
      source: { kind: 'scale', name: 'blues' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3] },
    },
    tempos: { start: 88, target: 176 },
    beatsPerBar: 4,
  },

  // --- Level 4: symmetry and displacement ----------------------------------
  {
    id: 'dim7-arpeggio',
    label: 'Diminished arpeggio',
    family: 'prog',
    level: 4,
    focus: 'Symmetric shape: speed almost for free',
    note: 'The dim7 repeats the same hand shape every 3 semitones — there is no "hard position". That is why Emerson, Rudess and the Bach both of them took it from lean on it so heavily: it yields a lot of notes per unit of effort. Practise it in only four keys (C, Db, D, Eb): the other eight are the same.',
    pattern: {
      source: { kind: 'chord', name: 'dim7' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 3,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 4], lh: [1, 4, 3, 2] },
    },
    tempos: { start: 100, target: 200 },
    beatsPerBar: 4,
  },
  {
    id: 'whole-tone',
    label: 'Whole tone scale',
    family: 'prog',
    level: 4,
    focus: 'Constant fingering, no landmark',
    note: 'Six identical steps, not a semitone anywhere: the hand makes the same movement at any point. Easy to run, hard not to get lost in — with no half step there is nothing to anchor to. Good for raw speed and for a science-fiction soundtrack colour.',
    pattern: {
      source: { kind: 'scale', name: 'whole tone' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3] },
    },
    tempos: { start: 100, target: 184 },
    beatsPerBar: 4,
  },
  {
    id: 'fourths-run',
    label: 'Fourths through the scale',
    family: 'prog',
    level: 4,
    focus: 'Wide interval at speed',
    note: 'Climbs the scale leaping a fourth at a time. The ELP and McCoy Tyner sound. The hand opens and closes constantly, and the challenge is not letting the opening turn into an accent. If the top note always comes out louder, drop the BPM.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'skip', interval: 3 },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'bySequence', fingers: [1, 4] },
    },
    tempos: { start: 84, target: 160 },
    beatsPerBar: 4,
  },
  {
    id: 'group5-over-4',
    label: 'Groups of 5 over a subdivision of 4',
    family: 'prog',
    level: 4,
    focus: 'Metric displacement',
    note: 'The shape has 5 notes, the click has 4 per beat: the start of the group walks through the bar and only returns to beat 1 after 5 beats. It is the Dream Theater metric trick. Watch the piano roll while you play — you can SEE the accent walking, and that is how you learn to feel it.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'shape', degrees: [0, 1, 2, 3, 4], step: 1 },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2] },
    },
    tempos: { start: 76, target: 152 },
    beatsPerBar: 4,
  },

  // --- Level 5: hands and stamina ------------------------------------------
  {
    id: 'hand-to-hand-octaves',
    label: 'Hand-to-hand octaves',
    family: 'prog',
    level: 5,
    focus: 'Maximum speed with minimum effort',
    note: 'Every note of the scale comes out twice: right hand, then left hand an octave below. Since each hand plays half the notes, you can reach tempos one hand alone cannot — this is how the fast ELP passages get played without destroying the forearm. Hands close together, small movements. No fingering on screen: with the hands alternating note by note, the finger depends on where the hand is arriving, not on the note — use 2 or 3 and let the forearm rotate.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'shape', degrees: [0, 0], step: 1 },
      hands: { kind: 'alternate', unit: 1, lhOctaveShift: -1 },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C4,
    },
    tempos: { start: 100, target: 200 },
    beatsPerBar: 4,
  },
  {
    id: 'toccata',
    label: 'Toccata: alternating hands',
    family: 'prog',
    level: 5,
    focus: 'A Bach-like figure split between the hands',
    note: 'Minor arpeggio with the hands alternating note by note, the left an octave below. It is the mechanic behind the ELP Toccata and half a dozen Rudess pieces. The risk is one hand sitting systematically behind the other: the app measures the interval note by note, so a repeating step in the diagnosis means uneven hands, not a lack of speed. No fingering on screen: each hand takes alternating notes of the arpeggio, so the finger changes with the hand, and a wrong number gets in the way more than no number at all.',
    pattern: {
      source: { kind: 'chord', name: 'm' },
      motion: { kind: 'run' },
      hands: { kind: 'alternate', unit: 1, lhOctaveShift: -1 },
      // 2 octaves, not 3: with the hands an octave apart, 3 octaves need 48
      // semitones and a 49-key controller has exactly 48 — it would only fit in C.
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C4,
      reps: 2,
    },
    tempos: { start: 96, target: 184 },
    beatsPerBar: 4,
  },
  {
    id: 'ostinato-lick',
    label: 'Ostinato in the left + lick in the right',
    family: 'prog',
    level: 5,
    focus: 'Real independence between the hands',
    note: 'The left hand repeats two notes per bar while the right runs in sixteenths. Real independence: the left has to become automatic to the point where you forget about it. If the right starts dragging the left into its rhythm, take the BPM back down. No fingering on screen: the two hands are doing different things at once and each one wants its own.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'shape', degrees: [0, 1, 2, 3], step: 1 },
      // -1 and not -2: with the right hand at C4 and a two-octave pattern, dropping
      // the left two octaves runs off the bottom of a 49-key controller outside C.
      hands: { kind: 'ostinato', degrees: [0, 4], subdivision: 1, octaveShift: -1 },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C4,
    },
    tempos: { start: 80, target: 152 },
    beatsPerBar: 4,
  },
  {
    id: 'bebop-enclosure',
    label: 'Chromatic enclosure over an arpeggio',
    family: 'bebop',
    level: 5,
    focus: 'Jazz line vocabulary at speed',
    note: 'Every note of the m7 arpeggio arrives enclosed: the note above, the semitone below, and only then the target. It is the core of the bebop line, and at speed it is what separates running a scale from playing a phrase. The semitones bunch the hand up — the fingering changes on every enclosure, and that is fine. No fingering on screen: a chromatic enclosure changes shape in every key, so here the fingering is yours.',
    pattern: {
      // Enclosure over C Eb G Bb: (D B C) (F D Eb) (A F# G) (C A Bb).
      source: { kind: 'semitones', steps: [2, -1, 0, 5, 2, 3, 9, 6, 7, 12, 9, 10] },
      motion: { kind: 'literal', degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      hands: { kind: 'rh' },
      octaves: 1,
      direction: 'up',
      subdivision: 4,
      anchorC: C3,
      reps: 2,
    },
    tempos: { start: 76, target: 152 },
    beatsPerBar: 4,
  },
]

export const EXERCISE_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]))
