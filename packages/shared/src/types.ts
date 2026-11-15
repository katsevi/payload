/**
 * CONTRATO DE DOMINIO DE PAYLOAD (v2: tripulación de exploración, ver docs/adr/0011)
 * ------------------------------------------------------------------
 * Contrato entre el motor (packages/shared), el cliente (apps/client) y, en la fase 6, el
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
  /**
   * Fase 4 (ADR 0016): potencia de los paneles solares a 1 UA del Sol (kW). Baja con 1/d² según la
   * distancia de la nave al Sol (`RunState.sunDistanceAu`) y se suma a `reactorOutputKw` (la parte
   * nuclear, que no depende de la distancia). Ausente = 0 (naves del catálogo).
   */
  solarKwAt1Au?: number;
  /** Fase 4: masa en seco de la nave diseñada (kg); informativa (ya está aplicada a `fuelPerLy`). */
  dryMassKg?: number;
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
  /**
   * Fase 4 (ADR 0016): reglas del diseño de misión (`catalog/misiones.json`, `rules`). Igual que `economy`:
   * opcional en el JSON y siempre presente tras `parseCatalog`. Lo mismo vale para los cinco campos siguientes.
   */
  design?: DesignRules;
  /** Fase 4: objetivos de misión (`catalog/misiones.json`). */
  missions?: MissionDef[];
  /** Fase 4: módulos de nave para el diseño (`catalog/modulos.json`). */
  modules?: ModuleDef[];
  /** Fase 4: instrumentos científicos (`catalog/instrumentos.json`). */
  instruments?: InstrumentDef[];
  /** Fase 4: lanzadores (`catalog/lanzadores.json`). */
  launchers?: LauncherDef[];
  /** Fase 4: cuerpos reales, zonas y reglas de la ruta (`catalog/sistema-solar.json`). */
  solarSystem?: SolarSystemDef;
  /** Fase 6: roles de tripulación y sus ventajas pasivas (`catalog/roles.json`). Siempre presente tras validar. */
  roles?: RoleDef[];
  /** Fase 5 (ADR 0018): datos, ventanas de contacto y puntuación de la ciencia (`catalog/ciencia.json`). Siempre presente tras validar. */
  science?: ScienceRules;
  /** Fase 8: reglas de cordura de la tripulación (`catalog/cordura.json`). Opcional: sin él (o con `enabled: false`) el juego es el de siempre. */
  psych?: PsychRules;
}

// ─── Roles de tripulación (fase 6, ADR 0017) ─────────────────────────────────

export const ROLE_IDS = ['pilot', 'engineer', 'manager', 'explorer'] as const;
/** Rol de un tripulante en cooperativo. Solo da ventajas pasivas: ningún puesto se bloquea por rol. */
export type RoleId = (typeof ROLE_IDS)[number];

/** Ventajas pasivas de un rol. Solo se aplican a las acciones que llevan el `crewId` de quien lo tiene. */
export interface RolePerks {
  /** Piloto: multiplicador del combustible de la maniobra evasiva. */
  evadeFuelMult?: number;
  /** Piloto: multiplicador del daño que entra tras una esquiva con roces. */
  evadeDamageMult?: number;
  /** Ingeniero: multiplicador del trabajo en averías y reparaciones con repuesto. */
  repairSpeedMult?: number;
  /** Explorador: multiplicador de la capacidad de la mochila. */
  carryCapacityMult?: number;
  /** Explorador: multiplicador del gasto del jetpack. */
  jetpackDrainMult?: number;
  /** Fase 8, gestor: multiplicador del drenaje de cordura del resto de la tripulación (vivo y a bordo). */
  sanityAuraMult?: number;
  /** Fase 8, gestor: multiplicador de su propia recuperación por descanso y llamada. */
  sanityRecoverMult?: number;
}

