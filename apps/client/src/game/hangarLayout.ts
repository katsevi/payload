/**
 * Nave montada en el hangar (pantalla de diseño, fase 4). PURO: de un diseño a una lista de bloques con forma,
 * variante, posición, tamaño, giro y punto de anclaje; la escena (`scenes/HangarScene.tsx`) los modela y anima.
 * Ninguna cifra de juego: tamaños y variantes salen de los datos de cada pieza del catálogo (masa, potencia solar,
 * ranuras, calor, tasa de datos, efectos) con escalas de dibujo; el id solo sirve de semilla de aspecto.
 *
 * Ejes: proa +X, arriba +Y, Z a los costados. La estructura es un bus octogonal con el eje en X (caras a 0°, 45°…;
 * el ángulo `roll` se mide alrededor de X desde +Y hacia +Z). Cada familia tiene su sitio, como en una sonda real:
 * - popa: adaptador de lanzamiento, cercha con los tanques y el motor al final;
 * - costados (±Z): alas solares con su yugo, por parejas simétricas;
 * - caras diagonales: radiadores (popa) y cajas de aviónica (resto);
 * - arriba: antenas (proa) y módulos presurizados (popa); RTG en brazos diagonales tras la popa;
 * - abajo: mástil del reactor (popa) y banco de instrumentos colgado bajo la proa;
 * - proa: capas del escudo Whipple; anillos del generador de escudos alrededor del bus.
 */
import { catalog as defaultCatalog, getInstruments, getModules, type Catalog, type InstrumentDef, type MissionDesign, type ModuleDef, type ModuleKind, type ScienceKind } from '@payload/shared';
import { hashOf } from './noise';

export type V3 = [number, number, number];

export type BlockShape =
  | 'bus' | 'engine' | 'ion' | 'wing' | 'rtg' | 'reactor' | 'avionics' | 'dish' | 'whip' | 'radiator' | 'whipple' | 'emitter' | 'tank' | 'pod' | 'instrument';

export type InstrumentLook = 'camera' | 'spectrometer' | 'radar' | 'boom' | 'arm' | 'analyzer' | 'detector' | 'cup';

export interface HangarBlock {
  /** Único en el diseño (familia + índice en el orden del diseño), estable al añadir piezas detrás. */
  key: string;
  partId: string;
  family: ModuleKind | 'instrument';
  science?: ScienceKind;
  shape: BlockShape;
  /** Variante dentro de la forma (familia de la caja de aviónica, tipo de instrumento, tanque/cápsula…). */
  look: string;
  /** Centro de la caja del bloque. */
  position: V3;
  /** Tamaño de la caja en su marco girado (+Y local = hacia fuera de la cara en la que va). */
  size: V3;
  /** Giro alrededor de X (rad): +Y local → (y = cos, z = sin). */
  roll: number;
  /** Punto de la estructura (bus, cercha o banco) donde se sujeta: de ahí salen sus soportes. */
  anchor: V3;
  /** Orden de montaje (estructura primero, instrumentos al final). */
  order: number;
  /** 0-1: posición de la pieza dentro de su familia en el catálogo (más ranuras, más eficiencia…). */
  tier: number;
  /** Semilla de aspecto (hash del id). */
  seed: number;
}

export interface HangarLayout {
  blocks: HangarBlock[];
  /** Largo total de proa a popa (para encuadrar la cámara). */
  lengthM: number;
  /** Bus (con o sin estructura montada: sin ella son las medidas del bastidor vacío). */
  bus: { lengthM: number; radiusM: number; present: boolean; tier: number };
  /** Popa del adaptador de lanzamiento (donde empieza la cercha o va el motor). */
  aftX: number;
  /** Banco de instrumentos bajo la proa (si hay instrumentos). */
  bench: { x0: number; x1: number; y: number; width: number } | null;
  /** Cercha de los tanques tras la popa (si hay tanques): media anchura del cuadrado. */
  truss: { x0: number; x1: number; half: number } | null;
  /** Caja de toda la nave y radio de la esfera que la contiene. */
  bounds: { min: V3; max: V3 };
  radiusM: number;
}

