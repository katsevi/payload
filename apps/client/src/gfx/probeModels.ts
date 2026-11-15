/**
 * Modelos procedurales de las piezas de la sonda del hangar (fase 4). Cada bloque de `game/hangarLayout.ts` se
 * modela con `Builder` en SU marco: origen en el punto de anclaje, girado por `roll` (+Y local = hacia fuera de
 * la cara en la que va), así una caja de aviónica o un radiador sirven para las cuatro caras diagonales y un ala
 * para los dos costados. La geometría de cada variante (forma, aspecto, medidas) se construye una vez y se cachea.
 *
 * Inspiración: Cassini, Juno, Europa Clipper, New Horizons, Dawn (bus con mantas MLI, alas con yugo, RTG en
 * brazos, plato de alta ganancia con trípode, radiadores con tubos, escudo Whipple en capas).
 */
import { CylinderGeometry, MeshBasicMaterial, type Material } from 'three';
import type { ScienceKind } from '@payload/shared';
import { ADAPTER, boomLength, dipoleLength, OCTA, faceWidth, rotX, type HangarBlock, type HangarLayout, type V3 } from '../game/hangarLayout';
import { rng } from '../game/noise';
import { Builder, once, type Part } from './build';
import { mats, probeMats } from './materials';

const HALF_PI = Math.PI / 2;
/** Gira el eje Y de un torno/cilindro hacia −X (motor) o +X. */
const TO_NEG_X: V3 = [0, 0, HALF_PI];
const TO_POS_X: V3 = [0, 0, -HALF_PI];
/** Toro en el plano YZ (eje X). */
const RING_X: V3 = [0, HALF_PI, 0];
/** Toro en el plano XZ (eje Y). */
const RING_Y: V3 = [HALF_PI, 0, 0];

export interface Glow3 {
  position: V3;
  color: string;
  size: number;
  opacity: number;
}

export interface ProbeModel {
  parts: Part[];
  /** Halos (sprites aditivos) en el marco del bloque: rejillas iónicas, emisores, núcleo del reactor. */
  glows: Glow3[];
}

/** Acento discreto por tipo de ciencia (una franja fina en el instrumento). */
export const SCIENCE_ACCENT: Record<ScienceKind, string> = {
  geology: '#d08a4c',
  ice: '#9fdcff',
  atmosphere: '#7fd4a8',
  fields: '#c77dff',
  interior: '#ffd25a',
  life: '#3ddc84',
};

const glowMats = once(() => ({
  ion: new MeshBasicMaterial({ color: '#3d8dff', toneMapped: false }),
  emitter: new MeshBasicMaterial({ color: '#5fe8ff', toneMapped: false }),
  green: new MeshBasicMaterial({ color: '#4fdc7a', toneMapped: false }),
  warm: new MeshBasicMaterial({ color: '#ffcf8a', toneMapped: false }),
  accent: Object.fromEntries(Object.entries(SCIENCE_ACCENT).map(([k, c]) => [k, new MeshBasicMaterial({ color: c, toneMapped: false })])) as Record<ScienceKind, MeshBasicMaterial>,
}));

/** Prisma octogonal con el eje en X y las caras a 0°, 45°… (apotema `r`). */
function octa(b: Builder, mat: Material, pos: V3, r: number, len: number, open = false): void {
  b.add(mat, new CylinderGeometry(r * OCTA, r * OCTA, len, 8, 1, open, Math.PI / 8), pos, [0, 0, HALF_PI]);
}

/** Punto a distancia `r` del eje X en el ángulo `th` (+Y → +Z). */
const radial = (x: number, r: number, th: number): V3 => [x, r * Math.cos(th), r * Math.sin(th)];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

interface Ctx {
  b: Builder;
  blk: HangarBlock;
  /** Centro del cuerpo en el marco del bloque. */
  c: V3;
  s: V3;
  glows: Glow3[];
}

// ─── Estructura ──────────────────────────────────────────────────────────────────────────────────────────────

