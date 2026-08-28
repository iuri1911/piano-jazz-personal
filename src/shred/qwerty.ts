import { useEffect, useRef } from 'react'
import type { MidiEvent } from '../midi'
import { instrument } from '../instrument'

// Input from the computer keyboard.
//
// It exists so the engine can be tested without hardware — and it works as a
// fallback when the controller is not on the desk. Tracker layout: the bottom
// row is one octave, the top row the next, with the black keys on the row above
// each of them.

const LAYOUT: Record<string, number> = {
  // base octave
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5,
  KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  // octave above
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17,
  Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
}

export const QWERTY_HELP =
  'The bottom row (Z S X D C...) is the base octave, the top row (Q 2 W 3 E...) the next one. The ← → arrows change octave.'

/**
 * Emits the same MidiEvent as the real keyboard, so the rest of the app cannot
 * tell the difference. `baseNote` is the lowest C of the layout.
 */
export function useComputerKeyboard(
  enabled: boolean,
  onEvent: (e: MidiEvent) => void,
  baseNote = 48,
): void {
  const cb = useRef(onEvent)
  cb.current = onEvent
  const base = useRef(baseNote)
  base.current = baseNote
  const down = useRef(new Set<string>())

  useEffect(() => {
    if (!enabled) return

    const shift = { octaves: 0 }

    const keyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        shift.octaves = Math.max(-2, Math.min(2, shift.octaves + (e.code === 'ArrowRight' ? 1 : -1)))
        e.preventDefault()
        return
      }
      const offset = LAYOUT[e.code]
      if (offset === undefined) return
      e.preventDefault()
      // OS autorepeat would send dozens of note-ons for the same held key.
      if (down.current.has(e.code)) return
      down.current.add(e.code)
      const note = base.current + offset + shift.octaves * 12
      // Straight to the instrument: these never reach the MIDI fan-out, so the
      // app's own voice would otherwise stay silent for computer-keyboard input.
      instrument.play('on', note, 80)
      cb.current({ kind: 'on', note, velocity: 80, time: performance.now() })
    }

    const keyUp = (e: KeyboardEvent) => {
      const offset = LAYOUT[e.code]
      if (offset === undefined || !down.current.delete(e.code)) return
      const note = base.current + offset + shift.octaves * 12
      instrument.play('off', note)
      cb.current({ kind: 'off', note, velocity: 0, time: performance.now() })
    }

    // Switching tabs with a key held down would leave the note stuck forever.
    const blur = () => {
      // Otherwise the note is stuck down AND stuck sounding.
      for (const code of down.current) {
        const offset = LAYOUT[code]
        if (offset !== undefined) instrument.play('off', base.current + offset + shift.octaves * 12)
      }
      down.current.clear()
    }

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
      down.current.clear()
    }
  }, [enabled])
}
