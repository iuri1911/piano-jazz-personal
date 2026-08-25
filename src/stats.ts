const KEY = 'pjt:stats'

export type Entry = { attempts: number; correct: number; totalMs: number }
export type Stats = Record<string, Record<string, Entry>> // voicingId -> pitchClass -> entry

export function loadStats(): Stats {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stats
  } catch {
    return {} // storage corrompido nao pode derrubar o app
  }
}

export function recordAttempt(voicingId: string, pitchClass: number, correct: boolean, ms: number): Stats {
  const stats = loadStats()
  const byPc = (stats[voicingId] ??= {})
  const entry = (byPc[pitchClass] ??= { attempts: 0, correct: 0, totalMs: 0 })
  entry.attempts++
  if (correct) {
    entry.correct++
    entry.totalMs += ms
  }
  localStorage.setItem(KEY, JSON.stringify(stats))
  return stats
}

export function summaryFor(stats: Stats, voicingId: string) {
  const byPc = stats[voicingId] ?? {}
  const entries = Object.values(byPc)
  const attempts = entries.reduce((s, e) => s + e.attempts, 0)
  const correct = entries.reduce((s, e) => s + e.correct, 0)
  const totalMs = entries.reduce((s, e) => s + e.totalMs, 0)
  return {
    attempts,
    correct,
    accuracy: attempts ? correct / attempts : 0,
    avgMs: correct ? totalMs / correct : 0,
  }
}

export function clearStats() {
  localStorage.removeItem(KEY)
}
