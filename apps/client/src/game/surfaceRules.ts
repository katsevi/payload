/**
 * Superficie en el cliente (lógica PURA, sin Three.js): dónde se posa la nave respecto al tripulante,
 * qué escena se pinta, qué se puede hacer junto a una veta o a la rampa, hacia dónde queda la nave y
 * la guía del descenso. El motor manda en recursos y consecuencias; aquí solo se traduce.
 */
import { catalog as defaultCatalog, getSurfaceCatalog, referenceBrake, type Catalog, type Deposit, type RunPhase, type RunState, type StormStatus, type WorldDef } from '@payload/shared';
import type { Prompt } from '../state/ui';

// ─── Dónde está la nave ──────────────────────────────────────────────────────────────────────────

/**
 * El origen de la superficie (0, 0) es el pie de la rampa de la esclusa: ahí aparece el tripulante al
 * salir y ahí tiene que volver para entrar (`airlockRangeM` del motor). La nave queda a +X, con la
 * cubierta a `DECK_Y` m sobre el suelo (se puede pasar por debajo).
 *
 *   superficie = interior + SHIP_OFFSET
 */
export const DECK_Y = 2.6;
export const SHIP_OFFSET = { x: 10, y: DECK_Y, z: -2.4 } as const;
/** Centro de la nave en superficie y radio de la explanada de aterrizaje. */
export const SHIP_CENTER = { x: SHIP_OFFSET.x, z: SHIP_OFFSET.z } as const;
export const PAD_RADIUS_M = 20;
/** Al salir: al pie de la rampa, de espaldas a la nave (mirando a −X). */
export const EVA_START = { x: 0, z: 0, yaw: Math.PI / 2 } as const;
/** Al entrar: junto a la esclusa, por dentro, mirando a la cubierta (+X). */
export const AIRLOCK_INSIDE = { x: -3.5, z: 2.4, yaw: -Math.PI / 2 } as const;

export function toSurface(ix: number, iz: number): { x: number; z: number } {
  return { x: ix + SHIP_OFFSET.x, z: iz + SHIP_OFFSET.z };
}

// ─── Qué escena se pinta ─────────────────────────────────────────────────────────────────────────

export type SceneId = 'ship' | 'surface';

/**
 * Fuera (superficie) durante el descenso, unos segundos tras tocar tierra (`descentView`) y mientras el
 * tripulante está en EVA, también si muere ahí. Dentro, todo lo demás (también si la nave se pierde
 * en el descenso: la vista exterior no se queda viva bajo la pantalla final).
 */
export function sceneFor(phase: RunPhase | undefined, location: 'ship' | 'eva' | undefined, descentView: boolean): SceneId {
  if (phase === 'landing') return 'surface';
  if ((phase === 'surface' || phase === 'lost') && location === 'eva') return 'surface';
  if (descentView && phase === 'surface') return 'surface';
  return 'ship';
}

// ─── Interacción en la superficie ────────────────────────────────────────────────────────────────

/** Segundos manteniendo E al pie de la rampa para entrar. */
export const ENTER_HOLD_S = 0.6;

export type SurfaceInteraction =
  | { kind: 'collect'; deposit: Deposit; full: boolean }
  | { kind: 'enter'; carriedKg: number };

export function surfaceRulesOf(cat: Catalog = defaultCatalog) {
  return getSurfaceCatalog(cat).rules;
}

/** La veta con unidades más cercana dentro del alcance, o la rampa si está a mano. */
export function surfaceInteractionAt(state: RunState, x: number, z: number, cat: Catalog = defaultCatalog): SurfaceInteraction | null {
  const m = state.crew.find((c) => c.alive);
  if (state.phase !== 'surface' || !state.surface || !m || m.location !== 'eva') return null;
  const surface = getSurfaceCatalog(cat);
  const suit = surface.rules.suit;
  let best: Deposit | null = null;
  let bestD = suit.collectRangeM;
  for (const d of state.surface.deposits) {
    if (d.units <= 0) continue;
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist <= bestD) {
      best = d;
      bestD = dist;
    }
  }
  if (best) {
    const mass = surface.materials.find((mat) => mat.id === best.materialId)?.massKg ?? 0;
    return { kind: 'collect', deposit: best, full: m.carriedKg + mass > suit.carryCapacityKg + 1e-9 };
  }
  if (Math.hypot(x, z) <= suit.airlockRangeM) return { kind: 'enter', carriedKg: m.carriedKg };
  return null;
}

/** `airborne`: recoger exige pies en el suelo (`reject.collectAirborne`): en el aire se ve bloqueado. */
export function surfacePromptFor(i: SurfaceInteraction | null, enterProgress = 0, airborne = false): Prompt | null {
  if (!i) return null;
  if (i.kind === 'enter') return { key: i.carriedKg > 0 ? 'prompt.enterCargo' : 'prompt.enter', params: { kg: Math.round(i.carriedKg) }, hold: true, progress: Math.min(1, enterProgress) };
  if (i.full) return { key: 'prompt.full', params: { material: i.deposit.materialId }, hold: true, progress: 0, blocked: true };
  if (airborne) return { key: 'prompt.collectAirborne', params: { material: i.deposit.materialId }, hold: true, progress: Math.min(1, i.deposit.progress), blocked: true };
  return { key: 'prompt.collect', params: { material: i.deposit.materialId, value: i.deposit.valuePerUnit, units: i.deposit.units }, hold: true, progress: Math.min(1, i.deposit.progress) };
}