/** Rol de tripulación. Nombre en `catalog.<id>`. */
export interface RoleDef {
  id: RoleId;
  name: LocalizedText;
  perks: RolePerks;
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
export const UPGRADE_TARGETS = ['ship', 'suit', 'jetpack', 'falls', 'crew'] as const;
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
  /** Fase 8: reglas de cordura (`PsychRules`), ver `effectivePsychRules`. */
  crew: ['sanityDrainMult', 'restRecoverPctPerS', 'callRecoverPct', 'callCooldownS', 'sleepPenalty', 'monotonyMax', 'stationRecoverCapPct'],
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
  /** Fase 8 (solo con `psych.enabled`): provisiones frescas (precio por unidad, huecos en la despensa y unidades pagables). */
  provisions?: { unitPrice: number; missing: number; affordable: number };
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
  /**
   * Fase 4 (mapa del sistema solar): cuerpo real o estación del catálogo (`catalog/sistema-solar.json`).
   * Su nombre localizado es `catalog.<bodyId>`; `name` lleva el español como respaldo. Ausente en los
   * puntos de paso generados y en los sectores abstractos.
   */
  bodyId?: string;
  /** Fase 4: distancia al Sol (UA). Ausente = 1 (sectores abstractos). */
  sunDistanceAu?: number;
  /** Fase 4: es el destino de la misión diseñada. */
  missionTarget?: boolean;
}

export interface SectorMap {
  /** 1 = primer sector. */
  index: number;
  hazardMult: number;
  nodes: SectorNode[];
  startId: string;
  goalId: string;
  /** Fase 4: tramo del sistema solar (zona de salida y de llegada, ids de `SolarZoneDef`). */
  zoneFromId?: string;
  zoneToId?: string;
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
  /** Fase 8: `crewId` que han trabajado en esta avería (cohesión por reparar en grupo). */
  workers?: number[];
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
  /** Fase 4, derivado: parte de `powerSupplyKw` que dan los paneles solares a la distancia actual (solo con diseño). */
  solarSupplyKw?: number;
  /**
   * Fase 5 (solo con diseño): carga y capacidad de la batería (kWh). Mientras tiene carga cubre el déficit de una
   * sobrecarga y el reactor no se daña; se recarga con el excedente.
   */
  batteryKwh?: number;
  batteryMaxKwh?: number;
  /** Fase 5 (solo con diseño): calor que disipan los radiadores (kW) y si la demanda lo supera ahora (el reactor se desgasta). */
  heatRejectKw?: number;
  overheated?: boolean;
}

/** Tripulante. En solitario hay uno; la fase 6 tendrá hasta cuatro. */
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
  /** Fase 6: rol en cooperativo (ausente en solitario: sin ventajas). */
  role?: RoleId;
  /** Fase 8 (solo con `psych.enabled`): cordura 0-100. */
  sanityPct?: number;
  /** Fase 8: banda actual (en el estado para conservar la histéresis). */
  sanityBand?: SanityBand;
  /** Fase 8: segundos sin descanso eficaz. */
  awakeS?: number;
  /** Fase 8: hasta qué `stats.timeS` sigue en la litera. */
  restUntilS?: number;
  /** Fase 8: progreso (s) de la llamada en curso. */
  callProgressS?: number;
  /** Fase 8: fin del enfriamiento de la llamada. */
  callCooldownUntilS?: number;
  /** Fase 8: fin del enfriamiento entre lapsus. */
  lapseCooldownUntilS?: number;
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
  /** Fase 5 (solo con diseño): ciencia entregada en la Tierra y los puntos que da (incluido el bonus de éxito). */
  scienceDelivered?: number;
  sciencePoints?: number;
  /** Fase 8: segundos-tripulante en banda crítica o de quiebre, segundos-tripulante descansando, llamadas, unidades de provisiones gastadas y lapsus. */
  sanityCriticalS?: number;
  restS?: number;
  callsMade?: number;
  provisionsUsed?: number;
  lapses?: number;
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
  /** Fase 4: diseño con el que se creó la partida (mapa del sistema solar y nave diseñada). Ausente = partida clásica. */
  missionDesign?: MissionDesign;
  /** Fase 4, derivado (solo con diseño): distancia actual de la nave al Sol (UA); en tránsito, interpolada. */
  sunDistanceAu?: number;
  /** Fase 5 (ADR 0018, solo con diseño): datos científicos, enlace con la Tierra y estado de la misión. */
  science?: ScienceState;
  /** Fase 8: estado de partida de la cordura (solo con `catalog.psych.enabled`). */
  psych?: PsychState;
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
  // Fase 5: ciencia y datos
  | 'observation-done'
  | 'storage-full'
  | 'contact-start'
  | 'objective-met'
  | 'mission-complete'
  | 'overheat'
  | 'battery-empty'
  // Fase 8: cordura de la tripulación
  | 'crew-sanity'
  | 'crew-rest'
  | 'earth-call'
  | 'crew-lapse'
  | 'cohesion'
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
  | 'fuel' | 'hull' | 'spares'
  // `mission-complete` success/partial (fase 5)
  | 'success' | 'partial'
  // Fase 8: `crew-sanity` tense/critical/breakdown/recovered · `crew-lapse` switch/drop · `crew-rest` start/done · `cohesion` low/recovered
  | 'tense' | 'breakdown' | 'recovered' | 'switch' | 'drop' | 'start' | 'done';

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
  // Fase 6: `crewId` (opcional) dice quién actúa, para aplicar la ventaja de su rol. Sin él, sin ventaja.
  | { type: 'work-incident'; incidentId: number; seconds: number; crewId?: number }
  | { type: 'repair-system'; systemId: SystemId; seconds: number; crewId?: number }
  /**
   * Sin `grazes`: anula el impacto (compatibilidad). Con `grazes` (roces del minijuego, se redondea y
   * recorta a 0..maxGrazes): el impacto entra con esa fracción del daño.
   */
  | { type: 'evade'; grazes?: number; crewId?: number }
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
  /** Fase 8: descansa en la litera (trabajo mantenido, recortado a `MAX_WORK_SECONDS`). */
  | { type: 'rest'; seconds: number; crewId?: number }
  /** Fase 8: llamada a la Tierra (trabajo mantenido; se completa a los `call.seconds` acumulados). */
  | { type: 'call-earth'; seconds: number; crewId?: number }
  /** Fase 8, atracada en una estación: compra provisiones frescas (por defecto hasta llenar la despensa). */
  | { type: 'buy-provisions'; amount?: number }
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
  /**
   * Fase 6: sustituye el estado por una copia recibida por red (espejo del cliente en cooperativo), para que
   * las consultas (`estimateJump`, `stationQuote`, nave efectiva…) den lo mismo que en el servidor. No restaura
   * los flujos de azar ni los contadores internos: una partida hidratada NO debe avanzarse con `step`/`apply`.
   */
  hydrate(state: RunState): void;
}

