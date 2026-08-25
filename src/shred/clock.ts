// Metronomo e transporte.
//
// setTimeout/setInterval tem jitter de dezenas de ms — inaceitavel pra um clique
// que a pessoa vai usar como referencia de tempo. O padrao aqui e o classico "A
// Tale of Two Clocks": um timer grosso (25ms) so olha pra frente e AGENDA os
// cliques no relogio de audio, que e preciso. Nada toca no momento em que o
// timer dispara.

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.1

export type StartOpts = {
  bpm: number
  beatsPerBar: number
  /** Compassos de contagem antes do tempo 0. */
  countInBars: number
  /** Cliques por tempo alem da cabeca (1 = so o tempo). */
  clicksPerBeat?: number
}

export type Beat = {
  /** 0 = primeiro tempo do exercicio. Negativo = contagem. */
  index: number
  audioTime: number
  /** O mesmo instante no epoch de performance.now(). E o que a avaliacao usa. */
  perfTime: number
  bar: number
  beatInBar: number
}

type Mark = { index: number; audio: number }

export class Transport {
  private ctx: AudioContext | null = null
  /** Ganho so do clique: da pra abaixar o metronomo sem mexer no piano. */
  private clickGain: GainNode | null = null
  private volume = 0.8
  private timer: ReturnType<typeof setInterval> | null = null
  private nextAudio = 0
  private nextIndex = 0
  private bpm = 120
  private beatsPerBar = 4
  private clicksPerBeat = 1
  /** Ponte entre o relogio de audio e o de performance, em ms. */
  private offsetMs = 0
  /** Ultimos tempos agendados, pra interpolar a posicao atual. */
  private marks: Mark[] = []

  /** Dispara quando um tempo e AGENDADO — ou seja, com perfTime no futuro. */
  onBeat: ((b: Beat) => void) | null = null

  get running(): boolean {
    return this.timer !== null
  }

  get currentBpm(): number {
    return this.bpm
  }

  /** Precisa ser chamado dentro de um gesto do usuario: o browser exige. */
  async start(opts: StartOpts): Promise<void> {
    this.stop()
    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    this.bpm = opts.bpm
    this.beatsPerBar = opts.beatsPerBar
    this.clicksPerBeat = opts.clicksPerBeat ?? 1
    this.syncOffset()

    this.nextIndex = -opts.countInBars * opts.beatsPerBar
    this.nextAudio = ctx.currentTime + 0.15 // folga pro primeiro agendamento
    this.marks = []

    this.tick()
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.marks = []
  }

  /** Troca de tempo vale do proximo tempo em diante — o modo accel usa isso. */
  setBpm(bpm: number): void {
    this.bpm = bpm
  }

  /**
   * Posicao atual em tempos (float). Negativo durante a contagem.
   * Interpola entre os tempos agendados, entao continua correto com bpm variavel.
   */
  position(): number {
    const ctx = this.ctx
    if (!ctx || this.marks.length === 0) return Number.NaN
    const now = ctx.currentTime
    const m = this.marks
    for (let i = m.length - 1; i >= 0; i--) {
      if (m[i].audio <= now) {
        const next = m[i + 1]
        if (!next) return m[i].index + ((now - m[i].audio) * this.bpm) / 60
        const frac = (now - m[i].audio) / (next.audio - m[i].audio)
        return m[i].index + frac * (next.index - m[i].index)
      }
    }
    // Ainda antes do primeiro tempo agendado.
    return m[0].index - ((m[0].audio - now) * this.bpm) / 60
  }

  /** Converte instante do relogio de audio pro epoch de performance.now(). */
  audioToPerf(audioTime: number): number {
    return audioTime * 1000 + this.offsetMs
  }

  /** Duracao de um tempo em ms, no bpm atual. */
  beatMs(): number {
    return 60000 / this.bpm
  }

