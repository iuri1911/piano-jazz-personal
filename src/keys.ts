// Transposition orders. Shared between Drill and Shred.

/** Cycle of fourths, the standard way to transpose a jazz exercise. */
export const FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]

export const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

/** Minor thirds: the four keys that cover a symmetric cycle (dim7, whole tone). */
export const MINOR_THIRDS = [0, 3, 6, 9]

export type Order = 'fourths' | 'chromatic' | 'random'

export function rootAt(order: Order, i: number): number {
  if (order === 'random') return Math.floor(Math.random() * 12)
  const seq = order === 'chromatic' ? CHROMATIC : FOURTHS
  return seq[i % seq.length]
}