export interface RunOptions {
  seed: number;
  shipId?: string;
  catalog?: Catalog;
  /** Tripulantes (1 en solitario; la fase 6 usará hasta 4). */
  crewSize?: number;
  /**
   * Fase 4 (ADR 0016): misión diseñada. Con él, la nave sale de `shipFromDesign` (se ignora `shipId`) y el
   * mapa es el sistema solar (`generateSolarSector`). Sin él, la partida es la clásica de las fases 1-3.
   */
  design?: MissionDesign;
  /** Fase 6: rol de cada tripulante, por orden (`null` o ausente = sin rol). */
  roles?: (RoleId | null)[];
}

// ─── Diseño de misión y sistema solar (fase 4, ADR 0016) ─────────────────────

/** Tipos de ciencia: qué estudia un instrumento y qué pide un objetivo de misión. */
export const SCIENCE_KINDS = ['geology', 'ice', 'atmosphere', 'fields', 'interior', 'life'] as const;
export type ScienceKind = (typeof SCIENCE_KINDS)[number];

/** Familias de módulos de nave. `structure` y `propulsion` van una sola vez; el resto se puede repetir. */
export const MODULE_KINDS = [
  'structure', 'propulsion', 'solar', 'nuclear', 'battery', 'comms', 'computer', 'attitude', 'thermal', 'tank', 'shielding',
  'lifeSupport', 'workshop', 'habitat', 'greenhouse',
] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/**
 * Módulo de nave. Masa, coste, meses de desarrollo y fiabilidad cuentan en los presupuestos; `effects` dice
 * cómo cambia la nave de la partida (mismos campos que las mejoras: `UPGRADE_FIELDS.ship`). Ids kebab-case;
 * nombre en `catalog.<id>`.
 */
