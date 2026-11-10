/**
 * Constantes del modelo de simulación (compartidas por simulation, review y report sin ciclos de
 * importación). Ver la cabecera de simulation.ts para el modelo completo. Al final, las de la sala
 * multijugador (fase 3), aquí para que catalog.ts pueda validar disparadores sin importar team.ts.
 */
import type { DifficultyLevel, EventTable } from './types';

export const DEFAULT_FIXED_STEP_S = 30;
export const SECONDS_PER_DAY = 86400;

/** Tormenta solar: la generación cae al 60 % durante 8 h. */
export const STORM_GENERATION_FACTOR = 0.6;
export const STORM_DURATION_H = 8;
/** Maniobra anticolisión: instrumentos apagados durante 2 h. */
export const DEBRIS_PAYLOAD_OFF_H = 2;
/** Un ADCS con precisión ≤ 1° se considera basado en ruedas de reacción. */
export const WHEEL_ADCS_MAX_ACCURACY_DEG = 1;
/** Precisión de respaldo (magnetopares con sensores gruesos) tras fallar las ruedas. */
export const BACKUP_POINTING_DEG = 5;
/** Un ADCS con precisión ≤ 0,1° se considera con star tracker (determinación de actitud fina). */
export const STAR_TRACKER_MAX_ACCURACY_DEG = 0.1;
/** Tras fallar las ruedas, con star tracker y magnetopares: se sabe con precisión hacia dónde se apunta y los magnetopares corrigen. */
export const BACKUP_POINTING_STAR_TRACKER_MTQ_DEG = 1;
/** Tras fallar las ruedas, con star tracker pero sin magnetopares dedicados (control residual del propio ADCS). */
export const BACKUP_POINTING_STAR_TRACKER_DEG = 2;
/** Puntuación: el criterio de vida útil vale 0 por debajo de esta fracción de la vida exigida. */
export const LIFETIME_CRITERION_FLOOR = 0.75;
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

// ─── Fase 2: eventos de salud de la nave y pre-operación (ver ADR 0008) ─────

/** Sobrecalentamiento: instrumentos apagados (modo seguro térmico) durante 3 h. */
export const OVERHEAT_SAFE_MODE_H = 3;
/** Tope del factor térmico que multiplica la probabilidad diaria de sobrecalentamiento. */
export const OVERHEAT_MAX_FACTOR = 2;
/** Falla de paneles, batería o control térmico: la protección de fallos aísla la pieza y la nave pasa este tiempo en modo seguro. */
export const FAULT_SAFE_MODE_H = 6;
/** Si falla la única radio, se pasa a la antena de baja ganancia con esta fracción de la tasa. */
export const COMMS_BACKUP_FACTOR = 0.25;
/** Si falla la única computadora, queda un banco de memoria con esta fracción del almacenamiento. */
export const OBC_BACKUP_FACTOR = 0.5;
/** Puntuación: cada agotamiento de batería resta esta fracción del criterio de energía. */
export const DEPLETION_SCORE_PENALTY = 0.15;

/**
 * Tabla de eventos por dificultad. Los valores del entorno coinciden con los de la fase 1
 * (EVENT_CHANCE_PER_DAY, EVENT_WEIGHTS) para que las semillas documentadas no cambien.
 *  - componentFailureAcceleration A: la probabilidad diaria de que falle alguna pieza es
 *    1 − R_eff^(A / (5 años · 365)), con R_eff = Π r_i^(1 + 2·radiación). Es decir, cada día de
 *    misión "condensa" A días de desgaste real (sin eso, en 30 días casi nunca fallaría nada).
 */
export const EVENT_TABLES: Record<DifficultyLevel, EventTable> = {
  basic: {
    environmentChancePerDay: EVENT_CHANCE_PER_DAY.basic,
    environmentWeights: { ...EVENT_WEIGHTS },
    overheatingChancePerDay: 0.05,
    componentFailureAcceleration: 15,
    launchDelayChance: 0.15,
    launchDelayMonths: { min: 1, max: 2 },
    budgetCutChance: 0.1,
    budgetCutPct: { min: 5, max: 10 },
  },
  intermediate: {
    environmentChancePerDay: EVENT_CHANCE_PER_DAY.intermediate,
    environmentWeights: { ...EVENT_WEIGHTS },
    overheatingChancePerDay: 0.08,
    componentFailureAcceleration: 30,
    launchDelayChance: 0.25,
    launchDelayMonths: { min: 1, max: 3 },
    budgetCutChance: 0.2,
    budgetCutPct: { min: 5, max: 15 },
  },
  advanced: {
    environmentChancePerDay: EVENT_CHANCE_PER_DAY.advanced,
    environmentWeights: { ...EVENT_WEIGHTS },
    overheatingChancePerDay: 0.12,
    componentFailureAcceleration: 50,
    launchDelayChance: 0.35,
    launchDelayMonths: { min: 2, max: 4 },
    budgetCutChance: 0.3,
    budgetCutPct: { min: 10, max: 20 },
  },
};

