/**
 * Escala del mapa 3D del sistema solar (fase 4). PURO: sin Three.js; la escena solo coloca lo que sale de aquí.
 *
 * Decisión de escala (documentada en `apps/client/CLAUDE.md`):
 * - **Distancias al Sol en raíz cuadrada:** radio en escena = `AU_SCENE × √UA`. La Tierra queda a 10, Marte a ~12,
 *   el cinturón a ~16 y Saturno a ~31: todo cabe en una vista sin que lo interior se apelotone (en lineal Saturno
 *   estaría a 95 y Marte casi encima de la Tierra; en logaritmo los gigantes quedaban demasiado juntos). Se
 *   conserva el ángulo de cada cuerpo (la posición la da el motor, `bodyPositionAu`): solo se comprime el radio.
 * - **Lunas y estaciones** se colocan junto a su planeta, en la dirección que da el motor, a `MOON_MIN + MOON_K × √ΔUA`
 *   de él (y nunca dentro de su globo): ordenadas por distancia real y legibles.
 * - **Tamaños** comprimidos con `radioKm^0,35`: Júpiter se ve mayor que la Tierra y un asteroide sigue siendo
 *   clicable; el Sol tiene tamaño propio.
 * - **Puntos de paso** (sin cuerpo): entre la salida y la llegada del tramo según su columna, como el motor, pero en
 *   espacio de escena (si salida y llegada coinciden, p. ej. la vuelta por la zona terrestre, en un bucle).
 */
import { bodyPositionAu, catalog as defaultCatalog, findBody, getSolarSystem, type Catalog, type SectorMap, type SolarBodyDef } from '@payload/shared';

/** Unidades de escena por √UA. */
export const AU_SCENE = 10;
export const SUN_RADIUS = 2;
export const MOON_MIN = 0.9;
export const MOON_K = 3;
const SIZE_K = 0.0242;
const SIZE_EXP = 0.35;
export const BODY_MIN_RADIUS = 0.12;
export const BODY_MAX_RADIUS = 1.3;
/** Si la salida y la llegada del tramo están más cerca que esto, los puntos de paso forman un bucle. */
const LOOP_MIN = 1.5;
const LOOP_R = 2.6;

export interface ScenePos {
  x: number;
  z: number;
}

/** Radio en escena de una órbita alrededor del Sol. */
export function orbitRadius(au: number): number {
  return AU_SCENE * Math.sqrt(Math.max(0, au));
}

/** Posición del plano de la eclíptica (UA) → escena, comprimiendo solo el radio. */
export function compressAu(p: { x: number; y: number }): ScenePos {
  const r = Math.hypot(p.x, p.y);
  if (r < 1e-9) return { x: 0, z: 0 };
  const k = orbitRadius(r) / r;
  return { x: p.x * k, z: p.y * k };
}

/** Separación en escena de una luna o estación respecto a su planeta (ΔUA = distancia que da el motor). */
export function moonOffset(deltaAu: number): number {
  return MOON_MIN + MOON_K * Math.sqrt(Math.max(0, deltaAu));
}

/** Radio en escena de un cuerpo (el Sol aparte). */
export function bodyDisplayRadius(body: Pick<SolarBodyDef, 'radiusKm' | 'type'>): number {
  if (body.type === 'star') return SUN_RADIUS;
  return Math.max(BODY_MIN_RADIUS, Math.min(BODY_MAX_RADIUS, SIZE_K * Math.max(0, body.radiusKm) ** SIZE_EXP));
}

/** Posición en escena de un cuerpo del catálogo `days` días después del instante 0. */
export function bodyScenePos(body: SolarBodyDef, cat: Catalog = defaultCatalog, days = 0): ScenePos {
  const parent = body.parentId ? findBody(body.parentId, cat) : undefined;
  if (parent && body.orbitAu === undefined) {
    const p = bodyPositionAu(parent, cat, days);
    const c = bodyPositionAu(body, cat, days);
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const d = Math.hypot(dx, dy);
    const at = bodyScenePos(parent, cat, days);
    const off = Math.max(moonOffset(d), bodyDisplayRadius(parent) + bodyDisplayRadius(body) + 0.25);
    const ux = d > 1e-12 ? dx / d : 1;
    const uz = d > 1e-12 ? dy / d : 0;
    return { x: at.x + ux * off, z: at.z + uz * off };
  }
  return compressAu(bodyPositionAu(body, cat, days));
}

