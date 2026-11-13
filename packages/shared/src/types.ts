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
    /** Esquiva por habilidad (el cliente informa los roces). Sin ella, `evade` anula el impacto entero. */
    evade?: EvadeRules;
  };
  wear: { chancePerS: number; weights: Record<IncidentKind, number> };
  repair: { kitRepairS: number; kitRestorePct: number };
  alerts: { lowOxygenPct: number; lowFuelPct: number; lowHullPct: number };
  maxIncidents: number;
}

/**
 * Esquiva por habilidad: el cliente simula el minijuego y envía `evade { grazes }`; el motor cobra.
 * Daño = 0 con 0 roces, `grazes × grazeDamageFrac` con algunos y `failDamageFrac` con `maxGrazes` (fallo).
 */
export interface EvadeRules {
  maxGrazes: number;
  /** Fracción del daño del impacto (casco, sistema, desgaste de escudos) por cada roce. */
  grazeDamageFrac: number;
  /** Fracción del daño con `maxGrazes` roces: el impacto entra casi entero (y puede abrir una fuga). */
  failDamageFrac: number;
  /** Dificultad 0-1 del minijuego = base + porSector × (sector − 1) + porGravedad × gravedad del impacto. */
  difficultyBase: number;
  difficultyPerSector: number;
  difficultyFromSeverity: number;
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
  /**
   * OBSOLETO desde la fase 3 (ADR 0014): el servicio gratuito desaparece. Si un catálogo antiguo lo
   * declara, el tipo cuenta como estación con terminal (`shop`); sus cifras se ignoran.
   */
  service?: { refuel: boolean; hullRepair: number; spares: number };
  /** Fase 3: hay terminal de estación (venta, suministros de pago, ayuda de emergencia y mejoras). */
  shop?: boolean;
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
  /**
   * Fase 3: precios, ayuda de emergencia y masa → combustible (`catalog/economia.json`). Opcional en el
   * JSON (`parseCatalog` pone el de por defecto), así que tras validar siempre está presente.
   */
  economy?: EconomyRules;
  /** Fase 3: mejoras de nave y equipo (`catalog/mejoras.json`). Igual que `economy`: siempre presente tras validar. */
  upgrades?: UpgradeDef[];
}

// ─── Economía y mejoras (fase 3, ADR 0014) ───────────────────────────────────

/** Suministros que vende la terminal de estación. */
export const SUPPLY_IDS = ['fuel', 'hull', 'spares'] as const;
export type SupplyId = (typeof SUPPLY_IDS)[number];

export interface EconomyRules {
  /** Créditos al empezar la partida. */
  startCredits: number;
  /** Pago del contrato al superar cada sector (× multiplicador de venta del sector). */
  sectorRewardCredits: number;
  /**
   * Multiplicador por sector: precio × (1 + porSector × (sector − 1)). `sell` se aplica a la venta de
   * carga y al contrato; `buy`, a suministros y mejoras.
   */
  sectorPriceMult: { sellPerSector: number; buyPerSector: number };
  /** Créditos por unidad de cada material (id → precio base). Lo que no está aquí no se puede vender. */
  sellPrices: Record<string, number>;
  /** Precio base por unidad de combustible, por punto de casco y por repuesto. */
  supplyPrices: Record<SupplyId, number>;
  /**
   * Ayuda de emergencia (acción `service`), gratis y una vez por estación: sube el combustible hasta
   * `fuelPct` % del depósito, el casco hasta `hullPct` % y los repuestos hasta `minSpares`. Evita que
   * llegar sin créditos ni carga sea una muerte segura.
   */
  emergency: { fuelPct: number; hullPct: number; minSpares: number };
  /** Combustible de cada salto × (1 + masa a bordo (carga + mejoras) / `massRefKg`). */
  cargoFuel: { massRefKg: number };
  /** Mejoras distintas que ofrece cada estación (subconjunto determinista por semilla y nodo). */
  offer: { size: number };
}

/** Qué ajusta una mejora: la nave (`ShipDef`), el traje, el jetpack o las caídas (`SurfaceRules`). */
export const UPGRADE_TARGETS = ['ship', 'suit', 'jetpack', 'falls'] as const;
export type UpgradeTarget = (typeof UPGRADE_TARGETS)[number];

