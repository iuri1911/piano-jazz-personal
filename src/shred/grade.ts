import type { ExpectedNote } from './pattern'

// Grading one repetition.
//
// The question is not "did you stick to the click" — it is "did you play the
// right notes, in order, EVENLY spaced, at the tempo asked for". Sloppy shred is
// almost always on time on average and uneven in the detail, and that is what
// this metric catches.

export type PlayedNote = {
  midi: number
  velocity: number
  onTime: number
  offTime?: number
}

export type NoteStatus = 'matched' | 'missed'

export type GradeConfig = {
  bpm: number
  /** perf time of beat 0, from the transport. Without it the grid is estimated. */
  originMs?: number
  /** Fraction of errors tolerated. 0.02 = 2%. */
  maxErrorRate: number
  /** Ceiling on the coefficient of variation of the inter-onset intervals. */
  maxIoiCv: number
  /** Tempo deviation tolerated, as a fraction. 0.03 = 3%. */
  maxBpmDeviation: number
  /**
   * Does timing fail you? With false, evenness and tempo are still measured and
   * displayed, but they do not hold back a pass — this is the mode for someone
   * still memorizing the shape, who has no reason to fight the clock yet.
   */
  timingGates?: boolean
  /**
   * Where each beat SHOULD land, in ms since the start. The default is the
   * constant grid from the bpm; accel mode passes its own curve. Everything that
   * depends on expected time comes from here, so a varying tempo is no special case.
   */
  expectedMsAt?: (beat: number) => number
}

export type Grade = {
  /** State of each expected note, by index. */
  status: NoteStatus[]
  /** Index into `played` for each matched note, or -1. */
  matchOf: number[]
  missed: number
  /** Played notes that matched nothing: wrong or surplus. */
  extra: number
  errors: number
  accuracy: number
  /** Coefficient of variation of the normalized IOIs. The deciding metric. */
  ioiCv: number
  /** Deviation in ms of the interval ARRIVING at each group. Says which note drags. */
  perGroupDevMs: (number | null)[]
  effectiveBpm: number
  /** Mean absolute deviation from the metronome grid, in ms. Informational. */
  gridMadMs: number
  velocityStdev: number
  /** Mean spread within a group: how synchronized the two hands are, in ms. */
  handSpreadMs: number
  /**
   * Did anyone try to play this rep? An empty rep (adjusting the keyboard, reading
   * the screen, left the room) is not a performance error and must not pull the tempo down.
   */
  attempted: boolean
  /** Expected pitches that never came, and played ones that matched nothing. For the UI. */
  missedNotes: number[]
  extraNotes: number[]
  /**
   * If what was missing and what was extra line up by a constant offset, the
   * offset in semitones. This is the "I played it all an octave down" case, which
   * otherwise shows up as raw error while the player swears they got it right.
   */
  transposeHint: number | null
  passed: boolean
  /** Why it failed, so the UI can say what to fix. */
  reasons: string[]
}

/** How many groups ahead the matching looks in the normal case. */
const LOOKAHEAD = 3
/**
 * Wide search to find the line again after a stumble. Without it, skipping more
 * notes than LOOKAHEAD froze the cursor and turned ALL the rest of the rep into
 * "extra" — the player was right and the app called everything wrong. It only
 * kicks in after two consecutive unmatched onsets, otherwise one isolated wrong
 * note would send the cursor jumping ahead on its own.
 */