function bus({ b, s, blk }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const L = s[0];
  const R = s[1] / 2;
  const H = L / 2;
  const fw = faceWidth(R);
  const tier = blk.tier;
  const r = rng(blk.seed);
  octa(b, m.machineDark, [0, 0, 0], R * 0.995, L);
  // Pieles de las ocho caras: paneles claros arriba y abajo, MLI dorada en las diagonales, negra en los costados.
  for (let k = 0; k < 8; k++) {
    const th = (k * Math.PI) / 4;
    const mat = k % 2 === 1 ? (r() < 0.25 ? p.mliDark : p.mli) : k === 2 || k === 6 ? p.mliDark : m.wall;
    b.box(mat, radial(0, R + 0.006, th), [L * 0.94, 0.012, fw * 0.94], [th, 0, 0], k % 2 === 1 ? 1.2 : 0.5);
  }
  // Marcos: tapas, cuadernas intermedias (más cuanto más grande) y largueros en las aristas.
  for (const x of [-H + 0.02, H - 0.02]) octa(b, m.trim, [x, 0, 0], R * 1.025, 0.04);
  const frames = 1 + Math.round(tier * 3);
  for (let i = 1; i <= frames; i++) octa(b, m.trim, [-H + (i * L) / (frames + 1), 0, 0], R * 1.014, 0.025);
  for (let k = 0; k < 8; k++) {
    const th = Math.PI / 8 + (k * Math.PI) / 4;
    b.pipe(m.trim, radial(-H, R * OCTA, th), radial(H, R * OCTA, th), 0.016, 6);
  }
  // Las estructuras reforzadas llevan cruces de refuerzo por fuera de las caras de arriba y abajo.
  if (tier > 0.5) {
    for (const th of [0, Math.PI]) {
      const z = fw * 0.42;
      b.pipe(m.steel, radial(-H + 0.05, R + 0.03, th).map((v, i) => (i === 2 ? v + z : v)) as V3, radial(H - 0.05, R + 0.03, th).map((v, i) => (i === 2 ? v - z : v)) as V3, 0.014, 6);
      b.pipe(m.steel, radial(-H + 0.05, R + 0.03, th).map((v, i) => (i === 2 ? v - z : v)) as V3, radial(H - 0.05, R + 0.03, th).map((v, i) => (i === 2 ? v + z : v)) as V3, 0.014, 6);
    }
  }
  // Adaptador de lanzamiento en la popa (cono truncado y anillo de separación).
  b.lathe(m.machine, [[R * 0.9, 0], [R * 0.62, ADAPTER * 0.85], [R * 0.6, ADAPTER]], [-H, 0, 0], { rot: TO_NEG_X, seg: 24 });
  b.torus(m.trim, [-H - ADAPTER, 0, 0], R * 0.6, 0.028, { rot: RING_X, seg: 32 });
  b.torus(m.steel, [-H - ADAPTER * 0.4, 0, 0], R * 0.76, 0.012, { rot: RING_X, seg: 32 });
  // Tapa de proa con registro y dos buscadores de estrellas con parasol.
  octa(b, m.machine, [H + 0.012, 0, 0], R * 0.9, 0.02);
  b.box(m.machineDark, [H + 0.026, 0, 0], [0.01, R * 0.6, R * 0.6]);
  for (const z of [-R * 0.42, R * 0.42]) {
    b.cyl(m.dark, [H + 0.07, R * 0.6, z], 0.035, 0.035, 0.1, { rot: TO_POS_X, seg: 12 });
    b.cyl(m.trim, [H + 0.14, R * 0.6, z], 0.06, 0.045, 0.08, { rot: TO_POS_X, seg: 14, open: true });
  }
  // Grupos de propulsores de actitud en las esquinas de popa y proa.
  for (const x of [-H + 0.09, H - 0.09]) {
    for (const th of [Math.PI / 8, -Math.PI / 8, Math.PI - Math.PI / 8, -Math.PI + Math.PI / 8]) {
      const at = radial(x, R * OCTA + 0.03, th);
      b.box(m.machine, at, [0.07, 0.05, 0.07], [th, 0, 0]);
      for (const dx of [-0.045, 0.045]) b.cyl(m.dark, [at[0] + dx, at[1], at[2]], 0.012, 0.022, 0.035, { rot: dx < 0 ? TO_NEG_X : TO_POS_X, seg: 8 });
      b.cyl(m.dark, radial(x, R * OCTA + 0.075, th), 0.012, 0.022, 0.035, { rot: [th, 0, 0], seg: 8 });
    }
  }
  // Pasamanos en la cara de arriba.
  for (const z of [-fw * 0.3, fw * 0.3]) {
    b.pipe(m.orange, [-H * 0.6, R + 0.05, z], [H * 0.6, R + 0.05, z], 0.008, 6);
    for (const x of [-H * 0.6, 0, H * 0.6]) b.pipe(m.orange, [x, R, z], [x, R + 0.05, z], 0.008, 6);
  }
}

// ─── Propulsión ──────────────────────────────────────────────────────────────────────────────────────────────

function engine({ b, s }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const total = s[0];
  const re = s[1] / 2;
  const bell = total - 0.34;
  const rt = re * 0.26;
  const rm = Math.min(0.32, re * 0.75);
  // Bancada: anillo de la popa y cuatro puntales hasta el cardán.
  b.torus(m.trim, [-0.01, 0, 0], rm, 0.022, { rot: RING_X, seg: 24 });
  for (let k = 0; k < 4; k++) {
    const th = Math.PI / 4 + (k * Math.PI) / 2;
    b.pipe(m.steel, radial(-0.01, rm, th), [-0.15, 0, 0], 0.016, 8);
  }
  b.sphere(m.steel, [-0.16, 0, 0], 0.05, 1, 12);
  // Cámara de combustión con inyector, turbobomba y líneas de propelente.
  b.lathe(m.trim, [[0.001, 0], [rt * 1.7, 0.03], [rt * 1.8, 0.06]], [-0.18, 0, 0], { rot: TO_NEG_X, seg: 18 });
  b.cyl(m.copper, [-0.27, 0, 0], rt * 1.6, rt * 1.6, 0.14, { rot: TO_NEG_X, seg: 18 });
  b.lathe(m.copper, [[rt * 1.6, 0], [rt * 1.05, 0.05], [rt, 0.07]], [-0.34, 0, 0], { rot: TO_NEG_X, seg: 18 });
  b.cyl(m.machine, [-0.24, rt * 2.6, 0], 0.035, 0.035, 0.12, { rot: TO_NEG_X, seg: 10 });
  b.pipe(m.steel, [-0.05, rm * 0.6, 0.05], [-0.2, rt * 2.6, 0], 0.012, 6);
  b.pipe(m.steel, [-0.29, rt * 2.6, 0], [-0.3, rt * 1.5, 0], 0.012, 6);
  b.pipe(m.steel, [-0.05, -rm * 0.6, -0.05], [-0.26, -rt * 1.6, 0], 0.012, 6);
  // Tobera en campana: contorno parabólico (exterior oscuro con tinte de calor, interior negro).
  const prof: [number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    prof.push([rt + (re - rt) * (1 - Math.pow(1 - t, 1.9)), t * bell]);
  }
  b.lathe(p.nozzle, prof, [-0.34 - 0.07, 0, 0], { rot: TO_NEG_X, seg: 28 });
  b.lathe(m.dark, prof.map(([rr, y]) => [rr * 0.965, y] as [number, number]).reverse(), [-0.34 - 0.07, 0, 0], { rot: TO_NEG_X, seg: 28 });
  for (const t of [0.25, 0.55]) b.torus(m.copper, [-0.41 - t * bell, 0, 0], rt + (re - rt) * (1 - Math.pow(1 - t, 1.9)) + 0.006, 0.01, { rot: RING_X, seg: 28 });
  b.torus(m.trim, [-0.41 - bell, 0, 0], re, 0.014, { rot: RING_X, seg: 32 });
}

