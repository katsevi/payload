/**
 * API pública de @payload/shared. El cliente y el servidor de juego SOLO importan desde aquí.
 * Ver packages/shared/CLAUDE.md para el contrato de cada función.
 */
export * from './types';
export {
  catalog,
  parseCatalog,
  getScenario,
  getComponent,
  getOrbit,
  getLauncher,
  componentsForScenario,
} from './catalog';
export { computeOrbitParams, MU_EARTH_KM3_S2, EARTH_RADIUS_KM } from './orbital';
export { computeBudgets } from './budgets';
export { reviewGoNoGo } from './review';
export { createMissionSim, runMission } from './simulation';
export { scoreMission } from './scoring';
export { buildReport } from './report';
export { createRng, type Rng } from './rng';
export { simLocales } from './locales';
export { formatMessage, resolveMessageParams, lookupSimKey, CATALOG_ID_PARAMS } from './messages';
export { TIGHT_MARGIN, RESOURCE_IDS } from './budgets';
export type { ScoreInput } from './scoring';
