/**
 * Pantalla de diseño de misión (fase 4, ADR 0016): lógica PURA de lo que se pinta y de cómo cambia el diseño.
 * Presupuestos, Go/No-Go y la nave salen del motor (`computeDesignBudgets`, `reviewDesign`); aquí no hay
 * ninguna cifra de juego ni ningún id del catálogo: solo cómo se agrupan las piezas, cómo se describe cada una
 * en una línea, qué pasaría al añadirla y cómo se guarda el último diseño de cada misión.
 */
import {
  bodySunDistanceAu, catalog as defaultCatalog, computeDesignBudgets, emptyDesign, findBody, getInstruments, getLaunchers, getMission, getMissions,
  getModules, reviewDesign, solarPowerFactor, MODULE_KINDS,
  type Catalog, type DesignBudgets, type DesignResource, type DesignResourceId, type DesignReview, type InstrumentDef, type MissionDef, type MissionDesign,
  type ModuleDef, type ModuleKind,
} from '@payload/shared';
import { FIELD_INFO } from './shop';

// ─── Piezas ───────────────────────────────────────────────────────────────────────────────────────

export type PartKind = 'module' | 'instrument';
export interface PartRef {
  kind: PartKind;
  id: string;
}

/** Familias que el motor solo admite una vez (dos estructuras o dos propulsiones bloquean): añadir otra la cambia. */
export const SINGLE_KINDS: readonly ModuleKind[] = ['structure', 'propulsion'];

const listOf = (design: MissionDesign, kind: PartKind): string[] => (kind === 'module' ? design.moduleIds : design.instrumentIds);

function findModule(id: string, cat: Catalog): ModuleDef | undefined {
  return getModules(cat).find((m) => m.id === id);
}
function findInstrument(id: string, cat: Catalog): InstrumentDef | undefined {
  return getInstruments(cat).find((m) => m.id === id);
}

/** Cuántas veces está una pieza en el diseño. */
export function countPart(design: MissionDesign, ref: PartRef): number {
  let n = 0;
  for (const id of listOf(design, ref.kind)) if (id === ref.id) n++;
  return n;
}

/**
 * Añade una pieza (devuelve un diseño NUEVO). Una estructura o una propulsión sustituyen a la que hubiera de su
 * misma familia: así montar la nave nunca deja dos cascos por un clic de más.
 */
export function addPart(design: MissionDesign, ref: PartRef, cat: Catalog = defaultCatalog): MissionDesign {
  if (ref.kind === 'instrument') return { ...design, instrumentIds: [...design.instrumentIds, ref.id] };
  const def = findModule(ref.id, cat);
  let modules = design.moduleIds;
  if (def && SINGLE_KINDS.includes(def.kind)) modules = modules.filter((id) => findModule(id, cat)?.kind !== def.kind);
  return { ...design, moduleIds: [...modules, ref.id] };
}

/** Quita UNA copia de la pieza (la última añadida). Sin ella, el diseño no cambia (mismo objeto). */
export function removePart(design: MissionDesign, ref: PartRef): MissionDesign {
  const list = listOf(design, ref.kind);
  const at = list.lastIndexOf(ref.id);
  if (at < 0) return design;
  const next = [...list.slice(0, at), ...list.slice(at + 1)];
  return ref.kind === 'module' ? { ...design, moduleIds: next } : { ...design, instrumentIds: next };
}

export function setDestination(design: MissionDesign, destinationId: string | null): MissionDesign {
  return { ...design, destinationId };
}

export function setLauncher(design: MissionDesign, launcherId: string | null): MissionDesign {
  return { ...design, launcherId };
}

/** Vacía módulos e instrumentos y conserva destino y lanzador. */
export function clearParts(design: MissionDesign): MissionDesign {
  return { ...design, moduleIds: [], instrumentIds: [] };
}

// ─── Paleta ───────────────────────────────────────────────────────────────────────────────────────

/** Grupos de la paleta del hangar (clave ui `design.group.<id>`). */
export const PALETTE_GROUPS = ['structure', 'propulsion', 'power', 'battery', 'comms', 'computer', 'thermal', 'shielding', 'tank', 'extra', 'instruments'] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** Grupo de la paleta de una familia de módulos (una familia nueva del contrato cae en «otros»). */
export function groupOfModuleKind(kind: ModuleKind): PaletteGroup {
  if (kind === 'solar' || kind === 'nuclear') return 'power';
  return (PALETTE_GROUPS as readonly string[]).includes(kind) ? (kind as PaletteGroup) : 'extra';
}