// Escalas de dibujo (metros de escena), no cifras de juego.
const DEFAULT_RADIUS = 0.5;
export const ADAPTER = 0.18;
export const YOKE_M = 0.38;
const YOKE = 0.38;
const WING_KW_AREA = 0.032;
const DIAG = [Math.PI * 0.75, -Math.PI * 0.75, Math.PI * 0.25, -Math.PI * 0.25];
/** Apotema → radio del octógono. */
export const OCTA = 1 / Math.cos(Math.PI / 8);
/** Ancho de una cara del bus octogonal de apotema `r`. */
export const faceWidth = (r: number): number => 2 * r * Math.tan(Math.PI / 8);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const cbrt = (v: number): number => Math.cbrt(Math.max(0, v));

/** 0-1: dónde cae `v` entre los valores distintos de su familia (1 si no hay con quién comparar). */
export function rankIn(v: number, all: number[]): number {
  const u = [...new Set(all)].sort((a, b) => a - b);
  if (u.length <= 1) return 1;
  const i = u.findIndex((x) => x >= v - 1e-9);
  return (i < 0 ? u.length - 1 : i) / (u.length - 1);
}

/** Motor iónico: el que gasta menos combustible por salto (un efecto `fuelPerLy` < 1). */
export const isIonEngine = (m: ModuleDef): boolean => m.effects.some((e) => e.field === 'fuelPerLy' && (e.mult ?? 1) < 1);
/** Blindaje activo: consume potencia (un `systemDrawKw.*` positivo). El pasivo es un escudo Whipple. */
export const isActiveShield = (m: ModuleDef): boolean => m.effects.some((e) => e.field.startsWith('systemDrawKw') && (e.add ?? 0) > 0);

/** Forma del instrumento según su tipo de ciencia y sus datos frente a los de su mismo tipo. */
export function instrumentLook(inst: InstrumentDef, all: InstrumentDef[]): InstrumentLook {
  const peers = all.filter((i) => i.scienceKind === inst.scienceKind);
  const massR = rankIn(inst.massKg, peers.map((p) => p.massKg));
  const rateR = rankIn(inst.dataRateMbps ?? 0, peers.map((p) => p.dataRateMbps ?? 0));
  const many = peers.length > 1;
  switch (inst.scienceKind) {
    case 'geology':
      if (many && massR === 1) return 'arm';
      return rateR === 1 ? 'camera' : 'spectrometer';
    case 'ice':
      return rateR === 1 ? 'radar' : 'detector';
    case 'atmosphere':
      return many && massR === 1 ? 'analyzer' : 'spectrometer';
    case 'fields':
      return many && massR === 1 ? 'cup' : 'boom';
    case 'interior':
      return 'arm';
    case 'life':
      return 'analyzer';
    default:
      return 'detector';
  }
}

const ORDER: Partial<Record<ModuleKind, number>> = {
  structure: 0, propulsion: 1, tank: 2, nuclear: 3, battery: 4, computer: 4, attitude: 4, lifeSupport: 4, workshop: 4, habitat: 4, greenhouse: 4,
  thermal: 5, solar: 6, comms: 7, shielding: 8,
};

