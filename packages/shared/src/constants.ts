/**
 * Constantes del modelo de simulación (compartidas por simulation, review y report sin ciclos de
 * importación). Ver la cabecera de simulation.ts para el modelo completo.
 */
import type { DifficultyLevel } from './types';

export const DEFAULT_FIXED_STEP_S = 30;
export const SECONDS_PER_DAY = 86400;

/** Tormenta solar: la generación cae al 60 % durante 8 h. */
export const STORM_GENERATION_FACTOR = 0.6;
export const STORM_DURATION_H = 8;
/** Maniobra anticolisión: instrumentos apagados durante 2 h. */
export const DEBRIS_PAYLOAD_OFF_H = 2;
/** Un ADCS con precisión ≤ 1° se considera basado en ruedas de reacción. */
export const WHEEL_ADCS_MAX_ACCURACY_DEG = 1;
/** Precisión de respaldo (magnetopares) tras fallar las ruedas. */
export const BACKUP_POINTING_DEG = 5;
/** Un instrumento con apuntado peor que el que necesita produce esta fracción de datos útiles. */
export const POINTING_DATA_FACTOR = 0.5;
/** Cada agotamiento de batería reduce su capacidad a este factor. */
export const DEPLETION_CAPACITY_FACTOR = 0.9;
/** Al llegar a este número de agotamientos la batería queda inservible: misión fallida. */
export const MAX_DEPLETIONS = 5;
export const BROWNOUT_EXIT_SOC = 0.05;
export const SAFE_MODE_EXIT_SOC = 0.8;
/** Desgaste por descarga profunda: fracción de la capacidad nominal perdida por hora bajo la DoD. */
export const DEEP_DISCHARGE_WEAR_PER_H = 0.06;
/** La batería queda inservible por debajo de esta fracción de su capacidad nominal. */
export const BATTERY_DEAD_FRACTION = 0.6;
/** `battery-low` se rearma al recuperar este margen (fracción de SoC) por encima del suelo DoD. */
export const BATTERY_LOW_REARM_MARGIN = 0.1;
/** Probabilidad diaria de un evento aleatorio según la dificultad del escenario. */
export const EVENT_CHANCE_PER_DAY: Record<DifficultyLevel, number> = { basic: 0.06, intermediate: 0.1, advanced: 0.15 };
/** Pesos relativos de cada tipo de evento aleatorio. */
export const EVENT_WEIGHTS = { 'solar-storm': 3, 'debris-avoidance': 4, 'reaction-wheel-failure': 2 } as const;
