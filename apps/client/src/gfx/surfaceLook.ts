/**
 * Aspecto de cada mundo aterrizable: cielo, niebla, luz y colores del suelo. Cada `worldId` tiene su
 * paleta para que la superficie se sienta un sitio distinto (y no «la nave con otro fondo»).
 */
export interface SurfaceLook {
  skyTop: string;
  skyHorizon: string;
  /** Color de la niebla (y del cielo bajo el horizonte). */
  fog: string;
  fogNearM: number;
  fogFarM: number;
  /** Suelo llano, suelo alto/claro y paredes empinadas. */
  ground: [string, string, string];
  rock: string;
  sun: string;
  sunIntensity: number;
  /** Dirección hacia el sol (no hace falta normalizada). */
  sunDir: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /**
   * Luz de relleno direccional opuesta al sol (sin sombras): en los mundos sin aire las laderas de
   * espaldas al sol se quedaban negras y el relieve y los abismos no se leían. 0 = sin relleno.
   */
  fillIntensity?: number;
  /** Cielo sin aire: estrellas visibles de día. */
  stars: boolean;
  /** Brillo de lava en el fondo de los abismos (null = ninguno). */
  lava: string | null;
  dust: string;
  /** Polvo de la tormenta (solo mundos con tormentas). */
  storm: string;
}

