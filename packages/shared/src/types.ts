/**
 * CONTRATO DE DOMINIO DE PAYLOAD (v2: tripulación de exploración, ver docs/adr/0011)
 * ------------------------------------------------------------------
 * Contrato entre el motor (packages/shared), el cliente (apps/client) y, en la fase 4, el
 * servidor de juego (apps/game-server).
 *
 * Reglas:
 *  - TypeScript puro: sin dependencias de React, Three.js, DOM ni Node.
 *  - Cambios ADITIVOS únicamente. Renombrar o quitar campos exige un ADR en docs/adr/ y
 *    actualizar a todos los consumidores en el mismo cambio.
 *  - El motor nunca devuelve texto final al jugador: devuelve claves i18n + parámetros
 *    (`MessageRef`). Las traducciones viven en packages/shared/locales/{es,en}.json (namespace `sim`).
 *  - Unidades en el nombre del campo (Ly = años luz, Kw, Pct, S = segundos).
 */

// ─── Idioma y textos ────────────────────────────────────────────────────────

export type Locale = 'es' | 'en';
export const LOCALES: readonly Locale[] = ['es', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'es';

/** Texto de contenido (catálogo) en ambos idiomas. */
export type LocalizedText = Record<Locale, string>;

/** Referencia a un mensaje traducible del motor (namespace i18n `sim`). */
export interface MessageRef {
  key: string;
  params?: Record<string, string | number>;
}

export interface Range {
  min: number;
  max: number;
}

// ─── Nave ───────────────────────────────────────────────────────────────────

export const SYSTEM_IDS = ['reactor', 'engines', 'lifeSupport', 'shields', 'nav'] as const;
/** Sistemas de a bordo. Cada uno es un puesto físico en el interior de la nave. */
export type SystemId = (typeof SYSTEM_IDS)[number];
/** Sistemas que consumen energía del reactor (todos menos el propio reactor). */
export type PoweredSystemId = Exclude<SystemId, 'reactor'>;

export const THROTTLE_IDS = ['eco', 'cruise', 'burn'] as const;
/** Régimen de motores: compromiso entre tiempo de viaje, combustible, potencia y desgaste. */
export type ThrottleId = (typeof THROTTLE_IDS)[number];

export interface ThrottleDef {
  id: ThrottleId;
  /** Multiplicador sobre la velocidad de crucero. */
  speedMult: number;
  /** Multiplicador sobre el combustible por año luz. */
  fuelMult: number;
  /** Multiplicador sobre el consumo eléctrico de los motores. */
  engineDrawMult: number;
  /** Multiplicador sobre la probabilidad de averías por desgaste. */
  wearMult: number;
}

export interface ShipDef {
  id: string;
  name: LocalizedText;
  hullMax: number;
  fuelCapacity: number;
  startFuel: number;
  /** Kits de repuestos: cada uno restaura parte de la salud de un sistema. */
  startSpares: number;
  maxSpares: number;
  /** Potencia del reactor con salud al 100 %. */
  reactorOutputKw: number;
  /** Consumo de cada sistema encendido (los motores solo consumen en tránsito). */
  systemDrawKw: Record<PoweredSystemId, number>;
  cruiseSpeedLyPerS: number;
  /** Combustible por año luz a régimen de crucero con motores sanos. */
  fuelPerLy: number;
  /** Sobrecoste de combustible con motores a salud 0 (lineal con el daño). */
  damagedEngineFuelPenalty: number;
  /** Combustible que cuesta una maniobra evasiva. */
  evadeFuel: number;
  crewO2UsePctPerS: number;
  /** Regeneración de O2 del soporte vital con salud al 100 %. */
  o2RegenPctPerS: number;
  /** Fracción (0-1) del daño de impacto que absorben los escudos con salud al 100 %. */
  shieldAbsorb: number;
  shieldWearPctPerHit: number;
  /** Daño al reactor por segundo mientras la demanda supera a la potencia disponible. */
  overloadReactorDamagePctPerS: number;
  throttles: ThrottleDef[];
}

// ─── Averías y peligros ─────────────────────────────────────────────────────

export const INCIDENT_KINDS = ['fire', 'short', 'leak'] as const;
/** Avería activa que alguien tiene que ir a resolver en persona. */
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export interface HazardRules {
  incidents: {
    fire: { repairS: number; systemDamagePctPerS: number; hullDamagePerS: number; o2DrainPctPerS: number; spreadAfterS: number };
    short: { repairS: number; escalateToFireAfterS: number };
    leak: { repairS: number; o2DrainPctPerS: number };
  };
  impact: {
    /** Distancia a la que los sensores avisan del impacto (más velocidad = menos tiempo de reacción). */
    warnLeadLy: number;
    hullDamageMin: number;
    hullDamageMax: number;
    systemDamageMin: number;
    systemDamageMax: number;
    /** Probabilidad de fuga tras un impacto sin escudos. */
    leakChanceUnshielded: number;
  };
  wear: { chancePerS: number; weights: Record<IncidentKind, number> };
  repair: { kitRepairS: number; kitRestorePct: number };
  alerts: { lowOxygenPct: number; lowFuelPct: number; lowHullPct: number };
  maxIncidents: number;
}

// ─── Destinos y sector ──────────────────────────────────────────────────────

export const NODE_KINDS = ['station', 'planet', 'moon', 'asteroid', 'nebula', 'derelict', 'gate'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const HAZARD_KINDS = ['impact', 'short', 'fire', 'leak'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export interface NodeKindDef {
  id: NodeKind;
  name: LocalizedText;
  /** Peso al sortear los nodos intermedios (0 = solo se coloca por regla). */
  weight: number;
  /** Se podrá aterrizar en la fase 2 (exploración de superficie). */
  landable: boolean;
  /** Peligros esperados por año luz al aproximarse a un destino de este tipo. */
  hazardPerLy: Record<HazardKind, number>;
  /** Contenedor a la deriva que se recoge al llegar (una vez). */
  cache?: { chance: number; fuel: Range; spares: Range };
  /** Servicio de estación (una vez por estación): repostar, reparar casco y repuestos. */
  service?: { refuel: boolean; hullRepair: number; spares: number };
}

export interface SectorRules {
  /** Columnas intermedias entre la estación de salida y el portal. */
  columns: number;
  maxColumns: number;
  columnsGrowthEverySectors: number;
  nodesPerColumn: Range;
  columnSpacingLy: Range;
  lateralSpreadLy: number;
  maxLinkLy: number;
  /** Cuánto crecen los peligros en cada sector (0.3 = +30 % por sector). */
  hazardGrowthPerSector: number;
  /** Tramo inicial de cada salto sin peligros. */
  safeStartLy: number;
  nameSyllables: string[];
}

export interface Catalog {
  ships: ShipDef[];
  hazards: HazardRules;
  nodeKinds: NodeKindDef[];
  sector: SectorRules;
}

export interface SectorNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** Posición en el mapa del sector (años luz). */
  x: number;
  y: number;
  column: number;
  /** Ids de los nodos a los que se puede saltar desde aquí (bidireccional). */
  links: string[];
  /** Contenedor pre-sorteado (null = no hay). */
  cache: { fuel: number; spares: number } | null;
}

export interface SectorMap {
  /** 1 = primer sector. */
  index: number;
  hazardMult: number;
  nodes: SectorNode[];
  startId: string;
  goalId: string;
}

// ─── Estado de la partida ───────────────────────────────────────────────────

/** `won` = sector superado, a la espera de `next-sector`. */
export type RunPhase = 'docked' | 'transit' | 'won' | 'lost';
export type LossReason = 'hull' | 'oxygen' | 'stranded';

export interface SystemState {
  healthPct: number;
  /** Interruptor del jugador (el reactor no se puede apagar). */
  enabled: boolean;
  /** Derivado: hay un cortocircuito activo en el sistema. */
  shorted: boolean;
  /** Derivado: funciona (encendido, con salud, sin corto y con energía). */
  online: boolean;
  /** Avance 0-1 de la reparación con kit en curso. */
  repairProgress: number;
}

export interface Incident {
  id: number;
  kind: IncidentKind;
  systemId: SystemId;
  ageS: number;
  /** Avance 0-1 del arreglo. */
  progress: number;
  /** Solo fuego: ya se propagó a otro sistema. */
  spread?: boolean;
}

export interface PlannedHazard {
  id: number;
  kind: HazardKind;
  /** Punto del trayecto en el que ocurre. */
  atLy: number;
  systemId: SystemId;
  /** Solo impactos. */
  hullDamage: number;
  systemDamage: number;
  /** Tirada 0-1 para la fuga tras un impacto sin escudos. */
  leakRoll: number;
  evaded: boolean;
  /** Los sensores ya avisaron de este impacto. */
  announced: boolean;
}

/** Impacto anunciado por los sensores (requiere navegación en línea). */
export interface ImpactWarning {
  hazardId: number;
  etaS: number;
  evaded: boolean;
}

export interface TransitState {
  fromId: string;
  toId: string;
  distanceLy: number;
  traveledLy: number;
  /** Peligros pendientes, ordenados por `atLy`. */
  hazards: PlannedHazard[];
}

export interface ShipState {
  shipId: string;
  hull: number;
  fuel: number;
  oxygenPct: number;
  spares: number;
  throttle: ThrottleId;
  systems: Record<SystemId, SystemState>;
  /** Derivados del último paso. */
  powerSupplyKw: number;
  powerDemandKw: number;
  overloaded: boolean;
  speedLyPerS: number;
}

export interface RunStats {
  timeS: number;
  jumps: number;
  distanceLy: number;
  sectorsCleared: number;
  incidentsFixed: number;
  impactsTaken: number;
  impactsEvaded: number;
  kitsUsed: number;
}

export interface RunState {
  seed: number;
  phase: RunPhase;
  lossReason: LossReason | null;
  sector: SectorMap;
  locationId: string;
  visitedIds: string[];
  /** Estaciones cuyo servicio ya se usó. */
  servicedIds: string[];
  ship: ShipState;
  incidents: Incident[];
  warnings: ImpactWarning[];
  transit: TransitState | null;
  stats: RunStats;
  score: number;
}

export type RunEventType =
  | 'jump'
  | 'arrived'
  | 'incident'
  | 'incident-fixed'
  | 'incident-escalated'
  | 'fire-spread'
  | 'impact-warning'
  | 'impact-hit'
  | 'impact-evaded'
  | 'overload'
  | 'blackout'
  | 'system-down'
  | 'system-repaired'
  | 'service'
  | 'cache'
  | 'low-oxygen'
  | 'low-fuel'
  | 'low-hull'
  | 'sector-cleared'
  | 'new-sector'
  | 'lost';

export type EventTone = 'info' | 'ok' | 'warn' | 'bad';

export interface RunEvent {
  id: number;
  type: RunEventType;
  tS: number;
  tone: EventTone;
  message: MessageRef;
  systemId?: SystemId;
  incidentKind?: IncidentKind;
}

/** Acciones del jugador. Las que llevan `seconds` se envían mientras se mantiene pulsada la tecla. */
export type RunAction =
  | { type: 'jump'; toId: string }
  | { type: 'set-throttle'; throttle: ThrottleId }
  | { type: 'toggle-system'; systemId: SystemId; enabled: boolean }
  | { type: 'work-incident'; incidentId: number; seconds: number }
  | { type: 'repair-system'; systemId: SystemId; seconds: number }
  | { type: 'evade' }
  | { type: 'service' }
  | { type: 'next-sector' };

export type ActionResult = { ok: true } | { ok: false; reason: MessageRef };

export interface JumpEstimate {
  toId: string;
  distanceLy: number;
  /** Combustible y tiempo estimados por régimen, con el estado actual de los motores. */
  byThrottle: Record<ThrottleId, { fuel: number; timeS: number; enoughFuel: boolean }>;
  /** Peligros esperados en el trayecto (ya con el multiplicador del sector). */
  expectedHazards: Record<HazardKind, number>;
  /** 0-3: resumen del riesgo para el mapa. */
  riskLevel: number;
}

export interface Run {
  /** Estado vivo (solo lectura para el consumidor; lo muta el motor). */
  readonly state: RunState;
  readonly catalog: Catalog;
  /** Avanza el tiempo real `dtSeconds` en pasos fijos y devuelve los eventos emitidos. */
  step(dtSeconds: number): RunEvent[];
  /** Aplica una acción; los eventos que provoque salen por `takeEvents()`. */
  apply(action: RunAction): ActionResult;
  /** Devuelve y vacía los eventos pendientes (los de `apply` y los no leídos de `step`). */
  takeEvents(): RunEvent[];
  estimateJump(toId: string): JumpEstimate | null;
  /** Copia profunda del estado (tests, red). */
  snapshot(): RunState;
}

export interface RunOptions {
  seed: number;
  shipId?: string;
  catalog?: Catalog;
}
