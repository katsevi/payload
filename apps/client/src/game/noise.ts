/**
 * Ruido y azar deterministas para el aspecto procedural (lógica pura, sin Three.js). El mismo id o
 * la misma semilla dan siempre el mismo resultado: nada de `Math.random` en lo que se ve del mundo.
 */

/** Hash estable (FNV-1a) de un texto, p. ej. el id de un destino. */
export function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mezcla varios enteros en una semilla de 32 bits. */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= Math.imul((p | 0) ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/** PRNG determinista (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Ruido de valor 3D en [0, 1]. */
export function valueNoise3(x: number, y: number, z: number): number {
  const hash = (ix: number, iy: number, iz: number): number => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const fz = smooth(z - zi);
  const plane = (iz: number): number => lerp(lerp(hash(xi, yi, iz), hash(xi + 1, yi, iz), fx), lerp(hash(xi, yi + 1, iz), hash(xi + 1, yi + 1, iz), fx), fy);
  return lerp(plane(zi), plane(zi + 1), fz);
}

/** Ruido de valor 2D en [0, 1] con semilla. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const hash = (ix: number, iy: number): number => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), fx), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), fx), fy);
}

/** Suma fractal de ruido 2D centrada en 0 (aprox. en [−1, 1]). */
export function fbm2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise2(x * f, y * f, seed + o * 101) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Cresta: 1 en las líneas donde el ruido cruza 0 (para coladas y grietas). */
export function ridge2(x: number, y: number, seed: number): number {
  return 1 - Math.abs(fbm2(x, y, seed, 3));
}