/** Rota un vector alrededor de X. */
export function rotX([x, y, z]: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

/** Caja alineada con los ejes del cuerpo del bloque (sin soportes ni extras). */
export function bodyBox(b: HangarBlock): { min: V3; max: V3 } {
  const [hx, hy, hz] = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
  const c = Math.abs(Math.cos(b.roll));
  const s = Math.abs(Math.sin(b.roll));
  const ey = hy * c + hz * s;
  const ez = hy * s + hz * c;
  const [x, y, z] = b.position;
  return { min: [x - hx, y - ey, z - ez], max: [x + hx, y + ey, z + ez] };
}

/** Caja completa del bloque: cuerpo, soportes hasta el anclaje y extras del instrumento (pértiga, dipolos, brazo). */
export function blockBox(b: HangarBlock): { min: V3; max: V3 } {
  const { min, max } = bodyBox(b);
  for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i]!, b.anchor[i]!);
    max[i] = Math.max(max[i]!, b.anchor[i]!);
  }
  if (b.shape === 'instrument') {
    if (b.look === 'boom') max[0] += boomLength(b.size[0]);
    if (b.look === 'radar') {
      min[2] = Math.min(min[2]!, b.position[2] - dipoleLength(b.size[0]));
      max[2] = Math.max(max[2]!, b.position[2] + dipoleLength(b.size[0]));
    }
    if (b.look === 'arm') min[1] -= b.size[1] * 0.6;
  }
  return { min, max };
}

/** Largo de la pértiga del magnetómetro y de los dipolos del radar (escala de dibujo). */
export const boomLength = (s: number): number => 0.9 + s * 1.5;
export const dipoleLength = (s: number): number => 1.1 + s * 1.5;

