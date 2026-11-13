/**
 * Terreno de la superficie (lógica PURA, sin Three.js): una función `heightAt(x, z)` determinista a
 * partir de la semilla de la partida, el sector y el nodo. El motor no simula terreno: aquí se decide
 * el relieve, los abismos que separan lo cercano de lo lejano y los hoyos de las zonas que se hunden.
 *
 * Coordenadas: metros relativos a la nave en el plano XZ (las mismas que `set-position`). El origen es
 * el pie de la rampa de la esclusa; la nave queda a +X (ver `SHIP_CENTER` en `surfaceRules.ts`).
 */
import { fbm2, mixSeed, rng } from './noise';

export interface TerrainStyle {
  /** Amplitud (m) y escala (m) del relieve base. */
  amp: number;
  scale: number;
  craters: number;
  /** Abismos en anillo alrededor de la nave: profundidad (m) y anchura (m). */
  chasmDepthM: number;
  chasmWidthM: number;
  /** Anillos de abismo (1 o 2) y grietas radiales (mundo fracturado). */
  rings: number;
  radialCracks: number;
  /** Dunas (mundo de tormentas). */
  dunes: boolean;
}

export const TERRAIN_STYLES: Record<string, TerrainStyle> = {
  'drifting-rock': { amp: 3, scale: 30, craters: 10, chasmDepthM: 10, chasmWidthM: 9, rings: 1, radialCracks: 0, dunes: false },
  'ice-core': { amp: 2.5, scale: 34, craters: 6, chasmDepthM: 12, chasmWidthM: 8, rings: 1, radialCracks: 0, dunes: false },
  'dust-moon': { amp: 2, scale: 40, craters: 14, chasmDepthM: 10, chasmWidthM: 9, rings: 1, radialCracks: 0, dunes: false },
  'volcanic-moon': { amp: 4, scale: 24, craters: 4, chasmDepthM: 12, chasmWidthM: 8, rings: 1, radialCracks: 0, dunes: false },
  'storm-world': { amp: 2.2, scale: 38, craters: 0, chasmDepthM: 9, chasmWidthM: 8, rings: 1, radialCracks: 0, dunes: true },
  'fractured-world': { amp: 3, scale: 28, craters: 3, chasmDepthM: 14, chasmWidthM: 7, rings: 2, radialCracks: 4, dunes: false },
  'heavy-world': { amp: 1.2, scale: 45, craters: 3, chasmDepthM: 6, chasmWidthM: 9, rings: 1, radialCracks: 0, dunes: false },
};
const DEFAULT_STYLE: TerrainStyle = TERRAIN_STYLES['dust-moon']!;

export interface TerrainInput {
  /** Semilla de la partida, índice de sector e id del nodo: el mismo destino da el mismo terreno. */
  seed: number;
  sectorIndex: number;
  nodeId: string;
  worldId: string;
  radiusM: number;
  pitDepthM: number;
  /** Vetas: el abismo no se las traga (quedan en islotes o en la orilla). */
  deposits: readonly { x: number; z: number }[];
  zones: readonly { x: number; z: number; radiusM: number; collapsed: boolean }[];
  /** Centro de la nave (zona plana de aterrizaje) y radio de esa zona. */
  padX: number;
  padZ: number;
  padRadiusM: number;
}

export interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

export interface Ring {
  radiusM: number;
  /** Ángulos (rad) de los pasos naturales: puentes de roca por los que se cruza andando. */
  fords: number[];
  phase: number;
}

export interface Terrain {
  readonly input: TerrainInput;
  readonly style: TerrainStyle;
  readonly rings: readonly Ring[];
  readonly cracks: readonly number[];
  readonly craters: readonly Crater[];
  /** Mitad del lado del área modelada (más allá del radio explorable sube un borde de cráter). */
  readonly halfSizeM: number;
  /** Altura del suelo (m). */
  heightAt(x: number, z: number): number;
  /** 0-1: cuánto abismo hay en (x, z) (1 = fondo). */
  chasmAt(x: number, z: number): number;
}

