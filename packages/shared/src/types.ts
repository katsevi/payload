/**
 * CONTRATO DE DOMINIO DE PAYLOAD
 * ------------------------------------------------------------------
 * Este archivo es el contrato entre el motor de simulación (packages/shared),
 * el cliente (apps/client) y, en fase 3, el servidor de juego (apps/game-server).
 *
 * Reglas:
 *  - TypeScript puro: sin dependencias de React, Three.js, DOM ni Node.
 *  - Cambios ADITIVOS únicamente (nuevos campos opcionales, nuevos tipos).
 *    Renombrar o quitar campos exige un ADR en docs/adr/ y actualizar todos los consumidores.
 *  - El motor nunca devuelve texto final al jugador: devuelve claves i18n + parámetros
 *    (`MessageRef`). Las traducciones del motor viven en packages/shared/locales/{es,en}.json
 *    bajo el namespace `sim`.
 *  - Unidades en el nombre del campo (Kg, W, Wh, MUSD, Mbit, Km, Deg, Min, Days, Years...).
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

// ─── Catálogo: componentes ──────────────────────────────────────────────────

export type SubsystemId =
  | 'structure'
  | 'power' // paneles solares
  | 'battery'
  | 'comms'
  | 'obc' // computadora de a bordo
  | 'adcs' // control de actitud
  | 'thermal'
  | 'payload'; // instrumentos científicos

export type ComponentLevel = 'basic' | 'advanced';

export interface ComponentDef {
  id: string;
  subsystem: SubsystemId;
  name: LocalizedText;
  description: LocalizedText;
  /** Explicación "¿por qué?" de 1-2 frases en lenguaje sencillo. */
  why: LocalizedText;
  level: ComponentLevel;

  massKg: number;
  /** Consumo medio en operación (W). Los paneles solares tienen 0. */
  powerW: number;
  costMUSD: number;
  /** Datos generados por día (solo instrumentos). */
  dataMbitPerDay: number;
  /** 0-100. Aporte científico (solo instrumentos). */
  scienceValue: number;
  /** Probabilidad 0-1 de no fallar durante la vida nominal. */
  reliability: number;
  /** Meses de desarrollo/integración que añade. */
  devMonths: number;

  // Atributos específicos por subsistema (opcionales)
  /** power: generación en luz solar, inicio de vida (W). */
  solarGenerationW?: number;
  /** battery: capacidad útil (Wh). */
  batteryCapacityWh?: number;
  /** battery: profundidad de descarga máxima recomendada (0-1). */
  maxDepthOfDischarge?: number;
  /** comms: tasa de bajada (Mbit/s) durante un contacto. */
  downlinkMbps?: number;
  /** obc: almacenamiento a bordo (Mbit). */
  storageMbit?: number;
  /** structure: masa total máxima soportada (kg). */
  maxSupportedMassKg?: number;
  /** structure: puntos de montaje disponibles para el resto de componentes. */
  mountSlots?: number;
  /** adcs: precisión de apuntado (grados). */
  pointingAccuracyDeg?: number;
  /** thermal: potencia que puede disipar (W). */
  thermalDissipationW?: number;
  /** payload: resolución en suelo a 500 km de altitud (m). Escala linealmente con la altitud. */
  groundResolutionAt500KmM?: number;
  /** payload: precisión de apuntado que necesita (grados). */
  requiredPointingDeg?: number;

  /** Ruta del modelo 3D (relativa a /models), opcional. */
  model?: string;
}

// ─── Catálogo: órbitas ──────────────────────────────────────────────────────

export type OrbitId = 'LEO' | 'SSO' | 'MEO' | 'GEO' | 'HEO' | 'TLI';

export interface OrbitDef {
  id: OrbitId;
  name: LocalizedText;
  description: LocalizedText;
  why: LocalizedText;
  /** Altitud de perigeo (km). En órbitas circulares perigeo = apogeo. */
  perigeeKm: number;
  /** Altitud de apogeo (km). */
  apogeeKm: number;
  inclinationDeg: number;
  /** Factor de radiación relativo 0-1 (degrada fiabilidad). */
  radiationFactor: number;
  /** Vida orbital natural por arrastre atmosférico (años). null = prácticamente ilimitada. */
  dragLifetimeYears: number | null;
  /** Días entre pasadas sobre el mismo punto (revisita), para misiones de observación. */
  revisitDays: number;
}

