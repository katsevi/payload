/**
 * Revisión Go/No-Go. `go = false` si hay al menos un `blocker`.
 *
 * Blockers (impiden lanzar): faltan subsistemas imprescindibles (estructura, paneles, batería,
 * comunicaciones, computadora, instrumentos), varias estructuras, ids desconocidos o no permitidos,
 * sin órbita/lanzador, órbita o lanzador no permitidos, el lanzador no llega a la órbita, masa
 * excedida (lanzador o estructura), más piezas que puntos de montaje, presupuesto excedido,
 * balance de energía negativo, la batería no cubre el eclipse respetando la DoD y el calendario
 * no llega a tiempo.
 *
 * Warnings (se puede lanzar, pero la misión puede salir mal): márgenes justos (< 15 %),
 * energía tan justa que una tormenta solar vaciaría la batería (power-storm),
 * requisitos del escenario no cumplidos (resolución, datos bajados, ciencia, vida útil, revisita),
 * más datos de los que se pueden bajar, almacenamiento menor que un día de datos, apuntado
 * insuficiente para algún instrumento y calor que el control térmico no puede disipar.
 */
import { analyzeDesign, round, type DesignAnalysis } from './analysis';
import { budgetsFromAnalysis } from './budgets';
import { catalog } from './catalog';
import { STORM_DURATION_H, STORM_GENERATION_FACTOR } from './constants';
import type { BudgetReport, Catalog, GoNoGoResult, MissionDesign, SubsystemId, ValidationIssue } from './types';

const REQUIRED_SUBSYSTEMS: { subsystem: SubsystemId; code: string; key: string }[] = [
  { subsystem: 'structure', code: 'no-structure', key: 'review.noStructure' },
  { subsystem: 'power', code: 'no-power', key: 'review.noPower' },
  { subsystem: 'battery', code: 'no-battery', key: 'review.noBattery' },
  { subsystem: 'comms', code: 'no-comms', key: 'review.noComms' },
  { subsystem: 'obc', code: 'no-obc', key: 'review.noObc' },
  { subsystem: 'payload', code: 'no-payload', key: 'review.noPayload' },
];

