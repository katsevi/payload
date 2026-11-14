/**
 * Nave y reglas de superficie EFECTIVAS (con las mejoras compradas) a partir de un `RunState`. Lo calcula
 * el motor (`effectiveShip` / `effectiveSurfaceRules`); aquí solo se guarda el último resultado para no
 * repetirlo en cada frame ni en cada refresco del HUD (sin `new` por frame mientras no cambien las mejoras).
 *
 * Los máximos que pinta la interfaz (depósito, casco, reactor, mochila, O₂ del traje…) salen de aquí, nunca
 * de la `ShipDef` base ni de `getSurfaceCatalog(cat).rules`.
 *
 * Fase 4 (ADR 0016): con `state.missionDesign` la nave BASE es `shipFromDesign(diseño)` (el `shipId` sigue
 * siendo el de la nave del catálogo de la que parte, así que no basta con `getShip(shipId)`).
 */
import {
  catalog as defaultCatalog, crewCarryCapacityKg, crewJetpackDrainPctPerS, effectiveShip, effectiveSurfaceRules, getShip, getSurfaceCatalog, shipFromDesign, shipPowerKw,
  type Catalog, type MissionDesign, type RunState, type ShipDef, type SurfaceRules,
} from '@payload/shared';
import { myCrew } from './me';

type Levels = Readonly<Record<string, number>>;

/** Mismos niveles (lo que falta cuenta como 0). Sin crear objetos. */
export function sameLevels(a: Levels, b: Levels): boolean {
  for (const k in a) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  for (const k in b) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Mismo diseño (mismas piezas en el mismo orden; ausente = sin diseño). Sin crear objetos. */
export function sameDesign(a: MissionDesign | null | undefined, b: MissionDesign | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.missionId === b.missionId && a.destinationId === b.destinationId && a.launcherId === b.launcherId && sameList(a.moduleIds, b.moduleIds) && sameList(a.instrumentIds, b.instrumentIds);
}

const copyDesign = (d: MissionDesign | undefined): MissionDesign | null =>
  d ? { ...d, moduleIds: [...d.moduleIds], instrumentIds: [...d.instrumentIds] } : null;

type BaseState = Pick<RunState, 'ship'> & Partial<Pick<RunState, 'missionDesign'>>;

const baseMemo: { cat: Catalog | null; shipId: string; design: MissionDesign | null; value: ShipDef | null } = { cat: null, shipId: '', design: null, value: null };

/** Nave base de la partida SIN mejoras: la diseñada si hay diseño; si no, la del catálogo. */
export function baseShipOf(state: BaseState, cat: Catalog = defaultCatalog): ShipDef {
  const m = baseMemo;
  const design = state.missionDesign;
  if (m.value && m.cat === cat && m.shipId === state.ship.shipId && sameDesign(m.design, design)) return m.value;
  m.value = design ? shipFromDesign(design, cat) : getShip(state.ship.shipId, cat);
  m.cat = cat;
  m.shipId = state.ship.shipId;
  m.design = copyDesign(design);
  return m.value;
}

interface Memo<T> {
  cat: Catalog | null;
  base: ShipDef | null;
  /** Rol de mi tripulante (solo para las reglas de superficie en cooperativo; '' = sin rol). */
  key: string;
  levels: Levels;
  value: T | null;
}

const shipMemo: Memo<ShipDef> = { cat: null, base: null, key: '', levels: {}, value: null };
const rulesMemo: Memo<SurfaceRules> = { cat: null, base: null, key: '', levels: {}, value: null };
const NONE: Levels = {};

/** La nave con las mejoras de `state.upgrades` (la misma que usa el motor). */
export function effectiveShipOf(state: BaseState & Partial<Pick<RunState, 'upgrades'>>, cat: Catalog = defaultCatalog): ShipDef {
  const levels = state.upgrades ?? NONE;
  const base = baseShipOf(state, cat);
  const m = shipMemo;
  if (m.value && m.cat === cat && m.base === base && sameLevels(m.levels, levels)) return m.value;
  m.value = effectiveShip(base, levels, cat);
  m.cat = cat;
  m.base = base;
  m.levels = { ...levels };
  return m.value;
}

/**
 * Potencia máxima de la nave sana a la distancia al Sol actual (nuclear + paneles × 1/d²): el 100 % de la
 * barra de energía. Sin diseño es el reactor de siempre. Nunca 0 (evita dividir entre cero en las barras).
 */
export function maxPowerKwOf(state: BaseState & Partial<Pick<RunState, 'upgrades' | 'sunDistanceAu'>>, cat: Catalog = defaultCatalog): number {
  const ship = effectiveShipOf(state, cat);
  return Math.max(1e-6, shipPowerKw(ship, state.sunDistanceAu ?? 1));
}

/**
 * Reglas de traje, jetpack y caídas con las mejoras de `state.upgrades` y, en cooperativo, con la ventaja
 * del rol de MI tripulante (mochila y jetpack del explorador): lo que pinta la interfaz es lo que cobra el motor.
 */
export function effectiveRulesOf(state: (Pick<RunState, 'upgrades'> & Partial<Pick<RunState, 'crew'>>) | null | undefined, cat: Catalog = defaultCatalog): SurfaceRules {
  const levels = state?.upgrades ?? NONE;
  const me = state?.crew ? myCrew({ crew: state.crew }) : undefined;
  const role = me?.role ?? '';
  const m = rulesMemo;
  if (m.value && m.cat === cat && m.key === role && sameLevels(m.levels, levels)) return m.value;
  const base = effectiveSurfaceRules(getSurfaceCatalog(cat).rules, levels, cat);
  m.value = role
    ? { ...base, suit: { ...base.suit, carryCapacityKg: crewCarryCapacityKg(base, me, cat) }, jetpack: { ...base.jetpack, drainPctPerS: crewJetpackDrainPctPerS(base, me, cat) } }
    : base;
  m.cat = cat;
  m.key = role;
  m.levels = { ...levels };
  return m.value;
}
