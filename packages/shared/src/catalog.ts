/**
 * Catálogo del juego: esquema zod, validación de referencias cruzadas y búsquedas.
 * El contenido vive en packages/shared/catalog/*.json (regla 3: contenido en datos).
 */
import { z } from 'zod';
import shipsJson from '../catalog/naves.json';
import hazardsJson from '../catalog/averias.json';
import nodeKindsJson from '../catalog/destinos.json';
import sectorJson from '../catalog/sectores.json';
import surfaceJson from '../catalog/mundos.json';
import economyJson from '../catalog/economia.json';
import upgradesJson from '../catalog/mejoras.json';
import {
  NODE_KINDS, SUPPLY_IDS, THROTTLE_IDS, UPGRADE_FIELDS, UPGRADE_TARGETS,
  type Catalog, type MaterialDef, type NodeKind, type NodeKindDef, type ShipDef, type SurfaceCatalog, type ThrottleDef, type ThrottleId, type WorldDef,
} from './types';

const localized = z.strictObject({ es: z.string().min(1), en: z.string().min(1) });
const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'debe ser kebab-case (a-z, 0-9 y guiones)');
const nonNeg = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const probability = z.number().min(0).max(1);
const range = z
  .strictObject({ min: nonNeg, max: nonNeg })
  .refine((r) => r.min <= r.max, { message: 'min debe ser <= max' });

const throttleSchema = z.strictObject({
  id: z.enum(THROTTLE_IDS),
  speedMult: positive,
  fuelMult: positive,
  engineDrawMult: positive,
  wearMult: nonNeg,
});

const shipSchema = z
  .strictObject({
    id,
    name: localized,
    hullMax: positive,
    fuelCapacity: positive,
    startFuel: positive,
    startSpares: nonNeg.int(),
    maxSpares: nonNeg.int(),
    reactorOutputKw: positive,
    systemDrawKw: z.strictObject({ engines: nonNeg, lifeSupport: nonNeg, shields: nonNeg, nav: nonNeg }),
    cruiseSpeedLyPerS: positive,
    fuelPerLy: positive,
    damagedEngineFuelPenalty: nonNeg,
    evadeFuel: nonNeg,
    crewO2UsePctPerS: nonNeg,
    o2RegenPctPerS: positive,
    shieldAbsorb: probability,
    shieldWearPctPerHit: nonNeg,
    overloadReactorDamagePctPerS: nonNeg,
    throttles: z.array(throttleSchema),
  })
  .superRefine((ship, ctx) => {
    for (const t of THROTTLE_IDS) {
      if (ship.throttles.filter((x) => x.id === t).length !== 1) ctx.addIssue({ code: 'custom', message: `falta o se repite el régimen "${t}"` });
    }
    if (ship.startFuel > ship.fuelCapacity) ctx.addIssue({ code: 'custom', message: 'startFuel supera fuelCapacity' });
    if (ship.startSpares > ship.maxSpares) ctx.addIssue({ code: 'custom', message: 'startSpares supera maxSpares' });
    if (ship.o2RegenPctPerS <= ship.crewO2UsePctPerS) ctx.addIssue({ code: 'custom', message: 'el soporte vital debe regenerar más O2 del que consume la tripulación' });
  });

const hazardsSchema = z.strictObject({
  incidents: z.strictObject({
    fire: z.strictObject({ repairS: positive, systemDamagePctPerS: nonNeg, hullDamagePerS: nonNeg, o2DrainPctPerS: nonNeg, spreadAfterS: positive }),
    short: z.strictObject({ repairS: positive, escalateToFireAfterS: positive }),
    leak: z.strictObject({ repairS: positive, o2DrainPctPerS: nonNeg }),
  }),
  impact: z
    .strictObject({
      warnLeadLy: positive,
      hullDamageMin: nonNeg,
      hullDamageMax: nonNeg,
      systemDamageMin: nonNeg,
      systemDamageMax: nonNeg,
      leakChanceUnshielded: probability,
      evade: z
        .strictObject({
          maxGrazes: positive.int(),
          grazeDamageFrac: probability,
          failDamageFrac: probability,
          difficultyBase: probability,
          difficultyPerSector: nonNeg,
          difficultyFromSeverity: nonNeg,
        })
        .optional(),
    })
    .refine((i) => i.hullDamageMin <= i.hullDamageMax && i.systemDamageMin <= i.systemDamageMax, { message: 'min debe ser <= max' }),
  wear: z.strictObject({ chancePerS: probability, weights: z.strictObject({ fire: nonNeg, short: nonNeg, leak: nonNeg }) }),
  repair: z.strictObject({ kitRepairS: positive, kitRestorePct: positive.max(100) }),
  alerts: z.strictObject({ lowOxygenPct: nonNeg.max(100), lowFuelPct: nonNeg.max(100), lowHullPct: nonNeg.max(100) }),
  maxIncidents: positive.int(),
});

