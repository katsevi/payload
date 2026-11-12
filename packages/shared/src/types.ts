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
  /**
   * Fase 2: mundos, materiales y reglas de superficie (`catalog/mundos.json`). `parseCatalog` lo
   * rellena con el catálogo por defecto si falta, así que tras validar siempre está presente.
   */
  surface?: SurfaceCatalog;
}

// ─── Superficie (fase 2) ────────────────────────────────────────────────────

/** Material que se recoge en superficie. Ids kebab-case; nombre en `catalog.<id>`. */
export interface MaterialDef {
  id: string;
  name: LocalizedText;
  /** Puntos base por unidad guardada a bordo (crece con la distancia y el peligro). */
  value: number;
  massKg: number;
  /** Segundos de trabajo para arrancar una unidad. */
  collectS: number;
  /** Suministros que rinde cada unidad al guardarla en la nave (limitados por su capacidad). */
  yields?: { fuel?: number; spares?: number };
  /** Suma racha (solo lo raro): cada unidad de este tipo que se lleva encima revaloriza la siguiente. */
  streak?: boolean;
}

export interface WorldMaterialDef {
  materialId: string;
  /** Peso al sortear el material de una veta. */
  weight: number;
  units: Range;
  /** Fracción del radio explorable a partir de la que puede aparecer (0 = junto a la nave). */
  minDistanceFrac: number;
  /** Multiplicador del peso cerca o dentro de terreno inestable. */
  dangerWeightMult: number;
}

export interface WorldStormDef {
  /** Separación media entre tormentas (s, exponencial). */
  meanIntervalS: number;
  /** Aviso previo (s). */
  warnS: number;
  durationS: Range;
  /** Intensidad 0-1 (escala el drenaje extra y el efecto visual). */
  intensity: Range;
  /** Drenaje extra de O2 del traje con intensidad 1 al estar fuera de la nave. */
  o2DrainPctPerS: number;
  /**
   * La primera tormenta nunca empieza antes de estos segundos tras el contacto (la primera salida
   * tiene calma asegurada). Sin él, solo cuenta el sorteo.
   */
  firstStartMinS?: number;
}

/** Un mundo aterrizable. Cada nodo aterrizable recibe uno de su `kind` de forma determinista. */
export interface WorldDef {
  id: string;
  name: LocalizedText;
  kind: NodeKind;
  weight: number;
  gravityMps2: number;
  /**
   * Altitud y velocidad de caída al empezar el descenso. `referenceMargin` sustituye al de las reglas
   * en este mundo (con poca gravedad conviene pedir frenar antes; con mucha, después).
   */
  descent: { altitudeM: number; speedMps: number; referenceMargin?: number };
  /** Radio del área explorable alrededor de la nave (m). */
  radiusM: number;
  /** Número de vetas. */
  deposits: Range;
  materials: WorldMaterialDef[];
  storms: WorldStormDef | null;
  unstable: { zones: Range; radiusM: Range; pitDepthM: number };
  /** Multiplicador del desgaste de la nave mientras está en el descenso o en tierra. */
  shipWearMult: number;
}

export interface SurfaceRules {
  descent: {
    /** Deceleración que da el freno (m/s²); si no supera la gravedad, solo frena la aceleración. */
    brakeThrustMps2: number;
    brakeFuelPerS: number;
    /** El piloto automático nunca baja de esta velocidad (no se puede flotar). */
    minSpeedMps: number;
    safeSpeedMps: number;
    hullDamagePerMps: number;
    systemDamagePerMps: number;
    /** Probabilidad de fuga o corto por m/s de exceso. */
    incidentChancePerMps: number;
    /**
     * Margen del perfil de frenado de referencia (fracción 0-1): más bajo = pide frenar antes y deja
     * más tiempo de reacción. Sin él, `REFERENCE_BRAKE_MARGIN`.
     */
    referenceMargin?: number;
  };
  /** Combustible = (base + porGravedad × g) × (1 + kg cargados aquí / massRefKg). */
  takeOff: { baseFuel: number; fuelPerMps2: number; massRefKg: number };
  suit: {
    o2DrainPctPerS: number;
    lowO2Pct: number;
    criticalO2Pct: number;
    carryCapacityKg: number;
    collectRangeM: number;
    airlockRangeM: number;
    /** Antitrampas: distancia máxima por segundo que acepta `set-position`. */
    maxMoveSpeedMps: number;
    /** O2 de la nave (puntos %) que cuesta rellenar el traje de 0 a 100 al salir (proporcional). */
    refillShipO2PctPerTank: number;
    /** El relleno nunca deja el O2 de la nave por debajo de este nivel: se sale con lo que haya. */
    refillMinShipO2Pct: number;
    /** O2 de la nave que cuesta cada ciclo de esclusa al salir, aunque el traje vaya lleno (trocear sale caro). */
    airlockCycleShipO2Pct?: number;
  };
  jetpack: { drainPctPerS: number; rechargePctPerS: number };
  falls: { harmlessMps: number; o2LossPctPerMps: number; lethalMps: number };
  /** `decayPerS`: segundos de agrietado que se recuperan por segundo sin nadie encima (no se reinicia). */
  terrain: { collapseS: number; decayPerS: number };
  value: { distanceBonus: number; dangerBonus: number; dangerMarginM: number };
  /**
   * Racha: cada unidad de material con `streak` que el tripulante ya lleva encima sube el valor de la siguiente de ese tipo
   * (`1 + min(maxBonus, bonusPerUnit × unidades)`). Se consolida al guardar en la nave y se pierde al morir.
   */
  streak: { bonusPerUnit: number; maxBonus: number };
  /**
   * Soporte vital de la nave en `landing`/`surface`: cubre el consumo de quien está a bordo, pero del
   * excedente solo regenera esta fracción (0 = el O₂ gastado en rellenar trajes no vuelve hasta despegar).
   * Sin él, regenera como en vuelo.
   */
  shipO2?: { surfaceSurplusRegenMult: number };
}

