// Ordens de transposicao. Compartilhado entre o Drill e o Shred.

/** Ciclo de quartas, o jeito padrao de transpor exercicio de jazz. */
export const FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]

export const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

/** Terca menor: os quatro tons que cobrem um ciclo simetrico (dim7, tons inteiros). */
export const MINOR_THIRDS = [0, 3, 6, 9]

export type Order = 'fourths' | 'chromatic' | 'random'

export function rootAt(order: Order, i: number): number {
  if (order === 'random') return Math.floor(Math.random() * 12)
  const seq = order === 'chromatic' ? CHROMATIC : FOURTHS
  return seq[i % seq.length]
}
