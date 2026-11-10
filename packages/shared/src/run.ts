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
import { catalog as defaultCatalog, getNodeKind, getShip, getThrottle } from './catalog';
import { generateSector, getNode, nodeDistanceLy } from './galaxy';
import { createRng, deriveSeed, type Rng } from './rng';
import {
  HAZARD_KINDS, INCIDENT_KINDS, SYSTEM_IDS, THROTTLE_IDS,
  type ActionResult, type Catalog, type EventTone, type HazardKind, type Incident, type IncidentKind, type JumpEstimate,
  type MessageRef, type PlannedHazard, type PoweredSystemId, type Run, type RunAction, type RunEvent, type RunEventType,
  type RunOptions, type RunState, type RunStats, type ShipDef, type ShipState, type SystemId, type SystemState, type ThrottleId,
} from './types';

/** Paso fijo de la simulación (10 Hz). */
export const FIXED_STEP_S = 0.1;
/** Máximo de segundos de trabajo que acepta una sola acción (una tecla mantenida envía ~1 frame). */
export const MAX_WORK_SECONDS = 0.5;
/** Con motores a salud 0 la nave no se mueve; por encima, la velocidad va de este factor a 1. */
const MIN_ENGINE_SPEED_FACTOR = 0.4;
const HAZARD_SALT = 0x4a2d;
const WEAR_SALT = 0x77ea;
const MAX_HAZARDS_PER_KIND = 12;
const ALERT_HYSTERESIS_PCT = 5;
const POWERED: readonly PoweredSystemId[] = ['engines', 'lifeSupport', 'shields', 'nav'];
const RISK_WEIGHT: Record<HazardKind, number> = { impact: 1, short: 0.7, fire: 1, leak: 0.8 };
const RISK_THRESHOLDS = [0.8, 1.8, 3];

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

/** Puntuación de la partida: llegar lejos es lo que más cuenta. */
export function computeScore(stats: RunStats): number {
  return Math.round(stats.sectorsCleared * 1000 + stats.jumps * 50 + stats.incidentsFixed * 20 + stats.impactsEvaded * 30 + stats.distanceLy);
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
    stats: { timeS: 0, jumps: 0, distanceLy: 0, sectorsCleared: 0, incidentsFixed: 0, impactsTaken: 0, impactsEvaded: 0, kitsUsed: 0 },
    score: 0,
  };

  let accumulatorS = 0;
  let eventSeq = 0;
  let incidentSeq = 0;
  let hazardSeq = 0;
  let pending: RunEvent[] = [];
  let wasOverloaded = false;
  let wasBlackout = false;
  const alerted = { oxygen: false, fuel: false, hull: false };

  const sys = shipState.systems;

  function emit(type: RunEventType, tone: EventTone, key: string, params?: MessageRef['params'], extra?: Pick<RunEvent, 'systemId' | 'incidentKind'>): void {
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
      out.push({ hazardId: h.id, etaS: shipState.speedLyPerS > 0 ? Math.max(0, ahead) / shipState.speedLyPerS : -1, evaded: h.evaded });
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
    if (h.evaded) {
      state.stats.impactsEvaded++;
      emit('impact-evaded', 'ok', 'event.impactEvaded');
      return;
    }
    state.stats.impactsTaken++;
    if (sys.shields.online) {
      const absorb = (ship.shieldAbsorb * sys.shields.healthPct) / 100;
      const damage = h.hullDamage * (1 - absorb);
      shipState.hull = Math.max(0, shipState.hull - damage);
      emit('impact-hit', 'warn', 'event.impactShielded', { damage: Math.round(damage) }, { systemId: 'shields' });
      damageSystem('shields', ship.shieldWearPctPerHit);
    } else {
      shipState.hull = Math.max(0, shipState.hull - h.hullDamage);
      emit('impact-hit', 'bad', 'event.impactHit', { damage: Math.round(h.hullDamage), system: h.systemId }, { systemId: h.systemId });
      damageSystem(h.systemId, h.systemDamage);
      if (h.leakRoll < rules.impact.leakChanceUnshielded) spawnIncident('leak', h.systemId);
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
    let o2Drain = ship.crewO2UsePctPerS;
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

    // Oxígeno
    const regen = sys.lifeSupport.online ? (ship.o2RegenPctPerS * sys.lifeSupport.healthPct) / 100 : 0;
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
        const total = INCIDENT_KINDS.reduce((s, k) => s + rules.wear.weights[k], 0);
        let pick = kindRoll * total;
        let kind: IncidentKind = 'short';
        for (const k of INCIDENT_KINDS) {
          pick -= rules.wear.weights[k];
          if (pick < 0) {
            kind = k;
            break;
          }
        }
        spawnIncident(kind, SYSTEM_IDS[Math.floor(sysRoll * SYSTEM_IDS.length)]!);
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
    else if (isStranded()) lose('stranded');
    state.score = computeScore(state.stats);
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
      state.phase = 'docked';
      emit('new-sector', 'info', 'event.newSector', { sector: sector.index });
      return OK;
    }
    if (state.phase === 'won') return reject('reject.sectorCleared');

    switch (action.type) {
      case 'jump': {
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
        if (action.systemId === 'reactor') return reject('reject.reactorAlwaysOn');
        sys[action.systemId].enabled = !!action.enabled;
        return OK;
      }
      case 'work-incident': {
        const inc = state.incidents.find((i) => i.id === action.incidentId);
        if (!inc) return reject('reject.noIncident');
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
        const transit = state.transit;
        if (state.phase !== 'transit' || !transit) return reject('reject.notInTransit');
        const warning = state.warnings.find((w) => !w.evaded);
        const hazard = warning && transit.hazards.find((h) => h.id === warning.hazardId);
        if (!hazard) return reject('reject.noWarning');
        if (!sys.engines.online) return reject('reject.enginesDown');
        if (shipState.fuel < ship.evadeFuel) return reject('reject.notEnoughFuel');
        shipState.fuel -= ship.evadeFuel;
        hazard.evaded = true;
        return OK;
      }
      case 'service': {
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
        if (state.phase === 'docked' || state.phase === 'transit') fixedStep(FIXED_STEP_S);
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
    snapshot() {
      return JSON.parse(JSON.stringify(state)) as RunState;
    },
  };
}