/** Piezas de un grupo, en el orden del catálogo. */
export function paletteItems(group: PaletteGroup, cat: Catalog = defaultCatalog): PartRef[] {
  if (group === 'instruments') return getInstruments(cat).map((i) => ({ kind: 'instrument', id: i.id }));
  return getModules(cat)
    .filter((m) => groupOfModuleKind(m.kind) === group)
    .map((m) => ({ kind: 'module', id: m.id }));
}

/** Grupos con alguna pieza en el catálogo (los vacíos no se enseñan). */
export function activeGroups(cat: Catalog = defaultCatalog): PaletteGroup[] {
  return PALETTE_GROUPS.filter((g) => paletteItems(g, cat).length > 0);
}

/** Todas las familias del contrato tienen grupo (para el test de que no se pierde ninguna pieza). */
export const ALL_MODULE_GROUPS: Record<ModuleKind, PaletteGroup> = Object.fromEntries(MODULE_KINDS.map((k) => [k, groupOfModuleKind(k)])) as Record<ModuleKind, PaletteGroup>;

// ─── Una línea por pieza ──────────────────────────────────────────────────────────────────────────

/**
 * Trozo de la línea de una pieza: clave ui `design.part.<key>` con sus parámetros. Los parámetros `field` y
 * `kind` llegan como id y la interfaz los muestra con su nombre (`shop.field.*`, `design.science.*` del motor).
 */
export interface PartToken {
  key: string;
  params: Record<string, string | number>;
  tone: 'gain' | 'cost';
}