/** Margen modelado más allá del radio explorable. */
export const TERRAIN_MARGIN_M = 32;
/** Anchura (m) de un paso natural sobre el abismo. */
export const FORD_HALF_M = 3.2;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const angleDiff = (a: number, b: number): number => {
  const d = (((a - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2);
  return d - Math.PI;
};

/**
 * Hoyo de una zona que cedió: metros que baja el suelo a `d` m del centro. Fondo plano hasta media zona y
 * pared en rampa hasta pasado el borde (más ancha cuanto más hondo: ~65° como mucho), para que se salga
 * con el jetpack pegado a la pared. Cuesta oxígeno y combustible, no es una trampa.
 */
export function pitDropM(d: number, radiusM: number, depthM: number): number {
  return depthM * (1 - smoothstep(radiusM * 0.5, pitRimM(radiusM, depthM), d));
}

/** Radio exterior del hoyo (donde vuelve el suelo). */
export function pitRimM(radiusM: number, depthM: number): number {
  return radiusM + 0.6 + depthM * 0.4;
}

/**
 * Lo más hondo que puede haber bajo los pies en un mundo (fondo del abismo o de un hoyo), para el techo
 * de vuelo del jetpack (`surfaceMotion(g, limits, dropM)`).
 */
export function deepestDropM(worldId: string, pitDepthM: number): number {
  return Math.max((TERRAIN_STYLES[worldId] ?? DEFAULT_STYLE).chasmDepthM, pitDepthM);
}

/** Semilla del terreno de un nodo. */
export function terrainSeed(seed: number, sectorIndex: number, nodeId: string): number {
  let h = 0;
  for (let i = 0; i < nodeId.length; i++) h = Math.imul(h ^ nodeId.charCodeAt(i), 16777619);
  return mixSeed(seed >>> 0, sectorIndex, h);
}

export function createTerrain(input: TerrainInput): Terrain {
  const style = TERRAIN_STYLES[input.worldId] ?? DEFAULT_STYLE;
  const seed = terrainSeed(input.seed, input.sectorIndex, input.nodeId);
  const r = rng(seed);
  const R = input.radiusM;

  // Anillos de abismo: el primero separa lo cercano (sin peligro) de lo lejano (lo valioso).
  const rings: Ring[] = [];
  for (let k = 0; k < style.rings; k++) {
    const radiusM = k === 0 ? Math.max(38, R * 0.46) : R * 0.78;
    const fordCount = 2 + Math.floor(r() * 2);
    const base = r() * Math.PI * 2;
    const fords = Array.from({ length: fordCount }, (_, i) => base + (i / fordCount) * Math.PI * 2 + (r() - 0.5) * 0.6);
    rings.push({ radiusM, fords, phase: r() * 100 });
  }
  const cracks = Array.from({ length: style.radialCracks }, (_, i) => (i / Math.max(1, style.radialCracks)) * Math.PI * 2 + r() * 0.8);
  const craters: Crater[] = [];
  for (let i = 0; i < style.craters; i++) {
    const a = r() * Math.PI * 2;
    const d = R * (0.2 + r() * 0.95);
    craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 4 + r() * 9, depth: 1.2 + r() * 2.8 });
  }

  /** Lejos de la nave y de las vetas: ahí sí puede abrirse el suelo. */
  const openMask = (x: number, z: number): number => {
    let m = smoothstep(input.padRadiusM, input.padRadiusM + 8, Math.hypot(x - input.padX, z - input.padZ));
    for (const d of input.deposits) {
      const dist = Math.hypot(x - d.x, z - d.z);
      if (dist < 6) m = Math.min(m, smoothstep(2.6, 6, dist));
    }
    return m;
  };

  const chasmRaw = (x: number, z: number): number => {
    const rad = Math.hypot(x, z);
    const theta = Math.atan2(z, x);
    let c = 0;
    for (const ring of rings) {
      const wob = fbm2(Math.cos(theta) * 2.2 + ring.phase, Math.sin(theta) * 2.2, seed + 7, 3) * 7;
      const half = (style.chasmWidthM / 2) * (0.8 + 0.45 * (fbm2(Math.cos(theta) * 3 + ring.phase, Math.sin(theta) * 3 + 4, seed + 9, 2) * 0.5 + 0.5));
      const d = Math.abs(rad - (ring.radiusM + wob));
      let p = 1 - smoothstep(half * 0.55, half, d);
      if (p <= 0) continue;
      for (const f of ring.fords) {
        const s = Math.abs(angleDiff(theta, f)) * rad;
        p *= smoothstep(FORD_HALF_M, FORD_HALF_M + 3.5, s);
      }
      c = Math.max(c, p);
    }
    for (const a of cracks) {
      const along = rad * Math.cos(theta - a);
      if (along < R * 0.3 || along > R + 4) continue;
      const d = Math.abs(rad * Math.sin(theta - a));
      const half = 2.6 + 0.8 * (fbm2(along * 0.08, a * 10, seed + 13, 2) * 0.5 + 0.5);
      const ends = smoothstep(R * 0.3, R * 0.3 + 6, along);
      c = Math.max(c, (1 - smoothstep(half * 0.5, half, d)) * ends);
    }
    return c;
  };

  const chasmAt = (x: number, z: number): number => chasmRaw(x, z) * openMask(x, z);

  const heightAt = (x: number, z: number): number => {
    const s = style.scale;
    let h = fbm2(x / s, z / s, seed + 1, 4) * style.amp;
    h += fbm2(x / 5, z / 5, seed + 3, 2) * style.amp * 0.12;
    if (style.dunes) {
      const warp = fbm2(x / 30, z / 30, seed + 5, 2) * 6;
      h += Math.sin((x * 0.6 + z * 0.8) / 7 + warp) * 1.1;
    }
    for (const c of style.craters > 0 ? craters : []) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d > 1.6) continue;
      h += d < 1 ? -c.depth * (1 - d * d) + c.depth * 0.35 * d * d * d : c.depth * 0.35 * (1 - smoothstep(1, 1.6, d));
    }
    // Zona de aterrizaje plana alrededor de la nave.
    const pad = 1 - smoothstep(input.padRadiusM, input.padRadiusM + 10, Math.hypot(x - input.padX, z - input.padZ));
    h *= 1 - pad;
    // Abismos.
    h -= chasmAt(x, z) * style.chasmDepthM;
    // Terreno inestable: hundido apenas (se lee) o abierto en hoyo si ya cedió.
    for (const zn of input.zones) {
      const d = Math.hypot(x - zn.x, z - zn.z);
      if (d > (zn.collapsed ? pitRimM(zn.radiusM, input.pitDepthM) : zn.radiusM) + 0.5) continue;
      h -= zn.collapsed ? pitDropM(d, zn.radiusM, input.pitDepthM) : 0.35 * (1 - smoothstep(zn.radiusM * 0.4, zn.radiusM, d));
    }
    // Borde del área explorable: sube una pared de cráter (frontera natural y visible).
    const rad = Math.hypot(x, z);
    if (rad > R - 4) h += smoothstep(R - 4, R + 26, rad) ** 2 * 26;
    return h;
  };

  return { input, style, rings, cracks, craters, halfSizeM: R + TERRAIN_MARGIN_M, heightAt, chasmAt };
}

/** Lado de la rejilla de terreno (vértices por lado) para un mundo: celdas de ~1,6 m, sin pasar de 192. */
export function gridSizeFor(terrain: Terrain): number {
  return Math.min(193, Math.max(97, Math.round((terrain.halfSizeM * 2) / 1.6) + 1));
}

/**
 * Alturas en rejilla (n × n vértices, fila = z, columna = x) que cubren el área modelada. Sirve a la
 * malla visible y al colisionador (las mismas alturas).
 */
export function terrainGrid(terrain: Terrain, n: number, out?: Float32Array): Float32Array {
  const heights = out ?? new Float32Array(n * n);
  const half = terrain.halfSizeM;
  const step = (half * 2) / (n - 1);
  for (let iz = 0; iz < n; iz++) {
    const z = -half + iz * step;
    for (let ix = 0; ix < n; ix++) heights[iz * n + ix] = terrain.heightAt(-half + ix * step, z);
  }
  return heights;
}