export interface ModuleDef {
  id: string;
  name: LocalizedText;
  kind: ModuleKind;
  massKg: number;
  costMUSD: number;
  devMonths: number;
  /** Probabilidad 0-1 de que funcione toda la misión. */
  reliability: number;
  /** Ranuras de la estructura que ocupa (por defecto 1; la estructura no ocupa). */
  slotsUsed?: number;
  /** Efectos sobre la nave: se suman todos los `add` y se multiplican todos los `mult` (no depende del orden). */
  effects: UpgradeEffect[];
  /** Solo estructura: masa total que aguanta (kg) y ranuras para módulos e instrumentos. */
  maxMassKg?: number;
  slots?: number;
  /** Paneles: potencia a 1 UA (kW); baja con 1/d². La parte nuclear va en `effects` (`reactorOutputKw`). */
  solarKwAt1Au?: number;
  /** Calor que puede disipar (kW): la estructura da algo de serie, los radiadores más. */
  heatRejectKw?: number;
  /** Baterías: energía almacenada (kWh). Informativa (en la partida amortiguan la sobrecarga vía `effects`). */
  batteryKwh?: number;
  /** Comunicaciones: tasa de bajada (Mbps, para la fase 5) y distancia máxima al Sol con enlace (UA). */
  dataRateMbps?: number;
  commsRangeAu?: number;
  /** Computadora: almacenamiento (GB, para la fase 5) y si aguanta la radiación de Júpiter. */
  storageGb?: number;
  radiationHardened?: boolean;
}

/** Instrumento científico. Ocupa ranuras y consume potencia (se suma a `systemDrawKw.nav`). */
export interface InstrumentDef {
  id: string;
  name: LocalizedText;
  scienceKind: ScienceKind;
  massKg: number;
  powerKw: number;
  costMUSD: number;
  devMonths: number;
  reliability: number;
  /** Valor científico (cuenta entero si su tipo lo pide la misión; si no, × `DesignRules.offKindScienceMult`). */
  scienceValue: number;
  /** Fase 5: datos que genera (Mbps mientras observa). */
  dataRateMbps: number;
  slotsUsed?: number;
  /** Fase 5 (ADR 0018 § 8): instrumento a escala de CubeSat (solo para la misión guiada; no sale en la paleta normal). */
  cubesat?: boolean;
}

/** Lanzador (nombres ficticios, cifras inspiradas en lanzadores reales). */
export interface LauncherDef {
  id: string;
  name: LocalizedText;
  costMUSD: number;
  reliability: number;
  /** Meses de espera hasta la ventana de lanzamiento (se suman al calendario). */
  waitMonths: number;
  /** Masa máxima que pone en trayectoria hacia cada zona (id de `SolarZoneDef`); sin la zona = no llega. */
  capacityKgByZone: Record<string, number>;
}

/** Requisitos medibles de un objetivo de misión. */
export interface MissionRequirements {
  /** Ciencia mínima (suma de `scienceValue` de los instrumentos, ver `DesignRules.offKindScienceMult`). */
  minScience: number;
  /** Tipos de ciencia obligatorios: al menos un instrumento de cada uno. */
  requiredKinds: ScienceKind[];
  /** Fiabilidad mínima recomendada (%, producto de módulos, instrumentos y lanzador): por debajo, aviso. */
  minReliabilityPct?: number;
}

export interface MissionDef {
  id: string;
  name: LocalizedText;
  /** Una línea: qué pregunta científica responde. */
  description: LocalizedText;
  /** Tipo de ciencia principal (para el icono). */
  scienceKind: ScienceKind;
  /** Ids de `SolarBodyDef` válidos como destino. */
  destinations: string[];
  requirements: MissionRequirements;
  budgetMUSD: number;
  deadlineMonths: number;
  /** 1 fácil · 2 media · 3 difícil. */
  difficulty: number;
  /** Fase 5 (ADR 0018 § 8): misión guiada (nave, lanzador y destino fijos; solo se elige la carga). */
  guided?: GuidedMissionDef;
}

/** Comprobación automática de un paso de la misión guiada. */
export type GuidedStepCheck = 'instrument' | 'required-kinds' | 'science' | 'go';

/** Misión guiada: lo fijo y los pasos opcionales (una línea cada uno) que se marcan solos. */
export interface GuidedMissionDef {
  /** Módulos de la nave (fijos; el orden no importa). */
  moduleIds: string[];
  launcherId: string;
  /** Instrumentos que se pueden elegir (los de escala CubeSat). */
  instrumentIds: string[];
  steps: { check: GuidedStepCheck; text: LocalizedText }[];
}

