/**
 * Única fuente de aleatoriedad del motor (regla 4 del proyecto: prohibido el azar global de JS).
 * PRNG mulberry32: 32 bits de estado, rápido, suficiente para un juego y reproducible
 * en cualquier motor JS (solo usa operaciones enteras de 32 bits).
 */
export interface Rng {
  /** Número en [0, 1). */
  next(): number;
  /** Entero uniforme en [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number;
  /** true con probabilidad p (p <= 0 nunca, p >= 1 siempre). */
  chance(p: number): boolean;
}

/** PRNG determinista con semilla (mulberry32). La misma semilla da la misma secuencia. */
export function createRng(seed: number): Rng {
  // Normaliza a uint32; semillas no enteras se truncan para que 42 y 42.0 coincidan.
  let state = Math.trunc(seed) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, maxInclusive) {
      const lo = Math.ceil(Math.min(min, maxInclusive));
      const hi = Math.floor(Math.max(min, maxInclusive));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance(p) {
      // Siempre consume un número para que la secuencia no dependa de p.
      const r = next();
      return r < p;
    },
  };
}

/**
 * Deriva una semilla independiente de `seed` para otro flujo de azar (p. ej. eventos de salud o
 * pre-operación), de modo que añadir un flujo nuevo no altere las tiradas de los existentes.
 * Mezcla de 32 bits tipo murmur3 (fmix32) sobre seed XOR salt. Determinista y pura.
 */
export function deriveSeed(seed: number, salt: number): number {
  let h = (Math.trunc(seed) ^ Math.trunc(salt)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