const nodeKindSchema = z.strictObject({
  id: z.enum(NODE_KINDS),
  name: localized,
  weight: nonNeg,
  landable: z.boolean(),
  hazardPerLy: z.strictObject({ impact: nonNeg, short: nonNeg, fire: nonNeg, leak: nonNeg }),
  cache: z.strictObject({ chance: probability, fuel: range, spares: range }).optional(),
  service: z.strictObject({ refuel: z.boolean(), hullRepair: nonNeg, spares: nonNeg.int() }).optional(),
  shop: z.boolean().optional(),
});

const sectorSchema = z
  .strictObject({
    columns: positive.int(),
    maxColumns: positive.int(),
    columnsGrowthEverySectors: positive.int(),
    nodesPerColumn: range,
    columnSpacingLy: range,
    lateralSpreadLy: nonNeg,
    maxLinkLy: positive,
    hazardGrowthPerSector: nonNeg,
    safeStartLy: nonNeg,
    nameSyllables: z.array(z.string().min(1)).min(4),
  })
  .refine((s) => s.nodesPerColumn.min >= 1 && s.columns <= s.maxColumns, { message: 'columnas o nodos por columna inválidos' });

const pct = nonNeg.max(100);

const surfaceRulesSchema = z.strictObject({
  descent: z
    .strictObject({
      brakeThrustMps2: positive,
      brakeFuelPerS: nonNeg,
      minSpeedMps: positive,
      safeSpeedMps: positive,
      hullDamagePerMps: nonNeg,
      systemDamagePerMps: nonNeg,
      incidentChancePerMps: nonNeg,
      referenceMargin: probability.optional(),
    })
    .refine((d) => d.minSpeedMps <= d.safeSpeedMps, { message: 'minSpeedMps debe ser <= safeSpeedMps' }),
  takeOff: z.strictObject({ baseFuel: nonNeg, fuelPerMps2: nonNeg, massRefKg: positive }),
  suit: z
    .strictObject({
      o2DrainPctPerS: positive,
      lowO2Pct: pct,
      criticalO2Pct: pct,
      carryCapacityKg: positive,
      collectRangeM: positive,
      airlockRangeM: positive,
      maxMoveSpeedMps: positive,
      refillShipO2PctPerTank: pct,
      refillMinShipO2Pct: pct,
      airlockCycleShipO2Pct: pct.optional(),
    })
    .refine((s) => s.criticalO2Pct < s.lowO2Pct, { message: 'criticalO2Pct debe ser < lowO2Pct' }),
  jetpack: z.strictObject({ drainPctPerS: positive, rechargePctPerS: nonNeg }),
  falls: z
    .strictObject({ harmlessMps: nonNeg, o2LossPctPerMps: nonNeg, lethalMps: positive })
    .refine((f) => f.harmlessMps < f.lethalMps, { message: 'harmlessMps debe ser < lethalMps' }),
  terrain: z.strictObject({ collapseS: positive, decayPerS: nonNeg }),
  value: z.strictObject({ distanceBonus: nonNeg, dangerBonus: nonNeg, dangerMarginM: nonNeg }),
  streak: z.strictObject({ bonusPerUnit: nonNeg, maxBonus: nonNeg }),
  shipO2: z.strictObject({ surfaceSurplusRegenMult: probability }).optional(),
  lodes: z
    .strictObject({ size: range.refine((r) => r.min >= 1, { message: 'al menos 1 veta por filón' }), spacingM: range, completeMult: positive.optional() })
    .optional(),
});

const toolSchema = z.strictObject({ id, name: localized, perCrew: nonNeg.int(), stopsInStorm: z.boolean(), speedMult: positive });

const materialSchema = z.strictObject({
  id,
  name: localized,
  value: nonNeg,
  massKg: positive,
  collectS: positive,
  tool: id,
  yields: z.strictObject({ fuel: nonNeg.optional(), spares: nonNeg.int().optional() }).optional(),
  streak: z.boolean().optional(),
});

