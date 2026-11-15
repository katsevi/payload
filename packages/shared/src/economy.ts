/**
 * Economía y mejoras (fase 3, ADR 0014). Funciones puras: la partida (`run.ts`) las usa y el cliente
 * puede llamarlas para previsualizar (la nave con una mejora más, el coste de un salto con carga).
 *
 * - Créditos: se ganan vendiendo carga en las estaciones (precio fijo por material × multiplicador del
 *   sector) y con el contrato de cada sector superado; se gastan en suministros y mejoras.
 * - Mejoras: cambios numéricos sobre `ShipDef` o las reglas del traje, del jetpack y de las caídas. Cada
 *   nivel tiene precio y masa (que encarece los saltos) y suele traer una contrapartida en sus efectos.
 * - Masa a bordo (bodega + mejoras) → combustible de cada salto × (1 + kg / `cargoFuel.massRefKg`).
 */
import { getSurfaceCatalog } from './catalog';
import { createRng, deriveSeed } from './rng';
import { solarKw } from './solar';
import {
  type Catalog, type EconomyRules, type NodeKindDef, type SectorMap, type ShipDef, type SurfaceRules, type UpgradeDef, type UpgradeEffect, type UpgradeTarget,
} from './types';

const OFFER_SALT = 0x0ffe;
const CREW_OFFER_SALT = 0x0c7e;

export function getEconomy(cat: Catalog): EconomyRules {
  if (!cat.economy) throw new Error('El catálogo no tiene economía (usa parseCatalog)');
  return cat.economy;
}

export function getUpgrades(cat: Catalog): UpgradeDef[] {
  return cat.upgrades ?? [];
}

export function getUpgrade(upgradeId: string, cat: Catalog): UpgradeDef {
  const def = getUpgrades(cat).find((u) => u.id === upgradeId);
  if (!def) throw new Error(`Mejora desconocida: ${upgradeId}`);
  return def;
}

/** El tipo de destino tiene terminal de estación (también los catálogos antiguos con `service`). */
export function hasShop(kind: NodeKindDef): boolean {
  return !!kind.shop || !!kind.service;
}

/** Multiplicadores de precio en el sector `sectorIndex` (1 = primero). */
export function sectorPriceMults(economy: EconomyRules, sectorIndex: number): { sell: number; buy: number } {
  const k = Math.max(0, sectorIndex - 1);
  return { sell: 1 + economy.sectorPriceMult.sellPerSector * k, buy: 1 + economy.sectorPriceMult.buyPerSector * k };
}

/** Créditos que da una unidad de ese material en ese sector (0 si no se compra). Entero, al menos 1 si se compra. */
export function sellUnitPrice(economy: EconomyRules, materialId: string, sectorIndex: number): number {
  const base = economy.sellPrices[materialId] ?? 0;
  return base > 0 ? Math.max(1, Math.round(base * sectorPriceMults(economy, sectorIndex).sell)) : 0;
}

/** Coste entero (redondeado hacia arriba) de `units` unidades a `unitPrice`. */
export function priceOf(units: number, unitPrice: number): number {
  return Math.ceil(units * unitPrice - 1e-9);
}

/** Unidades que se pueden pagar con `credits` a `unitPrice` (enteras). */
export function affordableUnits(credits: number, unitPrice: number): number {
  return unitPrice > 0 ? Math.floor(credits / unitPrice + 1e-9) : Number.MAX_SAFE_INTEGER;
}

/** Precio del nivel `level` (1 = primero) de una mejora en ese sector, o null si no existe. */
export function upgradePrice(upgrade: UpgradeDef, level: number, economy: EconomyRules, sectorIndex: number): number | null {
  const def = upgrade.levels[level - 1];
  return def ? Math.round(def.price * sectorPriceMults(economy, sectorIndex).buy) : null;
}

function applyEffect(value: number, e: UpgradeEffect): number {
  return value * (e.mult ?? 1) + (e.add ?? 0);
}

/** Efectos de los niveles comprados (en orden de catálogo y de nivel), filtrados por objetivo. */
export function boughtEffects(upgrades: Record<string, number>, cat: Catalog, target: UpgradeTarget): UpgradeEffect[] {
  const out: UpgradeEffect[] = [];
  for (const u of getUpgrades(cat)) {
    const level = Math.min(u.levels.length, Math.max(0, Math.trunc(upgrades[u.id] ?? 0)));
    for (let i = 0; i < level; i++) for (const e of u.levels[i]!.effects) if (e.target === target) out.push(e);
  }
  return out;
}

/** La nave con las mejoras compradas (pura; sin mejoras devuelve una copia igual a la base). */
export function effectiveShip(base: ShipDef, upgrades: Record<string, number>, cat: Catalog): ShipDef {
  const ship: ShipDef = { ...base, systemDrawKw: { ...base.systemDrawKw }, throttles: base.throttles };
  for (const e of boughtEffects(upgrades, cat, 'ship')) {
    if (e.field.startsWith('systemDrawKw.')) {
      const id = e.field.slice('systemDrawKw.'.length) as keyof ShipDef['systemDrawKw'];
      ship.systemDrawKw[id] = Math.max(0, applyEffect(ship.systemDrawKw[id], e));
    } else {
      const rec = ship as unknown as Record<string, number>; // campo numérico validado con zod (UPGRADE_FIELDS)
      rec[e.field] = Math.max(0, applyEffect(rec[e.field] ?? 0, e));
    }
  }
  ship.shieldAbsorb = Math.min(0.95, ship.shieldAbsorb);
  ship.maxSpares = Math.floor(ship.maxSpares);
  ship.hullMax = Math.max(1, ship.hullMax);
  ship.fuelCapacity = Math.max(1, ship.fuelCapacity);
  return ship;
}

