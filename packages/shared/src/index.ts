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
export { EVENT_TABLES, TEAM_LIMITS, TEAM_TIME_SCALES, TEAM_MASCOT_TRIGGERS } from './constants';
export { scoreMission, energyCriterion, lifetimeCriterion, withCollaboration, scoreWeightSum } from './scoring';
// Multijugador (fase 3): lógica de equipo y red de la sala (ver docs/MULTIPLAYER.md).
export {
  TEAM_ROLES, ROOM_PHASES, SUBSYSTEM_IDS, NO_GO_REASON_CODES, RESOURCE_UNITS, ROLE_SUBSYSTEMS, RESOURCE_OWNER, ROLE_PERMISSIONS,
  TEAM_ACTION_PHASES, EVENT_RESPONSE_ROLES,
  isTeamRole, isDesignAction, isTeamScenario, sameTeamAction, teamMascotTrigger, roleMascotTrigger,
  combineRoles, missingRoles, hasPermission, roleForPermission,
  applyDesignAction, actionImpact, checkTeamAction,
  allocatableBudgetMUSD, defaultAllocation, validateAllocation, subsystemSpend, allocationAfterApproval,
  buildResourceRequest, applyApprovedRequest, closeRequest,
  validateVote, teamVoteFrom, tallyGoNoGo,
  alertForEvent, alertSatisfied, ackAlert, alertTimedOut, closeAlert,
  scoreCollaboration, purgeRequests, takeRequestToken, sanitizePlayerText,
  type TeamMascotTrigger,
} from './team';
export { teamActionSchema, parseTeamAction, createRoomView, encodeRoomView, decodeRoomView } from './teamWire';
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
