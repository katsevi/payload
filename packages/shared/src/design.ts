/**
 * Diseño de misión (fase 4, ADR 0016): funciones PURAS y baratas (la pantalla de diseño las llama en cada
 * cambio).
 *
 * - `computeDesignBudgets`: masa, potencia en el destino, coste, calendario, ranuras y combustible del tramo
 *   más largo, con used/available/margin/status y un «¿por qué?» de una línea por recurso.
 * - `reviewDesign`: Go/No-Go con problemas `blocker`/`warning` y el motivo de cada uno.
 * - `shipFromDesign`: la `ShipDef` de la partida. Parte de la nave base del catálogo, pone a 0 los campos que
 *   aportan los módulos (`rules.zeroedFields`) y aplica sus efectos: suma de `add` y producto de `mult` por
 *   campo (no depende del orden). La masa encarece el combustible por año luz; los paneles van en
 *   `solarKwAt1Au` (bajan con 1/d²) y la parte nuclear en `reactorOutputKw`. Las mejoras de la fase 3 se
 *   aplican encima con `effectiveShip`, como con cualquier nave.
 */
import { catalog as defaultCatalog, getShip, getThrottle } from './catalog';
import { z } from 'zod';
import { bodySunDistanceAu, findBody, getSolarSystem, legUnits, routeWorstSunDistance, routeZoneIndex, routeZones, solarPowerFactor } from './solar';
import {
  DESIGN_RESOURCE_IDS, MODULE_KINDS,
  type Catalog, type DesignBudgets, type DesignIssue, type DesignResource, type DesignResourceId, type DesignReview, type DesignRules, type DesignTotals,
  type DifficultyDef, type GuidedStepCheck, type InstrumentDef, type LocalizedText, type LauncherDef, type MessageRef, type MissionDef, type MissionDesign, type ModuleDef, type ModuleKind, type ShipDef,
  type SolarBodyDef, type SolarZoneDef,
} from './types';

// ─── Búsquedas ──────────────────────────────────────────────────────────────

/** Fase 8: plazo (meses) desde el que el aviso `crew-wellbeing` pide un hábitat. */
const CREW_WELLBEING_MONTHS = 48;

export function getDesignRules(cat: Catalog = defaultCatalog): DesignRules {
  if (!cat.design) throw new Error('El catálogo no tiene reglas de diseño (usa parseCatalog)');
  return cat.design;
}

export function getMissions(cat: Catalog = defaultCatalog): MissionDef[] {
  return cat.missions ?? [];
}

export function getMission(missionId: string, cat: Catalog = defaultCatalog): MissionDef {
  const m = getMissions(cat).find((x) => x.id === missionId);
  if (!m) throw new Error(`Misión desconocida: ${missionId}`);
  return m;
}

export function getModules(cat: Catalog = defaultCatalog): ModuleDef[] {
  return cat.modules ?? [];
}

export function getModule(moduleId: string, cat: Catalog = defaultCatalog): ModuleDef {
  const m = getModules(cat).find((x) => x.id === moduleId);
  if (!m) throw new Error(`Módulo desconocido: ${moduleId}`);
  return m;
}

export function getInstruments(cat: Catalog = defaultCatalog): InstrumentDef[] {
  return cat.instruments ?? [];
}

export function getInstrument(instrumentId: string, cat: Catalog = defaultCatalog): InstrumentDef {
  const m = getInstruments(cat).find((x) => x.id === instrumentId);
  if (!m) throw new Error(`Instrumento desconocido: ${instrumentId}`);
  return m;
}

export function getLaunchers(cat: Catalog = defaultCatalog): LauncherDef[] {
  return cat.launchers ?? [];
}

export function getLauncher(launcherId: string, cat: Catalog = defaultCatalog): LauncherDef {
  const m = getLaunchers(cat).find((x) => x.id === launcherId);
  if (!m) throw new Error(`Lanzador desconocido: ${launcherId}`);
  return m;
}

/** Nivel neutro (todo × 1): el que se usa si el catálogo no define niveles. */
const NEUTRAL_DIFFICULTY: DifficultyDef = {
  id: 'difficulty-normal', name: { es: 'Normal', en: 'Normal' },
  budgetMult: 1, deadlineMult: 1, minScienceMult: 1, wearMult: 1, hazardMult: 1, contactWindowMult: 1,
};

