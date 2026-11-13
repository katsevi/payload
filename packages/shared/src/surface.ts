/**
 * Superficie (fase 2): funciones puras que no dependen de la partida en curso.
 *
 * - Qué mundo tiene cada nodo aterrizable: se elige con `deriveSeed` (semilla de la partida + índice
 *   de sector + índice del nodo), SIN tocar el rng del generador de sectores.
 * - Generación del mundo al aterrizar (tormentas, terreno inestable, vetas) con su propio flujo de azar
 *   y un número fijo de tiradas por elemento.
 * - Fórmulas compartidas con el cliente: combustible de despegue y descenso con el perfil de referencia.
 *
 * El motor NO simula terreno ni colisiones: el cliente informa de la posición y de las caídas.
 */
import { getSurfaceCatalog } from './catalog';
import { getNode } from './galaxy';
import { createRng, deriveSeed, type Rng } from './rng';
import type { Catalog, CrewMember, Deposit, LodeProgress, PlannedStorm, SectorMap, SurfaceRules, SurfaceState, UnstableZone, WorldDef } from './types';

const WORLD_SALT = 0x3b0d;
const SURFACE_SALT = 0x5f1a;
/** Flujo de los filones (derivado de la semilla del mundo; no altera las tiradas de las vetas). */
const LODE_SALT = 0x10de;
/** Flujo de las tiradas del aterrizaje brusco (derivado de la semilla del mundo). */
export const LANDING_SALT = 0x1a4d;
/** Tormentas pre-sorteadas por mundo (suficientes para cualquier estancia razonable). */
const MAX_STORMS = 8;
/** Paso de integración del descenso de referencia (igual que el de la partida). */
const DESCENT_STEP_S = 0.1;
/** Margen del perfil de frenado de referencia si el catálogo no da `descent.referenceMargin`. */
export const REFERENCE_BRAKE_MARGIN = 0.6;

const round1 = (n: number): number => Math.round(n * 10) / 10;

function nodeIndex(sector: SectorMap, nodeId: string): number {
  return sector.nodes.findIndex((n) => n.id === nodeId);
}

function worldSeed(seed: number, sector: SectorMap, nodeId: string): number {
  return deriveSeed(deriveSeed(seed, SURFACE_SALT + sector.index), nodeIndex(sector, nodeId));
}

/** Mundo de un nodo (null si no es aterrizable o el catálogo no tiene mundos de su tipo). */
export function getNodeWorld(seed: number, sector: SectorMap, nodeId: string, cat: Catalog): WorldDef | null {
  const node = getNode(sector, nodeId);
  if (!node) return null;
  const kind = cat.nodeKinds.find((k) => k.id === node.kind);
  if (!kind?.landable) return null;
  const options = getSurfaceCatalog(cat).worlds.filter((w) => w.kind === node.kind);
  if (options.length === 0) return null;
  const rng = createRng(deriveSeed(deriveSeed(Math.trunc(seed) >>> 0, WORLD_SALT + sector.index), nodeIndex(sector, nodeId)));
  const total = options.reduce((s, w) => s + w.weight, 0);
  let roll = rng.next() * total;
  for (const w of options) {
    roll -= w.weight;
    if (roll < 0) return w;
  }
  return options[options.length - 1]!;
}

/** Combustible del despegue con `loadedKg` cargados en este mundo. */
export function takeOffFuel(world: WorldDef, rules: SurfaceRules, loadedKg: number): number {
  const t = rules.takeOff;
  return (t.baseFuel + t.fuelPerMps2 * world.gravityMps2) * (1 + Math.max(0, loadedKg) / t.massRefKg);
}

/**
 * Perfil de frenado de referencia: frenar cuando la velocidad supera la que aún se puede quitar antes
 * del suelo (con margen). Sirve para estimar el descenso y como guía para el cliente.
 */
export function referenceBrake(
  world: WorldDef,
  rules: SurfaceRules,
  altitudeM: number,
  speedMps: number,
  margin = world.descent.referenceMargin ?? rules.descent.referenceMargin ?? REFERENCE_BRAKE_MARGIN,
): boolean {
  const net = rules.descent.brakeThrustMps2 - world.gravityMps2;
  if (net <= 0) return true;
  const touchdown = rules.descent.safeSpeedMps * 0.8;
  // Anticipa un paso de caída libre (con gravedad alta, un paso sin freno ya pasa de la velocidad segura).
  const next = speedMps + world.gravityMps2 * DESCENT_STEP_S;
  return next > Math.sqrt(touchdown * touchdown + margin * margin * 2 * net * Math.max(0, altitudeM));
}

