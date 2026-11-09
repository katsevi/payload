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
export {
  computeOrbitParams, MU_EARTH_KM3_S2, EARTH_RADIUS_KM,
  orbitEccentricity, solveKeplerEquation, trueAnomalyFromMeanAnomaly, orbitPhaseAt, altitudeAtTrueAnomaly,
} from './orbital';
export { computeBudgets } from './budgets';
export { reviewGoNoGo } from './review';
export { createMissionSim, runMission } from './simulation';
export { rollPreLaunchEvents, resolveEventTable, wheelBackupPointingDeg } from './events';
export { EVENT_TABLES } from './constants';
export { scoreMission, energyCriterion, lifetimeCriterion } from './scoring';
export { adviseByRole, ADVISOR_ROLES, ROLE_RESOURCES } from './advisors';
export {
  pickMascotDialogue, mascotTriggerForEvent, mascotTriggersFromBudgets, evaluateAcademyStep, getGlossaryEntry,
  MASCOT_TRIGGER_KINDS, type MascotTriggerKind,
} from './pedagogy';
export { buildReport } from './report';
export { createRng, deriveSeed, type Rng } from './rng';
export { simLocales } from './locales';
export { formatMessage, resolveMessageParams, lookupSimKey, CATALOG_ID_PARAMS } from './messages';
export { TIGHT_MARGIN, RESOURCE_IDS } from './budgets';
export type { ScoreInput } from './scoring';
