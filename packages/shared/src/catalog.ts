/**
 * Catálogo del juego: esquema zod, validación de referencias cruzadas y búsquedas.
 * El contenido vive en packages/shared/catalog/*.json (regla 3: contenido en datos).
 */
import { z } from 'zod';
import shipsJson from '../catalog/naves.json';
import hazardsJson from '../catalog/averias.json';
import nodeKindsJson from '../catalog/destinos.json';
import sectorJson from '../catalog/sectores.json';
import { NODE_KINDS, THROTTLE_IDS, type Catalog, type NodeKind, type NodeKindDef, type ShipDef, type ThrottleDef, type ThrottleId } from './types';

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

const catalogSchema = z
  .strictObject({
    ships: z.array(shipSchema).min(1),
    hazards: hazardsSchema,
    nodeKinds: z.array(nodeKindSchema),
    sector: sectorSchema,
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
    if (station && !station.service) ctx.addIssue({ code: 'custom', message: 'el tipo "station" debe declarar `service`' });
    if (!cat.nodeKinds.some((n) => n.weight > 0)) ctx.addIssue({ code: 'custom', message: 'ningún tipo de destino tiene peso > 0' });
  });

/** Valida un catálogo en bruto. Lanza un error legible si no cumple el esquema. */
export function parseCatalog(raw: unknown): Catalog {
  const r = catalogSchema.safeParse(raw);
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