/**
 * Avance de cada filón (de 2+ vetas) para un tripulante en la salida en curso: vetas totales, agotadas por él
 * y si la que queda daría el bonus de filón completo. Puro: sirve igual al cliente que al motor.
 */
export function lodeProgress(deposits: readonly Deposit[], member: Pick<CrewMember, 'lodeVeinsDone'>): LodeProgress[] {
  const byLode = new Map<number, Deposit[]>();
  for (const d of deposits) if (d.lodeId !== undefined) byLode.set(d.lodeId, [...(byLode.get(d.lodeId) ?? []), d]);
  const out: LodeProgress[] = [];
  for (const [lodeId, veins] of byLode) {
    if (veins.length < 2) continue;
    const done = veins.filter((v) => member.lodeVeinsDone.includes(v.id)).length;
    out.push({ lodeId, total: veins.length, done, bonusReady: done === veins.length - 1 });
  }
  return out.sort((a, b) => a.lodeId - b.lodeId);
}

/** ¿Las unidades de esta veta llevan el bonus de filón completo para este tripulante? */
export function lodeBonusApplies(deposits: readonly Deposit[], deposit: Deposit, member: Pick<CrewMember, 'lodeVeinsDone'>): boolean {
  if (deposit.lodeId === undefined) return false;
  const others = deposits.filter((d) => d.lodeId === deposit.lodeId && d.id !== deposit.id);
  return others.length > 0 && others.every((d) => member.lodeVeinsDone.includes(d.id));
}

/** Multiplicador de racha para la próxima unidad rara cuando ya se llevan `streakUnits` raras encima. */
export function streakMultiplier(rules: SurfaceRules, streakUnits: number): number {
  return 1 + Math.min(rules.streak.maxBonus, rules.streak.bonusPerUnit * Math.max(0, streakUnits));
}

/**
 * Salida por la esclusa: el ciclo cuesta `airlockCycleShipO2Pct` y lo que falta hasta 100 % del traje se
 * cobra del O₂ de la nave (`refillShipO2PctPerTank` por tanque entero), sin bajarla nunca de
 * `refillMinShipO2Pct`. Si no alcanza, se rellena lo que haya. `shipO2Cost` lo incluye todo.
 */
export function suitRefill(rules: SurfaceRules, suitO2Pct: number, shipO2Pct: number): { suitO2Pct: number; shipO2Cost: number } {
  const want = Math.max(0, 100 - suitO2Pct);
  let available = Math.max(0, shipO2Pct - rules.suit.refillMinShipO2Pct);
  const cycle = Math.min(available, rules.suit.airlockCycleShipO2Pct ?? 0);
  available -= cycle;
  const perPct = rules.suit.refillShipO2PctPerTank / 100;
  if (perPct <= 0) return { suitO2Pct: suitO2Pct + want, shipO2Cost: cycle };
  const fill = Math.min(want, available / perPct);
  return { suitO2Pct: Math.min(100, suitO2Pct + fill), shipO2Cost: cycle + fill * perPct };
}

export interface DescentResult {
  timeS: number;
  fuel: number;
  touchdownSpeedMps: number;
}

/** Un paso del descenso (lo usa la partida y la estimación, para que coincidan). */
export function descentStep(world: WorldDef, rules: SurfaceRules, d: { altitudeM: number; speedMps: number }, braking: boolean, dt: number): void {
  const a = world.gravityMps2 - (braking ? rules.descent.brakeThrustMps2 : 0);
  d.speedMps += a * dt;
  if (braking) d.speedMps = Math.max(rules.descent.minSpeedMps, d.speedMps);
  d.altitudeM -= d.speedMps * dt;
}