export function reviewFromAnalysis(a: DesignAnalysis, budgets: BudgetReport): GoNoGoResult {
  const issues: ValidationIssue[] = [];
  const blocker = (code: string, key: string, params?: Record<string, string | number>) =>
    issues.push({ severity: 'blocker', code, message: params ? { key, params } : { key } });
  const warning = (code: string, key: string, params?: Record<string, string | number>) =>
    issues.push({ severity: 'warning', code, message: params ? { key, params } : { key } });
  const s = a.scenario;

  // ── Componentes
  for (const unknown of new Set(a.unknownIds)) blocker('unknown-component', 'review.unknownComponent', { id: unknown });
  if (s.allowedComponents) {
    const allowed = new Set(s.allowedComponents);
    for (const c of new Set(a.components.filter((x) => !allowed.has(x.id)).map((x) => x.id))) {
      blocker('component-not-allowed', 'review.componentNotAllowed', { component: c });
    }
  }
  for (const req of REQUIRED_SUBSYSTEMS) {
    if (a.bySubsystem[req.subsystem].length === 0) blocker(req.code, req.key);
  }
  if (a.bySubsystem.structure.length > 1) {
    blocker('multiple-structures', 'review.multipleStructures', { count: a.bySubsystem.structure.length });
  }
  if (a.structure && a.mountedCount > a.mountSlots) {
    blocker('mount-slots', 'review.mountSlots', { used: a.mountedCount, slots: a.mountSlots, structure: a.structure.id });
  }

  // ── Órbita y lanzador
  if (!a.design.orbitId) blocker('no-orbit', 'review.noOrbit');
  else if (!a.orbit) blocker('unknown-orbit', 'review.unknownOrbit', { id: a.design.orbitId });
  else if (!s.allowedOrbits.includes(a.orbit.id)) blocker('orbit-not-allowed', 'review.orbitNotAllowed', { orbit: a.orbit.id });

  if (!a.design.launcherId) blocker('no-launcher', 'review.noLauncher');
  else if (!a.launcher) blocker('unknown-launcher', 'review.unknownLauncher', { id: a.design.launcherId });
  else if (!s.allowedLaunchers.includes(a.launcher.id)) {
    blocker('launcher-not-allowed', 'review.launcherNotAllowed', { launcher: a.launcher.id });
  }

  const massKg = round(a.massKg, 2);
  if (a.launcher && a.orbit) {
    if (a.launcherCapacityKg === 0) {
      blocker('launcher-cannot-reach', 'review.launcherCannotReach', { launcher: a.launcher.id, orbit: a.orbit.id });
    } else if (a.launcherCapacityKg !== null && a.massKg > a.launcherCapacityKg) {
      blocker('mass-launcher', 'review.massLauncher', {
        massKg, capacityKg: a.launcherCapacityKg, launcher: a.launcher.id, orbit: a.orbit.id,
      });
    }
  }
  if (a.structure && a.structureMaxMassKg !== null && a.massKg > a.structureMaxMassKg) {
    blocker('mass-structure', 'review.massStructure', { massKg, capacityKg: a.structureMaxMassKg, structure: a.structure.id });
  }

  // ── Presupuesto, energía, batería, calendario
  if (a.totalCostMUSD > s.budgetMUSD) {
    blocker('budget', 'review.budget', { totalMUSD: round(a.totalCostMUSD, 2), budgetMUSD: s.budgetMUSD });
  }
  if (a.orbitParams && a.powerW > a.avgGenerationW && a.bySubsystem.power.length > 0) {
    blocker('power', 'review.power', { consumptionW: round(a.powerW), avgGenerationW: round(a.avgGenerationW) });
  }
  if (a.orbitParams && a.bySubsystem.battery.length > 0 && a.eclipseEnergyWh > a.batteryUsableWh) {
    blocker('battery', 'review.battery', {
      needWh: round(a.eclipseEnergyWh),
      usableWh: round(a.batteryUsableWh),
      eclipseMin: round(a.orbitParams.eclipseMin, 0),
      consumptionW: round(a.powerW),
    });
  }
  // Resiliencia ante una tormenta solar (evento suave de la operación): si durante la tormenta
  // la generación media no cubre el consumo, el déficit + un eclipse debe caber en la energía
  // ÚTIL de la batería (capacidad × DoD); si no, en operación bajaría de la DoD, se desgastaría
  // (ver simulation.ts) y podría agotarse o quedar inservible aunque el balance nominal sea positivo.
  if (a.orbitParams && a.bySubsystem.battery.length > 0 && a.powerW <= a.avgGenerationW && s.eventsEnabled) {
    const stormDeficitWh = Math.max(0, a.powerW - STORM_GENERATION_FACTOR * a.avgGenerationW) * STORM_DURATION_H;
    if (stormDeficitWh + a.eclipseEnergyWh > a.batteryUsableWh) {
      warning('power-storm', 'review.stormRisk', {
        hours: STORM_DURATION_H,
        pct: round((1 - STORM_GENERATION_FACTOR) * 100, 0),
        deficitWh: round(stormDeficitWh),
        eclipseWh: round(a.eclipseEnergyWh),
        usableWh: round(a.batteryUsableWh),
      });
    }
  }
  if (a.scheduleMonths > s.maxDevMonths) {
    blocker('time', 'review.time', { totalMonths: round(a.scheduleMonths), maxMonths: s.maxDevMonths });
  }

  // ── Márgenes justos
  for (const r of budgets.resources) {
    if (r.status === 'tight') warning(`tight-${r.id}`, `review.tight.${r.id}`, { marginPct: round(r.margin * 100, 0) });
  }

  // ── Requisitos del escenario
  const req = s.requirements;
  if (req.maxGroundResolutionM !== undefined && a.bySubsystem.payload.length > 0) {
    if (a.groundResolutionM === null) {
      warning('req-resolution', 'review.reqResolutionNone', { requiredM: req.maxGroundResolutionM });
    } else if (a.groundResolutionM > req.maxGroundResolutionM) {
      warning('req-resolution', 'review.reqResolution', {
        resolutionM: round(a.groundResolutionM), requiredM: req.maxGroundResolutionM,
      });
    }
  }
  if (req.minDownlinkMbitPerDay !== undefined && a.orbit && a.bySubsystem.payload.length > 0) {
    const achieved = Math.min(a.dataGeneratedMbitPerDay, a.downlinkCapacityMbitPerDay);
    if (achieved < req.minDownlinkMbitPerDay) {
      warning('req-downlink', 'review.reqDownlink', {
        achievedMbitPerDay: round(achieved, 0), requiredMbitPerDay: req.minDownlinkMbitPerDay,
      });
    }
  }
  if (req.minScienceValue !== undefined && a.bySubsystem.payload.length > 0 && a.scienceValue < req.minScienceValue) {
    warning('req-science', 'review.reqScience', { science: a.scienceValue, required: req.minScienceValue });
  }
  if (a.components.length > 0 && a.lifetimeYears < req.minLifetimeYears) {
    warning('req-lifetime', 'review.reqLifetime', { lifetimeYears: round(a.lifetimeYears), requiredYears: req.minLifetimeYears });
  }
  if (req.maxRevisitDays !== undefined && a.orbit && a.orbit.revisitDays > req.maxRevisitDays) {
    warning('req-revisit', 'review.reqRevisit', { revisitDays: a.orbit.revisitDays, maxDays: req.maxRevisitDays });
  }

  // ── Datos y comunicaciones
  if (a.orbit && a.radio && a.dataGeneratedMbitPerDay > a.downlinkCapacityMbitPerDay) {
    warning('comms-capacity', 'review.commsCapacity', {
      generatedMbitPerDay: round(a.dataGeneratedMbitPerDay, 0),
      capacityMbitPerDay: round(a.downlinkCapacityMbitPerDay, 0),
    });
  }
  if (a.bySubsystem.obc.length > 0 && a.dataGeneratedMbitPerDay > a.storageMbit) {
    warning('storage', 'review.storage', {
      generatedMbitPerDay: round(a.dataGeneratedMbitPerDay, 0), storageMbit: round(a.storageMbit, 0),
    });
  }

  // ── Apuntado y térmico
  const seen = new Set<string>();
  for (const inst of a.bySubsystem.payload) {
    if (inst.requiredPointingDeg === undefined || seen.has(inst.id)) continue;
    seen.add(inst.id);
    if (a.bestPointingDeg === null) {
      warning('pointing', 'review.pointingNoAdcs', { component: inst.id, requiredDeg: inst.requiredPointingDeg });
    } else if (a.bestPointingDeg > inst.requiredPointingDeg) {
      warning('pointing', 'review.pointing', {
        component: inst.id, requiredDeg: inst.requiredPointingDeg, accuracyDeg: a.bestPointingDeg,
      });
    }
  }
  if (a.powerW > 0 && a.powerW > a.thermalDissipationW) {
    warning('thermal', 'review.thermal', { powerW: round(a.powerW), dissipationW: round(a.thermalDissipationW) });
  }

  const go = !issues.some((i) => i.severity === 'blocker');
  if (go && issues.length === 0) issues.push({ severity: 'info', code: 'all-clear', message: { key: 'review.allClear' } });
  return { go, issues };
}

/** Revisión Go/No-Go: valida que el diseño sea lanzable (masa vs lanzador/órbita, energía, presupuesto, subsistemas obligatorios...). */
export function reviewGoNoGo(design: MissionDesign, cat: Catalog = catalog): GoNoGoResult {
  const a = analyzeDesign(design, cat);
  return reviewFromAnalysis(a, budgetsFromAnalysis(a));
}
