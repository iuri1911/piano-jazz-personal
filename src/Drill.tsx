import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, marksFromComparison } from './Keyboard'
import { Staff } from './Staff'
import { chordLabel, compareToTarget, handNotes, pitchClassName, type Spelling } from './theory'
import { QUALITY_LABEL, VOICINGS, type Quality, voicingToMidi } from './voicings'
import { loadStats, recordAttempt, summaryFor, clearStats, type Stats } from './stats'

// Cycle of fourths, the standard way to transpose a jazz exercise.
const FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]
const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

type Order = 'fourths' | 'chromatic' | 'random'

// Root always in C3..B3 — that way the target drawn on the staff is unambiguous.
const ROOT_OCTAVE_BASE = 48

type Target = { rootPc: number; quality: Quality }

type Props = { settled: number[]; spelling: Spelling }

export function Drill({ settled, spelling }: Props) {
  const [voicingId, setVoicingId] = useState(VOICINGS[0].id)
  const [qualities, setQualities] = useState<Quality[]>(['m7'])
  const [order, setOrder] = useState<Order>('fourths')
  const [target, setTarget] = useState<Target>({ rootPc: 0, quality: 'm7' })
  const [result, setResult] = useState<'pending' | 'correct' | 'wrong'>('pending')
  const [revealed, setRevealed] = useState(false)
  const [stats, setStats] = useState<Stats>(() => loadStats())

  const voicing = VOICINGS.find((v) => v.id === voicingId) ?? VOICINGS[0]
  const allowed = qualities.filter((q) => voicing.qualities.includes(q))
  const activeQualities = allowed.length ? allowed : [voicing.qualities[0]]

  const startedAtRef = useRef(performance.now())
  const lockedRef = useRef(false)
  const indexRef = useRef(0)

  const nextTarget = useCallback(
    (i: number) => {
      const sequence = order === 'chromatic' ? CHROMATIC : FOURTHS
      const rootPc =
        order === 'random' ? Math.floor(Math.random() * 12) : sequence[i % sequence.length]
      const quality = activeQualities[i % activeQualities.length]
      setTarget({ rootPc, quality })
      setResult('pending')
      setRevealed(false)
      startedAtRef.current = performance.now()
      lockedRef.current = false
    },
    [order, activeQualities.join(',')],
  )

  // A new voicing or a new order restarts the sequence.
  useEffect(() => {
    indexRef.current = 0
    nextTarget(0)
  }, [voicingId, order, activeQualities.join(',')])

  const advance = useCallback(() => {
    indexRef.current += 1
    nextTarget(indexRef.current)
  }, [nextTarget])

  const targetMidi = voicingToMidi(voicing, target.quality, ROOT_OCTAVE_BASE + target.rootPc)
  const comparison = compareToTarget(settled, targetMidi)

  // Evaluates on every new settled chord. `settled` is a fresh array on each
  // reading, so playing the same chord again fires again — which is what we want.
  useEffect(() => {
    if (settled.length === 0 || lockedRef.current) return
    const c = compareToTarget(settled, targetMidi)
    if (c.exact) {
      lockedRef.current = true
      setResult('correct')
      setStats(
        recordAttempt(voicing.id, target.rootPc, true, performance.now() - startedAtRef.current),
      )
      const t = setTimeout(advance, 700)
      return () => clearTimeout(t)
    }
    // Only counts a miss once there are enough notes; a chord being built is not penalized.
    if (settled.length >= targetMidi.length) {
      setResult('wrong')
      setStats(
        recordAttempt(voicing.id, target.rootPc, false, performance.now() - startedAtRef.current),
      )
    }
  }, [settled])

  const hands = handNotes(voicing, target.quality, ROOT_OCTAVE_BASE + target.rootPc, spelling)
  const summary = summaryFor(stats, voicing.id)

  return (
    <div className="drill">
      <div className="controls">
        <label>
          Voicing
          <select value={voicingId} onChange={(e) => setVoicingId(e.target.value)}>
            {VOICINGS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="qualities">
          <legend>Quality</legend>
          {voicing.qualities.map((q) => (
            <label key={q}>
              <input
                type="checkbox"
                checked={activeQualities.includes(q)}
                onChange={(e) =>
                  setQualities((prev) =>
                    e.target.checked ? [...new Set([...prev, q])] : prev.filter((x) => x !== q),
                  )
                }
              />
              {QUALITY_LABEL[q]}
            </label>
          ))}
        </fieldset>

        <label>
          Order
          <select value={order} onChange={(e) => setOrder(e.target.value as Order)}>
            <option value="fourths">Cycle of fourths</option>
            <option value="chromatic">Chromatic</option>
            <option value="random">Random</option>
          </select>
        </label>

        <button onClick={advance}>Skip</button>
        <button onClick={() => setRevealed((r) => !r)}>
          {revealed ? 'Hide' : 'Show'} answer
        </button>
      </div>

      <div className={`prompt ${result}`}>
        <div className="chord-symbol">{chordLabel(target.rootPc, target.quality, spelling)}</div>
        <div className="voicing-name">{voicing.label}</div>
        <div className="verdict">
          {result === 'correct' ? 'right' : result === 'wrong' ? 'wrong' : '...'}
        </div>
      </div>

      <div className="side-by-side">
        <div>
          <h3>Target</h3>
          <Staff notes={targetMidi} spelling={spelling} />
          {revealed && (
            <p className="hand-notes">
              LH: {hands.lh.join(' ')} &nbsp;|&nbsp; RH: {hands.rh.join(' ')}
            </p>
          )}
        </div>
        <div>
          <h3>Played</h3>
          <Staff notes={settled} spelling={spelling} color={result === 'wrong' ? '#c0392b' : '#111'} />
        </div>
      </div>

      <Keyboard marks={marksFromComparison(comparison)} />

      <div className="legend">
        <span className="swatch correct" /> right
        <span className="swatch extra" /> extra
        <span className="swatch missing" /> missing
      </div>

      <div className="stats">
        {voicing.label}: {summary.correct}/{summary.attempts} ({Math.round(summary.accuracy * 100)}%)
        {summary.avgMs > 0 && <> · {(summary.avgMs / 1000).toFixed(1)}s per chord</>}
        <button
          onClick={() => {
            clearStats()
            setStats({})
          }}
        >
          reset
        </button>
      </div>

      <details className="per-key">
        <summary>By key</summary>
        <ul>
          {CHROMATIC.map((pc) => {
            const e = stats[voicing.id]?.[pc]
            if (!e) return null
            return (
              <li key={pc}>
                {pitchClassName(pc, spelling)}: {e.correct}/{e.attempts}
              </li>
            )
          })}
        </ul>
      </details>
    </div>
  )
}
