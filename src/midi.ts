import { useEffect, useRef, useState } from 'react'

// Notas de um acorde NAO chegam juntas — chegam espalhadas em 10-80ms conforme
// a mao. Este e o tempo de silencio (sem note on/off) depois do qual o acorde
// e considerado "fechado". Hardware real, precisa de ajuste: tem slider na UI.
export const DEFAULT_SETTLE_MS = 60

/** Teclas embaixo do dedo + teclas soltas mas ainda seguradas pelo pedal. */
export type Keys = {
  down: Set<number>
  sustained: Set<number>
  pedal: boolean
}

export function newKeys(): Keys {
  return { down: new Set(), sustained: new Set(), pedal: false }
}

/** O que esta soando: dedo + pedal. E isto que vira acorde. */
export function sounding(keys: Keys): number[] {
  return [...new Set([...keys.down, ...keys.sustained])].sort((a, b) => a - b)
}

const SUSTAIN_CC = 64
const PEDAL_THRESHOLD = 64 // half-pedal conta como pisado

/**
 * Aplica uma mensagem MIDI ao estado das teclas.
 * Devolve true se o que esta soando mudou. Puro de proposito — e a parte que da
 * bug silencioso, entao fica testavel sem browser.
 */
export function applyMidiMessage(keys: Keys, data: ArrayLike<number>): boolean {
  const [status, data1, data2] = [data[0], data[1], data[2]]
  const command = status & 0xf0

  if (command === 0x90 && data2 > 0) {
    const wasSounding = keys.down.has(data1) || keys.sustained.has(data1)
    keys.down.add(data1)
    keys.sustained.delete(data1) // retocada: volta a ser nota de dedo
    return !wasSounding
  }

  if (command === 0x80 || (command === 0x90 && data2 === 0)) {
    // Muito teclado manda note-on com velocity 0 no lugar de note-off.
    if (!keys.down.delete(data1)) return false
    if (keys.pedal) {
      // Pedal pisado: a nota continua soando, entao continua no acorde.
      keys.sustained.add(data1)
      return false
    }
    return true
  }

  if (command === 0xb0 && data1 === SUSTAIN_CC) {
    const pedal = data2 >= PEDAL_THRESHOLD
    if (pedal === keys.pedal) return false
    keys.pedal = pedal
    if (pedal) return false // pisar nao muda o que soa, so o que vai continuar soando
    if (keys.sustained.size === 0) return false
    keys.sustained.clear() // soltar o pedal corta o que nao esta embaixo do dedo
    return true
  }

  if (command === 0xb0 && (data1 === 120 || data1 === 123)) {
    if (keys.down.size === 0 && keys.sustained.size === 0) return false
    keys.down.clear()
    keys.sustained.clear() // all sound off / all notes off
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Fluxo de eventos crus
//
// O caminho de acorde (useMidi) joga fora velocity e timestamp de proposito: um
// acorde nao tem ritmo. O shred precisa dos dois. Em vez de dois hooks abrindo
// duas MIDIAccess, tem uma so aqui no modulo distribuindo pra N assinantes.
// ---------------------------------------------------------------------------

export type MidiEvent = {
  kind: 'on' | 'off'
  note: number
  velocity: number
  /** Epoch de performance.now(), pra bater com o resto das medicoes. */
  time: number
}

/** Extrai a nota de uma mensagem. null pra CC, clock, aftertouch. Puro. */
export function parseNoteEvent(data: ArrayLike<number>, time: number): MidiEvent | null {
  const command = data[0] & 0xf0
  if (command === 0x90 && data[2] > 0) {
    return { kind: 'on', note: data[1], velocity: data[2], time }
  }
  if (command === 0x80 || (command === 0x90 && data[2] === 0)) {
    return { kind: 'off', note: data[1], velocity: 0, time }
  }
  return null
}

export type MidiStatus = { devices: string[]; error: string | null }

type RawListener = (data: ArrayLike<number>, time: number) => void

const rawListeners = new Set<RawListener>()
const statusListeners = new Set<(s: MidiStatus) => void>()
const boundInputs = new WeakSet<MIDIInput>()

let status: MidiStatus = { devices: [], error: null }
let access: MIDIAccess | null = null
let starting = false

function publishStatus(next: MidiStatus) {
  status = next
  for (const cb of statusListeners) cb(status)
}

function onMessage(e: MIDIMessageEvent) {
  if (!e.data) return
  // timeStamp vem do driver e e mais preciso que ler o relogio aqui dentro,
  // que ja pagou o custo da fila de eventos. Alguns ambientes mandam 0.
  const time = e.timeStamp || performance.now()
  for (const cb of rawListeners) cb(e.data, time)
}

function bindInputs() {
  if (!access) return
  const names: string[] = []
  access.inputs.forEach((input) => {
    // addEventListener, nao onmidimessage: atribuir a propriedade faria o
    // segundo consumidor apagar o primeiro sem erro nenhum.
    if (!boundInputs.has(input)) {
      input.addEventListener('midimessage', onMessage as EventListener)
      boundInputs.add(input)
    }
    names.push(input.name ?? 'sem nome')
  })
  publishStatus({ devices: names, error: null })
}

function start() {
  if (access || starting) return
  if (!navigator.requestMIDIAccess) {
    publishStatus({ devices: [], error: 'Este navegador nao tem Web MIDI API. Use Chrome ou Edge.' })
    return
  }
  starting = true
  navigator
    .requestMIDIAccess({ sysex: false })
    .then((a) => {
      access = a
      a.onstatechange = bindInputs // teclado plugado/desplugado no meio da sessao
      bindInputs()
    })
    .catch((e: Error) => publishStatus({ devices: [], error: `Acesso MIDI negado: ${e.message}` }))
    .finally(() => {
      starting = false
    })
}

/** Assina as mensagens cruas. Devolve a funcao de cancelar. */
export function subscribeRaw(cb: RawListener): () => void {
  rawListeners.add(cb)
  start()
  return () => {
    rawListeners.delete(cb)
  }
}

/** Assina so os note on/off, ja parseados. */
export function subscribeMidi(cb: (e: MidiEvent) => void): () => void {
  return subscribeRaw((data, time) => {
    const ev = parseNoteEvent(data, time)
    if (ev) cb(ev)
  })
}

/** Assina dispositivos/erro. Dispara na hora com o estado atual. */
export function subscribeStatus(cb: (s: MidiStatus) => void): () => void {
  statusListeners.add(cb)
  cb(status)
  start()
  return () => {
    statusListeners.delete(cb)
  }
}

/** Notas cruas com velocity e tempo. O callback pode trocar entre renders. */
export function useMidiEvents(cb: (e: MidiEvent) => void): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => subscribeMidi((e) => ref.current(e)), [])
}

export type MidiState = {
  /** Notas soando agora: dedo + pedal. */
  held: number[]
  /** Ultimo acorde estavel. Nao limpa quando voce solta as teclas. */
  settled: number[]
  pedal: boolean
  devices: string[]
  error: string | null
}

export function useMidi(settleMs: number = DEFAULT_SETTLE_MS): MidiState {
  const [held, setHeld] = useState<number[]>([])
  const [settled, setSettled] = useState<number[]>([])
  const [pedal, setPedal] = useState(false)
  const [devices, setDevices] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const keysRef = useRef(newKeys())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleMsRef = useRef(settleMs)
  settleMsRef.current = settleMs

  useEffect(() => {
    const flush = () => {
      const snapshot = sounding(keysRef.current)
      setHeld(snapshot)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (snapshot.length > 0) setSettled(snapshot)
      }, settleMsRef.current)
    }

    const unsubStatus = subscribeStatus((s) => {
      setDevices(s.devices)
      setError(s.error)
    })

    const unsubRaw = subscribeRaw((data) => {
      if (applyMidiMessage(keysRef.current, data)) flush()
      setPedal(keysRef.current.pedal)
    })

    return () => {
      unsubStatus()
      unsubRaw()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { held, settled, pedal, devices, error }
}
