import { useEffect, useRef } from 'react'
import type { MidiEvent } from '../midi'

// Entrada pelo teclado do computador.
//
// Existe pra dar pra testar o motor sem hardware — e serve de plano B quando o
// A-49 nao esta na mesa. Layout de tracker: a fila de baixo e uma oitava, a de
// cima e a seguinte, com as pretas nas teclas de cima de cada uma.

const LAYOUT: Record<string, number> = {
  // oitava base
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5,
  KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  // oitava de cima
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17,
  Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
}

export const QWERTY_HELP =
  'Fila de baixo (Z S X D C...) e a oitava base, fila de cima (Q 2 W 3 E...) a seguinte. Setas ← → mudam de oitava.'

/**
 * Emite os mesmos MidiEvent do teclado de verdade, entao o resto do app nao
 * sabe a diferenca. `baseNote` e o C mais grave do layout.
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
      // O autorepeat do SO mandaria dezenas de note-on da mesma tecla segurada.
      if (down.current.has(e.code)) return
      down.current.add(e.code)
      cb.current({
        kind: 'on',
        note: base.current + offset + shift.octaves * 12,
        velocity: 80,
        time: performance.now(),
      })
    }

    const keyUp = (e: KeyboardEvent) => {
      const offset = LAYOUT[e.code]
      if (offset === undefined || !down.current.delete(e.code)) return
      cb.current({
        kind: 'off',
        note: base.current + offset + shift.octaves * 12,
        velocity: 0,
        time: performance.now(),
      })
    }

    // Trocar de aba com tecla apertada deixaria a nota presa pra sempre.
    const blur = () => down.current.clear()

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