/** Fase 5 (ADR 0018 § 7): niveles de dificultad del catálogo (en orden). */
export function getDifficulties(cat: Catalog = defaultCatalog): DifficultyDef[] {
  return cat.design?.difficulties ?? [];
}

/** Nivel del diseño: el suyo, si no el de por defecto, si no el primero; sin niveles, el neutro. Nunca lanza. */
export function getDifficulty(difficultyId: string | undefined, cat: Catalog = defaultCatalog): DifficultyDef {
  const all = getDifficulties(cat);
  return all.find((d) => d.id === difficultyId) ?? all.find((d) => d.id === cat.design?.defaultDifficultyId) ?? all[0] ?? NEUTRAL_DIFFICULTY;
}

/** La misión con las cifras del nivel de dificultad (presupuesto, plazo y ciencia mínima, redondeados). */
export function missionAtDifficulty(mission: MissionDef, difficulty: DifficultyDef): MissionDef {
  if (difficulty.budgetMult === 1 && difficulty.deadlineMult === 1 && difficulty.minScienceMult === 1) return mission;
  return {
    ...mission,
    budgetMUSD: Math.round(mission.budgetMUSD * difficulty.budgetMult),
    deadlineMonths: Math.round(mission.deadlineMonths * difficulty.deadlineMult),
    requirements: { ...mission.requirements, minScience: Math.round(mission.requirements.minScience * difficulty.minScienceMult) },
  };
}

/** Diseño vacío para una misión (el punto de partida de la pantalla de diseño). */
export function emptyDesign(missionId: string): MissionDesign {
  return { missionId, destinationId: null, moduleIds: [], instrumentIds: [], launcherId: null };
}

const idString = z.string().min(1);
/** Esquema de `MissionDesign` (llega de la interfaz o de la red: no se fía de su forma). */
export const missionDesignSchema = z.strictObject({
  missionId: idString,
  destinationId: idString.nullable(),
  moduleIds: z.array(idString),
  instrumentIds: z.array(idString),
  launcherId: idString.nullable(),
  difficultyId: idString.optional(),
});

