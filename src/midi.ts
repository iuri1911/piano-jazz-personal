import { useEffect, useRef, useState } from 'react'

// The notes of a chord do NOT arrive together — they land spread over 10-80ms
// depending on the hand. This is the quiet time (no note on/off) after which the
// chord counts as "settled". Real hardware needs tuning: there is a slider in the UI.
export const DEFAULT_SETTLE_MS = 60

/** Keys under a finger + keys released but still held by the pedal. */
export type Keys = {
  down: Set<number>
  sustained: Set<number>
  pedal: boolean
}

export function newKeys(): Keys {
  return { down: new Set(), sustained: new Set(), pedal: false }
}

/** What is sounding: finger + pedal. This is what becomes a chord. */
export function sounding(keys: Keys): number[] {
  return [...new Set([...keys.down, ...keys.sustained])].sort((a, b) => a - b)
}

const SUSTAIN_CC = 64
const PEDAL_THRESHOLD = 64 // half-pedal counts as pressed

/**
 * Applies a MIDI message to the key state.
 * Returns true when what is sounding changed. Pure on purpose — this is the part
 * that fails silently, so it stays testable without a browser.
 */
export function applyMidiMessage(keys: Keys, data: ArrayLike<number>): boolean {
  const [status, data1, data2] = [data[0], data[1], data[2]]
  const command = status & 0xf0

  if (command === 0x90 && data2 > 0) {
    const wasSounding = keys.down.has(data1) || keys.sustained.has(data1)
    keys.down.add(data1)
    keys.sustained.delete(data1) // struck again: back to being a finger note
    return !wasSounding
  }

  if (command === 0x80 || (command === 0x90 && data2 === 0)) {
    // Plenty of keyboards send note-on with velocity 0 instead of note-off.
    if (!keys.down.delete(data1)) return false
    if (keys.pedal) {
      // Pedal down: the note keeps sounding, so it stays in the chord.
      keys.sustained.add(data1)
      return false
    }
    return true
  }

  if (command === 0xb0 && data1 === SUSTAIN_CC) {
    const pedal = data2 >= PEDAL_THRESHOLD
    if (pedal === keys.pedal) return false
    keys.pedal = pedal
    if (pedal) return false // pressing changes nothing sounding, only what will keep sounding
    if (keys.sustained.size === 0) return false
    keys.sustained.clear() // releasing the pedal cuts whatever is not under a finger
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
// Raw event stream
//
// The chord path (useMidi) throws away velocity and timestamp on purpose: a chord
// has no rhythm. Shred needs both. Instead of two hooks opening two MIDIAccess,
// there is a single one here in the module fanning out to N subscribers.
// ---------------------------------------------------------------------------

export type MidiEvent = {
  kind: 'on' | 'off'
  note: number
  velocity: number
  /** performance.now() epoch, to line up with every other measurement. */
  time: number
}

/** Extracts the note from a message. null for CC, clock, aftertouch. Pure. */
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
  // timeStamp comes from the driver and is more accurate than reading the clock
  // in here, which already paid for the event queue. Some environments send 0.
  const time = e.timeStamp || performance.now()
  for (const cb of rawListeners) cb(e.data, time)
}

function bindInputs() {
  if (!access) return
  const names: string[] = []
  access.inputs.forEach((input) => {
    // addEventListener, not onmidimessage: assigning the property would let the
    // second consumer wipe out the first with no error at all.
    if (!boundInputs.has(input)) {
      input.addEventListener('midimessage', onMessage as EventListener)
      boundInputs.add(input)
    }
    names.push(input.name ?? 'unnamed')
  })
  publishStatus({ devices: names, error: null })
}

function start() {
  if (access || starting) return
  if (!navigator.requestMIDIAccess) {
    publishStatus({ devices: [], error: 'This browser has no Web MIDI API. Use Chrome or Edge.' })
    return
  }
  starting = true
  navigator
    .requestMIDIAccess({ sysex: false })
    .then((a) => {
      access = a
      a.onstatechange = bindInputs // keyboard plugged/unplugged mid-session
      bindInputs()
    })
    .catch((e: Error) => publishStatus({ devices: [], error: `MIDI access denied: ${e.message}` }))
    .finally(() => {
      starting = false
    })
}

/** Subscribes to the raw messages. Returns the unsubscribe function. */
export function subscribeRaw(cb: RawListener): () => void {
  rawListeners.add(cb)
  start()
  return () => {
    rawListeners.delete(cb)
  }
}

/** Subscribes to note on/off only, already parsed. */
export function subscribeMidi(cb: (e: MidiEvent) => void): () => void {
  return subscribeRaw((data, time) => {
    const ev = parseNoteEvent(data, time)
    if (ev) cb(ev)
  })
}

/** Subscribes to devices/error. Fires immediately with the current state. */
export function subscribeStatus(cb: (s: MidiStatus) => void): () => void {
  statusListeners.add(cb)
  cb(status)
  start()
  return () => {
    statusListeners.delete(cb)
  }
}

/** Raw notes with velocity and time. The callback may change between renders. */
export function useMidiEvents(cb: (e: MidiEvent) => void): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => subscribeMidi((e) => ref.current(e)), [])
}

export type MidiState = {
  /** Notes sounding right now: finger + pedal. */
  held: number[]
  /** Last settled chord. Does not clear when you let go of the keys. */
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