const r1 = (n: number): number => (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

function effectTokens(def: ModuleDef): PartToken[] {
  const out: PartToken[] = [];
  for (const e of def.effects) {
    if (e.target !== 'ship') continue;
    const field = `ship.${e.field}`;
    const info = FIELD_INFO[field] ?? { up: true, style: 'rel' as const };
    if (e.add !== undefined && e.add !== 0) {
      const better = e.add > 0 === info.up;
      if (info.style === 'pct01') out.push({ key: 'pct', params: { field, value: Math.round(e.add * 100) }, tone: better ? 'gain' : 'cost' });
      else if (info.style === 'kw' || info.unit === 'kw') out.push({ key: 'kw', params: { field, value: r1(e.add) }, tone: better ? 'gain' : 'cost' });
      else out.push({ key: 'add', params: { field, value: r1(e.add) }, tone: better ? 'gain' : 'cost' });
    }
    if (e.mult !== undefined && e.mult !== 1) {
      const better = e.mult > 1 === info.up;
      out.push({ key: 'mult', params: { field, value: Math.round((e.mult - 1) * 100) }, tone: better ? 'gain' : 'cost' });
    }
  }
  return out;
}

/** Lo que aporta (`gains`) y lo que cuesta (`costs`) una pieza, para pintarlo en UNA línea. */
export function partTokens(ref: PartRef, cat: Catalog = defaultCatalog): { gains: PartToken[]; costs: PartToken[] } {
  const gains: PartToken[] = [];
  const costs: PartToken[] = [];
  if (ref.kind === 'instrument') {
    const def = findInstrument(ref.id, cat);
    if (!def) return { gains, costs };
    gains.push({ key: 'science', params: { kind: def.scienceKind, value: r1(def.scienceValue) }, tone: 'gain' });
    if (def.powerKw > 0) costs.push({ key: 'power', params: { value: r1(def.powerKw) }, tone: 'cost' });
    costs.push(...baseCosts(def.massKg, def.costMUSD, def.devMonths, def.slotsUsed ?? 1));
    return { gains, costs };
  }
  const def = findModule(ref.id, cat);
  if (!def) return { gains, costs };
  if (def.kind === 'structure') {
    if (def.slots !== undefined) gains.push({ key: 'slots', params: { value: def.slots }, tone: 'gain' });
    if (def.maxMassKg !== undefined) gains.push({ key: 'maxMass', params: { value: r1(def.maxMassKg / 1000) }, tone: 'gain' });
  }
  if (def.solarKwAt1Au) gains.push({ key: 'solar', params: { value: r1(def.solarKwAt1Au) }, tone: 'gain' });
  if (def.commsRangeAu) gains.push({ key: 'range', params: { value: r1(def.commsRangeAu) }, tone: 'gain' });
  if (def.batteryKwh) gains.push({ key: 'battery', params: { value: r1(def.batteryKwh) }, tone: 'gain' });
  if (def.heatRejectKw && def.kind !== 'structure') gains.push({ key: 'heat', params: { value: r1(def.heatRejectKw) }, tone: 'gain' });
  if (def.radiationHardened) gains.push({ key: 'hardened', params: {}, tone: 'gain' });
  for (const tk of effectTokens(def)) (tk.tone === 'gain' ? gains : costs).push(tk);
  costs.push(...baseCosts(def.massKg, def.costMUSD, def.devMonths, def.kind === 'structure' ? 0 : (def.slotsUsed ?? 1)));
  return { gains, costs };
}

function baseCosts(massKg: number, costMUSD: number, devMonths: number, slots: number): PartToken[] {
  const out: PartToken[] = [
    { key: 'mass', params: { value: r1(massKg) }, tone: 'cost' },
    { key: 'cost', params: { value: r1(costMUSD) }, tone: 'cost' },
    { key: 'months', params: { value: r1(devMonths) }, tone: 'cost' },
  ];
  if (slots > 0) out.push({ key: 'slotsUsed', params: { value: slots }, tone: 'cost' });
  return out;
}

/** Familia (o tipo de ciencia) de una pieza: decide su icono y su color en el hangar. */
export function partFamily(ref: PartRef, cat: Catalog = defaultCatalog): ModuleKind | 'instrument' | null {
  if (ref.kind === 'instrument') return findInstrument(ref.id, cat) ? 'instrument' : null;
  return findModule(ref.id, cat)?.kind ?? null;
}

// ─── Presupuestos y Go/No-Go ──────────────────────────────────────────────────────────────────────

/** Relleno de un medidor (0-1,25; por encima de 1 = excedido) a partir de un recurso del motor. */
export function meterFill(r: Pick<DesignResource, 'used' | 'available'>): number {
  if (r.available <= 0) return r.used > 0 ? 1.25 : 0;
  return Math.max(0, Math.min(1.25, r.used / r.available));
}

/** Recursos que pasarían a excedidos al añadir una pieza (el motor lo calcula; aquí solo se compara). */
export function previewAdd(design: MissionDesign, ref: PartRef, cat: Catalog = defaultCatalog, now: DesignBudgets = computeDesignBudgets(design, cat)): { budgets: DesignBudgets; breaks: DesignResourceId[] } {
  const budgets = computeDesignBudgets(addPart(design, ref, cat), cat);
  const breaks: DesignResourceId[] = [];
  for (const r of budgets.resources) {
    const before = now.resources.find((x) => x.id === r.id);
    if (r.status === 'over' && before?.status !== 'over') breaks.push(r.id);
  }
  return { budgets, breaks };
}

/** Problemas en orden: primero lo que bloquea, luego avisos y por último la nota informativa. */
export function sortedIssues(review: DesignReview): DesignReview['issues'] {
  const rank = { blocker: 0, warning: 1, info: 2 } as const;
  return review.issues.map((x, i) => ({ x, i })).sort((a, b) => rank[a.x.severity] - rank[b.x.severity] || a.i - b.i).map(({ x }) => x);
}

/** El botón «Lanzar» solo se activa con Go. */
export function canLaunch(review: Pick<DesignReview, 'go'>): boolean {
  return review.go;
}

/** Revisión y presupuestos de una sola vez (lo que la pantalla recalcula en cada cambio). */
export function evaluate(design: MissionDesign, cat: Catalog = defaultCatalog): DesignReview {
  return reviewDesign(design, cat);
}

// ─── Destinos y lanzadores ────────────────────────────────────────────────────────────────────────

export interface DestinationOption {
  bodyId: string;
  au: number;
  /** Potencia solar relativa a la de 1 UA (%). */
  solarPct: number;
  zoneId: string | null;
}

export function destinationOptions(mission: MissionDef, cat: Catalog = defaultCatalog): DestinationOption[] {
  return mission.destinations.flatMap((id) => {
    const body = findBody(id, cat);
    if (!body) return [];
    const au = bodySunDistanceAu(body, cat);
    return [{ bodyId: id, au, solarPct: Math.round(solarPowerFactor(au) * 100), zoneId: body.zoneId ?? null }];
  });
}

export interface LauncherOption {
  launcherId: string;
  costMUSD: number;
  waitMonths: number;
  reliabilityPct: number;
  /** Masa que pone en la zona del destino; null = no llega; undefined = falta elegir destino. */
  capacityKg: number | null | undefined;
}

export function launcherOptions(design: MissionDesign, cat: Catalog = defaultCatalog): LauncherOption[] {
  const zoneId = design.destinationId ? (findBody(design.destinationId, cat)?.zoneId ?? null) : undefined;
  return getLaunchers(cat).map((l) => ({
    launcherId: l.id,
    costMUSD: l.costMUSD,
    waitMonths: l.waitMonths,
    reliabilityPct: Math.round(l.reliability * 100),
    capacityKg: zoneId === undefined ? undefined : zoneId === null ? null : (l.capacityKgByZone[zoneId] ?? null),
  }));
}

/** Diseño nuevo de una misión: con un solo destino posible ya viene elegido. */
export function startingDesign(missionId: string, cat: Catalog = defaultCatalog): MissionDesign {
  const d = emptyDesign(missionId);
  const mission = getMissions(cat).find((m) => m.id === missionId);
  if (mission && mission.destinations.length === 1) d.destinationId = mission.destinations[0] ?? null;
  return d;
}

// ─── Guardado (último diseño por misión) ──────────────────────────────────────────────────────────

export const DESIGN_KEY_PREFIX = 'payload.design.';

/** Lo mínimo de `Storage` que se usa (los tests pasan un objeto en memoria). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Limpia un diseño leído de fuera (almacenamiento, URL): misión conocida, piezas, destino y lanzador que existan
 * en el catálogo y destino permitido por la misión. Null si no es un diseño de esa misión.
 */
export function sanitizeDesign(raw: unknown, missionId: string, cat: Catalog = defaultCatalog): MissionDesign | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof MissionDesign, unknown>>;
  if (r.missionId !== missionId) return null;
  let mission: MissionDef;
  try {
    mission = getMission(missionId, cat);
  } catch {
    return null;
  }
  const ids = (v: unknown, ok: (id: string) => boolean): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ok(x)) : []);
  const dest = typeof r.destinationId === 'string' && mission.destinations.includes(r.destinationId) ? r.destinationId : null;
  const launcher = typeof r.launcherId === 'string' && getLaunchers(cat).some((l) => l.id === r.launcherId) ? r.launcherId : null;
  return {
    missionId,
    destinationId: dest ?? startingDesign(missionId, cat).destinationId,
    moduleIds: ids(r.moduleIds, (id) => !!findModule(id, cat)),
    instrumentIds: ids(r.instrumentIds, (id) => !!findInstrument(id, cat)),
    launcherId: launcher,
  };
}