function ion({ b, s, glows, blk }: Ctx): void {
  const m = mats();
  const D = s[1];
  const len = s[0];
  octa(b, m.machine, [-0.04, 0, 0], D * 0.46, 0.07);
  b.torus(m.trim, [-0.08, 0, 0], D * 0.46, 0.016, { rot: RING_X, seg: 28 });
  const n = blk.tier > 0.5 ? 1 : 3;
  const ring = n === 1 ? 0 : D * 0.22;
  const r = n === 1 ? D * 0.36 : D * 0.19;
  for (let k = 0; k < n; k++) {
    const th = Math.PI / 2 + (k * 2 * Math.PI) / 3;
    const y = ring * Math.cos(th);
    const z = ring * Math.sin(th);
    // Soporte de cardán, carcasa, rejilla y anillo exterior.
    b.box(m.steel, [-0.11, y, z], [0.06, r * 0.5, r * 0.5]);
    b.cyl(m.trim, [-0.22, y, z], r, r * 0.92, len * 0.42, { rot: TO_NEG_X, seg: 24 });
    b.cyl(m.dark, [-len + 0.035, y, z], r * 0.9, r * 0.9, 0.02, { rot: TO_NEG_X, seg: 24 });
    b.add(glowMats().ion, new CylinderGeometry(r * 0.8, r * 0.8, 0.004, 24), [-len + 0.022, y, z], TO_NEG_X);
    for (const f of [0.35, 0.65]) b.torus(m.steel, [-len + 0.02, y, z], r * f, 0.004, { rot: RING_X, seg: 24, tubeSeg: 4 });
    b.torus(m.steel, [-len + 0.03, y, z], r * 0.95, 0.018, { rot: RING_X, seg: 28 });
    // Neutralizador.
    b.cyl(m.machineDark, [-len + 0.05, y + r * 1.05, z], 0.02, 0.02, 0.08, { rot: TO_NEG_X, seg: 8 });
    glows.push({ position: [-len - 0.02, y, z], color: '#3d8dff', size: r * 3.2, opacity: 0.38 });
  }
}

// ─── Energía ─────────────────────────────────────────────────────────────────────────────────────────────────

function wing({ b, s, c, blk }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const chord = s[0];
  const span = s[2];
  const z0 = c[2] - span / 2;
  const cells = blk.tier > 0.5 ? p.cellHi : p.cell;
  // Mecanismo de orientación (SADA), brazo y yugo.
  b.cyl(m.machine, [0, 0, 0.045], 0.075, 0.075, 0.09, { rot: [HALF_PI, 0, 0], seg: 16 });
  b.torus(m.trim, [0, 0, 0.09], 0.075, 0.012, { seg: 18 });
  b.pipe(m.trim, [0, 0, 0.09], [0, 0, z0 * 0.62], 0.024, 10);
  for (const sx of [-1, 1]) b.pipe(m.trim, [0, 0, z0 * 0.62], [sx * chord * 0.38, 0, z0 - 0.01], 0.016, 8);
  b.pipe(m.trim, [-chord * 0.46, 0, z0 - 0.01], [chord * 0.46, 0, z0 - 0.01], 0.014, 8);
  b.box(m.machineDark, [0, 0, z0 * 0.62], [0.07, 0.06, 0.07]);
  // Paneles con celdas, chapa trasera, largueros de borde y bisagras entre paneles.
  const n = Math.max(2, Math.round(span / 0.75));
  const seg = span / n;
  for (let i = 0; i < n; i++) {
    const zc = z0 + (i + 0.5) * seg;
    b.box(cells, [0, 0, zc], [chord - 0.03, 0.02, seg - 0.035], undefined, 1.6);
    b.box(m.wallDark, [0, -0.015, zc], [chord - 0.04, 0.008, seg - 0.045]);
    for (const sx of [-1, 1]) b.box(m.trim, [sx * (chord / 2 - 0.01), 0, zc], [0.018, 0.03, seg - 0.02]);
    for (const zz of [zc - seg / 2 + 0.008, zc + seg / 2 - 0.008]) b.box(m.trim, [0, 0, zz], [chord - 0.02, 0.024, 0.014]);
    if (i > 0) for (const sx of [-0.3, 0.3]) b.cyl(m.steel, [sx * chord, 0.006, zc - seg / 2], 0.012, 0.012, 0.08, { rot: TO_POS_X, seg: 8 });
  }
  b.box(m.machineDark, [chord * 0.3, 0.02, z0 + span - 0.06], [0.05, 0.03, 0.05]);
}

function rtg({ b, s, c }: Ctx): void {
  const m = mats();
  const len = s[0];
  const D = s[1];
  const r = D / 3.2;
  const [cx, cy] = c;
  // Brazo con tirante hasta la abrazadera del generador.
  b.pipe(m.trim, [0, 0.01, 0], [cx + len * 0.15, cy - r * 1.05, 0], 0.028, 10);
  b.pipe(m.steel, [0.35, 0.01, 0], [cx + len * 0.35, cy - r * 1.05, 0], 0.015, 8);
  b.pipe(m.steel, [0.35, 0.01, 0.12], [cx + len * 0.15, cy - r * 1.05, 0], 0.012, 8);
  b.pipe(m.steel, [0.35, 0.01, -0.12], [cx + len * 0.15, cy - r * 1.05, 0], 0.012, 8);
  b.box(m.machine, [0, 0.025, 0], [0.12, 0.05, 0.12]);
  // Generador: cilindro oscuro con aletas radiales, tapas y abrazaderas.
  b.cyl(m.dark, [cx, cy, 0], r, r, len, { rot: TO_POS_X, seg: 16 });
  const fl = D / 2 - r;
  for (let k = 0; k < 8; k++) {
    const ph = (k * Math.PI) / 4 + Math.PI / 8;
    b.box(m.machineDark, [cx, cy + Math.cos(ph) * (r + fl / 2), Math.sin(ph) * (r + fl / 2)], [len * 0.9, fl, 0.014], [ph, 0, 0]);
  }
  for (const sx of [-1, 1]) {
    b.cyl(m.trim, [cx + sx * (len / 2 + 0.01), cy, 0], r * 1.08, r * 1.08, 0.03, { rot: TO_POS_X, seg: 16 });
    b.sphere(m.steel, [cx + sx * (len / 2 + 0.03), cy, 0], r * 0.55, [0.4, 1, 1], 12);
    b.torus(m.steel, [cx + sx * len * 0.3, cy, 0], r + fl * 0.85, 0.012, { rot: RING_X, seg: 20 });
  }
}