/** Campos numéricos que puede tocar una mejora en cada objetivo. */
export const UPGRADE_FIELDS: Record<UpgradeTarget, readonly string[]> = {
  ship: [
    'hullMax', 'fuelCapacity', 'maxSpares', 'reactorOutputKw', 'cruiseSpeedLyPerS', 'fuelPerLy', 'damagedEngineFuelPenalty', 'evadeFuel',
    'crewO2UsePctPerS', 'o2RegenPctPerS', 'shieldAbsorb', 'shieldWearPctPerHit', 'overloadReactorDamagePctPerS',
    'systemDrawKw.engines', 'systemDrawKw.lifeSupport', 'systemDrawKw.shields', 'systemDrawKw.nav',
  ],
  suit: ['o2DrainPctPerS', 'carryCapacityKg', 'refillShipO2PctPerTank', 'airlockCycleShipO2Pct', 'collectRangeM'],
  jetpack: ['drainPctPerS', 'rechargePctPerS'],
  falls: ['harmlessMps', 'o2LossPctPerMps', 'lethalMps'],
};

/**
 * Cambio numérico: valor × `mult` + `add` (primero el multiplicador). `field` es un campo numérico del
 * objetivo; en la nave admite `systemDrawKw.<sistema>`.
 */
export interface UpgradeEffect {
  target: UpgradeTarget;
  field: string;
  add?: number;
  mult?: number;
}

export interface UpgradeLevelDef {
  /** Precio base (× multiplicador de compra del sector). */
  price: number;
  /** Masa que añade a la nave: encarece cada salto como la carga (`economy.cargoFuel`). */
  massKg: number;
  effects: UpgradeEffect[];
}

/** Mejora con niveles que se compran en orden. Ids kebab-case; nombre en `catalog.<id>`. */
export interface UpgradeDef {
  id: string;
  name: LocalizedText;
  levels: UpgradeLevelDef[];
}

/** Lo que muestra la terminal de la estación en la que está atracada la nave (`Run.stationQuote`). */
export interface StationQuote {
  nodeId: string;
  credits: number;
  /** Multiplicadores de precio del sector actual. */
  sellMult: number;
  buyMult: number;
  /** Carga vendible: unidades, precio por unidad y total, por material. */
  sell: { materialId: string; units: number; unitPrice: number; total: number }[];
  sellTotal: number;
  /** Por suministro: precio por unidad, lo que falta para el máximo, lo que se puede pagar y el coste de llenarlo. */
  supplies: Record<SupplyId, { unitPrice: number; missing: number; affordable: number; fillCost: number }>;
  /** Ayuda de emergencia: si aún está disponible aquí y lo que daría ahora. */
  emergency: { available: boolean; fuel: number; hull: number; spares: number };
  /** Mejoras que ofrece esta estación (subconjunto determinista) con su siguiente nivel (null = al máximo). */
  upgrades: {
    upgradeId: string;
    level: number;
    maxLevel: number;
    nextLevel: number | null;
    price: number | null;
    massKg: number;
    affordable: boolean;
    /**
     * Cambio que traería el siguiente nivel en el margen eléctrico a crucero con todo encendido (potencia del reactor
     * sano − demanda, kW; ver `cruisePowerMarginKw`). Negativo = consume margen. 0 si está al máximo.
     */
    powerMarginDeltaKw: number;
    /** Con el siguiente nivel, la demanda a crucero con todo encendido superaría al reactor sano (sobrecarga). */
    overloadsAtCruise: boolean;
  }[];
}

// ─── Superficie (fase 2) ────────────────────────────────────────────────────

/** Material que se recoge en superficie. Ids kebab-case; nombre en `catalog.<id>`. */
export interface MaterialDef {
  id: string;
  name: LocalizedText;
  /** Puntos base por unidad guardada a bordo (crece con la distancia y el peligro). */
  value: number;
  massKg: number;
  /** Segundos que tarda su herramienta (con `speedMult` 1) en extraer una unidad. */
  collectS: number;
  /** Herramienta que lo extrae (`SurfaceCatalog.tools`): el hielo se sublima, lo demás se perfora. */
  tool: string;
  /** Suministros que rinde cada unidad al guardarla en la nave (limitados por su capacidad). */
  yields?: { fuel?: number; spares?: number };
  /** Suma racha (solo lo raro): cada unidad de este tipo que se lleva encima revaloriza la siguiente. */
  streak?: boolean;
}

/**
 * Herramienta desplegable: se coloca sobre una veta y extrae sola a paso fijo. Ids kebab-case; nombre
 * en `catalog.<id>`.
 */