const worldSchema = z.strictObject({
  id,
  name: localized,
  kind: z.enum(NODE_KINDS),
  weight: positive,
  gravityMps2: positive,
  descent: z.strictObject({ altitudeM: positive, speedMps: nonNeg, referenceMargin: probability.optional() }),
  radiusM: positive,
  deposits: range.refine((r) => r.min >= 1 && r.max <= 24, { message: 'entre 1 y 24 vetas' }),
  materials: z
    .array(z.strictObject({ materialId: id, weight: positive, units: range.refine((r) => r.min >= 1, { message: 'al menos 1 unidad' }), minDistanceFrac: probability, dangerWeightMult: positive }))
    .min(1),
  storms: z
    .strictObject({ meanIntervalS: positive, warnS: positive, durationS: range, intensity: range.refine((r) => r.max <= 1, { message: 'intensidad <= 1' }), o2DrainPctPerS: nonNeg, firstStartMinS: nonNeg.optional() })
    .nullable(),
  unstable: z.strictObject({ zones: range, radiusM: range, pitDepthM: nonNeg }),
  shipWearMult: nonNeg,
});

const surfaceSchema = z.strictObject({
  rules: surfaceRulesSchema,
  tools: z.array(toolSchema).min(1),
  materials: z.array(materialSchema).min(1),
  worlds: z.array(worldSchema),
});

const economySchema = z.strictObject({
  startCredits: nonNeg.int(),
  sectorRewardCredits: nonNeg,
  sectorPriceMult: z.strictObject({ sellPerSector: nonNeg, buyPerSector: nonNeg }),
  sellPrices: z.record(id, nonNeg),
  supplyPrices: z.strictObject(Object.fromEntries(SUPPLY_IDS.map((k) => [k, positive])) as Record<(typeof SUPPLY_IDS)[number], typeof positive>),
  emergency: z.strictObject({ fuelPct: pct, hullPct: pct, minSpares: nonNeg.int() }),
  cargoFuel: z.strictObject({ massRefKg: positive }),
  offer: z.strictObject({ size: positive.int() }),
});

const upgradeEffectSchema = z
  .strictObject({ target: z.enum(UPGRADE_TARGETS), field: z.string(), add: z.number().finite().optional(), mult: nonNeg.optional() })
  .superRefine((e, ctx) => {
    if (!UPGRADE_FIELDS[e.target].includes(e.field)) ctx.addIssue({ code: 'custom', message: `campo "${e.field}" no admitido en ${e.target} (ver UPGRADE_FIELDS)` });
    if (e.add === undefined && e.mult === undefined) ctx.addIssue({ code: 'custom', message: 'un efecto necesita add o mult' });
  });

const upgradeSchema = z.strictObject({
  id,
  name: localized,
  levels: z.array(z.strictObject({ price: positive, massKg: nonNeg, effects: z.array(upgradeEffectSchema).min(1) })).min(1),
});