/** Reglas del diseño (`catalog/misiones.json`, `rules`). */
export interface DesignRules {
  /** Nave del catálogo de la que parte la nave diseñada (regímenes, soporte vital, consumos de serie…). */
  baseShipId: string;
  /** Nombre de la nave diseñada. */
  shipName: LocalizedText;
  /** Campos de la nave base que se ponen a 0 antes de aplicar los módulos (los aportan ellos). */
  zeroedFields: string[];
  /** Combustible por año luz × (masa / referenceMassKg)^massFuelExponent. */
  referenceMassKg: number;
  massFuelExponent: number;
  /** Margen por debajo del que un recurso está justo (0.15 = 15 %). */
  tightMargin: number;
  /** El desarrollo va en paralelo: el más lento + estos meses por pieza (integración). */
  integrationMonthsPerItem: number;
  /** Valor de un instrumento cuyo tipo no pide la misión (0.5 = la mitad). */
  offKindScienceMult: number;
  /** Fracción del tramo entre zonas que se recorre sin repostar (estación a mitad de tramo). */
  rangeLegFactor: number;
  /** Reserva del depósito que no cuenta para el alcance (%). */
  rangeReservePct: number;
  /** Tope de la absorción de los escudos de la nave diseñada (0-1). */
  maxShieldAbsorb: number;
  /** Fase 5 (ADR 0018 § 6): fiabilidad, calor y batería en vuelo. Opcional (sin él, no tienen efecto). */
  operations?: DesignOperationsRules;
  /** Fase 5 (ADR 0018 § 7): niveles de dificultad (el diseño elige uno con `difficultyId`). */
  difficulties?: DifficultyDef[];
  /** Nivel que se usa si el diseño no dice ninguno (o uno desconocido). */
  defaultDifficultyId?: string;
}

/**
 * Nivel de dificultad (fase 5): multiplica cifras de la misión y de la partida. Todo 1 = la misión tal cual. Nombre en
 * `catalog.<id>`.
 */
export interface DifficultyDef {
  id: string;
  name: LocalizedText;
  /** Presupuesto, plazo y ciencia mínima de la misión (diseño y objetivo). */
  budgetMult: number;
  deadlineMult: number;
  minScienceMult: number;
  /** En la partida: desgaste, peligros por tramo y duración de las ventanas de contacto. */
  wearMult: number;
  hazardMult: number;
  contactWindowMult: number;
}

/** Cómo afectan en vuelo la fiabilidad, el calor y la batería de la nave diseñada (fase 5). */
export interface DesignOperationsRules {
  /** Desgaste × (1 + k·(1 − fiabilidad)): una nave menos fiable tiene más averías. */
  reliabilityWearK: number;
  /** Con la demanda por encima de lo que disipan los radiadores, el reactor pierde esto por kW de exceso y segundo (%). */
  heatDamagePctPerSPerKw: number;
  /** Tope del daño por calor (%/s). */
  heatDamageMaxPctPerS: number;
  /** kWh de batería que gasta cada kW de déficit en un segundo de juego (escala de tiempo). */
  batteryKwhPerKwS: number;
  /** Fracción del excedente que vuelve a la batería. */
  batteryRechargeEff: number;
}

export type SolarBodyType = 'star' | 'planet' | 'dwarf' | 'moon' | 'asteroid' | 'station';

/**
 * Cuerpo del sistema solar (datos públicos de NASA; estaciones ficticias). Los que tienen `nodeKind`
 * aparecen en el mapa; los `landable` se enlazan con un mundo de superficie (`worldId`, del mismo `kind`).
 */
export interface SolarBodyDef {
  id: string;
  name: LocalizedText;
  type: SolarBodyType;
  /** Cuerpo alrededor del que orbita (lunas y estaciones); ausente = alrededor del Sol. */
  parentId?: string;
  /** Zona del mapa a la que pertenece (`SolarZoneDef.id`). */
  zoneId?: string;
  /** Semieje mayor alrededor del Sol (UA). Las lunas toman el de su planeta. */
  orbitAu?: number;
  /** Semieje mayor alrededor de su planeta (km). */
  orbitKm?: number;
  /** Periodo orbital (días). */
  periodDays: number;
  /** Fase orbital en el instante 0 (grados; ficticia, solo para dibujar). */
  phaseDeg: number;
  radiusKm: number;
  gravityMps2: number;
  atmosphere: boolean;
  /** Cómo aparece en el mapa (peligros, contenedores, terminal). Ausente = no es un nodo (Sol, Tierra). */
  nodeKind?: NodeKind;
  landable: boolean;
  /** Mundo de superficie (`surface.worlds`) al aterrizar. */
  worldId?: string;
  /** Fuente de las cifras. */
  source?: string;
}

