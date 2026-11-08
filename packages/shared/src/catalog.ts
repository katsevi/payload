/**
 * Catálogo del juego: esquema zod, validación de referencias cruzadas y búsquedas.
 * El contenido vive en packages/shared/catalog/*.json (regla 3: contenido en datos).
 */
import { z } from 'zod';
import componentsJson from '../catalog/componentes.json';
import orbitsJson from '../catalog/orbitas.json';
import launchersJson from '../catalog/lanzadores.json';
import scenariosJson from '../catalog/escenarios.json';
import type { Catalog, ComponentDef, LauncherDef, OrbitDef, OrbitId, ScenarioDef, SubsystemId } from './types';

// ─── Esquema ────────────────────────────────────────────────────────────────

const ORBIT_IDS = ['LEO', 'SSO', 'MEO', 'GEO', 'HEO', 'TLI'] as const;
const SUBSYSTEMS = ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'] as const;

const localized = z.strictObject({ es: z.string().min(1), en: z.string().min(1) });
const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'debe ser kebab-case (a-z, 0-9 y guiones)');
const nonNeg = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const probability = z.number().min(0).max(1);
const orbitId = z.enum(ORBIT_IDS);

/** Atributo obligatorio por subsistema (p. ej. un panel debe declarar su generación). */
const REQUIRED_BY_SUBSYSTEM: Partial<Record<SubsystemId, (keyof ComponentDef)[]>> = {
  structure: ['maxSupportedMassKg', 'mountSlots'],
  power: ['solarGenerationW'],
  battery: ['batteryCapacityWh', 'maxDepthOfDischarge'],
  comms: ['downlinkMbps'],
  obc: ['storageMbit'],
  adcs: ['pointingAccuracyDeg'],
  thermal: ['thermalDissipationW'],
};

const componentSchema = z
  .strictObject({
    id,
    subsystem: z.enum(SUBSYSTEMS),
    name: localized,
    description: localized,
    why: localized,
    level: z.enum(['basic', 'advanced']),
    massKg: positive,
    powerW: nonNeg,
    costMUSD: nonNeg,
    dataMbitPerDay: nonNeg,
    scienceValue: z.number().min(0).max(100),
    reliability: probability,
    devMonths: nonNeg,
    solarGenerationW: positive.optional(),
    batteryCapacityWh: positive.optional(),
    maxDepthOfDischarge: z.number().gt(0).max(1).optional(),
    downlinkMbps: positive.optional(),
    storageMbit: positive.optional(),
    maxSupportedMassKg: positive.optional(),
    mountSlots: z.number().int().positive().optional(),
    pointingAccuracyDeg: positive.optional(),
    thermalDissipationW: nonNeg.optional(),
    groundResolutionAt500KmM: positive.optional(),
    requiredPointingDeg: positive.optional(),
    model: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    for (const field of REQUIRED_BY_SUBSYSTEM[c.subsystem] ?? []) {
      if (c[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `un componente de subsistema "${c.subsystem}" debe declarar "${field}"`,
        });
      }
    }
  });

const orbitSchema = z
  .strictObject({
    id: orbitId,
    name: localized,
    description: localized,
    why: localized,
    perigeeKm: positive,
    apogeeKm: positive,
    inclinationDeg: z.number().min(0).max(180),
    radiationFactor: probability,
    dragLifetimeYears: positive.nullable(),
    revisitDays: nonNeg,
  })
  .refine((o) => o.apogeeKm >= o.perigeeKm, { message: 'apogeeKm debe ser >= perigeeKm', path: ['apogeeKm'] });

const launcherSchema = z.strictObject({
  id,
  name: localized,
  description: localized,
  costMUSD: nonNeg,
  reliability: probability,
  capacityKg: z.partialRecord(orbitId, positive),
  leadTimeMonths: nonNeg,
  model: z.string().min(1).optional(),
  why: localized.optional(),
});

const scenarioSchema = z.strictObject({
  id,
  name: localized,
  briefing: localized,
  why: localized.optional(),
  missionType: z.enum(['earth-observation', 'telecom', 'space-telescope', 'lunar-exploration', 'mars-exploration']),
  difficulty: z.enum(['basic', 'intermediate', 'advanced']),
  budgetMUSD: positive,
  maxDevMonths: positive,
  requirements: z.strictObject({
    maxGroundResolutionM: positive.optional(),
    minDownlinkMbitPerDay: positive.optional(),
    minLifetimeYears: nonNeg,
    maxRevisitDays: positive.optional(),
    minScienceValue: z.number().min(0).max(100).optional(),
  }),
  allowedOrbits: z.array(orbitId).min(1),
  allowedLaunchers: z.array(id).min(1),
  allowedComponents: z.array(id).optional(),
  groundStations: z.number().int().nonnegative(),
  operationDays: positive,
  eventsEnabled: z.boolean(),
  weights: z
    .strictObject({ objectives: nonNeg, science: nonNeg, efficiency: nonNeg, collaboration: nonNeg })
    .refine((w) => w.objectives + w.science + w.efficiency + w.collaboration > 0, {
      message: 'la suma de los pesos debe ser > 0',
    }),
  defaultSeed: z.number().int().nonnegative(),
  operationsCostMUSDPerYear: nonNeg.optional(),
});

