import { describe, expect, it } from 'vitest'
import { VOICING_BY_ID, VOICINGS, degreeToSemitones, voicingToMidi, voicingShape } from './voicings'
import { compareToTarget, detectVoicing, midiToName, midiToVexKey, sameSet } from './theory'
import { applyMidiMessage, newKeys, sounding } from './midi'

const C3 = 48

const v = (id: string) => VOICING_BY_ID.get(id)!

describe('graus', () => {
  it('resolve alteracao pela qualidade do acorde', () => {
    expect(degreeToSemitones('3', 'm7')).toBe(3)
    expect(degreeToSemitones('3', 'maj7')).toBe(4)
    expect(degreeToSemitones('7', '7')).toBe(10)
    expect(degreeToSemitones('7', 'maj7')).toBe(11)
  })

  it('desloca oitava com aspas e virgula', () => {
    expect(degreeToSemitones("3'", 'm7')).toBe(15)
    expect(degreeToSemitones('5,', 'm7')).toBe(-5)
    expect(degreeToSemitones("1''", 'm7')).toBe(24)
  })

  it('rejeita token invalido', () => {
    expect(() => degreeToSemitones('b3', 'm7')).toThrow()
    expect(() => degreeToSemitones('4', 'm7')).toThrow()
  })
})

describe('voicingToMidi', () => {
  it('Rootless A em Cm7 = C3 Eb4 G4 Bb4 D5', () => {
    expect(voicingToMidi(v('rootless-a'), 'm7', C3)).toEqual([48, 63, 67, 70, 74])
  })

  it('Kenny Barron em Cm7 = C3 G3 D4 / Eb4 Bb4 F5', () => {
    expect(voicingToMidi(v('kenny-barron'), 'm7', C3)).toEqual([48, 55, 62, 63, 70, 77])
  })

  it('So What em Cm7 comeca abaixo da fundamental', () => {
    expect(voicingToMidi(v('so-what'), 'm7', C3)).toEqual([43, 48, 53, 58, 62])
  })

  it('transpor preserva o desenho de intervalos nos 12 tons', () => {
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

describe('validacao exata', () => {
  const target = voicingToMidi(v('rootless-a'), 'm7', C3)

  it('conjunto igual passa', () => {
    expect(compareToTarget([...target].reverse(), target).exact).toBe(true)
  })

  it('mesma nota uma oitava acima falha', () => {
    const wrong = [...target.slice(0, -1), target[target.length - 1] + 12]
    const c = compareToTarget(wrong, target)
    expect(c.exact).toBe(false)
    expect(c.extra).toEqual([target[target.length - 1] + 12])
    expect(c.missing).toEqual([target[target.length - 1]])
  })

  it('nota faltando falha', () => {
    const c = compareToTarget(target.slice(1), target)
    expect(c.exact).toBe(false)
    expect(c.missing).toEqual([target[0]])
  })

  it('nota sobrando falha', () => {
    expect(compareToTarget([...target, 90], target).exact).toBe(false)
  })

  it('sameSet ignora ordem e repeticao de tamanho', () => {
    expect(sameSet([1, 2, 3], [3, 2, 1])).toBe(true)
    expect(sameSet([1, 2], [1, 2, 3])).toBe(false)
  })
})

describe('detectVoicing', () => {
  it('reconhece So What em qualquer fundamental', () => {
    for (let pc = 0; pc < 12; pc++) {
      const notes = voicingToMidi(v('so-what'), 'm7', C3 + pc)
      const match = detectVoicing(notes)
      expect(match?.voicing.id).toBe('so-what')
      expect(match?.rootMidi).toBe(C3 + pc)
    }
  })

  it('devolve null pra cluster aleatorio', () => {
    expect(detectVoicing([60, 61, 62, 63, 64, 65])).toBeNull()
    expect(detectVoicing([60])).toBeNull()
  })

  it('todo voicing da tabela se reconhece de volta', () => {
    for (const voicing of VOICINGS) {
      for (const quality of voicing.qualities) {
        const notes = voicingToMidi(voicing, quality, C3)
        const match = detectVoicing(notes)
        expect(match, `${voicing.id} ${quality}`).not.toBeNull()
        // Pode casar com outro voicing que tenha o mesmo conjunto de notas;
        // o que importa e que as notas batem exatamente.
        expect(voicingToMidi(match!.voicing, match!.quality, match!.rootMidi)).toEqual(notes)
      }
    }
  })
})

describe('mensagens MIDI', () => {
  const on = (n: number) => [0x90, n, 100]
  const off = (n: number) => [0x80, n, 0]
  const pedal = (v: number) => [0xb0, 64, v]

  it('note on adiciona, note off remove', () => {
    const keys = newKeys()
    expect(applyMidiMessage(keys, on(60))).toBe(true)
    expect(sounding(keys)).toEqual([60])
    expect(applyMidiMessage(keys, off(60))).toBe(true)
    expect(sounding(keys)).toEqual([])
  })

  it('note on com velocity 0 conta como note off', () => {
    const keys = newKeys()
    applyMidiMessage(keys, on(60))
    expect(applyMidiMessage(keys, [0x90, 60, 0])).toBe(true)
    expect(sounding(keys)).toEqual([])
  })

  it('all notes off limpa tudo, inclusive o que o pedal segura', () => {
    const keys = newKeys()
    for (const n of [60, 64, 67]) applyMidiMessage(keys, on(n))
    applyMidiMessage(keys, pedal(127))
    applyMidiMessage(keys, off(60))
    expect(applyMidiMessage(keys, [0xb0, 123, 0])).toBe(true)
    expect(sounding(keys)).toEqual([])
  })

  it('respeita o canal MIDI (status 0x95 tambem e note on)', () => {
    const keys = newKeys()
    applyMidiMessage(keys, [0x95, 48, 80])
    expect(sounding(keys)).toEqual([48])
  })

  it('nao sinaliza mudanca quando nada muda', () => {
    const keys = newKeys()
    applyMidiMessage(keys, on(60))
    expect(applyMidiMessage(keys, on(60))).toBe(false)
    expect(applyMidiMessage(keys, off(99))).toBe(false)
  })
})

describe('pedal de sustain', () => {
  const on = (n: number) => [0x90, n, 100]
  const off = (n: number) => [0x80, n, 0]
  const pedal = (v: number) => [0xb0, 64, v]

  it('nota solta com o pedal pisado continua no acorde', () => {
    const keys = newKeys()
    applyMidiMessage(keys, pedal(127))
    applyMidiMessage(keys, on(48)) // fundamental na mao esquerda
    expect(applyMidiMessage(keys, off(48))).toBe(false) // solta, mas continua soando
    for (const n of [63, 67, 70, 74]) applyMidiMessage(keys, on(n)) // rootless A na direita
    expect(sounding(keys)).toEqual([48, 63, 67, 70, 74])
  })

  it('pisar o pedal depois de soltar a tecla nao ressuscita a nota', () => {
    const keys = newKeys()
    applyMidiMessage(keys, on(48))
    applyMidiMessage(keys, off(48))
    applyMidiMessage(keys, pedal(127))
    expect(sounding(keys)).toEqual([])
  })

  it('soltar o pedal corta o que nao esta embaixo do dedo', () => {
    const keys = newKeys()
    applyMidiMessage(keys, pedal(127))
    applyMidiMessage(keys, on(48))
    applyMidiMessage(keys, off(48))
    applyMidiMessage(keys, on(63))
    expect(applyMidiMessage(keys, pedal(0))).toBe(true)
    expect(sounding(keys)).toEqual([63])
  })

  it('half-pedal a partir de 64 conta como pisado', () => {
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

  it('retocar uma nota segurada pelo pedal nao duplica', () => {
    const keys = newKeys()
    applyMidiMessage(keys, pedal(127))
    applyMidiMessage(keys, on(48))
    applyMidiMessage(keys, off(48))
    expect(applyMidiMessage(keys, on(48))).toBe(false) // ja estava soando
    expect(sounding(keys)).toEqual([48])
    applyMidiMessage(keys, pedal(0)) // agora esta embaixo do dedo, nao pode sumir
    expect(sounding(keys)).toEqual([48])
  })

  it('mensagem repetida de pedal nao sinaliza mudanca', () => {
    const keys = newKeys()
    expect(applyMidiMessage(keys, pedal(127))).toBe(false)
    expect(applyMidiMessage(keys, pedal(127))).toBe(false)
    expect(applyMidiMessage(keys, pedal(0))).toBe(false) // nada preso, nada a cortar
  })
})

describe('nomes', () => {
  it('grafia bemol por padrao', () => {
    expect(midiToName(61)).toBe('Db4')
    expect(midiToName(61, 'sharp')).toBe('C#4')
    expect(midiToName(60)).toBe('C4')
  })

  it('chave do VexFlow', () => {
    expect(midiToVexKey(63)).toBe('eb/4')
    expect(midiToVexKey(60)).toBe('c/4')
    expect(midiToVexKey(61, 'sharp')).toBe('c#/4')
  })
})
