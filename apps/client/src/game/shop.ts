/**
 * Terminal de estación (fase 3, ADR 0014): lógica PURA de lo que se pinta y de lo que se envía al motor.
 * Precios, unidades, ofertas y créditos salen de `run.stationQuote()`; el efecto de una mejora sale de
 * comparar `effectiveShip` / `effectiveSurfaceRules` con un nivel más frente a los actuales. Aquí no hay
 * ninguna cifra de juego: solo cómo se presenta cada campo (qué es mejor, en qué unidad).
 */
import {
  catalog as defaultCatalog, effectiveShip, effectiveSurfaceRules, getShip, getSurfaceCatalog, getThrottle, getUpgrade, SUPPLY_IDS, UPGRADE_FIELDS,
  type ActionResult, type Catalog, type MessageRef, type RunAction, type RunState, type ShipDef, type StationQuote, type SupplyId, type SurfaceRules, type UpgradeTarget,
} from '@payload/shared';

// ─── Venta ────────────────────────────────────────────────────────────────────────────────────────

export interface SellRow {
  materialId: string;
  units: number;
  unitPrice: number;
  total: number;
}

/** Filas de venta: un material por fila, lo más valioso arriba (empate: orden del motor). */
export function sellRows(quote: StationQuote): SellRow[] {
  return quote.sell
    .filter((x) => x.units > 0 && x.unitPrice > 0)
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.total - a.total || a.i - b.i)
    .map(({ materialId, units, unitPrice, total }) => ({ materialId, units, unitPrice, total }));
}

/** Vender: una unidad, todo un material (`units` omitido) o toda la bodega (`materialId` omitido). */
export function sellAction(materialId?: string, units?: number): RunAction {
  if (materialId === undefined) return { type: 'sell' };
  return units === undefined ? { type: 'sell', materialId } : { type: 'sell', materialId, units };
}

// ─── Suministros ──────────────────────────────────────────────────────────────────────────────────

/** Por qué un botón está deshabilitado (null = se puede). */
export type ShopBlock = 'full' | 'noCredits' | 'maxed' | null;

/** Cuánto se compra con el botón pequeño de cada suministro (granularidad de la interfaz, no del juego). */
export const SUPPLY_STEP: Record<SupplyId, number> = { fuel: 10, hull: 10, spares: 1 };

/** El motor no vende menos de esto (repuestos enteros; combustible y casco desde media unidad). */
const minRoom = (supply: SupplyId): number => (supply === 'spares' ? 1 : 0.5);

export interface SupplyRow {
  supply: SupplyId;
  current: number;
  max: number;
  unitPrice: number;
  missing: number;
  /**
   * «Llenar»: lo que se compraría (lo que quepa y se pueda pagar) y lo que costaría. Si no llega el dinero
   * (`fillBlock` = 'noCredits'), lo que costaría llenarlo (para pintarlo en rojo).
   */
  fillUnits: number;
  fillCost: number;
  /** Se puede llenar del todo con los créditos actuales. */
  fillsUp: boolean;
  fillBlock: ShopBlock;
  /** Botón pequeño (+`SUPPLY_STEP`, o lo que falte); igual que «llenar» si no llega el dinero. */
  stepUnits: number;
  stepCost: number;
  stepBlock: ShopBlock;
}

const ceilCost = (units: number, unitPrice: number): number => Math.ceil(units * unitPrice - 1e-9);

function currentOf(state: RunState, supply: SupplyId): number {
  return supply === 'fuel' ? state.ship.fuel : supply === 'hull' ? state.ship.hull : state.ship.spares;
}

function maxOf(ship: ShipDef, supply: SupplyId): number {
  return supply === 'fuel' ? ship.fuelCapacity : supply === 'hull' ? ship.hullMax : ship.maxSpares;
}

