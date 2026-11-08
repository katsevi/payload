// Utilidades de test: carga los diseños de ejemplo del prototipo (prototype/designs/*.json).
import { readdirSync, readFileSync } from 'node:fs';
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
