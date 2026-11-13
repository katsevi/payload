/**
 * Simulación de una partida (run): la nave salta de destino en destino por un sector mientras la
 * tripulación mantiene vivos el casco, el oxígeno, el combustible y la energía.
 *
 * - Tiempo real con PASO FIJO (`FIXED_STEP_S`): `step(dt)` acumula y ejecuta los pasos que quepan,
 *   así que el resultado no depende de cómo se trocee el tiempo (misma semilla + mismas acciones en
 *   los mismos instantes = misma partida). Es lo que permitirá correrla en el servidor (fase 4).
 * - Todo el azar pasa por `createRng`: los peligros de cada salto se pre-sortean al iniciarlo
 *   (posición en el trayecto) y el desgaste usa un flujo propio derivado con `deriveSeed`.
 * - Permadeath: casco a 0, oxígeno a 0 o quedarse varado terminan la partida (`phase: 'lost'`).
 *
 * Compromisos que modela (ver docs/GDD.md):
 *   régimen de motores  → tiempo ↔ combustible ↔ potencia ↔ desgaste ↔ margen de reacción
 *   reparto de energía  → escudos ↔ sensores ↔ motores ↔ soporte vital (la sobrecarga daña el reactor)
 *   ruta                → distancia/combustible ↔ peligro ↔ botín ↔ estaciones
 *   repuestos           → qué sistema reparar ahora y cuál aguanta dañado
 */
import { catalog as defaultCatalog, getMaterial, getNodeKind, getShip, getSurfaceCatalog, getThrottle, getWorld } from './catalog';
import { generateSector, getNode, nodeDistanceLy } from './galaxy';
import { createRng, deriveSeed, type Rng } from './rng';
import { descentStep, generateSurface, getNodeWorld, landingSeed, lodeBonusApplies, simulateDescent, streakMultiplier, suitRefill, takeOffFuel } from './surface';
import {
  HAZARD_KINDS, INCIDENT_KINDS, SYSTEM_IDS, THROTTLE_IDS,
  type ActionResult, type Catalog, type CrewMember, type EventTone, type HazardKind, type Incident, type IncidentKind, type JumpEstimate,
  type LandingEstimate, type MessageRef, type PlannedHazard, type PoweredSystemId, type Run, type RunAction, type RunEvent, type RunEventType,
  type RunOptions, type RunState, type RunStats, type ShipDef, type ShipState, type SurfaceState, type SystemId, type SystemState,
  type HazardRules, type PlacedTool, type TakeOffEstimate, type ThrottleId,
} from './types';

/** Paso fijo de la simulación (10 Hz). */
export const FIXED_STEP_S = 0.1;
/** Máximo de segundos de trabajo que acepta una sola acción (una tecla mantenida envía ~1 frame). */
export const MAX_WORK_SECONDS = 0.5;
/** Con motores a salud 0 la nave no se mueve; por encima, la velocidad va de este factor a 1. */
const MIN_ENGINE_SPEED_FACTOR = 0.4;
const HAZARD_SALT = 0x4a2d;
const WEAR_SALT = 0x77ea;
const EVADE_SALT = 0x3e7a;
const MAX_HAZARDS_PER_KIND = 12;
const ALERT_HYSTERESIS_PCT = 5;
const POWERED: readonly PoweredSystemId[] = ['engines', 'lifeSupport', 'shields', 'nav'];
const RISK_WEIGHT: Record<HazardKind, number> = { impact: 1, short: 0.7, fire: 1, leak: 0.8 };
const RISK_THRESHOLDS = [0.8, 1.8, 3];
/** Antitrampas: `set-position` acumula como mucho este tiempo de movimiento sin informar. */
const MOVE_BUDGET_CAP_S = 1;
const MAX_FALL_MPS = 200;
const MAX_CREW = 4;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const reject = (key: string, params?: MessageRef['params']): ActionResult => ({ ok: false, reason: params ? { key, params } : { key } });
const OK: ActionResult = { ok: true };

function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > limit && k <= MAX_HAZARDS_PER_KIND);
  return k - 1;
}

/**
 * Fracción del daño de un impacto que entra tras una esquiva con `grazes` roces (0 = limpia; con
 * `maxGrazes` o más, fallo: `failDamageFrac`). Sin reglas de esquiva, 0 (la esquiva anula el impacto).
 */
export function evadeDamageFraction(rules: HazardRules, grazes: number): number {
  const ev = rules.impact.evade;
  if (!ev || !Number.isFinite(grazes)) return 0;
  const n = clamp(Math.round(grazes), 0, ev.maxGrazes);
  return n >= ev.maxGrazes ? ev.failDamageFrac : Math.min(ev.failDamageFrac, n * ev.grazeDamageFrac);
}

/** Dificultad 0-1 del minijuego de esquiva para un impacto de `hullDamage` en el sector `sectorIndex`. */
export function evadeDifficulty(rules: HazardRules, sectorIndex: number, hullDamage: number): number {
  const ev = rules.impact.evade;
  if (!ev) return 0;
  const span = rules.impact.hullDamageMax - rules.impact.hullDamageMin;
  const severity = span > 0 ? clamp((hullDamage - rules.impact.hullDamageMin) / span, 0, 1) : 0;
  return clamp(ev.difficultyBase + ev.difficultyPerSector * (sectorIndex - 1) + ev.difficultyFromSeverity * severity, 0, 1);
}

/** Puntuación de la partida: llegar lejos es lo que más cuenta; los materiales guardados a bordo suman su valor. */
export function computeScore(stats: RunStats): number {
  return Math.round(
    stats.sectorsCleared * 1000 + stats.jumps * 50 + stats.incidentsFixed * 20 + stats.impactsEvaded * 30 + stats.distanceLy + (stats.materialsValue ?? 0),
  );
}

function newCrewMember(id: number): CrewMember {
  return {
    id, alive: true, deathCause: null, location: 'ship', suitO2Pct: 100, jetpackPct: 100, x: 0, z: 0, grounded: true,
    carried: {}, carriedKg: 0, carriedValue: 0, carriedValues: {}, evaS: 0, moveBudgetM: 0, o2Alert: 0, carriedUnits: 0, streakUnits: 0, streakMult: 1, tools: {}, lodeVeinsDone: [],
  };
}

function newSystems(): Record<SystemId, SystemState> {
  const make = (): SystemState => ({ healthPct: 100, enabled: true, shorted: false, online: true, repairProgress: 0 });
  return { reactor: make(), engines: make(), lifeSupport: make(), shields: make(), nav: make() };
}

/** Combustible por año luz con el régimen y la salud de motores dados. */
export function fuelPerLy(ship: ShipDef, throttle: ThrottleId, engineHealthPct: number): number {
  return ship.fuelPerLy * getThrottle(ship, throttle).fuelMult * (1 + ship.damagedEngineFuelPenalty * (1 - clamp(engineHealthPct, 0, 100) / 100));
}

/** Velocidad con motores en marcha (0 si la salud es 0). */
export function cruiseSpeedLyPerS(ship: ShipDef, throttle: ThrottleId, engineHealthPct: number): number {
  if (engineHealthPct <= 0) return 0;
  return ship.cruiseSpeedLyPerS * getThrottle(ship, throttle).speedMult * (MIN_ENGINE_SPEED_FACTOR + (1 - MIN_ENGINE_SPEED_FACTOR) * clamp(engineHealthPct, 0, 100) / 100);
}