export interface SurfaceCatalog {
  rules: SurfaceRules;
  materials: MaterialDef[];
  worlds: WorldDef[];
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

/**
 * `won` = sector superado, a la espera de `next-sector`.
 * `landing` = descenso a la superficie del nodo actual; `surface` = posada (fase 2).
 */
export type RunPhase = 'docked' | 'transit' | 'landing' | 'surface' | 'won' | 'lost';
/** `crew` = muere toda la tripulación en la superficie. */
export type LossReason = 'hull' | 'oxygen' | 'stranded' | 'crew';

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
  /** Bodega: unidades por id de material (los raros se venderán en la fase 3). */
  cargo: Record<string, number>;
}

/** Tripulante. En solitario hay uno; la fase 4 tendrá hasta cuatro. */
export interface CrewMember {
  id: number;
  alive: boolean;
  deathCause: 'oxygen' | 'fall' | null;
  /** `ship` = a bordo; `eva` = fuera, en la superficie. */
  location: 'ship' | 'eva';
  suitO2Pct: number;
  jetpackPct: number;
  /** Posición relativa a la nave (m), informada por el cliente. */
  x: number;
  z: number;
  grounded: boolean;
  /** Lo que lleva encima (unidades por material); se pierde si muere. */
  carried: Record<string, number>;
  carriedKg: number;
  carriedValue: number;
  /** Puntos que lleva encima por material (para repartir el valor al guardar y al soltar). */
  carriedValues: Record<string, number>;
  /** Segundos de la salida en curso. */
  evaS: number;
  /** Antitrampas: metros que aún puede moverse (se recarga a `maxMoveSpeedMps`). */
  moveBudgetM: number;
  /** Aviso de O2 del traje ya dado: 0 ninguno, 1 bajo, 2 crítico. */
  o2Alert: number;
  /** Unidades que lleva encima (todas las de `carried`). */
  carriedUnits: number;
  /** Unidades de materiales con racha (`MaterialDef.streak`) que lleva encima. */
  streakUnits: number;
  /** Multiplicador de racha que recibirá la PRÓXIMA unidad con racha que recoja (1 = sin racha). */
  streakMult: number;
}

export interface UnstableZone {
  id: number;
  x: number;
  z: number;
  radiusM: number;
  /** Segundos de agrietado acumulados: suben con alguien encima y bajan poco a poco sin nadie. */
  crackingS: number;
  collapsed: boolean;
  /** Alguien la pisa ahora mismo (en el suelo, no en jetpack). */
  pressed: boolean;
}

export interface Deposit {
  id: number;
  materialId: string;
  x: number;
  z: number;
  /** Unidades que quedan. */
  units: number;
  /** Puntos por unidad (ya con distancia y peligro). */
  valuePerUnit: number;
  /** Avance 0-1 de la unidad en curso. */
  progress: number;
  /** Está dentro o al borde de terreno inestable. */
  risky: boolean;
}

export interface PlannedStorm {
  /** Segundos desde el aterrizaje. */
  startS: number;
  endS: number;
  intensity: number;
}

export interface StormStatus {
  active: boolean;
  intensity: number;
  /** Segundos hasta la próxima (null = no hay más). */
  nextInS: number | null;
  /** Segundos hasta que acabe la activa (null = no hay). */
  endsInS: number | null;
  /** La próxima ya está avisada. */
  warned: boolean;
}

export interface DescentState {
  altitudeM: number;
  /** Velocidad de caída (positiva hacia abajo). */
  speedMps: number;
  brake: boolean;
  brakeS: number;
  fuelUsed: number;
}

