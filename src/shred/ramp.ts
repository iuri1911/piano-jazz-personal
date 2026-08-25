// Como o andamento sobe, e os modos de sessao.

export type Mode = 'ladder' | 'burst' | 'accel' | 'free'

export const MODE_LABEL: Record<Mode, string> = {
  ladder: 'Escada',
  burst: 'Rajada',
  accel: 'Acelerando',
  free: 'Livre',
}

export const MODE_HELP: Record<Mode, string> = {
  ladder: 'N repeticoes limpas sobem o BPM; duas falhas descem. O protocolo padrao.',
  burst: 'Toca uma repeticao, descansa uma. Serve pra ir acima do confortavel sem acumular tensao — e assim que barreira de velocidade cai.',
  accel: 'O clique acelera do inicial ao alvo durante a sessao. Mostra em que BPM voce quebra.',
  free: 'So o metronomo, sem avaliacao.',
}

export type RampConfig = {
  minBpm: number
  maxBpm: number
  /** Quanto sobe e quanto desce, em BPM. Vale pro ramp e pros botoes. */
  stepBpm: number
  /** Repeticoes limpas seguidas pra subir. */
  repsToAdvance: number
  /** Falhas seguidas pra descer. */
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
  /** Maior BPM em que uma repeticao passou nesta sessao. */
  bestCleanBpm: number
}

export function newRamp(bpm: number): RampState {
  return { bpm, cleanStreak: 0, failStreak: 0, bestCleanBpm: 0 }
}

export type RampEvent = 'up' | 'down' | 'hold'

/**
 * Aplica o resultado de uma repeticao. Puro: a decisao de andamento e
 * exatamente o tipo de coisa que fica errada em silencio dentro de um effect.
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
    // Desce um passo, o mesmo que subiria: o andamento anda numa grade so, e
    // voce sempre sabe pra onde vai antes de acontecer.
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
 * Curva de tempo do modo accel: o BPM sobe linearmente por TEMPO (nao por
 * segundo). Devolve onde cada tempo cai em ms.
 *
 * Reproduz o mesmo passo a passo do transporte — que agenda cada tempo com a
 * duracao do BPM daquele tempo — em vez da integral exata. Se as duas contas
 * divergissem, a avaliacao acusaria atraso onde a pessoa tocou certo.
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

/** Pra onde o andamento vai na proxima subida e na proxima descida. */
export function rampTargets(
  state: RampState,
  config: RampConfig = DEFAULT_RAMP,
): { up: number; down: number } {
  return {
    up: Math.min(config.maxBpm, state.bpm + config.stepBpm),
    down: Math.max(config.minBpm, state.bpm - config.stepBpm),
  }
}