/** Bloques de la nave de un diseño. Las piezas desconocidas se ignoran. */
export function hangarLayout(design: MissionDesign, cat: Catalog = defaultCatalog): HangarLayout {
  const allMods = getModules(cat);
  const allInst = getInstruments(cat);
  const modules = design.moduleIds.map((id) => allMods.find((m) => m.id === id)).filter((m): m is ModuleDef => !!m);
  const instruments = design.instrumentIds.map((id) => allInst.find((i) => i.id === id)).filter((i): i is InstrumentDef => !!i);
  const peers = (kind: ModuleKind) => allMods.filter((m) => m.kind === kind);

  const structure = modules.find((m) => m.kind === 'structure');
  const slots = structure?.slots ?? Math.max(8, modules.length + instruments.length);
  const R = structure ? clamp(0.3 * cbrt(structure.massKg / 1000) + 0.1, 0.32, 0.9) : DEFAULT_RADIUS;
  const Lb = clamp(0.6 + slots * 0.15, 1.4, 4.5);
  const H = Lb / 2;
  const busTier = structure ? rankIn(structure.slots ?? 0, peers('structure').map((m) => m.slots ?? 0)) : 0;
  const aftX = -H - ADAPTER;

  // Clave por familia en el orden del diseño (estable al añadir piezas detrás).
  const counts: Partial<Record<ModuleKind, number>> = {};
  const entries = modules.map((m) => {
    const n = counts[m.kind] ?? 0;
    counts[m.kind] = n + 1;
    return { m, n, key: `${m.kind}-${n}` };
  });
  type Entry = (typeof entries)[number];
  const ofKind = (...kinds: ModuleKind[]) => entries.filter((e) => kinds.includes(e.m.kind));
  const blocks: HangarBlock[] = [];
  const add = (e: Entry, shape: BlockShape, look: string, position: V3, size: V3, anchor: V3, roll = 0, tier = 0) =>
    blocks.push({ key: e.key, partId: e.m.id, family: e.m.kind, shape, look, position, size, roll, anchor, order: (ORDER[e.m.kind] ?? 4) * 100 + e.n, tier, seed: hashOf(e.m.id) });

  // Estructura.
  for (const e of ofKind('structure')) {
    if (e.m !== structure) continue;
    add(e, 'bus', 'octagon', [0, 0, 0], [Lb, 2 * R, 2 * R], [0, 0, 0], 0, busTier);
  }

  // Banco de instrumentos (bajo la proa): hace falta antes para saber dónde acaban las cajas de abajo.
  const cs = clamp((2 * R * 0.9) / 3, 0.22, 0.34);
  const rows = Math.ceil(instruments.length / 3);
  const benchX1 = H + 0.36;
  const bench = instruments.length ? { x0: Math.min(H - 0.3, benchX1 - rows * cs - 0.06), x1: benchX1, y: -R - 0.03, width: 3 * cs + 0.06 } : null;
  const benchUnder = -R - 0.055;

  // Tanques: cercha tras el adaptador, anillos de hasta cuatro.
  const tanks = ofKind('tank');
  let truss: HangarLayout['truss'] = null;
  let cursorAft = aftX;
  if (tanks.length) {
    const dOf = (m: ModuleDef) => clamp(0.21 * cbrt(m.massKg / 100), 0.3, 1.5 * R);
    const dMax = Math.max(...tanks.map((t) => dOf(t.m)));
    const ringCount = Math.ceil(tanks.length / 4);
    const ringLen = dMax * 1.35 + 0.14;
    const perRing = Array.from({ length: ringCount }, (_, r) => Math.floor(tanks.length / ringCount) + (r < tanks.length % ringCount ? 1 : 0));
    const o = dMax / 2 + 0.04;
    const offsets = (k: number): [number, number][] =>
      k === 1 ? [[0, 0]] : k === 2 ? [[0, o], [0, -o]] : k === 3 ? [0, 1, 2].map((i) => [Math.cos(Math.PI / 2 + (i * 2 * Math.PI) / 3) * o * 1.18, Math.sin(Math.PI / 2 + (i * 2 * Math.PI) / 3) * o * 1.18]) : [[o, o], [o, -o], [-o, o], [-o, -o]];
    let reach = 0;
    for (const k of perRing) for (const [y, z] of offsets(k)) reach = Math.max(reach, Math.abs(y) + dMax / 2, Math.abs(z) + dMax / 2);
    const half = Math.max(R * 0.8, reach + 0.06);
    const x1 = aftX - ringCount * ringLen - 0.06;
    truss = { x0: aftX, x1, half };
    let i = 0;
    perRing.forEach((k, r) => {
      const xc = aftX - 0.03 - (r + 0.5) * ringLen;
      for (const [y, z] of offsets(k)) {
        const e = tanks[i++]!;
        const d = dOf(e.m);
        const sy = Math.abs(y) < 1e-6 ? 0 : Math.sign(y);
        const sz = Math.abs(z) < 1e-6 ? 0 : Math.sign(z);
        const anchor: V3 = sy === 0 && sz === 0 ? [xc, half, 0] : [xc, sy * half, sz * half];
        add(e, 'tank', 'capsule',[xc, y, z], [d * 1.35, d, d], anchor, 0, rankIn(e.m.massKg, peers('tank').map((m) => m.massKg)));
      }
    });
    cursorAft = x1;
  }

  // Propulsión al final de la popa (si hubiera más de una, una tras otra).
  for (const e of ofKind('propulsion')) {
    if (isIonEngine(e.m)) {
      const diam = clamp(0.36 * cbrt(e.m.massKg / 100), 0.6, 2.3 * R);
      const len = 0.42;
      add(e, 'ion', 'grid', [cursorAft - len / 2, 0, 0], [len, diam, diam], [cursorAft, 0, 0], 0, rankIn(e.m.massKg, peers('propulsion').map((m) => m.massKg)));
      cursorAft -= len;
    } else {
      const bell = clamp(0.24 * cbrt(e.m.massKg / 50), 0.5, 1.6);
      const total = bell + 0.34;
      const exit = bell * 0.74;
      add(e, 'engine', 'bell', [cursorAft - total / 2, 0, 0], [total, exit, exit], [cursorAft, 0, 0], 0, rankIn(e.m.massKg, peers('propulsion').map((m) => m.massKg)));
      cursorAft -= total;
    }
  }

  // Blindaje: capas Whipple en la proa; anillos emisores alrededor de la parte delantera del bus.
  let layer = 0;
  let ring = 0;
  for (const e of ofKind('shielding')) {
    const tier = rankIn(e.m.massKg, peers('shielding').map((m) => m.massKg));
    if (isActiveShield(e.m)) {
      const x = Math.max(-H * 0.2, H - 0.2 - ring++ * 0.24);
      const rr = R + 0.28;
      add(e, 'emitter', 'ring', [x, 0, 0], [0.1, 2 * rr, 2 * rr], [x, R, 0], 0, tier);
    } else {
      const x = H + 0.1 + layer * 0.11;
      add(e, 'whipple', layer++ % 2 === 0 ? 'metal' : 'fabric', [x, 0, 0], [0.03, 2 * R * 0.98, 2 * R * 0.98], [H, 0, 0], 0, tier);
    }
  }

  // Radiadores en las caras diagonales de popa (primero las de abajo).
  const finEnd: Record<number, number> = {};
  ofKind('thermal').forEach((e, i) => {
    const th = DIAG[i % 4]!;
    const row = Math.floor(i / 4);
    const l = clamp(0.3 + (e.m.heatRejectKw ?? 40) * 0.006, 0.4, 1.1);
    const chord = clamp(Lb * 0.28, 0.45, 0.95);
    const x = -H * 0.85 + chord / 2 + row * (chord + 0.08);
    const r = R + 0.06 + l / 2;
    add(e, 'radiator', 'panel', [x, r * Math.cos(th), r * Math.sin(th)], [chord, l, 0.03], [x, R * Math.cos(th), R * Math.sin(th)], th, rankIn(e.m.heatRejectKw ?? 0, peers('thermal').map((m) => m.heatRejectKw ?? 0)));
    finEnd[i % 4] = Math.max(finEnd[i % 4] ?? -Infinity, x + chord / 2);
  });

  // Alas solares por parejas a ±Z; las piezas iguales van juntas para que cada pareja sea simétrica.
  const wings = ofKind('solar');
  const pairs = Math.ceil(wings.length / 2);
  const arranged = [...wings].sort((a, b) => (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : a.n - b.n));
  const chord = clamp(Math.min(0.95, (Lb * 0.85) / Math.max(1, pairs) - 0.07), 0.3, 0.95);
  const effOf = (m: ModuleDef) => (m.solarKwAt1Au ?? 0) / Math.max(1, m.massKg);
  const spanOf = (m: ModuleDef) => clamp((WING_KW_AREA * Math.max(5, m.solarKwAt1Au ?? 30)) / chord, 0.6, 5);
  arranged.forEach((e, a) => {
    const side = a % 2 === 0 ? 1 : -1;
    const p = Math.floor(a / 2);
    const x = (p - (pairs - 1) / 2) * (chord + 0.07);
    // Una pareja de alas distintas comparte envergadura (la media): la silueta es simétrica y el tipo se ve en las celdas.
    const mate = arranged[a % 2 === 0 ? a + 1 : a - 1];
    const span = mate ? (spanOf(e.m) + spanOf(mate.m)) / 2 : spanOf(e.m);
    add(e, 'wing', 'array', [x, 0, side * (R + YOKE + span / 2)], [chord, 0.04, span], [x, 0, side * R], side > 0 ? 0 : Math.PI, rankIn(effOf(e.m), peers('solar').map(effOf)));
  });

  // Arriba: antenas desde la proa (látigos delante, platos detrás) y módulos presurizados desde la popa.
  let topFore = H - 0.05;
  const comms = ofKind('comms');
  const isDish = (m: ModuleDef) => {
    const ps = peers('comms');
    return ps.length <= 1 || rankIn(m.dataRateMbps ?? 0, ps.map((x) => x.dataRateMbps ?? 0)) > 0.5;
  };
  for (const e of [...comms.filter((c) => !isDish(c.m)), ...comms.filter((c) => isDish(c.m))]) {
    const tier = rankIn(e.m.commsRangeAu ?? 0, peers('comms').map((m) => m.commsRangeAu ?? 0));
    if (isDish(e.m)) {
      const D = clamp(0.5 * cbrt(e.m.massKg / 30), 0.5, 2.2);
      const mast = 0.22 + D * 0.08;
      const x = topFore - D * 0.45;
      add(e, 'dish', 'hga', [x, R + mast + D * 0.2, 0], [D, D * 0.4, D], [x, R, 0], 0, tier);
      topFore -= D * 0.9;
    } else {
      const h = clamp(0.45 + 0.18 * cbrt(e.m.massKg / 30), 0.45, 1.1);
      const x = topFore - 0.12;
      add(e, 'whip', 'lga', [x, R + h / 2, 0], [0.32, h, 0.32], [x, R, 0], 0, tier);
      topFore -= 0.3;
    }
  }
  let topAft = -H + 0.08;
  for (const e of ofKind('habitat', 'greenhouse')) {
    const d = clamp(0.36 * cbrt(e.m.massKg / 500), 0.35, 1.4 * R);
    const len = d * 1.9;
    const x = topAft + len / 2;
    add(e, 'pod', e.m.kind === 'greenhouse' ? 'greenhouse' : 'habitat', [x, R + 0.1 + d / 2, 0], [len, d, d], [x, R, 0], 0, rankIn(e.m.massKg, peers(e.m.kind).map((m) => m.massKg)));
    topAft += len + 0.1;
  }

  // Nuclear: RTG en brazos diagonales tras la popa; reactor en un mástil hacia abajo con sus radiadores.
  const nukes = ofKind('nuclear');
  const isReactor = (m: ModuleDef) => {
    const ps = peers('nuclear');
    return ps.length > 1 && rankIn(m.massKg, ps.map((x) => x.massKg)) > 0.5;
  };
  const rtgAngles = [Math.PI * 0.25, -Math.PI * 0.25, Math.PI * 0.75, -Math.PI * 0.75];
  let rtgs = 0;
  let reactors = 0;
  for (const e of nukes) {
    const tier = rankIn(e.m.massKg, peers('nuclear').map((m) => m.massKg));
    if (isReactor(e.m)) {
      const mast = clamp(1.1 + 0.3 * cbrt(e.m.massKg / 1000), 1.0, 2.2);
      const d = clamp(0.28 * cbrt(e.m.massKg / 1000) + 0.12, 0.3, 0.8);
      const x = -H * 0.2 + reactors++ * 1.2;
      add(e, 'reactor', 'fission', [x, -(R + mast), 0], [Math.min(1.1, Lb * 0.5), 0.4, d], [x, -R, 0], Math.PI, tier);
    } else {
      const th = rtgAngles[rtgs % 4]!;
      const row = Math.floor(rtgs++ / 4);
      const len = clamp(0.25 * cbrt(e.m.massKg / 50), 0.4, 1.0);
      const diam = len * 0.42 * 1.6;
      const rr = Math.max(R, (truss?.half ?? 0) * Math.SQRT2) + 0.45 + diam / 2;
      const x = -H - 0.3 - row * (len + 0.2);
      add(e, 'rtg', 'finned', [x, rr * Math.cos(th), rr * Math.sin(th)], [len, diam, diam], [-H + 0.05, R * Math.cos(th), R * Math.sin(th)], th, tier);
    }
  }

  // Cajas de aviónica en las caras diagonales (batería, computadora, ruedas, soporte vital, taller, familias nuevas).
  const handled = new Set<ModuleKind>(['structure', 'propulsion', 'tank', 'shielding', 'thermal', 'solar', 'comms', 'habitat', 'greenhouse', 'nuclear']);
  const fw = faceWidth(R);
  const faceCursor = DIAG.map((_, f) => Math.max(-H + 0.25, (finEnd[f] ?? -Infinity) + 0.06));
  const faceEnd = DIAG.map((th) => (Math.cos(th) < 0 && bench ? bench.x0 - 0.05 : H - 0.08));
  // Orden de llenado simétrico: arriba a un lado y al otro, luego abajo.
  const fillOrder = [2, 3, 0, 1];
  let turn = 0;
  for (const e of entries.filter((x) => !handled.has(x.m.kind))) {
    const len = clamp(0.14 * cbrt(e.m.massKg / 10), 0.2, 0.7);
    const width = Math.min(len * 0.9, fw * 0.88);
    const prot = clamp(len * 0.35, 0.08, 0.2);
    let face = -1;
    for (let k = 0; k < 4; k++) {
      const f = fillOrder[(turn + k) % 4]!;
      if (faceCursor[f]! + len <= faceEnd[f]! + 1e-9) {
        face = f;
        turn = (turn + k + 1) % 4;
        break;
      }
    }
    if (face < 0) {
      // Sin sitio: la cara con más hueco (puede solapar, pero nunca sale del bus).
      face = faceCursor.reduce((best, c, f) => (faceEnd[f]! - c > faceEnd[best]! - faceCursor[best]! ? f : best), 0);
    }
    const th = DIAG[face]!;
    const x = Math.min(faceCursor[face]! + len / 2, H - len / 2);
    faceCursor[face] = faceCursor[face]! + len + 0.05;
    const r = R + prot / 2;
    const tier = e.m.radiationHardened ? 1 : rankIn(e.m.massKg, peers(e.m.kind).map((m) => m.massKg));
    add(e, 'avionics', e.m.kind, [x, r * Math.cos(th), r * Math.sin(th)], [len, prot, width], [x, R * Math.cos(th), R * Math.sin(th)], th, tier);
  }

  // Instrumentos colgados bajo el banco, en filas de tres centradas, de la proa hacia atrás.
  instruments.forEach((inst, i) => {
    const row = Math.floor(i / 3);
    const inRow = Math.min(3, instruments.length - row * 3);
    const j = i % 3;
    const x = benchX1 - 0.04 - cs / 2 - row * cs;
    const z = (j - (inRow - 1) / 2) * cs;
    const s = inst.cubesat ? 0.09 : clamp(0.055 * cbrt(inst.massKg) + 0.06, 0.12, cs * 0.9);
    blocks.push({
      key: `instrument-${i}`,
      partId: inst.id,
      family: 'instrument',
      science: inst.scienceKind,
      shape: 'instrument',
      look: instrumentLook(inst, allInst),
      position: [x, benchUnder - s / 2, z],
      size: [s, s, s],
      roll: Math.PI,
      anchor: [x, benchUnder, z],
      order: 900 + i,
      tier: rankIn(inst.massKg, allInst.filter((p) => p.scienceKind === inst.scienceKind).map((p) => p.massKg)),
      seed: hashOf(inst.id),
    });
  });

  // Caja total (el bus cuenta aunque falte: es el bastidor).
  const min: V3 = [aftX, -R * OCTA, -R * OCTA];
  const max: V3 = [H, R * OCTA, R * OCTA];
  const grow = (bx: { min: V3; max: V3 }) => {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, bx.min[k]!);
      max[k] = Math.max(max[k]!, bx.max[k]!);
    }
  };
  for (const b of blocks) grow(blockBox(b));
  if (bench) grow({ min: [bench.x0, bench.y - 0.03, -bench.width / 2], max: [bench.x1, bench.y + 0.03, bench.width / 2] });
  if (truss) grow({ min: [truss.x1, -truss.half, -truss.half], max: [truss.x0, truss.half, truss.half] });
  const radiusM = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;

  return { blocks, lengthM: max[0] - min[0], bus: { lengthM: Lb, radiusM: R, present: !!structure, tier: busTier }, aftX, bench, truss, bounds: { min, max }, radiusM };
}
