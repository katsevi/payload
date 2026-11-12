/**
 * API pública de @payload/shared. El cliente y el servidor de juego SOLO importan desde aquí.
 * Ver packages/shared/CLAUDE.md para el contrato de cada función.
 */
export * from './types';
export { catalog, parseCatalog, getShip, getNodeKind, getThrottle, getSurfaceCatalog, getWorld, getMaterial } from './catalog';
export { generateSector, isSectorSolvable, ecoFuelCost, nodeDistanceLy, getNode } from './galaxy';
export { createRun, computeScore, fuelPerLy, cruiseSpeedLyPerS, FIXED_STEP_S, MAX_WORK_SECONDS } from './run';
export { getNodeWorld, generateSurface, takeOffFuel, referenceBrake, simulateDescent, descentStep, REFERENCE_BRAKE_MARGIN, streakMultiplier, suitRefill, type DescentResult } from './surface';
export { createRng, deriveSeed, type Rng } from './rng';
export { simLocales } from './locales';
export { formatMessage, lookupSimKey, flattenKeys } from './messages';
