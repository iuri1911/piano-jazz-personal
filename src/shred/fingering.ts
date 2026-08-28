import { sourceSteps, type Fingering, type Source } from './pattern'

// FINGERING, KEY BY KEY.
//
// The one rule every chart agrees on: the thumb does not go on a black key. It
// is short and the black keys are further in, so a scale or arpeggio does not
// keep the same fingering when it is transposed — what moves is the crossing
// point. That is why a table indexed only by degree, as this file used to be,
// is right in C and wrong in F.
//
// Two different things live here:
//
//  - Shapes with a tradition — the major scale and the triad arpeggio — get the
//    fingering written out key by key, the way the charts have it. There is no
//    formula behind it: the classical fingerings also swap 3 for 4 on black
//    keys, which no rotation would produce.
//  - Shapes with no tradition — pentatonic, blues, whole tone, seventh
//    arpeggios — get the written cycle ROTATED so the thumb lands on white.
//    The cycle is the same in every key; only where it starts changes.

/** Pitch classes of the white keys. */
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11])

// --- The tables with a tradition -------------------------------------------

type Hands = { fingers: number[]; lh: number[] }

/** C G D A E: the major scale shape everybody learns first. */
const PLAIN: Hands = { fingers: [1, 2, 3, 1, 2, 3, 4], lh: [1, 4, 3, 2, 1, 3, 2] }
/** Db Eb Ab Bb: same left hand, the right hand starts on a different finger. */
const FLAT_LH = [3, 2, 1, 4, 3, 2, 1]

/**
 * Standard major scale fingering. Written byDegree, i.e. indexed by scale
 * degree, so it repeats octave after octave. The one-octave charts carry an
 * eighth number for the top note (the right hand ends on 5 in C, the left
 * starts on 5) — that is a note at the end of the run, not a degree, and it
 * does not belong in a table that loops.
 */
export const MAJOR_SCALE_FINGERING: Fingering = {
  kind: 'byDegree',
  fingers: PLAIN.fingers,
  lh: PLAIN.lh,
  byRoot: {
    0: PLAIN, // C
    1: { fingers: [2, 3, 1, 2, 3, 4, 1], lh: FLAT_LH }, // Db
    2: PLAIN, // D
    3: { fingers: [3, 1, 2, 3, 4, 1, 2], lh: FLAT_LH }, // Eb
    4: PLAIN, // E
    5: { fingers: [1, 2, 3, 4, 1, 2, 3], lh: PLAIN.lh }, // F: 4 on the Bb, crossing one degree later
    6: { fingers: [2, 3, 4, 1, 2, 3, 1], lh: [4, 3, 2, 1, 3, 2, 1] }, // Gb/F#
    7: PLAIN, // G
    8: { fingers: [3, 4, 1, 2, 3, 1, 2], lh: FLAT_LH }, // Ab
    9: PLAIN, // A
    10: { fingers: [4, 1, 2, 3, 1, 2, 3], lh: FLAT_LH }, // Bb
    11: { fingers: PLAIN.fingers, lh: [1, 3, 2, 1, 4, 3, 2] }, // B: right hand as C, left hand its own
  },
}

/**
 * Major triad arpeggio, root position. Three degrees, so the cycle repeats
 * every octave and the 5 at the top is only the last note of the run. Gb is
 * the exception the charts admit: the triad has no white note, so the thumb has
 * nowhere else to go.
 */
export const MAJOR_TRIAD_ARPEGGIO_FINGERING: Fingering = {
  kind: 'byDegree',
  fingers: [1, 2, 3],
  lh: [1, 4, 2],
  byRoot: {
    0: { fingers: [1, 2, 3], lh: [1, 4, 2] }, // C
    1: { fingers: [4, 1, 2], lh: [2, 1, 4] }, // Db
    2: { fingers: [1, 2, 3], lh: [1, 3, 2] }, // D: 3 on the black third
    3: { fingers: [4, 1, 2], lh: [2, 1, 4] }, // Eb
    4: { fingers: [1, 2, 3], lh: [1, 3, 2] }, // E
    5: { fingers: [1, 2, 3], lh: [1, 4, 2] }, // F
    6: { fingers: [1, 2, 3], lh: [1, 3, 2] }, // Gb: no white note in the triad
    7: { fingers: [1, 2, 3], lh: [1, 4, 2] }, // G
    8: { fingers: [4, 1, 2], lh: [2, 1, 4] }, // Ab
    9: { fingers: [1, 2, 3], lh: [1, 3, 2] }, // A
    10: { fingers: [4, 1, 2], lh: [3, 2, 1] }, // Bb
    11: { fingers: [1, 2, 3], lh: [1, 3, 2] }, // B
  },
}

// --- The rotation, for everything else --------------------------------------

/** The same cycle starting `r` degrees later. */
function rotate(base: number[], r: number): number[] {
  const n = base.length
  return base.map((_, d) => base[(((d - r) % n) + n) % n])
}

function thumbsOnWhite(steps: number[], list: number[], rootPc: number): number {
  return list.filter((f, d) => f === 1 && WHITE.has((rootPc + steps[d]) % 12)).length
}

/**
 * Where the cycle should start in this key. The most thumbs on white wins; if
 * the pattern as written already achieves it, nothing moves. On a tie the hands
 * disagree on purpose: going up, the right hand crosses the thumb UNDER as soon
 * as it can and the left hand crosses OVER as late as it can — which is exactly
 * what the seventh arpeggio charts do (Bb7: right thumb on the D, left on the F).
 */
function chooseRotation(steps: number[], base: number[], rootPc: number, hand: 'l' | 'r'): number {
  const scores = base.map((_, r) => thumbsOnWhite(steps, rotate(base, r), rootPc))
  const best = Math.max(...scores)
  if (scores[0] === best) return 0
  const winners = scores.flatMap((s, r) => (s === best ? [r] : []))
  return hand === 'r' ? winners[0] : winners[winners.length - 1]
}

/**
 * Takes the cycle written for C and turns it into the 12 keys, moving only the
 * starting point. Where the shape has no white note at all — Eb minor
 * pentatonic, Ebm7 — nothing can be done and what is written stands.
 */
export function thumbOnWhite(source: Source, base: { fingers: number[]; lh?: number[] }): Fingering {
  const steps = sourceSteps(source)
  const byRoot: NonNullable<Fingering['byRoot']> = {}
  for (let pc = 0; pc < 12; pc++) {
    const lh = base.lh
    byRoot[pc] = {
      fingers: rotate(base.fingers, chooseRotation(steps, base.fingers, pc, 'r')),
      ...(lh ? { lh: rotate(lh, chooseRotation(steps, lh, pc, 'l')) } : {}),
    }
  }
  return { kind: 'byDegree', ...base, byRoot }
}
