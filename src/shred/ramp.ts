// How the tempo climbs, and the session modes.

export type Mode = 'ladder' | 'burst' | 'accel' | 'free'

export const MODE_LABEL: Record<Mode, string> = {
  ladder: 'Ladder',
  burst: 'Burst',
  accel: 'Accelerating',
  free: 'Free',
}

export const MODE_HELP: Record<Mode, string> = {
  ladder: 'N clean reps raise the BPM; two failures bring it down. The standard protocol.',
  burst: 'Play one rep, rest one. It lets you go above comfortable without accumulating tension — this is how a speed barrier comes down.',
  accel: 'The click accelerates from the starting tempo to the target over the session. Shows the BPM where you break.',
  free: 'Metronome only, no grading.',
}

export type RampConfig = {
  minBpm: number
  maxBpm: number
  /** How much it climbs and drops, in BPM. Applies to the ramp and the buttons. */
  stepBpm: number
  /** Consecutive clean reps needed to move up. */
  repsToAdvance: number
  /** Consecutive failures needed to move down. */
  repsToRetreat: number
}

export const DEFAULT_RAMP: RampConfig = {
  minBpm: 40,
  maxBpm: 240,
  stepBpm: 10,
  repsToAdvance: 2,
  repsToRetreat: 2,
}

export type RampState = {
  bpm: number
  cleanStreak: number
  failStreak: number
  /** Highest BPM at which a rep passed in this session. */
  bestCleanBpm: number
}

export function newRamp(bpm: number): RampState {
  return { bpm, cleanStreak: 0, failStreak: 0, bestCleanBpm: 0 }
}

export type RampEvent = 'up' | 'down' | 'hold'

/**
 * Applies the result of one rep. Pure: a tempo decision is exactly the kind of
 * thing that goes silently wrong inside an effect.
 */
export function nextRamp(
  state: RampState,
  passed: boolean,
  config: RampConfig = DEFAULT_RAMP,
): { state: RampState; event: RampEvent } {
  if (passed) {
    const bestCleanBpm = Math.max(state.bestCleanBpm, state.bpm)
    const cleanStreak = state.cleanStreak + 1
    if (cleanStreak >= config.repsToAdvance) {
      return {
        state: {
          bpm: Math.min(config.maxBpm, state.bpm + config.stepBpm),
          cleanStreak: 0,
          failStreak: 0,
          bestCleanBpm,
        },
        event: 'up',
      }
    }
    return { state: { ...state, cleanStreak, failStreak: 0, bestCleanBpm }, event: 'hold' }
  }

  const failStreak = state.failStreak + 1
  if (failStreak >= config.repsToRetreat) {
    // Drops one step, the same one it would climb: the tempo moves on a single
    // grid, and you always know where it is going before it happens.
    return {
      state: {
        bpm: Math.max(config.minBpm, state.bpm - config.stepBpm),
        cleanStreak: 0,
        failStreak: 0,
        bestCleanBpm: state.bestCleanBpm,
      },
      event: 'down',
    }
  }
  return { state: { ...state, cleanStreak: 0, failStreak }, event: 'hold' }
}

/**
 * Tempo curve for accel mode: the BPM climbs linearly per BEAT (not per second).
 * Returns where each beat lands in ms.
 *
 * It reproduces the transport step by step — which schedules each beat with the
 * duration of that beat's BPM — instead of the exact integral. If the two
 * calculations diverged, grading would report a drag where the player was right.
 */
export function accelCurve(
  startBpm: number,
  endBpm: number,
  totalBeats: number,
): (beat: number) => number {
  const n = Math.max(1, Math.ceil(totalBeats))
  const cum: number[] = [0]
  for (let i = 0; i < n; i++) {
    cum.push(cum[i] + 60000 / bpmAtBeat(startBpm, endBpm, totalBeats, i))
  }
  return (beat: number) => {
    if (beat <= 0) return 0
    const i = Math.floor(beat)
    if (i >= n) return cum[n] + (beat - n) * (60000 / endBpm)
    return cum[i] + (beat - i) * (cum[i + 1] - cum[i])
  }
}

export function bpmAtBeat(
  startBpm: number,
  endBpm: number,
  totalBeats: number,
  beat: number,
): number {
  if (totalBeats <= 0) return startBpm
  const t = Math.min(1, Math.max(0, beat / totalBeats))
  return startBpm + (endBpm - startBpm) * t
}

/** Where the tempo goes on the next climb and the next drop. */
export function rampTargets(
  state: RampState,
  config: RampConfig = DEFAULT_RAMP,
): { up: number; down: number } {
  return {
    up: Math.min(config.maxBpm, state.bpm + config.stepBpm),
    down: Math.max(config.minBpm, state.bpm - config.stepBpm),
  }
}