/** Sal para derivar el flujo de azar de los eventos de salud (no altera el del entorno). */
export const HEALTH_RNG_SALT = 0x4845414c;
/** Sal para derivar el flujo de azar de los eventos pre-operación. */
export const PRELAUNCH_RNG_SALT = 0x50524531;

// ─── Fase 3: multijugador (ver docs/MULTIPLAYER.md y team.ts) ───────────────

/** Aceleraciones permitidas en la sala (las mismas del solitario; 0 = pausa). */
export const TEAM_TIME_SCALES = [0, 1, 10, 100, 1000, 10000] as const;

/**
 * Límites y umbrales de la sala. Los textos se miden en puntos de código tras `sanitizePlayerText`
 * (el esquema zod los limita en unidades UTF-16, que nunca son menos).
 */
export const TEAM_LIMITS = {
  /** Una nave, cuatro roles: más jugadores no tendrían rol. */
  maxPlayers: 4,
  nameMaxChars: 24,
  /** Un tuit: suficiente para coordinarse sin convertir la sala en un foro. */
  chatMaxChars: 280,
  noteMaxChars: 280,
  /** Ids de piezas, solicitudes y alertas en las acciones (protege el esquema de cadenas enormes). */
  idMaxChars: 64,
  /** Mensajes de chat y eventos que guarda el estado sincronizado (el resto se descarta). */
  chatHistory: 50,
  eventHistory: 200,
  /** Espera a un cliente caído antes de repartir sus roles (allowReconnection). */
  reconnectGraceS: 60,
  /** Una alerta cierra sola a los 45 s: el juego no se queda congelado si alguien no responde. */
  alertTimeoutS: 45,
  /** Tope de la pantalla de lanzamiento: se pasa a operación aunque falte algún launch-done. */
  launchScreenMaxS: 25,
  /** Frecuencias sugeridas al servidor: avance de la simulación y poses de avatar (Hz). */
  simTickHz: 10,
  moveMaxHz: 10,
  /** Intervalo mínimo entre mensajes de chat y entre pings de un mismo jugador (s). */
  chatMinIntervalS: 1,
  pingMinIntervalS: 2,
  // Límites contra el crecimiento del estado sincronizado (checkTeamAction los aplica):
  /** Solicitudes ABIERTAS por jugador: más allá, que espere respuesta o retire alguna. */
  maxOpenRequestsPerPlayer: 5,
  /**
   * Intervalo mínimo (s) entre `request-resource` o acciones que generan solicitud de un mismo jugador.
   * Lo aplica el servidor (límite de frecuencia); el motor no tiene reloj.
   */
  requestMinIntervalS: 2,
  /**
   * Ráfaga permitida: cubeta de `requestBurst` fichas que se repone a una ficha cada
   * `requestMinIntervalS` (`takeRequestToken`). Tres clics rápidos pasan; un cuarto espera.
   */
  requestBurst: 3,
  /**
   * Solicitudes CERRADAS que conserva el estado (las abiertas nunca se purgan). Las purgadas siguen
   * contando para la colaboración a través de `CollaborationInput.purged` (`purgeRequests`).
   */
  requestHistory: 100,
  /** Piezas por diseño: el mayor diseño válido del catálogo usa ~15; 40 deja holgura sin dejar crecer el estado. */
  maxComponents: 40,
  // Colaboración (scoreCollaboration):
  /** Responder una solicitud en ≤ 60 s vale el 100 %: una ronda de conversación. */
  requestFullCreditS: 60,
  /** A los 5 min la respuesta vale el mínimo (`requestSlowCredit`); dejarla abierta vale 0. */
  requestSlowS: 300,
  /** Responder tarde sigue siendo mejor que no responder. */
  requestSlowCredit: 0.5,
  /** Responder una alerta en ≤ 20 s vale el 100 % (leer el evento y pulsar). */
  alertFullCreditS: 20,
  /**
   * La curva de alertas llega a 0 a los 70 s, así que responder justo al cierre por tiempo (45 s)
   * vale 0,5 y no responder vale 0.
   */
  alertZeroCreditS: 70,
} as const;

/**
 * Disparadores `team:<valor>` de la mascota en sala (lista cerrada; los valida catalog.ts).
 * Los diálogos los escribe el contenido (catalog/mascota.json); la sala publica el disparador en `mascot`.
 */
export const TEAM_MASCOT_TRIGGERS = [
  'lobby', 'player-joined', 'roles-combined', 'player-left', 'player-back', 'host-changed',
  'allocation', 'request-open', 'request-approved', 'request-rejected',
  'vote-open', 'vote-go', 'vote-no-go',
  'alert', 'alert-answered', 'alert-timeout',
  'ping', 'chat',
] as const;