export interface ToolDef {
  id: string;
  name: LocalizedText;
  /** Cuántas lleva cada tripulante al empezar cada aterrizaje (se reponen en el siguiente). */
  perCrew: number;
  /** Se detiene con tormenta activa (el concentrador solar necesita sol) y sigue al pasar. */
  stopsInStorm: boolean;
  /** Ritmo: segundos por unidad = `material.collectS / speedMult`. */
  speedMult: number;
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
  /**
   * Filones: lo raro (materiales con `streak`) se agrupa en filones de `size` vetas a `spacingM` metros de
   * la primera. Sin él, cada veta va por su lado.
   */
  lodes?: {
    size: Range;
    spacingM: Range;
    /**
     * Completar el filón: las unidades de su última veta valen ×`completeMult` si el mismo tripulante agotó
     * las demás vetas del filón en esta salida (filones de 2+ vetas). Sin él, no hay bonus.
     */
    completeMult?: number;
  };
}

export interface SurfaceCatalog {
  rules: SurfaceRules;
  tools: ToolDef[];
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
  /** Solo si se esquivó informando roces: fracción del daño que entra igualmente (0 = limpia). */
  evadeDamageFrac?: number;
}

/** Impacto anunciado por los sensores (requiere navegación en línea). */
export interface ImpactWarning {
  hazardId: number;
  /** Segundos hasta el impacto (tiempo disponible para el minijuego de esquiva). */
  etaS: number;
  evaded: boolean;
  /** Semilla determinista del minijuego de esquiva de este impacto (misma partida = mismo campo de rocas). */
  evadeSeed?: number;
  /** Dificultad 0-1 del minijuego (más densidad en sectores altos y con impactos más fuertes). */
  evadeDifficulty?: number;
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
  /** Bodega: unidades por id de material (se venden en las estaciones, fase 3). */
  cargo: Record<string, number>;
  /** Fase 3, derivado: masa a bordo que encarece los saltos (bodega + mejoras), en kg. */
  cargoKg?: number;
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
  /** Herramientas en la mochila por id (se reponen a `ToolDef.perCrew` en cada aterrizaje). */
  tools: Record<string, number>;
  /** Vetas de filón que este tripulante ha agotado (recogido hasta la última unidad) en la salida en curso. */
  lodeVeinsDone: number[];
}

/** Avance de un filón para un tripulante en la salida en curso (ver `lodeProgress`). */
export interface LodeProgress {
  lodeId: number;
  /** Vetas del filón. */
  total: number;
  /** Vetas que este tripulante ha agotado en esta salida. */
  done: number;
  /** La veta que queda daría el bonus de filón completo (todas las demás agotadas por él en esta salida). */
  bonusReady: boolean;
}

/** Por qué está parada una herramienta colocada (null = extrayendo). */
export type ToolStop = 'storm' | 'depleted';