/** Zona del sistema solar: cada tramo del viaje va de una zona a la siguiente. */
export interface SolarZoneDef {
  id: string;
  name: LocalizedText;
  /** Distancia al Sol de la zona (UA). */
  sunDistanceAu: number;
  /** Estación de la zona (`SolarBodyDef` de tipo `station`): salida del tramo que parte de aquí. */
  hubId: string;
  /** Radiación intensa (Júpiter): la revisión avisa si la computadora no está endurecida. */
  radiation?: boolean;
}

/** Cómo se genera el mapa del sistema solar a partir de las zonas. */
export interface SolarRouteRules {
  /** Longitud de un tramo (unidades del mapa, las mismas de `distanceLy`) = base + porRaízUA × √ΔUA, acotada. */
  legBaseUnits: number;
  legUnitsPerSqrtAu: number;
  legMinUnits: number;
  legMaxUnits: number;
  /** Separación media entre columnas (unidades): fija cuántas columnas tiene un tramo. */
  columnSpacingUnits: number;
  /** Tipos de los puntos de paso generados entre zonas (con el peso de `nodeKinds`). */
  waypointKinds: NodeKind[];
  /** Solo para dibujar: separación de las lunas respecto a su planeta (UA por cada 10⁶ km, exagerada). */
  moonDisplayAuPerMkm: number;
}

export interface SolarSystemDef {
  route: SolarRouteRules;
  /** Ordenadas de dentro a fuera; la primera es la de salida (la Tierra). */
  zones: SolarZoneDef[];
  bodies: SolarBodyDef[];
}

/**
 * Diseño de misión (pantalla de diseño, antes de zarpar). Los ids se pueden repetir en `moduleIds` (dos
 * tanques, tres alas solares). `null` = aún sin elegir.
 */
export interface MissionDesign {
  missionId: string;
  destinationId: string | null;
  moduleIds: string[];
  instrumentIds: string[];
  launcherId: string | null;
  /** Fase 5: nivel de dificultad (`DesignRules.difficulties`); ausente = el de por defecto. */
  difficultyId?: string;
}

export const DESIGN_RESOURCE_IDS = ['mass', 'power', 'cost', 'schedule', 'slots', 'fuel'] as const;
export type DesignResourceId = (typeof DESIGN_RESOURCE_IDS)[number];
export type DesignResourceStatus = 'ok' | 'tight' | 'over';

export interface DesignResource {
  id: DesignResourceId;
  used: number;
  available: number;
  /** Código estable de unidad: kg, kW, MUSD, months, slots, fuel. */
  unit: string;
  /** (available − used) / available; −1 si no hay nada disponible y algo se usa. */
  margin: number;
  status: DesignResourceStatus;
  /** Una línea: por qué el recurso está así. */
  why: MessageRef;
}

export interface DesignTotals {
  massKg: number;
  /** Límite de masa: el menor entre el lanzador (a la zona del destino) y la estructura (0 = sin datos). */
  massLimitKg: number;
  /** Consumo a crucero con todo encendido (kW). */
  demandKw: number;
  solarKwAt1Au: number;
  nuclearKw: number;
  /** Distancia al Sol del destino (UA; 1 sin destino). */
  destinationAu: number;
  solarKwAtDestination: number;
  powerAtDestinationKw: number;
  /**
   * Peor punto de la ruta (el más alejado del Sol que puede generar: cuerpos de las zonas de la ruta y sus
   * estaciones). El presupuesto de potencia y el alcance del enlace se miden AQUÍ, no solo en el destino.
   */
  worstAu: number;
  worstBodyId: string;
  solarKwAtWorst: number;
  powerAtWorstKw: number;
  costMUSD: number;
  scheduleMonths: number;
  slotsUsed: number;
  slots: number;
  fuelCapacity: number;
  /** Combustible del tramo más largo hasta el destino sin repostar (régimen económico). */
  legFuel: number;
  scienceValue: number;
  /** Producto de fiabilidades (0-100). */
  reliabilityPct: number;
  heatRejectKw: number;
  /** Fase 5: datos que generan los instrumentos y tasa de bajada de las comunicaciones. */
  dataRateMbps: number;
  downlinkMbps: number;
  storageGb: number;
}

export interface DesignBudgets {
  resources: DesignResource[];
  /** Recurso con menos margen (null si el diseño está vacío). */
  limiting: DesignResourceId | null;
  totals: DesignTotals;
}

