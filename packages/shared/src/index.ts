/**
 * API pública de @payload/shared. El cliente y el servidor de juego SOLO importan desde aquí.
 * Ver packages/shared/CLAUDE.md para el contrato de cada función.
 */
export * from './types';
export { catalog, parseCatalog, getShip, getNodeKind, getThrottle, getSurfaceCatalog, getWorld, getMaterial } from './catalog';
export {
  getEconomy, getUpgrades, getUpgrade, hasShop, sectorPriceMults, sellUnitPrice, priceOf, affordableUnits, upgradePrice, effectiveShip, effectiveSurfaceRules,
  upgradesMassKg, cargoMassKg, cargoFuelMult, stationOffer, cruisePowerMarginKw,
} from './economy';
export { generateSector, isSectorSolvable, ecoFuelCost, nodeDistanceLy, getNode } from './galaxy';
export {
  getDesignRules, getMissions, getMission, getModules, getModule, getInstruments, getInstrument, getLaunchers, getLauncher, emptyDesign,
  shipFromDesign, designMassKg, designOperations, getDifficulties, getDifficulty, missionAtDifficulty, guidedStartDesign, guidedProgress, computeDesignBudgets, reviewDesign, missionDesignSchema, parseMissionDesign, normalizeDesign,
} from './design';
export {
  getSolarSystem, findBody, getBody, getZone, bodySunDistanceAu, routeWorstSunDistance, type RouteWorstPoint, solarPowerFactor, solarKw, shipPowerKw, legUnits, routeZoneIndex, routeZones, sectorZones,
  sectorForZone, zoneBodies, generateSolarSector, bodyPositionAu, solarNodePositionsAu, type SolarPositionAu,
} from './solar';
export { createRun, computeScore, fuelPerLy, cruiseSpeedLyPerS, evadeDamageFraction, evadeDifficulty, FIXED_STEP_S, MAX_WORK_SECONDS } from './run';
export { getNodeWorld, generateSurface, takeOffFuel, referenceBrake, simulateDescent, descentStep, REFERENCE_BRAKE_MARGIN, streakMultiplier, suitRefill, lodeProgress, lodeBonusApplies, type DescentResult } from './surface';
export {
  getScienceRules, scienceProfile, newScienceState, contactWindow, downlinkMbPerS, sciencePoints, stepScience, finishMission, missionReport, type ScienceProfile,
} from './science';
export { getRoles, getRole, crewPerks, crewCarryCapacityKg, crewJetpackDrainPctPerS } from './roles';
export {
  getPsychRules, effectivePsychRules, sanityBandFor, bandIndex, sanityDebuffs, sanityDrainPctPerS, commsDelayMin, callRecoveryPct, psychRoll, cohesionDeltaPctPerS,
  contactWindowOpen, crewFieldValues, PSYCH_SALT, type DrainContext, type SanityDebuffs,
} from './sanity';
export { createRng, deriveSeed, type Rng } from './rng';
export * from './net';
export {
  applyDesignEdit, designEditsBetween, missionStartDesign, parseDesignEdit, voteTally, MAX_DESIGN_PARTS, type DesignEdit, type VoteTally,
} from './sharedDesign';
export { simLocales } from './locales';
export { formatMessage, lookupSimKey, flattenKeys } from './messages';
