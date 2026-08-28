import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, type KeyMark } from '../Keyboard'
import { rootAt, type Order } from '../keys'
import { useMidiEvents, type MidiEvent } from '../midi'
import { midiToName, pitchClassName, type Spelling } from '../theory'
import { Transport, type Beat } from './clock'
import {
  EXERCISES,
  EXERCISE_BY_ID,
  FAMILY_LABEL,
  LEVEL_LABEL,
  STRICTNESS_HELP,
  STRICTNESS_LABEL,
  toleranceFor,
  type Level,
  type Strictness,
} from './exercises'
import { grade, type Grade, type PlayedNote } from './grade'
import { HAND_MODE_LABEL, applyHandMode, expandPattern, type HandMode } from './pattern'
import { PianoRoll, type PlayedMark } from './PianoRoll'
import {
  ABS_MIN_BPM,
  DEFAULT_RAMP,
  LOCKED,
  MODE_HELP,
  MODE_LABEL,
  bpmAtBeat,
  newRamp,
  nextRamp,
  rampTargets,
  type Mode,
} from './ramp'
import {
  DEFAULT_SETTINGS,
  bestPrFor,
  clearShredStats,
  diagnosisFor,
  loadSettings,
  loadShredStats,
  prFor,
  recordRep,
  recordSession,
  saveSettings,
  worstGroups,
  type ShredStats,
} from './shredStats'
import { QWERTY_HELP, useComputerKeyboard } from './qwerty'

/**
 * Grace at each end of the rep, as a fraction of a beat. A quarter of a beat is
 * generous enough for a boundary note and short enough not to spill into the
 * next rep.
 */
const GRACE_BEATS = 0.25
const graceMs = (bpm: number) => (60000 / bpm) * GRACE_BEATS

/**
 * How far before the end of the rep the boundary with the next one sits, in beats.
 *
 * The exercise loops, so the next rep's first note lands exactly on repEnd. A
 * trailing grace therefore swallowed it: counted "extra" here, and — because the
 * window is also what gets discarded — "missing" over there, on every rep after
 * the first. Two guaranteed errors a rep, which is more than the whole budget of a
 * short exercise: the broken triad has 12 notes and a budget of 1, so playing it
 * perfectly failed every time.
 *
 * The cut belongs halfway between the last onset of this rep and the first of the
 * next, never further out than GRACE_BEATS. Both reps use the same cut, so every
 * note is graded exactly once.
 */
export function boundaryBeats(repBeats: number, lastBeat: number): number {
  return Math.min(GRACE_BEATS, Math.max(0, (repBeats - lastBeat) / 2))
}
/** How many reps accel mode takes to go from the start tempo to the target. */
const ACCEL_REPS = 8

type Phase = 'idle' | 'countin' | 'playing' | 'resting' | 'demo'

const ORDERS = ['fourths', 'chromatic', 'random'] as const
const MODES = ['ladder', 'burst', 'accel', 'free'] as const
const HAND_MODES = ['as-is', 'rh', 'lh', 'both'] as const