// ─── Catálogo: lanzadores ───────────────────────────────────────────────────

export interface LauncherDef {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  costMUSD: number;
  /** Probabilidad 0-1 de lanzamiento exitoso. */
  reliability: number;
  /** Capacidad de carga (kg) por órbita. Ausente = no puede llegar a esa órbita. */
  capacityKg: Partial<Record<OrbitId, number>>;
  /** Meses de espera hasta la ventana de lanzamiento. */
  leadTimeMonths: number;
  model?: string;
  /** Explicación "¿por qué?" de 1-2 frases (opcional). */
  why?: LocalizedText;
}

// ─── Catálogo: escenarios ───────────────────────────────────────────────────

export type MissionType =
  | 'earth-observation'
  | 'telecom'
  | 'space-telescope'
  | 'lunar-exploration'
  | 'mars-exploration';

export type DifficultyLevel = 'basic' | 'intermediate' | 'advanced';

export interface ScenarioRequirements {
  /** Resolución en suelo mínima exigida (m). Menor es mejor. */
  maxGroundResolutionM?: number;
  /** Datos que deben BAJARSE a tierra por día (Mbit/día). */
  minDownlinkMbitPerDay?: number;
  /** Vida útil mínima (años). */
  minLifetimeYears: number;
  /** Revisita máxima permitida (días). */
  maxRevisitDays?: number;
  /** Valor científico mínimo (suma de instrumentos). */
  minScienceValue?: number;
}

export interface ScoreWeights {
  objectives: number;
  science: number;
  efficiency: number;
  collaboration: number;
}

export interface ScenarioDef {
  id: string;
  name: LocalizedText;
  /** Briefing narrativo de la sala de control. */
  briefing: LocalizedText;
  /** Explicación "¿por qué?" de 1-2 frases sobre el reto del escenario (opcional). */
  why?: LocalizedText;
  missionType: MissionType;
  difficulty: DifficultyLevel;
  budgetMUSD: number;
  maxDevMonths: number;
  requirements: ScenarioRequirements;
  allowedOrbits: OrbitId[];
  allowedLaunchers: string[];
  /** Si se omite, todos los componentes del catálogo están disponibles. */
  allowedComponents?: string[];
  /** Número de estaciones terrestres disponibles. */
  groundStations: number;
  /** Días simulados de operación en la fase de operación. */
  operationDays: number;
  /** Activa eventos aleatorios (tormenta solar, falla de rueda...). */
  eventsEnabled: boolean;
  weights: ScoreWeights;
  /** Semilla por defecto para simulación determinista. */
  defaultSeed: number;
  /**
   * Costo de operación por año de vida exigida (MUSD/año: estaciones, equipo de control).
   * Presupuesto de operación = este valor × requirements.minLifetimeYears. Por defecto 1.
   */
  operationsCostMUSDPerYear?: number;
  /**
   * Ajuste opcional de los eventos aleatorios de este escenario (fase 2). Lo que falte se toma de
   * la tabla por dificultad (`EVENT_TABLES[difficulty]`). Solo actúa si `eventsEnabled` es true.
   */
  eventTuning?: ScenarioEventTuning;
}

// ─── Eventos aleatorios (fase 2) ────────────────────────────────────────────

/** Eventos del ENTORNO (no dependen del diseño): un sorteo por día con pesos relativos. */
export type EnvironmentEventType = 'solar-storm' | 'debris-avoidance' | 'reaction-wheel-failure';

/** Rango entero cerrado [min, max]. */
export interface NumberRange {
  min: number;
  max: number;
}

/**
 * Tabla de eventos de una dificultad. Ver constants.ts (`EVENT_TABLES`) y el ADR 0008.
 *  - Entorno: un sorteo diario con `environmentChancePerDay` y pesos `environmentWeights`.
 *  - Salud de la nave (dependen del diseño): sobrecalentamiento (si el margen térmico es justo)
 *    y falla de componente (según fiabilidad y radiación de la órbita).
 *  - Pre-operación: retraso de lanzamiento y recorte de presupuesto (`rollPreLaunchEvents`).
 */