/** Filas de suministros con la nave EFECTIVA (`ship`): un depósito ampliado se ve con su nuevo máximo. */
export function supplyRows(quote: StationQuote, state: RunState, ship: ShipDef): SupplyRow[] {
  return SUPPLY_IDS.map((supply) => {
    const q = quote.supplies[supply];
    const full = q.missing < minRoom(supply);
    // Lo que el motor compraría: lo que quepa y se pueda pagar (repuestos y compras parciales, enteros).
    const canFill = full ? 0 : q.affordable >= q.missing ? q.missing : Math.floor(q.affordable);
    const fillBlock: ShopBlock = full ? 'full' : canFill < minRoom(supply) ? 'noCredits' : null;
    const stepWanted = Math.min(SUPPLY_STEP[supply], q.missing);
    const canStep = full ? 0 : stepWanted < q.missing ? Math.min(stepWanted, Math.floor(q.affordable)) : Math.min(stepWanted, q.affordable);
    const stepBlock: ShopBlock = full ? 'full' : canStep < minRoom(supply) ? 'noCredits' : null;
    // Deshabilitado por créditos: se enseña lo que costaría (en rojo), no «0».
    const fillUnits = fillBlock === 'noCredits' ? q.missing : canFill;
    const stepUnits = stepBlock === 'noCredits' ? stepWanted : canStep;
    const fillsUp = !full && fillUnits >= q.missing;
    return {
      supply,
      current: currentOf(state, supply),
      max: maxOf(ship, supply),
      unitPrice: q.unitPrice,
      missing: q.missing,
      fillUnits,
      fillCost: fillsUp ? q.fillCost : ceilCost(fillUnits, q.unitPrice),
      fillsUp,
      fillBlock,
      stepUnits,
      stepCost: ceilCost(stepUnits, q.unitPrice),
      stepBlock,
    };
  });
}

/** Comprar un suministro: sin `amount`, «llenar» (el motor compra lo que quepa y se pueda pagar). */
export function buySupplyAction(supply: SupplyId, amount?: number): RunAction {
  return amount === undefined ? { type: 'buy-supply', supply } : { type: 'buy-supply', supply, amount };
}

// ─── Mejoras ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Cómo se presenta cada campo que puede tocar una mejora: `up` = más es mejor; `abs` = antes → después,
 * `pct01` = fracción 0-1 mostrada como %, `rel` = cambio relativo (±N %), `kw` = diferencia en kW.
 */
export type FieldStyle = 'abs' | 'pct01' | 'rel' | 'kw';
export interface FieldInfo {
  up: boolean;
  style: FieldStyle;
  /** Unidad para `abs` (clave ui `shop.unit.*`), si tiene. */
  unit?: 'kg' | 'm' | 'mps' | 'kw';
}

export const FIELD_INFO: Record<string, FieldInfo> = {
  'ship.hullMax': { up: true, style: 'abs' },
  'ship.fuelCapacity': { up: true, style: 'abs' },
  'ship.maxSpares': { up: true, style: 'abs' },
  'ship.reactorOutputKw': { up: true, style: 'abs', unit: 'kw' },
  'ship.cruiseSpeedLyPerS': { up: true, style: 'rel' },
  'ship.fuelPerLy': { up: false, style: 'rel' },
  'ship.damagedEngineFuelPenalty': { up: false, style: 'rel' },
  'ship.evadeFuel': { up: false, style: 'rel' },
  'ship.crewO2UsePctPerS': { up: false, style: 'rel' },
  'ship.o2RegenPctPerS': { up: true, style: 'rel' },
  'ship.shieldAbsorb': { up: true, style: 'pct01' },
  'ship.shieldWearPctPerHit': { up: false, style: 'rel' },
  'ship.overloadReactorDamagePctPerS': { up: false, style: 'rel' },
  'ship.systemDrawKw.engines': { up: false, style: 'kw' },
  'ship.systemDrawKw.lifeSupport': { up: false, style: 'kw' },
  'ship.systemDrawKw.shields': { up: false, style: 'kw' },
  'ship.systemDrawKw.nav': { up: false, style: 'kw' },
  'suit.o2DrainPctPerS': { up: false, style: 'rel' },
  'suit.carryCapacityKg': { up: true, style: 'abs', unit: 'kg' },
  'suit.refillShipO2PctPerTank': { up: false, style: 'rel' },
  'suit.airlockCycleShipO2Pct': { up: false, style: 'rel' },
  'suit.collectRangeM': { up: true, style: 'abs', unit: 'm' },
  'jetpack.drainPctPerS': { up: false, style: 'rel' },
  'jetpack.rechargePctPerS': { up: true, style: 'rel' },
  'falls.harmlessMps': { up: true, style: 'abs', unit: 'mps' },
  'falls.o2LossPctPerMps': { up: false, style: 'rel' },
  'falls.lethalMps': { up: true, style: 'abs', unit: 'mps' },
};

/** Todos los campos que el contrato deja tocar, como `objetivo.campo` (para el test de que no falta ninguno). */
export const ALL_FIELDS: string[] = (Object.keys(UPGRADE_FIELDS) as UpgradeTarget[]).flatMap((t) => UPGRADE_FIELDS[t].map((f) => `${t}.${f}`));