function reactor({ b, s, c, glows }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const mast = c[1];
  const d = s[2];
  const half = s[0] / 2;
  // Mástil de celosía triangular.
  const corners = [0, 1, 2].map((k) => (k * 2 * Math.PI) / 3);
  const at = (k: number, y: number): V3 => [Math.cos(corners[k]!) * 0.07, y, Math.sin(corners[k]!) * 0.07];
  const top = mast - d * 0.55;
  for (let k = 0; k < 3; k++) b.pipe(m.trim, at(k, 0), at(k, top), 0.014, 6);
  for (let y = 0.12, i = 0; y < top; y += 0.22, i++) for (let k = 0; k < 3; k++) b.pipe(m.steel, at(k, y), at((k + 1) % 3, y + (i % 2 ? 0.11 : 0)), 0.007, 4);
  b.box(m.machine, [0, 0.02, 0], [0.22, 0.04, 0.22]);
  // Radiadores largos a ambos lados del mástil, con tubos y colectores.
  const w = half - 0.1;
  const y0 = 0.28;
  const y1 = mast - 0.5;
  if (y1 > y0 + 0.1) {
    for (const sx of [-1, 1]) {
      const xc = sx * (0.1 + w / 2);
      b.box(p.paint, [xc, (y0 + y1) / 2, 0], [w, y1 - y0, 0.018]);
      const n = Math.max(3, Math.round(w / 0.07));
      for (let i = 0; i < n; i++) {
        const x = xc - w / 2 + (i + 0.5) * (w / n);
        for (const z of [-0.012, 0.012]) b.pipe(m.trim, [x, y0 + 0.02, z], [x, y1 - 0.02, z], 0.005, 4);
      }
      for (const y of [y0 + 0.02, y1 - 0.02]) b.pipe(m.copper, [sx * 0.06, y, 0.014], [xc + sx * w / 2, y, 0.014], 0.01, 6);
      b.pipe(m.steel, [sx * 0.07, y0 + 0.1, 0], [xc, y0 + 0.02, 0], 0.01, 6);
      b.pipe(m.steel, [sx * 0.07, y1 - 0.1, 0], [xc, y1 - 0.02, 0], 0.01, 6);
    }
  }
  // Escudo de sombra (cono, ancho hacia la nave) y vasija del reactor.
  b.lathe(m.steel, [[0.05, mast - d * 0.95], [d * 0.8, mast - d * 0.9], [d * 0.45, mast - d * 0.58], [0.05, mast - d * 0.55]], [0, 0, 0], { seg: 24 });
  b.cyl(m.trim, [0, mast, 0], d * 0.34, d * 0.34, d * 0.7, { seg: 20 });
  b.sphere(m.trim, [0, mast + d * 0.35, 0], d * 0.34, [1, 0.6, 1], 16);
  for (const y of [mast - d * 0.2, mast + d * 0.15]) b.torus(m.copper, [0, y, 0], d * 0.35, 0.012, { rot: RING_Y, seg: 20 });
  glows.push({ position: [0, mast + d * 0.2, 0], color: '#ffb070', size: d * 2.2, opacity: 0.22 });
}

// ─── Cajas de aviónica ───────────────────────────────────────────────────────────────────────────────────────

function avionics({ b, s, blk }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const [L, P, W] = s;
  const look = blk.look;
  const body = look === 'lifeSupport' ? p.paint : look === 'workshop' ? m.wallDark : look === 'battery' ? m.machineDark : look === 'computer' && blk.tier > 0.5 ? p.mli : m.machine;
  b.box(body, [0, P / 2, 0], [L, P, W], undefined, body === p.mli ? 1.4 : 1);
  b.box(m.trim, [0, P + 0.004, 0], [L - 0.02, 0.008, W - 0.02]);
  for (const sx of [-1, 1]) b.box(m.steel, [sx * (L / 2 - 0.015), 0.01, 0], [0.03, 0.02, W + 0.02]);
  // Conectores y cable hasta el bus.
  for (const z of [-W * 0.25, W * 0.25]) b.cyl(m.dark, [L / 2 + 0.012, P * 0.5, z], 0.014, 0.014, 0.024, { rot: TO_POS_X, seg: 8 });
  b.pipe(m.orange, [L / 2 + 0.02, P * 0.5, -W * 0.25], [L / 2 + 0.06, 0.012, -W * 0.25], 0.007, 6);
  b.pipe(m.dark, [L / 2 + 0.02, P * 0.5, W * 0.25], [L / 2 + 0.07, 0.012, W * 0.32], 0.007, 6);
  const top = P + 0.008;
  switch (look) {
    case 'battery': {
      const nx = Math.max(2, Math.round(L / 0.07));
      for (let i = 0; i < nx; i++)
        for (const z of [-W * 0.22, W * 0.22]) b.cyl(m.trim, [-L / 2 + (i + 0.5) * (L / nx), top + 0.012, z], 0.018, 0.018, 0.024, { seg: 10 });
      b.box(glowMats().green, [L * 0.38, top + 0.002, W * 0.42], [0.03, 0.004, 0.03]);
      break;
    }
    case 'computer': {
      const n = Math.max(3, Math.round(L / 0.035));
      for (let i = 0; i < n; i++) b.box(m.trim, [-L / 2 + (i + 0.5) * (L / n), top + 0.015, 0], [0.008, 0.03, W * 0.8]);
      b.box(glowMats().warm, [-L * 0.4, top + 0.002, W * 0.42], [0.025, 0.004, 0.025]);
      break;
    }
    case 'attitude': {
      const rr = Math.min(W * 0.36, L / 6);
      for (const x of [-L * 0.3, 0, L * 0.3]) {
        b.cyl(m.trim, [x, top + 0.03, 0], rr, rr, 0.06, { seg: 18 });
        b.cyl(m.machineDark, [x, top + 0.062, 0], rr * 0.4, rr * 0.4, 0.008, { seg: 12 });
      }
      break;
    }
    case 'lifeSupport': {
      const rr = Math.min(W, L / 2) * 0.32;
      for (const x of [-L * 0.25, L * 0.25]) b.sphere(p.paint, [x, top + rr * 0.8, 0], rr, 1, 14);
      b.pipe(m.orange, [-L * 0.25, top + rr * 1.5, 0], [L * 0.25, top + rr * 1.5, 0], 0.01, 6);
      b.pipe(m.copper, [L * 0.25 + rr, top + rr * 0.6, 0], [L / 2, top, W * 0.3], 0.008, 6);
      break;
    }
    case 'workshop': {
      b.box(m.machine, [0, top + 0.006, 0], [L * 0.7, 0.012, W * 0.7]);
      b.pipe(m.orange, [-L * 0.25, top + 0.04, W * 0.3], [L * 0.25, top + 0.04, W * 0.3], 0.008, 6);
      for (const x of [-L * 0.25, L * 0.25]) b.pipe(m.orange, [x, top, W * 0.3], [x, top + 0.04, W * 0.3], 0.008, 6);
      b.box(m.hazard, [0, top + 0.002, -W * 0.38], [L * 0.8, 0.004, 0.03]);
      break;
    }
    default: {
      const n = Math.max(3, Math.round(L / 0.05));
      for (let i = 0; i < n; i++) b.box(m.dark, [-L * 0.35 + (i * L * 0.7) / (n - 1), top + 0.002, 0], [0.012, 0.004, W * 0.6]);
    }
  }
}

