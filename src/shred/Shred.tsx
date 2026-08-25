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
  DEFAULT_RAMP,
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
 * Folga em cada ponta da repeticao, em fracao de tempo. Um quarto de tempo e
 * generoso o bastante pra nota de fronteira e curto o bastante pra nao invadir
 * a volta seguinte.
 */
const GRACE_BEATS = 0.25
const graceMs = (bpm: number) => (60000 / bpm) * GRACE_BEATS
/** Quantas repeticoes o modo accel leva pra ir do inicial ao alvo. */
const ACCEL_REPS = 8

type Phase = 'idle' | 'countin' | 'playing' | 'resting' | 'demo'

const ORDERS = ['fourths', 'chromatic', 'random'] as const
const MODES = ['ladder', 'burst', 'accel', 'free'] as const
const HAND_MODES = ['as-is', 'rh', 'lh', 'both'] as const

/** Valor salvo que nao existe mais (versao antiga, storage editado) cai no padrao. */
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Quantas voltas ja contam pro proximo degrau de andamento. */
function Dots({ on, total }: { on: number; total: number }) {
  return (
    <span className="dots" aria-label={`${on} de ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < on ? 'dot on' : 'dot'} />
      ))}
    </span>
  )
}

/** Lista curta de alturas, sem despejar 60 nomes na barra. */
function nomes(midi: number[], spelling: Spelling): string {
  const unicas = [...new Set(midi)]
  const mostra = unicas.slice(0, 6).map((n) => midiToName(n, spelling)).join(' ')
  return unicas.length > 6 ? `${mostra} +${unicas.length - 6}` : mostra
}

type Props = { spelling: Spelling }

export function Shred({ spelling }: Props) {
  // Tudo que voce escolhe fica salvo: recarregar a pagina nao pode custar
  // remontar a bancada. O storage guarda cru e a validacao acontece aqui, entao
  // um exercicio renomeado vira o padrao em vez de quebrar.
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
  /** Aviso grande em cima do piano-roll quando o andamento muda. */
  const [announce, setAnnounce] = useState<{ kind: 'up' | 'down'; text: string } | null>(null)

  const exercise = EXERCISE_BY_ID.get(exerciseId) ?? EXERCISES[0]
  const [ramp, setRamp] = useState(() => newRamp(exercise.tempos.start))

  const spec = useMemo(() => applyHandMode(exercise.pattern, handMode), [exercise, handMode])
  const expansion = useMemo(() => expandPattern(spec, rootPc, range), [spec, rootPc, range])

  const repBars = Math.max(1, Math.ceil(expansion.beats / exercise.beatsPerBar))
  const repBeats = repBars * exercise.beatsPerBar
  const cycleBeats = mode === 'burst' ? repBeats * 2 : repBeats

  // --- refs de execucao ------------------------------------------------------
  // A avaliacao roda dentro de timers e nao pode ler estado velho: tudo que ela
  // precisa passa por aqui.
  const transportRef = useRef<Transport | null>(null)
  const playedRef = useRef<PlayedNote[]>([])
  const rollRef = useRef<PlayedMark[]>([])
  /** Instante real de cada tempo, do proprio transporte. Vale pros 4 modos. */
  const beatsRef = useRef<{ index: number; perf: number }[]>([])
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const sessionRef = useRef({ reps: 0, passed: 0, bestBpm: 0 })
  /** Demonstracao: o transporte roda, o piano toca, nada e avaliado. */
  const demoRef = useRef(false)
  const orderIndexRef = useRef(0)
  const rangeRef = useRef(range)
  rangeRef.current = range
  const bpmRef = useRef(ramp.bpm)
  bpmRef.current = ramp.bpm

  const strictness = (range.strictness ?? 'padrao') as Strictness
  const tolerance = toleranceFor(exercise.level, strictness)
  const rampConfig = useMemo(
    () => ({ ...DEFAULT_RAMP, repsToAdvance: range.advanceReps }),
    [range.advanceReps],
  )
  const rampConfigRef = useRef(rampConfig)
  rampConfigRef.current = rampConfig
  const rampRef = useRef(ramp)
  rampRef.current = ramp

  // 0.28 e o teto: acima disso a referencia abafa o teclado de verdade.
  const guideGain = range.guideVolume * 0.28

  const cfgRef = useRef({
    exercise, expansion, repBeats, cycleBeats, mode, rootPc, strictness,
    guide: range.guide, guideGain,
  })
  cfgRef.current = {
    exercise, expansion, repBeats, cycleBeats, mode, rootPc, strictness,
    guide: range.guide, guideGain,
  }

  const expectedBeats = useMemo(
    () => [...new Set(expansion.notes.map((n) => n.beat))].sort((a, b) => a - b),
    [expansion],
  )
  const expectedBeatsRef = useRef(expectedBeats)
  expectedBeatsRef.current = expectedBeats

  const later = (fn: () => void, delayMs: number) => {
    // O timer se remove da lista ao disparar: numa sessao longa sao milhares, e
    // a lista so existe pra poder cancelar o que ainda nao aconteceu.
    const id: ReturnType<typeof setTimeout> = setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id)
      fn()
    }, Math.max(0, delayMs))
    timersRef.current.push(id)
  }

  /** Instante do tempo `beat`, interpolando entre os tempos ja agendados. */
  const perfAtBeat = useCallback((beat: number): number => {
    const list = beatsRef.current
    const i = Math.floor(beat)
    const a = list.find((b) => b.index === i)
    if (!a) return Number.NaN
    if (beat === i) return a.perf
    const b2 = list.find((b) => b.index === i + 1)
    return b2 ? a.perf + (beat - i) * (b2.perf - a.perf) : a.perf
  }, [])

  /** O inverso: em que tempo cai um instante. Usado pra desenhar o que foi tocado. */
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

  // --- avaliacao de uma repeticao -------------------------------------------
  const evaluateRep = useCallback(
    (r: number) => {
      const c = cfgRef.current
      const startBeat = r * c.cycleBeats
      const repStart = perfAtBeat(startBeat)
      if (!Number.isFinite(repStart)) return

      const repEnd = perfAtBeat(startBeat + c.repBeats)

      // Tempo esperado sai dos instantes que o transporte realmente agendou, em
      // vez de recalcular a grade — assim accel nao vira caso especial e nao tem
      // como as duas contas divergirem.
      const localMsAt = (beat: number) => {
        const t = perfAtBeat(startBeat + beat)
        return Number.isFinite(t) ? t - repStart : beat * (60000 / (transportRef.current?.currentBpm ?? 120))
      }
      const oneBeat = localMsAt(1)
      const bpm = oneBeat > 0 ? 60000 / oneBeat : (transportRef.current?.currentBpm ?? 120)

      // Folga proporcional ao andamento. Fixa em ms era o defeito: a 80 BPM um
      // tempo tem 750ms, e 120ms de folga jogava fora nota que entrou no lugar.
      const grace = graceMs(bpm)
      const fim = Number.isFinite(repEnd) ? repEnd + grace : Number.POSITIVE_INFINITY
      const notes = playedRef.current
        .filter((n) => n.onTime >= repStart - grace && n.onTime < fim)
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

      // Volta em que a pessoa nao tocou nao conta como falha: nao entra na
      // sessao, nao vira estatistica e, principalmente, nao desce o andamento.
      // Mexer no teclado por meio minuto derrubava o BPM ate o piso em silencio.
      if (!g.attempted) return

      setRepLog((prev) => [...prev.slice(-11), { bpm: Math.round(bpm), passed: g.passed }])
      sessionRef.current.reps += 1
      if (g.passed) {
        sessionRef.current.passed += 1
        sessionRef.current.bestBpm = Math.max(sessionRef.current.bestBpm, Math.round(bpm))
      }
      setStats(recordRep(c.exercise.id, c.rootPc, Math.round(bpm), g.passed, g.perGroupDevMs))

      // No accel o andamento e ditado pela curva, nao pelo resultado.
      if (c.mode === 'ladder' || c.mode === 'burst') {
        const next = nextRamp(rampRef.current, g.passed, rampConfigRef.current)
        rampRef.current = next.state
        setRamp(next.state)

        if (next.event === 'hold') {
          transportRef.current?.setBpm(next.state.bpm)
        } else {
          // Mudou de andamento: anuncia e da um compasso de contagem no tempo
          // novo, em vez de trocar a velocidade embaixo da sua mao sem aviso.
          setAnnounce({
            kind: next.event,
            text: `${next.event === 'up' ? '↑' : '↓'} ${next.state.bpm} BPM`,
          })
          void restartAtTempoRef.current(next.state.bpm)
        }
      }

      // Tudo dentro da janela ja foi resolvido — casou ou virou sobra. Guardar
      // parte dela pra proxima volta era o que fazia a mesma nota contar duas
      // vezes: certa aqui, sobrando la.
      playedRef.current = playedRef.current.filter((n) => n.onTime >= fim)
    },
    [perfAtBeat],
  )

  /**
   * Agenda as notas do exercicio que caem no proximo tempo.
   *
   * O mesmo caminho serve pra demonstracao e pra referencia continua: a unica
   * diferenca e que a demonstracao toca uma volta e para, e a referencia roda
   * junto com voce. Agendar so um tempo por vez evita criar 300 osciladores
   * quarenta segundos antes de precisar deles.
   */
  const agendarPiano = useCallback((b: Beat, gain: number) => {
    const t = transportRef.current
    if (!t || b.index < 0 || gain <= 0) return
    const c = cfgRef.current
    const porTempo = 60 / (t.currentBpm || 120)
    const dur = Math.max(0.08, Math.min(0.6, porTempo / c.exercise.pattern.subdivision) * 0.9)
    // Onde estamos DENTRO da volta: o desenho se repete a cada ciclo.
    const local = ((b.index % c.cycleBeats) + c.cycleBeats) % c.cycleBeats
    for (const n of c.expansion.notes) {
      if (n.beat >= local && n.beat < local + 1) {
        t.note(n.midi, b.audioTime + (n.beat - local) * porTempo, dur, gain)
      }
    }
  }, [])

  // --- transporte ------------------------------------------------------------
  const handleBeat = useCallback(
    (b: Beat) => {
      beatsRef.current.push({ index: b.index, perf: b.perfTime })
      if (beatsRef.current.length > 256) beatsRef.current.splice(0, 64)

      const c = cfgRef.current

      if (demoRef.current) {
        agendarPiano(b, c.guideGain)
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

      // Referencia continua: o piano toca o exercicio junto, volta apos volta.
      if (c.guide) agendarPiano(b, c.guideGain)

      const delay = b.perfTime - performance.now()

      if (b.index === 0) {
        later(() => {
          setPhase('playing')
          setAnnounce(null)
        }, delay)
      }

      // Fim de uma janela tocada: avalia com uma folga pra ultima nota chegar.
      if (b.index >= c.repBeats && (b.index - c.repBeats) % c.cycleBeats === 0) {
        const r = (b.index - c.repBeats) / c.cycleBeats
        // Avalia depois da folga, senao a ultima nota ainda nao chegou.
        const espera = graceMs(transportRef.current?.currentBpm ?? 120) + 30
        later(() => {
          evaluateRep(r)
          if (c.mode === 'burst') setPhase('resting')
        }, delay + espera)
      }

      // Inicio de uma janela tocada (rajada: sai do descanso).
      if (b.index > 0 && b.index % c.cycleBeats === 0) {
        later(() => setPhase('playing'), delay)
      }
    },
    [evaluateRep, agendarPiano],
  )

  const restartAtTempoRef = useRef<(bpm: number) => Promise<void>>(async () => {})

  /**
   * Reinicia o transporte num andamento novo, com um compasso de contagem.
   * Diferente de start(): mantem sessao, historico e recordes — so a linha do
   * tempo recomeca, porque a grade de tempos mudou.
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
      setAudioError(`Nao consegui iniciar o audio: ${(e as Error).message}`)
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

  /** Ouvir o exercicio antes de tentar. Mesmo andamento que voce escolheu. */
  const ouvir = useCallback(async () => {
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
      setAudioError(`Nao consegui iniciar o audio: ${(e as Error).message}`)
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
      setAudioError(`Nao consegui iniciar o audio: ${(e as Error).message}`)
    }
  }, [handleBeat, mode, exercise, ramp.bpm])

  // Sair da aba ou trocar de exercicio no meio nao pode deixar o clique tocando.
  useEffect(() => () => stop(), [stop])
  useEffect(() => {
    if (phase !== 'idle') stop()
    setRamp(newRamp(exercise.tempos.start))
    setLastGrade(null)
    setRepLog([])
    // Trocar de exercicio zera o ramp: BPM de um nao vale pro outro.
  }, [exerciseId])

  // --- entrada de notas ------------------------------------------------------
  const onNote = useCallback(
    (e: MidiEvent) => {
      if (e.kind === 'off') {
        setHeld((prev) => prev.filter((n) => n !== e.note))
        // Fecha a ultima nota aberta dessa altura, pra medir ligado/destacado.
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

      // Desconta o atraso da cadeia de entrada antes de qualquer conta.
      const onTime = e.time - rangeRef.current.latencyMs
      playedRef.current.push({ midi: e.note, velocity: e.velocity, onTime })
      if (playedRef.current.length > 2000) playedRef.current.splice(0, 1000)

      // Marca pro piano-roll: posicao no tempo e quanto saiu da grade.
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
   * Andamento na mao. Zera as sequencias: se voce acabou de mudar o tempo, as
   * limpas anteriores nao valem como progresso pra promover deste ponto.
   */
  const setTempo = useCallback((bpm: number) => {
    // Campo vazio ou "-" no meio da digitacao vira NaN, e NaN atravessa
    // Math.min/max sem reclamar ate chegar no value do input.
    if (!Number.isFinite(bpm)) return
    const alvo = Math.max(DEFAULT_RAMP.minBpm, Math.min(DEFAULT_RAMP.maxBpm, Math.round(bpm)))
    // Atualiza o ref na hora: dois cliques no mesmo quadro leriam o mesmo
    // ramp.bpm do render e o segundo nao andaria.
    bpmRef.current = alvo
    setRamp((prev) => ({ ...prev, bpm: alvo, cleanStreak: 0, failStreak: 0 }))
    transportRef.current?.setBpm(alvo)
  }, [])

  // --- derivados pra tela ----------------------------------------------------
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
  // Ultima limpa que falta: e a volta em que vale avisar antes, nao depois.
  const prestesASubir =
    (mode === 'ladder' || mode === 'burst') &&
    (phase === 'playing' || phase === 'countin') &&
    ramp.cleanStreak === rampConfig.repsToAdvance - 1

  return (
    <div className="shred">
      <div className="controls">
        <label>
          Exercicio
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
          Tom
          <select value={rootPc} onChange={(e) => persist({ rootPc: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, pc) => (
              <option key={pc} value={pc}>
                {pitchClassName(pc, spelling)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Maos
          <select value={handMode} onChange={(e) => persist({ handMode: e.target.value })}>
            {(Object.keys(HAND_MODE_LABEL) as HandMode[]).map((h) => (
              <option key={h} value={h}>
                {HAND_MODE_LABEL[h]}
              </option>
            ))}
          </select>
        </label>

        <label>
          Ordem
          <select value={order} onChange={(e) => persist({ order: e.target.value })}>
            <option value="fourths">Quartas</option>
            <option value="chromatic">Cromatica</option>
            <option value="random">Aleatoria</option>
          </select>
        </label>

        <button
          onClick={() => {
            orderIndexRef.current += 1
            persist({ rootPc: rootAt(order, orderIndexRef.current) })
          }}
        >
          Proximo tom
        </button>

        <label>
          Rigor
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

        <label title="Quantas voltas limpas seguidas sobem o andamento. Uma volta ruim zera a contagem.">
          Sobe apos
          <select
            value={range.advanceReps}
            onChange={(e) =>
              persist({ advanceReps: Number(e.target.value) })
            }
          >
            <option value={1}>1 limpa</option>
            <option value={2}>2 limpas</option>
            <option value={3}>3 limpas</option>
          </select>
        </label>

        <label>
          Modo
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
            <button onClick={ouvir}>Ouvir</button>
            <button className="primary" onClick={start}>
              Comecar
            </button>
          </>
        ) : (
          <button className="primary" onClick={stop}>
            Parar
          </button>
        )}
      </div>

      <div className="exercise-head">
        <div>
          <span className="badge">{FAMILY_LABEL[exercise.family]}</span>
          <span className="badge">{LEVEL_LABEL[exercise.level]}</span>
          <strong>{exercise.label}</strong> em {pitchClassName(rootPc, spelling)}
          <span className="focus"> · {exercise.focus}</span>
          {handMode !== 'as-is' && (
            <span className="badge override">{HAND_MODE_LABEL[handMode]}</span>
          )}
        </div>
        <div className="tempo">
          {mode === 'accel' ? (
            // No accel quem manda no andamento e a curva, nao voce.
            <span className={`bpm ${phase}`}>{bpmNow} BPM</span>
          ) : (
            <span className="tempo-picker">
              <button
                onClick={() => setTempo(bpmRef.current - DEFAULT_RAMP.stepBpm)}
                aria-label="diminuir andamento"
              >
                −
              </button>
              <input
                className={`bpm ${phase}`}
                type="number"
                min={DEFAULT_RAMP.minBpm}
                max={DEFAULT_RAMP.maxBpm}
                step={1}
                value={ramp.bpm}
                onChange={(e) => setTempo(Number(e.target.value))}
              />
              <span className="dim">BPM</span>
              <button
                onClick={() => setTempo(bpmRef.current + DEFAULT_RAMP.stepBpm)}
                aria-label="aumentar andamento"
              >
                +
              </button>
            </span>
          )}
          <span className="dim">
            {' '}
            alvo {exercise.tempos.target} · {repBars} compasso{repBars > 1 ? 's' : ''} por volta
          </span>
          {best > 0 && <span className="pr"> recorde {best}</span>}
          {pr && <span className="dim"> ({pitchClassName(rootPc, spelling)}: {pr.bpm})</span>}
        </div>
      </div>

      {mode !== 'accel' && (
        <label className="tempo-slider">
          <input
            type="range"
            min={DEFAULT_RAMP.minBpm}
            max={Math.max(DEFAULT_RAMP.maxBpm, exercise.tempos.target)}
            step={1}
            value={ramp.bpm}
            onChange={(e) => setTempo(Number(e.target.value))}
            aria-label="andamento"
          />
          <span className="dim">
            {exercise.tempos.start} inicial · {exercise.tempos.target} alvo
          </span>
        </label>
      )}

      <div className="audio-row">
        <label className="click-volume" title="Volume do clique. Nao afeta o piano.">
          clique {Math.round(range.clickVolume * 100)}%
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
          title="O piano toca o exercicio junto com voce, volta apos volta — nao so no Ouvir."
        >
          <input
            type="checkbox"
            checked={range.guide}
            onChange={(e) => persist({ guide: e.target.checked })}
          />
          referencia {Math.round(range.guideVolume * 100)}%
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
      {mode !== 'accel' && mode !== 'free' && (
        <p className={`ramp-progress ${ramp.failStreak > 0 ? 'down' : 'up'}`}>
          {ramp.failStreak > 0 ? (
            <>
              <Dots on={ramp.failStreak} total={DEFAULT_RAMP.repsToRetreat} />
              {' '}
              mais {DEFAULT_RAMP.repsToRetreat - ramp.failStreak} falha
              {DEFAULT_RAMP.repsToRetreat - ramp.failStreak > 1 ? 's' : ''} e desce para{' '}
              <strong>{targets.down}</strong> BPM
            </>
          ) : (
            <>
              <Dots on={ramp.cleanStreak} total={rampConfig.repsToAdvance} />
              {' '}
              mais {rampConfig.repsToAdvance - ramp.cleanStreak} limpa
              {rampConfig.repsToAdvance - ramp.cleanStreak > 1 ? 's' : ''} e sobe para{' '}
              <strong>{targets.up}</strong> BPM
            </>
          )}
        </p>
      )}

      <p className="limits">
        Nesta volta passa com ate{' '}
        <strong>
          {Math.max(1, Math.round(tolerance.maxErrorRate * expansion.notes.length))} erro
          {Math.max(1, Math.round(tolerance.maxErrorRate * expansion.notes.length)) > 1 ? 's' : ''}
        </strong>{' '}
        em {expansion.notes.length} notas
        {tolerance.timingGates ? (
          <>
            {' '}· irregularidade ate <strong>{(tolerance.maxIoiCv * 100).toFixed(0)}%</strong> ·
            andamento ±<strong>{(tolerance.maxBpmDeviation * 100).toFixed(0)}%</strong>
          </>
        ) : (
          <> · timing so medido, nao reprova</>
        )}
      </p>
      {expansion.warning && <p className="warn">{expansion.warning}</p>}
      {audioError && <p className="error">{audioError}</p>}

      <div className="roll-stack">
        {announce && <div className={`roll-announce ${announce.kind}`}>{announce.text}</div>}
        {!announce && prestesASubir && (
          <div className="roll-warn">esta volta limpa sobe para {targets.up} BPM</div>
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
        {phase === 'demo' && <span>ouvindo — o piano toca, voce so olha</span>}
        {phase === 'countin' && <span>contagem...</span>}
        {phase === 'resting' && <span>descanso — deixe a mao solta</span>}
        {phase === 'playing' && !lastGrade && <span>tocando</span>}
        {lastGrade && (
          <>
            <strong>{lastGrade.passed ? 'limpo' : 'ainda nao'}</strong>
            <span className="metric" title="notas certas na ordem">
              {Math.round(lastGrade.accuracy * 100)}% certas
            </span>
            <span className="metric" title="coeficiente de variacao dos intervalos entre ataques">
              regularidade {(lastGrade.ioiCv * 100).toFixed(1)}%
            </span>
            <span className="metric">{Math.round(lastGrade.effectiveBpm)} BPM real</span>
            {lastGrade.handSpreadMs > 0 && (
              <span className="metric" title="quanto as duas maos saem separadas">
                maos {lastGrade.handSpreadMs.toFixed(0)}ms
              </span>
            )}
            <span className="metric" title="desigualdade de ataque — teclado leve piora isso">
              ataque ±{lastGrade.velocityStdev.toFixed(0)}
            </span>
            <span className="metric" title="distancia media do clique. Se for grande e constante, ajuste o atraso em Teclado e entrada.">
              grade {lastGrade.gridMadMs.toFixed(0)}ms
            </span>
          </>
        )}
        {lastGrade && !lastGrade.passed && (
          <span className="reasons">{lastGrade.reasons.join(' · ')}</span>
        )}
        {lastGrade && (lastGrade.missedNotes.length > 0 || lastGrade.extraNotes.length > 0) && (
          <span className="note-diff">
            {lastGrade.missedNotes.length > 0 && (
              <>faltou {nomes(lastGrade.missedNotes, spelling)}</>
            )}
            {lastGrade.missedNotes.length > 0 && lastGrade.extraNotes.length > 0 && ' · '}
            {lastGrade.extraNotes.length > 0 && <>sobrou {nomes(lastGrade.extraNotes, spelling)}</>}
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
          <h3>Onde voce embola</h3>
          <p className="dim">
            Desvio medio por nota, acumulado nas suas passadas por este exercicio.
          </p>
          <ul>
            {worst.map((w) => {
              const alvo = expansion.notes.find((n) => n.group === w.index)
              return (
                <li key={w.index}>
                  nota {w.index + 1}
                  {alvo && ` (${midiToName(alvo.midi, spelling)}${alvo.finger ? `, dedo ${alvo.finger}` : ''})`}
                  : ±{w.devMs.toFixed(0)}ms
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <details className="shred-settings">
        <summary>Teclado e entrada</summary>
        <div className="controls">
          <span>
            Faixa: {midiToName(range.low, spelling)} a {midiToName(range.high, spelling)}
          </span>
          {detecting ? (
            <>
              <span className="dim">
                toque a nota mais grave e a mais aguda ({detecting.low <= detecting.high
                  ? `${midiToName(detecting.low, spelling)}–${midiToName(detecting.high, spelling)}`
                  : 'aguardando'})
              </span>
              <button
                onClick={() => {
                  if (detecting.high - detecting.low >= 24) {
                    persist({ low: detecting.low, high: detecting.high })
                  }
                  setDetecting(null)
                }}
              >
                Usar
              </button>
              <button onClick={() => setDetecting(null)}>Cancelar</button>
            </>
          ) : (
            <button onClick={() => setDetecting({ low: 127, high: 0 })}>Detectar</button>
          )}
          <label title="Descontado do instante de cada nota. Suba ate o desvio de grade cair.">
            atraso {range.latencyMs}ms
            <input
              type="range"
              min={-50}
              max={200}
              step={5}
              value={range.latencyMs}
              onChange={(e) => persist({ latencyMs: Number(e.target.value) })}
            />
          </label>
          <label title="Numero do dedo em cima de cada nota do piano-roll.">
            <input
              type="checkbox"
              checked={range.showFingers}
              onChange={(e) => persist({ showFingers: e.target.checked })}
            />
            dedilhado
          </label>
          <label>
            <input type="checkbox" checked={qwerty} onChange={(e) => persist({ qwerty: e.target.checked })} />
            teclado do computador
          </label>
        </div>
        {qwerty && <p className="dim">{QWERTY_HELP}</p>}
      </details>

      <div className="stats">
        {sessionRef.current.reps > 0 && (
          <>
            sessao: {sessionRef.current.passed}/{sessionRef.current.reps} limpas ·{' '}
          </>
        )}
        {best > 0 ? `recorde ${best} BPM` : 'sem recorde ainda'}
        <button
          onClick={() => {
            clearShredStats()
            setStats(loadShredStats())
          }}
        >
          zerar
        </button>
      </div>
    </div>
  )
}
