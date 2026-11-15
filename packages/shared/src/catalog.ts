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
import rolesJson from '../catalog/roles.json';
import upgradesJson from '../catalog/mejoras.json';
import missionsJson from '../catalog/misiones.json';
import modulesJson from '../catalog/modulos.json';
import instrumentsJson from '../catalog/instrumentos.json';
import launchersJson from '../catalog/lanzadores.json';
import solarJson from '../catalog/sistema-solar.json';
import scienceJson from '../catalog/ciencia.json';
import psychJson from '../catalog/cordura.json';
import {
  MISSION_STEP_IDS, MODULE_KINDS, NODE_KINDS, ROLE_IDS, SCIENCE_KINDS, SUPPLY_IDS, THROTTLE_IDS, UPGRADE_FIELDS, UPGRADE_TARGETS,
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
    solarKwAt1Au: nonNeg.optional(),
    dryMassKg: nonNeg.optional(),
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
  // 0 = solo se usa por `worldId` de un cuerpo del sistema solar (nunca sale en el sorteo de los sectores clásicos).
  weight: nonNeg,
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

// ─── Fase 4: diseño de misión y sistema solar (ADR 0016) ───────────────────

const shipEffectSchema = upgradeEffectSchema.refine((e) => e.target === 'ship' || e.target === 'crew', { message: 'los módulos solo tocan la nave o la tripulación (target "ship" o "crew")' });

const moduleSchema = z
  .strictObject({
    id,
    name: localized,
    kind: z.enum(MODULE_KINDS),
    massKg: positive,
    costMUSD: nonNeg,
    devMonths: nonNeg,
    reliability: probability,
    slotsUsed: nonNeg.int().optional(),
    effects: z.array(shipEffectSchema),
    maxMassKg: positive.optional(),
    slots: positive.int().optional(),
    solarKwAt1Au: positive.optional(),
    heatRejectKw: nonNeg.optional(),
    batteryKwh: nonNeg.optional(),
    dataRateMbps: nonNeg.optional(),
    commsRangeAu: positive.optional(),
    storageGb: nonNeg.optional(),
    radiationHardened: z.boolean().optional(),
  })
  .superRefine((m, ctx) => {
    if (m.kind === 'structure' && (m.maxMassKg === undefined || m.slots === undefined)) ctx.addIssue({ code: 'custom', message: `la estructura "${m.id}" necesita maxMassKg y slots` });
    if (m.kind === 'solar' && m.solarKwAt1Au === undefined) ctx.addIssue({ code: 'custom', message: `los paneles "${m.id}" necesitan solarKwAt1Au` });
    if (m.kind === 'comms' && m.commsRangeAu === undefined) ctx.addIssue({ code: 'custom', message: `las comunicaciones "${m.id}" necesitan commsRangeAu` });
  });

const instrumentSchema = z.strictObject({
  id,
  name: localized,
  scienceKind: z.enum(SCIENCE_KINDS),
  massKg: positive,
  powerKw: nonNeg,
  costMUSD: nonNeg,
  devMonths: nonNeg,
  reliability: probability,
  scienceValue: nonNeg,
  dataRateMbps: nonNeg,
  slotsUsed: nonNeg.int().optional(),
  cubesat: z.boolean().optional(),
});

const launcherSchema = z.strictObject({
  id,
  name: localized,
  costMUSD: nonNeg,
  reliability: probability,
  waitMonths: nonNeg,
  capacityKgByZone: z.record(id, nonNeg),
});

const missionSchema = z.strictObject({
  id,
  name: localized,
  description: localized,
  scienceKind: z.enum(SCIENCE_KINDS),
  destinations: z.array(id).min(1),
  requirements: z.strictObject({
    minScience: nonNeg,
    requiredKinds: z.array(z.enum(SCIENCE_KINDS)),
    minReliabilityPct: pct.optional(),
  }),
  budgetMUSD: positive,
  deadlineMonths: positive,
  difficulty: positive.int().max(3),
  psychDrainMult: nonNeg.optional(),
  guided: z
    .strictObject({
      moduleIds: z.array(id).min(1),
      launcherId: id,
      instrumentIds: z.array(id).min(1),
      steps: z.array(z.strictObject({ check: z.enum(['instrument', 'required-kinds', 'science', 'go']), text: localized, hint: localized.optional() })).max(6),
      // Pasos en vuelo (guía de `currentObjective`): los cinco pasos de misión, una vez cada uno.
      flightSteps: z
        .array(z.strictObject({ check: z.enum(MISSION_STEP_IDS), text: localized, hint: localized.optional() }))
        .refine((xs) => xs.length === MISSION_STEP_IDS.length && MISSION_STEP_IDS.every((c) => xs.some((x) => x.check === c)), {
          message: `flightSteps debe cubrir una vez cada paso: ${MISSION_STEP_IDS.join(', ')}`,
        })
        .optional(),
    })
    .optional(),
});

const designRulesSchema = z
  .strictObject({
    baseShipId: id,
    shipName: localized,
    zeroedFields: z.array(z.string()),
    referenceMassKg: positive,
    massFuelExponent: nonNeg,
    tightMargin: probability,
    integrationMonthsPerItem: nonNeg,
    offKindScienceMult: probability,
    rangeLegFactor: positive,
    rangeReservePct: pct,
    maxShieldAbsorb: probability,
    difficulties: z
      .array(
        z.strictObject({
          id, name: localized, budgetMult: positive, deadlineMult: positive, minScienceMult: positive,
          wearMult: nonNeg, hazardMult: nonNeg, contactWindowMult: positive, psychDrainMult: nonNeg.optional(),
        }),
      )
      .optional(),
    defaultDifficultyId: id.optional(),
    operations: z
      .strictObject({
        reliabilityWearK: nonNeg,
        heatDamagePctPerSPerKw: nonNeg,
        heatDamageMaxPctPerS: nonNeg,
        batteryKwhPerKwS: positive,
        batteryRechargeEff: probability,
      })
      .optional(),
  })
  .superRefine((r, ctx) => {
    for (const f of r.zeroedFields) if (!UPGRADE_FIELDS.ship.includes(f)) ctx.addIssue({ code: 'custom', message: `zeroedFields: "${f}" no es un campo de nave (UPGRADE_FIELDS.ship)` });
  });

const bodySchema = z.strictObject({
  id,
  name: localized,
  type: z.enum(['star', 'planet', 'dwarf', 'moon', 'asteroid', 'station']),
  parentId: id.optional(),
  zoneId: id.optional(),
  orbitAu: positive.optional(),
  orbitKm: positive.optional(),
  periodDays: nonNeg,
  phaseDeg: z.number().finite(),
  radiusKm: positive,
  gravityMps2: nonNeg,
  atmosphere: z.boolean(),
  nodeKind: z.enum(NODE_KINDS).optional(),
  landable: z.boolean(),
  worldId: id.optional(),
  source: z.string().optional(),
});

const solarSystemSchema = z.strictObject({
  route: z
    .strictObject({
      legBaseUnits: nonNeg,
      legUnitsPerSqrtAu: nonNeg,
      legMinUnits: positive,
      legMaxUnits: positive,
      columnSpacingUnits: positive,
      waypointKinds: z.array(z.enum(NODE_KINDS)).min(1),
      moonDisplayAuPerMkm: nonNeg,
    })
    .refine((r) => r.legMinUnits <= r.legMaxUnits, { message: 'legMinUnits debe ser <= legMaxUnits' }),
  zones: z.array(z.strictObject({ id, name: localized, sunDistanceAu: positive, hubId: id, radiation: z.boolean().optional() })).min(2),
  bodies: z.array(bodySchema).min(1),
});

// ─── Fase 5: ciencia, datos y ventanas de contacto (ADR 0018) ──────────────

const scienceSchema = z
  .strictObject({
    observeMbPerMbps: positive,
    minObserveMbPerS: nonNeg,
    storageMbPerGb: positive,
    downlinkMbPerMbps: positive,
    observeMaxS: positive,
    otherObserveMaxS: nonNeg,
    targetMult: nonNeg,
    surfaceMult: nonNeg,
    otherBodyMult: nonNeg,
    contactPeriodS: positive,
    contactWindowS: positive,
    rateRefAu: positive,
    rateFalloffExp: nonNeg,
    homeDeliversAll: z.boolean(),
    scorePerScience: nonNeg,
    successBonus: nonNeg,
  })
  .refine((r) => r.contactWindowS <= r.contactPeriodS, { message: 'contactWindowS debe ser <= contactPeriodS' });

// ─── Fase 6: roles de tripulación (ADR 0017) ───────────────────────────────

const roleSchema = z.strictObject({
  id: z.enum(ROLE_IDS),
  name: localized,
  perks: z.strictObject({
    evadeFuelMult: nonNeg.optional(),
    evadeDamageMult: nonNeg.optional(),
    repairSpeedMult: positive.optional(),
    carryCapacityMult: positive.optional(),
    jetpackDrainMult: nonNeg.optional(),
    sanityAuraMult: positive.optional(),
    sanityRecoverMult: positive.optional(),
  }),
});

// ─── Fase 8: cordura de la tripulación ─────────────────────────────────────

const perBand = z.array(nonNeg).length(4);
const psychSchema = z
  .strictObject({
    enabled: z.boolean(),
    startPct: z.number().min(1).max(100),
    daysPerS: nonNeg,
    bands: z.strictObject({ tense: positive, critical: positive, breakdown: positive, hysteresisPct: nonNeg }),
    base: z.strictObject({ transit: nonNeg, docked: nonNeg, surfaceAboard: nonNeg, eva: nonNeg }),
    distPerSector: nonNeg,
    distPerAu: nonNeg,
    monotonyMax: nonNeg,
    monotonyRampS: positive,
    awakeGraceS: nonNeg,
    awakeRampS: positive,
    sleepPenalty: nonNeg,
    radiationMult: positive,
    stressors: z.strictObject({ perIncident: nonNeg, maxIncidents: nonNeg.int(), lowShipO2: nonNeg, stormEva: nonNeg, suitCritical: nonNeg }),
    shocks: z.strictObject({ impact: nonNeg, hardLanding: nonNeg, crewDeath: nonNeg, crewDeathCohesion: nonNeg }),
    rewards: z.strictObject({ incidentFixed: nonNeg, systemRepaired: nonNeg, storedPer100: nonNeg, storedMax: nonNeg, sale: nonNeg, sectorCleared: nonNeg }),
    debuffs: z.strictObject({ work: perBand, evadeDamage: perBand, suitO2: perBand, jetpack: perBand, carry: perBand, lapsePerS: perBand }),
    lapse: z.strictObject({ cooldownS: nonNeg, systems: z.array(z.enum(['engines', 'lifeSupport', 'shields', 'nav'])) }),
    rest: z.strictObject({ recoverPctPerS: nonNeg, alarmMult: nonNeg, awakeRecoverMult: nonNeg }),
    call: z.strictObject({ seconds: positive, drawKw: nonNeg, recoverPct: nonNeg, delayHalfMin: positive, soloMult: nonNeg, cooldownS: nonNeg }),
    station: z.strictObject({ recoverPctPerS: nonNeg, arrivalPct: nonNeg, capPct: nonNeg, cohesionPctPerS: nonNeg }),
    provisions: z.strictObject({ unitPrice: positive, maxUnits: nonNeg.int(), secondsPerUnit: positive, drainMult: positive }),
    cohesion: z.strictObject({
      start: z.number().min(0).max(100), lowPct: z.number().min(0).max(100), drainMax: nonNeg, groupRepairPct: nonNeg, groupRepairSanity: nonNeg,
      evaNearM: nonNeg, evaNearPctPerS: nonNeg, teamworkMult: positive, teamworkMinPct: z.number().min(0).max(100),
    }),
    crewOfferSize: nonNeg.int(),
    thirdQuarter: z.strictObject({ enabled: z.boolean(), fictional: z.boolean(), atFrac: probability, shockPct: nonNeg }).optional(),
    mission: z
      .strictObject({ durationK: nonNeg, durationRefMonths: nonNeg, durationSpanMonths: positive, durationMin: nonNeg, durationMax: nonNeg })
      .refine((m) => m.durationMin <= m.durationMax, { message: 'mission: durationMin <= durationMax' })
      .optional(),
  })
  .refine((r) => r.bands.breakdown < r.bands.critical && r.bands.critical < r.bands.tense && r.bands.tense <= 100, {
    message: 'bands: se exige breakdown < critical < tense <= 100',
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
    design: designRulesSchema.optional(),
    missions: z.array(missionSchema).optional(),
    modules: z.array(moduleSchema).optional(),
    instruments: z.array(instrumentSchema).optional(),
    launchers: z.array(launcherSchema).optional(),
    solarSystem: solarSystemSchema.optional(),
    roles: z.array(roleSchema).optional(),
    science: scienceSchema.optional(),
    psych: psychSchema.optional(),
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
    for (const r of ROLE_IDS) {
      if ((cat.roles ?? []).filter((x) => x.id === r).length > 1) ctx.addIssue({ code: 'custom', message: `rol repetido: ${r}` });
    }
    const surface = cat.surface;
    if (!surface) return;
    const ids = new Set<string>([...shipIds, ...NODE_KINDS]);
    const materialIds = new Set<string>();
    const toolIds = new Set(surface.tools.map((t) => t.id));
    for (const mat of surface.materials) if (!toolIds.has(mat.tool)) ctx.addIssue({ code: 'custom', message: `el material "${mat.id}" usa una herramienta desconocida: ${mat.tool}` });
    for (const entry of [...surface.tools, ...surface.materials, ...surface.worlds, ...(cat.upgrades ?? []), ...(cat.roles ?? [])]) {
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
      if (k.landable && !surface.worlds.some((w) => w.kind === k.id && w.weight > 0)) ctx.addIssue({ code: 'custom', message: `el tipo aterrizable "${k.id}" no tiene ningún mundo con peso > 0` });
    }

    // ── Fase 4: diseño de misión y sistema solar
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const solar = cat.solarSystem;
    const bodies = new Map((solar?.bodies ?? []).map((b) => [b.id, b]));
    const zones = new Map((solar?.zones ?? []).map((z) => [z.id, z]));
    for (const entry of [...(cat.modules ?? []), ...(cat.instruments ?? []), ...(cat.launchers ?? []), ...(cat.missions ?? []), ...(solar?.zones ?? []), ...(solar?.bodies ?? [])]) {
      if (ids.has(entry.id)) issue(`id repetido en el catálogo: ${entry.id}`);
      ids.add(entry.id);
    }
    if (cat.design && !shipIds.has(cat.design.baseShipId)) issue(`design.baseShipId: nave desconocida ${cat.design.baseShipId}`);
    if (solar) {
      const order = solar.zones.map((z) => z.sunDistanceAu);
      if (order.some((d, i) => i > 0 && d <= order[i - 1]!)) issue('solarSystem.zones: deben ir de dentro a fuera');
      for (const z of solar.zones) {
        const hub = bodies.get(z.hubId);
        if (!hub || hub.nodeKind !== 'station' || hub.zoneId !== z.id) issue(`la zona "${z.id}" necesita una estación propia como hubId`);
      }
      for (const b of solar.bodies) {
        if (b.parentId && !bodies.has(b.parentId)) issue(`el cuerpo "${b.id}" orbita uno desconocido: ${b.parentId}`);
        if (b.zoneId && !zones.has(b.zoneId)) issue(`el cuerpo "${b.id}" está en una zona desconocida: ${b.zoneId}`);
        if (b.nodeKind && !b.zoneId) issue(`el cuerpo "${b.id}" aparece en el mapa y necesita zoneId`);
        if (b.type !== 'star' && b.orbitAu === undefined && (!b.parentId || bodies.get(b.parentId)?.orbitAu === undefined)) issue(`el cuerpo "${b.id}" necesita orbitAu o un padre con orbitAu`);
        if (b.landable) {
          // Si el mundo no existe (un catálogo de pruebas que sustituye los mundos), se usa uno de su tipo al azar.
          const world = b.worldId ? surface.worlds.find((w) => w.id === b.worldId) : undefined;
          if (!b.worldId || !b.nodeKind) issue(`el cuerpo aterrizable "${b.id}" necesita nodeKind y worldId`);
          else if (world && world.kind !== b.nodeKind) issue(`el cuerpo "${b.id}" (${b.nodeKind}) usa un mundo de otro tipo: ${world.id} (${world.kind})`);
          else if (!cat.nodeKinds.find((k) => k.id === b.nodeKind)?.landable) issue(`el cuerpo aterrizable "${b.id}" es de un tipo no aterrizable: ${b.nodeKind}`);
        } else if (b.worldId) issue(`el cuerpo "${b.id}" no es aterrizable pero declara worldId`);
      }
    }
    for (const l of cat.launchers ?? []) {
      for (const zoneId of Object.keys(l.capacityKgByZone)) if (!zones.has(zoneId)) issue(`el lanzador "${l.id}" usa una zona desconocida: ${zoneId}`);
    }
    for (const m of cat.missions ?? []) {
      for (const d of m.destinations) {
        const b = bodies.get(d);
        if (!b || !b.nodeKind) issue(`la misión "${m.id}" tiene un destino que no está en el mapa: ${d}`);
      }
      // Fase 5: misión guiada con piezas que existen.
      const g = m.guided;
      if (g) {
        for (const x of g.moduleIds) if (!(cat.modules ?? []).some((mod) => mod.id === x)) issue(`la misión guiada "${m.id}" usa un módulo desconocido: ${x}`);
        for (const x of g.instrumentIds) if (!(cat.instruments ?? []).some((i) => i.id === x)) issue(`la misión guiada "${m.id}" usa un instrumento desconocido: ${x}`);
        if (!(cat.launchers ?? []).some((l) => l.id === g.launcherId)) issue(`la misión guiada "${m.id}" usa un lanzador desconocido: ${g.launcherId}`);
      }
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
        // Fase 4: diseño de misión y sistema solar.
        ...(!('design' in raw) ? { design: missionsJson.rules } : {}),
        ...(!('missions' in raw) ? { missions: missionsJson.missions } : {}),
        ...(!('modules' in raw) ? { modules: modulesJson.modules } : {}),
        ...(!('instruments' in raw) ? { instruments: instrumentsJson.instruments } : {}),
        ...(!('launchers' in raw) ? { launchers: launchersJson.launchers } : {}),
        ...(!('solarSystem' in raw) ? { solarSystem: solarJson } : {}),
        ...(!('roles' in raw) ? { roles: rolesJson.roles } : {}),
        ...(!('science' in raw) ? { science: scienceJson.science } : {}),
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
  design: missionsJson.rules,
  missions: missionsJson.missions,
  modules: modulesJson.modules,
  instruments: instrumentsJson.instruments,
  launchers: launchersJson.launchers,
  solarSystem: solarJson,
  roles: rolesJson.roles,
  science: scienceJson.science,
  psych: psychJson.psych,
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