// ─── Comunicaciones ──────────────────────────────────────────────────────────────────────────────────────────

function dish({ b, s, c }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const D = s[0];
  const depth = D * 0.17;
  const y0 = c[1] - D * 0.2;
  // Mástil y cardán.
  b.cyl(m.machine, [0, (y0 - 0.06) / 2, 0], 0.05, 0.065, y0 - 0.06, { seg: 14 });
  b.box(m.machineDark, [0, y0 - 0.05, 0], [0.13, 0.08, 0.13]);
  b.cyl(m.steel, [0, y0 - 0.01, 0], 0.03, 0.03, 0.06, { rot: TO_POS_X, seg: 10 });
  // Plato parabólico, borde y nervios traseros.
  const prof: [number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const rr = (D / 2) * (k / 12);
    prof.push([Math.max(0.001, rr), y0 + depth * (k / 12) ** 2]);
  }
  b.lathe(p.paintDish, prof, [0, 0, 0], { seg: 40 });
  b.torus(m.trim, [0, y0 + depth, 0], D / 2, 0.012, { rot: RING_Y, seg: 48 });
  for (let k = 0; k < 6; k++) {
    const th = (k * Math.PI) / 3;
    b.pipe(m.trim, [0, y0 - 0.02, 0], [Math.cos(th) * D * 0.46, y0 + depth * 0.8, Math.sin(th) * D * 0.46], 0.008, 4);
  }
  // Alimentador en el foco sobre un trípode, y bocina en el vértice.
  const f = (D / 2) ** 2 / (4 * depth);
  const fy = y0 + f * 0.9;
  for (let k = 0; k < 3; k++) {
    const th = Math.PI / 2 + (k * 2 * Math.PI) / 3;
    b.pipe(m.trim, [Math.cos(th) * D * 0.47, y0 + depth, Math.sin(th) * D * 0.47], [0, fy, 0], 0.009, 6);
  }
  b.cyl(probeMats().paint, [0, fy + 0.02, 0], D * 0.07, D * 0.05, 0.05, { seg: 16 });
  b.lathe(m.steel, [[0.03, y0], [0.05, y0 + 0.08], [0.07, y0 + 0.12]], [0, 0, 0], { seg: 14 });
}

function whip({ b, s }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const h = s[1];
  b.box(m.machine, [0, 0.03, 0], [0.12, 0.06, 0.12]);
  b.pipe(m.trim, [0, 0.06, 0], [0, h * 0.82, 0], 0.018, 8);
  b.lathe(p.paint, [[0.02, h * 0.82], [0.07, h * 0.9], [0.075, h * 0.96], [0.001, h]], [0, 0, 0], { seg: 16 });
  for (let k = 0; k < 4; k++) {
    const th = (k * Math.PI) / 2 + Math.PI / 4;
    const y = h * 0.55;
    b.pipe(m.steel, [0, y, 0], [Math.cos(th) * h * 0.32, y + h * 0.28, Math.sin(th) * h * 0.32], 0.005, 4);
  }
  b.torus(m.steel, [0, h * 0.55, 0], 0.03, 0.01, { rot: RING_Y, seg: 12 });
}

// ─── Térmico y blindaje ──────────────────────────────────────────────────────────────────────────────────────

function radiator({ b, s, c }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const chord = s[0];
  const l = s[1];
  const y0 = c[1] - l / 2;
  for (const x of [-chord * 0.35, chord * 0.35]) b.pipe(m.steel, [x, 0, 0], [x, y0 + 0.02, 0], 0.014, 6);
  b.box(p.paint, [0, c[1], 0], [chord, l, 0.02]);
  const n = Math.max(3, Math.round(chord / 0.07));
  for (let i = 0; i < n; i++) {
    const x = -chord / 2 + (i + 0.5) * (chord / n);
    for (const z of [-0.013, 0.013]) b.pipe(m.trim, [x, y0 + 0.03, z], [x, y0 + l - 0.03, z], 0.006, 4);
  }
  for (const y of [y0 + 0.025, y0 + l - 0.025]) b.pipe(m.copper, [-chord / 2, y, 0.016], [chord / 2, y, 0.016], 0.011, 6);
  for (const sx of [-1, 1]) b.box(m.trim, [sx * (chord / 2 + 0.006), c[1], 0], [0.012, l, 0.026]);
  b.pipe(m.copper, [chord * 0.45, y0 + 0.025, 0.016], [chord * 0.45, 0.01, 0.03], 0.01, 6);
}

function whipple({ b, s, c, blk }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const R = s[1] / 2;
  const x = c[0];
  const plate = blk.look === 'fabric' ? p.paint : m.trim;
  for (let k = 0; k < 4; k++) {
    const th = Math.PI / 4 + (k * Math.PI) / 2;
    b.pipe(m.steel, radial(0, R * 0.72, th), radial(x, R * 0.72, th), 0.012, 6);
  }
  octa(b, plate, [x, 0, 0], R, 0.016);
  octa(b, m.steel, [x, 0, 0], R * 1.01, 0.03, true);
  for (let k = 0; k < 8; k++) {
    const th = (k * Math.PI) / 4;
    b.box(m.machineDark, radial(x + 0.012, R * 0.82, th), [0.01, 0.03, 0.03], [th, 0, 0]);
  }
}