  /** 0 a 1. Vale na hora, mesmo com o transporte rodando. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.clickGain) this.clickGain.gain.value = this.volume
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.clickGain = this.ctx.createGain()
      this.clickGain.gain.value = this.volume
      this.clickGain.connect(this.ctx.destination)
    }
    return this.ctx
  }

  private syncOffset(): void {
    const ctx = this.ctx
    if (!ctx) return
    // getOutputTimestamp da os dois relogios no mesmo instante, que e exatamente
    // a ponte que precisamos. Nem todo browser tem — ai amostra na mao.
    const ts = ctx.getOutputTimestamp?.()
    const next =
      ts && ts.contextTime !== undefined && ts.performanceTime !== undefined
        ? ts.performanceTime - ts.contextTime * 1000
        : performance.now() - ctx.currentTime * 1000
    // Primeira medida entra inteira; depois suaviza, senao a grade treme.
    this.offsetMs = this.offsetMs === 0 ? next : this.offsetMs * 0.9 + next * 0.1
  }

  private tick(): void {
    const ctx = this.ctx
    if (!ctx) return
    this.syncOffset()

    while (this.nextAudio < ctx.currentTime + SCHEDULE_AHEAD_S) {
      this.scheduleBeat(this.nextIndex, this.nextAudio)
      this.nextAudio += 60 / this.bpm
      this.nextIndex += 1
    }
  }

  private scheduleBeat(index: number, audio: number): void {
    const beatInBar = ((index % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar
    const isDownbeat = beatInBar === 0
    const isCountIn = index < 0

    // Contagem soa diferente do exercicio, pra nao confundir a entrada.
    this.click(audio, isDownbeat ? 1200 : 800, isCountIn ? 0.5 : isDownbeat ? 0.6 : 0.35)

    for (let s = 1; s < this.clicksPerBeat; s++) {
      this.click(audio + (s * 60) / this.bpm / this.clicksPerBeat, 1600, 0.12)
    }

    this.marks.push({ index, audio })
    if (this.marks.length > 64) this.marks.shift()

    this.onBeat?.({
      index,
      audioTime: audio,
      perfTime: this.audioToPerf(audio),
      bar: Math.floor(index / this.beatsPerBar),
      beatInBar,
    })
  }

  /**
   * Nota sintetizada, pra demonstrar o exercicio antes de voce tocar.
   *
   * Nao e piano amostrado — sao dois osciladores com queda exponencial. O que
   * importa aqui e altura e ritmo audiveis pra decorar o desenho; carregar
   * megabytes de sample pra isso nao se paga.
   */
  note(midi: number, atAudio: number, durS: number, gain = 0.16): void {
    const ctx = this.ctx
    if (!ctx) return
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const env = ctx.createGain()
    env.connect(ctx.destination)

    // Fundamental com corpo + oitava fraca por cima: da o brilho do ataque sem
    // virar onda quadrada.
    const corpo = ctx.createOscillator()
    corpo.type = 'triangle'
    corpo.frequency.value = freq
    const brilho = ctx.createOscillator()
    brilho.type = 'sine'
    brilho.frequency.value = freq * 2

    const brilhoGain = ctx.createGain()
    brilhoGain.gain.value = 0.3
    brilho.connect(brilhoGain)
    brilhoGain.connect(env)
    corpo.connect(env)

    const fim = atAudio + durS
    env.gain.setValueAtTime(0.0001, atAudio)
    env.gain.exponentialRampToValueAtTime(gain, atAudio + 0.004)
    env.gain.exponentialRampToValueAtTime(0.0001, fim)

    for (const osc of [corpo, brilho]) {
      osc.start(atAudio)
      osc.stop(fim + 0.02)
    }
  }

  private click(time: number, freq: number, gain: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.frequency.value = freq
    // Ataque instantaneo e queda rapida: e um clique, nao uma nota. Rampa
    // exponencial porque linear ate zero estala.
    env.gain.setValueAtTime(0.0001, time)
    env.gain.exponentialRampToValueAtTime(gain, time + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
    osc.connect(env)
    env.connect(this.clickGain ?? ctx.destination)
    osc.start(time)
    osc.stop(time + 0.06)
  }
}