/** Simula el descenso completo con una política de freno (por defecto, la de referencia). */
export function simulateDescent(
  world: WorldDef,
  rules: SurfaceRules,
  brake: (altitudeM: number, speedMps: number) => boolean = (alt, v) => referenceBrake(world, rules, alt, v),
): DescentResult {
  const d = { altitudeM: world.descent.altitudeM, speedMps: world.descent.speedMps };
  let timeS = 0;
  let fuel = 0;
  while (d.altitudeM > 0 && timeS < 900) {
    const braking = brake(d.altitudeM, d.speedMps);
    if (braking) fuel += rules.descent.brakeFuelPerS * DESCENT_STEP_S;
    descentStep(world, rules, d, braking, DESCENT_STEP_S);
    timeS += DESCENT_STEP_S;
  }
  return { timeS: round1(timeS), fuel, touchdownSpeedMps: d.speedMps };
}

function exp(rng: Rng, mean: number): number {
  return -Math.log(1 - rng.next()) * mean;
}

const between = (rng: Rng, r: { min: number; max: number }): number => r.min + rng.next() * (r.max - r.min);

/** Genera el mundo del nodo al empezar el descenso. Determinista y con tiradas fijas por elemento. */
export function generateSurface(seed: number, sector: SectorMap, nodeId: string, cat: Catalog): SurfaceState | null {
  const world = getNodeWorld(seed, sector, nodeId, cat);
  if (!world) return null;
  const surface = getSurfaceCatalog(cat);
  const rules = surface.rules;
  const rng = createRng(worldSeed(Math.trunc(seed) >>> 0, sector, nodeId));
  const R = world.radiusM;

  // Terreno inestable (4 tiradas por zona)
  const zones: UnstableZone[] = [];
  const zoneCount = rng.int(world.unstable.zones.min, world.unstable.zones.max);
  for (let i = 0; i < zoneCount; i++) {
    const angle = rng.next() * Math.PI * 2;
    const frac = 0.3 + 0.62 * rng.next();
    const radiusM = round1(between(rng, world.unstable.radiusM));
    rng.next(); // reservada
    zones.push({ id: i + 1, x: round1(Math.cos(angle) * frac * R), z: round1(Math.sin(angle) * frac * R), radiusM, crackingS: 0, collapsed: false, pressed: false });
  }

  // Vetas (5 tiradas por veta). Las primeras caen dentro de cada zona inestable: el peligro paga.
  const deposits: Deposit[] = [];
  const count = rng.int(world.deposits.min, world.deposits.max);
  for (let i = 0; i < count; i++) {
    const a = rng.next();
    const b = rng.next();
    const pickRoll = rng.next();
    const unitsRoll = rng.next();
    rng.next(); // reservada
    const zone = i < zones.length ? zones[i]! : null;
    let x: number;
    let z: number;
    if (zone) {
      // Bien dentro: ni con el alcance de recogida se llega desde suelo firme (hay que pisar la zona).
      const inner = Math.max(0, Math.min(zone.radiusM * 0.3, zone.radiusM - rules.suit.collectRangeM - 0.1)) * b;
      x = zone.x + Math.cos(a * Math.PI * 2) * inner;
      z = zone.z + Math.sin(a * Math.PI * 2) * inner;
    } else {
      const dist = R * (0.08 + 0.87 * b);
      x = Math.cos(a * Math.PI * 2) * dist;
      z = Math.sin(a * Math.PI * 2) * dist;
    }
    const frac = Math.min(1, Math.hypot(x, z) / R);
    const risky = zones.some((zn) => Math.hypot(zn.x - x, zn.z - z) <= zn.radiusM + rules.value.dangerMarginM);
    const eligible = world.materials.filter((m) => frac >= m.minDistanceFrac);
    const pool = eligible.length > 0 ? eligible : [world.materials.reduce((lo, m) => (m.minDistanceFrac < lo.minDistanceFrac ? m : lo))];
    const weights = pool.map((m) => m.weight * (risky ? m.dangerWeightMult : 1));
    let roll = pickRoll * weights.reduce((s, w) => s + w, 0);
    let pick = pool[pool.length - 1]!;
    for (let k = 0; k < pool.length; k++) {
      roll -= weights[k]!;
      if (roll < 0) {
        pick = pool[k]!;
        break;
      }
    }
    const material = surface.materials.find((m) => m.id === pick.materialId)!;
    const units = pick.units.min + Math.floor(unitsRoll * (pick.units.max - pick.units.min + 1));
    const valuePerUnit = Math.round(material.value * (1 + rules.value.distanceBonus * frac) * (risky ? 1 + rules.value.dangerBonus : 1));
    deposits.push({ id: i + 1, materialId: material.id, x: round1(x), z: round1(z), units, valuePerUnit, progress: 0, risky });
  }

  // Filones (flujo propio, 3 tiradas por veta rara fuera de zonas): lo raro se agrupa a pocos metros de la
  // primera veta del filón, para que dos taladros trabajen juntos y la racha se haga en un mismo sitio.
  const lodes = rules.lodes;
  if (lodes) {
    const lrng = createRng(deriveSeed(worldSeed(Math.trunc(seed) >>> 0, sector, nodeId), LODE_SALT));
    let anchor: Deposit | null = null;
    let left = 0;
    let lodeSeq = 0;
    let angle = 0;
    for (let i = zones.length; i < deposits.length; i++) {
      const d = deposits[i]!;
      const material = surface.materials.find((m) => m.id === d.materialId)!;
      if (!material.streak) continue;
      const sizeRoll = lrng.next();
      const angleRoll = lrng.next();
      const distRoll = lrng.next();
      if (!anchor || left <= 0) {
        anchor = d;
        left = lodes.size.min + Math.floor(sizeRoll * (lodes.size.max - lodes.size.min + 1)) - 1;
        d.lodeId = ++lodeSeq;
        angle = angleRoll * Math.PI * 2;
        continue;
      }
      // Cada nueva veta del filón, en otra dirección desde la primera (no se amontonan).
      angle += Math.PI * (0.6 + 0.8 * angleRoll);
      const dist = lodes.spacingM.min + distRoll * (lodes.spacingM.max - lodes.spacingM.min);
      let x = anchor.x + Math.cos(angle) * dist;
      let z = anchor.z + Math.sin(angle) * dist;
      const r = Math.hypot(x, z);
      if (r > R * 0.97) {
        x *= (R * 0.97) / r;
        z *= (R * 0.97) / r;
      }
      const frac = Math.min(1, Math.hypot(x, z) / R);
      const risky = zones.some((zn) => Math.hypot(zn.x - x, zn.z - z) <= zn.radiusM + rules.value.dangerMarginM);
      Object.assign(d, {
        x: round1(x),
        z: round1(z),
        risky,
        lodeId: anchor.lodeId,
        valuePerUnit: Math.round(material.value * (1 + rules.value.distanceBonus * frac) * (risky ? 1 + rules.value.dangerBonus : 1)),
      });
      left--;
    }
  }

  // Tormentas (3 tiradas por tormenta, haya o no)
  const storms: PlannedStorm[] = [];
  if (world.storms) {
    const def = world.storms;
    let t = 0;
    for (let i = 0; i < MAX_STORMS; i++) {
      const gap = exp(rng, def.meanIntervalS);
      const duration = between(rng, def.durationS);
      const intensity = between(rng, def.intensity);
      // La primera nunca antes de `firstStartMinS` (calma asegurada para la primera salida).
      const startS = round1(Math.max(t + def.warnS + gap, i === 0 ? def.firstStartMinS ?? 0 : 0));
      const endS = round1(startS + duration);
      storms.push({ startS, endS, intensity: Math.round(intensity * 100) / 100 });
      t = endS;
    }
  }

  return {
    nodeId,
    worldId: world.id,
    gravityMps2: world.gravityMps2,
    radiusM: R,
    descent: { altitudeM: world.descent.altitudeM, speedMps: world.descent.speedMps, brake: false, brakeS: 0, fuelUsed: 0 },
    touchdownSpeedMps: null,
    hardLanding: false,
    elapsedS: 0,
    storms,
    storm: { active: false, intensity: 0, nextInS: storms[0] ? storms[0].startS : null, endsInS: null, warned: false },
    stormCursor: 0,
    zones,
    deposits,
    tools: [],
    toolsLost: {},
    loaded: {},
    loadedKg: 0,
    loadedValue: 0,
  };
}

/** Semilla de las tiradas del aterrizaje brusco (pura: depende solo del nodo). */
export function landingSeed(seed: number, sector: SectorMap, nodeId: string): number {
  return deriveSeed(worldSeed(Math.trunc(seed) >>> 0, sector, nodeId), LANDING_SALT);
}
