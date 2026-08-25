import { useState } from 'react'
import { Drill } from './Drill'
import { Shred } from './shred/Shred'
import { Keyboard, marksFromHeld } from './Keyboard'
import { Staff } from './Staff'
import { DEFAULT_SETTLE_MS, useMidi } from './midi'
import {
  chordLabel,
  detectChord,
  detectVoicing,
  intervalsFromBass,
  midiToName,
  type Spelling,
} from './theory'
import './styles.css'

export default function App() {
  const [tab, setTab] = useState<'viz' | 'drill' | 'shred'>('viz')
  const [spelling, setSpelling] = useState<Spelling>('flat')
  const [settleMs, setSettleMs] = useState(DEFAULT_SETTLE_MS)
  const { held, settled, pedal, devices, error } = useMidi(settleMs)

  return (
    <div className="app">
      <header>
        <h1>Piano Jazz Trainer</h1>
        <nav>
          <button className={tab === 'viz' ? 'on' : ''} onClick={() => setTab('viz')}>
            Visualizador
          </button>
          <button className={tab === 'drill' ? 'on' : ''} onClick={() => setTab('drill')}>
            Drill
          </button>
          <button className={tab === 'shred' ? 'on' : ''} onClick={() => setTab('shred')}>
            Shred
          </button>
        </nav>
        <div className="settings">
          <label>
            <input
              type="checkbox"
              checked={spelling === 'sharp'}
              onChange={(e) => setSpelling(e.target.checked ? 'sharp' : 'flat')}
            />
            sustenidos
          </label>
          <label title="Tempo sem eventos MIDI para considerar o acorde fechado">
            settle {settleMs}ms
            <input
              type="range"
              min={20}
              max={200}
              step={5}
              value={settleMs}
              onChange={(e) => setSettleMs(Number(e.target.value))}
            />
          </label>
        </div>
      </header>

      {error ? (
        <p className="error">{error}</p>
      ) : (
        <p className="devices">
          {devices.length ? `MIDI: ${devices.join(', ')}` : 'Nenhum dispositivo MIDI encontrado.'}
          {pedal && <span className="pedal-on">pedal</span>}
        </p>
      )}

      {tab === 'viz' && <Visualizer held={held} settled={settled} spelling={spelling} />}
      {tab === 'drill' && <Drill settled={settled} spelling={spelling} />}
      {/* Shred assina os eventos crus direto: acorde estavel nao serve pra nota solta. */}
      {tab === 'shred' && <Shred spelling={spelling} />}
    </div>
  )
}

function Visualizer({
  held,
  settled,
  spelling,
}: {
  held: number[]
  settled: number[]
  spelling: Spelling
}) {
  // Mostra o ultimo acorde estavel: continua no ar depois que voce solta as teclas.
  const notes = settled
  const names = detectChord(notes, spelling)
  const match = detectVoicing(notes)
  const intervals = intervalsFromBass(notes)

  return (
    <div className="viz">
      <div className="readout">
        <div className="chord-symbol">{names[0] ?? (notes.length ? '?' : '—')}</div>
        {match && (
          <div className="voicing-name">
            {match.voicing.label} em {chordLabel(match.rootMidi % 12, match.quality, spelling)}
          </div>
        )}
        {names.length > 1 && <div className="alt-names">tambem: {names.slice(1, 4).join(', ')}</div>}
        <div className="note-list">{notes.map((n) => midiToName(n, spelling)).join(' ')}</div>
        <div className="intervals">{intervals.join(' ')}</div>
        {match?.voicing.note && <p className="voicing-note">{match.voicing.note}</p>}
      </div>

      <Staff notes={notes} spelling={spelling} />
      <Keyboard marks={marksFromHeld(held.length ? held : notes)} />
    </div>
  )
}
