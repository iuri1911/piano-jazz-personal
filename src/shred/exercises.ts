import type { PatternSpec } from './pattern'

// A BIBLIOTECA. Fonte unica da verdade dos exercicios — mexer aqui muda o app
// inteiro, igual a tabela de voicings. Cada entrada diz o que treina e POR QUE
// existe: exercicio de velocidade sem proposito vira so barulho rapido.

export type Family = 'tecnica' | 'prog' | 'guitarra' | 'bebop'

export const FAMILY_LABEL: Record<Family, string> = {
  tecnica: 'Tecnica',
  prog: 'Prog / ELP',
  guitarra: 'Guitarra',
  bebop: 'Bebop',
}

export type Level = 1 | 2 | 3 | 4 | 5

export const LEVEL_LABEL: Record<Level, string> = {
  1: '1 · Fundacao',
  2: '2 · Escalas',
  3: '3 · Sequencias',
  4: '4 · Simetria',
  5: '5 · Maos',
}

/**
 * O que conta como limpo em cada nivel. So o CV aperta: errar nota nunca fica
 * mais barato. CV 0.07 num nivel 5 e ~9ms de desvio numa semicolcheia a 160 —
 * duro, e e esse o ponto.
 */
export const LEVEL_TOLERANCE: Record<Level, { maxIoiCv: number; maxErrorRate: number }> = {
  1: { maxIoiCv: 0.14, maxErrorRate: 0.03 },
  2: { maxIoiCv: 0.12, maxErrorRate: 0.03 },
  3: { maxIoiCv: 0.1, maxErrorRate: 0.03 },
  4: { maxIoiCv: 0.08, maxErrorRate: 0.03 },
  5: { maxIoiCv: 0.07, maxErrorRate: 0.03 },
}

/** Quao permissivo o veredito e, por cima do padrao do nivel. */
export type Strictness = 'aprendendo' | 'solto' | 'padrao' | 'exigente'

export const STRICTNESS_LABEL: Record<Strictness, string> = {
  aprendendo: 'aprendendo',
  solto: 'solto',
  padrao: 'padrao do nivel',
  exigente: 'exigente',
}

export const STRICTNESS_HELP: Record<Strictness, string> = {
  aprendendo:
    'So as notas contam. Regularidade e andamento continuam medidos e aparecem na tela, mas nao reprovam — pra quando voce ainda esta decorando o desenho.',
  solto: 'Tolerancia ampla em tudo. Bom pra tempo novo, onde a mao ainda esta se organizando.',
  padrao: 'O limite do nivel do exercicio.',
  exigente: 'Aperta os tres limites. Use quando quiser confirmar que um tempo esta mesmo dominado.',
}

export type Tolerance = {
  maxErrorRate: number
  maxIoiCv: number
  maxBpmDeviation: number
  timingGates: boolean
}

/**
 * O nivel do exercicio da a base; o rigor escolhido escala a partir dela. Assim
 * "solto" continua sendo mais apertado num exercicio de nivel 5 do que num de
 * nivel 1, que e o que faz sentido.
 */
export function toleranceFor(level: Level, strictness: Strictness): Tolerance {
  const base = LEVEL_TOLERANCE[level]
  switch (strictness) {
    case 'aprendendo':
      return { maxErrorRate: base.maxErrorRate * 3, maxIoiCv: 1, maxBpmDeviation: 1, timingGates: false }
    case 'solto':
      return {
        maxErrorRate: base.maxErrorRate * 2,
        maxIoiCv: base.maxIoiCv * 1.6,
        maxBpmDeviation: 0.1,
        timingGates: true,
      }
    case 'padrao':
      return { ...base, maxBpmDeviation: 0.05, timingGates: true }
    case 'exigente':
      return {
        maxErrorRate: base.maxErrorRate * 0.5,
        maxIoiCv: base.maxIoiCv * 0.75,
        maxBpmDeviation: 0.03,
        timingGates: true,
      }
  }
}

export type Exercise = {
  id: string
  label: string
  family: Family
  level: Level
  /** Uma linha: o que a mao aprende aqui. */
  focus: string
  /** Por que o exercicio existe e como praticar. Aparece na tela. */
  note: string
  pattern: PatternSpec
  tempos: { start: number; target: number }
  beatsPerBar: number
}

const C3 = 48
const C4 = 60

