// Utilidades de test: carga los diseños de ejemplo del prototipo (prototype/designs/*.json).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MissionDesign } from '../types';

export const DESIGNS_DIR = join(__dirname, '..', '..', '..', '..', 'prototype', 'designs');
export const SCENARIO_ID = 'leo-earth-observation';

export function loadDesign(name: string): MissionDesign {
  return JSON.parse(readFileSync(join(DESIGNS_DIR, `${name}.json`), 'utf8')) as MissionDesign;
}

export function allDesignNames(): string[] {
  return readdirSync(DESIGNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export const emptyDesign = (): MissionDesign => ({ scenarioId: SCENARIO_ID, componentIds: [], orbitId: null, launcherId: null });

// ─── Fixtures por escenario (src/__tests__/fixtures/scenarios/<scenarioId>.json) ──────────────
//
// Cada escenario del catálogo DEBE tener su archivo (scenarios.test.ts falla si falta). Formato:
//   {
//     "scenarioId": "<id>",
//     "valid":   [{ "name": "...", "design": MissionDesign } | { "name": "...", "prototype": "<prototype/designs/*.json>" }],
//     "failing": [{ "name": "...", "cause": "<code de ValidationIssue>", "design" | "prototype": ... }]
//   }
// valid: ≥ 2 soluciones distintas que obtienen Go y completan la misión.
// failing: ≥ 2 causas distintas; cada diseño muestra su `cause` en el Go/No-Go (blocker o aviso) y
// es No-Go o rinde mal en operación.

export const SCENARIO_FIXTURES_DIR = join(__dirname, 'fixtures', 'scenarios');

export interface ScenarioFixtureDesign {
  name: string;
  design: MissionDesign;
  /** Solo en `failing`: código de la ValidationIssue que explica el fallo. */
  cause?: string;
}

export interface ScenarioFixture {
  scenarioId: string;
  valid: ScenarioFixtureDesign[];
  failing: ScenarioFixtureDesign[];
}

interface RawFixtureDesign {
  name: string;
  design?: MissionDesign;
  prototype?: string;
  cause?: string;
}

function resolveFixtureDesign(raw: RawFixtureDesign): ScenarioFixtureDesign {
  const design = raw.design ?? (raw.prototype ? loadDesign(raw.prototype) : undefined);
  if (!design) throw new Error(`fixture "${raw.name}": falta "design" o "prototype"`);
  return { name: raw.name, design, ...(raw.cause ? { cause: raw.cause } : {}) };
}

/** Carga el fixture de un escenario, o null si no existe el archivo. */
export function loadScenarioFixture(scenarioId: string): ScenarioFixture | null {
  const file = join(SCENARIO_FIXTURES_DIR, `${scenarioId}.json`);
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { scenarioId: string; valid: RawFixtureDesign[]; failing: RawFixtureDesign[] };
  return {
    scenarioId: raw.scenarioId,
    valid: (raw.valid ?? []).map(resolveFixtureDesign),
    failing: (raw.failing ?? []).map(resolveFixtureDesign),
  };
}