function emitter({ b, s, c, glows }: Ctx): void {
  const m = mats();
  const rr = s[1] / 2;
  const cy = c[1];
  const R = -cy;
  b.torus(m.trim, [0, cy, 0], rr, 0.024, { rot: RING_X, seg: 48 });
  b.torus(glowMats().emitter, [0.03, cy, 0], rr, 0.006, { rot: RING_X, seg: 48, tubeSeg: 4 });
  for (let k = 0; k < 4; k++) {
    const th = Math.PI / 4 + (k * Math.PI) / 2;
    b.pipe(m.steel, [0, cy + Math.cos(th) * R, Math.sin(th) * R], [0, cy + Math.cos(th) * (rr - 0.02), Math.sin(th) * (rr - 0.02)], 0.012, 6);
  }
  for (let k = 0; k < 6; k++) {
    const th = (k * Math.PI) / 3;
    const at = (r: number): V3 => [0, cy + Math.cos(th) * r, Math.sin(th) * r];
    b.cyl(m.machine, at(rr + 0.03), 0.035, 0.035, 0.08, { rot: [th, 0, 0], seg: 10 });
    b.cyl(glowMats().emitter, at(rr + 0.075), 0.022, 0.03, 0.012, { rot: [th, 0, 0], seg: 10 });
    glows.push({ position: at(rr + 0.09), color: '#5fe8ff', size: 0.22, opacity: 0.45 });
  }
}

// ─── Tanques y módulos presurizados ──────────────────────────────────────────────────────────────────────────

function tank({ b, s, c, blk }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const len = s[0];
  const d = s[1];
  const mat = blk.seed % 3 === 0 ? m.tank : p.paint;
  const mid = Math.max(0.001, len - d);
  b.cyl(mat, c, d / 2, d / 2, mid, { rot: TO_POS_X, seg: 24 });
  for (const sx of [-1, 1]) b.sphere(mat, [c[0] + (sx * mid) / 2, c[1], c[2]], d / 2, 1, 22);
  b.torus(m.steel, c, d / 2 + 0.002, 0.006, { rot: RING_X, seg: 32, tubeSeg: 4 });
  // Abrazaderas y puntales hasta la cercha.
  const dy = -c[1];
  const dz = -c[2];
  const dl = Math.hypot(dy, dz) || 1;
  for (const sx of [-1, 1]) {
    const x = c[0] + sx * len * 0.22;
    b.torus(m.trim, [x, c[1], c[2]], d / 2 + 0.006, 0.012, { rot: RING_X, seg: 28 });
    b.pipe(m.steel, [x, c[1] + (dy / dl) * (d / 2), c[2] + (dz / dl) * (d / 2)], [x, 0, 0], 0.014, 6);
  }
  // Válvula y línea de alimentación.
  b.cyl(m.orange, [c[0] - mid / 2 - d / 2 - 0.02, c[1], c[2]], 0.02, 0.02, 0.05, { rot: TO_POS_X, seg: 8 });
}

function pod({ b, s, c, blk }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const len = s[0];
  const d = s[1];
  const mid = len - d * 0.5;
  b.cyl(m.machine, [0, c[1] / 2, 0], d * 0.22, d * 0.22, c[1], { seg: 14 });
  b.cyl(p.paint, c, d / 2, d / 2, mid, { rot: TO_POS_X, seg: 28 });
  for (const sx of [-1, 1]) b.sphere(p.paint, [c[0] + (sx * mid) / 2, c[1], c[2]], d / 2, [0.5, 1, 1], 24);
  const ribs = Math.max(2, Math.round(mid / 0.22));
  for (let i = 0; i <= ribs; i++) b.torus(m.trim, [-mid / 2 + (i * mid) / ribs, c[1], 0], d / 2 + 0.004, 0.01, { rot: RING_X, seg: 28 });
  const glow = glowMats();
  for (const sz of [-1, 1]) {
    if (blk.look === 'greenhouse') {
      b.box(glow.green, [0, c[1] + d * 0.08, sz * (d / 2 - 0.01)], [mid * 0.75, d * 0.22, 0.03]);
      b.box(m.trim, [0, c[1] + d * 0.08, sz * (d / 2 - 0.004)], [mid * 0.78, 0.012, 0.03]);
    } else {
      for (const x of [-mid * 0.3, 0, mid * 0.3]) b.cyl(glow.warm, [x, c[1] + d * 0.05, sz * (d / 2 - 0.012)], d * 0.08, d * 0.08, 0.03, { rot: [HALF_PI, 0, 0], seg: 14 });
    }
  }
  b.pipe(m.orange, [-mid * 0.4, c[1] + d / 2 + 0.03, d * 0.15], [mid * 0.4, c[1] + d / 2 + 0.03, d * 0.15], 0.008, 6);
}

// ─── Instrumentos (marco: +Y local = hacia abajo, colgados del banco) ─────────────────────────────────────────

