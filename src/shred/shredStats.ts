const KEY = 'pjt:shred'

export type Pr = { bpm: number; date: string }

export type ShredStats = {
  /** exerciseId -> pitchClass -> melhor BPM limpo. */
  prs: Record<string, Record<string, Pr>>
  /**
   * exerciseId -> desvio acumulado por indice de grupo. Soma e contagem em vez
   * da media pronta pra media nova nao apagar o historico.
   */
  perGroup: Record<string, { sum: number[]; count: number[] }>
  sessions: { date: string; exerciseId: string; reps: number; passed: number; bestBpm: number }[]
}

const EMPTY: ShredStats = { prs: {}, perGroup: {}, sessions: [] }

export function loadShredStats(): ShredStats {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ShredStats>
    return { ...EMPTY, ...raw, prs: raw.prs ?? {}, perGroup: raw.perGroup ?? {}, sessions: raw.sessions ?? [] }
  } catch {
    return { ...EMPTY } // storage corrompido nao pode derrubar o app
  }
}

function save(stats: ShredStats): ShredStats {
  localStorage.setItem(KEY, JSON.stringify(stats))
  return stats
}

export function recordRep(
  exerciseId: string,
  pitchClass: number,
  bpm: number,
  passed: boolean,
  perGroupDevMs: (number | null)[],
): ShredStats {
  const stats = loadShredStats()

  if (passed) {
    const byPc = (stats.prs[exerciseId] ??= {})
    const current = byPc[pitchClass]
    if (!current || bpm > current.bpm) {
      byPc[pitchClass] = { bpm, date: new Date().toISOString().slice(0, 10) }
    }
  }

  // O diagnostico so faz sentido com o desvio em modulo: interessa QUAL nota
  // destoa, nao se ela atrasou ou adiantou nesta volta especifica.
  const acc = (stats.perGroup[exerciseId] ??= { sum: [], count: [] })
  perGroupDevMs.forEach((dev, i) => {
    if (dev === null) return
    acc.sum[i] = (acc.sum[i] ?? 0) + Math.abs(dev)
    acc.count[i] = (acc.count[i] ?? 0) + 1
  })

  return save(stats)
}

export function recordSession(
  exerciseId: string,
  reps: number,
  passed: number,
  bestBpm: number,
): ShredStats {
  const stats = loadShredStats()
  if (reps > 0) {
    stats.sessions.push({
      date: new Date().toISOString().slice(0, 10),
      exerciseId,
      reps,
      passed,
      bestBpm,
    })
    // Historico e pra olhar tendencia, nao pra virar arquivo morto.
    if (stats.sessions.length > 200) stats.sessions = stats.sessions.slice(-200)
  }
  return save(stats)
}

export function prFor(stats: ShredStats, exerciseId: string, pitchClass: number): Pr | null {
  return stats.prs[exerciseId]?.[pitchClass] ?? null
}

export function bestPrFor(stats: ShredStats, exerciseId: string): number {
  const byPc = stats.prs[exerciseId] ?? {}
  const all = Object.values(byPc).map((p) => p.bpm)
  return all.length ? Math.max(...all) : 0
}

/** Desvio medio absoluto por indice de nota. E o "qual nota voce embola". */
export function diagnosisFor(stats: ShredStats, exerciseId: string): (number | null)[] {
  const acc = stats.perGroup[exerciseId]
  if (!acc) return []
  return acc.sum.map((s, i) => {
    const c = acc.count[i] ?? 0
    // Menos de 3 passadas nao e dado, e ruido.
    return c >= 3 ? s / c : null
  })
}

/** Os piores indices, pra UI dizer o que olhar sem despejar o vetor todo. */
export function worstGroups(
  diagnosis: (number | null)[],
  count = 3,
): { index: number; devMs: number }[] {
  return diagnosis
    .map((devMs, index) => ({ index, devMs }))
    .filter((d): d is { index: number; devMs: number } => d.devMs !== null)
    .sort((a, b) => b.devMs - a.devMs)
    .slice(0, count)
}

export function clearShredStats() {
  localStorage.removeItem(KEY)
}

// --- configuracao do teclado ------------------------------------------------

const SETTINGS_KEY = 'pjt:shred:settings'

