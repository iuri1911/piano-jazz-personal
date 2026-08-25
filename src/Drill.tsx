import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, marksFromComparison } from './Keyboard'
import { Staff } from './Staff'
import { chordLabel, compareToTarget, handNotes, pitchClassName, type Spelling } from './theory'
import { QUALITY_LABEL, VOICINGS, type Quality, voicingToMidi } from './voicings'
import { loadStats, recordAttempt, summaryFor, clearStats, type Stats } from './stats'

// Ciclo de quartas, o jeito padrao de transpor exercicio de jazz.
const FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]
const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

type Order = 'fourths' | 'chromatic' | 'random'

// Fundamental sempre em C3..B3 — assim o alvo desenhado na pauta e sem ambiguidade.
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

  // Novo voicing ou nova ordem reinicia a sequencia.
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

  // Avalia a cada acorde estavel novo. `settled` e um array novo a cada leitura,
  // entao repetir o mesmo acorde dispara de novo — que e o desejado.
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
    // So conta erro quando ja tem notas suficientes; acorde em construcao nao penaliza.
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
          <legend>Qualidade</legend>
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
          Ordem
          <select value={order} onChange={(e) => setOrder(e.target.value as Order)}>
            <option value="fourths">Ciclo de quartas</option>
            <option value="chromatic">Cromatica</option>
            <option value="random">Aleatoria</option>
          </select>
        </label>

        <button onClick={advance}>Pular</button>
        <button onClick={() => setRevealed((r) => !r)}>
          {revealed ? 'Esconder' : 'Mostrar'} resposta
        </button>
      </div>

      <div className={`prompt ${result}`}>
        <div className="chord-symbol">{chordLabel(target.rootPc, target.quality, spelling)}</div>
        <div className="voicing-name">{voicing.label}</div>
        <div className="verdict">
          {result === 'correct' ? 'certo' : result === 'wrong' ? 'errado' : '...'}
        </div>
      </div>

      <div className="side-by-side">
        <div>
          <h3>Alvo</h3>
          <Staff notes={targetMidi} spelling={spelling} />
          {revealed && (
            <p className="hand-notes">
              ME: {hands.lh.join(' ')} &nbsp;|&nbsp; MD: {hands.rh.join(' ')}
            </p>
          )}
        </div>
        <div>
          <h3>Tocado</h3>
          <Staff notes={settled} spelling={spelling} color={result === 'wrong' ? '#c0392b' : '#111'} />
        </div>
      </div>

      <Keyboard marks={marksFromComparison(comparison)} />

      <div className="legend">
        <span className="swatch correct" /> certa
        <span className="swatch extra" /> sobrando
        <span className="swatch missing" /> faltando
      </div>

      <div className="stats">
        {voicing.label}: {summary.correct}/{summary.attempts} ({Math.round(summary.accuracy * 100)}%)
        {summary.avgMs > 0 && <> · {(summary.avgMs / 1000).toFixed(1)}s por acorde</>}
        <button
          onClick={() => {
            clearStats()
            setStats({})
          }}
        >
          zerar
        </button>
      </div>

      <details className="per-key">
        <summary>Por tom</summary>
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