function instrument({ b, s: size, blk }: Ctx): void {
  const m = mats();
  const p = probeMats();
  const s = size[0];
  const accent = glowMats().accent[blk.science ?? 'geology'] ?? glowMats().accent.geology;
  b.box(m.machine, [0, 0.01, 0], [s * 0.9, 0.02, s * 0.9]);
  switch (blk.look) {
    case 'camera': {
      b.box(p.mli, [0, 0.02 + s * 0.22, 0], [s * 0.7, s * 0.44, s * 0.6], undefined, 2);
      b.box(accent, [0, 0.02 + s * 0.3, s * 0.301], [s * 0.5, s * 0.03, 0.004]);
      b.cyl(m.dark, [0, s * 0.62, 0], s * 0.17, s * 0.17, s * 0.4, { seg: 18 });
      b.cyl(m.trim, [0, s * 0.92, 0], s * 0.27, s * 0.2, s * 0.3, { seg: 20, open: true });
      b.cyl(m.screen, [0, s * 0.8, 0], s * 0.16, s * 0.16, 0.006, { seg: 18 });
      break;
    }
    case 'spectrometer': {
      b.box(p.mli, [0, 0.02 + s * 0.25, 0], [s * 0.8, s * 0.5, s * 0.6], undefined, 2);
      b.box(accent, [0, 0.02 + s * 0.3, s * 0.301], [s * 0.6, s * 0.03, 0.004]);
      const a = s * 0.18;
      for (const [dx, dz, w, dd] of [[-a, 0, 0.01, a * 2], [a, 0, 0.01, a * 2], [0, -a, a * 2, 0.01], [0, a, a * 2, 0.01]] as const)
        b.box(m.dark, [s * 0.15 + dx, s * 0.62, dz], [w, s * 0.24, dd]);
      b.box(m.screen, [s * 0.15, s * 0.52, 0], [a * 1.8, 0.006, a * 1.8]);
      b.box(p.paint, [-s * 0.2, s * 0.35, -s * 0.33], [s * 0.35, s * 0.5, 0.01]);
      b.cyl(m.trim, [-s * 0.25, s * 0.62, s * 0.1], s * 0.07, s * 0.07, s * 0.2, { seg: 10 });
      break;
    }
    case 'radar': {
      b.box(m.machine, [0, 0.02 + s * 0.2, 0], [s * 0.7, s * 0.4, s * 0.5]);
      b.box(accent, [s * 0.351, 0.02 + s * 0.2, 0], [0.004, s * 0.03, s * 0.4]);
      b.box(p.paint, [0, s * 0.45, 0], [s * 0.6, 0.012, s * 0.45]);
      const dl = dipoleLength(s);
      for (const sz of [-1, 1]) {
        b.cyl(m.dark, [0, s * 0.5, sz * s * 0.3], 0.02, 0.02, 0.05, { rot: [HALF_PI, 0, 0], seg: 8 });
        b.pipe(m.steel, [0, s * 0.5, sz * s * 0.3], [0, s * 0.5, sz * dl], 0.009, 6);
        b.sphere(m.trim, [0, s * 0.5, sz * dl], 0.015, 1, 8);
      }
      break;
    }
    case 'boom': {
      b.box(p.mli, [0, 0.02 + s * 0.2, 0], [s * 0.6, s * 0.4, s * 0.5], undefined, 2);
      b.box(accent, [0, 0.02 + s * 0.25, s * 0.251], [s * 0.4, s * 0.03, 0.004]);
      const L = boomLength(s);
      const from: V3 = [s * 0.3, s * 0.3, 0];
      const to: V3 = [s * 0.3 + L, s * 0.45, 0];
      b.cyl(m.machine, from, 0.03, 0.03, 0.08, { rot: [HALF_PI, 0, 0], seg: 10 });
      b.pipe(m.dark, from, to, 0.012, 6);
      for (const t of [0.6, 1]) {
        const at: V3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, 0];
        b.cyl(p.paint, at, 0.035, 0.035, 0.1, { rot: TO_POS_X, seg: 12 });
      }
      break;
    }
    case 'arm': {
      b.box(m.machine, [0, 0.02 + s * 0.12, 0], [s * 0.5, s * 0.24, s * 0.5]);
      b.box(accent, [0, 0.02 + s * 0.12, s * 0.251], [s * 0.35, s * 0.03, 0.004]);
      const r = Math.max(0.018, s * 0.07);
      const shoulder: V3 = [-s * 0.15, s * 0.3, 0];
      const elbow: V3 = [s * 0.35, s * 0.55, 0];
      const wrist: V3 = [-s * 0.05, s * 0.95, 0];
      b.sphere(m.trim, shoulder, r * 1.3, 1, 12);
      b.pipe(p.paint, shoulder, elbow, r, 10);
      b.sphere(m.trim, elbow, r * 1.2, 1, 12);
      b.pipe(p.paint, elbow, wrist, r * 0.85, 10);
      b.sphere(m.trim, wrist, r, 1, 10);
      if (blk.science === 'interior') {
        b.sphere(p.mli, [wrist[0], wrist[1] + s * 0.12, 0], s * 0.18, [1, 0.6, 1], 16);
        b.torus(m.trim, [wrist[0], wrist[1] + s * 0.14, 0], s * 0.18, 0.01, { rot: RING_Y, seg: 20 });
      } else {
        b.cyl(m.machine, [wrist[0], wrist[1] + s * 0.08, 0], s * 0.08, s * 0.08, s * 0.16, { seg: 12 });
        b.lathe(m.steel, [[s * 0.06, 0], [s * 0.04, s * 0.15], [0.002, s * 0.24]], [wrist[0], wrist[1] + s * 0.16, 0], { seg: 12 });
      }
      break;
    }
    case 'analyzer': {
      b.box(m.wall, [0, 0.02 + s * 0.3, 0], [s * 0.85, s * 0.6, s * 0.7]);
      b.box(accent, [0, 0.02 + s * 0.3, s * 0.351], [s * 0.7, s * 0.03, 0.004]);
      b.lathe(m.trim, [[s * 0.05, s * 0.62], [s * 0.16, s * 0.78], [s * 0.17, s * 0.8]], [s * 0.15, 0, 0], { seg: 16 });
      for (const x of [-s * 0.3, -s * 0.15, 0]) b.cyl(m.machineDark, [x, s * 0.66, -s * 0.15], s * 0.05, s * 0.05, s * 0.08, { seg: 10 });
      b.box(m.dark, [-s * 0.2, s * 0.35, s * 0.352], [s * 0.3, s * 0.3, 0.006]);
      break;
    }
    case 'cup': {
      b.cyl(m.machine, [0, s * 0.25, 0], s * 0.24, s * 0.24, s * 0.4, { seg: 16 });
      b.box(accent, [0, s * 0.25, s * 0.242], [s * 0.2, s * 0.03, 0.004]);
      b.cyl(m.trim, [s * 0.3, s * 0.42, 0], s * 0.18, s * 0.15, s * 0.22, { rot: TO_POS_X, seg: 16, open: true });
      b.cyl(m.dark, [s * 0.22, s * 0.42, 0], s * 0.14, s * 0.14, 0.006, { rot: TO_POS_X, seg: 14 });
      b.sphere(p.paint, [-s * 0.1, s * 0.48, 0], s * 0.1, [1, 0.6, 1], 12);
      break;
    }
    default: {
      b.box(p.mli, [0, 0.02 + s * 0.2, 0], [s * 0.7, s * 0.4, s * 0.5], undefined, 2);
      b.box(accent, [0, 0.02 + s * 0.2, s * 0.251], [s * 0.5, s * 0.03, 0.004]);
      for (const z of [-s * 0.15, 0, s * 0.15]) b.cyl(m.trim, [0, s * 0.5, z], s * 0.065, s * 0.065, s * 0.85, { rot: TO_POS_X, seg: 12 });
    }
  }
}

const BUILDERS: Record<HangarBlock['shape'], (ctx: Ctx) => void> = {
  bus, engine, ion, wing, rtg, reactor, avionics, dish, whip, radiator, whipple, emitter, tank, pod, instrument,
};

/** Centro del cuerpo del bloque en su marco (origen en el anclaje, girado por `roll`). */
export const localCenter = (blk: HangarBlock): V3 => rotX(sub(blk.position, blk.anchor), -blk.roll);

const cache = new Map<string, ProbeModel>();
const q = (v: number): string => v.toFixed(3);