export interface EventTable {
  environmentChancePerDay: number;
  environmentWeights: Record<EnvironmentEventType, number>;
  /** Probabilidad diaria base de sobrecalentamiento; se multiplica por el factor térmico (0-2). */
  overheatingChancePerDay: number;
  /** Aceleración de juego de los fallos de componente (0 = sin fallos genéricos). */
  componentFailureAcceleration: number;
  launchDelayChance: number;
  launchDelayMonths: NumberRange;
  budgetCutChance: number;
  /** Porcentaje entero de recorte (5 = 5 %). */
  budgetCutPct: NumberRange;
}

/** Ajuste parcial de la tabla de eventos para un escenario. */
export type ScenarioEventTuning = Partial<Omit<EventTable, 'environmentWeights'>> & {
  environmentWeights?: Partial<Record<EnvironmentEventType, number>>;
};

/** Eventos sorteados ANTES del lanzamiento (tras el Go). */
export type PreLaunchEventType = 'launch-delay' | 'budget-cut';

/**
 * Resultado de `rollPreLaunchEvents`. El cliente lo pasa a `createMissionSim`/`runMission` en
 * `MissionSimOptions.preLaunch` y a `computeBudgets(design, cat, preLaunch)` para el panel.
 */
export interface PreLaunchOutcome {
  /** Semilla con la que se sortearon (normalmente la misma del intento). */
  seed: number;
  /** Meses de retraso añadidos al calendario (0 = sin retraso). */
  delayMonths: number;
  /** Recorte del presupuesto del escenario en % (0 = sin recorte). */
  budgetCutPct: number;
  /** Recorte en MUSD (= budgetMUSD × budgetCutPct / 100). */
  budgetCutMUSD: number;
  /** Eventos `launch-delay` / `budget-cut` (tSeconds = 0), para la consola y la mascota. */
  events: SimEvent[];
  /** Recursos que pasan a excedidos SOLO por estos eventos ('time' y/o 'budget'). */
  overruns: ResourceId[];
}

// ─── Contenido pedagógico (fase 2) ──────────────────────────────────────────

/** Entrada del glosario (catalog/glosario.json). */
export interface GlossaryEntry {
  id: string;
  term: LocalizedText;
  definition: LocalizedText;
  why?: LocalizedText;
  /** Ids de otras entradas del glosario. */
  related?: string[];
}

export type MascotExpression = 'happy' | 'thinking' | 'worried' | 'celebrating';

/**
 * Diálogo de la mascota. `trigger` tiene la forma `<tipo>:<valor>`:
 *   event:<SimEventType> · resource-over:<ResourceId> · resource-tight:<ResourceId> ·
 *   phase:<MissionPhase> · academy:<id de paso> · help:<contexto> · review:go|no-go ·
 *   report:success|failure
 */
export interface MascotDialogue {
  id: string;
  trigger: string;
  expression: MascotExpression;
  text: LocalizedText;
}

/** Mascota intercambiable por datos (catalog/mascota.json). Plan B del GDD: mascota propia. */
export interface MascotDef {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  /** Modelo GLB opcional (relativo a /models). */
  model?: string;
  /** Expresiones disponibles (morph targets o sprites). */
  expressions: MascotExpression[];
  /** Versión 2D opcional (modo accesible). */
  sprite2d?: string;
  dialogues: MascotDialogue[];
}

export type AcademyStepResource = ResourceId | 'intro' | 'launch' | 'operation' | 'report';
export type AcademyGoalType = 'add-component' | 'select-orbit' | 'select-launcher' | 'resource-ok' | 'go' | 'manual';

/**
 * Objetivo de un paso de la Academia (ver `evaluateAcademyStep`):
 *  - add-component: `value` = id de componente o de subsistema (sin value: cualquier pieza).
 *  - select-orbit / select-launcher: `value` = id exigido (sin value: cualquiera).
 *  - resource-ok: `value` = ResourceId (sin value: el `resource` del paso); no excedido y evaluable.
 *  - go: el Go/No-Go da Go.
 *  - manual: siempre cumplido; el cliente avanza con "Siguiente".
 */
export interface AcademyGoal {
  type: AcademyGoalType;
  value?: string;
}

export interface AcademyStep {
  id: string;
  resource: AcademyStepResource;
  title: LocalizedText;
  body: LocalizedText;
  goal: AcademyGoal;
}