/** Posición en escena de cada nodo de un sector del sistema solar (vacío si el sector no es del sistema solar). */
export function sectorScenePositions(sector: SectorMap, cat: Catalog = defaultCatalog, days = 0): Record<string, ScenePos> {
  const out: Record<string, ScenePos> = {};
  const start = sector.nodes.find((n) => n.id === sector.startId);
  const goal = sector.nodes.find((n) => n.id === sector.goalId);
  const startBody = start?.bodyId ? findBody(start.bodyId, cat) : undefined;
  const goalBody = goal?.bodyId ? findBody(goal.bodyId, cat) : undefined;
  if (!start || !goal || !startBody || !goalBody) return out;
  const a = bodyScenePos(startBody, cat, days);
  const b = bodyScenePos(goalBody, cat, days);
  const span = Math.max(1, goal.x - start.x);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const loop = len < LOOP_MIN;
  // Bucle: centro hacia fuera del Sol desde la salida; se recorre una vuelta entera de la salida a la llegada.
  const outR = Math.hypot(a.x, a.z) || 1;
  const cx = a.x + (a.x / outR) * LOOP_R;
  const cz = a.z + (a.z / outR) * LOOP_R;
  const nx = loop ? 0 : -(b.z - a.z) / len;
  const nz = loop ? 0 : (b.x - a.x) / len;
  const lateral = loop ? (2 * Math.PI * LOOP_R) / span / 2 : len / span / 2;
  for (const n of sector.nodes) {
    const body = n.bodyId ? findBody(n.bodyId, cat) : undefined;
    if (body) {
      out[n.id] = bodyScenePos(body, cat, days);
      continue;
    }
    const t = Math.max(0, Math.min(1, (n.x - start.x) / span));
    if (loop) {
      const ang = Math.atan2(a.z - cz, a.x - cx) + 2 * Math.PI * t;
      const r = LOOP_R + n.y * lateral * 0.5;
      out[n.id] = { x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r };
    } else {
      out[n.id] = { x: a.x + (b.x - a.x) * t + nx * n.y * lateral, z: a.z + (b.z - a.z) * t + nz * n.y * lateral };
    }
  }
  return out;
}

/**
 * Dirección (unitaria) desde un punto de la escena hacia el Sol, algo elevada para que el terminador no quede de
 * canto en la vista cenital. La usan los planetas y los anillos del mapa (no la dirección fija de la vista de la nave).
 */
export const SUN_LIFT = 0.12;
export function sunDirectionFrom(at: ScenePos): { x: number; y: number; z: number } {
  const len = Math.hypot(at.x, SUN_LIFT, at.z);
  return { x: -at.x / len, y: SUN_LIFT / len, z: -at.z / len };
}

/** Cuerpos que orbitan el Sol directamente (los que llevan órbita dibujada). */
export function sunOrbiters(cat: Catalog = defaultCatalog): SolarBodyDef[] {
  return getSolarSystem(cat).bodies.filter((b) => b.type !== 'star' && !b.parentId && (b.orbitAu ?? 0) > 0);
}

/**
 * Anillo del cinturón (para las rocas instanciadas): las zonas sin planetas ni gigantes, entre la menor y la mayor
 * órbita de sus cuerpos (con algo de holgura). Null si el catálogo no tiene ninguna.
 */
export function beltRange(cat: Catalog = defaultCatalog): { inner: number; outer: number } | null {
  const sys = getSolarSystem(cat);
  let lo = Infinity;
  let hi = -Infinity;
  for (const z of sys.zones) {
    const bodies = sys.bodies.filter((b) => b.zoneId === z.id && !b.parentId && (b.orbitAu ?? 0) > 0);
    if (bodies.length === 0 || bodies.some((b) => b.type === 'planet')) continue;
    for (const b of bodies) {
      lo = Math.min(lo, b.orbitAu ?? lo);
      hi = Math.max(hi, b.orbitAu ?? hi);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { inner: orbitRadius(lo * 0.9), outer: orbitRadius(hi * 1.12) };
}

/** Caja que encierra unas posiciones (para encuadrar la cámara). */
export function boundsOf(points: readonly ScenePos[]): { cx: number; cz: number; radius: number } {
  if (points.length === 0) return { cx: 0, cz: 0, radius: AU_SCENE };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, radius: Math.max(2, Math.hypot(maxX - minX, maxZ - minZ) / 2) };
}