/** Modelo de un bloque (cacheado por forma, aspecto y medidas: dos alas iguales comparten geometría). */
export function probeModel(blk: HangarBlock): ProbeModel {
  const c = localCenter(blk);
  const key = [blk.shape, blk.look, blk.tier > 0.5 ? 1 : 0, blk.science ?? '', blk.shape === 'tank' || blk.shape === 'bus' ? blk.seed : 0, ...blk.size.map(q), ...c.map(q)].join('|');
  let model = cache.get(key);
  if (!model) {
    const b = new Builder();
    const glows: Glow3[] = [];
    (BUILDERS[blk.shape] ?? avionics)({ b, blk, c, s: blk.size, glows });
    model = { parts: b.build(), glows };
    cache.set(key, model);
  }
  return model;
}

// ─── Soportes que dependen del conjunto: banco, cercha, carro de giro y bastidor vacío ─────────────────────────

const supportCache = new Map<string, Part[]>();

function cached(key: string, make: (b: Builder) => void): Part[] {
  let parts = supportCache.get(key);
  if (!parts) {
    const b = new Builder();
    make(b);
    parts = b.build();
    supportCache.set(key, parts);
  }
  return parts;
}

/** Banco de instrumentos bajo la proa, con sus tirantes al bus. */
export function benchParts(layout: HangarLayout): Part[] | null {
  const bench = layout.bench;
  if (!bench) return null;
  const { lengthM, radiusM: R } = layout.bus;
  const H = lengthM / 2;
  return cached(`bench|${[bench.x0, bench.x1, bench.y, bench.width, H, R].map(q).join('|')}`, (b) => {
    const m = mats();
    const p = probeMats();
    const len = bench.x1 - bench.x0;
    const xc = (bench.x0 + bench.x1) / 2;
    b.box(m.machine, [xc, bench.y, 0], [len, 0.05, bench.width]);
    b.box(p.mliDark, [xc, bench.y - 0.027, 0], [len - 0.02, 0.006, bench.width - 0.02], undefined, 1.2);
    for (const sz of [-1, 1]) b.box(m.trim, [xc, bench.y, sz * (bench.width / 2 + 0.008)], [len, 0.06, 0.016]);
    b.box(m.trim, [bench.x1 + 0.008, bench.y, 0], [0.016, 0.06, bench.width + 0.03]);
    for (const sz of [-1, 1]) b.pipe(m.steel, [bench.x1 - 0.04, bench.y + 0.02, sz * bench.width * 0.42], [H + 0.01, -R * 0.45, sz * R * 0.35], 0.014, 6);
  });
}

/** Cercha cuadrada de los tanques tras la popa, con el anillo de la bancada del motor. */
export function trussParts(layout: HangarLayout): Part[] | null {
  const t = layout.truss;
  if (!t) return null;
  return cached(`truss|${[t.x0, t.x1, t.half].map(q).join('|')}`, (b) => {
    const m = mats();
    const h = t.half;
    const corners: [number, number][] = [[h, h], [h, -h], [-h, -h], [-h, h]];
    const len = t.x0 - t.x1;
    const bays = Math.max(1, Math.round(len / 0.6));
    for (const [y, z] of corners) b.pipe(m.trim, [t.x0, y, z], [t.x1, y, z], 0.022, 8);
    for (let i = 0; i <= bays; i++) {
      const x = t.x0 - (i * len) / bays;
      for (let k = 0; k < 4; k++) {
        const [y0, z0] = corners[k]!;
        const [y1, z1] = corners[(k + 1) % 4]!;
        b.pipe(m.steel, [x, y0, z0], [x, y1, z1], 0.014, 6);
        if (i < bays) {
          const xn = t.x0 - ((i + 1) * len) / bays;
          b.pipe(m.steel, [x, y0, z0], [xn, y1, z1], 0.009, 4);
        }
      }
    }
    // Bancada del motor al final (cruz y anillo) y unión con el adaptador.
    b.pipe(m.machine, [t.x1, h, h], [t.x1, -h, -h], 0.02, 6);
    b.pipe(m.machine, [t.x1, h, -h], [t.x1, -h, h], 0.02, 6);
    b.torus(m.trim, [t.x1, 0, 0], Math.min(0.32, h * 0.7), 0.024, { rot: RING_X, seg: 24 });
    for (const [y, z] of corners) b.pipe(m.steel, [t.x0, y * 0.6, z * 0.6], [t.x0 + 0.01, y, z], 0.014, 6);
  });
}

/**
 * Carro de giro que sujeta la nave por dos muñones en los costados de popa (como el de las salas limpias): columna
 * desde la plataforma, travesaño y horquilla. `floorY` = altura de la plataforma en el sistema de la nave.
 */
export function dollyParts(layout: HangarLayout, floorY: number): Part[] {
  const { lengthM, radiusM: R } = layout.bus;
  const H = lengthM / 2;
  return cached(`dolly|${[H, R, floorY].map(q).join('|')}`, (b) => {
    const m = mats();
    const xt = -H + 0.1;
    const zA = R + 0.18;
    const yC = -(R + 0.35);
    for (const sz of [-1, 1]) {
      b.box(m.orange, [xt, yC / 2, sz * zA], [0.09, -yC + 0.05, 0.09]);
      b.cyl(m.steel, [xt, 0, sz * (R + 0.09)], 0.04, 0.04, 0.2, { rot: [HALF_PI, 0, 0], seg: 12 });
      b.cyl(m.machineDark, [xt, 0, sz * (zA + 0.05)], 0.07, 0.07, 0.04, { rot: [HALF_PI, 0, 0], seg: 14 });
    }
    b.box(m.orange, [xt, yC, 0], [0.11, 0.11, 2 * zA + 0.09]);
    const colH = yC - floorY;
    b.box(m.orange, [xt, (yC + floorY) / 2, 0], [0.2, colH, 0.2]);
    b.box(m.hazard, [xt, floorY + 0.25, 0], [0.205, 0.3, 0.205]);
    b.box(m.machineDark, [xt, floorY + 0.04, 0], [0.9, 0.08, 0.7]);
    for (const sx of [-1, 1]) b.pipe(m.steel, [xt + sx * 0.4, floorY + 0.08, 0], [xt + sx * 0.06, floorY + colH * 0.4, 0], 0.025, 8);
  });
}
