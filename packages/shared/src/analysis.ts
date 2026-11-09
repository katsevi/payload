/**
 * Análisis interno de un diseño: resuelve ids contra el catálogo y agrega todas las magnitudes
 * que usan presupuestos, Go/No-Go, simulación e informe. NO forma parte de la API pública.
 *
 * Tolera diseños parciales (sin órbita, sin lanzador, sin componentes o con ids desconocidos):
 * nunca lanza salvo que el escenario no exista.
 */
import { getScenario } from './catalog';
import { computeOrbitParams, MINUTES_PER_DAY } from './orbital';
import type { Catalog, ComponentDef, LauncherDef, MissionDesign, OrbitDef, OrbitParams, ScenarioDef, SubsystemId } from './types';

/** Meses de integración y pruebas que añade cada pieza montada. */
export const INTEGRATION_MONTHS_PER_COMPONENT = 0.25;
/** Costo de operación por año si el escenario no lo define (MUSD/año). */
export const DEFAULT_OPS_COST_MUSD_PER_YEAR = 1;
/** Vida nominal a la que se refiere `ComponentDef.reliability` (años). */
export const NOMINAL_LIFE_YEARS = 5;
/** La vida útil por fiabilidad es el tiempo hasta que P(sigue funcionando) cae a este valor. */
export const RELIABILITY_LIFETIME_THRESHOLD = 0.7;
/** Cuánto acelera la radiación los fallos: R_eff = R^(1 + K·radiationFactor). */
export const RADIATION_RELIABILITY_K = 2;
/** Tope de vida útil estimada (años). */
export const MAX_LIFETIME_YEARS = 30;
/** Altitud de referencia de groundResolutionAt500KmM (km). */
export const RESOLUTION_REFERENCE_ALTITUDE_KM = 500;

/** Ajustes de eventos pre-operación (retraso y recorte), ver `rollPreLaunchEvents`. */
export interface DesignAdjustments {
  delayMonths?: number;
  budgetCutMUSD?: number;
}

export interface DesignAnalysis {
  design: MissionDesign;
  scenario: ScenarioDef;
  orbit: OrbitDef | null;
  orbitParams: OrbitParams | null;
  launcher: LauncherDef | null;
  /** Componentes conocidos montados (con repetidos). */
  components: ComponentDef[];
  unknownIds: string[];
  bySubsystem: Record<SubsystemId, ComponentDef[]>;
  structure: ComponentDef | null;
  /** Componentes que ocupan un punto de montaje (todos menos las estructuras). */
  mountedCount: number;
  mountSlots: number;

  massKg: number;
  structureMaxMassKg: number | null;
  /** Capacidad del lanzador en la órbita elegida; null si falta lanzador u órbita; 0 si no llega. */
  launcherCapacityKg: number | null;

  powerW: number;
  payloadPowerW: number;
  busPowerW: number;
  biggestConsumer: ComponentDef | null;
  solarGenerationW: number;
  sunFraction: number | null;
  avgGenerationW: number;
  batteryCapacityWh: number;
  batteryUsableWh: number;
  eclipseEnergyWh: number;

  componentsCostMUSD: number;
  launcherCostMUSD: number;
  opsCostMUSD: number;
  totalCostMUSD: number;
  /** Presupuesto disponible tras un posible recorte (MUSD). */
  budgetAvailableMUSD: number;
  budgetCutMUSD: number;

  componentDevMonths: number;
  slowestComponent: ComponentDef | null;
  leadMonths: number;
  /** Calendario total, incluido el retraso de lanzamiento. */
  scheduleMonths: number;
  /** Retraso de lanzamiento aplicado (meses). */
  delayMonths: number;

  dataGeneratedMbitPerDay: number;
  storageMbit: number;
  radio: ComponentDef | null;
  downlinkMbps: number;
  totalContactMinPerDay: number;
  downlinkCapacityMbitPerDay: number;

  scienceValue: number;
  altitudeKm: number | null;
  groundResolutionM: number | null;
  bestImager: ComponentDef | null;
  bestPointingDeg: number | null;
  thermalDissipationW: number;
  /** (disipación − consumo) / disipación; −Infinity si consume sin control térmico; null si no consume. */
  thermalMargin: number | null;