export type DesignIssueSeverity = 'blocker' | 'warning' | 'info';

export interface DesignIssue {
  severity: DesignIssueSeverity;
  /** Código estable (`mass-launcher`, `power`, `range`…): los fixtures y la interfaz lo usan. */
  code: string;
  /** Una línea: el motivo. */
  message: MessageRef;
}

/** Revisión Go/No-Go: `go` = ningún `blocker`. */
export interface DesignReview {
  go: boolean;
  issues: DesignIssue[];
  budgets: DesignBudgets;
}

// ─── Ciencia, datos y ventanas de contacto (fase 5, ADR 0018) ────────────────

/** Reglas de la ciencia en la partida (`catalog/ciencia.json`). Unidades de datos «de juego» (MB). */
export interface ScienceRules {
  /** MB generados por segundo por cada Mbps de un instrumento observando. */
  observeMbPerMbps: number;
  /** Datos mínimos por segundo de un instrumento (los de tasa casi nula también ocupan algo). */
  minObserveMbPerS: number;
  /** MB de almacenamiento por cada GB de las computadoras. */
  storageMbPerGb: number;
  /** MB bajados por segundo por cada Mbps de las antenas (a distancia de referencia). */
  downlinkMbPerMbps: number;
  /** Segundos de observación que da de sí el destino, en órbita y posada por separado (después no genera más). */
  observeMaxS: number;
  /** Lo mismo para los demás cuerpos (menos: rinden poco y llenan el almacenamiento). */
  otherObserveMaxS: number;
  /** Multiplicador de la ciencia según el lugar: el destino en órbita, posada en el destino y otros cuerpos. */
  targetMult: number;
  surfaceMult: number;
  otherBodyMult: number;
  /** Ventanas de contacto: periodo y duración (s). El desfase sale de la semilla. */
  contactPeriodS: number;
  contactWindowS: number;
  /** Distancia a la Tierra (UA) hasta la que la tasa es plena; más allá baja como (ref / d)^exp. */
  rateRefAu: number;
  rateFalloffExp: number;
  /** Al volver a la Tierra, lo que queda a bordo se entrega. */
  homeDeliversAll: boolean;
  /** Puntos por punto de ciencia entregado y bonus por terminar la misión con éxito. */
  scorePerScience: number;
  successBonus: number;
}

/** Estado de la ciencia de una partida con diseño. */
export interface ScienceState {
  /** Ciencia que pide la misión (`requirements.minScience`). */
  requiredScience: number;
  /** Datos a bordo (MB) y la ciencia que llevan. */
  storedMb: number;
  storedScience: number;
  /** Capacidad del almacenamiento (MB). */
  capacityMb: number;
  /** Entregado en la Tierra. */
  deliveredMb: number;
  deliveredScience: number;
  /** Perdido por almacenamiento lleno. */
  lostMb: number;
  lostScience: number;
  /** Perdido con la nave (lo que quedaba a bordo al perder la partida). */
  lostWithShipScience: number;
  /** Segundos observados por cuerpo (`bodyId`), hasta `observeMaxS`. */
  observedS: Record<string, number>;
  /** Cuerpo que se está observando ahora (null = ninguno). */
  observing: string | null;
  /** Generación actual (MB/s y ciencia/s); 0 si no observa. */
  observeMbPerS: number;
  /** Hay enlace con la Tierra ahora mismo y su tasa (MB/s). */
  contact: boolean;
  downlinkMbPerS: number;
  /** Dentro de la ventana de contacto (aunque falte alcance o navegación). */
  inWindow: boolean;
  /** Segundos hasta el próximo cambio de ventana (apertura o cierre). */
  windowChangeInS: number;
  /** Alguna antena alcanza a la distancia actual. */
  inRange: boolean;
  /** El destino de la misión ya se visitó. */
  targetVisited: boolean;
  /** Se entregó al menos `requiredScience`. */
  objectiveMet: boolean;
  /** La misión terminó al volver a la Tierra (`phase` = `won` y `next-sector` rechazado). */
  over: boolean;
  /** Ya se avisó de almacenamiento lleno (se rearma al liberar `storageRearmFrac` de la capacidad). */
  fullWarned: boolean;
  /** Contadores para el informe (segundos). */
  blockedS: number;
  outOfRangeS: number;
  fullS: number;
}