export type ShredSettings = {
  low: number
  high: number
  /**
   * Atraso da sua cadeia de entrada, em ms, descontado do instante de cada nota.
   * Nao muda regularidade (deslocamento constante nao afeta intervalo) — muda
   * onde a nota aparece contra a grade e no piano-roll.
   */
  latencyMs: number
  /** Quao permissivo o veredito e. Preferencia de estudo, entao fica salva. */
  strictness: string
  /** Volume do clique, 0 a 1. So do metronomo — o piano do "Ouvir" nao passa por aqui. */
  clickVolume: number
  /** Quantas voltas limpas seguidas sobem o andamento. 1 sobe assim que acerta. */
  advanceReps: number
  // O que estava selecionado. Guardado cru: quem valida contra as tabelas e o
  // componente, entao renomear um exercicio aqui nao quebra o storage de ninguem.
  exerciseId: string
  rootPc: number
  handMode: string
  order: string
  mode: string
  qwerty: boolean
  /** Numero do dedo nas notas do piano-roll. */
  showFingers: boolean
  /** Piano tocando o exercicio junto com voce, o tempo todo. */
  guide: boolean
  /** Volume da referencia, 0 a 1. Separado do clique. */
  guideVolume: number
}

/** A-49: 49 teclas, C2..C6. E o padrao ate a pessoa detectar o proprio. */
export const DEFAULT_SETTINGS: ShredSettings = {
  low: 36,
  high: 84,
  latencyMs: 0,
  strictness: 'padrao',
  clickVolume: 0.8,
  advanceReps: 2,
  exerciseId: '',
  rootPc: 0,
  handMode: 'as-is',
  order: 'fourths',
  mode: 'ladder',
  qwerty: false,
  showFingers: true,
  guide: false,
  guideVolume: 0.6,
}

/**
 * Preenche o que faltar. Roda tanto na leitura quanto na gravacao: assim um
 * objeto salvo por uma versao antiga do app — sem um campo que passou a
 * existir depois — nunca chega na UI como undefined e vira NaN num input.
 */
function normalize(raw: Partial<ShredSettings>): ShredSettings {
  const low = Number.isFinite(raw.low) ? (raw.low as number) : DEFAULT_SETTINGS.low
  const high = Number.isFinite(raw.high) ? (raw.high as number) : DEFAULT_SETTINGS.high
  // Faixa invertida ou pequena demais nao renderiza teclado nenhum.
  if (high - low < 24) return { ...DEFAULT_SETTINGS }
  return {
    low,
    high,
    latencyMs: Number.isFinite(raw.latencyMs) ? (raw.latencyMs as number) : DEFAULT_SETTINGS.latencyMs,
    strictness: typeof raw.strictness === 'string' ? raw.strictness : DEFAULT_SETTINGS.strictness,
    clickVolume: Number.isFinite(raw.clickVolume)
      ? Math.max(0, Math.min(1, raw.clickVolume as number))
      : DEFAULT_SETTINGS.clickVolume,
    advanceReps: Number.isFinite(raw.advanceReps)
      ? Math.max(1, Math.min(3, Math.round(raw.advanceReps as number)))
      : DEFAULT_SETTINGS.advanceReps,
    exerciseId: typeof raw.exerciseId === 'string' ? raw.exerciseId : '',
    rootPc: Number.isFinite(raw.rootPc)
      ? Math.max(0, Math.min(11, Math.round(raw.rootPc as number)))
      : 0,
    handMode: typeof raw.handMode === 'string' ? raw.handMode : DEFAULT_SETTINGS.handMode,
    order: typeof raw.order === 'string' ? raw.order : DEFAULT_SETTINGS.order,
    mode: typeof raw.mode === 'string' ? raw.mode : DEFAULT_SETTINGS.mode,
    qwerty: raw.qwerty === true,
    showFingers: raw.showFingers !== false, // ligado por padrao
    guide: raw.guide === true,
    guideVolume: Number.isFinite(raw.guideVolume)
      ? Math.max(0, Math.min(1, raw.guideVolume as number))
      : DEFAULT_SETTINGS.guideVolume,
  }
}

export function loadSettings(): ShredSettings {
  try {
    return normalize(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ShredSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Partial<ShredSettings>): ShredSettings {
  const completo = normalize(s)
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(completo))
  return completo
}
