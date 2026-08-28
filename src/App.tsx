import { useEffect, useState } from 'react'
import { armAudioResume, resumeAudio } from './audio'
import {
  VOICE_HELP,
  VOICE_LABEL,
  instrument,
  loadSound,
  saveSound,
  type Voice,
} from './instrument'
import { Drill } from './Drill'
import { Shred } from './shred/Shred'
import { Keyboard, marksFromHeld } from './Keyboard'
import { Staff } from './Staff'
import { DEFAULT_SETTLE_MS, useMidi } from './midi'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
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
  const [sound, setSound] = useState(loadSound)
  const { held, settled, pedal, devices, error } = useMidi(settleMs)

  // The instrument listens to the keyboard on every tab: you play in all three.
  useEffect(() => {
    instrument.connect()
    armAudioResume()
    return () => instrument.disconnect()
  }, [])

  useEffect(() => {
    instrument.setVoice(sound.voice)
    instrument.setLevel(sound.level)
  }, [sound])

  const changeSound = (patch: Partial<typeof sound>) => {
    // Picking a voice is a gesture, which is the browser's cue to let audio start.
    void resumeAudio()
    setSound((prev) => saveSound({ ...prev, ...patch }))
  }

  return (
    <div className="app">
      <header>
        <h1>
          keytrainer<span className="caret" aria-hidden="true" />
        </h1>
        <nav>
          <button className={tab === 'viz' ? 'on' : ''} onClick={() => setTab('viz')}>
            [ visualizer ]
          </button>
          <button className={tab === 'drill' ? 'on' : ''} onClick={() => setTab('drill')}>
            [ drill ]
          </button>
          <button className={tab === 'shred' ? 'on' : ''} onClick={() => setTab('shred')}>
            [ shred ]
          </button>
        </nav>
        <div className="settings">
          <label className="sound" title={VOICE_HELP[sound.voice]}>
            sound
            <select
              value={sound.voice}
              onChange={(e) => changeSound({ voice: e.target.value as Voice })}
            >
              {(Object.keys(VOICE_LABEL) as Voice[]).map((v) => (
                <option key={v} value={v}>
                  {VOICE_LABEL[v]}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(sound.level * 100)}
              disabled={sound.voice === 'off'}
              aria-label="instrument volume"
              onChange={(e) => changeSound({ level: Number(e.target.value) / 100 })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={spelling === 'sharp'}
              onChange={(e) => setSpelling(e.target.checked ? 'sharp' : 'flat')}
            />
            sharps
          </label>
          <label title="Time without MIDI events before the chord counts as settled">
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
          <span className="ps1">iuri@keytrainer:~$</span>
          {devices.length ? `midi — ${devices.join(', ')}` : 'midi — no device found'}
          {pedal && <span className="pedal-on">pedal</span>}
        </p>
      )}

      {tab === 'viz' && <Visualizer held={held} settled={settled} spelling={spelling} />}
      {tab === 'drill' && <Drill settled={settled} spelling={spelling} />}
      {/* Shred subscribes to the raw events: a settled chord is no use for single notes. */}
      {tab === 'shred' && <Shred spelling={spelling} />}

      <footer aria-hidden="true">
        <div>
          <span className="ps1">iuri@keytrainer:~$</span> exit
        </div>
        <div className="done">
          [process completed]
          <span className="caret" />
        </div>
      </footer>
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
  // Shows the last settled chord: it stays up after you let go of the keys.
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
            {match.voicing.label} on {chordLabel(match.rootMidi % 12, match.quality, spelling)}
          </div>
        )}
        {names.length > 1 && <div className="alt-names">also: {names.slice(1, 4).join(', ')}</div>}
        <div className="note-list">{notes.map((n) => midiToName(n, spelling)).join(' ')}</div>
        <div className="intervals">{intervals.join(' ')}</div>
        {match?.voicing.note && <p className="voicing-note">{match.voicing.note}</p>}
      </div>

      <Staff notes={notes} spelling={spelling} />
      <Keyboard marks={marksFromHeld(held.length ? held : notes)} />
    </div>
  )
}