export function saveDesign(design: MissionDesign, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(DESIGN_KEY_PREFIX + design.missionId, JSON.stringify(design));
    return true;
  } catch {
    return false;
  }
}

/** El último diseño guardado de la misión (limpio) o uno nuevo. */
export function loadDesign(missionId: string, cat: Catalog = defaultCatalog, store: KeyValueStore | null = defaultStore()): MissionDesign {
  if (store) {
    try {
      const saved = sanitizeDesign(JSON.parse(store.getItem(DESIGN_KEY_PREFIX + missionId) ?? 'null'), missionId, cat);
      if (saved) return saved;
    } catch {
      /* guardado roto o sin almacenamiento */
    }
  }
  return startingDesign(missionId, cat);
}

// ─── Teclado ──────────────────────────────────────────────────────────────────────────────────────

/** Índice siguiente en una lista circular con flechas (arriba/abajo o izquierda/derecha). */
export function cycleIndex(index: number, size: number, key: string): number {
  if (size <= 0) return 0;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (index + 1) % size;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (index - 1 + size) % size;
  return Math.max(0, Math.min(size - 1, index));
}

/** Atajos de una pieza enfocada: añadir (Intro, +) o quitar (Supr, Retroceso, −). */
export function partKeyAction(key: string): 'add' | 'remove' | null {
  if (key === 'Enter' || key === '+' || key === 'NumpadAdd') return 'add';
  if (key === 'Delete' || key === 'Backspace' || key === '-' || key === 'NumpadSubtract') return 'remove';
  return null;
}

/** Ciencia que lleva el diseño frente a la pedida (para la tarjeta de la misión y el medidor de ciencia). */
export function scienceOf(review: DesignReview, mission: MissionDef): { value: number; required: number; ok: boolean } {
  const value = review.budgets.totals.scienceValue;
  return { value, required: mission.requirements.minScience, ok: value >= mission.requirements.minScience };
}

/** Hay un diseño guardado de esa misión (para marcar su tarjeta). */
export function hasSavedDesign(missionId: string, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    return store.getItem(DESIGN_KEY_PREFIX + missionId) !== null;
  } catch {
    return false;
  }
}