export interface EffectDelta {
  /** `objetivo.campo`, p. ej. `ship.fuelCapacity` (clave ui `shop.field.<field>`). */
  field: string;
  before: number;
  after: number;
  /** El cambio es a mejor (ganancia) o a peor (contrapartida). */
  good: boolean;
  style: FieldStyle;
  unit?: FieldInfo['unit'];
}

function read(obj: unknown, path: string): number {
  let cur: unknown = obj;
  for (const p of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined;
  return typeof cur === 'number' ? cur : 0;
}

/** Lo que cambia (nave y reglas efectivas) al comprar el SIGUIENTE nivel de una mejora. Vacío si está al máximo. */
export function upgradeDeltas(upgradeId: string, levels: Readonly<Record<string, number>>, shipId: string, cat: Catalog = defaultCatalog): EffectDelta[] {
  const def = getUpgrade(upgradeId, cat);
  const level = levels[upgradeId] ?? 0;
  if (level >= def.levels.length) return [];
  const next = { ...levels, [upgradeId]: level + 1 };
  const base = getShip(shipId, cat);
  const baseRules = getSurfaceCatalog(cat).rules;
  const now = shipAndRules(effectiveShip(base, levels, cat), effectiveSurfaceRules(baseRules, levels, cat));
  const then = shipAndRules(effectiveShip(base, next, cat), effectiveSurfaceRules(baseRules, next, cat));
  const out: EffectDelta[] = [];
  for (const field of ALL_FIELDS) {
    const [target, ...rest] = field.split('.') as [UpgradeTarget, ...string[]];
    const before = read(now[target], rest.join('.'));
    const after = read(then[target], rest.join('.'));
    if (Math.abs(after - before) < 1e-9) continue;
    const info = FIELD_INFO[field] ?? { up: true, style: 'rel' as const };
    out.push({ field, before, after, good: after > before === info.up, style: info.style, ...(info.unit ? { unit: info.unit } : {}) });
  }
  return out;
}

function shipAndRules(ship: ShipDef, rules: SurfaceRules): Record<UpgradeTarget, unknown> {
  return { ship, suit: rules.suit, jetpack: rules.jetpack, falls: rules.falls };
}

/** Valor a mostrar de un efecto: antes → después, o el cambio relativo (en %), o la diferencia en kW. */
export function deltaText(d: EffectDelta): { before?: number; after?: number; change?: number } {
  switch (d.style) {
    case 'abs':
      return { before: round(d.before), after: round(d.after) };
    case 'pct01':
      return { before: Math.round(d.before * 100), after: Math.round(d.after * 100) };
    case 'kw':
      return { change: round(d.after - d.before) };
    case 'rel':
      return { change: d.before === 0 ? 0 : Math.round(((d.after - d.before) / Math.abs(d.before)) * 100) };
  }
}

const round = (n: number): number => (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

/** Como mucho tantos efectos de cada lado en la línea de una mejora (una línea: se juega, no se lee). */
export const MAX_GAINS = 2;
export const MAX_COSTS = 2;

export interface UpgradeRow {
  upgradeId: string;
  level: number;
  maxLevel: number;
  nextLevel: number | null;
  price: number | null;
  massKg: number;
  /** Lo que gana (antes → después) y lo que cuesta además de los créditos y la masa. */
  gains: EffectDelta[];
  costs: EffectDelta[];
  block: ShopBlock;
  /** Campo que da el icono de la mejora (su primer efecto en el catálogo). */
  iconField: string;
  /** Con el siguiente nivel, todo encendido a crucero pide más de lo que da el reactor (aviso en ámbar). */
  overloads: boolean;
}

/**
 * ¿La nave sobrecarga el reactor a régimen de crucero con todos los sistemas encendidos? (Misma cuenta que el
 * motor: suma de consumos, motores × `engineDrawMult` del régimen, frente a `reactorOutputKw` sano.)
 */
export function overloadsAtCruise(ship: ShipDef): boolean {
  const draw = ship.systemDrawKw;
  const demand = draw.engines * getThrottle(ship, 'cruise').engineDrawMult + draw.lifeSupport + draw.shields + draw.nav;
  return demand > ship.reactorOutputKw + 1e-9;
}

/**
 * Aviso de sobrecarga de una línea de la terminal: el del motor si lo da (`overloadsAtCruise` en la cotización,
 * aditivo) y, si no, calculado con la nave efectiva con un nivel más.
 */
export function upgradeOverloads(entry: StationQuote['upgrades'][number], levels: Readonly<Record<string, number>>, shipId: string, cat: Catalog = defaultCatalog): boolean {
  if (entry.nextLevel === null) return false;
  const fromEngine = (entry as { overloadsAtCruise?: unknown }).overloadsAtCruise;
  if (typeof fromEngine === 'boolean') return fromEngine;
  return overloadsAtCruise(effectiveShip(getShip(shipId, cat), { ...levels, [entry.upgradeId]: entry.level + 1 }, cat));
}

/** Campo del primer efecto del primer nivel: decide el icono de la mejora (sin mirar su id). */
export function iconFieldOf(upgradeId: string, cat: Catalog = defaultCatalog): string {
  const e = getUpgrade(upgradeId, cat).levels[0]?.effects[0];
  return e ? `${e.target}.${e.field}` : '';
}

export function upgradeRows(quote: StationQuote, state: Pick<RunState, 'upgrades' | 'ship'>, cat: Catalog = defaultCatalog): UpgradeRow[] {
  return quote.upgrades.map((u) => {
    const deltas = upgradeDeltas(u.upgradeId, state.upgrades ?? {}, state.ship.shipId, cat);
    return {
      upgradeId: u.upgradeId,
      level: u.level,
      maxLevel: u.maxLevel,
      nextLevel: u.nextLevel,
      price: u.price,
      massKg: u.massKg,
      gains: deltas.filter((d) => d.good).slice(0, MAX_GAINS),
      costs: deltas.filter((d) => !d.good).slice(0, MAX_COSTS),
      block: u.nextLevel === null ? 'maxed' : !u.affordable ? 'noCredits' : null,
      iconField: iconFieldOf(u.upgradeId, cat),
      overloads: upgradeOverloads(u, state.upgrades ?? {}, state.ship.shipId, cat),
    };
  });
}

/**
 * Despacha una acción de la terminal SIN el aviso global (`quiet`): con el terminal abierto el rechazo se ve una
 * sola vez, dentro del terminal. Devuelve el mensaje a mostrar (null si salió bien) y avisa de la falta de créditos
 * para su sonido (`cue('noCredits')`).
 */
export function dispatchShop(act: (a: RunAction, quiet?: boolean) => ActionResult, action: RunAction, onNoCredits: () => void): MessageRef | null {
  const r = act(action, true);
  if (r.ok) return null;
  if (r.reason.key === 'reject.noCredits') onNoCredits();
  return r.reason;
}

export function buyUpgradeAction(upgradeId: string): RunAction {
  return { type: 'buy-upgrade', upgradeId };
}

// ─── Mapa estelar ─────────────────────────────────────────────────────────────────────────────────

/** Sobrecoste del salto por la masa a bordo, en % entero (de `estimateJump().cargoFuelMult`; 0 si no pesa). */
export function cargoFuelPct(mult: number | undefined): number {
  return mult === undefined ? 0 : Math.max(0, Math.round((mult - 1) * 100));
}

// ─── Mejoras instaladas (HUD) ─────────────────────────────────────────────────────────────────────

/** Mejoras con algún nivel comprado, en orden de catálogo, con su icono. */
export function installedUpgrades(levels: Readonly<Record<string, number>> | undefined, cat: Catalog = defaultCatalog): { upgradeId: string; level: number; maxLevel: number; iconField: string }[] {
  if (!levels) return [];
  return (cat.upgrades ?? [])
    .filter((u) => (levels[u.id] ?? 0) > 0)
    .map((u) => ({ upgradeId: u.id, level: Math.min(u.levels.length, levels[u.id] ?? 0), maxLevel: u.levels.length, iconField: iconFieldOf(u.id, cat) }));
}

// ─── Teclado ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Foco con flechas dentro del terminal: arriba/abajo recorren los botones de la columna; izquierda/derecha
 * saltan a la otra columna (a la fila más parecida). Devuelve el índice nuevo dentro de `columns`.
 */
export function moveFocus(columns: readonly number[], at: { col: number; row: number }, key: string): { col: number; row: number } {
  const n = columns.length;
  if (n === 0) return at;
  const clampRow = (col: number, row: number) => Math.max(0, Math.min((columns[col] ?? 1) - 1, row));
  if (key === 'ArrowDown') return { col: at.col, row: ((columns[at.col] ?? 1) + at.row + 1) % Math.max(1, columns[at.col] ?? 1) };
  if (key === 'ArrowUp') return { col: at.col, row: ((columns[at.col] ?? 1) + at.row - 1) % Math.max(1, columns[at.col] ?? 1) };
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const dir = key === 'ArrowRight' ? 1 : -1;
    for (let k = 1; k <= n; k++) {
      const col = (((at.col + dir * k) % n) + n) % n;
      if ((columns[col] ?? 0) > 0) return { col, row: clampRow(col, at.row) };
    }
  }
  return at;
}