const catalogSchema = z
  .strictObject({
    ships: z.array(shipSchema).min(1),
    hazards: hazardsSchema,
    nodeKinds: z.array(nodeKindSchema),
    sector: sectorSchema,
    surface: surfaceSchema.optional(),
    economy: economySchema.optional(),
    upgrades: z.array(upgradeSchema).optional(),
  })
  .superRefine((cat, ctx) => {
    const shipIds = new Set<string>();
    for (const s of cat.ships) {
      if (shipIds.has(s.id)) ctx.addIssue({ code: 'custom', message: `nave repetida: ${s.id}` });
      shipIds.add(s.id);
    }
    for (const k of NODE_KINDS) {
      if (cat.nodeKinds.filter((n) => n.id === k).length !== 1) ctx.addIssue({ code: 'custom', message: `falta o se repite el tipo de destino "${k}"` });
    }
    const station = cat.nodeKinds.find((n) => n.id === 'station');
    if (station && !station.shop && !station.service) ctx.addIssue({ code: 'custom', message: 'el tipo "station" debe declarar `shop`' });
    if (!cat.nodeKinds.some((n) => n.weight > 0)) ctx.addIssue({ code: 'custom', message: 'ningún tipo de destino tiene peso > 0' });
    const surface = cat.surface;
    if (!surface) return;
    const ids = new Set<string>([...shipIds, ...NODE_KINDS]);
    const materialIds = new Set<string>();
    const toolIds = new Set(surface.tools.map((t) => t.id));
    for (const mat of surface.materials) if (!toolIds.has(mat.tool)) ctx.addIssue({ code: 'custom', message: `el material "${mat.id}" usa una herramienta desconocida: ${mat.tool}` });
    for (const entry of [...surface.tools, ...surface.materials, ...surface.worlds, ...(cat.upgrades ?? [])]) {
      if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', message: `id repetido en el catálogo: ${entry.id}` });
      ids.add(entry.id);
    }
    for (const mat of surface.materials) materialIds.add(mat.id);
    for (const w of surface.worlds) {
      const kind = cat.nodeKinds.find((n) => n.id === w.kind);
      if (kind && !kind.landable) ctx.addIssue({ code: 'custom', message: `el mundo "${w.id}" es de un tipo no aterrizable (${w.kind})` });
      for (const m of w.materials) if (!materialIds.has(m.materialId)) ctx.addIssue({ code: 'custom', message: `el mundo "${w.id}" usa un material desconocido: ${m.materialId}` });
      if (!w.materials.some((m) => m.minDistanceFrac === 0)) ctx.addIssue({ code: 'custom', message: `el mundo "${w.id}" necesita algún material con minDistanceFrac 0` });
    }
    for (const materialId of Object.keys(cat.economy?.sellPrices ?? {})) {
      if (!materialIds.has(materialId)) ctx.addIssue({ code: 'custom', message: `economy.sellPrices usa un material desconocido: ${materialId}` });
    }
    for (const k of cat.nodeKinds) {
      if (k.landable && !surface.worlds.some((w) => w.kind === k.id)) ctx.addIssue({ code: 'custom', message: `el tipo aterrizable "${k.id}" no tiene ningún mundo` });
    }
  });

/** Valida un catálogo en bruto. Lanza un error legible si no cumple el esquema. */
export function parseCatalog(raw: unknown): Catalog {
  // La superficie es opcional en el JSON: si falta, se usa la del catálogo por defecto.
  // Igual con la economía y las mejoras (fase 3).
  const isObj = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const input = isObj
    ? {
        ...raw,
        ...(!('surface' in raw) ? { surface: surfaceJson } : {}),
        ...(!('economy' in raw) ? { economy: economyJson.economy } : {}),
        ...(!('upgrades' in raw) ? { upgrades: upgradesJson.upgrades } : {}),
      }
    : raw;
  const r = catalogSchema.safeParse(input);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`);
    throw new Error(`Catálogo inválido:\n${lines.join('\n')}`);
  }
  return r.data as Catalog;
}

/** Catálogo por defecto, validado al importar. */
export const catalog: Catalog = parseCatalog({
  ships: shipsJson.ships,
  hazards: hazardsJson,
  nodeKinds: nodeKindsJson.nodeKinds,
  sector: sectorJson.sector,
  surface: surfaceJson,
  economy: economyJson.economy,
  upgrades: upgradesJson.upgrades,
});

export function getShip(shipId: string | undefined, cat: Catalog = catalog): ShipDef {
  const ship = shipId === undefined ? cat.ships[0] : cat.ships.find((s) => s.id === shipId);
  if (!ship) throw new Error(`Nave desconocida: ${shipId}`);
  return ship;
}

export function getNodeKind(kind: NodeKind, cat: Catalog = catalog): NodeKindDef {
  const def = cat.nodeKinds.find((n) => n.id === kind);
  if (!def) throw new Error(`Tipo de destino desconocido: ${kind}`);
  return def;
}

export function getThrottle(ship: ShipDef, throttle: ThrottleId): ThrottleDef {
  const def = ship.throttles.find((t) => t.id === throttle);
  if (!def) throw new Error(`Régimen desconocido: ${throttle}`);
  return def;
}

/** Mundos, materiales y reglas de superficie (siempre presentes tras `parseCatalog`). */
export function getSurfaceCatalog(cat: Catalog = catalog): SurfaceCatalog {
  if (!cat.surface) throw new Error('El catálogo no tiene superficie (usa parseCatalog)');
  return cat.surface;
}

export function getWorld(worldId: string, cat: Catalog = catalog): WorldDef {
  const def = getSurfaceCatalog(cat).worlds.find((w) => w.id === worldId);
  if (!def) throw new Error(`Mundo desconocido: ${worldId}`);
  return def;
}

export function getMaterial(materialId: string, cat: Catalog = catalog): MaterialDef {
  const def = getSurfaceCatalog(cat).materials.find((m) => m.id === materialId);
  if (!def) throw new Error(`Material desconocido: ${materialId}`);
  return def;
}