export type MissionOutcome = 'success' | 'partial' | 'lost' | 'in-progress';
export type ReportLinkId = 'target' | 'power' | 'storage' | 'link' | 'science' | 'survival';

/** Un eslabón de la cadena de causas: ok o mal, con su motivo en una línea. */
export interface ReportLink {
  id: ReportLinkId;
  ok: boolean;
  message: MessageRef;
}

/** Informe post-misión (`missionReport`). `rootCause` = primer eslabón que falló (null si ninguno). */
export interface MissionReport {
  outcome: MissionOutcome;
  headline: MessageRef;
  links: ReportLink[];
  rootCause: ReportLinkId | null;
  deliveredScience: number;
  requiredScience: number;
}

// ─── Cordura de la tripulación (fase 8, docs/diseno/cordura-tripulacion.md) ──

/** Tramo de cordura que fija los debuffs. */
export type SanityBand = 'stable' | 'tense' | 'critical' | 'breakdown';

/** Estado de partida de la cordura (`RunState.psych`, solo con `catalog.psych.enabled`). */
export interface PsychState {
  /** Pasos fijos contados (semilla de los lapsus sin rng con estado). */
  steps: number;
  /** Segundos desde la última novedad (monotonía). */
  sinceNoveltyS: number;
  /** Cohesión del equipo 0-100 (solo con 2 o más vivos). */
  cohesionPct?: number;
  cohesionBand?: 'ok' | 'low';
  /** Recuperado en el atraque actual (tope). */
  stationRecoveredPct: number;
  /** Unidades de provisiones frescas a bordo y segundos consumidos de la unidad en curso. */
  provisions: number;
  provisionsS: number;
  /** Hasta qué `stats.timeS` la llamada suma demanda eléctrica. */
  callUntilS: number;
  /** Bonificación por venta ya cobrada en este atraque. */
  saleBonusUsed: boolean;
  /** Días de misión (solo para mostrar). */
  missionDays: number;
}

/** Cifras de la cordura (`catalog/cordura.json`). Las mejoras `crew` y los módulos las ajustan (`effectivePsychRules`). */
export interface PsychRules {
  enabled: boolean;
  startPct: number;
  daysPerS: number;
  bands: { tense: number; critical: number; breakdown: number; hysteresisPct: number };
  base: { transit: number; docked: number; surfaceAboard: number; eva: number };
  distPerSector: number;
  distPerAu: number;
  monotonyMax: number;
  monotonyRampS: number;
  awakeGraceS: number;
  awakeRampS: number;
  sleepPenalty: number;
  radiationMult: number;
  stressors: { perIncident: number; maxIncidents: number; lowShipO2: number; stormEva: number; suitCritical: number };
  shocks: { impact: number; hardLanding: number; crewDeath: number; crewDeathCohesion: number };
  rewards: { incidentFixed: number; systemRepaired: number; storedPer100: number; storedMax: number; sale: number; sectorCleared: number };
  /** Un valor por banda: [estable, tensa, crítica, quiebre]. */
  debuffs: { work: number[]; evadeDamage: number[]; suitO2: number[]; jetpack: number[]; carry: number[]; lapsePerS: number[] };
  lapse: { cooldownS: number; systems: PoweredSystemId[] };
  rest: { recoverPctPerS: number; alarmMult: number; awakeRecoverMult: number };
  call: { seconds: number; drawKw: number; recoverPct: number; delayHalfMin: number; soloMult: number; cooldownS: number };
  station: { recoverPctPerS: number; arrivalPct: number; capPct: number; cohesionPctPerS: number };
  provisions: { unitPrice: number; maxUnits: number; secondsPerUnit: number; drainMult: number };
  cohesion: {
    start: number; lowPct: number; drainMax: number; groupRepairPct: number; groupRepairSanity: number; evaNearM: number; evaNearPctPerS: number;
    teamworkMult: number; teamworkMinPct: number;
  };
  /** Mejoras `crew` distintas que ofrece además cada estación (flujo de azar propio; no cambia la oferta de siempre). */
  crewOfferSize: number;
  /** Opcional y desactivado por defecto: golpe único al 75 % del plazo (ficción de juego). */
  thirdQuarter?: { enabled: boolean; fictional: boolean; atFrac: number; shockPct: number };
  /** Derivado por `effectivePsychRules` (mejoras y módulos), no va en el catálogo. */
  drainMult?: number;
  recoverMult?: number;
}