export const SURFACE_LOOKS: Record<string, SurfaceLook> = {
  'drifting-rock': {
    skyTop: '#010103', skyHorizon: '#0d0f16', fog: '#07080c', fogNearM: 90, fogFarM: 300,
    ground: ['#6f6257', '#948472', '#3f3732'], rock: '#8a7c6c',
    sun: '#fff4e6', sunIntensity: 2.4, sunDir: [-0.6, 0.35, -0.4],
    hemiSky: '#5a6278', hemiGround: '#3a3028', hemiIntensity: 0.85, fillIntensity: 0.6,
    stars: true, lava: null, dust: '#9a8a78', storm: '#9a8a78',
  },
  'ice-core': {
    skyTop: '#010205', skyHorizon: '#0c1420', fog: '#070b12', fogNearM: 90, fogFarM: 300,
    ground: ['#8fa7ba', '#dce8f2', '#4f6578'], rock: '#9eb4c6',
    sun: '#eef6ff', sunIntensity: 2.2, sunDir: [0.5, 0.3, -0.6],
    hemiSky: '#6a8ab0', hemiGround: '#40546a', hemiIntensity: 0.8, fillIntensity: 0.5,
    stars: true, lava: null, dust: '#d8e6f2', storm: '#d8e6f2',
  },
  'dust-moon': {
    skyTop: '#000000', skyHorizon: '#121318', fog: '#0a0b0e', fogNearM: 100, fogFarM: 340,
    ground: ['#7a7a7d', '#a9a9ac', '#47474b'], rock: '#8e8e92',
    sun: '#ffffff', sunIntensity: 2.6, sunDir: [-0.8, 0.28, 0.3],
    hemiSky: '#8a90a0', hemiGround: '#4a4a50', hemiIntensity: 1.1, fillIntensity: 1.4,
    stars: true, lava: null, dust: '#a8a8ab', storm: '#a8a8ab',
  },
  'volcanic-moon': {
    skyTop: '#140603', skyHorizon: '#5a1f0c', fog: '#3a140a', fogNearM: 40, fogFarM: 220,
    ground: ['#2c2320', '#4a3b33', '#140f0d'], rock: '#3d302a',
    sun: '#ffb27a', sunIntensity: 1.3, sunDir: [0.4, 0.45, -0.5],
    hemiSky: '#a2401a', hemiGround: '#200a05', hemiIntensity: 0.75, fillIntensity: 0.4,
    stars: false, lava: '#ff5a14', dust: '#5a4238', storm: '#3a2018',
  },
  'storm-world': {
    skyTop: '#26323a', skyHorizon: '#71817c', fog: '#5d6b68', fogNearM: 30, fogFarM: 190,
    ground: ['#6d6450', '#958b70', '#463f32'], rock: '#7a705c',
    sun: '#e4ecdc', sunIntensity: 1.1, sunDir: [-0.3, 0.6, 0.4],
    hemiSky: '#9fb2ae', hemiGround: '#3a3528', hemiIntensity: 0.75,
    stars: false, lava: null, dust: '#a49a7e', storm: '#8c8470',
  },
  'fractured-world': {
    skyTop: '#170c2a', skyHorizon: '#6b3f70', fog: '#3b2442', fogNearM: 45, fogFarM: 240,
    ground: ['#4f4b5e', '#757087', '#26232f'], rock: '#5c5870',
    sun: '#ffd8f0', sunIntensity: 1.5, sunDir: [0.7, 0.25, 0.2],
    hemiSky: '#8a5aa0', hemiGround: '#1e1428', hemiIntensity: 0.75, fillIntensity: 0.5,
    stars: true, lava: null, dust: '#7d7690', storm: '#7d7690',
  },
  'heavy-world': {
    skyTop: '#3a2a12', skyHorizon: '#a8823e', fog: '#8a6a38', fogNearM: 25, fogFarM: 170,
    ground: ['#5e4b33', '#7f6847', '#3a2e1f'], rock: '#6a5538',
    sun: '#ffd890', sunIntensity: 1.2, sunDir: [0.2, 0.7, 0.3],
    hemiSky: '#d0a050', hemiGround: '#3a2a18', hemiIntensity: 0.7,
    stars: false, lava: null, dust: '#8a7250', storm: '#8a7250',
  },
  // Fase 4: mundos de los cuerpos reales del sistema solar.
  'mars-surface': {
    skyTop: '#3a2418', skyHorizon: '#c08a62', fog: '#8a5a3c', fogNearM: 40, fogFarM: 230,
    ground: ['#8a4a2a', '#b06a40', '#4a2616'], rock: '#7a4430',
    sun: '#fff0dc', sunIntensity: 1.6, sunDir: [-0.5, 0.45, 0.35],
    hemiSky: '#d09a70', hemiGround: '#3a1e12', hemiIntensity: 0.8, fillIntensity: 0.35,
    stars: false, lava: null, dust: '#c08060', storm: '#a8683e',
  },
  'ice-moon': {
    skyTop: '#000003', skyHorizon: '#0e1624', fog: '#080d16', fogNearM: 100, fogFarM: 340,
    ground: ['#b8c8d4', '#e8f0f6', '#7a6050'], rock: '#a8b8c6',
    sun: '#eef4ff', sunIntensity: 1.9, sunDir: [0.6, 0.3, -0.4],
    hemiSky: '#7a90b0', hemiGround: '#40505e', hemiIntensity: 0.9, fillIntensity: 0.9,
    stars: true, lava: null, dust: '#dfe8f0', storm: '#dfe8f0',
  },
  'titan-surface': {
    skyTop: '#5a3a12', skyHorizon: '#c89040', fog: '#a87830', fogNearM: 20, fogFarM: 150,
    ground: ['#5a4428', '#7a5e38', '#33261a'], rock: '#4a3a26',
    sun: '#ffd89a', sunIntensity: 0.9, sunDir: [0.3, 0.7, 0.2],
    hemiSky: '#d8a050', hemiGround: '#3a2a14', hemiIntensity: 0.9,
    stars: false, lava: null, dust: '#9a7a48', storm: '#9a7a48',
  },
  'enceladus-surface': {
    skyTop: '#000002', skyHorizon: '#101826', fog: '#090e18', fogNearM: 100, fogFarM: 340,
    ground: ['#d8e4ee', '#ffffff', '#8aa6bc'], rock: '#c6d6e4',
    sun: '#f4f8ff', sunIntensity: 1.6, sunDir: [-0.4, 0.3, 0.6],
    hemiSky: '#8aa6c8', hemiGround: '#4a5a6a', hemiIntensity: 1, fillIntensity: 1,
    stars: true, lava: null, dust: '#eef4fa', storm: '#eef4fa',
  },
};

export function surfaceLook(worldId: string): SurfaceLook {
  return SURFACE_LOOKS[worldId] ?? SURFACE_LOOKS['dust-moon']!;
}

/** Aspecto de cada material de veta: forma y color distintos (no solo color) y si brilla desde lejos. */
export const DEPOSIT_LOOKS: Record<string, { color: string; emissive: string; glow: string | null; beam: boolean }> = {
  ice: { color: '#bfe6ff', emissive: '#1d4a66', glow: null, beam: false },
  ore: { color: '#7a4a2c', emissive: '#3a1404', glow: null, beam: false },
  crystal: { color: '#e08cff', emissive: '#b03cff', glow: '#d070ff', beam: false },
  sample: { color: '#b8ffd0', emissive: '#2dff8a', glow: '#5dffa0', beam: true },
};