/** A saved value that no longer exists (old version, edited storage) falls back to the default. */
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** How many reps already count toward the next tempo step. */
function Dots({ on, total }: { on: number; total: number }) {
  return (
    <span className="dots" aria-label={`${on} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < on ? 'dot on' : 'dot'} />
      ))}
    </span>
  )
}

/** Short list of pitches, without dumping 60 names into the bar. */
function noteNames(midi: number[], spelling: Spelling): string {
  const unique = [...new Set(midi)]
  const shown = unique.slice(0, 6).map((n) => midiToName(n, spelling)).join(' ')
  return unique.length > 6 ? `${shown} +${unique.length - 6}` : shown
}

type Props = { spelling: Spelling }

export function Shred({ spelling }: Props) {
  // Everything you pick is saved: reloading the page must not cost you rebuilding
  // the whole setup. Storage keeps it raw and validation happens here, so a
  // renamed exercise falls back to the default instead of breaking.
  const [range, setRange] = useState(loadSettings)
  const persist = useCallback((patch: Partial<typeof DEFAULT_SETTINGS>) => {
    setRange((prev) => saveSettings({ ...prev, ...patch }))
  }, [])

  const exerciseId = EXERCISE_BY_ID.has(range.exerciseId) ? range.exerciseId : EXERCISES[0].id
  const rootPc = range.rootPc
  const order = pick(range.order, ORDERS, 'fourths')
  const mode = pick(range.mode, MODES, 'ladder')
  const handMode = pick(range.handMode, HAND_MODES, 'as-is')
  const qwerty = range.qwerty
  const [detecting, setDetecting] = useState<{ low: number; high: number } | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [held, setHeld] = useState<number[]>([])
  const [lastGrade, setLastGrade] = useState<Grade | null>(null)
  const [repLog, setRepLog] = useState<{ bpm: number; passed: boolean }[]>([])
  const [stats, setStats] = useState<ShredStats>(loadShredStats)
  const [audioError, setAudioError] = useState<string | null>(null)
  /** Big notice over the piano roll when the tempo changes. */
  const [announce, setAnnounce] = useState<{ kind: 'up' | 'down'; text: string } | null>(null)

  const exercise = EXERCISE_BY_ID.get(exerciseId) ?? EXERCISES[0]
  const [ramp, setRamp] = useState(() => newRamp(exercise.tempos.start))

  const spec = useMemo(() => applyHandMode(exercise.pattern, handMode), [exercise, handMode])
  const expansion = useMemo(() => expandPattern(spec, rootPc, range), [spec, rootPc, range])

  const repBars = Math.max(1, Math.ceil(expansion.beats / exercise.beatsPerBar))
  const repBeats = repBars * exercise.beatsPerBar
  const cycleBeats = mode === 'burst' ? repBeats * 2 : repBeats

  // --- run-time refs ---------------------------------------------------------
  // Grading runs inside timers and must not read stale state: everything it needs
  // goes through here.
  const transportRef = useRef<Transport | null>(null)
  const playedRef = useRef<PlayedNote[]>([])
  const rollRef = useRef<PlayedMark[]>([])
  /** Real instant of each beat, from the transport itself. Holds for all 4 modes. */
  const beatsRef = useRef<{ index: number; perf: number }[]>([])
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const sessionRef = useRef({ reps: 0, passed: 0, bestBpm: 0 })
  /** Demo: the transport runs, the piano plays, nothing is graded. */
  const demoRef = useRef(false)
  const orderIndexRef = useRef(0)
  const rangeRef = useRef(range)
  rangeRef.current = range
  const bpmRef = useRef(ramp.bpm)
  bpmRef.current = ramp.bpm

  const strictness = (range.strictness ?? 'standard') as Strictness
  const tolerance = toleranceFor(exercise.level, strictness)
  /**
   * Tempo locked: the reps are still graded, the verdict and the records still
   * come, only the automatic move stops. Drilling one tempo until it is yours is
   * a normal way to practise, and the ladder deciding for you gets in the way.
   * Both directions freeze — a floor that drops on two bad reps is not "one tempo".
   */
  const tempoLocked = range.advanceReps === LOCKED
  const rampConfig = useMemo(
    () => ({
      ...DEFAULT_RAMP,
      // The ladder is never consulted while locked; keep the config sane anyway so
      // the dots and the targets have something to render.
      repsToAdvance: Math.max(1, range.advanceReps),
      minBpm: range.minBpm,
    }),
    [range.advanceReps, range.minBpm],
  )
  const rampConfigRef = useRef(rampConfig)
  rampConfigRef.current = rampConfig
  const rampRef = useRef(ramp)
  rampRef.current = ramp

  // 0.28 is the ceiling: above that the guide drowns out the real keyboard.
  const guideGain = range.guideVolume * 0.28

  /** Last onset of the rep. The boundary with the next rep hangs off it. */
  const lastBeat = useMemo(
    () => expansion.notes.reduce((m, n) => Math.max(m, n.beat), 0),
    [expansion],
  )

  const cfgRef = useRef({
    exercise, expansion, repBeats, cycleBeats, mode, rootPc, strictness, lastBeat,
    tempoLocked, guide: range.guide, guideGain,
  })
  cfgRef.current = {
    exercise, expansion, repBeats, cycleBeats, mode, rootPc, strictness, lastBeat,
    tempoLocked, guide: range.guide, guideGain,
  }

  const expectedBeats = useMemo(
    () => [...new Set(expansion.notes.map((n) => n.beat))].sort((a, b) => a - b),
    [expansion],
  )
  const expectedBeatsRef = useRef(expectedBeats)
  expectedBeatsRef.current = expectedBeats

  const later = (fn: () => void, delayMs: number) => {
    // The timer removes itself from the list when it fires: a long session has
    // thousands, and the list only exists to cancel what has not happened yet.
    const id: ReturnType<typeof setTimeout> = setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id)
      fn()
    }, Math.max(0, delayMs))
    timersRef.current.push(id)
  }

  /** Instant of beat `beat`, interpolating between the beats already scheduled. */
  const perfAtBeat = useCallback((beat: number): number => {
    const list = beatsRef.current
    const i = Math.floor(beat)
    const a = list.find((b) => b.index === i)
    if (!a) return Number.NaN
    if (beat === i) return a.perf
    const b2 = list.find((b) => b.index === i + 1)
    return b2 ? a.perf + (beat - i) * (b2.perf - a.perf) : a.perf
  }, [])

  /** The inverse: which beat an instant falls on. Used to draw what was played. */
  const beatAtPerf = useCallback((ms: number): number => {
    const list = beatsRef.current
    if (list.length < 2) return Number.NaN
    for (let i = list.length - 2; i >= 0; i--) {
      if (list[i].perf <= ms) {
        const span = list[i + 1].perf - list[i].perf
        return span > 0 ? list[i].index + (ms - list[i].perf) / span : list[i].index
      }
    }
    return list[0].index
  }, [])

  // --- grading one rep -------------------------------------------------------
  const evaluateRep = useCallback(
    (r: number) => {
      const c = cfgRef.current
      const startBeat = r * c.cycleBeats
      const repStart = perfAtBeat(startBeat)
      if (!Number.isFinite(repStart)) return

      const repEnd = perfAtBeat(startBeat + c.repBeats)

      // Expected time comes from the instants the transport actually scheduled,
      // instead of recomputing the grid — that way accel is no special case and the
      // two calculations cannot diverge.
      const localMsAt = (beat: number) => {
        const t = perfAtBeat(startBeat + beat)
        return Number.isFinite(t) ? t - repStart : beat * (60000 / (transportRef.current?.currentBpm ?? 120))
      }
      const oneBeat = localMsAt(1)
      const bpm = oneBeat > 0 ? 60000 / oneBeat : (transportRef.current?.currentBpm ?? 120)

      // Grace proportional to the tempo. A fixed value in ms was the flaw: at
      // 80 BPM a beat is 750ms, and 120ms of grace threw away a note that landed right.
      // The window is [repStart - cut, repEnd - cut): the same boundary the next rep
      // starts from, so a note belongs to exactly one of them.
      const cut = (60000 / bpm) * boundaryBeats(c.repBeats, c.lastBeat)
      const end = Number.isFinite(repEnd) ? repEnd - cut : Number.POSITIVE_INFINITY
      const notes = playedRef.current
        .filter((n) => n.onTime >= repStart - cut && n.onTime < end)
        .sort((a, b) => a.onTime - b.onTime)

      const tol = toleranceFor(c.exercise.level, c.strictness)
      const g = grade(c.expansion.notes, notes, {
        bpm,
        originMs: repStart,
        maxErrorRate: tol.maxErrorRate,
        maxIoiCv: tol.maxIoiCv,
        maxBpmDeviation: tol.maxBpmDeviation,
        timingGates: tol.timingGates,
        expectedMsAt: localMsAt,
      })

      setLastGrade(g)

      // A rep with nothing played does not count as a failure: it does not enter the
      // session, does not become a statistic and, above all, does not lower the tempo.
      // Fiddling with the keyboard for half a minute used to drop the BPM to the floor silently.
      if (!g.attempted) return

      setRepLog((prev) => [...prev.slice(-11), { bpm: Math.round(bpm), passed: g.passed }])
      sessionRef.current.reps += 1
      if (g.passed) {
        sessionRef.current.passed += 1
        sessionRef.current.bestBpm = Math.max(sessionRef.current.bestBpm, Math.round(bpm))
      }
      setStats(recordRep(c.exercise.id, c.rootPc, Math.round(bpm), g.passed, g.perGroupDevMs))

      // In accel the tempo is dictated by the curve, not by the result.
      if ((c.mode === 'ladder' || c.mode === 'burst') && !c.tempoLocked) {
        const next = nextRamp(rampRef.current, g.passed, rampConfigRef.current)
        rampRef.current = next.state
        setRamp(next.state)

        if (next.event === 'hold') {
          transportRef.current?.setBpm(next.state.bpm)
        } else {
          // The tempo changed: announce it and give a count-in bar at the new tempo,
          // instead of swapping the speed under your hand with no warning.
          setAnnounce({
            kind: next.event,
            text: `${next.event === 'up' ? '↑' : '↓'} ${next.state.bpm} BPM`,
          })
          void restartAtTempoRef.current(next.state.bpm)
        }
      }

      // Everything inside the window has been resolved — matched or counted extra.
      // Keeping part of it for the next rep was what made the same note count twice:
      // right here, extra there.
      playedRef.current = playedRef.current.filter((n) => n.onTime >= end)
    },
    [perfAtBeat],
  )

  /**
   * Schedules the exercise notes that land on the next beat.
   *
   * The same path serves the demo and the continuous guide: the only difference is
   * that the demo plays one rep and stops, while the guide runs along with you.
   * Scheduling only one beat at a time avoids creating 300 oscillators forty
   * seconds before they are needed.
   */
  const schedulePiano = useCallback((b: Beat, gain: number) => {
    const t = transportRef.current
    if (!t || b.index < 0 || gain <= 0) return
    const c = cfgRef.current
    const perBeat = 60 / (t.currentBpm || 120)
    const dur = Math.max(0.08, Math.min(0.6, perBeat / c.exercise.pattern.subdivision) * 0.9)
    // Where we are INSIDE the rep: the shape repeats every cycle.
    const local = ((b.index % c.cycleBeats) + c.cycleBeats) % c.cycleBeats
    for (const n of c.expansion.notes) {
      if (n.beat >= local && n.beat < local + 1) {
        t.note(n.midi, b.audioTime + (n.beat - local) * perBeat, dur, gain)
      }
    }
  }, [])

  // --- transport -------------------------------------------------------------
  const handleBeat = useCallback(
    (b: Beat) => {
      beatsRef.current.push({ index: b.index, perf: b.perfTime })
      if (beatsRef.current.length > 256) beatsRef.current.splice(0, 64)

      const c = cfgRef.current

      if (demoRef.current) {
        schedulePiano(b, c.guideGain)
        if (b.index >= c.repBeats) {
          later(() => {
            stopRef.current()
          }, b.perfTime - performance.now())
        }
        return
      }

      if (c.mode === 'accel' && b.index >= 0) {
        const total = c.cycleBeats * ACCEL_REPS
        transportRef.current?.setBpm(
          bpmAtBeat(c.exercise.tempos.start, c.exercise.tempos.target, total, b.index + 1),
        )
      }

      // Continuous guide: the piano plays the exercise along, rep after rep.
      if (c.guide) schedulePiano(b, c.guideGain)

      const delay = b.perfTime - performance.now()

      if (b.index === 0) {
        later(() => {
          setPhase('playing')
          setAnnounce(null)
        }, delay)
      }

      // End of a played window: grade after a grace period so the last note arrives.
      if (b.index >= c.repBeats && (b.index - c.repBeats) % c.cycleBeats === 0) {
        const r = (b.index - c.repBeats) / c.cycleBeats
        // Grade after the grace period, otherwise the last note has not arrived yet.
        const wait = graceMs(transportRef.current?.currentBpm ?? 120) + 30
        later(() => {
          evaluateRep(r)
          if (c.mode === 'burst') setPhase('resting')
        }, delay + wait)
      }

      // Start of a played window (burst: coming out of the rest).
      if (b.index > 0 && b.index % c.cycleBeats === 0) {
        later(() => setPhase('playing'), delay)
      }
    },
    [evaluateRep, schedulePiano],
  )

  const restartAtTempoRef = useRef<(bpm: number) => Promise<void>>(async () => {})

  /**
   * Restarts the transport at a new tempo, with one count-in bar.
   * Unlike start(): it keeps the session, the history and the records — only the
   * timeline restarts, because the beat grid changed.
   */
  const restartAtTempo = useCallback(async (bpm: number) => {
    const t = transportRef.current
    if (!t) return
    t.stop()
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current = []
    playedRef.current = []
    rollRef.current = []
    beatsRef.current = []
    setPhase('countin')
    try {
      await t.start({
        bpm,
        beatsPerBar: cfgRef.current.exercise.beatsPerBar,
        countInBars: 1,
      })
    } catch (e) {
      setPhase('idle')
      setAudioError(`Could not start audio: ${(e as Error).message}`)
    }
  }, [])
  restartAtTempoRef.current = restartAtTempo

  const stopRef = useRef<() => void>(() => {})

  const stop = useCallback(() => {
    demoRef.current = false
    setAnnounce(null)
    transportRef.current?.stop()
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []
    setPhase('idle')
    const s = sessionRef.current
    if (s.reps > 0) {
      setStats(recordSession(cfgRef.current.exercise.id, s.reps, s.passed, s.bestBpm))
    }
    sessionRef.current = { reps: 0, passed: 0, bestBpm: 0 }
  }, [])

  stopRef.current = stop

  /** Listen to the exercise before trying it. The same tempo you picked. */
  const listen = useCallback(async () => {
    setAudioError(null)
    const t = (transportRef.current ??= new Transport())
    t.onBeat = handleBeat
    t.setVolume(rangeRef.current.clickVolume)
    demoRef.current = true
    beatsRef.current = []
    setLastGrade(null)
    setPhase('demo')
    try {
      await t.start({ bpm: ramp.bpm, beatsPerBar: exercise.beatsPerBar, countInBars: 1 })
    } catch (e) {
      demoRef.current = false
      setPhase('idle')
      setAudioError(`Could not start audio: ${(e as Error).message}`)
    }
  }, [handleBeat, exercise, ramp.bpm])

  const start = useCallback(async () => {
    setAudioError(null)
    const t = (transportRef.current ??= new Transport())
    t.onBeat = handleBeat
    t.setVolume(rangeRef.current.clickVolume)

    playedRef.current = []
    rollRef.current = []
    beatsRef.current = []
    sessionRef.current = { reps: 0, passed: 0, bestBpm: 0 }
    setLastGrade(null)
    setRepLog([])
    demoRef.current = false
    setAnnounce(null)
    setPhase('countin')

    const bpm = mode === 'accel' ? exercise.tempos.start : ramp.bpm
    try {
      await t.start({ bpm, beatsPerBar: exercise.beatsPerBar, countInBars: 1 })
    } catch (e) {
      setPhase('idle')
      setAudioError(`Could not start audio: ${(e as Error).message}`)
    }
  }, [handleBeat, mode, exercise, ramp.bpm])

  // Leaving the tab or switching exercise mid-run must not leave the click running.
  useEffect(() => () => stop(), [stop])
  useEffect(() => {
    if (phase !== 'idle') stop()
    setRamp(newRamp(exercise.tempos.start))
    setLastGrade(null)
    setRepLog([])
    // Switching exercise resets the ramp: the BPM of one does not apply to another.
  }, [exerciseId])

  // --- note input ------------------------------------------------------------
  const onNote = useCallback(
    (e: MidiEvent) => {
      if (e.kind === 'off') {
        setHeld((prev) => prev.filter((n) => n !== e.note))
        // Closes the last open note at this pitch, to measure legato/detached.
        for (let i = playedRef.current.length - 1; i >= 0; i--) {
          const p = playedRef.current[i]
          if (p.midi === e.note && p.offTime === undefined) {
            p.offTime = e.time
            break
          }
        }
        return
      }

      setHeld((prev) => (prev.includes(e.note) ? prev : [...prev, e.note]))

      setDetecting((d) =>
        d ? { low: Math.min(d.low, e.note), high: Math.max(d.high, e.note) } : d,
      )

      // Subtract the input chain latency before any arithmetic.
      const onTime = e.time - rangeRef.current.latencyMs
      playedRef.current.push({ midi: e.note, velocity: e.velocity, onTime })
      if (playedRef.current.length > 2000) playedRef.current.splice(0, 1000)

      // Mark for the piano roll: position in time and how far off the grid it was.
      const beat = beatAtPerf(onTime)
      if (Number.isFinite(beat)) {
        const c = cfgRef.current
        const local = ((beat % c.cycleBeats) + c.cycleBeats) % c.cycleBeats
        const near = expectedBeatsRef.current.reduce(
          (best, b) => (Math.abs(b - local) < Math.abs(best - local) ? b : best),
          expectedBeatsRef.current[0] ?? 0,
        )
        const beatMs = 60000 / (transportRef.current?.currentBpm ?? 120)
        rollRef.current.push({ midi: e.note, beat, devMs: (local - near) * beatMs })
        if (rollRef.current.length > 400) rollRef.current.splice(0, 200)
      }
    },
    [beatAtPerf],
  )

  useMidiEvents(onNote)
  useComputerKeyboard(qwerty, onNote, Math.max(range.low, 48))

  /**
   * Tempo set by hand. Resets the streaks: if you have just changed the tempo, the
   * previous clean reps do not count as progress toward promoting from this point.
   */
  const setTempo = useCallback((bpm: number) => {
    // An empty field or a "-" mid-typing becomes NaN, and NaN goes through
    // Math.min/max without complaint all the way to the input value.
    if (!Number.isFinite(bpm)) return
    const floor = rangeRef.current.minBpm
    const target = Math.max(floor, Math.min(DEFAULT_RAMP.maxBpm, Math.round(bpm)))
    // Updates the ref immediately: two clicks in the same frame would read the same
    // ramp.bpm from the render and the second would not move.
    bpmRef.current = target
    setRamp((prev) => ({ ...prev, bpm: target, cleanStreak: 0, failStreak: 0 }))
    transportRef.current?.setBpm(target)
  }, [])

  /**
   * Moves the tempo floor. Raising it above the current tempo would leave the BPM
   * outside the range the controls can express, so the tempo comes up with it.
   */
  const setFloor = useCallback(
    (bpm: number) => {
      if (!Number.isFinite(bpm)) return
      const floor = Math.max(
        ABS_MIN_BPM,
        Math.min(DEFAULT_RAMP.maxBpm - DEFAULT_RAMP.stepBpm, Math.round(bpm)),
      )
      persist({ minBpm: floor })
      if (bpmRef.current < floor) setTempo(floor)
    },
    [persist, setTempo],
  )

  // --- derived for the view --------------------------------------------------
  const getPosition = useCallback(() => transportRef.current?.position() ?? Number.NaN, [])
  const getPlayed = useCallback(() => rollRef.current, [])

  const marks = useMemo(() => {
    const m = new Map<number, KeyMark>()
    for (const n of expansion.notes) m.set(n.midi, 'missing')
    for (const n of held) m.set(n, 'held')
    return m
  }, [expansion, held])

  const pr = prFor(stats, exercise.id, rootPc)
  const best = bestPrFor(stats, exercise.id)
  const diagnosis = diagnosisFor(stats, exercise.id)
  const worst = worstGroups(diagnosis)
  const bpmNow = phase === 'idle' ? ramp.bpm : Math.round(transportRef.current?.currentBpm ?? ramp.bpm)
  const targets = rampTargets(ramp, rampConfig)
  // The last clean rep needed: this is the rep worth warning about before, not after.
  const aboutToClimb =
    !tempoLocked &&
    (mode === 'ladder' || mode === 'burst') &&
    (phase === 'playing' || phase === 'countin') &&
    ramp.cleanStreak === rampConfig.repsToAdvance - 1

  return (
    <div className="shred">
      <div className="controls">
        <label>
          Exercise
          <select value={exerciseId} onChange={(e) => persist({ exerciseId: e.target.value })}>
            {([1, 2, 3, 4, 5] as Level[]).map((lvl) => (
              <optgroup key={lvl} label={LEVEL_LABEL[lvl]}>
                {EXERCISES.filter((e) => e.level === lvl).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label>
          Key
          <select value={rootPc} onChange={(e) => persist({ rootPc: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, pc) => (
              <option key={pc} value={pc}>
                {pitchClassName(pc, spelling)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Hands
          <select value={handMode} onChange={(e) => persist({ handMode: e.target.value })}>
            {(Object.keys(HAND_MODE_LABEL) as HandMode[]).map((h) => (
              <option key={h} value={h}>
                {HAND_MODE_LABEL[h]}
              </option>
            ))}
          </select>
        </label>

        <label>
          Order
          <select value={order} onChange={(e) => persist({ order: e.target.value })}>
            <option value="fourths">Fourths</option>
            <option value="chromatic">Chromatic</option>
            <option value="random">Random</option>
          </select>
        </label>

        <button
          onClick={() => {
            orderIndexRef.current += 1
            persist({ rootPc: rootAt(order, orderIndexRef.current) })
          }}
        >
          Next key
        </button>

        <label>
          Strictness
          <select
            value={strictness}
            onChange={(e) => persist({ strictness: e.target.value })}
          >
            {(Object.keys(STRICTNESS_LABEL) as Strictness[]).map((k) => (
              <option key={k} value={k}>
                {STRICTNESS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        <label title="How many clean reps in a row raise the tempo. One bad rep resets the count. Set it to never to drill one tempo for as long as you like — the reps are still graded.">
          Raise after
          <select
            value={range.advanceReps}
            onChange={(e) =>
              persist({ advanceReps: Number(e.target.value) })
            }
          >
            <option value={1}>1 clean</option>
            <option value={2}>2 clean</option>
            <option value={3}>3 clean</option>
            <option value={LOCKED}>never</option>
          </select>
        </label>

        <label>
          Mode
          <select value={mode} onChange={(e) => persist({ mode: e.target.value })}>
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        {phase === 'idle' ? (
          <>
            <button onClick={listen}>Listen</button>
            <button className="primary" onClick={start}>
              Start
            </button>
          </>
        ) : (
          <button className="primary" onClick={stop}>
            Stop
          </button>
        )}
      </div>

      <div className="exercise-head">
        <div>
          <span className="badge">{FAMILY_LABEL[exercise.family]}</span>
          <span className="badge">{LEVEL_LABEL[exercise.level]}</span>
          <strong>{exercise.label}</strong> in {pitchClassName(rootPc, spelling)}
          <span className="focus"> · {exercise.focus}</span>
          {handMode !== 'as-is' && (
            <span className="badge override">{HAND_MODE_LABEL[handMode]}</span>
          )}
        </div>
        <div className="tempo">
          {mode === 'accel' ? (
            // In accel the curve controls the tempo, not you.
            <span className={`bpm ${phase}`}>{bpmNow} BPM</span>
          ) : (
            <span className="tempo-picker">
              <button
                onClick={() => setTempo(bpmRef.current - DEFAULT_RAMP.stepBpm)}
                aria-label="lower tempo"
              >
                −
              </button>
              <input
                className={`bpm ${phase}`}
                type="number"
                min={range.minBpm}
                max={DEFAULT_RAMP.maxBpm}
                step={1}
                value={ramp.bpm}
                onChange={(e) => setTempo(Number(e.target.value))}
              />
              <span className="dim">BPM</span>
              <button
                onClick={() => setTempo(bpmRef.current + DEFAULT_RAMP.stepBpm)}
                aria-label="raise tempo"
              >
                +
              </button>
            </span>
          )}
          <span className="dim">
            {' '}
            target {exercise.tempos.target} · {repBars} bar{repBars > 1 ? 's' : ''} per rep
          </span>
          {best > 0 && <span className="pr"> record {best}</span>}
          {pr && <span className="dim"> ({pitchClassName(rootPc, spelling)}: {pr.bpm})</span>}
        </div>
      </div>

      {mode !== 'accel' && (
        <div className="tempo-row">
          <label className="tempo-slider">
            <input
              type="range"
              min={range.minBpm}
              max={Math.max(DEFAULT_RAMP.maxBpm, exercise.tempos.target)}
              step={1}
              value={ramp.bpm}
              onChange={(e) => setTempo(Number(e.target.value))}
              aria-label="tempo"
            />
            <span className="dim">
              {exercise.tempos.start} start · {exercise.tempos.target} target
            </span>
          </label>
          <label
            className="tempo-floor"
            title="Lowest BPM the slider, the − button and the ladder can reach. Taking an arpeggio apart slowly wants a floor well under the default 40."
          >
            floor
            <input
              type="number"
              min={ABS_MIN_BPM}
              max={DEFAULT_RAMP.maxBpm - DEFAULT_RAMP.stepBpm}
              step={5}
              value={range.minBpm}
              onChange={(e) => setFloor(Number(e.target.value))}
            />
            BPM
          </label>
        </div>
      )}

      <div className="audio-row">
        <label className="click-volume" title="Click volume. Does not affect the piano.">
          click {Math.round(range.clickVolume * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(range.clickVolume * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100
              persist({ clickVolume: v })
              transportRef.current?.setVolume(v)
            }}
          />
        </label>

        <label
          className="click-volume"
          title="The piano plays the exercise along with you, rep after rep — not only in Listen."
        >
          <input
            type="checkbox"
            checked={range.guide}
            onChange={(e) => persist({ guide: e.target.checked })}
          />
          guide {Math.round(range.guideVolume * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(range.guideVolume * 100)}
            disabled={!range.guide}
            onChange={(e) => persist({ guideVolume: Number(e.target.value) / 100 })}
          />
        </label>
      </div>

      <p className="mode-help">
        {MODE_HELP[mode]}
        {' '}
        {STRICTNESS_HELP[strictness]}
      </p>
      {mode !== 'accel' && mode !== 'free' && tempoLocked && (
        <p className="ramp-progress locked">
          tempo locked at <strong>{ramp.bpm}</strong> BPM — reps are still graded, the
          ladder just does not move
        </p>
      )}
      {mode !== 'accel' && mode !== 'free' && !tempoLocked && (
        <p className={`ramp-progress ${ramp.failStreak > 0 ? 'down' : 'up'}`}>
          {ramp.failStreak > 0 ? (
            <>
              <Dots on={ramp.failStreak} total={DEFAULT_RAMP.repsToRetreat} />
              {' '}
              {DEFAULT_RAMP.repsToRetreat - ramp.failStreak} more failure
              {DEFAULT_RAMP.repsToRetreat - ramp.failStreak > 1 ? 's' : ''} and it drops to{' '}
              <strong>{targets.down}</strong> BPM
            </>
          ) : (
            <>
              <Dots on={ramp.cleanStreak} total={rampConfig.repsToAdvance} />
              {' '}
              {rampConfig.repsToAdvance - ramp.cleanStreak} more clean
              {rampConfig.repsToAdvance - ramp.cleanStreak > 1 ? ' reps' : ' rep'} and it climbs to{' '}
              <strong>{targets.up}</strong> BPM
            </>
          )}
        </p>
      )}

      <p className="limits">
        This rep passes with up to{' '}
        <strong>
          {Math.max(1, Math.round(tolerance.maxErrorRate * expansion.notes.length))} error
          {Math.max(1, Math.round(tolerance.maxErrorRate * expansion.notes.length)) > 1 ? 's' : ''}
        </strong>{' '}
        in {expansion.notes.length} notes
        {tolerance.timingGates ? (
          <>
            {' '}· unevenness up to <strong>{(tolerance.maxIoiCv * 100).toFixed(0)}%</strong> ·
            tempo ±<strong>{(tolerance.maxBpmDeviation * 100).toFixed(0)}%</strong>
          </>
        ) : (
          <> · timing measured only, does not fail you</>
        )}
      </p>
      {expansion.warning && <p className="warn">{expansion.warning}</p>}
      {audioError && <p className="error">{audioError}</p>}

      <div className="roll-stack">
        {announce && <div className={`roll-announce ${announce.kind}`}>{announce.text}</div>}
        {!announce && aboutToClimb && (
          <div className="roll-warn">a clean rep here climbs to {targets.up} BPM</div>
        )}
        <PianoRoll
          expected={expansion.notes}
          low={range.low}
          high={range.high}
          getPosition={getPosition}
          getPlayed={getPlayed}
          beatsPerBar={exercise.beatsPerBar}
          cycleBeats={cycleBeats}
          showFingers={range.showFingers}
          active={phase === 'playing'}
        />
        <Keyboard marks={marks} low={range.low} high={range.high} showNoteNames={false} />
      </div>

      <div className={`verdict-bar ${phase} ${lastGrade ? (lastGrade.passed ? 'ok' : 'fail') : ''}`}>
        {phase === 'demo' && <span>listening — the piano plays, you just watch</span>}
        {phase === 'countin' && <span>counting in...</span>}
        {phase === 'resting' && <span>rest — let the hand go loose</span>}
        {phase === 'playing' && !lastGrade && <span>playing</span>}
        {lastGrade && (
          <>
            <strong>{lastGrade.passed ? 'clean' : 'not yet'}</strong>
            <span className="metric" title="right notes in order">
              {Math.round(lastGrade.accuracy * 100)}% right
            </span>
            <span className="metric" title="coefficient of variation of the inter-onset intervals">
              evenness {(lastGrade.ioiCv * 100).toFixed(1)}%
            </span>
            <span className="metric">{Math.round(lastGrade.effectiveBpm)} BPM actual</span>
            {lastGrade.handSpreadMs > 0 && (
              <span className="metric" title="how far apart the two hands land">
                hands {lastGrade.handSpreadMs.toFixed(0)}ms
              </span>
            )}
            <span className="metric" title="attack unevenness — a light keyboard makes this worse">
              attack ±{lastGrade.velocityStdev.toFixed(0)}
            </span>
            <span className="metric" title="mean distance from the click. If it is large and constant, adjust the latency under Keyboard and input.">
              grid {lastGrade.gridMadMs.toFixed(0)}ms
            </span>
          </>
        )}
        {lastGrade && !lastGrade.passed && (
          <span className="reasons">{lastGrade.reasons.join(' · ')}</span>
        )}
        {lastGrade && (lastGrade.missedNotes.length > 0 || lastGrade.extraNotes.length > 0) && (
          <span className="note-diff">
            {lastGrade.missedNotes.length > 0 && (
              <>missing {noteNames(lastGrade.missedNotes, spelling)}</>
            )}
            {lastGrade.missedNotes.length > 0 && lastGrade.extraNotes.length > 0 && ' · '}
            {lastGrade.extraNotes.length > 0 && <>extra {noteNames(lastGrade.extraNotes, spelling)}</>}
          </span>
        )}
      </div>

      {repLog.length > 0 && (
        <div className="rep-log">
          {repLog.map((r, i) => (
            <span key={i} className={r.passed ? 'ok' : 'fail'} title={`${r.bpm} BPM`}>
              {r.bpm}
            </span>
          ))}
        </div>
      )}

      <p className="exercise-note">{exercise.note}</p>

      {worst.length > 0 && (
        <div className="diagnosis">
          <h3>Where you fumble</h3>
          <p className="dim">
            Mean deviation per note, accumulated over your passes through this exercise.
          </p>
          <ul>
            {worst.map((w) => {
              const target = expansion.notes.find((n) => n.group === w.index)
              return (
                <li key={w.index}>
                  note {w.index + 1}
                  {target && ` (${midiToName(target.midi, spelling)}${target.finger ? `, finger ${target.finger}` : ''})`}
                  : ±{w.devMs.toFixed(0)}ms
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <details className="shred-settings">
        <summary>Keyboard and input</summary>
        <div className="controls">
          <span>
            Range: {midiToName(range.low, spelling)} to {midiToName(range.high, spelling)}
          </span>
          {detecting ? (
            <>
              <span className="dim">
                play the lowest and the highest note ({detecting.low <= detecting.high
                  ? `${midiToName(detecting.low, spelling)}–${midiToName(detecting.high, spelling)}`
                  : 'waiting'})
              </span>
              <button
                onClick={() => {
                  if (detecting.high - detecting.low >= 24) {
                    persist({ low: detecting.low, high: detecting.high })
                  }
                  setDetecting(null)
                }}
              >
                Use
              </button>
              <button onClick={() => setDetecting(null)}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setDetecting({ low: 127, high: 0 })}>Detect</button>
          )}
          <label title="Subtracted from the instant of each note. Raise it until the grid deviation drops.">
            latency {range.latencyMs}ms
            <input
              type="range"
              min={-50}
              max={200}
              step={5}
              value={range.latencyMs}
              onChange={(e) => persist({ latencyMs: Number(e.target.value) })}
            />
          </label>
          <label title="Finger number on each note of the piano roll.">
            <input
              type="checkbox"
              checked={range.showFingers}
              onChange={(e) => persist({ showFingers: e.target.checked })}
            />
            fingering
          </label>
          <label>
            <input type="checkbox" checked={qwerty} onChange={(e) => persist({ qwerty: e.target.checked })} />
            computer keyboard
          </label>
        </div>
        {qwerty && <p className="dim">{QWERTY_HELP}</p>}
      </details>

      <div className="stats">
        {sessionRef.current.reps > 0 && (
          <>
            session: {sessionRef.current.passed}/{sessionRef.current.reps} clean ·{' '}
          </>
        )}
        {best > 0 ? `record ${best} BPM` : 'no record yet'}
        <button
          onClick={() => {
            clearShredStats()
            setStats(loadShredStats())
          }}
        >
          reset
        </button>
      </div>
    </div>
  )
}