  systemReliability: number;
  radiationFactor: number;
  reliabilityLifetimeYears: number;
  dragLifetimeYears: number | null;
  lifetimeYears: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Resolución en suelo (m) de un instrumento a una altitud: escala lineal con la altitud. */
export function resolutionAtAltitude(c: ComponentDef, altitudeKm: number | null): number | null {
  if (c.groundResolutionAt500KmM === undefined) return null;
  const h = altitudeKm ?? RESOLUTION_REFERENCE_ALTITUDE_KM;
  return (c.groundResolutionAt500KmM * h) / RESOLUTION_REFERENCE_ALTITUDE_KM;
}

export function analyzeDesign(design: MissionDesign, cat: Catalog, adjust: DesignAdjustments = {}): DesignAnalysis {
  const scenario = getScenario(design.scenarioId, cat);
  const byId = new Map(cat.components.map((c) => [c.id, c] as const));

  const components: ComponentDef[] = [];
  const unknownIds: string[] = [];
  for (const cid of design.componentIds) {
    const c = byId.get(cid);
    if (c) components.push(c);
    else unknownIds.push(cid);
  }
  const bySubsystem: Record<SubsystemId, ComponentDef[]> = {
    structure: [], power: [], battery: [], comms: [], obc: [], adcs: [], thermal: [], payload: [],
  };
  for (const c of components) bySubsystem[c.subsystem].push(c);

  const orbit = design.orbitId ? (cat.orbits.find((o) => o.id === design.orbitId) ?? null) : null;
  const orbitParams = orbit ? computeOrbitParams(orbit) : null;
  const launcher = design.launcherId ? (cat.launchers.find((l) => l.id === design.launcherId) ?? null) : null;

  // ── Masa
  const structure = bySubsystem.structure[0] ?? null;
  const massKg = sum(components.map((c) => c.massKg));
  const structureMaxMassKg = structure?.maxSupportedMassKg ?? null;
  const launcherCapacityKg = launcher && orbit ? (launcher.capacityKg[orbit.id] ?? 0) : null;
  const mountedCount = components.length - bySubsystem.structure.length;
  const mountSlots = structure?.mountSlots ?? 0;

  // ── Energía: media orbital = generación × fracción de sol; batería cubre el eclipse
  const powerW = sum(components.map((c) => c.powerW));
  const payloadPowerW = sum(bySubsystem.payload.map((c) => c.powerW));
  const biggestConsumer = components.reduce<ComponentDef | null>(
    (best, c) => (c.powerW > 0 && (!best || c.powerW > best.powerW) ? c : best),
    null,
  );
  const solarGenerationW = sum(bySubsystem.power.map((c) => c.solarGenerationW ?? 0));
  const sunFraction = orbitParams ? 1 - orbitParams.eclipseFraction : null;
  const avgGenerationW = solarGenerationW * (sunFraction ?? 1);
  const batteryCapacityWh = sum(bySubsystem.battery.map((c) => c.batteryCapacityWh ?? 0));
  const batteryUsableWh = sum(bySubsystem.battery.map((c) => (c.batteryCapacityWh ?? 0) * (c.maxDepthOfDischarge ?? 1)));
  const eclipseEnergyWh = orbitParams ? (powerW * orbitParams.eclipseMin) / 60 : 0;

  // ── Presupuesto = componentes + lanzador + operación
  const componentsCostMUSD = sum(components.map((c) => c.costMUSD));
  const launcherCostMUSD = launcher?.costMUSD ?? 0;
  const opsCostMUSD =
    (scenario.operationsCostMUSDPerYear ?? DEFAULT_OPS_COST_MUSD_PER_YEAR) * scenario.requirements.minLifetimeYears;
  const totalCostMUSD = componentsCostMUSD + launcherCostMUSD + opsCostMUSD;
  const budgetCutMUSD = Math.max(0, adjust.budgetCutMUSD ?? 0);
  const budgetAvailableMUSD = Math.max(0, scenario.budgetMUSD - budgetCutMUSD);

  // ── Tiempo: la pieza más lenta marca el ritmo + integración por pieza + espera del lanzador
  const slowestComponent = components.reduce<ComponentDef | null>(
    (best, c) => (!best || c.devMonths > best.devMonths ? c : best),
    null,
  );
  const componentDevMonths =
    components.length > 0
      ? (slowestComponent?.devMonths ?? 0) + INTEGRATION_MONTHS_PER_COMPONENT * components.length
      : 0;
  const leadMonths = launcher?.leadTimeMonths ?? 0;
  const delayMonths = Math.max(0, adjust.delayMonths ?? 0);
  const scheduleMonths = componentDevMonths + leadMonths + delayMonths;

  // ── Datos y comunicaciones
  const dataGeneratedMbitPerDay = sum(bySubsystem.payload.map((c) => c.dataMbitPerDay));
  const storageMbit = sum(bySubsystem.obc.map((c) => c.storageMbit ?? 0));
  const radio = bySubsystem.comms.reduce<ComponentDef | null>(
    (best, c) => (!best || (c.downlinkMbps ?? 0) > (best.downlinkMbps ?? 0) ? c : best),
    null,
  );
  const downlinkMbps = radio?.downlinkMbps ?? 0;
  const totalContactMinPerDay = orbitParams
    ? Math.min(MINUTES_PER_DAY, orbitParams.contactMinPerDayPerStation * scenario.groundStations)
    : 0;
  const downlinkCapacityMbitPerDay = totalContactMinPerDay * 60 * downlinkMbps;

  // ── Ciencia y resolución
  const scienceValue = sum(bySubsystem.payload.map((c) => c.scienceValue));
  const altitudeKm = orbit ? orbit.perigeeKm : null;
  let bestImager: ComponentDef | null = null;
  let groundResolutionM: number | null = null;
  for (const c of bySubsystem.payload) {
    const r = resolutionAtAltitude(c, altitudeKm);
    if (r !== null && (groundResolutionM === null || r < groundResolutionM)) {
      groundResolutionM = r;
      bestImager = c;
    }
  }
  const pointing = bySubsystem.adcs.map((c) => c.pointingAccuracyDeg ?? Infinity);
  const bestPointingDeg = pointing.length > 0 ? Math.min(...pointing) : null;
  const thermalDissipationW = sum(bySubsystem.thermal.map((c) => c.thermalDissipationW ?? 0));
  const thermalMargin =
    powerW <= 0 ? null : thermalDissipationW > 0 ? (thermalDissipationW - powerW) / thermalDissipationW : -Infinity;

  // ── Vida útil = min(arrastre, fiabilidad degradada por radiación)
  //   R_sys = Π r_i (cada pieza puede fallar); R_eff = R_sys^(1 + K·radiación)
  //   Fallos exponenciales calibrados a la vida nominal L0: vida = L0 · ln(0.7) / ln(R_eff)
  const systemReliability = components.reduce((p, c) => p * c.reliability, 1);
  const radiationFactor = orbit?.radiationFactor ?? 0;
  const effective = systemReliability ** (1 + RADIATION_RELIABILITY_K * radiationFactor);
  let reliabilityLifetimeYears: number;
  if (components.length === 0) reliabilityLifetimeYears = 0;
  else if (effective >= 1) reliabilityLifetimeYears = MAX_LIFETIME_YEARS;
  else if (effective <= 0) reliabilityLifetimeYears = 0;
  else {
    reliabilityLifetimeYears = Math.min(
      MAX_LIFETIME_YEARS,
      (NOMINAL_LIFE_YEARS * Math.log(RELIABILITY_LIFETIME_THRESHOLD)) / Math.log(effective),
    );
  }
  const dragLifetimeYears = orbit ? orbit.dragLifetimeYears : null;
  const lifetimeYears = dragLifetimeYears === null ? reliabilityLifetimeYears : Math.min(dragLifetimeYears, reliabilityLifetimeYears);

  return {
    design, scenario, orbit, orbitParams, launcher, components, unknownIds, bySubsystem, structure,
    mountedCount, mountSlots, massKg, structureMaxMassKg, launcherCapacityKg,
    powerW, payloadPowerW, busPowerW: powerW - payloadPowerW, biggestConsumer, solarGenerationW, sunFraction,
    avgGenerationW, batteryCapacityWh, batteryUsableWh, eclipseEnergyWh,
    componentsCostMUSD, launcherCostMUSD, opsCostMUSD, totalCostMUSD, budgetAvailableMUSD, budgetCutMUSD,
    componentDevMonths, slowestComponent, leadMonths, scheduleMonths, delayMonths,
    dataGeneratedMbitPerDay, storageMbit, radio, downlinkMbps, totalContactMinPerDay, downlinkCapacityMbitPerDay,
    scienceValue, altitudeKm, groundResolutionM, bestImager, bestPointingDeg, thermalDissipationW, thermalMargin,
    systemReliability, radiationFactor, reliabilityLifetimeYears, dragLifetimeYears, lifetimeYears,
  };
}

/** Redondeo para parámetros de mensajes (evita 35.912345 min en pantalla). */
export function round(x: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}
