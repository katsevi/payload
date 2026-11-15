/**
 * Simulación de una partida (run): la nave salta de destino en destino por un sector mientras la
 * tripulación mantiene vivos el casco, el oxígeno, el combustible y la energía.
 *
 * - Tiempo real con PASO FIJO (`FIXED_STEP_S`): `step(dt)` acumula y ejecuta los pasos que quepan,
 *   así que el resultado no depende de cómo se trocee el tiempo (misma semilla + mismas acciones en
 *   los mismos instantes = misma partida). Es lo que permitirá correrla en el servidor (fase 6).
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
import {
  affordableUnits, cargoFuelMult, cargoMassKg, cruisePowerMarginKw, effectiveShip, effectiveSurfaceRules, getEconomy, getUpgrades, hasShop, priceOf, sectorPriceMults,
  sellUnitPrice, stationOffer, upgradePrice, upgradesMassKg,
} from './economy';
import { designOperations, getDifficulty, parseMissionDesign, shipFromDesign } from './design';
import { generateSector, getNode, nodeDistanceLy } from './galaxy';
import { crewCarryCapacityKg, crewJetpackDrainPctPerS, crewPerks } from './roles';
import { createRng, deriveSeed, type Rng } from './rng';
import {
  bandIndex, callRecoveryPct, cohesionDeltaPctPerS, contactWindowOpen, effectivePsychRules, getPsychRules, psychPausedFor, psychRoll, sanityBandFor, sanityDebuffs, sanityDrainPctPerS,
  commsDelayMin,
} from './sanity';
import { finishMission, getScienceRules, loseWithShip, newScienceState, sciencePoints, scienceProfile, stepScience, type ScienceEvent } from './science';
import { findBody, generateSolarSector, getSolarSystem, getZone, solarKw } from './solar';
import { descentStep, generateSurface, getNodeWorld, landingSeed, lodeBonusApplies, simulateDescent, streakMultiplier, suitRefill, takeOffFuel } from './surface';
import {
  HAZARD_KINDS, INCIDENT_KINDS, ROLE_IDS, SUPPLY_IDS, SYSTEM_IDS, THROTTLE_IDS,
  type ActionResult, type Catalog, type CrewMember, type EventTone, type HazardKind, type Incident, type IncidentKind, type JumpEstimate,
  type LandingEstimate, type MessageRef, type PlannedHazard, type PoweredSystemId, type Run, type RunAction, type RunEvent, type RunEventType,
  type RunOptions, type RunState, type RunStats, type ShipDef, type ShipState, type SurfaceState, type SystemId, type SystemState,
  type HazardRules, type PlacedTool, type PsychRules, type SanityBand, type StationQuote, type SupplyId, type TakeOffEstimate, type ThrottleId,
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
    stats.sectorsCleared * 1000 + stats.jumps * 50 + stats.incidentsFixed * 20 + stats.impactsEvaded * 30 + stats.distanceLy + (stats.materialsValue ?? 0) +
      (stats.sciencePoints ?? 0),
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
  // Fase 4: con diseño, la nave sale del diseño y el mapa es el sistema solar (ADR 0016).
  // Un diseño mal formado lanza un error claro (`parseMissionDesign`); la copia validada no comparte listas.
  const design = options.design !== undefined ? parseMissionDesign(options.design) : undefined;
  const baseShip = design ? shipFromDesign(design, cat) : getShip(options.shipId, cat);
  const economy = getEconomy(cat);
  const upgrades: Record<string, number> = {};
  /** La nave efectiva (con mejoras): la que usa TODO el motor. Se recalcula al comprar una mejora. */
  let ship = effectiveShip(baseShip, upgrades, cat);
  const rules = cat.hazards;
  const seed = Math.trunc(options.seed) >>> 0;
  const wearRng = createRng(deriveSeed(seed, WEAR_SALT));
  const surfaceCat = getSurfaceCatalog(cat);
  /** Reglas de superficie efectivas (traje, jetpack y caídas con mejoras). */
  let srules = effectiveSurfaceRules(surfaceCat.rules, upgrades, cat);
  const crewSize = clamp(Math.trunc(options.crewSize ?? 1), 1, MAX_CREW);
  /** Fase 8: reglas de cordura efectivas (mejoras `crew` y módulos del diseño); null = sin cordura (juego de siempre). */
  const basePsych = getPsychRules(cat);
  /** Misión diseñada con `psychDrainMult: 0` (CubeSat guiado): la cordura queda en pausa (100). */
  const psychPaused = psychPausedFor(design, cat);
  let psychRules: PsychRules | null = basePsych ? effectivePsychRules(basePsych, upgrades, cat, design) : null;

  /** Mapa del sector `index`: el sistema solar con diseño (generado con la nave diseñada, sin mejoras); si no, el abstracto. */
  const makeSector = (index: number) =>
    design ? generateSolarSector(seed, index, baseShip, cat, design.destinationId) : generateSector(seed, index, cat, baseShip.id);
  const firstSector = makeSector(1);
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
    cargoKg: 0,
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
    crew: Array.from({ length: crewSize }, (_, i) => {
      const role = options.roles?.[i];
      return role && ROLE_IDS.includes(role) ? { ...newCrewMember(i + 1), role } : newCrewMember(i + 1);
    }),
    surface: null,
    stats: {
      timeS: 0, jumps: 0, distanceLy: 0, sectorsCleared: 0, incidentsFixed: 0, impactsTaken: 0, impactsEvaded: 0, kitsUsed: 0,
      landings: 0, hardLandings: 0, evas: 0, evaTimeS: 0, materialsCollected: 0, materialsStored: 0, materialsValue: 0, crewLost: 0,
      creditsEarned: 0, creditsSpent: 0, unitsSold: 0, upgradesBought: 0,
    },
    score: 0,
    credits: economy.startCredits,
    upgrades,
  };
  // Fase 5 (ADR 0018): ciencia, datos y ventanas de contacto, solo con diseño.
  // Fase 5 (ADR 0018 § 7): nivel de dificultad del diseño (desgaste, peligros y ventanas de contacto).
  const difficulty = design ? getDifficulty(design.difficultyId, cat) : null;
  const baseSciRules = design ? getScienceRules(cat) : null;
  const sciRules = baseSciRules && difficulty
    ? { ...baseSciRules, contactWindowS: Math.min(baseSciRules.contactPeriodS, baseSciRules.contactWindowS * difficulty.contactWindowMult) }
    : null;
  const hazardDifficulty = difficulty?.hazardMult ?? 1;
  const sciProfile = design ? scienceProfile(design, cat) : null;
  const homeZoneId = design ? getSolarSystem(cat).zones[0]?.id : undefined;
  // Fase 5 (ADR 0018 § 6): fiabilidad → más desgaste; calor por encima de los radiadores; batería que cubre la sobrecarga.
  const ops = design ? cat.design?.operations : undefined;
  const opsDesign = design && ops ? designOperations(design, cat) : null;
  const wearMult = (ops && opsDesign ? 1 + ops.reliabilityWearK * (1 - clamp(opsDesign.reliability, 0, 1)) : 1) * (difficulty?.wearMult ?? 1);
  if (design && ops && opsDesign) {
    shipState.batteryKwh = opsDesign.batteryKwh;
    shipState.batteryMaxKwh = opsDesign.batteryKwh;
    shipState.heatRejectKw = opsDesign.heatRejectKw;
    shipState.overheated = false;
  }
  if (design) {
    state.missionDesign = design;
    state.sunDistanceAu = firstSector.nodes.find((n) => n.id === firstSector.startId)?.sunDistanceAu ?? 1;
    shipState.solarSupplyKw = 0;
    state.science = newScienceState(sciProfile!);
    state.stats.scienceDelivered = 0;
    state.stats.sciencePoints = 0;
  }

  if (psychRules) {
    for (const c of state.crew) {
      Object.assign(c, { sanityPct: psychRules.startPct, sanityBand: 'stable' as SanityBand, awakeS: 0, restUntilS: 0, callProgressS: 0, callCooldownUntilS: 0, lapseCooldownUntilS: 0 });
    }
    state.psych = {
      steps: 0, sinceNoveltyS: 0, stationRecoveredPct: 0, provisions: 0, provisionsS: 0, callUntilS: 0, saleBonusUsed: false, missionDays: 0,
      ...(crewSize >= 2 ? { cohesionPct: psychRules.cohesion.start, cohesionBand: 'ok' as const } : {}),
    };
    Object.assign(state.stats, { sanityCriticalS: 0, restS: 0, callsMade: 0, provisionsUsed: 0, lapses: 0 });
  }

  let accumulatorS = 0;
  let eventSeq = 0;
  let incidentSeq = 0;
  let hazardSeq = 0;
  let toolSeq = 0;
  let pending: RunEvent[] = [];
  let wasOverloaded = false;
  let wasOverheated = false;
  let wasBlackout = false;
  const alerted = { oxygen: false, fuel: false, hull: false };

  const sys = shipState.systems;

  function emit(type: RunEventType, tone: EventTone, key: string, params?: MessageRef['params'], extra?: Pick<RunEvent, 'systemId' | 'incidentKind' | 'crewId' | 'subtype'>): void {
    pending.push({ id: ++eventSeq, type, tS: Math.round(state.stats.timeS * 10) / 10, tone, message: params ? { key, params } : { key }, ...extra });
  }

  /** Fase 4: distancia de la nave al Sol (UA): la del nodo, o interpolada en tránsito. 1 en sectores abstractos. */
  function sunDistanceAu(): number {
    const transit = state.transit;
    if (transit) {
      const a = getNode(state.sector, transit.fromId)?.sunDistanceAu ?? 1;
      const b = getNode(state.sector, transit.toId)?.sunDistanceAu ?? 1;
      return a + (b - a) * (transit.distanceLy > 0 ? Math.min(1, transit.traveledLy / transit.distanceLy) : 1);
    }
    return getNode(state.sector, state.locationId)?.sunDistanceAu ?? 1;
  }

  /** Parámetros de un nodo en los mensajes: los cuerpos reales van por id (nombre localizado en `catalog.<id>`). */
  function nodeMessage(base: 'event.arrived' | 'event.jump', node: { name: string; bodyId?: string }): { key: string; params: Record<string, string> } {
    return node.bodyId ? { key: `${base}Body`, params: { body: node.bodyId } } : { key: base, params: { node: node.name } };
  }

  // ── Estado derivado: cortos, energía, sistemas en línea y velocidad ─────────────────────────
  function refresh(): void {
    for (const idSys of SYSTEM_IDS) sys[idSys].shorted = false;
    for (const inc of state.incidents) if (inc.kind === 'short') sys[inc.systemId].shorted = true;

    const reactorUp = sys.reactor.healthPct > 0 && !sys.reactor.shorted;
    // Fase 4: los paneles dan menos lejos del Sol (1/d²); la parte nuclear no cambia. Sin paneles, como siempre.
    const solar = design ? solarKw(ship, sunDistanceAu()) : 0;
    const supply = reactorUp ? ((ship.reactorOutputKw + solar) * sys.reactor.healthPct) / 100 : 0;
    if (design) {
      state.sunDistanceAu = Math.round(sunDistanceAu() * 1000) / 1000;
      shipState.solarSupplyKw = reactorUp ? (solar * sys.reactor.healthPct) / 100 : 0;
    }
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
    // Fase 8: la llamada a la Tierra pide corriente mientras dura (compite con el régimen y los escudos).
    if (psychRules && state.psych && state.psych.callUntilS > state.stats.timeS + 1e-9) demand += psychRules.call.drawKw;
    sys.reactor.online = reactorUp;
    shipState.cargoKg = jumpMassKg();
    shipState.powerSupplyKw = supply;
    shipState.powerDemandKw = demand;
    shipState.overloaded = supply > 0 && demand > supply + 1e-9;
    shipState.speedLyPerS =
      state.phase === 'transit' && sys.engines.online && shipState.fuel > 0 ? cruiseSpeedLyPerS(ship, shipState.throttle, sys.engines.healthPct) : 0;

    if (shipState.overloaded && !wasOverloaded) emit('overload', 'warn', 'event.overload', undefined, { systemId: 'reactor' });
    wasOverloaded = shipState.overloaded;
    // Fase 5: calor. La demanda se convierte en calor; si pasa de lo que disipan los radiadores, el reactor sufre.
    if (shipState.heatRejectKw !== undefined) {
      shipState.overheated = demand > shipState.heatRejectKw + 1e-9;
      if (shipState.overheated && !wasOverheated) {
        emit('overheat', 'warn', 'event.overheat', { demandKw: Math.round(demand), heatKw: Math.round(shipState.heatRejectKw) }, { systemId: 'reactor' });
      }
      wasOverheated = shipState.overheated;
    }
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
    if (state.science) loseWithShip(state.science);
    emit('lost', 'bad', `loss.${reason}`);
  }

  // ── Ciencia (fase 5) ────────────────────────────────────────────────────────────────────────
  function emitScience(events: ScienceEvent[]): void {
    for (const e of events) emit(e.type, e.tone, e.key, e.params, e.subtype ? { subtype: e.subtype } : undefined);
    const sci = state.science;
    if (sci && sciRules) {
      state.stats.scienceDelivered = Math.round(sci.deliveredScience * 10) / 10;
      state.stats.sciencePoints = sciencePoints(sci, sciRules);
    }
  }

  /** Cuerpo observable ahora: atracada junto a un cuerpo real (no estación) o posada en él. */
  function observableBodyId(): string | null {
    if (state.phase !== 'docked' && state.phase !== 'surface') return null;
    const node = getNode(state.sector, state.locationId);
    if (!node?.bodyId || node.kind === 'station' || node.kind === 'gate') return null;
    return node.bodyId;
  }

  function stepScienceNow(dt: number): void {
    const sci = state.science;
    if (!sci || !sciRules || !sciProfile) return;
    const onGround = state.phase === 'landing' || state.phase === 'surface';
    emitScience(stepScience(sci, sciProfile, sciRules, {
      seed, timeS: state.stats.timeS, bodyId: observableBodyId(), onSurface: state.phase === 'surface', noLink: onGround,
      navOnline: sys.nav.online, sunDistanceAu: sunDistanceAu(),
    }, dt));
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
      const count = poisson(rng, perLy[kind] * state.sector.hazardMult * hazardDifficulty * span);
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
    shockAboard(psychRules?.shocks.impact ?? 0);
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

  // ── Economía (fase 3) ───────────────────────────────────────────────────────────────────────
  /** Masa a bordo que encarece los saltos: bodega + mejoras. */
  function jumpMassKg(): number {
    return cargoMassKg(shipState.cargo, cat) + upgradesMassKg(upgrades, cat);
  }

  /** Atracada en una estación con terminal (venta, tienda, emergencia y mejoras). */
  function atShop(): boolean {
    if (state.phase !== 'docked') return false;
    const here = getNode(state.sector, state.locationId);
    return !!here && hasShop(getNodeKind(here.kind, cat));
  }

  /** Lo que daría ahora la ayuda de emergencia (null si aquí no hay o ya se usó). */
  function emergencyGives(): { fuel: number; hull: number; spares: number } | null {
    if (!atShop() || state.servicedIds.includes(state.locationId)) return null;
    const e = economy.emergency;
    return {
      fuel: Math.max(0, (ship.fuelCapacity * e.fuelPct) / 100 - shipState.fuel),
      hull: Math.max(0, (ship.hullMax * e.hullPct) / 100 - shipState.hull),
      spares: Math.max(0, Math.min(ship.maxSpares, e.minSpares) - shipState.spares),
    };
  }

  function supplyUnitPrice(supply: SupplyId): number {
    return economy.supplyPrices[supply] * sectorPriceMults(economy, state.sector.index).buy;
  }

  /** Créditos que daría vender toda la bodega aquí. */
  function cargoSaleValue(): number {
    let total = 0;
    for (const [materialId, n] of Object.entries(shipState.cargo)) total += sellUnitPrice(economy, materialId, state.sector.index) * n;
    return total;
  }

  function earn(credits: number): void {
    state.credits += credits;
    state.stats.creditsEarned = (state.stats.creditsEarned ?? 0) + credits;
  }

  function spend(credits: number): void {
    state.credits -= credits;
    state.stats.creditsSpent = (state.stats.creditsSpent ?? 0) + credits;
  }

  /** Lo que falta para el máximo de un suministro (repuestos: enteros). */
  function supplyMissing(supply: SupplyId): number {
    if (supply === 'fuel') return Math.max(0, ship.fuelCapacity - shipState.fuel);
    if (supply === 'hull') return Math.max(0, ship.hullMax - shipState.hull);
    return Math.max(0, Math.floor(ship.maxSpares - shipState.spares));
  }

  function stationQuote(): StationQuote | null {
    if (!atShop()) return null;
    const idx = state.sector.index;
    const mults = sectorPriceMults(economy, idx);
    const sell = Object.entries(shipState.cargo)
      .filter(([, n]) => n > 0)
      .map(([materialId, units]) => {
        const unitPrice = sellUnitPrice(economy, materialId, idx);
        return { materialId, units, unitPrice, total: unitPrice * units };
      })
      .filter((x) => x.unitPrice > 0);
    const supplies = {} as StationQuote['supplies'];
    for (const k of SUPPLY_IDS) {
      const unitPrice = supplyUnitPrice(k);
      const missing = supplyMissing(k);
      supplies[k] = { unitPrice, missing, affordable: Math.min(missing, affordableUnits(state.credits, unitPrice)), fillCost: priceOf(missing, unitPrice) };
    }
    const em = emergencyGives();
    const spares = Math.floor(em?.spares ?? 0);
    const provisions = psychRules && state.psych ? provisionsOffer() : undefined;
    return {
      nodeId: state.locationId,
      credits: state.credits,
      sellMult: mults.sell,
      buyMult: mults.buy,
      sell,
      sellTotal: sell.reduce((sum, x) => sum + x.total, 0),
      supplies,
      emergency: { available: !!em && (em.fuel >= 1 || em.hull >= 1 || spares >= 1), fuel: em?.fuel ?? 0, hull: em?.hull ?? 0, spares },
      upgrades: stationOffer(seed, state.sector, state.locationId, cat).map((upgradeId) => {
        const def = getUpgrades(cat).find((u) => u.id === upgradeId)!;
        const level = upgrades[upgradeId] ?? 0;
        const next = level < def.levels.length ? level + 1 : null;
        const price = next === null ? null : upgradePrice(def, next, economy, idx);
        // Efecto eléctrico del siguiente nivel: margen a crucero con todo encendido, antes y después.
        const after = next === null ? ship : effectiveShip(baseShip, { ...upgrades, [upgradeId]: next }, cat);
        // Fase 4: con paneles, el margen depende de la distancia al Sol de la estación.
        const au = design ? sunDistanceAu() : 1;
        const marginAfter = cruisePowerMarginKw(after, au);
        return {
          upgradeId, level, maxLevel: def.levels.length, nextLevel: next, price,
          massKg: next === null ? 0 : def.levels[next - 1]!.massKg, affordable: price !== null && price <= state.credits,
          powerMarginDeltaKw: marginAfter - cruisePowerMarginKw(ship, au),
          overloadsAtCruise: marginAfter < -1e-9,
        };
      }),
      ...(provisions ? { provisions } : {}),
    };
  }

  /** Sin forma de seguir: sin motores/reactor ni repuestos, o sin combustible para ningún salto. */
  function isStranded(): boolean {
    const dead = (sys.engines.healthPct <= 0 || sys.reactor.healthPct <= 0) && shipState.spares <= 0;
    if (state.phase === 'transit') return dead || shipState.fuel <= 0;
    if (state.phase === 'surface') return isStrandedOnSurface(dead);
    if (state.phase !== 'docked') return false;
    // En una estación cuenta lo que se puede conseguir: emergencia, créditos y la venta de la bodega.
    const em = emergencyGives();
    const shop = atShop();
    const purse = shop ? state.credits + cargoSaleValue() : 0;
    if (dead && !(em && em.spares >= 1) && !(shop && purse >= priceOf(1, supplyUnitPrice('spares')))) return true;
    const here = getNode(state.sector, state.locationId)!;
    const health = shipState.spares > 0 || dead ? 100 : sys.engines.healthPct;
    // Vendiendo la bodega solo queda la masa de las mejoras.
    const mult = cargoFuelMult(economy, shop ? upgradesMassKg(upgrades, cat) : jumpMassKg());
    const afterAid = shipState.fuel + (em?.fuel ?? 0);
    // Lo comprable no pasa de la capacidad del depósito.
    const reachable = shop ? Math.min(ship.fuelCapacity, afterAid + affordableUnits(purse, supplyUnitPrice('fuel'))) : afterAid;
    return here.links.every((idNext) => nodeDistanceLy(here, getNode(state.sector, idNext)!) * fuelPerLy(ship, 'eco', health) * mult > reachable + 1e-9);
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
    if (state.science && node.missionTarget) state.science.targetVisited = true;
    const arrivedMsg = nodeMessage('event.arrived', node);
    emit('arrived', 'info', arrivedMsg.key, arrivedMsg.params);
    psychArrive(firstVisit);
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
      if (psychRules) for (const m of state.crew) if (m.alive) addSanity(m, psychRules.rewards.sectorCleared);
      // Contrato del sector: pago fijo × multiplicador de venta del sector.
      const reward = Math.round(economy.sectorRewardCredits * sectorPriceMults(economy, state.sector.index).sell);
      if (reward > 0) {
        earn(reward);
        emit('reward', 'ok', 'event.sectorReward', { credits: reward });
      }
      // Fase 5: de vuelta en la Tierra tras visitar el destino, la misión termina.
      const sci = state.science;
      if (sci && sciRules && sci.targetVisited && state.sector.zoneToId === homeZoneId) emitScience(finishMission(sci, sciRules));
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
    // Fase 5: con batería cargada, el déficit sale de ella y el reactor no se daña; con excedente, se recarga.
    const battery = shipState.batteryKwh;
    if (shipState.overloaded) {
      if (ops && battery !== undefined && battery > 0) {
        const next = Math.max(0, battery - (shipState.powerDemandKw - shipState.powerSupplyKw) * dt * ops.batteryKwhPerKwS);
        shipState.batteryKwh = next;
        if (next <= 0) emit('battery-empty', 'warn', 'event.batteryEmpty', undefined, { systemId: 'reactor' });
      } else damageSystem('reactor', ship.overloadReactorDamagePctPerS * dt);
    } else if (ops && battery !== undefined && shipState.powerSupplyKw > 0) {
      const surplus = Math.max(0, shipState.powerSupplyKw - shipState.powerDemandKw);
      shipState.batteryKwh = Math.min(shipState.batteryMaxKwh ?? 0, battery + surplus * dt * ops.batteryKwhPerKwS * ops.batteryRechargeEff);
    }
    if (ops && shipState.overheated && shipState.heatRejectKw !== undefined) {
      const excessKw = shipState.powerDemandKw - shipState.heatRejectKw;
      damageSystem('reactor', Math.min(ops.heatDamageMaxPctPerS, ops.heatDamagePctPerSPerKw * excessKw) * dt);
    }

    // Tránsito
    const transit = state.transit;
    if (transit && state.phase === 'transit') {
      // Desgaste (siempre se consumen las mismas tiradas por paso)
      const wearRoll = wearRng.next();
      const kindRoll = wearRng.next();
      const sysRoll = wearRng.next();
      if (wearRoll < rules.wear.chancePerS * getThrottle(ship, shipState.throttle).wearMult * wearMult * dt) {
        spawnIncident(pickWearKind(kindRoll), SYSTEM_IDS[Math.floor(sysRoll * SYSTEM_IDS.length)]!);
      }

      const remaining = transit.distanceLy - transit.traveledLy;
      const stepLy = Math.min(remaining, shipState.speedLyPerS * dt);
      if (stepLy > 0) {
        shipState.fuel = Math.max(0, shipState.fuel - stepLy * fuelPerLy(ship, shipState.throttle, sys.engines.healthPct) * cargoFuelMult(economy, shipState.cargoKg ?? 0));
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
      if (wearRoll < rules.wear.chancePerS * world.shipWearMult * wearMult * dt) spawnIncident(pickWearKind(kindRoll), SYSTEM_IDS[Math.floor(sysRoll * SYSTEM_IDS.length)]!);
      if (state.phase === 'landing') stepDescent(surface, dt);
      else {
        stepSurface(surface, dt);
        stepTools(surface, dt);
      }
    }

    refresh();
    refreshWarnings();
    if (state.phase !== 'won') stepScienceNow(dt);

    stepPsych(dt);

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
    if (psychRules) {
      for (const o of state.crew) if (o.alive) addSanity(o, -psychRules.shocks.crewDeath);
      if (state.psych?.cohesionPct !== undefined) state.psych.cohesionPct = clamp(state.psych.cohesionPct - psychRules.shocks.crewDeathCohesion, 0, 100);
    }
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
    const capacityKg = crewCarryCapacityKg(srules, m, cat, psychRules);
    const room = Math.floor((capacityKg - m.carriedKg + 1e-9) / mat.massKg);
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
      emit('material-collected', 'ok', 'event.pickedUp', { units: n, material: mat.id, kg: Math.round(m.carriedKg), capacity: Math.round(capacityKg) }, lodeMult > 1 ? { crewId: m.id, subtype: 'lode' } : { crewId: m.id });
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
    if (state.psych) state.psych.sinceNoveltyS = 0;
    const d = srules.descent;
    const excess = speed - d.safeSpeedMps;
    if (excess <= 0) {
      emit('landing', 'ok', 'event.landing.soft', { speed: round1(speed) }, { subtype: 'soft' });
      return;
    }
    surface.hardLanding = true;
    state.stats.hardLandings++;
    shockAboard(psychRules?.shocks.hardLanding ?? 0);
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
      m.suitO2Pct = Math.max(0, m.suitO2Pct - (suit.o2DrainPctPerS * sanityDebuffs(m, psychRules).suitO2 + stormDrain) * dt);
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
    if (psychRules && value > 0) addSanity(m, Math.min(psychRules.rewards.storedMax, (value / 100) * psychRules.rewards.storedPer100));
    clearCarried(m);
    emit('cargo-stored', 'ok', 'event.cargoStored', { units, value: Math.round(value) }, { crewId: m.id, subtype: 'stored' });
    if (fuelGain > 0 || sparesGain > 0) emit('cargo-stored', 'ok', 'event.cargoProcessed', { fuel: Math.round(fuelGain), spares: sparesGain }, { crewId: m.id, subtype: 'processed' });
  }

  /**
   * Fase 6: ritmo de trabajo de quien repara (ventaja del ingeniero si actúa él, vivo y a bordo).
   * Fase 8: con cordura, × el debuff de su banda (en solitario sin `crewId`, el primer vivo) y × el trabajo en equipo.
   */
  function workMult(crewId: number | undefined, inc?: Incident): number {
    if (!psychRules) {
      if (crewId === undefined) return 1;
      const m = state.crew.find((c) => c.id === crewId && c.alive && c.location === 'ship');
      return crewPerks(m, cat).repairSpeedMult ?? 1;
    }
    const m = crewId === undefined ? state.crew.find((c) => c.alive) : state.crew.find((c) => c.id === crewId && c.alive && c.location === 'ship');
    const perk = crewId === undefined ? 1 : (crewPerks(m, cat).repairSpeedMult ?? 1);
    const team = inc && (inc.workers?.length ?? 0) >= 2 && (state.psych?.cohesionPct ?? 0) >= psychRules.cohesion.teamworkMinPct ? psychRules.cohesion.teamworkMult : 1;
    return perk * sanityDebuffs(m, psychRules).work * team;
  }

  // ── Cordura (fase 8) ────────────────────────────────────────────────────────────────────────
  function addSanity(m: CrewMember, delta: number): void {
    if (m.sanityPct === undefined || psychPaused) return;
    m.sanityPct = clamp(m.sanityPct + delta, 0, 100);
  }

  /** Golpe instantáneo a todos los que van a bordo. */
  function shockAboard(pct: number): void {
    if (!psychRules || pct <= 0) return;
    for (const m of state.crew) if (m.alive && m.location === 'ship') addSanity(m, -pct);
  }

  /** Recompensa de trabajo: a quien actúa (`crewId`) o al primer vivo. */
  function rewardActor(crewId: number | undefined, pct: number): void {
    if (!psychRules || pct <= 0) return;
    const m = crewId === undefined ? state.crew.find((c) => c.alive) : state.crew.find((c) => c.id === crewId && c.alive);
    if (m) addSanity(m, pct);
  }

  /** Registra quién trabaja en una avería (cohesión por reparar en grupo). */
  function noteWorker(inc: Incident, crewId: number | undefined): void {
    if (!psychRules) return;
    const id = crewId ?? state.crew.find((c) => c.alive)?.id;
    if (id === undefined) return;
    const list = (inc.workers ??= []);
    if (!list.includes(id)) list.push(id);
  }

  function psychArrive(firstVisit: boolean): void {
    const ps = state.psych;
    if (!ps || !psychRules) return;
    if (firstVisit) ps.sinceNoveltyS = 0;
    ps.stationRecoveredPct = 0;
    ps.saleBonusUsed = false;
    if (atShop()) {
      const gain = Math.min(psychRules.station.arrivalPct, psychRules.station.capPct);
      ps.stationRecoveredPct = gain;
      for (const m of state.crew) if (m.alive) addSanity(m, gain);
    }
  }

  function provisionsOffer(): { unitPrice: number; missing: number; affordable: number } {
    const unitPrice = psychRules!.provisions.unitPrice * sectorPriceMults(economy, state.sector.index).buy;
    const missing = Math.max(0, psychRules!.provisions.maxUnits - (state.psych?.provisions ?? 0));
    return { unitPrice, missing, affordable: Math.min(missing, affordableUnits(state.credits, unitPrice)) };
  }

  /** Radiación intensa en la zona del nodo actual (o de destino en tránsito): solo con diseño. */
  function inRadiation(): boolean {
    if (!design) return false;
    const nodeId = state.transit ? state.transit.toId : state.locationId;
    const bodyId = getNode(state.sector, nodeId)?.bodyId;
    const zoneId = bodyId ? findBody(bodyId, cat)?.zoneId : undefined;
    return !!zoneId && !!getZone(zoneId, cat).radiation;
  }

  function dropLowestUnit(m: CrewMember): string | null {
    let pick: string | null = null;
    let best = Infinity;
    for (const [materialId, count] of Object.entries(m.carried).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (count <= 0) continue;
      const unitValue = (m.carriedValues[materialId] ?? 0) / count;
      if (unitValue < best) {
        best = unitValue;
        pick = materialId;
      }
    }
    if (!pick) return null;
    const mat = getMaterial(pick, cat);
    const unitValue = best;
    m.carried[pick] = (m.carried[pick] ?? 0) - 1;
    m.carriedValues[pick] = (m.carriedValues[pick] ?? 0) - unitValue;
    if (m.carried[pick]! <= 0) {
      delete m.carried[pick];
      delete m.carriedValues[pick];
    }
    m.carriedKg = Math.max(0, m.carriedKg - mat.massKg);
    m.carriedValue = Math.max(0, m.carriedValue - unitValue);
    m.carriedUnits = Math.max(0, m.carriedUnits - 1);
    if (mat.streak) {
      m.streakUnits = Math.max(0, m.streakUnits - 1);
      m.streakMult = streakMultiplier(srules, m.streakUnits);
    }
    return pick;
  }

  /** Cordura de cada tripulante: drenaje o recuperación, bandas, lapsus y cohesión (un paso fijo, tras `refreshWarnings`). */
  function stepPsych(dt: number): void {
    const pr = psychRules;
    const ps = state.psych;
    if (!pr || !ps) return;
    const t = state.stats.timeS;
    ps.steps++;
    ps.missionDays = Math.round(t * pr.daysPerS * 10) / 10;
    ps.sinceNoveltyS += dt;
    if (ps.provisions > 0 && state.phase === 'transit') {
      ps.provisionsS += dt;
      if (ps.provisionsS >= pr.provisions.secondsPerUnit - 1e-9) {
        ps.provisionsS = 0;
        ps.provisions--;
        state.stats.provisionsUsed = (state.stats.provisionsUsed ?? 0) + 1;
      }
    }
    const provisioned = ps.provisions > 0;
    const station = atShop();
    const alive = state.crew.filter((c) => c.alive);
    const calling = ps.callUntilS > t + 1e-9;
    const stationGain = station ? Math.max(0, Math.min(pr.station.recoverPctPerS * dt, pr.station.capPct - ps.stationRecoveredPct)) : 0;
    ps.stationRecoveredPct += stationGain;
    const lowO2 = shipState.oxygenPct < rules.alerts.lowOxygenPct;
    const storm = !!state.surface?.storm.active;
    const radiation = inRadiation();
    const au = design ? sunDistanceAu() : undefined;
    const base = pr.drainMult ?? 1;
    const managerAura = alive.filter((c) => c.location === 'ship').map((c) => ({ id: c.id, mult: crewPerks(c, cat).sanityAuraMult ?? 1 })).filter((x) => x.mult !== 1);

    for (const m of alive) {
      if (m.sanityPct === undefined) continue;
      m.awakeS = (m.awakeS ?? 0) + dt;
      if (!calling && (m.callProgressS ?? 0) > 0) m.callProgressS = 0;
      if (station) addSanity(m, stationGain);
      else {
        const context = state.phase === 'surface' ? (m.location === 'eva' ? 'eva' : 'surfaceAboard') : state.phase === 'docked' ? 'docked' : 'transit';
        const aura = managerAura.reduce((acc, x) => (x.id === m.id ? acc : acc * x.mult), 1);
        const drain = sanityDrainPctPerS({
          context, sectorIndex: state.sector.index, ...(au !== undefined ? { sunDistanceAu: au } : {}), radiation, sinceNoveltyS: ps.sinceNoveltyS,
          awakeS: m.awakeS, ...(ps.cohesionPct !== undefined ? { cohesionPct: ps.cohesionPct } : {}),
          mitigation: (provisioned ? pr.provisions.drainMult : 1) * base * aura,
          activeIncidents: state.incidents.length, lowShipO2: lowO2, stormEva: storm && m.location === 'eva',
          suitCritical: m.location === 'eva' && m.suitO2Pct < srules.suit.criticalO2Pct,
        }, pr);
        addSanity(m, -drain * dt);
      }
      // Bandas con histéresis
      const prev = m.sanityBand ?? 'stable';
      const next = sanityBandFor(m.sanityPct, prev, pr);
      if (next !== prev) {
        m.sanityBand = next;
        const down = bandIndex(next) > bandIndex(prev);
        const sub = down ? (next as 'tense' | 'critical' | 'breakdown') : 'recovered';
        emit('crew-sanity', down ? (next === 'tense' ? 'warn' : 'bad') : 'ok', `event.sanity.${sub}`, { name: `#${m.id}` }, { crewId: m.id, subtype: sub });
      }
      const idx = bandIndex(m.sanityBand ?? 'stable');
      if (idx >= 2) state.stats.sanityCriticalS = (state.stats.sanityCriticalS ?? 0) + dt;
      // Lapsus: tirada sin estado (no toca ningún otro flujo de azar)
      const rate = sanityDebuffs(m, pr).lapsePerS;
      if (rate > 0 && (m.lapseCooldownUntilS ?? 0) <= t) {
        const roll = psychRoll(seed, ps.steps, m.id);
        const p = rate * dt;
        if (roll < p) {
          const pickRoll = roll / p;
          if (m.location === 'eva') {
            const material = dropLowestUnit(m);
            if (material) {
              m.lapseCooldownUntilS = t + pr.lapse.cooldownS;
              state.stats.lapses = (state.stats.lapses ?? 0) + 1;
              emit('crew-lapse', 'warn', 'event.lapse.drop', { material }, { crewId: m.id, subtype: 'drop' });
            }
          } else if (state.phase !== 'landing') {
            const options = pr.lapse.systems.filter((id) => sys[id].enabled);
            const target = options[Math.min(options.length - 1, Math.floor(pickRoll * options.length))];
            if (target) {
              sys[target].enabled = false;
              m.lapseCooldownUntilS = t + pr.lapse.cooldownS;
              state.stats.lapses = (state.stats.lapses ?? 0) + 1;
              emit('crew-lapse', 'warn', 'event.lapse.switch', { system: target }, { crewId: m.id, systemId: target, subtype: 'switch' });
            }
          }
        }
      }
    }

    // Cohesión (solo con 2 o más vivos)
    if (alive.length >= 2) {
      let c = ps.cohesionPct ?? pr.cohesion.start;
      c += (cohesionDeltaPctPerS(state.crew, pr) + (station ? pr.station.cohesionPctPerS : 0)) * dt;
      c = clamp(c, 0, 100);
      ps.cohesionPct = c;
      const wasLow = ps.cohesionBand === 'low';
      if (!wasLow && c < pr.cohesion.lowPct) {
        ps.cohesionBand = 'low';
        emit('cohesion', 'warn', 'event.cohesion.low', undefined, { subtype: 'low' });
      } else if (wasLow && c >= pr.cohesion.lowPct + pr.bands.hysteresisPct) {
        ps.cohesionBand = 'ok';
        emit('cohesion', 'ok', 'event.cohesion.recovered', undefined, { subtype: 'recovered' });
      } else if (!ps.cohesionBand) ps.cohesionBand = 'ok';
    } else {
      delete ps.cohesionPct;
      delete ps.cohesionBand;
    }
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
      if (state.psych) state.psych.sinceNoveltyS = 0;
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
        m.jetpackPct = Math.max(0, m.jetpackPct - seconds * crewJetpackDrainPctPerS(srules, m, cat, psychRules));
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

  // ── Terminal de estación (fase 3) ───────────────────────────────────────────────────────────
  function actShop(action: Extract<RunAction, { type: 'sell' | 'buy-supply' | 'buy-upgrade' }>): ActionResult {
    const idx = state.sector.index;
    if (action.type === 'sell') {
      const ids = action.materialId === undefined ? Object.keys(shipState.cargo) : [String(action.materialId)];
      let units = 0;
      let credits = 0;
      for (const materialId of ids) {
        const have = shipState.cargo[materialId] ?? 0;
        const unitPrice = sellUnitPrice(economy, materialId, idx);
        if (have <= 0 || unitPrice <= 0) continue;
        const wanted = action.materialId !== undefined && action.units !== undefined ? Math.trunc(Number(action.units) || 0) : have;
        const n = clamp(wanted, 0, have);
        if (n <= 0) continue;
        if (n === have) delete shipState.cargo[materialId];
        else shipState.cargo[materialId] = have - n;
        units += n;
        credits += n * unitPrice;
      }
      if (units <= 0) return reject('reject.nothingToSell');
      // Lo vendido ya puntuó al guardarlo en la bodega (stats.materialsValue): vender no cambia la puntuación.
      earn(credits);
      state.stats.unitsSold = (state.stats.unitsSold ?? 0) + units;
      emit('sale', 'ok', 'event.sold', { units, credits });
      if (psychRules && state.psych && !state.psych.saleBonusUsed) {
        state.psych.saleBonusUsed = true;
        rewardActor(undefined, psychRules.rewards.sale);
      }
      return OK;
    }
    if (action.type === 'buy-supply') {
      const supply = action.supply;
      if (!SUPPLY_IDS.includes(supply)) return reject('reject.invalid');
      const unitPrice = supplyUnitPrice(supply);
      const room = supplyMissing(supply);
      if (room < (supply === 'spares' ? 1 : 0.5)) return reject('reject.supplyFull');
      const wanted = action.amount === undefined ? room : Math.max(0, Number(action.amount) || 0);
      let amount = Math.min(room, wanted, affordableUnits(state.credits, unitPrice));
      // Por unidades enteras, salvo para rematar lo que falta de combustible o casco.
      if (supply === 'spares' || amount < room) amount = Math.floor(amount);
      if (amount <= 0) return reject(wanted <= 0 ? 'reject.invalid' : 'reject.noCredits', wanted <= 0 ? undefined : { credits: priceOf(Math.min(1, room), unitPrice) });
      const cost = priceOf(amount, unitPrice);
      spend(cost);
      if (supply === 'fuel') shipState.fuel = Math.min(ship.fuelCapacity, shipState.fuel + amount);
      else if (supply === 'hull') shipState.hull = Math.min(ship.hullMax, shipState.hull + amount);
      else shipState.spares += amount;
      emit('purchase', 'ok', `event.purchase.${supply}`, { amount: Math.round(amount), credits: cost }, { subtype: supply });
      return OK;
    }
    const def = getUpgrades(cat).find((u) => u.id === action.upgradeId);
    if (!def) return reject('reject.invalid');
    if (!stationOffer(seed, state.sector, state.locationId, cat).includes(def.id)) return reject('reject.notOffered');
    const level = upgrades[def.id] ?? 0;
    if (level >= def.levels.length) return reject('reject.upgradeMaxed');
    const price = upgradePrice(def, level + 1, economy, idx)!;
    if (price > state.credits) return reject('reject.noCredits', { credits: price });
    spend(price);
    upgrades[def.id] = level + 1;
    state.stats.upgradesBought = (state.stats.upgradesBought ?? 0) + 1;
    ship = effectiveShip(baseShip, upgrades, cat);
    srules = effectiveSurfaceRules(surfaceCat.rules, upgrades, cat);
    if (basePsych) psychRules = effectivePsychRules(basePsych, upgrades, cat, design);
    // Un depósito o casco mayor no se llena solo; si alguna mejora los redujera, se recorta lo que sobra.
    shipState.fuel = Math.min(shipState.fuel, ship.fuelCapacity);
    shipState.hull = Math.min(shipState.hull, ship.hullMax);
    shipState.spares = Math.min(shipState.spares, ship.maxSpares);
    emit('upgrade', 'ok', 'event.upgrade', { upgrade: def.id, level: level + 1, credits: price });
    return OK;
  }

  // ── Acciones ────────────────────────────────────────────────────────────────────────────────
  function estimateJump(toId: string): JumpEstimate | null {
    const here = getNode(state.sector, state.locationId);
    const to = getNode(state.sector, toId);
    if (!here || !to || !here.links.includes(toId)) return null;
    const distanceLy = nodeDistanceLy(here, to);
    const health = sys.engines.healthPct;
    const cargoKg = jumpMassKg();
    const mult = cargoFuelMult(economy, cargoKg);
    const byThrottle = {} as JumpEstimate['byThrottle'];
    for (const t of THROTTLE_IDS) {
      const fuel = distanceLy * fuelPerLy(ship, t, health) * mult;
      const speed = cruiseSpeedLyPerS(ship, t, health);
      byThrottle[t] = { fuel, timeS: speed > 0 ? distanceLy / speed : -1, enoughFuel: fuel <= shipState.fuel };
    }
    const perLy = getNodeKind(to.kind, cat).hazardPerLy;
    const span = Math.max(0, distanceLy - cat.sector.safeStartLy - 0.5);
    const expectedHazards = {} as JumpEstimate['expectedHazards'];
    let risk = 0;
    for (const k of HAZARD_KINDS) {
      expectedHazards[k] = perLy[k] * state.sector.hazardMult * hazardDifficulty * span;
      risk += expectedHazards[k] * RISK_WEIGHT[k];
    }
    return { toId, distanceLy, cargoKg, cargoFuelMult: mult, byThrottle, expectedHazards, riskLevel: RISK_THRESHOLDS.filter((t) => risk >= t).length };
  }

  // ── Descanso y llamada (fase 8) ─────────────────────────────────────────────────────────────
  /** El tripulante que actúa está en la litera (el descanso se mantiene `restUntilS`). */
  function isResting(crewId: number | undefined): boolean {
    if (!psychRules) return false;
    const m = findMember(crewId);
    return !!m && (m.restUntilS ?? 0) > state.stats.timeS + 1e-9;
  }

  function actRest(action: Extract<RunAction, { type: 'rest' }>): ActionResult {
    const pr = psychRules;
    if (!pr || !state.psych) return reject('reject.invalid');
    const m = findMember(action.crewId);
    if (!m) return reject('reject.crewDead');
    if (state.phase === 'landing') return reject('reject.restDescent');
    if (m.location === 'eva') return reject('reject.restEva');
    if ((m.sanityPct ?? 100) >= 99 && (m.awakeS ?? 0) < pr.awakeGraceS) return reject('reject.restNotNeeded');
    const seconds = clamp(Number(action.seconds) || 0, 0, MAX_WORK_SECONDS);
    const alarm = state.incidents.some((i) => i.kind === 'fire' || i.kind === 'leak');
    const mult = (crewPerks(m, cat).sanityRecoverMult ?? 1) * (alarm ? pr.rest.alarmMult : 1);
    const t = state.stats.timeS;
    const wasResting = (m.restUntilS ?? 0) > t + 1e-9;
    addSanity(m, seconds * pr.rest.recoverPctPerS * mult);
    const hadAwake = (m.awakeS ?? 0) > 0;
    m.awakeS = Math.max(0, (m.awakeS ?? 0) - seconds * pr.rest.awakeRecoverMult);
    m.restUntilS = t + 0.6;
    state.stats.restS = (state.stats.restS ?? 0) + seconds;
    if (!wasResting) emit('crew-rest', 'info', 'event.rest.start', { name: `#${m.id}` }, { crewId: m.id, subtype: 'start' });
    if (hadAwake && m.awakeS === 0) emit('crew-rest', 'ok', 'event.rest.done', { name: `#${m.id}` }, { crewId: m.id, subtype: 'done' });
    return OK;
  }

  function actCall(action: Extract<RunAction, { type: 'call-earth' }>): ActionResult {
    const pr = psychRules;
    const ps = state.psych;
    if (!pr || !ps) return reject('reject.invalid');
    if (state.phase !== 'transit' && state.phase !== 'docked') return reject('reject.callPhase');
    const m = findMember(action.crewId);
    if (!m) return reject('reject.crewDead');
    const t = state.stats.timeS;
    if ((m.restUntilS ?? 0) > t + 1e-9) return reject('reject.crewResting');
    if (!sys.nav.online) return reject('reject.callNoNav');
    if ((m.callCooldownUntilS ?? 0) > t + 1e-9) return reject('reject.callCooldown');
    if (!contactWindowOpen(state, sciRules)) return reject('reject.callNoWindow');
    const baseDemand = shipState.powerDemandKw - (ps.callUntilS > t + 1e-9 ? pr.call.drawKw : 0);
    if (shipState.powerSupplyKw - baseDemand < pr.call.drawKw - 1e-9) return reject('reject.callPower');
    const seconds = clamp(Number(action.seconds) || 0, 0, MAX_WORK_SECONDS);
    m.callProgressS = (m.callProgressS ?? 0) + seconds;
    ps.callUntilS = t + 0.6;
    if (m.callProgressS >= pr.call.seconds - 1e-9) {
      const au = design ? sunDistanceAu() : 1 + 0.75 * (state.sector.index - 1);
      const solo = state.crew.filter((c) => c.alive).length === 1;
      const pct = callRecoveryPct(pr, au, solo, crewPerks(m, cat).sanityRecoverMult ?? 1);
      addSanity(m, pct);
      m.callProgressS = 0;
      m.callCooldownUntilS = t + pr.call.cooldownS;
      ps.callUntilS = t;
      state.stats.callsMade = (state.stats.callsMade ?? 0) + 1;
      emit('earth-call', 'ok', 'event.earthCall', { pct: Math.round(pct * 10) / 10, delayMin: Math.round(commsDelayMin(au)) }, { crewId: m.id });
    }
    return OK;
  }

  function act(action: RunAction): ActionResult {
    if (state.phase === 'lost') return reject('reject.runOver');
    if (action.type === 'next-sector') {
      if (state.phase !== 'won') return reject('reject.notAtGate');
      if (state.science?.over) return reject('reject.missionOver');
      const sector = makeSector(state.sector.index + 1);
      state.sector = sector;
      state.locationId = sector.startId;
      state.visitedIds = [sector.startId];
      state.servicedIds = [];
      state.landedIds = [];
      state.phase = 'docked';
      if (state.psych) Object.assign(state.psych, { sinceNoveltyS: 0, stationRecoveredPct: 0, saleBonusUsed: false });
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
        const jumpMsg = nodeMessage('event.jump', to);
        emit('jump', 'info', jumpMsg.key, { ...jumpMsg.params, distanceLy: Math.round(estimate.distanceLy) });
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
        if (isResting(action.crewId)) return reject('reject.crewResting');
        noteWorker(inc, action.crewId);
        const seconds = clamp(Number(action.seconds) || 0, 0, MAX_WORK_SECONDS) * workMult(action.crewId, inc);
        inc.progress += seconds / rules.incidents[inc.kind].repairS;
        if (inc.progress >= 1) {
          state.incidents.splice(state.incidents.indexOf(inc), 1);
          state.stats.incidentsFixed++;
          if (psychRules) {
            rewardActor(action.crewId, psychRules.rewards.incidentFixed);
            const workers = (inc.workers ?? []).filter((id) => state.crew.some((c) => c.id === id && c.alive));
            if (workers.length >= 2) {
              if (state.psych?.cohesionPct !== undefined) state.psych.cohesionPct = clamp(state.psych.cohesionPct + psychRules.cohesion.groupRepairPct, 0, 100);
              for (const id of workers) addSanity(state.crew.find((c) => c.id === id)!, psychRules.cohesion.groupRepairSanity);
            }
          }
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
        if (isResting(action.crewId)) return reject('reject.crewResting');
        const seconds = clamp(Number(action.seconds) || 0, 0, MAX_WORK_SECONDS) * workMult(action.crewId);
        s.repairProgress += seconds / rules.repair.kitRepairS;
        if (s.repairProgress >= 1) {
          s.repairProgress = 0;
          shipState.spares--;
          state.stats.kitsUsed++;
          s.healthPct = Math.min(100, s.healthPct + rules.repair.kitRestorePct);
          emit('system-repaired', 'ok', 'event.systemRepaired', { system: action.systemId }, { systemId: action.systemId });
          rewardActor(action.crewId, psychRules?.rewards.systemRepaired ?? 0);
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
        // Fase 6: la ventaja del piloto solo cuenta si la maniobra la hace él (y está vivo y a bordo).
        const pilot = action.crewId === undefined ? null : state.crew.find((c) => c.id === action.crewId && c.alive && c.location === 'ship');
        const perks = crewPerks(pilot, cat);
        if (isResting(action.crewId)) return reject('reject.crewResting');
        const evadeFuel = ship.evadeFuel * (perks.evadeFuelMult ?? 1);
        if (shipState.fuel < evadeFuel) return reject('reject.notEnoughFuel');
        shipState.fuel -= evadeFuel;
        hazard.evaded = true;
        // Esquiva por habilidad: el cliente informa los roces del minijuego; el motor cobra.
        if (action.grazes !== undefined && rules.impact.evade) hazard.evadeDamageFrac = evadeDamageFraction(rules, Number(action.grazes) || 0) * (perks.evadeDamageMult ?? 1) * sanityDebuffs(findMember(action.crewId), psychRules).evadeDamage;
        return OK;
      }
      case 'service': {
        // Fase 3: ayuda de emergencia gratuita (sustituye al servicio gratuito; ver ADR 0014).
        if (onSurface) return reject('reject.onSurface');
        if (state.phase !== 'docked') return reject('reject.inTransit');
        if (!atShop()) return reject('reject.noService');
        const gives = emergencyGives();
        if (!gives) return reject('reject.serviceUsed');
        const spares = Math.floor(gives.spares);
        if (gives.fuel < 1 && gives.hull < 1 && spares < 1) return reject('reject.serviceNotNeeded');
        shipState.fuel += gives.fuel;
        shipState.hull += gives.hull;
        shipState.spares += spares;
        state.servicedIds.push(state.locationId);
        emit('service', 'ok', 'event.service', { fuel: Math.round(gives.fuel), hull: Math.round(gives.hull), spares });
        return OK;
      }
      case 'rest':
        return actRest(action);
      case 'call-earth':
        return actCall(action);
      case 'buy-provisions': {
        const ps = state.psych;
        if (!psychRules || !ps) return reject('reject.invalid');
        if (onSurface) return reject('reject.onSurface');
        if (state.phase !== 'docked') return reject('reject.inTransit');
        if (!atShop()) return reject('reject.notAtStation');
        const offer = provisionsOffer();
        if (offer.missing < 1) return reject('reject.provisionsFull');
        const wanted = action.amount === undefined ? offer.missing : Math.max(0, Math.trunc(Number(action.amount) || 0));
        const n = Math.min(offer.missing, wanted, offer.affordable);
        if (n <= 0) return reject(wanted <= 0 ? 'reject.invalid' : 'reject.noCredits', wanted <= 0 ? undefined : { credits: priceOf(1, offer.unitPrice) });
        const cost = priceOf(n, offer.unitPrice);
        spend(cost);
        ps.provisions += n;
        emit('purchase', 'ok', 'event.purchase.provisions', { amount: n, credits: cost });
        return OK;
      }
      case 'sell':
      case 'buy-supply':
      case 'buy-upgrade':
        if (onSurface) return reject('reject.onSurface');
        if (state.phase !== 'docked') return reject('reject.inTransit');
        if (!atShop()) return reject('reject.notAtStation');
        return actShop(action);
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
    stationQuote,
    // Objetos vivos del motor (solo lectura para quien consume, como `state`); cambian al comprar una mejora.
    effectiveShip() {
      return ship;
    },
    effectiveSurfaceRules() {
      return srules;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(state)) as RunState;
    },
    hydrate(next) {
      const copy = JSON.parse(JSON.stringify(next)) as RunState;
      // El motor guarda referencias a `state.ship`, sus sistemas y `state.upgrades`: se rellenan en el sitio.
      const { ship: nextShip, upgrades: nextUpgrades, ...rest } = copy;
      const { systems: nextSystems, ...shipRest } = nextShip;
      Object.assign(state, rest);
      Object.assign(shipState, shipRest);
      for (const idSys of SYSTEM_IDS) Object.assign(sys[idSys], nextSystems[idSys]);
      for (const k of Object.keys(upgrades)) delete upgrades[k];
      Object.assign(upgrades, nextUpgrades);
      ship = effectiveShip(baseShip, upgrades, cat);
      srules = effectiveSurfaceRules(surfaceCat.rules, upgrades, cat);
      if (basePsych) psychRules = effectivePsychRules(basePsych, upgrades, cat, design);
      pending = [];
    },
  };
}
