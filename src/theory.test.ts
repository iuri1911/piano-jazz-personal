import { describe, expect, it } from 'vitest'
import { VOICING_BY_ID, VOICINGS, degreeToSemitones, voicingToMidi, voicingShape } from './voicings'
import { compareToTarget, detectVoicing, midiToName, midiToVexKey, sameSet } from './theory'
import { applyMidiMessage, newKeys, sounding } from './midi'

const C3 = 48

const v = (id: string) => VOICING_BY_ID.get(id)!

describe('degrees', () => {
  it('resolves the alteration from the chord quality', () => {
    expect(degreeToSemitones('3', 'm7')).toBe(3)
    expect(degreeToSemitones('3', 'maj7')).toBe(4)
    expect(degreeToSemitones('7', '7')).toBe(10)
    expect(degreeToSemitones('7', 'maj7')).toBe(11)
  })

  it('shifts octave with quotes and commas', () => {
    expect(degreeToSemitones("3'", 'm7')).toBe(15)
    expect(degreeToSemitones('5,', 'm7')).toBe(-5)
    expect(degreeToSemitones("1''", 'm7')).toBe(24)
  })

  it('rejects an invalid token', () => {
    expect(() => degreeToSemitones('b3', 'm7')).toThrow()
    expect(() => degreeToSemitones('4', 'm7')).toThrow()
  })
})

describe('voicingToMidi', () => {
  it('Rootless A on Cm7 = C3 Eb4 G4 Bb4 D5', () => {
    expect(voicingToMidi(v('rootless-a'), 'm7', C3)).toEqual([48, 63, 67, 70, 74])
  })

  it('Kenny Barron on Cm7 = C3 G3 D4 / Eb4 Bb4 F5', () => {
    expect(voicingToMidi(v('kenny-barron'), 'm7', C3)).toEqual([48, 55, 62, 63, 70, 77])
  })

  it('So What on Cm7 starts below the root', () => {
    expect(voicingToMidi(v('so-what'), 'm7', C3)).toEqual([43, 48, 53, 58, 62])
  })

  it('transposing preserves the interval shape in all 12 keys', () => {
    for (const voicing of VOICINGS) {
      for (const quality of voicing.qualities) {
        const shape = voicingShape(voicing, quality)
        for (let pc = 0; pc < 12; pc++) {
          const midi = voicingToMidi(voicing, quality, C3 + pc)
          expect(midi.map((n) => n - midi[0])).toEqual(shape)
        }
      }
    }
  })
})

describe('exact validation', () => {
  const target = voicingToMidi(v('rootless-a'), 'm7', C3)

  it('an identical set passes', () => {
    expect(compareToTarget([...target].reverse(), target).exact).toBe(true)
  })

  it('the same note one octave up fails', () => {
    const wrong = [...target.slice(0, -1), target[target.length - 1] + 12]
    const c = compareToTarget(wrong, target)
    expect(c.exact).toBe(false)
    expect(c.extra).toEqual([target[target.length - 1] + 12])
    expect(c.missing).toEqual([target[target.length - 1]])
  })

  it('a missing note fails', () => {
    const c = compareToTarget(target.slice(1), target)
    expect(c.exact).toBe(false)
    expect(c.missing).toEqual([target[0]])
  })

  it('an extra note fails', () => {
    expect(compareToTarget([...target, 90], target).exact).toBe(false)
  })

  it('sameSet ignores order and length repetition', () => {
    expect(sameSet([1, 2, 3], [3, 2, 1])).toBe(true)
    expect(sameSet([1, 2], [1, 2, 3])).toBe(false)
  })
})

describe('detectVoicing', () => {
  it('recognizes So What on any root', () => {
    for (let pc = 0; pc < 12; pc++) {
      const notes = voicingToMidi(v('so-what'), 'm7', C3 + pc)
      const match = detectVoicing(notes)
      expect(match?.voicing.id).toBe('so-what')
      expect(match?.rootMidi).toBe(C3 + pc)
    }
  })

  it('returns null for a random cluster', () => {
    expect(detectVoicing([60, 61, 62, 63, 64, 65])).toBeNull()
    expect(detectVoicing([60])).toBeNull()
  })

  it('every voicing in the table recognizes itself back', () => {
    for (const voicing of VOICINGS) {
      for (const quality of voicing.qualities) {
        const notes = voicingToMidi(voicing, quality, C3)
        const match = detectVoicing(notes)
        expect(match, `${voicing.id} ${quality}`).not.toBeNull()
        // It may match another voicing with the same set of notes; what matters
        // is that the notes line up exactly.
        expect(voicingToMidi(match!.voicing, match!.quality, match!.rootMidi)).toEqual(notes)
      }
    }
  })
})

