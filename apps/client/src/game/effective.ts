/**
 * Nave y reglas de superficie EFECTIVAS (con las mejoras compradas) a partir de un `RunState`. Lo calcula
 * el motor (`effectiveShip` / `effectiveSurfaceRules`); aquí solo se guarda el último resultado para no
 * repetirlo en cada frame ni en cada refresco del HUD (sin `new` por frame mientras no cambien las mejoras).
 *
 * Los máximos que pinta la interfaz (depósito, casco, reactor, mochila, O₂ del traje…) salen de aquí, nunca
 * de la `ShipDef` base ni de `getSurfaceCatalog(cat).rules`.
 */
import {
  catalog as defaultCatalog, crewCarryCapacityKg, crewJetpackDrainPctPerS, effectiveShip, effectiveSurfaceRules, getShip, getSurfaceCatalog,
  type Catalog, type RunState, type ShipDef, type SurfaceRules,
} from '@payload/shared';
import { myCrew } from './me';

type Levels = Readonly<Record<string, number>>;

/** Mismos niveles (lo que falta cuenta como 0). Sin crear objetos. */
export function sameLevels(a: Levels, b: Levels): boolean {
  for (const k in a) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  for (const k in b) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

interface Memo<T> {
  cat: Catalog | null;
  key: string;
  levels: Levels;
  value: T | null;
}

function memo<T>(): Memo<T> {
  return { cat: null, key: '', levels: {}, value: null };
}

const shipMemo = memo<ShipDef>();
const rulesMemo = memo<SurfaceRules>();
const NONE: Levels = {};

/** La nave con las mejoras de `state.upgrades` (la misma que usa el motor). */
export function effectiveShipOf(state: Pick<RunState, 'ship' | 'upgrades'>, cat: Catalog = defaultCatalog): ShipDef {
  const levels = state.upgrades ?? NONE;
  const m = shipMemo;
  if (m.value && m.cat === cat && m.key === state.ship.shipId && sameLevels(m.levels, levels)) return m.value;
  m.value = effectiveShip(getShip(state.ship.shipId, cat), levels, cat);
  m.cat = cat;
  m.key = state.ship.shipId;
  m.levels = { ...levels };
  return m.value;
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