export const EXERCISES: Exercise[] = [
  // --- Nivel 1: fundacao ---------------------------------------------------
  {
    id: 'five-finger',
    label: 'Cinco dedos numa posicao',
    family: 'tecnica',
    level: 1,
    focus: 'Independencia dos dedos, ataque uniforme',
    note: 'C D E F G F E D C, as duas maos em oitava. O objetivo nao e velocidade — e o dedo 4 sair com a mesma forca dos outros. Olhe o numero de desigualdade de ataque: se ele nao cai, subir o BPM so vai gravar o defeito mais rapido. Pulso parado, dedo levanta pouco.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'literal', degrees: [0, 1, 2, 3, 4, 3, 2, 1] },
      hands: { kind: 'unison', octaveGap: 1 },
      octaves: 1,
      direction: 'up',
      subdivision: 2,
      anchorC: C4,
      reps: 4,
      // Espelho exato: as maos fazem o mesmo movimento em direcoes opostas.
      fingering: {
        kind: 'bySequence',
        fingers: [1, 2, 3, 4, 5, 4, 3, 2],
        lh: [5, 4, 3, 2, 1, 2, 3, 4],
      },
    },
    tempos: { start: 60, target: 120 },
    beatsPerBar: 4,
  },
  {
    id: 'hanon-1',
    label: 'Hanon nº 1',
    family: 'tecnica',
    level: 1,
    focus: 'Resistencia, a figura de 8 notas subindo',
    note: 'A figura sobe um grau por vez. E chato de proposito: o valor esta em aguentar a repeticao sem a mao endurecer. Se o antebraco cansar, pare — tensao acumulada e o que trava velocidade, nao falta de treino.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'shape', degrees: [0, 2, 3, 4, 5, 4, 3, 2], step: 1 },
      hands: { kind: 'unison', octaveGap: 1 },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C4,
      fingering: {
        kind: 'bySequence',
        fingers: [1, 2, 3, 4, 5, 4, 3, 2],
        lh: [5, 4, 3, 2, 1, 2, 3, 4],
      },
    },
    tempos: { start: 60, target: 132 },
    beatsPerBar: 4,
  },
  {
    id: 'broken-triad',
    label: 'Triade quebrada',
    family: 'tecnica',
    level: 1,
    focus: 'Passagem de polegar sem acento',
    note: 'Dedilhado 1-2-3-5 subindo. O erro classico e o polegar bater mais forte que o resto ao virar a oitava — o app mede isso. Pense em girar o antebraco em vez de esticar o polegar.',
    pattern: {
      source: { kind: 'chord', name: '' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 3,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3], lh: [1, 4, 2] },
    },
    tempos: { start: 66, target: 144 },
    beatsPerBar: 4,
  },

  // --- Nivel 2: escalas e o polegar ---------------------------------------
  {
    id: 'major-scale-2oct',
    label: 'Escala maior, 2 oitavas',
    family: 'tecnica',
    level: 2,
    focus: 'A passagem de polegar em velocidade',
    note: 'O exercicio mais revelador da lista. Quase todo mundo tem um buraco de tempo logo depois do polegar passar, e a leitura por nota mostra exatamente em qual grau. Se o diagnostico apontar sempre a mesma nota, o problema e mecanico: prepare o polegar ANTES, sob a palma, em vez de esticar na hora.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      // Escala maior: a esquerda nao sai da direita por formula nenhuma —
      // sao dois desenhos diferentes que por acaso fecham na mesma oitava.
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3, 4], lh: [1, 4, 3, 2, 1, 3, 2] },
    },
    tempos: { start: 80, target: 152 },
    beatsPerBar: 4,
  },
  {
    id: 'pentatonic-box',
    label: 'Pentatonica menor, caixa',
    family: 'guitarra',
    level: 2,
    focus: 'A caixa de guitarra traduzida pro teclado',
    note: 'A C D E G — a primeira caixa de pentatonica, a que todo guitarrista toca. No teclado ela nao cai na mao do mesmo jeito, e por isso vale isolar: sao saltos de tom e terca alternados, e o dedilhado muda a cada oitava. Decore o desenho antes de acelerar.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2] },
    },
    tempos: { start: 84, target: 168 },
    beatsPerBar: 4,
  },
  {
    id: 'seventh-arpeggio',
    label: 'Arpejo de setima, 2 oitavas',
    family: 'bebop',
    level: 2,
    focus: 'Salto largo com mao relaxada',
    note: 'Arpejo de menor com setima. Diferente da escala, aqui a mao ABRE — e o reflexo errado e apertar. Toque com o braco levando a mao, nao com o dedo esticando. Este e o mesmo acorde que voce treina na aba Drill, agora na horizontal.',
    pattern: {
      source: { kind: 'chord', name: 'm7' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 4] },
    },
    tempos: { start: 80, target: 160 },
    beatsPerBar: 4,
  },

  // --- Nivel 3: sequencias -------------------------------------------------
  {
    id: 'pent-seq4',
    label: 'Sequencia de 4 na pentatonica',
    family: 'guitarra',
    level: 3,
    focus: 'O padrao de shred de guitarra',
    note: '0123 1234 2345... Em semicolcheias isto E o lick de rock generico — Zakk Wylde, Paul Gilbert, qualquer solo rapido de pentatonica. Como o grupo tem 4 notas e o tempo tem 4, o acento cai sempre na mesma posicao: e o mais facil de sentir dos sequenciados. Comece por ele.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'shape', degrees: [0, 1, 2, 3], step: 1 },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2] },
    },
    tempos: { start: 90, target: 176 },
    beatsPerBar: 4,
  },
  {
    id: 'scale-thirds',
    label: 'Escala em tercas',
    family: 'tecnica',
    level: 3,
    focus: 'Quebrar a dependencia de grau conjunto',
    note: '1-3-2-4-3-5. A mao que so anda por graus vizinhos trava aqui, e e exatamente isso que a gente quer descobrir. Terca em velocidade e o que faz uma escala soar como frase e nao como exercicio.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'skip', interval: 2 },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3, 4] },
    },
    tempos: { start: 80, target: 152 },
    beatsPerBar: 4,
  },
  {
    id: 'blues-run',
    label: 'Blues run com a blue note',
    family: 'prog',
    level: 3,
    focus: 'Pentatonica + b5 em velocidade',
    note: 'Pentatonica menor com a quinta diminuta no meio. E a lingua do Keith Emerson nas partes rapidas de Rondo e Tarkus. A b5 e cromatica em relacao as vizinhas, entao o dedilhado aperta ali — e onde o tempo escorrega.',
    pattern: {
      source: { kind: 'scale', name: 'blues' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3] },
    },
    tempos: { start: 88, target: 176 },
    beatsPerBar: 4,
  },

  // --- Nivel 4: simetria e deslocamento -----------------------------------
  {
    id: 'dim7-arpeggio',
    label: 'Arpejo diminuto',
    family: 'prog',
    level: 4,
    focus: 'Forma simetrica: velocidade quase de graca',
    note: 'O dim7 repete a mesma forma de mao a cada 3 semitons — nao existe "posicao dificil". E por isso que Emerson, Rudess e o Bach de onde os dois tiraram usam tanto: rende muita nota por unidade de esforco. Treine em so quatro tons (C, Db, D, Eb): os outros oito sao os mesmos.',
    pattern: {
      source: { kind: 'chord', name: 'dim7' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 3,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 4], lh: [1, 4, 3, 2] },
    },
    tempos: { start: 100, target: 200 },
    beatsPerBar: 4,
  },
  {
    id: 'whole-tone',
    label: 'Escala de tons inteiros',
    family: 'prog',
    level: 4,
    focus: 'Dedilhado constante, sem ponto de referencia',
    note: 'Seis notas iguais, sem semitom nenhum: a mao faz o mesmo movimento em qualquer ponto. Facil de correr, dificil de nao se perder — sem meio-tom voce nao tem onde se ancorar. Boa pra velocidade bruta e pra som de trilha de ficcao cientifica.',
    pattern: {
      source: { kind: 'scale', name: 'whole tone' },
      motion: { kind: 'run' },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2, 3] },
    },
    tempos: { start: 100, target: 184 },
    beatsPerBar: 4,
  },
  {
    id: 'fourths-run',
    label: 'Quartas pela escala',
    family: 'prog',
    level: 4,
    focus: 'Intervalo largo em velocidade',
    note: 'Sobe a escala pulando de quarta em quarta. Som de ELP e de McCoy Tyner. A mao abre e fecha o tempo todo, e o desafio e nao deixar a abertura virar acento. Se a nota de cima sair sempre mais forte, diminua o BPM.',
    pattern: {
      source: { kind: 'scale', name: 'major' },
      motion: { kind: 'skip', interval: 3 },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'bySequence', fingers: [1, 4] },
    },
    tempos: { start: 84, target: 160 },
    beatsPerBar: 4,
  },
  {
    id: 'group5-over-4',
    label: 'Grupo de 5 sobre subdivisao de 4',
    family: 'prog',
    level: 4,
    focus: 'Deslocamento metrico',
    note: 'O desenho tem 5 notas, o clique tem 4 por tempo: o inicio do grupo anda pelo compasso e so volta pro tempo 1 depois de 5 tempos. E o truque metrico do Dream Theater. Olhe o piano-roll enquanto toca — da pra VER o acento andando, e e assim que se aprende a sentir isso.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'shape', degrees: [0, 1, 2, 3, 4], step: 1 },
      hands: { kind: 'rh' },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C3,
      fingering: { kind: 'byDegree', fingers: [1, 2, 3, 1, 2] },
    },
    tempos: { start: 76, target: 152 },
    beatsPerBar: 4,
  },

  // --- Nivel 5: maos e resistencia ----------------------------------------
  {
    id: 'hand-to-hand-octaves',
    label: 'Oitavas mao-a-mao',
    family: 'prog',
    level: 5,
    focus: 'Velocidade maxima com esforco minimo',
    note: 'Cada nota da escala sai duas vezes: direita, depois esquerda uma oitava abaixo. Como cada mao toca metade das notas, da pra ir a tempos que uma mao sozinha nao alcanca — e assim que se toca as passagens rapidas de ELP sem destruir o antebraco. Maos perto uma da outra, movimento pequeno. Sem dedilhado na tela: com as maos alternando nota a nota, o dedo depende de onde a mao esta chegando, nao da nota — use 2 ou 3 e deixe o antebraco girar.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'shape', degrees: [0, 0], step: 1 },
      hands: { kind: 'alternate', unit: 1, lhOctaveShift: -1 },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C4,
    },
    tempos: { start: 100, target: 200 },
    beatsPerBar: 4,
  },
  {
    id: 'toccata',
    label: 'Toccata: alternancia entre as maos',
    family: 'prog',
    level: 5,
    focus: 'Figura bachiana dividida entre as maos',
    note: 'Arpejo menor com as maos alternando nota a nota, a esquerda uma oitava abaixo. E a mecanica da Toccata do ELP e de meia duzia de coisas do Rudess. O risco e uma mao ficar sistematicamente atras da outra: o app mede o intervalo nota a nota, entao um degrau repetido no diagnostico e sinal de mao desigual, nao de falta de velocidade. Sem dedilhado na tela: cada mao pega notas alternadas do arpejo, entao o dedo muda conforme a mao, e numero errado atrapalha mais que numero nenhum.',
    pattern: {
      source: { kind: 'chord', name: 'm' },
      motion: { kind: 'run' },
      hands: { kind: 'alternate', unit: 1, lhOctaveShift: -1 },
      // 2 oitavas, nao 3: com as maos separadas por uma oitava, 3 oitavas pedem
      // 48 semitons e o A-49 tem exatamente 48 — so caberia em C.
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C4,
      reps: 2,
    },
    tempos: { start: 96, target: 184 },
    beatsPerBar: 4,
  },
  {
    id: 'ostinato-lick',
    label: 'Ostinato na esquerda + lick na direita',
    family: 'prog',
    level: 5,
    focus: 'Independencia real entre as maos',
    note: 'A esquerda repete duas notas por compasso enquanto a direita corre em semicolcheias. Independencia de verdade: a esquerda tem que virar automatica a ponto de voce esquecer dela. Se a direita comecar a puxar a esquerda pro mesmo ritmo, volte o BPM. Sem dedilhado na tela: as duas maos fazem coisas diferentes ao mesmo tempo e cada uma pede o seu.',
    pattern: {
      source: { kind: 'scale', name: 'minor pentatonic' },
      motion: { kind: 'shape', degrees: [0, 1, 2, 3], step: 1 },
      // -1 e nao -2: com a direita em C4 e duas oitavas de padrao, descer a
      // esquerda duas oitavas estoura o grave do A-49 fora de C.
      hands: { kind: 'ostinato', degrees: [0, 4], subdivision: 1, octaveShift: -1 },
      octaves: 2,
      direction: 'updown',
      subdivision: 4,
      anchorC: C4,
    },
    tempos: { start: 80, target: 152 },
    beatsPerBar: 4,
  },
  {
    id: 'bebop-enclosure',
    label: 'Aproximacao cromatica sobre arpejo',
    family: 'bebop',
    level: 5,
    focus: 'Vocabulario de linha de jazz em velocidade',
    note: 'Cada nota do arpejo de m7 chega envolvida: a de cima, o semitom de baixo, e so entao o alvo. E o cerne da linha bebop, e em velocidade e o que separa correr escala de tocar frase. Os semitons apertam a mao — o dedilhado muda a cada envolvente, e tudo bem. Sem dedilhado na tela: envolvente cromatica muda de forma a cada tom, entao aqui o dedilhado e seu.',
    pattern: {
      // Envolvente sobre C Eb G Bb: (D B C) (F D Eb) (A F# G) (C A Bb).
      source: { kind: 'semitones', steps: [2, -1, 0, 5, 2, 3, 9, 6, 7, 12, 9, 10] },
      motion: { kind: 'literal', degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      hands: { kind: 'rh' },
      octaves: 1,
      direction: 'up',
      subdivision: 4,
      anchorC: C3,
      reps: 2,
    },
    tempos: { start: 76, target: 152 },
    beatsPerBar: 4,
  },
]

export const EXERCISE_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]))