/** Academia (catalog/academia.json): mini-misión guiada sobre un escenario del catálogo. */
export interface AcademyDef {
  id: string;
  scenarioId: string;
  title: LocalizedText;
  /** Mascota que guía (id de `Catalog.mascot`), opcional. */
  mascotId?: string;
  steps: AcademyStep[];
}

/** Catálogo completo cargado desde packages/shared/catalog/*.json */
export interface Catalog {
  components: ComponentDef[];
  orbits: OrbitDef[];
  launchers: LauncherDef[];
  scenarios: ScenarioDef[];
  /** Glosario (catalog/glosario.json). Opcional para no romper catálogos de fase 1. */
  glossary?: GlossaryEntry[];
  /** Mascota guía (catalog/mascota.json). */
  mascot?: MascotDef;
  /** Academia (catalog/academia.json). */
  academy?: AcademyDef;
}

// ─── Diseño del jugador ─────────────────────────────────────────────────────

export interface MissionDesign {
  scenarioId: string;
  /** Ids de componentes montados (se permiten repetidos, p. ej. 2 baterías). */
  componentIds: string[];
  orbitId: OrbitId | null;
  launcherId: string | null;
}

// ─── Mecánica orbital ───────────────────────────────────────────────────────

export interface OrbitParams {
  semiMajorAxisKm: number;
  periodMin: number;
  /** Fracción del periodo en sombra (peor caso, beta = 0). */
  eclipseFraction: number;
  eclipseMin: number;
  orbitsPerDay: number;
  /** Minutos de contacto al día con UNA estación terrestre. */
  contactMinPerDayPerStation: number;
}

// ─── Presupuestos de ingeniería (panel de recursos) ─────────────────────────

export type ResourceId =
  | 'mass'
  | 'power'
  | 'battery'
  | 'budget'
  | 'data'
  | 'comms'
  | 'time'
  | 'lifetime';

/** ok = margen sano · tight = poco margen · over = excedido (bloquea Go o falla la misión). */
export type ResourceStatus = 'ok' | 'tight' | 'over';

export interface ResourceBudget {
  id: ResourceId;
  /** Valor usado/requerido. */
  used: number;
  /** Disponible/límite. */
  available: number;
  unit: string;
  /** (available - used) / available. Negativo = excedido. */
  margin: number;
  status: ResourceStatus;
  /** "¿por qué?" de este valor. */
  why: MessageRef;
}

export interface BudgetReport {
  resources: ResourceBudget[];
  /** Recurso que más limita la misión (menor margen), o null si no hay diseño. */
  limiting: ResourceId | null;
  orbit: OrbitParams | null;
  totals: {
    massKg: number;
    powerW: number;
    solarGenerationW: number;
    batteryCapacityWh: number;
    costMUSD: number;
    devMonths: number;
    dataGeneratedMbitPerDay: number;
    downlinkCapacityMbitPerDay: number;
    scienceValue: number;
    groundResolutionM: number | null;
    lifetimeYears: number;
  };
}

// ─── Revisión Go/No-Go ──────────────────────────────────────────────────────

export type IssueSeverity = 'blocker' | 'warning' | 'info';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Recurso o regla afectada. */
  code: string;
  message: MessageRef;
}

export interface GoNoGoResult {
  go: boolean;
  issues: ValidationIssue[];
}

// ─── Simulación de operación ────────────────────────────────────────────────

export type MissionPhase =
  | 'briefing'
  | 'design'
  | 'review'
  | 'launch'
  | 'operation'
  | 'report';

export type SimStatus = 'nominal' | 'degraded' | 'failed' | 'complete';

export type SimEventType =
  | 'launch-success'
  | 'launch-failure'
  | 'eclipse-enter'
  | 'eclipse-exit'
  | 'contact-start'
  | 'contact-end'
  | 'battery-low'
  | 'battery-depleted'
  | 'storage-full'
  | 'solar-storm'
  | 'reaction-wheel-failure'
  | 'debris-avoidance'
  | 'component-failure'
  | 'mission-complete'
  // Fase 2 (aditivo)
  | 'overheating'
  | 'launch-delay'
  | 'budget-cut';

export interface SimEvent {
  type: SimEventType;
  /** Segundos de misión desde la inserción orbital. */
  tSeconds: number;
  message: MessageRef;
}