/** Herramienta colocada sobre una veta. Extrae sola; lo extraído espera en ella hasta que se recoge. */
export interface PlacedTool {
  id: number;
  toolId: string;
  depositId: number;
  materialId: string;
  x: number;
  z: number;
  /** Avance 0-1 de la unidad en curso. */
  progress: number;
  /** Unidades extraídas, listas para recoger (`collect`). */
  ready: number;
  stopped: ToolStop | null;
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
  /** Filón al que pertenece (vetas raras agrupadas a pocos metros); ausente si no está en ninguno. */
  lodeId?: number;
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
  /** Herramientas colocadas en este mundo. */
  tools: PlacedTool[];
  /** Herramientas perdidas en este aterrizaje (se quedaron fuera cuando no quedaba nadie fuera). */
  toolsLost: Record<string, number>;
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
  /** Esquivas con roces (daño parcial); las que fallan del todo cuentan en `impactsTaken`. */
  impactsGrazed?: number;
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
  /** Fase 3: créditos ganados (venta y contratos) y gastados (suministros y mejoras). */
  creditsEarned?: number;
  creditsSpent?: number;
  /** Fase 3: unidades de carga vendidas. */
  unitsSold?: number;
  /** Fase 3: niveles de mejora comprados. */
  upgradesBought?: number;
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
  /** Fase 3: créditos disponibles (enteros). */
  credits: number;
  /** Fase 3: nivel comprado de cada mejora (id → nivel; 1 = primer nivel). */
  upgrades: Record<string, number>;
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
  | 'tool-placed'
  | 'tool-done'
  | 'tool-stopped'
  | 'tool-resumed'
  | 'tool-lost'
  // Fase 3: economía
  | 'sale'
  | 'purchase'
  | 'upgrade'
  | 'reward'
  | 'lost';

export type EventTone = 'info' | 'ok' | 'warn' | 'bad';

/**
 * Subtipo explícito de algunos eventos (para que el cliente no dependa de `tone` ni de la clave):
 * `landing` soft/hard · `suit-o2` low/critical · `airlock` exit/enter · `crew-dead` oxygen/fall ·
 * `cargo-stored` stored/processed.
 */
export type RunEventSubtype =
  | 'soft' | 'hard' | 'low' | 'critical' | 'exit' | 'enter' | 'oxygen' | 'fall' | 'stored' | 'processed'
  // esquiva: `impact-evaded` clean · `impact-hit` graze/failed
  | 'clean' | 'graze' | 'failed'
  // herramientas: `tool-stopped` storm · `tool-lost` left
  | 'storm' | 'left'
  // `material-collected` lode: piezas de la última veta de un filón completado (llevan el bonus)
  | 'lode'
  // `purchase` fuel/hull/spares (fase 3)
  | 'fuel' | 'hull' | 'spares';

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
  /**
   * Sin `grazes`: anula el impacto (compatibilidad). Con `grazes` (roces del minijuego, se redondea y
   * recorta a 0..maxGrazes): el impacto entra con esa fracción del daño.
   */
  | { type: 'evade'; grazes?: number }
  /** Fase 3: ayuda de emergencia gratuita (una vez por estación; ver `EconomyRules.emergency`). */
  | { type: 'service' }
  /**
   * Fase 3, atracada en una estación: vende carga. Sin `materialId`, toda la bodega; con él, `units`
   * unidades de ese material (sin `units`, todas).
   */
  | { type: 'sell'; materialId?: string; units?: number }
  /**
   * Fase 3, atracada en una estación: compra un suministro. `amount` = unidades de combustible, puntos de
   * casco o repuestos; sin él, hasta el máximo. Se compra lo que quepa y se pueda pagar (al menos 1).
   */
  | { type: 'buy-supply'; supply: SupplyId; amount?: number }
  /** Fase 3, atracada en una estación que la ofrezca: compra el siguiente nivel de la mejora. */
  | { type: 'buy-upgrade'; upgradeId: string }
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
  /** Coloca la herramienta que corresponde al material de la veta (en alcance, con los pies en el suelo). */
  | { type: 'deploy-tool'; depositId: number; crewId?: number }
  /**
   * Recoge al instante lo ya extraído por la herramienta de esa veta (lo que quepa). Si la veta está
   * agotada y no queda nada extraído, la herramienta vuelve sola a la mochila. `seconds` se ignora
   * (queda por compatibilidad).
   */
  | { type: 'collect'; depositId: number; seconds?: number; crewId?: number }
  /** Retira la herramienta de esa veta: recoge lo que quepa y lo que no, vuelve a la veta. */
  | { type: 'retrieve-tool'; depositId: number; crewId?: number }
  /** Suelta lo guardado en la bodega en este mundo. */
  | { type: 'jettison' }
  | { type: 'take-off' };

export type ActionResult = { ok: true } | { ok: false; reason: MessageRef };

export interface JumpEstimate {
  toId: string;
  distanceLy: number;
  /** Fase 3: masa a bordo (bodega + mejoras) y su multiplicador del combustible (ya incluido en `byThrottle`). */
  cargoKg?: number;
  cargoFuelMult?: number;
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
  /** Fase 3: la nave con las mejoras compradas (la que usa el motor). Objeto vivo: no lo mutes. */
  effectiveShip(): ShipDef;
  /** Fase 3: reglas de superficie con las mejoras de traje, jetpack y caídas (las que usa el motor). Objeto vivo: no lo mutes. */
  effectiveSurfaceRules(): SurfaceRules;
  /** Fase 3: atracada en una estación con terminal, precios y ofertas; si no, null. */
  stationQuote(): StationQuote | null;
}

export interface RunOptions {
  seed: number;
  shipId?: string;
  catalog?: Catalog;
  /** Tripulantes (1 en solitario; la fase 4 usará hasta 4). */
  crewSize?: number;
}