describe('MIDI messages', () => {
  const on = (n: number) => [0x90, n, 100]
  const off = (n: number) => [0x80, n, 0]
  const pedal = (v: number) => [0xb0, 64, v]

  it('note on adds, note off removes', () => {
    const keys = newKeys()
    expect(applyMidiMessage(keys, on(60))).toBe(true)
    expect(sounding(keys)).toEqual([60])
    expect(applyMidiMessage(keys, off(60))).toBe(true)
    expect(sounding(keys)).toEqual([])
  })

  it('note on with velocity 0 counts as note off', () => {
    const keys = newKeys()
    applyMidiMessage(keys, on(60))
    expect(applyMidiMessage(keys, [0x90, 60, 0])).toBe(true)
    expect(sounding(keys)).toEqual([])
  })

  it('all notes off clears everything, including what the pedal holds', () => {
    const keys = newKeys()
    for (const n of [60, 64, 67]) applyMidiMessage(keys, on(n))
    applyMidiMessage(keys, pedal(127))
    applyMidiMessage(keys, off(60))
    expect(applyMidiMessage(keys, [0xb0, 123, 0])).toBe(true)
    expect(sounding(keys)).toEqual([])
  })

  it('respects the MIDI channel (status 0x95 is also note on)', () => {
    const keys = newKeys()
    applyMidiMessage(keys, [0x95, 48, 80])
    expect(sounding(keys)).toEqual([48])
  })

  it('signals no change when nothing changes', () => {
    const keys = newKeys()
    applyMidiMessage(keys, on(60))
    expect(applyMidiMessage(keys, on(60))).toBe(false)
    expect(applyMidiMessage(keys, off(99))).toBe(false)
  })
})

describe('sustain pedal', () => {
  const on = (n: number) => [0x90, n, 100]
  const off = (n: number) => [0x80, n, 0]
  const pedal = (v: number) => [0xb0, 64, v]

  it('a note released with the pedal down stays in the chord', () => {
    const keys = newKeys()
    applyMidiMessage(keys, pedal(127))
    applyMidiMessage(keys, on(48)) // root in the left hand
    expect(applyMidiMessage(keys, off(48))).toBe(false) // released, but still sounding
    for (const n of [63, 67, 70, 74]) applyMidiMessage(keys, on(n)) // rootless A in the right hand
    expect(sounding(keys)).toEqual([48, 63, 67, 70, 74])
  })

  it('pressing the pedal after releasing the key does not resurrect the note', () => {
    const keys = newKeys()
    applyMidiMessage(keys, on(48))
    applyMidiMessage(keys, off(48))
    applyMidiMessage(keys, pedal(127))
    expect(sounding(keys)).toEqual([])
  })

  it('releasing the pedal cuts whatever is not under a finger', () => {
    const keys = newKeys()
    applyMidiMessage(keys, pedal(127))
    applyMidiMessage(keys, on(48))
    applyMidiMessage(keys, off(48))
    applyMidiMessage(keys, on(63))
    expect(applyMidiMessage(keys, pedal(0))).toBe(true)
    expect(sounding(keys)).toEqual([63])
  })

  it('half-pedal from 64 up counts as pressed', () => {
    const keys = newKeys()
    applyMidiMessage(keys, pedal(63))
    applyMidiMessage(keys, on(48))
    applyMidiMessage(keys, off(48))
    expect(sounding(keys)).toEqual([])

    applyMidiMessage(keys, pedal(64))
    applyMidiMessage(keys, on(48))
    applyMidiMessage(keys, off(48))
    expect(sounding(keys)).toEqual([48])
  })

  it('re-striking a note held by the pedal does not duplicate it', () => {
    const keys = newKeys()
    applyMidiMessage(keys, pedal(127))
    applyMidiMessage(keys, on(48))
    applyMidiMessage(keys, off(48))
    expect(applyMidiMessage(keys, on(48))).toBe(false) // it was already sounding
    expect(sounding(keys)).toEqual([48])
    applyMidiMessage(keys, pedal(0)) // now it is under a finger, it must not vanish
    expect(sounding(keys)).toEqual([48])
  })

  it('a repeated pedal message signals no change', () => {
    const keys = newKeys()
    expect(applyMidiMessage(keys, pedal(127))).toBe(false)
    expect(applyMidiMessage(keys, pedal(127))).toBe(false)
    expect(applyMidiMessage(keys, pedal(0))).toBe(false) // nothing held, nothing to cut
  })
})

describe('names', () => {
  it('flat spelling by default', () => {
    expect(midiToName(61)).toBe('Db4')
    expect(midiToName(61, 'sharp')).toBe('C#4')
    expect(midiToName(60)).toBe('C4')
  })

  it('VexFlow key', () => {
    expect(midiToVexKey(63)).toBe('eb/4')
    expect(midiToVexKey(60)).toBe('c/4')
    expect(midiToVexKey(61, 'sharp')).toBe('c#/4')
  })
})