/** Valida un diseño en bruto. Lanza un error legible si no tiene la forma de `MissionDesign`. */
export function parseMissionDesign(raw: unknown): MissionDesign {
  const r = missionDesignSchema.safeParse(raw);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`);
    throw new Error(`Diseño de misión inválido:\n${lines.join('\n')}`);
  }
  return r.data;
}

/**
 * Normaliza un diseño mal formado sin lanzar (las funciones puras de la pantalla de diseño se llaman con diseños a
 * medias): listas que no son listas → vacías, ids que no son texto → fuera, campos sueltos → null.
 */
export function normalizeDesign(raw: unknown): MissionDesign {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);
  const out: MissionDesign = { missionId: str(o.missionId) ?? '', destinationId: str(o.destinationId), moduleIds: list(o.moduleIds), instrumentIds: list(o.instrumentIds), launcherId: str(o.launcherId) };
  const difficultyId = str(o.difficultyId);
  if (difficultyId) out.difficultyId = difficultyId;
  return out;
}

// ─── Análisis (uso interno) ─────────────────────────────────────────────────

const round = (n: number, digits = 1): number => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

interface Analysis {
  design: MissionDesign;
  rules: DesignRules;
  mission: MissionDef | undefined;
  destination: SolarBodyDef | undefined;
  zone: SolarZoneDef | undefined;
  launcher: LauncherDef | undefined;
  modules: ModuleDef[];
  instruments: InstrumentDef[];
  unknownModules: string[];
  unknownInstruments: string[];
  byKind: Record<ModuleKind, ModuleDef[]>;
  ship: ShipDef;
  /** Capacidad del lanzador hacia la zona del destino (null = falta lanzador o destino; 0 = no llega). */
  launcherCapacityKg: number | null;
  structureMaxKg: number | null;
  totals: DesignTotals;
  /** El tramo más largo (zonas) hasta el destino. */
  longestLeg: { from: SolarZoneDef; to: SolarZoneDef } | null;
  commsRangeAu: number;
}

function analyze(rawDesign: MissionDesign, cat: Catalog): Analysis {
  const design = normalizeDesign(rawDesign);
  const rules = getDesignRules(cat);
  // Fase 5: la misión con las cifras de su nivel de dificultad (presupuesto, plazo, ciencia mínima).
  const baseMission = getMissions(cat).find((m) => m.id === design.missionId);
  const mission = baseMission && missionAtDifficulty(baseMission, getDifficulty(design.difficultyId, cat));
  const destination = design.destinationId ? findBody(design.destinationId, cat) : undefined;
  const sys = getSolarSystem(cat);
  const zone = destination?.zoneId ? sys.zones.find((z) => z.id === destination.zoneId) : undefined;
  const launcher = design.launcherId ? getLaunchers(cat).find((l) => l.id === design.launcherId) : undefined;
  const modules: ModuleDef[] = [];
  const instruments: InstrumentDef[] = [];
  const unknownModules: string[] = [];
  const unknownInstruments: string[] = [];
  for (const mid of design.moduleIds) {
    const m = getModules(cat).find((x) => x.id === mid);
    if (m) modules.push(m);
    else unknownModules.push(mid);
  }
  for (const iid of design.instrumentIds) {
    const i = getInstruments(cat).find((x) => x.id === iid);
    if (i) instruments.push(i);
    else unknownInstruments.push(iid);
  }
  const byKind = {} as Record<ModuleKind, ModuleDef[]>;
  for (const m of modules) (byKind[m.kind] ??= []).push(m);
  const kindList = (k: ModuleKind) => byKind[k] ?? [];
  for (const k of MODULE_KINDS) byKind[k] = kindList(k);

  const ship = buildShip(modules, instruments, rules, cat);
  const massKg = ship.dryMassKg ?? 0;
  const structure = byKind.structure[0];
  const structureMaxKg = structure?.maxMassKg ?? null;
  const launcherCapacityKg = launcher && zone ? (launcher.capacityKgByZone[zone.id] ?? 0) : null;
  const massLimitKg = Math.min(launcherCapacityKg ?? Infinity, structureMaxKg ?? Infinity);

  const destinationAu = destination ? bodySunDistanceAu(destination, cat) : 1;
  const cruise = getThrottle(ship, 'cruise').engineDrawMult;
  const d = ship.systemDrawKw;
  const demandKw = d.engines * cruise + d.lifeSupport + d.shields + d.nav;
  const solarKwAt1Au = ship.solarKwAt1Au ?? 0;
  const nuclearKw = ship.reactorOutputKw;
  const solarKwAtDestination = solarKwAt1Au * solarPowerFactor(destinationAu);
  // Peor punto de la ruta (lo más lejos del Sol que puede pisar la partida): ahí se mide la potencia y el enlace.
  const worst = destination ? routeWorstSunDistance(destination.id, cat) : { au: 1, bodyId: '' };
  const solarKwAtWorst = solarKwAt1Au * solarPowerFactor(worst.au);

  const items = modules.length + instruments.length;
  const devMonths = Math.max(0, ...modules.map((m) => m.devMonths), ...instruments.map((i) => i.devMonths));
  const integration = rules.integrationMonthsPerItem * items;
  const scheduleMonths = items > 0 || launcher ? devMonths + integration + (launcher?.waitMonths ?? 0) : 0;
  const costMUSD = modules.reduce((s, m) => s + m.costMUSD, 0) + instruments.reduce((s, i) => s + i.costMUSD, 0) + (launcher?.costMUSD ?? 0);

  let slots = structure?.slots ?? 0;
  if (byKind.structure.length > 1) slots = byKind.structure.reduce((s, m) => Math.max(s, m.slots ?? 0), 0);
  const slotsUsed = modules.filter((m) => m.kind !== 'structure').reduce((s, m) => s + (m.slotsUsed ?? 1), 0) + instruments.reduce((s, i) => s + (i.slotsUsed ?? 1), 0);

  // Combustible del tramo más largo de la ruta (ida y vuelta hasta la zona del destino; se reposta en la
  // estación de mitad de tramo).
  const zones = routeZones(destination ? destination.id : null, cat);
  let longestLeg: Analysis['longestLeg'] = null;
  let longest = 0;
  for (let k = 1; k <= Math.max(1, zones.length - 1); k++) {
    const from = zones[routeZoneIndex(k - 1, zones.length)]!;
    const to = zones[routeZoneIndex(k, zones.length)]!;
    const len = legUnits(from.sunDistanceAu, to.sunDistanceAu, sys.route);
    if (len > longest) {
      longest = len;
      longestLeg = { from, to };
    }
  }
  const legFuel = longest * rules.rangeLegFactor * ship.fuelPerLy * getThrottle(ship, 'eco').fuelMult;

  const wanted = new Set([...(mission?.requirements.requiredKinds ?? []), ...(mission ? [mission.scienceKind] : [])]);
  const scienceValue = instruments.reduce((s, i) => s + i.scienceValue * (wanted.has(i.scienceKind) ? 1 : rules.offKindScienceMult), 0);
  const reliability = [...modules, ...instruments].reduce((p, x) => p * x.reliability, 1) * (launcher?.reliability ?? 1);
  const heatRejectKw = modules.reduce((s, m) => s + (m.heatRejectKw ?? 0), 0);

  return {
    design, rules, mission, destination, zone, launcher, modules, instruments, unknownModules, unknownInstruments, byKind, ship,
    launcherCapacityKg, structureMaxKg, longestLeg,
    commsRangeAu: byKind.comms.reduce((s, m) => Math.max(s, m.commsRangeAu ?? 0), 0),
    totals: {
      massKg,
      massLimitKg: Number.isFinite(massLimitKg) ? massLimitKg : 0,
      demandKw,
      solarKwAt1Au,
      nuclearKw,
      destinationAu,
      solarKwAtDestination,
      powerAtDestinationKw: nuclearKw + solarKwAtDestination,
      worstAu: worst.au,
      worstBodyId: worst.bodyId,
      solarKwAtWorst,
      powerAtWorstKw: nuclearKw + solarKwAtWorst,
      costMUSD,
      scheduleMonths,
      slotsUsed,
      slots,
      fuelCapacity: ship.fuelCapacity,
      legFuel,
      scienceValue,
      reliabilityPct: reliability * 100,
      heatRejectKw,
      dataRateMbps: instruments.reduce((s, i) => s + i.dataRateMbps, 0),
      downlinkMbps: byKind.comms.reduce((s, m) => s + (m.dataRateMbps ?? 0), 0),
      storageGb: byKind.computer.reduce((s, m) => s + (m.storageGb ?? 0), 0),
    },
  };
}

/** Valor de un campo numérico de la nave (admite `systemDrawKw.<sistema>`). */
function getField(ship: ShipDef, field: string): number {
  if (field.startsWith('systemDrawKw.')) return ship.systemDrawKw[field.slice(13) as keyof ShipDef['systemDrawKw']] ?? 0;
  return (ship as unknown as Record<string, number>)[field] ?? 0; // campos numéricos validados con zod (UPGRADE_FIELDS)
}

function setField(ship: ShipDef, field: string, value: number): void {
  if (field.startsWith('systemDrawKw.')) ship.systemDrawKw[field.slice(13) as keyof ShipDef['systemDrawKw']] = value;
  else (ship as unknown as Record<string, number>)[field] = value;
}

function buildShip(modules: ModuleDef[], instruments: InstrumentDef[], rules: DesignRules, cat: Catalog): ShipDef {
  const base = getShip(rules.baseShipId, cat);
  const ship: ShipDef = { ...base, name: rules.shipName, systemDrawKw: { ...base.systemDrawKw }, throttles: base.throttles };
  for (const f of rules.zeroedFields) setField(ship, f, 0);
  const adds = new Map<string, number>();
  const mults = new Map<string, number>();
  for (const m of modules) {
    for (const e of m.effects) {
      if (e.target !== 'ship') continue; // los efectos `crew` (fase 8) los aplica `effectivePsychRules`
      if (e.add !== undefined) adds.set(e.field, (adds.get(e.field) ?? 0) + e.add);
      if (e.mult !== undefined) mults.set(e.field, (mults.get(e.field) ?? 1) * e.mult);
    }
  }
  // Los instrumentos consumen de la línea de sensores (`nav`).
  const instrumentsKw = instruments.reduce((s, i) => s + i.powerKw, 0);
  if (instrumentsKw > 0) adds.set('systemDrawKw.nav', (adds.get('systemDrawKw.nav') ?? 0) + instrumentsKw);
  for (const field of new Set([...adds.keys(), ...mults.keys()])) {
    setField(ship, field, Math.max(0, (getField(ship, field) + (adds.get(field) ?? 0)) * (mults.get(field) ?? 1)));
  }
  const solar = modules.reduce((s, m) => s + (m.solarKwAt1Au ?? 0), 0);
  ship.solarKwAt1Au = solar;
  const massKg = modules.reduce((s, m) => s + m.massKg, 0) + instruments.reduce((s, i) => s + i.massKg, 0);
  ship.dryMassKg = massKg;
  if (massKg > 0) ship.fuelPerLy *= (massKg / rules.referenceMassKg) ** rules.massFuelExponent;
  // Saneado: la nave tiene que poder existir aunque el diseño sea No-Go.
  ship.hullMax = Math.max(1, ship.hullMax);
  ship.fuelCapacity = Math.max(1, ship.fuelCapacity);
  ship.startFuel = ship.fuelCapacity;
  ship.maxSpares = Math.floor(ship.maxSpares);
  ship.startSpares = Math.min(base.startSpares, ship.maxSpares);
  ship.shieldAbsorb = Math.min(rules.maxShieldAbsorb, ship.shieldAbsorb);
  ship.fuelPerLy = Math.max(1e-3, ship.fuelPerLy);
  ship.cruiseSpeedLyPerS = Math.max(1e-3, ship.cruiseSpeedLyPerS);
  return ship;
}

/**
 * Nave de la partida a partir del diseño (pura). Los módulos o instrumentos desconocidos se ignoran. Su `id`
 * es el de la nave base (`rules.baseShipId`) para que quien busque la nave en el catálogo no falle; su
 * nombre, `rules.shipName`. Las mejoras de la fase 3 se aplican encima: `effectiveShip(shipFromDesign(d), mejoras)`.
 */
export function shipFromDesign(rawDesign: MissionDesign, cat: Catalog = defaultCatalog): ShipDef {
  const design = normalizeDesign(rawDesign); // mal formado = vacío en lo que falte (no lanza)
  const rules = getDesignRules(cat);
  const modules = design.moduleIds.flatMap((id) => getModules(cat).filter((m) => m.id === id));
  const instruments = design.instrumentIds.flatMap((id) => getInstruments(cat).filter((i) => i.id === id));
  return buildShip(modules, instruments, rules, cat);
}

/** Masa total del diseño (kg): módulos + instrumentos. */
export function designMassKg(design: MissionDesign, cat: Catalog = defaultCatalog): number {
  return shipFromDesign(design, cat).dryMassKg ?? 0;
}

// ─── Presupuestos ───────────────────────────────────────────────────────────

interface Draft {
  resource: DesignResource;
  determinate: boolean;
}

function makeResource(id: DesignResourceId, used: number, available: number, unit: string, why: MessageRef, tight: number): Draft {
  let margin: number;
  let determinate = true;
  if (available > 0) margin = (available - used) / available;
  else if (used > 0) margin = -1;
  else {
    margin = 0;
    determinate = false;
  }
  const status = !determinate ? 'ok' : margin < -1e-9 ? 'over' : margin < tight ? 'tight' : 'ok';
  return { resource: { id, used, available, unit, margin, status, why }, determinate };
}

function budgetsFrom(a: Analysis): DesignBudgets {
  const t = a.totals;
  const tight = a.rules.tightMargin;
  const massKg = round(t.massKg, 0);
  const drafts: Draft[] = [];

  // Masa: el menor límite entre el lanzador (a la zona del destino) y la estructura.
  if (a.launcher && a.zone && a.launcherCapacityKg === 0) {
    drafts.push(makeResource('mass', t.massKg, 0, 'kg', { key: 'design.why.mass.unreachable', params: { launcher: a.launcher.id, zone: a.zone.id } }, tight));
  } else if (t.massLimitKg <= 0) {
    drafts.push(makeResource('mass', t.massKg, 0, 'kg', { key: 'design.why.mass.missing', params: { massKg } }, tight));
  } else {
    const byLauncher = a.launcherCapacityKg !== null && a.launcherCapacityKg <= (a.structureMaxKg ?? Infinity);
    const why: MessageRef = byLauncher
      ? { key: 'design.why.mass.launcher', params: { massKg, capacityKg: t.massLimitKg, launcher: a.launcher!.id, zone: a.zone!.id } }
      : { key: 'design.why.mass.structure', params: { massKg, capacityKg: t.massLimitKg } };
    drafts.push(makeResource('mass', t.massKg, t.massLimitKg, 'kg', why, tight));
  }

  // Potencia en el destino: paneles (1/d²) + nuclear frente al consumo a crucero con todo encendido.
  // Se mide en el peor punto de la ruta (el más alejado del Sol), que puede no ser el destino.
  const powerParams = {
    demandKw: round(t.demandKw), supplyKw: round(t.powerAtWorstKw), solarKw: round(t.solarKwAtWorst), nuclearKw: round(t.nuclearKw), au: round(t.worstAu, 2),
  };
  drafts.push(
    makeResource('power', t.demandKw, t.powerAtWorstKw, 'kW', a.destination
      ? { key: 'design.why.power.worst', params: { ...powerParams, body: t.worstBodyId } }
      : { key: 'design.why.power.noDestination', params: { demandKw: powerParams.demandKw, supplyKw: round(t.solarKwAt1Au + t.nuclearKw) } }, tight),
  );

  // Coste.
  const budget = a.mission?.budgetMUSD ?? 0;
  drafts.push(
    makeResource('cost', t.costMUSD, budget, 'MUSD', {
      key: 'design.why.cost',
      params: { costMUSD: round(t.costMUSD, 0), launcherMUSD: round(a.launcher?.costMUSD ?? 0, 0), budgetMUSD: budget },
    }, tight),
  );

  // Calendario.
  const deadline = a.mission?.deadlineMonths ?? 0;
  const devMonths = round(t.scheduleMonths - (a.launcher?.waitMonths ?? 0));
  drafts.push(
    makeResource('schedule', t.scheduleMonths, deadline, 'months', {
      key: 'design.why.schedule',
      params: { devMonths, waitMonths: a.launcher?.waitMonths ?? 0, deadlineMonths: deadline },
    }, tight),
  );

  // Ranuras.
  drafts.push(
    makeResource('slots', t.slotsUsed, t.slots, 'slots', a.byKind.structure.length > 0
      ? { key: 'design.why.slots', params: { used: t.slotsUsed, slots: t.slots } }
      : { key: 'design.why.slotsNoStructure', params: { used: t.slotsUsed } }, tight),
  );

  // Combustible: el tramo más largo hasta el destino frente al depósito útil.
  const usable = t.fuelCapacity * (1 - a.rules.rangeReservePct / 100);
  const fuelWhy: MessageRef = a.destination && a.longestLeg
    ? { key: 'design.why.fuel', params: { fuel: round(t.legFuel, 0), capacity: round(usable, 0), from: a.longestLeg.from.id, to: a.longestLeg.to.id } }
    : { key: 'design.why.fuelNoDestination', params: { capacity: round(usable, 0) } };
  drafts.push(makeResource('fuel', a.byKind.tank.length > 0 || a.destination ? t.legFuel : 0, a.byKind.tank.length > 0 ? usable : 0, 'fuel', fuelWhy, tight));

  const empty = a.modules.length === 0 && a.instruments.length === 0 && !a.launcher;
  let limiting: DesignResourceId | null = null;
  if (!empty) {
    let best = Infinity;
    for (const d of drafts) {
      if (d.determinate && d.resource.margin < best) {
        best = d.resource.margin;
        limiting = d.resource.id;
      }
    }
  }
  const resources = DESIGN_RESOURCE_IDS.map((id) => drafts.find((d) => d.resource.id === id)!.resource);
  return { resources, limiting, totals: t };
}

/** Presupuestos del diseño (puros y baratos). */
export function computeDesignBudgets(design: MissionDesign, cat: Catalog = defaultCatalog): DesignBudgets {
  return budgetsFrom(analyze(design, cat));
}

// ─── Go/No-Go ───────────────────────────────────────────────────────────────

/**
 * Revisión Go/No-Go. `go = false` si hay algún `blocker`. Bloquean: misión, destino o lanzador ausentes,
 * desconocidos o no permitidos; piezas desconocidas; sin estructura, propulsión, energía, comunicaciones o
 * computadora (o dos estructuras/propulsiones); ranuras, masa (lanzador o estructura), lanzador que no llega,
 * potencia en el destino, coste, calendario, combustible del tramo, comunicaciones sin alcance, tipo de
 * ciencia obligatorio sin instrumento y ciencia insuficiente. Avisan: márgenes justos, fiabilidad baja, sin
 * baterías, calor que no se disipa, radiación sin computadora endurecida y sin escudos.
 */
export function reviewDesign(rawDesign: MissionDesign, cat: Catalog = defaultCatalog): DesignReview {
  const a = analyze(rawDesign, cat);
  const design = a.design; // normalizado
  const budgets = budgetsFrom(a);
  const t = a.totals;
  const issues: DesignIssue[] = [];
  const add = (severity: DesignIssue['severity'], code: string, params?: MessageRef['params']) =>
    issues.push({ severity, code, message: params ? { key: `design.review.${code}`, params } : { key: `design.review.${code}` } });
  const blocker = (code: string, params?: MessageRef['params']) => add('blocker', code, params);
  const warning = (code: string, params?: MessageRef['params']) => add('warning', code, params);

  // ── Objetivo, destino y lanzador
  const m = a.mission;
  if (!m) blocker('unknown-mission', { id: design.missionId });
  if (!design.destinationId) blocker('no-destination');
  else if (!a.destination) blocker('unknown-destination', { id: design.destinationId });
  else if (m && !m.destinations.includes(a.destination.id)) blocker('destination-not-allowed', { body: a.destination.id });
  if (!design.launcherId) blocker('no-launcher');
  else if (!a.launcher) blocker('unknown-launcher', { id: design.launcherId });

  // ── Piezas
  for (const id of new Set(a.unknownModules)) blocker('unknown-module', { id });
  for (const id of new Set(a.unknownInstruments)) blocker('unknown-instrument', { id });
  const k = a.byKind;
  if (k.structure.length === 0) blocker('no-structure');
  else if (k.structure.length > 1) blocker('multiple-structures', { count: k.structure.length });
  if (k.propulsion.length === 0) blocker('no-propulsion');
  else if (k.propulsion.length > 1) blocker('multiple-propulsion', { count: k.propulsion.length });
  if (k.solar.length === 0 && k.nuclear.length === 0) blocker('no-power');
  if (k.comms.length === 0) blocker('no-comms');
  if (k.computer.length === 0) blocker('no-computer');
  if (k.structure.length > 0 && t.slotsUsed > t.slots) blocker('slots', { used: t.slotsUsed, slots: t.slots });

  // ── Masa y lanzador
  const massKg = round(t.massKg, 0);
  if (a.launcher && a.zone && a.launcherCapacityKg === 0) blocker('launcher-cannot-reach', { launcher: a.launcher.id, zone: a.zone.id });
  else if (a.launcher && a.launcherCapacityKg && t.massKg > a.launcherCapacityKg) blocker('mass-launcher', { massKg, capacityKg: a.launcherCapacityKg, launcher: a.launcher.id });
  if (a.structureMaxKg !== null && t.massKg > a.structureMaxKg) blocker('mass-structure', { massKg, capacityKg: a.structureMaxKg });

  // ── Recursos
  const hasPower = k.solar.length > 0 || k.nuclear.length > 0;
  if (a.destination && hasPower && t.demandKw > t.powerAtWorstKw + 1e-9) {
    blocker('power', { demandKw: round(t.demandKw), supplyKw: round(t.powerAtWorstKw), au: round(t.worstAu, 2), body: t.worstBodyId });
  }
  if (m && t.costMUSD > m.budgetMUSD + 1e-9) blocker('cost', { costMUSD: round(t.costMUSD, 0), budgetMUSD: m.budgetMUSD });
  if (m && t.scheduleMonths > m.deadlineMonths + 1e-9) blocker('schedule', { months: round(t.scheduleMonths), deadlineMonths: m.deadlineMonths });
  const usable = t.fuelCapacity * (1 - a.rules.rangeReservePct / 100);
  if (a.destination && k.propulsion.length > 0 && t.legFuel > usable + 1e-9) blocker('range', { fuel: round(t.legFuel, 0), capacity: round(usable, 0) });
  if (a.destination && k.comms.length > 0 && t.worstAu > a.commsRangeAu + 1e-9) {
    blocker('comms-range', { au: round(t.worstAu, 2), rangeAu: a.commsRangeAu, body: t.worstBodyId });
  }

  // ── Misión guiada (fase 5): la nave, el lanzador y el destino son fijos; la carga, de su lista.
  const g = m?.guided;
  if (g) {
    const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
    if (!same(design.moduleIds, g.moduleIds) || design.launcherId !== g.launcherId) blocker('guided-ship');
    const extra = design.instrumentIds.find((x) => !g.instrumentIds.includes(x));
    if (extra) blocker('guided-instrument', { instrument: extra });
  }

  // ── Requisitos científicos
  if (m) {
    for (const kind of m.requirements.requiredKinds) {
      if (!a.instruments.some((i) => i.scienceKind === kind)) blocker('missing-science-kind', { kind });
    }
    if (t.scienceValue < m.requirements.minScience - 1e-9) blocker('science', { science: round(t.scienceValue, 0), required: m.requirements.minScience });
  }

  // ── Avisos
  for (const r of budgets.resources) {
    if (r.status === 'tight') warning('tight', { resource: r.id, marginPct: round(r.margin * 100, 0) });
  }
  if (m?.requirements.minReliabilityPct !== undefined && a.modules.length > 0 && t.reliabilityPct < m.requirements.minReliabilityPct) {
    warning('reliability', { pct: round(t.reliabilityPct, 0), required: m.requirements.minReliabilityPct });
  }
  if (hasPower && k.battery.length === 0) warning('no-battery');
  if (k.structure.length > 0 && t.demandKw > t.heatRejectKw + 1e-9) warning('thermal', { demandKw: round(t.demandKw), heatKw: round(t.heatRejectKw) });
  if (a.zone?.radiation && k.computer.length > 0 && !k.computer.some((c) => c.radiationHardened)) warning('radiation', { zone: a.zone.id });
  if (k.structure.length > 0 && a.ship.shieldAbsorb <= 0) warning('no-shielding');
  // Fase 8: misiones largas sin hábitat desgastan a la tripulación (solo con la cordura activa).
  if (cat.psych?.enabled && m && m.deadlineMonths >= CREW_WELLBEING_MONTHS && k.habitat.length === 0) {
    warning('crew-wellbeing', { months: m.deadlineMonths, hasHabitat: 0 });
  }

  const go = !issues.some((i) => i.severity === 'blocker');
  if (go && issues.length === 0) issues.push({ severity: 'info', code: 'all-clear', message: { key: 'design.review.all-clear' } });
  return { go, issues, budgets };
}

/**
 * Fase 5 (ADR 0018 § 6): lo que el diseño aporta a la operación en vuelo: fiabilidad total (0-1, con el lanzador),
 * calor que disipan los radiadores y la estructura (kW) y capacidad de las baterías (kWh).
 */
export function designOperations(design: MissionDesign, cat: Catalog = defaultCatalog): { reliability: number; heatRejectKw: number; batteryKwh: number } {
  const totals = computeDesignBudgets(design, cat).totals;
  const batteryKwh = design.moduleIds.reduce((s, id) => s + (getModules(cat).find((m) => m.id === id)?.batteryKwh ?? 0), 0);
  return { reliability: totals.reliabilityPct / 100, heatRejectKw: totals.heatRejectKw, batteryKwh };
}

/**
 * Fase 5 (ADR 0018 § 8): diseño de partida de una misión guiada (nave, lanzador y destino fijos, sin carga) o `null` si la
 * misión no es guiada.
 */
export function guidedStartDesign(missionId: string, cat: Catalog = defaultCatalog): MissionDesign | null {
  const m = getMissions(cat).find((x) => x.id === missionId);
  if (!m?.guided) return null;
  return { missionId, destinationId: m.destinations[0] ?? null, moduleIds: [...m.guided.moduleIds], instrumentIds: [], launcherId: m.guided.launcherId };
}

/** Pasos de la misión guiada con si ya se cumplen (se marcan solos según el diseño). `[]` si no es guiada. */
export function guidedProgress(design: MissionDesign, cat: Catalog = defaultCatalog): { check: GuidedStepCheck; done: boolean; text: LocalizedText }[] {
  const base = getMissions(cat).find((x) => x.id === design.missionId);
  if (!base?.guided) return [];
  const mission = missionAtDifficulty(base, getDifficulty(design.difficultyId, cat));
  const review = reviewDesign(design, cat);
  const kinds = new Set(design.instrumentIds.map((id) => getInstruments(cat).find((i) => i.id === id)?.scienceKind));
  const done: Record<GuidedStepCheck, boolean> = {
    instrument: design.instrumentIds.length > 0,
    'required-kinds': mission.requirements.requiredKinds.every((k) => kinds.has(k)),
    science: review.budgets.totals.scienceValue + 1e-9 >= mission.requirements.minScience,
    go: review.go,
  };
  return base.guided.steps.map((s) => ({ check: s.check, done: done[s.check], text: s.text }));
}