export function createRun(options: RunOptions): Run {
  const cat: Catalog = options.catalog ?? defaultCatalog;
  const ship = getShip(options.shipId, cat);
  const rules = cat.hazards;
  const seed = Math.trunc(options.seed) >>> 0;
  const wearRng = createRng(deriveSeed(seed, WEAR_SALT));
  const surfaceCat = getSurfaceCatalog(cat);
  const srules = surfaceCat.rules;
  const crewSize = clamp(Math.trunc(options.crewSize ?? 1), 1, MAX_CREW);

  const firstSector = generateSector(seed, 1, cat, ship.id);
  const shipState: ShipState = {
    shipId: ship.id,
    hull: ship.hullMax,
    fuel: ship.startFuel,
    oxygenPct: 100,
    spares: ship.startSpares,
    throttle: 'cruise',
    systems: newSystems(),
    powerSupplyKw: ship.reactorOutputKw,
    powerDemandKw: 0,
    overloaded: false,
    speedLyPerS: 0,
    cargo: {},
  };
  const state: RunState = {
    seed,
    phase: 'docked',
    lossReason: null,
    sector: firstSector,
    locationId: firstSector.startId,
    visitedIds: [firstSector.startId],
    servicedIds: [],
    ship: shipState,
    incidents: [],
    warnings: [],
    transit: null,
    landedIds: [],
    crew: Array.from({ length: crewSize }, (_, i) => newCrewMember(i + 1)),
    surface: null,
    stats: {
      timeS: 0, jumps: 0, distanceLy: 0, sectorsCleared: 0, incidentsFixed: 0, impactsTaken: 0, impactsEvaded: 0, kitsUsed: 0,
      landings: 0, hardLandings: 0, evas: 0, evaTimeS: 0, materialsCollected: 0, materialsStored: 0, materialsValue: 0, crewLost: 0,
    },
    score: 0,
  };

  let accumulatorS = 0;
  let eventSeq = 0;
  let incidentSeq = 0;
  let hazardSeq = 0;
  let toolSeq = 0;
  let pending: RunEvent[] = [];
  let wasOverloaded = false;
  let wasBlackout = false;
  const alerted = { oxygen: false, fuel: false, hull: false };

  const sys = shipState.systems;

  function emit(type: RunEventType, tone: EventTone, key: string, params?: MessageRef['params'], extra?: Pick<RunEvent, 'systemId' | 'incidentKind' | 'crewId' | 'subtype'>): void {
    pending.push({ id: ++eventSeq, type, tS: Math.round(state.stats.timeS * 10) / 10, tone, message: params ? { key, params } : { key }, ...extra });
  }

  // ── Estado derivado: cortos, energía, sistemas en línea y velocidad ─────────────────────────
  function refresh(): void {
    for (const idSys of SYSTEM_IDS) sys[idSys].shorted = false;
    for (const inc of state.incidents) if (inc.kind === 'short') sys[inc.systemId].shorted = true;

    const reactorUp = sys.reactor.healthPct > 0 && !sys.reactor.shorted;
    const supply = reactorUp ? (ship.reactorOutputKw * sys.reactor.healthPct) / 100 : 0;
    const throttle = getThrottle(ship, shipState.throttle);
    let demand = 0;
    for (const idSys of POWERED) {
      const s = sys[idSys];
      const wants = s.enabled && s.healthPct > 0 && !s.shorted;
      s.online = wants && supply > 0;
      if (!wants) continue;
      if (idSys === 'engines') demand += state.phase === 'transit' ? ship.systemDrawKw.engines * throttle.engineDrawMult : 0;
      else demand += ship.systemDrawKw[idSys];
    }
    sys.reactor.online = reactorUp;
    shipState.powerSupplyKw = supply;
    shipState.powerDemandKw = demand;
    shipState.overloaded = supply > 0 && demand > supply + 1e-9;
    shipState.speedLyPerS =
      state.phase === 'transit' && sys.engines.online && shipState.fuel > 0 ? cruiseSpeedLyPerS(ship, shipState.throttle, sys.engines.healthPct) : 0;

    if (shipState.overloaded && !wasOverloaded) emit('overload', 'warn', 'event.overload', undefined, { systemId: 'reactor' });
    wasOverloaded = shipState.overloaded;
    const blackout = supply <= 0;
    if (blackout && !wasBlackout) emit('blackout', 'bad', 'event.blackout', undefined, { systemId: 'reactor' });
    wasBlackout = blackout;
  }

  function refreshWarnings(): void {
    const transit = state.transit;
    if (!transit || !sys.nav.online) {
      state.warnings = [];
      return;
    }
    const out: RunState['warnings'] = [];
    for (const h of transit.hazards) {
      if (h.kind !== 'impact') continue;
      const ahead = h.atLy - transit.traveledLy;
      if (ahead > rules.impact.warnLeadLy) break; // ordenados por atLy
      if (!h.announced) {
        h.announced = true;
        emit('impact-warning', 'warn', 'event.impactWarning');
      }
      const warning: RunState['warnings'][number] = { hazardId: h.id, etaS: shipState.speedLyPerS > 0 ? Math.max(0, ahead) / shipState.speedLyPerS : -1, evaded: h.evaded };
      if (rules.impact.evade) {
        warning.evadeSeed = deriveSeed(deriveSeed(seed, EVADE_SALT + state.sector.index), h.id);
        warning.evadeDifficulty = Math.round(evadeDifficulty(rules, state.sector.index, h.hullDamage) * 1000) / 1000;
      }
      out.push(warning);
    }
    state.warnings = out;
  }

  function damageSystem(idSys: SystemId, amountPct: number): void {
    const s = sys[idSys];
    if (s.healthPct <= 0 || amountPct <= 0) return;
    s.healthPct = Math.max(0, s.healthPct - amountPct);
    if (s.healthPct === 0) emit('system-down', 'bad', 'event.systemDown', { system: idSys }, { systemId: idSys });
  }

  function spawnIncident(kind: IncidentKind, idSys: SystemId, announce = true): Incident | null {
    if (state.incidents.length >= rules.maxIncidents) return null;
    if (state.incidents.some((i) => i.kind === kind && i.systemId === idSys)) return null;
    const inc: Incident = { id: ++incidentSeq, kind, systemId: idSys, ageS: 0, progress: 0 };
    state.incidents.push(inc);
    if (announce) emit('incident', 'bad', `event.incident.${kind}`, { system: idSys }, { systemId: idSys, incidentKind: kind });
    return inc;
  }

  function lose(reason: NonNullable<RunState['lossReason']>): void {
    if (state.phase === 'lost') return;
    state.phase = 'lost';
    state.lossReason = reason;
    state.transit = null;
    state.warnings = [];
    shipState.speedLyPerS = 0;
    emit('lost', 'bad', `loss.${reason}`);
  }

  // ── Viaje ───────────────────────────────────────────────────────────────────────────────────
  function planHazards(toId: string, distanceLy: number): PlannedHazard[] {
    const rng = createRng(deriveSeed(deriveSeed(seed, HAZARD_SALT + state.sector.index), state.stats.jumps));
    const target = getNode(state.sector, toId)!;
    const perLy = getNodeKind(target.kind, cat).hazardPerLy;
    const safe = Math.min(cat.sector.safeStartLy, distanceLy);
    const span = Math.max(0, distanceLy - safe - 0.5);
    const out: PlannedHazard[] = [];
    for (const kind of HAZARD_KINDS) {
      const count = poisson(rng, perLy[kind] * state.sector.hazardMult * span);
      for (let i = 0; i < count; i++) {
        out.push({
          id: ++hazardSeq,
          kind,
          atLy: safe + rng.next() * span,
          systemId: SYSTEM_IDS[rng.int(0, SYSTEM_IDS.length - 1)]!,
          hullDamage: rules.impact.hullDamageMin + rng.next() * (rules.impact.hullDamageMax - rules.impact.hullDamageMin),
          systemDamage: rules.impact.systemDamageMin + rng.next() * (rules.impact.systemDamageMax - rules.impact.systemDamageMin),
          leakRoll: rng.next(),
          evaded: false,
          announced: false,
        });
      }
    }
    return out.sort((a, b) => a.atLy - b.atLy || a.id - b.id);
  }

  function triggerHazard(h: PlannedHazard): void {
    if (h.kind !== 'impact') {
      spawnIncident(h.kind, h.systemId);
      return;
    }
    const frac = h.evaded ? (h.evadeDamageFrac ?? 0) : 1;
    if (frac <= 0) {
      state.stats.impactsEvaded++;
      // Sin roces informados el evento es el de siempre (sin subtipo); con la esquiva por habilidad, `clean`.
      emit('impact-evaded', 'ok', 'event.impactEvaded', undefined, h.evadeDamageFrac === undefined ? undefined : { subtype: 'clean' });
      return;
    }
    const failed = h.evaded && frac >= (rules.impact.evade?.failDamageFrac ?? 1) - 1e-9;
    const graze = h.evaded && !failed;
    if (graze) state.stats.impactsGrazed = (state.stats.impactsGrazed ?? 0) + 1;
    else state.stats.impactsTaken++;
    const subtype = graze ? ({ subtype: 'graze' } as const) : failed ? ({ subtype: 'failed' } as const) : {};
    if (sys.shields.online) {
      const absorb = (ship.shieldAbsorb * sys.shields.healthPct) / 100;
      const damage = h.hullDamage * frac * (1 - absorb);
      shipState.hull = Math.max(0, shipState.hull - damage);
      emit('impact-hit', 'warn', graze ? 'event.impactGrazed' : 'event.impactShielded', { damage: Math.round(damage) }, { systemId: 'shields', ...subtype });
      damageSystem('shields', ship.shieldWearPctPerHit * frac);
    } else {
      const damage = h.hullDamage * frac;
      shipState.hull = Math.max(0, shipState.hull - damage);
      if (graze) emit('impact-hit', 'warn', 'event.impactGrazed', { damage: Math.round(damage) }, { systemId: h.systemId, ...subtype });
      else emit('impact-hit', 'bad', 'event.impactHit', { damage: Math.round(damage), system: h.systemId }, { systemId: h.systemId, ...subtype });
      damageSystem(h.systemId, h.systemDamage * frac);
      // Un roce no abre fugas; un impacto (o una esquiva fallida) sí puede.
      if (!graze && h.leakRoll < rules.impact.leakChanceUnshielded) spawnIncident('leak', h.systemId);
    }
  }

  function canUseService(): boolean {
    const here = getNode(state.sector, state.locationId);
    return !!here && !!getNodeKind(here.kind, cat).service && !state.servicedIds.includes(here.id);
  }

  /** Sin forma de seguir: sin motores/reactor ni repuestos, o sin combustible para ningún salto. */
  function isStranded(): boolean {
    const dead = (sys.engines.healthPct <= 0 || sys.reactor.healthPct <= 0) && shipState.spares <= 0;
    if (state.phase === 'transit') return dead || shipState.fuel <= 0;
    if (state.phase === 'surface') return isStrandedOnSurface(dead);
    if (state.phase !== 'docked' || canUseService()) return false;
    if (dead) return true;
    const here = getNode(state.sector, state.locationId)!;
    const health = shipState.spares > 0 ? 100 : sys.engines.healthPct;
    return here.links.every((idNext) => nodeDistanceLy(here, getNode(state.sector, idNext)!) * fuelPerLy(ship, 'eco', health) > shipState.fuel);
  }

  function arrive(): void {
    const transit = state.transit!;
    const node = getNode(state.sector, transit.toId)!;
    const firstVisit = !state.visitedIds.includes(node.id);
    state.transit = null;
    state.warnings = [];
    state.locationId = node.id;
    state.phase = 'docked';
    state.stats.jumps++;
    if (firstVisit) state.visitedIds.push(node.id);
    emit('arrived', 'info', 'event.arrived', { node: node.name });
    if (firstVisit && node.cache) {
      const fuel = Math.min(node.cache.fuel, ship.fuelCapacity - shipState.fuel);
      const spares = Math.min(node.cache.spares, ship.maxSpares - shipState.spares);
      shipState.fuel += fuel;
      shipState.spares += spares;
      emit('cache', 'ok', 'event.cache', { fuel: Math.round(fuel), spares });
    }
    if (node.id === state.sector.goalId) {
      state.phase = 'won';
      state.stats.sectorsCleared++;
      emit('sector-cleared', 'ok', 'event.sectorCleared', { sector: state.sector.index });
    }
  }

  // ── Un paso fijo ────────────────────────────────────────────────────────────────────────────
  function fixedStep(dt: number): void {
    refresh();
    state.stats.timeS += dt;

    // Averías activas
    let o2Drain = ship.crewO2UsePctPerS * aboardFraction();
    for (const inc of [...state.incidents]) {
      inc.ageS += dt;
      if (inc.kind === 'fire') {
        const fire = rules.incidents.fire;
        damageSystem(inc.systemId, fire.systemDamagePctPerS * dt);
        shipState.hull = Math.max(0, shipState.hull - fire.hullDamagePerS * dt);
        o2Drain += fire.o2DrainPctPerS;
        if (!inc.spread && inc.ageS >= fire.spreadAfterS) {
          inc.spread = true;
          const free = SYSTEM_IDS.filter((s) => !state.incidents.some((i) => i.kind === 'fire' && i.systemId === s));
          const roll = wearRng.next();
          const target = free[Math.floor(roll * free.length)];
          if (target && spawnIncident('fire', target, false)) emit('fire-spread', 'bad', 'event.fireSpread', { system: target }, { systemId: target, incidentKind: 'fire' });
        }
      } else if (inc.kind === 'leak') {
        o2Drain += rules.incidents.leak.o2DrainPctPerS;
      } else if (inc.ageS >= rules.incidents.short.escalateToFireAfterS) {
        if (state.incidents.some((i) => i.kind === 'fire' && i.systemId === inc.systemId)) {
          state.incidents.splice(state.incidents.indexOf(inc), 1);
        } else {
          inc.kind = 'fire';
          inc.ageS = 0;
          inc.progress = 0;
          emit('incident-escalated', 'bad', 'event.escalated', { system: inc.systemId }, { systemId: inc.systemId, incidentKind: 'fire' });
        }
      }
    }

    // Oxígeno. En tierra el soporte vital cubre a quien está a bordo pero apenas recupera excedente
    // (el O₂ gastado en rellenar trajes no vuelve hasta despegar).
    let regen = sys.lifeSupport.online ? (ship.o2RegenPctPerS * sys.lifeSupport.healthPct) / 100 : 0;
    const surfaceRegen = srules.shipO2;
    if (surfaceRegen && (state.phase === 'landing' || state.phase === 'surface')) {
      const aboardUse = ship.crewO2UsePctPerS * aboardFraction();
      regen = Math.min(regen, aboardUse) + surfaceRegen.surfaceSurplusRegenMult * Math.max(0, regen - aboardUse);
    }
    shipState.oxygenPct = clamp(shipState.oxygenPct + (regen - o2Drain) * dt, 0, 100);

    // Sobrecarga: el reactor se daña mientras se le pida más de lo que da
    if (shipState.overloaded) damageSystem('reactor', ship.overloadReactorDamagePctPerS * dt);

    // Tránsito
    const transit = state.transit;
    if (transit && state.phase === 'transit') {
      // Desgaste (siempre se consumen las mismas tiradas por paso)
      const wearRoll = wearRng.next();
      const kindRoll = wearRng.next();
      const sysRoll = wearRng.next();
      if (wearRoll < rules.wear.chancePerS * getThrottle(ship, shipState.throttle).wearMult * dt) {
        spawnIncident(pickWearKind(kindRoll), SYSTEM_IDS[Math.floor(sysRoll * SYSTEM_IDS.length)]!);
      }

      const remaining = transit.distanceLy - transit.traveledLy;
      const stepLy = Math.min(remaining, shipState.speedLyPerS * dt);
      if (stepLy > 0) {
        shipState.fuel = Math.max(0, shipState.fuel - stepLy * fuelPerLy(ship, shipState.throttle, sys.engines.healthPct));
        transit.traveledLy += stepLy;
        state.stats.distanceLy += stepLy;
      }
      while (transit.hazards.length > 0 && transit.hazards[0]!.atLy <= transit.traveledLy) triggerHazard(transit.hazards.shift()!);
      if (transit.distanceLy - transit.traveledLy <= 1e-6) arrive();
    }

    // Descenso y superficie: la nave sigue viva (desgaste × factor del mundo) y corre el mundo
    const surface = state.surface;
    if (surface && (state.phase === 'landing' || state.phase === 'surface')) {
      const world = getWorld(surface.worldId, cat);
      const wearRoll = wearRng.next();
      const kindRoll = wearRng.next();
      const sysRoll = wearRng.next();
      if (wearRoll < rules.wear.chancePerS * world.shipWearMult * dt) spawnIncident(pickWearKind(kindRoll), SYSTEM_IDS[Math.floor(sysRoll * SYSTEM_IDS.length)]!);
      if (state.phase === 'landing') stepDescent(surface, dt);
      else {
        stepSurface(surface, dt);
        stepTools(surface, dt);
      }
    }

    refresh();
    refreshWarnings();

    // Avisos de nivel bajo (una vez hasta que se recupere)
    const levels = [
      ['oxygen', shipState.oxygenPct, rules.alerts.lowOxygenPct, 'low-oxygen', 'event.lowOxygen'],
      ['fuel', (shipState.fuel / ship.fuelCapacity) * 100, rules.alerts.lowFuelPct, 'low-fuel', 'event.lowFuel'],
      ['hull', (shipState.hull / ship.hullMax) * 100, rules.alerts.lowHullPct, 'low-hull', 'event.lowHull'],
    ] as const;
    for (const [name, value, threshold, type, key] of levels) {
      if (value < threshold && !alerted[name]) {
        alerted[name] = true;
        emit(type, 'warn', key);
      } else if (value >= threshold + ALERT_HYSTERESIS_PCT) alerted[name] = false;
    }

    // Permadeath
    if (shipState.hull <= 0) lose('hull');
    else if (shipState.oxygenPct <= 0) lose('oxygen');
    else if (state.crew.every((c) => !c.alive)) lose('crew');
    else if (isStranded()) lose('stranded');
    state.score = computeScore(state.stats);
  }

  // ── Superficie (fase 2) ─────────────────────────────────────────────────────────────────────
  const round1 = (n: number): number => Math.round(n * 10) / 10;

  function aboardFraction(): number {
    return state.crew.filter((c) => c.alive && c.location === 'ship').length / state.crew.length;
  }

  /** Alguien vivo a bordo (las reparaciones y los interruptores son puestos físicos de la nave). */
  function crewAboard(): boolean {
    return state.crew.some((c) => c.alive && c.location === 'ship');
  }

  function pickWearKind(kindRoll: number): IncidentKind {
    const total = INCIDENT_KINDS.reduce((s, k) => s + rules.wear.weights[k], 0);
    let pick = kindRoll * total;
    for (const k of INCIDENT_KINDS) {
      pick -= rules.wear.weights[k];
      if (pick < 0) return k;
    }
    return 'short';
  }

  function clearCarried(m: CrewMember): void {
    m.carried = {};
    m.carriedValues = {};
    m.carriedKg = 0;
    m.carriedValue = 0;
    m.carriedUnits = 0;
    m.streakUnits = 0;
    m.streakMult = 1; // la racha se consolida al guardar y se pierde al morir
    m.lodeVeinsDone = []; // el avance de los filones también
  }

  function killCrew(m: CrewMember, cause: 'oxygen' | 'fall'): void {
    if (!m.alive) return;
    m.alive = false;
    m.deathCause = cause;
    clearCarried(m); // lo que llevaba encima se pierde
    state.stats.crewLost++;
    state.stats.evaTimeS += m.evaS;
    emit('crew-dead', 'bad', `event.crewDead.${cause}`, undefined, { crewId: m.id, subtype: cause });
    if (state.surface) abandonTools(state.surface);
    if (state.crew.every((c) => !c.alive)) lose('crew');
  }

  /** Si ya no queda nadie vivo fuera, lo colocado (y lo que tenía extraído) se pierde en este aterrizaje. */
  function abandonTools(surface: SurfaceState): void {
    if (surface.tools.length === 0 || state.crew.some((c) => c.alive && c.location === 'eva')) return;
    for (const t of surface.tools) surface.toolsLost[t.toolId] = (surface.toolsLost[t.toolId] ?? 0) + 1;
    emit('tool-lost', 'bad', 'event.toolLost', { count: surface.tools.length }, { subtype: 'left' });
    for (const t of surface.tools) {
      const d = surface.deposits.find((x) => x.id === t.depositId);
      if (d) d.progress = 0;
    }
    surface.tools = [];
  }

  /** Herramientas colocadas: extraen solas a paso fijo (el concentrador solar se para con tormenta). */
  function stepTools(surface: SurfaceState, dt: number): void {
    for (const t of surface.tools) {
      const deposit = surface.deposits.find((d) => d.id === t.depositId)!;
      if (t.stopped === 'depleted') continue;
      const def = getTool(t.toolId);
      if (def.stopsInStorm && surface.storm.active) {
        if (t.stopped !== 'storm') emit('tool-stopped', 'warn', 'event.toolStopped', { tool: t.toolId }, { subtype: 'storm' });
        t.stopped = 'storm';
        continue;
      }
      if (t.stopped === 'storm') emit('tool-resumed', 'ok', 'event.toolResumed', { tool: t.toolId }, { subtype: 'storm' });
      t.stopped = null;
      const mat = getMaterial(t.materialId, cat);
      t.progress += (dt * def.speedMult) / mat.collectS;
      if (t.progress >= 1 - 1e-9) {
        t.progress = 0;
        deposit.units--;
        t.ready++;
        if (deposit.units <= 0) {
          t.stopped = 'depleted';
          emit('tool-done', 'ok', 'event.toolDone', { units: t.ready, material: t.materialId });
        }
      }
      deposit.progress = t.progress;
    }
  }

  function getTool(toolId: string) {
    return surfaceCat.tools.find((x) => x.id === toolId)!;
  }

  /** Pasa a la mochila lo extraído que quepa (con racha y valor) y devuelve cuántas unidades recogió. */
  function pickUp(m: CrewMember, t: PlacedTool): number {
    const mat = getMaterial(t.materialId, cat);
    const deposit = state.surface!.deposits.find((d) => d.id === t.depositId)!;
    const room = Math.floor((srules.suit.carryCapacityKg - m.carriedKg + 1e-9) / mat.massKg);
    const n = Math.max(0, Math.min(t.ready, room));
    // Filón completo: la última veta vale más si este tripulante agotó las demás en esta salida.
    const lodeMult = lodeBonusApplies(state.surface!.deposits, deposit, m) ? (srules.lodes?.completeMult ?? 1) : 1;
    for (let k = 0; k < n; k++) {
      // Racha (solo lo raro): las piezas raras que ya lleva encima revalorizan esta.
      const unitValue = Math.round((mat.streak ? deposit.valuePerUnit * m.streakMult : deposit.valuePerUnit) * lodeMult);
      m.carried[mat.id] = (m.carried[mat.id] ?? 0) + 1;
      m.carriedValues[mat.id] = (m.carriedValues[mat.id] ?? 0) + unitValue;
      m.carriedKg += mat.massKg;
      m.carriedValue += unitValue;
      m.carriedUnits++;
      if (mat.streak) {
        m.streakUnits++;
        m.streakMult = streakMultiplier(srules, m.streakUnits);
      }
      state.stats.materialsCollected++;
    }
    t.ready -= n;
    // Veta de filón agotada por este tripulante (cuenta para completar el filón en esta salida).
    if (deposit.lodeId !== undefined && deposit.units <= 0 && t.ready <= 0 && !m.lodeVeinsDone.includes(deposit.id)) m.lodeVeinsDone.push(deposit.id);
    if (n > 0) {
      emit('material-collected', 'ok', 'event.pickedUp', { units: n, material: mat.id, kg: Math.round(m.carriedKg), capacity: srules.suit.carryCapacityKg }, lodeMult > 1 ? { crewId: m.id, subtype: 'lode' } : { crewId: m.id });
    }
    return n;
  }

  /** Devuelve la herramienta a la mochila; lo extraído que no se llevó vuelve a la veta. */
  function stowTool(m: CrewMember, surface: SurfaceState, t: PlacedTool): void {
    const deposit = surface.deposits.find((d) => d.id === t.depositId)!;
    deposit.units += t.ready;
    deposit.progress = 0;
    m.tools[t.toolId] = (m.tools[t.toolId] ?? 0) + 1;
    surface.tools.splice(surface.tools.indexOf(t), 1);
  }

  function touchdown(surface: SurfaceState): void {
    const speed = surface.descent?.speedMps ?? 0;
    surface.descent = null;
    surface.touchdownSpeedMps = round1(speed);
    state.phase = 'surface';
    state.stats.landings++;
    const d = srules.descent;
    const excess = speed - d.safeSpeedMps;
    if (excess <= 0) {
      emit('landing', 'ok', 'event.landing.soft', { speed: round1(speed) }, { subtype: 'soft' });
      return;
    }
    surface.hardLanding = true;
    state.stats.hardLandings++;
    const rng = createRng(landingSeed(seed, state.sector, surface.nodeId));
    const sysRoll = rng.next();
    const incidentRoll = rng.next();
    const kindRoll = rng.next();
    const hullDamage = excess * d.hullDamagePerMps;
    shipState.hull = Math.max(0, shipState.hull - hullDamage);
    const target = SYSTEM_IDS[Math.floor(sysRoll * SYSTEM_IDS.length)]!;
    emit('landing', 'bad', 'event.landing.hard', { speed: round1(speed), damage: Math.round(hullDamage) }, { systemId: target, subtype: 'hard' });
    damageSystem(target, excess * d.systemDamagePerMps);
    if (incidentRoll < excess * d.incidentChancePerMps) spawnIncident(kindRoll < 0.5 ? 'leak' : 'short', target);
  }

  function stepDescent(surface: SurfaceState, dt: number): void {
    const d = surface.descent;
    if (!d) return;
    const braking = d.brake && sys.engines.online && shipState.fuel > 0;
    if (braking) {
      const fuel = Math.min(shipState.fuel, srules.descent.brakeFuelPerS * dt);
      shipState.fuel -= fuel;
      d.fuelUsed += fuel;
      d.brakeS += dt;
    }
    descentStep(getWorld(surface.worldId, cat), srules, d, braking, dt);
    if (d.altitudeM <= 0) {
      d.altitudeM = 0;
      touchdown(surface);
    }
  }

  function updateStorm(surface: SurfaceState, warnS: number): void {
    const t = surface.elapsedS;
    const st = surface.storm;
    let i = surface.stormCursor;
    while (i < surface.storms.length) {
      const storm = surface.storms[i]!;
      if (!st.warned && t >= storm.startS - warnS) {
        st.warned = true;
        emit('storm-warning', 'warn', 'event.storm.warning', { seconds: Math.max(0, Math.round(storm.startS - t)) });
      }
      if (!st.active && t >= storm.startS && t < storm.endS) {
        st.active = true;
        st.intensity = storm.intensity;
        emit('storm-start', 'bad', 'event.storm.start');
      }
      if (t >= storm.endS) {
        if (st.active) emit('storm-end', 'ok', 'event.storm.end');
        st.active = false;
        st.intensity = 0;
        st.warned = false;
        i++;
        continue;
      }
      break;
    }
    surface.stormCursor = i;
    const current = surface.storms[i];
    const next = st.active ? surface.storms[i + 1] : current;
    st.nextInS = next ? round1(next.startS - t) : null;
    st.endsInS = st.active && current ? round1(current.endS - t) : null;
  }

  function insideZone(m: CrewMember, zone: SurfaceState['zones'][number]): boolean {
    return Math.hypot(m.x - zone.x, m.z - zone.z) <= zone.radiusM;
  }

  function stepSurface(surface: SurfaceState, dt: number): void {
    surface.elapsedS += dt;
    const world = getWorld(surface.worldId, cat);
    if (world.storms) updateStorm(surface, world.storms.warnS);
    const stormDrain = surface.storm.active && world.storms ? world.storms.o2DrainPctPerS * surface.storm.intensity : 0;
    const suit = srules.suit;

    for (const m of state.crew) {
      if (!m.alive || m.location !== 'eva') continue;
      m.evaS += dt;
      m.moveBudgetM = Math.min(suit.maxMoveSpeedMps * MOVE_BUDGET_CAP_S, m.moveBudgetM + suit.maxMoveSpeedMps * dt);
      m.suitO2Pct = Math.max(0, m.suitO2Pct - (suit.o2DrainPctPerS + stormDrain) * dt);
      if (m.grounded) m.jetpackPct = Math.min(100, m.jetpackPct + srules.jetpack.rechargePctPerS * dt);
      if (m.suitO2Pct < suit.criticalO2Pct && m.o2Alert < 2) {
        m.o2Alert = 2;
        emit('suit-o2', 'bad', 'event.suitO2.critical', undefined, { crewId: m.id, subtype: 'critical' });
      } else if (m.suitO2Pct < suit.lowO2Pct && m.o2Alert < 1) {
        m.o2Alert = 1;
        emit('suit-o2', 'warn', 'event.suitO2.low', undefined, { crewId: m.id, subtype: 'low' });
      } else if (m.suitO2Pct >= suit.lowO2Pct + ALERT_HYSTERESIS_PCT) m.o2Alert = 0;
      if (m.suitO2Pct <= 0) killCrew(m, 'oxygen');
    }

    // Terreno inestable: pisarlo agrieta; sin nadie encima (o en jetpack) se recupera poco a poco.
    for (const zone of surface.zones) {
      if (zone.collapsed) continue;
      const on = state.crew.some((m) => m.alive && m.location === 'eva' && m.grounded && insideZone(m, zone));
      if (!on) {
        zone.pressed = false;
        zone.crackingS = Math.max(0, zone.crackingS - srules.terrain.decayPerS * dt);
        continue;
      }
      if (!zone.pressed) emit('terrain-warning', 'warn', 'event.terrain.warning');
      zone.pressed = true;
      zone.crackingS += dt;
      if (zone.crackingS >= srules.terrain.collapseS - 1e-9) {
        zone.collapsed = true;
        zone.pressed = false;
        zone.crackingS = 0;
        emit('terrain-collapsed', 'bad', 'event.terrain.collapsed');
      }
    }
  }

  /** Queda en este mundo algo que dé ese suministro (en vetas o encima de alguien vivo). */
  function canRecover(kind: 'fuel' | 'spares'): boolean {
    const surface = state.surface;
    if (!surface) return false;
    const gives = (materialId: string): boolean => (getMaterial(materialId, cat).yields?.[kind] ?? 0) > 0;
    // Una veta solo sirve si alguien vivo conserva la herramienta que la extrae (o ya hay algo extraído).
    const canMine = (materialId: string): boolean => state.crew.some((c) => c.alive && (c.tools[getMaterial(materialId, cat).tool] ?? 0) > 0);
    return (
      surface.deposits.some((d) => d.units > 0 && gives(d.materialId) && canMine(d.materialId)) ||
      surface.tools.some((t) => gives(t.materialId) && (t.ready > 0 || t.stopped !== 'depleted')) ||
      state.crew.some((c) => c.alive && Object.keys(c.carried).some(gives))
    );
  }

  function isStrandedOnSurface(dead: boolean): boolean {
    if (dead && !canRecover('spares')) return true;
    const surface = state.surface;
    const alive = state.crew.filter((c) => c.alive);
    if (!surface || alive.length === 0 || alive.some((c) => c.location !== 'ship')) return false;
    // Ni con la bodega vacía alcanza para despegar y no queda de dónde sacar combustible.
    return shipState.fuel < takeOffFuel(getWorld(surface.worldId, cat), srules, 0) - 1e-9 && !canRecover('fuel');
  }

  function estimateLanding(): LandingEstimate | null {
    if (state.phase !== 'docked') return null;
    const world = getNodeWorld(seed, state.sector, state.locationId, cat);
    if (!world) return null;
    const descent = simulateDescent(world, srules);
    const toFuel = takeOffFuel(world, srules, 0);
    return {
      nodeId: state.locationId,
      worldId: world.id,
      gravityMps2: world.gravityMps2,
      descentFuel: descent.fuel,
      descentTimeS: descent.timeS,
      takeOffFuel: toFuel,
      totalFuel: descent.fuel + toFuel,
      canLand: shipState.fuel >= descent.fuel + toFuel,
      enoughFuel: shipState.fuel >= descent.fuel + toFuel,
      alreadyLanded: state.landedIds.includes(state.locationId),
    };
  }

  function estimateTakeOff(): TakeOffEstimate | null {
    const surface = state.surface;
    if (state.phase !== 'surface' || !surface) return null;
    const world = getWorld(surface.worldId, cat);
    const fuel = takeOffFuel(world, srules, surface.loadedKg);
    const fuelEmpty = takeOffFuel(world, srules, 0);
    return { fuel, fuelEmpty, loadedKg: surface.loadedKg, enoughFuel: shipState.fuel >= fuel, enoughFuelEmpty: shipState.fuel >= fuelEmpty };
  }

  /** Guarda en la nave lo que lleva un tripulante: suministros si caben, el resto a la bodega. */
  function storeCarried(m: CrewMember, surface: SurfaceState): void {
    if (m.carriedKg <= 0) return;
    let units = 0;
    let fuelGain = 0;
    let sparesGain = 0;
    for (const [materialId, count] of Object.entries(m.carried)) {
      const mat = getMaterial(materialId, cat);
      const unitValue = count > 0 ? (m.carriedValues[materialId] ?? 0) / count : 0;
      const fuelYield = mat.yields?.fuel ?? 0;
      const sparesYield = mat.yields?.spares ?? 0;
      for (let k = 0; k < count; k++) {
        units++;
        if (fuelYield > 0 && shipState.fuel + fuelYield <= ship.fuelCapacity + 1e-9) {
          shipState.fuel += fuelYield;
          fuelGain += fuelYield;
        } else if (sparesYield > 0 && shipState.spares + sparesYield <= ship.maxSpares) {
          shipState.spares += sparesYield;
          sparesGain += sparesYield;
        } else {
          shipState.cargo[materialId] = (shipState.cargo[materialId] ?? 0) + 1;
          surface.loaded[materialId] = (surface.loaded[materialId] ?? 0) + 1;
          surface.loadedKg += mat.massKg;
          surface.loadedValue += unitValue;
        }
      }
    }
    const value = m.carriedValue;
    state.stats.materialsStored += units;
    state.stats.materialsValue += value;
    clearCarried(m);
    emit('cargo-stored', 'ok', 'event.cargoStored', { units, value: Math.round(value) }, { crewId: m.id, subtype: 'stored' });
    if (fuelGain > 0 || sparesGain > 0) emit('cargo-stored', 'ok', 'event.cargoProcessed', { fuel: Math.round(fuelGain), spares: sparesGain }, { crewId: m.id, subtype: 'processed' });
  }

  function findMember(crewId: number | undefined): CrewMember | null {
    const m = crewId === undefined ? state.crew.find((c) => c.alive) : state.crew.find((c) => c.id === crewId);
    return m && m.alive ? m : null;
  }

  function actSurface(action: Extract<RunAction, { type: 'land' | 'set-descent-brake' | 'eva-exit' | 'eva-enter' | 'set-position' | 'jetpack' | 'fall-impact' | 'collect' | 'deploy-tool' | 'retrieve-tool' | 'jettison' | 'take-off' }>): ActionResult {
    if (action.type === 'land') {
      if (state.phase === 'landing' || state.phase === 'surface') return reject('reject.onSurface');
      if (state.phase !== 'docked') return reject('reject.inTransit');
      const est = estimateLanding();
      if (!est) return reject('reject.notLandable');
      if (est.alreadyLanded) return reject('reject.alreadyLanded');
      if (sys.engines.healthPct <= 0) return reject('reject.enginesDown');
      if (!sys.engines.enabled) return reject('reject.enginesOff');
      // El descenso no se puede cancelar: sin motores en línea no habría freno.
      if (!sys.engines.online) return reject('reject.enginesOffline');
      if (!est.canLand) return reject('reject.landFuel', { fuel: Math.ceil(est.totalFuel) });
      const surface = generateSurface(seed, state.sector, state.locationId, cat)!;
      state.surface = surface;
      state.phase = 'landing';
      state.landedIds.push(state.locationId);
      // Equipo de extracción completo en cada aterrizaje.
      const kit = Object.fromEntries(surfaceCat.tools.map((t) => [t.id, t.perCrew]));
      for (const m of state.crew) Object.assign(m, { location: 'ship', x: 0, z: 0, grounded: true, evaS: 0, tools: { ...kit } });
      emit('descent', 'info', 'event.descent', { world: surface.worldId, gravity: round1(surface.gravityMps2) });
      return OK;
    }
    if (action.type === 'set-descent-brake') {
      const descent = state.surface?.descent;
      if (state.phase !== 'landing' || !descent) return reject('reject.notDescending');
      descent.brake = !!action.on;
      return OK;
    }
    const surface = state.surface;
    if (state.phase === 'landing') return reject('reject.notLanded');
    if (state.phase !== 'surface' || !surface) return reject('reject.notOnSurface');

    if (action.type === 'jettison') {
      const units = Object.values(surface.loaded).reduce((s, n) => s + n, 0);
      if (units <= 0) return reject('reject.nothingToJettison');
      for (const [materialId, n] of Object.entries(surface.loaded)) {
        const left = (shipState.cargo[materialId] ?? 0) - n;
        if (left > 0) shipState.cargo[materialId] = left;
        else delete shipState.cargo[materialId];
      }
      const value = surface.loadedValue;
      state.stats.materialsValue = Math.max(0, state.stats.materialsValue - value);
      state.stats.materialsStored = Math.max(0, state.stats.materialsStored - units);
      surface.loaded = {};
      surface.loadedKg = 0;
      surface.loadedValue = 0;
      emit('jettison', 'warn', 'event.jettison', { units, value: Math.round(value) });
      return OK;
    }
    if (action.type === 'take-off') {
      if (state.crew.some((c) => c.alive && c.location !== 'ship')) return reject('reject.crewOutside');
      if (sys.engines.healthPct <= 0) return reject('reject.enginesDown');
      if (!sys.engines.enabled) return reject('reject.enginesOff');
      const est = estimateTakeOff()!;
      if (!est.enoughFuel) return reject(est.enoughFuelEmpty ? 'reject.takeOffHeavy' : 'reject.takeOffFuel', { fuel: Math.ceil(est.fuel) });
      shipState.fuel = Math.max(0, shipState.fuel - est.fuel);
      state.surface = null;
      state.phase = 'docked';
      for (const m of state.crew) Object.assign(m, { x: 0, z: 0, grounded: true, evaS: 0 });
      emit('take-off', 'info', 'event.takeOff', { fuel: Math.round(est.fuel) });
      return OK;
    }

    const m = findMember(action.crewId);
    if (!m) return reject('reject.crewDead');
    const suit = srules.suit;
    switch (action.type) {
      case 'eva-exit': {
        if (m.location === 'eva') return reject('reject.alreadyOutside');
        // El traje se rellena con O₂ de la nave (proporcional); si no hay bastante, se sale con lo que haya.
        const refill = suitRefill(srules, m.suitO2Pct, shipState.oxygenPct);
        shipState.oxygenPct = Math.max(0, shipState.oxygenPct - refill.shipO2Cost);
        Object.assign(m, {
          location: 'eva', suitO2Pct: refill.suitO2Pct, jetpackPct: 100, x: 0, z: 0, grounded: true, evaS: 0, o2Alert: 0, lodeVeinsDone: [],
          moveBudgetM: suit.maxMoveSpeedMps * MOVE_BUDGET_CAP_S,
        });
        state.stats.evas++;
        if (refill.suitO2Pct < 100 - 0.5) emit('airlock', 'warn', 'event.airlock.exitPartial', { o2: Math.floor(refill.suitO2Pct) }, { crewId: m.id, subtype: 'exit' });
        else emit('airlock', 'info', 'event.airlock.exit', undefined, { crewId: m.id, subtype: 'exit' });
        return OK;
      }
      case 'eva-enter': {
        if (m.location !== 'eva') return reject('reject.notOutside');
        if (Math.hypot(m.x, m.z) > suit.airlockRangeM) return reject('reject.tooFar');
        m.location = 'ship';
        state.stats.evaTimeS += m.evaS;
        emit('airlock', 'ok', 'event.airlock.enter', undefined, { crewId: m.id, subtype: 'enter' });
        storeCarried(m, surface);
        abandonTools(surface);
        return OK;
      }
      case 'set-position': {
        if (m.location !== 'eva') return reject('reject.notOutside');
        const x = Number(action.x);
        const z = Number(action.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return reject('reject.invalid');
        // Antitrampas: no más de lo que permite la velocidad máxima desde el último informe.
        let dx = x - m.x;
        let dz = z - m.z;
        const dist = Math.hypot(dx, dz);
        if (dist > m.moveBudgetM) {
          const k = m.moveBudgetM / dist;
          dx *= k;
          dz *= k;
        }
        let nx = m.x + dx;
        let nz = m.z + dz;
        const r = Math.hypot(nx, nz);
        if (r > surface.radiusM) {
          nx *= surface.radiusM / r;
          nz *= surface.radiusM / r;
        }
        m.moveBudgetM = Math.max(0, m.moveBudgetM - Math.hypot(nx - m.x, nz - m.z));
        m.x = nx;
        m.z = nz;
        m.grounded = !!action.grounded;
        return OK;
      }
      case 'jetpack': {
        if (m.location !== 'eva') return reject('reject.notOutside');
        if (m.jetpackPct <= 0) return reject('reject.jetpackEmpty');
        const seconds = clamp(Number(action.seconds) || 0, 0, MAX_WORK_SECONDS);
        m.jetpackPct = Math.max(0, m.jetpackPct - seconds * srules.jetpack.drainPctPerS);
        return OK;
      }
      case 'fall-impact': {
        if (m.location !== 'eva') return reject('reject.notOutside');
        const speed = clamp(Number(action.speedMps) || 0, 0, MAX_FALL_MPS);
        const falls = srules.falls;
        if (speed >= falls.lethalMps) {
          killCrew(m, 'fall');
        } else if (speed > falls.harmlessMps) {
          const loss = (speed - falls.harmlessMps) * falls.o2LossPctPerMps;
          m.suitO2Pct = Math.max(0, m.suitO2Pct - loss);
          emit('suit-damaged', 'bad', 'event.suitDamaged', { o2: Math.round(loss) }, { crewId: m.id });
          if (m.suitO2Pct <= 0) killCrew(m, 'oxygen');
        }
        return OK;
      }
      case 'deploy-tool': {
        if (m.location !== 'eva') return reject('reject.notOutside');
        const deposit = surface.deposits.find((d) => d.id === action.depositId);
        if (!deposit || deposit.units <= 0) return reject('reject.noDeposit');
        if (Math.hypot(m.x - deposit.x, m.z - deposit.z) > suit.collectRangeM) return reject('reject.tooFar');
        // Se coloca con los pies en el suelo (saltar no esquiva el terreno inestable).
        if (!m.grounded) return reject('reject.toolAirborne');
        if (surface.tools.some((t) => t.depositId === deposit.id)) return reject('reject.toolPlaced');
        const mat = getMaterial(deposit.materialId, cat);
        if ((m.tools[mat.tool] ?? 0) <= 0) return reject('reject.noTool', { tool: mat.tool });
        m.tools[mat.tool]!--;
        surface.tools.push({ id: ++toolSeq, toolId: mat.tool, depositId: deposit.id, materialId: mat.id, x: deposit.x, z: deposit.z, progress: 0, ready: 0, stopped: null });
        deposit.progress = 0;
        emit('tool-placed', 'info', 'event.toolPlaced', { tool: mat.tool, material: mat.id }, { crewId: m.id });
        return OK;
      }
      case 'collect': {
        if (m.location !== 'eva') return reject('reject.notOutside');
        const t = surface.tools.find((x) => x.depositId === action.depositId);
        if (!t) return reject(surface.deposits.some((d) => d.id === action.depositId) ? 'reject.noToolHere' : 'reject.noDeposit');
        if (Math.hypot(m.x - t.x, m.z - t.z) > suit.collectRangeM) return reject('reject.tooFar');
        if (!m.grounded) return reject('reject.collectAirborne');
        if (t.ready <= 0) {
          // Veta agotada y nada pendiente: la herramienta vuelve sola a la mochila.
          if (t.stopped === 'depleted') {
            stowTool(m, surface, t);
            return OK;
          }
          return reject('reject.nothingReady');
        }
        if (pickUp(m, t) === 0) return reject('reject.overCapacity');
        if (t.ready === 0 && t.stopped === 'depleted') stowTool(m, surface, t);
        return OK;
      }
      case 'retrieve-tool': {
        if (m.location !== 'eva') return reject('reject.notOutside');
        const t = surface.tools.find((x) => x.depositId === action.depositId);
        if (!t) return reject(surface.deposits.some((d) => d.id === action.depositId) ? 'reject.noToolHere' : 'reject.noDeposit');
        if (Math.hypot(m.x - t.x, m.z - t.z) > suit.collectRangeM) return reject('reject.tooFar');
        pickUp(m, t);
        stowTool(m, surface, t);
        return OK;
      }
    }
  }

  // ── Acciones ────────────────────────────────────────────────────────────────────────────────
  function estimateJump(toId: string): JumpEstimate | null {
    const here = getNode(state.sector, state.locationId);
    const to = getNode(state.sector, toId);
    if (!here || !to || !here.links.includes(toId)) return null;
    const distanceLy = nodeDistanceLy(here, to);
    const health = sys.engines.healthPct;
    const byThrottle = {} as JumpEstimate['byThrottle'];
    for (const t of THROTTLE_IDS) {
      const fuel = distanceLy * fuelPerLy(ship, t, health);
      const speed = cruiseSpeedLyPerS(ship, t, health);
      byThrottle[t] = { fuel, timeS: speed > 0 ? distanceLy / speed : -1, enoughFuel: fuel <= shipState.fuel };
    }
    const perLy = getNodeKind(to.kind, cat).hazardPerLy;
    const span = Math.max(0, distanceLy - cat.sector.safeStartLy - 0.5);
    const expectedHazards = {} as JumpEstimate['expectedHazards'];
    let risk = 0;
    for (const k of HAZARD_KINDS) {
      expectedHazards[k] = perLy[k] * state.sector.hazardMult * span;
      risk += expectedHazards[k] * RISK_WEIGHT[k];
    }
    return { toId, distanceLy, byThrottle, expectedHazards, riskLevel: RISK_THRESHOLDS.filter((t) => risk >= t).length };
  }

  function act(action: RunAction): ActionResult {
    if (state.phase === 'lost') return reject('reject.runOver');
    if (action.type === 'next-sector') {
      if (state.phase !== 'won') return reject('reject.notAtGate');
      const sector = generateSector(seed, state.sector.index + 1, cat, ship.id);
      state.sector = sector;
      state.locationId = sector.startId;
      state.visitedIds = [sector.startId];
      state.servicedIds = [];
      state.landedIds = [];
      state.phase = 'docked';
      emit('new-sector', 'info', 'event.newSector', { sector: sector.index });
      return OK;
    }
    if (state.phase === 'won') return reject('reject.sectorCleared');
    const onSurface = state.phase === 'landing' || state.phase === 'surface';

    switch (action.type) {
      case 'land':
      case 'set-descent-brake':
      case 'eva-exit':
      case 'eva-enter':
      case 'set-position':
      case 'jetpack':
      case 'fall-impact':
      case 'collect':
      case 'deploy-tool':
      case 'retrieve-tool':
      case 'jettison':
      case 'take-off':
        return actSurface(action);
      case 'jump': {
        if (onSurface) return reject('reject.onSurface');
        if (state.phase !== 'docked') return reject('reject.inTransit');
        const estimate = estimateJump(action.toId);
        if (!estimate) return reject('reject.noRoute');
        if (sys.engines.healthPct <= 0) return reject('reject.enginesDown');
        if (!sys.engines.enabled) return reject('reject.enginesOff');
        if (!estimate.byThrottle.eco.enoughFuel) return reject('reject.notEnoughFuel');
        const to = getNode(state.sector, action.toId)!;
        state.transit = { fromId: state.locationId, toId: to.id, distanceLy: estimate.distanceLy, traveledLy: 0, hazards: planHazards(to.id, estimate.distanceLy) };
        state.phase = 'transit';
        emit('jump', 'info', 'event.jump', { node: to.name, distanceLy: Math.round(estimate.distanceLy) });
        return OK;
      }
      case 'set-throttle':
        if (!THROTTLE_IDS.includes(action.throttle)) return reject('reject.invalid');
        shipState.throttle = action.throttle;
        return OK;
      case 'toggle-system': {
        if (!SYSTEM_IDS.includes(action.systemId)) return reject('reject.invalid');
        if (!crewAboard()) return reject('reject.crewOutside');
        if (action.systemId === 'reactor') return reject('reject.reactorAlwaysOn');
        sys[action.systemId].enabled = !!action.enabled;
        return OK;
      }
      case 'work-incident': {
        const inc = state.incidents.find((i) => i.id === action.incidentId);
        if (!inc) return reject('reject.noIncident');
        if (!crewAboard()) return reject('reject.crewOutside');
        const seconds = clamp(Number(action.seconds) || 0, 0, MAX_WORK_SECONDS);
        inc.progress += seconds / rules.incidents[inc.kind].repairS;
        if (inc.progress >= 1) {
          state.incidents.splice(state.incidents.indexOf(inc), 1);
          state.stats.incidentsFixed++;
          emit('incident-fixed', 'ok', `event.fixed.${inc.kind}`, { system: inc.systemId }, { systemId: inc.systemId, incidentKind: inc.kind });
        }
        return OK;
      }
      case 'repair-system': {
        if (!SYSTEM_IDS.includes(action.systemId)) return reject('reject.invalid');
        const s = sys[action.systemId];
        if (s.healthPct >= 100) return reject('reject.noDamage');
        if (shipState.spares < 1) return reject('reject.noSpares');
        if (!crewAboard()) return reject('reject.crewOutside');
        const seconds = clamp(Number(action.seconds) || 0, 0, MAX_WORK_SECONDS);
        s.repairProgress += seconds / rules.repair.kitRepairS;
        if (s.repairProgress >= 1) {
          s.repairProgress = 0;
          shipState.spares--;
          state.stats.kitsUsed++;
          s.healthPct = Math.min(100, s.healthPct + rules.repair.kitRestorePct);
          emit('system-repaired', 'ok', 'event.systemRepaired', { system: action.systemId }, { systemId: action.systemId });
        }
        return OK;
      }
      case 'evade': {
        if (onSurface) return reject('reject.onSurface');
        const transit = state.transit;
        if (state.phase !== 'transit' || !transit) return reject('reject.notInTransit');
        const warning = state.warnings.find((w) => !w.evaded);
        const hazard = warning && transit.hazards.find((h) => h.id === warning.hazardId);
        if (!hazard) return reject('reject.noWarning');
        if (!sys.engines.online) return reject('reject.enginesDown');
        if (shipState.fuel < ship.evadeFuel) return reject('reject.notEnoughFuel');
        shipState.fuel -= ship.evadeFuel;
        hazard.evaded = true;
        // Esquiva por habilidad: el cliente informa los roces del minijuego; el motor cobra.
        if (action.grazes !== undefined && rules.impact.evade) hazard.evadeDamageFrac = evadeDamageFraction(rules, Number(action.grazes) || 0);
        return OK;
      }
      case 'service': {
        if (onSurface) return reject('reject.onSurface');
        if (state.phase !== 'docked') return reject('reject.inTransit');
        const here = getNode(state.sector, state.locationId)!;
        const service = getNodeKind(here.kind, cat).service;
        if (!service) return reject('reject.noService');
        if (state.servicedIds.includes(here.id)) return reject('reject.serviceUsed');
        const fuel = service.refuel ? ship.fuelCapacity - shipState.fuel : 0;
        const hull = Math.min(service.hullRepair, ship.hullMax - shipState.hull);
        const spares = Math.min(service.spares, ship.maxSpares - shipState.spares);
        if (fuel < 1 && hull < 1 && spares < 1) return reject('reject.serviceNotNeeded');
        shipState.fuel += fuel;
        shipState.hull += hull;
        shipState.spares += spares;
        state.servicedIds.push(here.id);
        emit('service', 'ok', 'event.service', { fuel: Math.round(fuel), hull: Math.round(hull), spares });
        return OK;
      }
      default:
        return reject('reject.invalid');
    }
  }

  refresh();

  return {
    state,
    catalog: cat,
    step(dtSeconds) {
      const from = pending.length;
      if (dtSeconds > 0 && Number.isFinite(dtSeconds)) accumulatorS += dtSeconds;
      while (accumulatorS >= FIXED_STEP_S - 1e-9) {
        accumulatorS -= FIXED_STEP_S;
        if (state.phase === 'docked' || state.phase === 'transit' || state.phase === 'landing' || state.phase === 'surface') fixedStep(FIXED_STEP_S);
      }
      return pending.slice(from);
    },
    apply(action) {
      const result = act(action);
      if (result.ok) {
        refresh();
        refreshWarnings();
        state.score = computeScore(state.stats);
      }
      return result;
    },
    takeEvents() {
      const out = pending;
      pending = [];
      return out;
    },
    estimateJump,
    estimateLanding,
    estimateTakeOff,
    snapshot() {
      return JSON.parse(JSON.stringify(state)) as RunState;
    },
  };
}
