/**
 * Catálogo del juego: esquema zod, validación de referencias cruzadas y búsquedas.
 * El contenido vive en packages/shared/catalog/*.json (regla 3: contenido en datos).
 */
import { z } from 'zod';
import componentsJson from '../catalog/componentes.json';
import orbitsJson from '../catalog/orbitas.json';
import launchersJson from '../catalog/lanzadores.json';
import scenariosJson from '../catalog/escenarios.json';
import glossaryJson from '../catalog/glosario.json';
import mascotJson from '../catalog/mascota.json';
import academyJson from '../catalog/academia.json';
import { TEAM_MASCOT_TRIGGERS } from './constants';
import type { Catalog, ComponentDef, LauncherDef, OrbitDef, OrbitId, ScenarioDef, SubsystemId } from './types';

// ─── Esquema ────────────────────────────────────────────────────────────────

const ORBIT_IDS = ['LEO', 'SSO', 'MEO', 'GEO', 'HEO', 'TLI'] as const;
const SUBSYSTEMS = ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'] as const;
const RESOURCES = ['mass', 'power', 'battery', 'budget', 'data', 'comms', 'time', 'lifetime'] as const;
const EXPRESSIONS = ['happy', 'thinking', 'worried', 'celebrating'] as const;
const ENVIRONMENT_EVENTS = ['solar-storm', 'debris-avoidance', 'reaction-wheel-failure'] as const;
/** Tipos de SimEvent válidos en un disparador `event:<tipo>` de la mascota. */
export const SIM_EVENT_TYPES = [
  'launch-success', 'launch-failure', 'eclipse-enter', 'eclipse-exit', 'contact-start', 'contact-end', 'battery-low',
  'battery-depleted', 'storage-full', 'solar-storm', 'reaction-wheel-failure', 'debris-avoidance', 'component-failure',
  'mission-complete', 'overheating', 'launch-delay', 'budget-cut',
] as const;
const MISSION_PHASES = ['briefing', 'design', 'review', 'launch', 'operation', 'report'] as const;
/** Roles del equipo para `role:<rol>` (= TEAM_ROLES de team.ts; copia local para no crear un ciclo de imports). */
export const TEAM_ROLE_IDS = ['director', 'engineering', 'science', 'operations'] as const;

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
  eventTuning: z
    .strictObject({
      environmentChancePerDay: probability.optional(),
      environmentWeights: z.partialRecord(z.enum(ENVIRONMENT_EVENTS), nonNeg).optional(),
      overheatingChancePerDay: probability.optional(),
      componentFailureAcceleration: nonNeg.optional(),
      launchDelayChance: probability.optional(),
      launchDelayMonths: z
        .strictObject({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
        .refine((r) => r.min <= r.max, { message: 'min debe ser <= max' })
        .optional(),
      budgetCutChance: probability.optional(),
      budgetCutPct: z
        .strictObject({ min: z.number().int().min(0).max(100), max: z.number().int().min(0).max(100) })
        .refine((r) => r.min <= r.max, { message: 'min debe ser <= max' })
        .optional(),
    })
    .optional(),
  team: z
    .strictObject({
      minPlayers: z.number().int().min(1, 'minPlayers debe estar entre 1 y 4').max(4, 'minPlayers debe estar entre 1 y 4'),
      maxPlayers: z.number().int().min(1, 'maxPlayers debe estar entre 1 y 4').max(4, 'maxPlayers debe estar entre 1 y 4'),
    })
    .refine((t) => t.minPlayers <= t.maxPlayers, { message: 'minPlayers debe ser <= maxPlayers', path: ['minPlayers'] })
    .optional(),
});

// ─── Contenido pedagógico (fase 2) ──────────────────────────────────────────

const glossarySchema = z.strictObject({
  id,
  term: localized,
  definition: localized,
  why: localized.optional(),
  related: z.array(id).optional(),
});

/** `<tipo>:<valor>`; el valor se comprueba según el tipo en las referencias cruzadas. */
const triggerSchema = z
  .string()
  .regex(
    /^(event|resource-over|resource-tight|phase|academy|help|review|report|team|role):[a-z0-9]+(-[a-z0-9]+)*$/,
    'disparador inválido: usa <tipo>:<valor> (event, resource-over, resource-tight, phase, academy, help, review, report, team, role)',
  );

const mascotSchema = z.strictObject({
  id,
  name: localized,
  description: localized.optional(),
  model: z.string().min(1).optional(),
  expressions: z.array(z.enum(EXPRESSIONS)).min(1),
  sprite2d: z.string().min(1).optional(),
  dialogues: z.array(z.strictObject({ id, trigger: triggerSchema, expression: z.enum(EXPRESSIONS), text: localized })).min(1),
});

const academySchema = z.strictObject({
  id,
  scenarioId: id,
  title: localized,
  mascotId: id.optional(),
  steps: z
    .array(
      z.strictObject({
        id,
        resource: z.enum([...RESOURCES, 'intro', 'launch', 'operation', 'report']),
        title: localized,
        body: localized,
        goal: z.strictObject({
          type: z.enum(['add-component', 'select-orbit', 'select-launcher', 'resource-ok', 'go', 'manual']),
          value: z.string().min(1).optional(),
        }),
      }),
    )
    .min(1),
});