const catalogSchema = z.strictObject({
  components: z.array(componentSchema),
  orbits: z.array(orbitSchema),
  launchers: z.array(launcherSchema),
  scenarios: z.array(scenarioSchema),
});

// ─── Validación ─────────────────────────────────────────────────────────────

/** Formatea un issue de zod como "components[3] (id "x").massKg: mensaje". */
function formatIssue(issue: z.core.$ZodIssue, raw: unknown): string {
  const path = issue.path;
  let where = '';
  let entry: unknown = raw;
  path.forEach((seg, i) => {
    if (typeof seg === 'number') {
      where += `[${seg}]`;
    } else {
      where += `${i === 0 ? '' : '.'}${String(seg)}`;
    }
    entry = entry !== null && typeof entry === 'object' ? (entry as Record<PropertyKey, unknown>)[seg as PropertyKey] : undefined;
    // Tras el índice de una colección de primer nivel, añade el id de la entrada si existe.
    if (i === 1 && typeof seg === 'number' && entry && typeof entry === 'object' && 'id' in entry) {
      where += ` (id "${String((entry as { id: unknown }).id)}")`;
    }
  });
  return `${where || '(raíz)'}: ${issue.message}`;
}

function crossReferenceErrors(cat: Catalog): string[] {
  const errors: string[] = [];
  const dupes = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const x of ids) {
      if (seen.has(x)) errors.push(`${kind}: id duplicado "${x}"`);
      seen.add(x);
    }
  };
  dupes('components', cat.components.map((c) => c.id));
  dupes('orbits', cat.orbits.map((o) => o.id));
  dupes('launchers', cat.launchers.map((l) => l.id));
  dupes('scenarios', cat.scenarios.map((s) => s.id));

  const componentIds = new Set(cat.components.map((c) => c.id));
  const orbitIds = new Set<string>(cat.orbits.map((o) => o.id));
  const launcherIds = new Set(cat.launchers.map((l) => l.id));

  for (const s of cat.scenarios) {
    for (const o of s.allowedOrbits) {
      if (!orbitIds.has(o)) errors.push(`scenarios (id "${s.id}").allowedOrbits: la órbita "${o}" no existe`);
    }
    for (const l of s.allowedLaunchers) {
      if (!launcherIds.has(l)) errors.push(`scenarios (id "${s.id}").allowedLaunchers: el lanzador "${l}" no existe`);
    }
    for (const c of s.allowedComponents ?? []) {
      if (!componentIds.has(c)) errors.push(`scenarios (id "${s.id}").allowedComponents: el componente "${c}" no existe`);
    }
    const reachable = s.allowedLaunchers.some((lid) => {
      const l = cat.launchers.find((x) => x.id === lid);
      return l && s.allowedOrbits.some((o) => (l.capacityKg[o] ?? 0) > 0);
    });
    if (!reachable) errors.push(`scenarios (id "${s.id}"): ningún lanzador permitido llega a una órbita permitida`);
  }
  for (const l of cat.launchers) {
    for (const o of Object.keys(l.capacityKg)) {
      if (!orbitIds.has(o)) errors.push(`launchers (id "${l.id}").capacityKg: la órbita "${o}" no existe en el catálogo`);
    }
  }
  return errors;
}

/** Valida un objeto desconocido como Catalog (lanza con mensaje claro si es inválido). */
export function parseCatalog(raw: unknown): Catalog {
  const result = catalogSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `- ${formatIssue(i, raw)}`);
    throw new Error(`Catálogo inválido (${lines.length} error(es)):\n${lines.join('\n')}`);
  }
  const cat: Catalog = result.data;
  const errors = crossReferenceErrors(cat);
  if (errors.length > 0) {
    throw new Error(`Catálogo inválido (${errors.length} error(es)):\n${errors.map((e) => `- ${e}`).join('\n')}`);
  }
  return cat;
}

/** Catálogo por defecto, validado con zod al importarse. */
export const catalog: Catalog = parseCatalog({
  components: componentsJson,
  orbits: orbitsJson,
  launchers: launchersJson,
  scenarios: scenariosJson,
});

// ─── Búsquedas ──────────────────────────────────────────────────────────────

function find<T extends { id: string }>(list: T[], wanted: string, kind: string): T {
  const found = list.find((x) => x.id === wanted);
  if (!found) throw new Error(`${kind} desconocido: "${wanted}"`);
  return found;
}

export function getScenario(id: string, cat: Catalog = catalog): ScenarioDef {
  return find(cat.scenarios, id, 'Escenario');
}
export function getComponent(id: string, cat: Catalog = catalog): ComponentDef {
  return find(cat.components, id, 'Componente');
}
export function getOrbit(id: OrbitId, cat: Catalog = catalog): OrbitDef {
  return find(cat.orbits, id, 'Órbita');
}
export function getLauncher(id: string, cat: Catalog = catalog): LauncherDef {
  return find(cat.launchers, id, 'Lanzador');
}

/** Componentes disponibles en un escenario (respeta allowedComponents). */
export function componentsForScenario(scenarioId: string, cat: Catalog = catalog): ComponentDef[] {
  const scenario = getScenario(scenarioId, cat);
  if (!scenario.allowedComponents) return [...cat.components];
  const allowed = new Set(scenario.allowedComponents);
  return cat.components.filter((c) => allowed.has(c.id));
}