/** Reglas de superficie con las mejoras de traje, jetpack y caídas (pura). */
export function effectiveSurfaceRules(base: SurfaceRules, upgrades: Record<string, number>, cat: Catalog): SurfaceRules {
  const rules: SurfaceRules = { ...base, suit: { ...base.suit }, jetpack: { ...base.jetpack }, falls: { ...base.falls } };
  for (const target of ['suit', 'jetpack', 'falls'] as const) {
    const rec = rules[target] as unknown as Record<string, number>; // campos numéricos validados con zod
    for (const e of boughtEffects(upgrades, cat, target)) rec[e.field] = Math.max(0, applyEffect(rec[e.field] ?? 0, e));
  }
  rules.suit.carryCapacityKg = Math.max(1, rules.suit.carryCapacityKg);
  rules.falls.lethalMps = Math.max(rules.falls.harmlessMps + 0.1, rules.falls.lethalMps);
  return rules;
}

/**
 * Margen eléctrico a régimen de crucero con TODO encendido y el reactor sano: potencia − demanda (kW).
 * Negativo = con todo encendido en un salto a crucero hay sobrecarga (habrá que apagar algo).
 */
export function cruisePowerMarginKw(ship: ShipDef, sunDistanceAu = 1): number {
  const cruise = ship.throttles.find((t) => t.id === 'cruise')?.engineDrawMult ?? 1;
  const d = ship.systemDrawKw;
  // Fase 4: los paneles (si los hay) dan 1/d² de su potencia a 1 UA.
  return ship.reactorOutputKw + solarKw(ship, sunDistanceAu) -(d.engines * cruise + d.lifeSupport + d.shields + d.nav);
}

/** Masa que añaden las mejoras compradas (kg). */
export function upgradesMassKg(upgrades: Record<string, number>, cat: Catalog): number {
  let kg = 0;
  for (const u of getUpgrades(cat)) {
    const level = Math.min(u.levels.length, Math.max(0, Math.trunc(upgrades[u.id] ?? 0)));
    for (let i = 0; i < level; i++) kg += u.levels[i]!.massKg;
  }
  return kg;
}

/** Masa de la bodega (kg). */
export function cargoMassKg(cargo: Record<string, number>, cat: Catalog): number {
  const materials = getSurfaceCatalog(cat).materials;
  let kg = 0;
  for (const id in cargo) kg += (materials.find((m) => m.id === id)?.massKg ?? 0) * (cargo[id] ?? 0);
  return kg;
}

/** Multiplicador del combustible de un salto con `massKg` a bordo: 1 + kg / `cargoFuel.massRefKg`. */
export function cargoFuelMult(economy: EconomyRules, massKg: number): number {
  return 1 + Math.max(0, massKg) / economy.cargoFuel.massRefKg;
}

/**
 * Mejoras que ofrece la estación `nodeId` (ids, en orden de catálogo). Determinista por semilla, sector y
 * nodo con un flujo propio: no toca el azar del sector ni el de la partida. Vacío si no es una estación.
 */
export function stationOffer(seed: number, sector: SectorMap, nodeId: string, cat: Catalog): string[] {
  const nodeIndex = sector.nodes.findIndex((n) => n.id === nodeId);
  const node = sector.nodes[nodeIndex];
  const kind = node && cat.nodeKinds.find((k) => k.id === node.kind);
  if (!kind || !hasShop(kind)) return [];
  // Fase 8: las mejoras `crew` no entran en la oferta de siempre (así no cambia con la cordura apagada ni encendida);
  // se ofrecen aparte, con un flujo de azar propio.
  const isCrew = (u: UpgradeDef) => u.levels.some((l) => l.effects.some((e) => e.target === 'crew'));
  const regular = getUpgrades(cat).filter((u) => !isCrew(u));
  const ids = regular.map((u) => u.id);
  const rng = createRng(deriveSeed(deriveSeed(seed >>> 0, OFFER_SALT + sector.index), nodeIndex));
  // Fisher-Yates parcial: los `size` primeros forman la oferta.
  const size = Math.min(ids.length, getEconomy(cat).offer.size);
  for (let i = 0; i < size; i++) {
    const j = rng.int(i, ids.length - 1);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const chosen = new Set(ids.slice(0, size));
  const psych = cat.psych;
  if (psych?.enabled && psych.crewOfferSize > 0) {
    const crewIds = getUpgrades(cat).filter(isCrew).map((u) => u.id);
    const crng = createRng(deriveSeed(deriveSeed(seed >>> 0, CREW_OFFER_SALT + sector.index), nodeIndex));
    const csize = Math.min(crewIds.length, psych.crewOfferSize);
    for (let i = 0; i < csize; i++) {
      const j = crng.int(i, crewIds.length - 1);
      [crewIds[i], crewIds[j]] = [crewIds[j]!, crewIds[i]!];
    }
    for (const id of crewIds.slice(0, csize)) chosen.add(id);
  }
  return getUpgrades(cat).map((u) => u.id).filter((id) => chosen.has(id));
}