/** Estado instantáneo, pensado para pintar la escena 3D y las consolas. */
export interface SimSnapshot {
  tSeconds: number;
  day: number;
  /**
   * 0-1 posición ANGULAR a lo largo de la órbita (anomalía verdadera / 2π, desde el perigeo), para
   * colocar la nave en 3D. En órbitas elípticas avanza rápido cerca del perigeo y lento cerca del
   * apogeo (2.ª ley de Kepler); en circulares coincide con `meanPhase`.
   */
  orbitPhase: number;
  /** 0-1 fracción del periodo transcurrida (anomalía media / 2π, uniforme en el tiempo). */
  meanPhase?: number;
  /** Altitud actual sobre la superficie (km), r(ν) − R⊕. */
  altitudeKm?: number;
  inEclipse: boolean;
  inContact: boolean;
  batteryWh: number;
  batteryPct: number;
  dataStoredMbit: number;
  dataDownlinkedMbit: number;
  dataLostMbit: number;
  status: SimStatus;
  /** Eventos ocurridos desde el snapshot anterior. */
  newEvents: SimEvent[];
}

export interface MissionSimOptions {
  seed?: number;
  /** Paso fijo interno (s). Por defecto lo decide el motor. */
  fixedStepSeconds?: number;
  /**
   * Eventos pre-operación ya sorteados con `rollPreLaunchEvents` (fase 2). Si se pasan, el retraso
   * se suma al calendario, el recorte reduce el presupuesto, sus eventos encabezan `events` y se
   * reflejan en presupuestos, puntuación e informe. Si se omite, no hay eventos pre-operación.
   */
  preLaunch?: PreLaunchOutcome;
}

/**
 * Simulación paso a paso para la fase de operación en tiempo real (1× a 10 000×).
 * Determinista: con el mismo diseño, catálogo y semilla, el mismo tiempo simulado
 * produce exactamente el mismo estado, sin importar cómo se troceen las llamadas a step().
 */
export interface MissionSim {
  /** Avanza `dtSeconds` de tiempo simulado (ya multiplicado por la aceleración). */
  step(dtSeconds: number): SimSnapshot;
  snapshot(): SimSnapshot;
  isFinished(): boolean;
  /** Resultado final (si aún no terminó, avanza hasta el final). */
  finish(): MissionResult;
}

export interface MissionResult {
  design: MissionDesign;
  seed: number;
  launchSuccess: boolean;
  status: SimStatus;
  /** Días operados hasta terminar o fallar. */
  daysOperated: number;
  dataDownlinkedMbit: number;
  dataLostMbit: number;
  minBatteryPct: number;
  /** Capacidad de la batería al final, en % de la nominal (baja por desgaste y agotamientos). */
  finalBatteryCapacityPct?: number;
  /** Número de agotamientos de batería (apagones) durante la operación. */
  batteryDepletions?: number;
  /** Eventos pre-operación aplicados (si se pasaron en las opciones). */
  preLaunch?: PreLaunchOutcome;
  events: SimEvent[];
  budgets: BudgetReport;
  score: ScoreBreakdown;
  /** Cadena de causas para el informe post-misión. */
  report: ReportEntry[];
}

// ─── Puntuación e informe ───────────────────────────────────────────────────

export interface ScoreBreakdown {
  /** Cada componente 0-100. */
  objectives: number;
  science: number;
  efficiency: number;
  collaboration: number;
  /** Total ponderado 0-100. */
  total: number;
  weights: ScoreWeights;
}

export interface ReportEntry {
  severity: 'success' | 'info' | 'warning' | 'failure';
  message: MessageRef;
  /** Causas encadenadas: "la batería se agotó" ← "porque el instrumento consume 60 W" ← "y hay 35 min de eclipse". */
  causes: MessageRef[];
  /** Sugerencia de rediseño. */
  suggestion?: MessageRef;
}

// ─── Asesores por rol en solitario (fase 2) ─────────────────────────────────

/** Roles del equipo (en solitario los "interpreta" el juego; en fase 3, jugadores). */
export type AdvisorRole = 'director' | 'engineering' | 'science' | 'operations';

/** Consejo de un asesor (ver `adviseByRole`). */
export interface RoleAdvice {
  role: AdvisorRole;
  message: MessageRef;
  severity: IssueSeverity;
}