const RESYNC_LOOKAHEAD = 24
const RESYNC_AFTER = 2
/** Below this there is no talking about evenness. */
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
 * Matches played against expected, in order, with a short lookahead window.
 * One wrong note does not cascade: the algorithm finds the line again on the next
 * group instead of calling everything wrong from there on.
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
  let unmatched = 0

  const search = (note: PlayedNote, until: number): [number, number] => {
    for (let k = cursor; k < until; k++) {
      for (const e of groups[k].notes) {
        // Within a group the order does not matter: these are notes meant to sound
        // together, and MIDI always delivers one before the other.
        if (status[e.index] === 'missed' && matchOf[e.index] === -1 && e.midi === note.midi) {
          return [k, e.index]
        }
      }
    }
    return [-1, -1]
  }

  for (let p = 0; p < notes.length; p++) {
    const note = notes[p]
    let [hitGroup, hitIndex] = search(note, Math.min(groups.length, cursor + LOOKAHEAD + 1))

    if (hitGroup < 0 && unmatched >= RESYNC_AFTER - 1) {
      // Lost the line: open the window to find it again instead of calling
      // everything that follows an error.
      ;[hitGroup, hitIndex] = search(note, Math.min(groups.length, cursor + RESYNC_LOOKAHEAD + 1))
    }

    if (hitGroup < 0) {
      extra++
      unmatched++
      continue
    }
    unmatched = 0

    status[hitIndex] = 'matched'
    matchOf[hitIndex] = p
    cursor = hitGroup
    // Group complete: move on to the next one that still has a note pending.
    while (cursor < groups.length && groups[cursor].notes.every((e) => status[e.index] === 'matched')) {
      cursor++
    }
  }

  const missed = status.filter((s) => s === 'missed').length
  const errors = missed + extra
  const accuracy = expected.length ? (expected.length - missed) / expected.length : 0

  // --- timing ------------------------------------------------------------
  const beatMs = 60000 / config.bpm
  const expectedMsAt = config.expectedMsAt ?? ((beat: number) => beat * beatMs)

  // Onset of each group = its first matched note. A group with no matched note
  // breaks the chain and enters no IOI.
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
    // Normalizing by the expected interval lets the same metric serve a uniform
    // rhythm and an irregular grouping, with no special case.
    normalized.push((b - a) / expectedMs)
    rawIoi.push({ at: k, actual: b - a, expected: expectedMs })
  }

  const ioiMean = mean(normalized)
  const ioiCv = ioiMean > 0 ? stdev(normalized) / ioiMean : 0

  // Deviation in ms against the player's OWN average spacing, not against the
  // ideal: what matters is which note stands out, not that everything is slow.
  for (const r of rawIoi) {
    perGroupDevMs[r.at] = r.actual - r.expected * ioiMean
  }

  const firstIdx = onsets.findIndex((o) => o !== null)
  const lastIdx = onsets.length - 1 - [...onsets].reverse().findIndex((o) => o !== null)
  // Effective tempo as the ratio between how long THIS should have taken and how
  // long it did. With a constant bpm it gives the real bpm; with a curve, the
  // equivalent bpm.
  let effectiveBpm = 0
  if (firstIdx >= 0 && lastIdx > firstIdx) {
    const elapsed = (onsets[lastIdx] as number) - (onsets[firstIdx] as number)
    const span = expectedMsAt(groups[lastIdx].beat) - expectedMsAt(groups[firstIdx].beat)
    if (elapsed > 0 && span > 0) effectiveBpm = (config.bpm * span) / elapsed
  }

  // Grid: if the transport gave the instant of beat 0, measure against it.
  // Otherwise anchor on the first note — it becomes a measure of shape, not entry.
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
  // Compares the WHOLE performance, not what the matching left over: on a
  // transposed scale the matcher pairs several notes by diatonic coincidence, and
  // the residue never adds up — even though everything was played in the wrong octave.
  const transposeHint = detectTranspose(
    expected.map((e) => e.midi),
    notes.map((n) => n.midi),
  )

  // --- verdict -----------------------------------------------------------
  const reasons: string[] = []
  // Never zero: on a 17-note shape, 2% rounded down would demand a perfect
  // performance, and that is not practice, it is a lottery.
  const errorBudget = Math.max(1, Math.round(config.maxErrorRate * expected.length))
  const attempted = expected.length - missed >= Math.max(3, expected.length * 0.25)

  if (!attempted) {
    return {
      status, matchOf, missed, extra, errors, accuracy, ioiCv, perGroupDevMs,
      effectiveBpm, gridMadMs: mean(gridErrors), velocityStdev: stdev(velocities),
      handSpreadMs: mean(spreads), attempted, missedNotes, extraNotes, transposeHint,
      passed: false,
      reasons: ['rep with nothing played'],
    }
  }
  const judgeable = normalized.length >= MIN_GROUPS_FOR_TIMING - 1

  if (errors > errorBudget) {
    reasons.push(
      `${errors} error${errors > 1 ? 's' : ''} (${missed} missing, ${extra} extra) — limit ${errorBudget}`,
    )
    if (transposeHint !== null) {
      const octaves = transposeHint % 12 === 0 ? Math.abs(transposeHint) / 12 : 0
      reasons.push(
        octaves
          ? `you played the whole thing ${octaves} octave${octaves > 1 ? 's' : ''} ${transposeHint < 0 ? 'down' : 'up'}`
          : `you played the whole thing ${Math.abs(transposeHint)} semitones ${transposeHint < 0 ? 'down' : 'up'}`,
      )
    }
  }
  const timingGates = config.timingGates ?? true

  if (!timingGates) {
    // No timing enters the verdict.
  } else if (!judgeable) {
    reasons.push('too few notes to measure evenness')
  } else {
    if (ioiCv > config.maxIoiCv) {
      reasons.push(`uneven: CV ${(ioiCv * 100).toFixed(1)}% — limit ${(config.maxIoiCv * 100).toFixed(0)}%`)
    }
    const drift = Math.abs(effectiveBpm - config.bpm) / config.bpm
    if (drift > config.maxBpmDeviation) {
      reasons.push(
        `off tempo: ${Math.round(effectiveBpm)} BPM against the ${Math.round(config.bpm)} asked for`,
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
 * Is what was played the expected shape shifted by a constant?
 * Compares as a sorted set, so it does not depend on the arrival order of notes
 * that sound together. Returns the offset in semitones, or null.
 */
export function detectTranspose(expected: number[], played: number[]): number | null {
  if (expected.length < 3 || expected.length !== played.length) return null
  const a = [...expected].sort((x, y) => x - y)
  const b = [...played].sort((x, y) => x - y)
  const shift = b[0] - a[0]
  if (shift === 0) return null
  return a.every((n, i) => b[i] - n === shift) ? shift : null
}

/** Expected note -> finger/hand label for the UI. Small, but used in two places. */
export function noteLabel(e: ExpectedNote): string {
  return e.finger ? `${e.hand === 'l' ? 'LH' : 'RH'} ${e.finger}` : e.hand === 'l' ? 'LH' : 'RH'
}
