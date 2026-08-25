import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './shredStats'

// jsdom nao esta ligado; um localStorage de mentira basta pra testar a
// normalizacao, que e onde o bug de campo faltando aparece.
const store = new Map<string, string>()
beforeEach(() => store.clear())
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

describe('normalizacao das preferencias', () => {
  it('preenche campo que uma versao antiga nao salvava', () => {
    // Exatamente o formato gravado antes de existir clickVolume.
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84, latencyMs: 0, strictness: 'padrao' }))
    const s = loadSettings()
    expect(Number.isFinite(s.clickVolume)).toBe(true)
    expect(s.clickVolume).toBe(DEFAULT_SETTINGS.clickVolume)
  })

  it('gravar tambem completa, entao o que volta nunca tem buraco', () => {
    const s = saveSettings({ low: 36, high: 84 })
    expect(Number.isFinite(s.clickVolume)).toBe(true)
    expect(Number.isFinite(s.latencyMs)).toBe(true)
    expect(typeof s.strictness).toBe('string')
    expect(JSON.parse(store.get('pjt:shred:settings') as string)).toEqual(s)
  })

  it('volume fora de 0..1 e cortado', () => {
    expect(saveSettings({ ...DEFAULT_SETTINGS, clickVolume: 5 }).clickVolume).toBe(1)
    expect(saveSettings({ ...DEFAULT_SETTINGS, clickVolume: -2 }).clickVolume).toBe(0)
  })

  it('faixa de teclado pequena demais cai no padrao', () => {
    expect(saveSettings({ low: 60, high: 62 })).toEqual(DEFAULT_SETTINGS)
  })

  it('storage corrompido nao derruba', () => {
    store.set('pjt:shred:settings', '{isso nao e json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe('o que estava selecionado sobrevive ao reload', () => {
  it('guarda e devolve os selects', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      exerciseId: 'dim7-arpeggio',
      rootPc: 7,
      handMode: 'both',
      order: 'chromatic',
      mode: 'burst',
      qwerty: true,
    })
    const s = loadSettings()
    expect(s.exerciseId).toBe('dim7-arpeggio')
    expect(s.rootPc).toBe(7)
    expect(s.handMode).toBe('both')
    expect(s.order).toBe('chromatic')
    expect(s.mode).toBe('burst')
    expect(s.qwerty).toBe(true)
  })

  it('tom fora de 0..11 e cortado', () => {
    expect(saveSettings({ ...DEFAULT_SETTINGS, rootPc: 40 }).rootPc).toBe(11)
    expect(saveSettings({ ...DEFAULT_SETTINGS, rootPc: -3 }).rootPc).toBe(0)
  })

  it('qwerty so liga com true explicito', () => {
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84, qwerty: 'sim' }))
    expect(loadSettings().qwerty).toBe(false)
  })

  it('storage sem os campos novos nao quebra', () => {
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84 }))
    const s = loadSettings()
    expect(s.exerciseId).toBe('')
    expect(s.mode).toBe('ladder')
    expect(s.rootPc).toBe(0)
  })
})

describe('referencia continua', () => {
  it('desligada por padrao: piano tocando junto e escolha, nao surpresa', () => {
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84 }))
    expect(loadSettings().guide).toBe(false)
    expect(loadSettings().guideVolume).toBe(DEFAULT_SETTINGS.guideVolume)
  })

  it('guarda o par ligado/volume', () => {
    const s = saveSettings({ ...DEFAULT_SETTINGS, guide: true, guideVolume: 0.35 })
    expect(s.guide).toBe(true)
    expect(s.guideVolume).toBe(0.35)
    expect(loadSettings().guide).toBe(true)
  })

  it('volume da referencia e do clique sao independentes', () => {
    const s = saveSettings({ ...DEFAULT_SETTINGS, clickVolume: 0, guideVolume: 1 })
    expect(s.clickVolume).toBe(0)
    expect(s.guideVolume).toBe(1)
  })

  it('volume fora de 0..1 e cortado', () => {
    expect(saveSettings({ ...DEFAULT_SETTINGS, guideVolume: 9 }).guideVolume).toBe(1)
    expect(saveSettings({ ...DEFAULT_SETTINGS, guideVolume: -1 }).guideVolume).toBe(0)
  })
})