// ─── Hacia dónde queda la nave ───────────────────────────────────────────────────────────────────

/**
 * Distancia a la rampa y ángulo respecto a la mirada (rad; 0 = de frente, + = a la derecha). La vista
 * mira a (−sen yaw, −cos yaw) y su derecha es (cos yaw, −sen yaw), como en `PlayerController`.
 */
export function shipBearing(x: number, z: number, yaw: number): { distanceM: number; angle: number } {
  const tx = -x;
  const tz = -z;
  const fwd = -Math.sin(yaw) * tx - Math.cos(yaw) * tz;
  const right = Math.cos(yaw) * tx - Math.sin(yaw) * tz;
  return { distanceM: Math.hypot(x, z), angle: Math.atan2(right, fwd) };
}

// ─── Guía del descenso ───────────────────────────────────────────────────────────────────────────

/**
 * Velocidad a partir de la cual el perfil de referencia del motor ya frenaría a esta altitud (la marca
 * de «frena» en la barra de velocidad). Se busca sobre `referenceBrake`, sin duplicar su fórmula.
 */
export function brakeThresholdMps(world: WorldDef, altitudeM: number, cat: Catalog = defaultCatalog): number {
  const rules = getSurfaceCatalog(cat).rules;
  if (referenceBrake(world, rules, altitudeM, 0)) return 0;
  let lo = 0;
  let hi = 200;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (referenceBrake(world, rules, altitudeM, mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// ─── Oxígeno: lo que se oye ──────────────────────────────────────────────────────────────────────

/** Segundos entre respiraciones: calmada arriba del umbral bajo, cada vez más rápida por debajo. */
export function breathIntervalS(o2Pct: number, lowPct: number): number {
  if (o2Pct >= lowPct) return 3.4;
  const k = Math.max(0, o2Pct) / lowPct;
  return 0.9 + 1.6 * k;
}

/** Segundos entre pitidos de O₂ crítico (null = sin pitido). */
export function o2BeepIntervalS(o2Pct: number, criticalPct: number): number | null {
  if (o2Pct >= criticalPct || o2Pct <= 0) return null;
  return 0.45 + 0.9 * (o2Pct / criticalPct);
}

// ─── Tormenta: lo que se ve ──────────────────────────────────────────────────────────────────────

/**
 * Cuánto se nota la tormenta: `warn` sube de 0 a 1 durante el aviso (el horizonte se oscurece y el
 * viento crece) y `active` es la intensidad mientras dura.
 */
export function stormLevel(storm: StormStatus | undefined, warnS: number): { warn: number; active: number } {
  if (!storm) return { warn: 0, active: 0 };
  if (storm.active) return { warn: 1, active: storm.intensity };
  if (storm.warned && storm.nextInS !== null && warnS > 0) return { warn: Math.min(1, Math.max(0, 1 - storm.nextInS / warnS)), active: 0 };
  return { warn: 0, active: 0 };
}

/** Empuje lateral de la tormenta en plena intensidad (m/s; corriendo se va a ~5,5). */
export const STORM_WIND_MPS = 3;

// ─── Caída: aviso antes del golpe ────────────────────────────────────────────────────────────────

/**
 * Velocidad con la que se llegará al suelo desde `heightM` m bajando a `vy` m/s (+ arriba) con una
 * aceleración neta hacia abajo `downAccelMps2` (la gravedad, o la gravedad menos el freno del jetpack).
 * 0 si con esa aceleración no se llega a golpear (el freno para antes).
 */
export function predictedImpactMps(vy: number, heightM: number, downAccelMps2: number): number {
  const h = Math.max(0, heightM);
  const v2 = vy * vy + 2 * downAccelMps2 * h;
  if (vy >= 0 && downAccelMps2 <= 0) return 0;
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

/** Aviso de caída peligrosa: bajando y, tal como va, el golpe pasará del umbral inofensivo. */
export function fallDanger(vy: number, heightM: number, downAccelMps2: number, harmlessMps: number): boolean {
  return vy < 0 && predictedImpactMps(vy, heightM, downAccelMps2) > harmlessMps;
}

// ─── Oxígeno frente a distancia ──────────────────────────────────────────────────────────────────

/** Margen sobre el O₂ que cuesta volver andando a partir del cual la brújula avisa. */
export const O2_RETURN_MARGIN = 1.5;

/** O₂ (%) que cuesta volver andando en línea recta desde `distanceM` hasta la rampa. */
export function o2ToReturnPct(distanceM: number, drainPctPerS: number, walkMps: number): number {
  return (Math.max(0, distanceM) / Math.max(0.1, walkMps)) * drainPctPerS;
}

/** El O₂ que queda ya no da con holgura (× `O2_RETURN_MARGIN`) para volver andando. */
export function o2ReturnShort(o2Pct: number, distanceM: number, drainPctPerS: number, walkMps: number, margin = O2_RETURN_MARGIN): boolean {
  return o2Pct < margin * o2ToReturnPct(distanceM, drainPctPerS, walkMps);
}