const catalogSchema = z.strictObject({
  components: z.array(componentSchema),
  orbits: z.array(orbitSchema),
  launchers: z.array(launcherSchema),
  scenarios: z.array(scenarioSchema),
  glossary: z.array(glossarySchema).optional(),
  mascot: mascotSchema.optional(),
  academy: academySchema.optional(),
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
  errors.push(...pedagogyErrors(cat, { componentIds, orbitIds, launcherIds }));
  return errors;
}

/** Referencias cruzadas del glosario, la mascota y la Academia. */
function pedagogyErrors(
  cat: Catalog,
  ids: { componentIds: Set<string>; orbitIds: Set<string>; launcherIds: Set<string> },
): string[] {
  const errors: string[] = [];
  const dupes = (kind: string, list: string[]) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x)) errors.push(`${kind}: id duplicado "${x}"`);
      seen.add(x);
    }
  };
  if (cat.glossary) {
    dupes('glossary', cat.glossary.map((g) => g.id));
    const gids = new Set(cat.glossary.map((g) => g.id));
    for (const g of cat.glossary) {
      for (const r of g.related ?? []) {
        if (!gids.has(r)) errors.push(`glossary (id "${g.id}").related: la entrada "${r}" no existe`);
        if (r === g.id) errors.push(`glossary (id "${g.id}").related: no puede referirse a sí misma`);
      }
    }
  }
  const academySteps = new Set(cat.academy?.steps.map((st) => st.id) ?? []);
  if (cat.mascot) {
    const m = cat.mascot;
    dupes('mascot.dialogues', m.dialogues.map((d) => d.id));
    const expressions = new Set<string>(m.expressions);
    const resources = new Set<string>(RESOURCES);
    const events = new Set<string>(SIM_EVENT_TYPES);
    const phases = new Set<string>(MISSION_PHASES);
    const teamTriggers = new Set<string>(TEAM_MASCOT_TRIGGERS);
    const roles = new Set<string>(TEAM_ROLE_IDS);
    for (const d of m.dialogues) {
      const where = `mascot.dialogues (id "${d.id}")`;
      if (!expressions.has(d.expression)) errors.push(`${where}.expression: "${d.expression}" no está en mascot.expressions`);
      const sep = d.trigger.indexOf(':');
      const kind = d.trigger.slice(0, sep);
      const value = d.trigger.slice(sep + 1);
      const bad = (what: string) => errors.push(`${where}.trigger: ${what} "${value}" no existe`);
      if (kind === 'event' && !events.has(value)) bad('el tipo de evento');
      if ((kind === 'resource-over' || kind === 'resource-tight') && !resources.has(value)) bad('el recurso');
      if (kind === 'phase' && !phases.has(value)) bad('la fase');
      if (kind === 'review' && value !== 'go' && value !== 'no-go') bad('el resultado (go | no-go)');
      if (kind === 'report' && value !== 'success' && value !== 'failure') bad('el desenlace (success | failure)');
      if (kind === 'academy' && cat.academy && !academySteps.has(value)) bad('el paso de la Academia');
      if (kind === 'team' && !teamTriggers.has(value)) {
        errors.push(`${where}.trigger: el disparador de equipo "${value}" no existe (usa: ${TEAM_MASCOT_TRIGGERS.join(', ')})`);
      }
      if (kind === 'role' && !roles.has(value)) {
        errors.push(`${where}.trigger: el rol "${value}" no existe (usa: ${TEAM_ROLE_IDS.join(', ')})`);
      }
    }
  }
  if (cat.academy) {
    const ac = cat.academy;
    dupes('academy.steps', ac.steps.map((st) => st.id));
    if (!cat.scenarios.some((sc) => sc.id === ac.scenarioId)) errors.push(`academy.scenarioId: el escenario "${ac.scenarioId}" no existe`);
    if (ac.mascotId !== undefined && cat.mascot?.id !== ac.mascotId) {
      errors.push(`academy.mascotId: la mascota "${ac.mascotId}" no es la del catálogo`);
    }
    const subsystems = new Set<string>(SUBSYSTEMS);
    const resources = new Set<string>(RESOURCES);
    for (const st of ac.steps) {
      const where = `academy.steps (id "${st.id}").goal`;
      const v = st.goal.value;
      if (v === undefined) {
        if (st.goal.type === 'resource-ok' && !resources.has(st.resource)) {
          errors.push(`${where}: resource-ok sin value necesita un "resource" que sea un recurso`);
        }
        continue;
      }
      if (st.goal.type === 'add-component' && !subsystems.has(v) && !ids.componentIds.has(v)) {
        errors.push(`${where}.value: "${v}" no es un componente ni un subsistema`);
      }
      if (st.goal.type === 'select-orbit' && !ids.orbitIds.has(v)) errors.push(`${where}.value: la órbita "${v}" no existe`);
      if (st.goal.type === 'select-launcher' && !ids.launcherIds.has(v)) errors.push(`${where}.value: el lanzador "${v}" no existe`);
      if (st.goal.type === 'resource-ok' && !resources.has(v)) errors.push(`${where}.value: el recurso "${v}" no existe`);
      if (st.goal.type === 'go' || st.goal.type === 'manual') errors.push(`${where}.value: "${st.goal.type}" no admite value`);
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
  glossary: glossaryJson,
  mascot: mascotJson,
  academy: academyJson,
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