export interface SurfaceState {
  nodeId: string;
  worldId: string;
  gravityMps2: number;
  radiusM: number;
  /** Solo durante `landing`. */
  descent: DescentState | null;
  touchdownSpeedMps: number | null;
  hardLanding: boolean;
  /** Segundos en tierra (desde el contacto). */
  elapsedS: number;
  storms: PlannedStorm[];
  storm: StormStatus;
  /** Índice en `storms` de la próxima tormenta cuyo aviso/inicio/fin queda por emitir. */
  stormCursor: number;
  zones: UnstableZone[];
  deposits: Deposit[];
  /** Guardado en la bodega en este mundo y aún en ella (cuenta para el despegue y `jettison`). */
  loaded: Record<string, number>;
  loadedKg: number;
  loadedValue: number;
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
  landings: number;
  hardLandings: number;
  evas: number;
  evaTimeS: number;
  materialsCollected: number;
  materialsStored: number;
  /** Puntos de los materiales guardados a bordo (neto de lo soltado). */
  materialsValue: number;
  crewLost: number;
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
  /** Nodos del sector actual en los que ya se aterrizó (una vez por nodo). */
  landedIds: string[];
  crew: CrewMember[];
  surface: SurfaceState | null;
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
  | 'descent'
  | 'landing'
  | 'airlock'
  | 'material-collected'
  | 'cargo-stored'
  | 'storm-warning'
  | 'storm-start'
  | 'storm-end'
  | 'terrain-warning'
  | 'terrain-collapsed'
  | 'suit-o2'
  | 'suit-damaged'
  | 'crew-dead'
  | 'take-off'
  | 'jettison'
  | 'lost';

export type EventTone = 'info' | 'ok' | 'warn' | 'bad';

/**
 * Subtipo explícito de algunos eventos (para que el cliente no dependa de `tone` ni de la clave):
 * `landing` soft/hard · `suit-o2` low/critical · `airlock` exit/enter · `crew-dead` oxygen/fall ·
 * `cargo-stored` stored/processed.
 */
export type RunEventSubtype = 'soft' | 'hard' | 'low' | 'critical' | 'exit' | 'enter' | 'oxygen' | 'fall' | 'stored' | 'processed';

export interface RunEvent {
  id: number;
  type: RunEventType;
  tS: number;
  tone: EventTone;
  message: MessageRef;
  systemId?: SystemId;
  incidentKind?: IncidentKind;
  crewId?: number;
  subtype?: RunEventSubtype;
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
  | { type: 'next-sector' }
  // Superficie (fase 2). `crewId` por defecto: el primer tripulante vivo.
  | { type: 'land' }
  | { type: 'set-descent-brake'; on: boolean }
  | { type: 'eva-exit'; crewId?: number }
  | { type: 'eva-enter'; crewId?: number }
  /** Silenciosa: posición relativa a la nave (m) y si pisa el suelo. */
  | { type: 'set-position'; x: number; z: number; grounded: boolean; crewId?: number }
  | { type: 'jetpack'; seconds: number; crewId?: number }
  | { type: 'fall-impact'; speedMps: number; crewId?: number }
  | { type: 'collect'; depositId: number; seconds: number; crewId?: number }
  /** Suelta lo guardado en la bodega en este mundo. */
  | { type: 'jettison' }
  | { type: 'take-off' };

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

/** Antes de aterrizar en el nodo actual. */
export interface LandingEstimate {
  nodeId: string;
  worldId: string;
  gravityMps2: number;
  /** Descenso con el perfil de frenado de referencia. */
  descentFuel: number;
  descentTimeS: number;
  /** Despegue con la bodega vacía. */
  takeOffFuel: number;
  totalFuel: number;
  /** Cubre descenso de referencia + despegue en vacío (requisito de `land`, junto a motores en línea). */
  canLand: boolean;
  /** Cubre descenso + despegue. */
  enoughFuel: boolean;
  alreadyLanded: boolean;
}

export interface TakeOffEstimate {
  fuel: number;
  fuelEmpty: number;
  loadedKg: number;
  enoughFuel: boolean;
  enoughFuelEmpty: boolean;
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
  /** Atracada en un nodo aterrizable: coste de descenso y despegue. */
  estimateLanding(): LandingEstimate | null;
  /** En superficie: coste del despegue ahora (con lo cargado aquí) y en vacío. */
  estimateTakeOff(): TakeOffEstimate | null;
  /** Copia profunda del estado (tests, red). */
  snapshot(): RunState;
}

export interface RunOptions {
  seed: number;
  shipId?: string;
  catalog?: Catalog;
  /** Tripulantes (1 en solitario; la fase 4 usará hasta 4). */
  crewSize?: number;
}
