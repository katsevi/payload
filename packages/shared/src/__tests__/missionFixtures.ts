/**
 * Fixtures de diseño por misión (fase 4): `fixtures/missions/<missionId>.json`. Cada misión del catálogo
 * DEBE tener el suyo (`design.test.ts` falla si falta). Formato:
 *   {
 *     "missionId": "<id>",
 *     "valid":   [{ "name": "...", "design": MissionDesign }],                 // >= 2 soluciones distintas con Go
 *     "failing": [{ "name": "...", "cause": "<code>", "design": MissionDesign }] // >= 2 causas distintas (blocker)
 *   }
 * El primer diseño válido es el «de referencia» con el que juega el bot de balance.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MissionDesign } from '../types';

// `import.meta.url` (no `__dirname`): también lo carga `scripts/balance.ts` con tsx (ESM).
export const MISSION_FIXTURES_DIR = fileURLToPath(new URL('./fixtures/missions/', import.meta.url));

export interface MissionFixtureDesign {
  name: string;
  design: MissionDesign;
  /** Solo en `failing`: código del `blocker` que explica el fallo. */
  cause?: string;
}

export interface MissionFixture {
  missionId: string;
  valid: MissionFixtureDesign[];
  failing: MissionFixtureDesign[];
}

export function missionFixturePath(missionId: string): string {
  return join(MISSION_FIXTURES_DIR, `${missionId}.json`);
}

export function hasMissionFixture(missionId: string): boolean {
  return existsSync(missionFixturePath(missionId));
}

export function loadMissionFixture(missionId: string): MissionFixture {
  return JSON.parse(readFileSync(missionFixturePath(missionId), 'utf8')) as MissionFixture;
}

/** Diseño de referencia de una misión (el primero válido de su fixture). */
export function referenceDesign(missionId: string): MissionDesign {
  const first = loadMissionFixture(missionId).valid[0];
  if (!first) throw new Error(`La misión ${missionId} no tiene diseños válidos en su fixture`);
  return first.design;
}
