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
  /**
   * Fase 3 (aditivo): escenario pensado para jugar en equipo. `minPlayers` ≥ 2 lo marca como misión
   * de equipo (`isTeamScenario`) y la sala no empieza (`start-mission`) con menos jugadores conectados.
   * Sin este campo el escenario se juega en solitario o en sala con 1-4 jugadores.
   */
  team?: ScenarioTeamSettings;
}

/** Jugadores admitidos por un escenario de equipo (enteros 1-4, `minPlayers` ≤ `maxPlayers`). */
export interface ScenarioTeamSettings {
  minPlayers: number;
  maxPlayers: number;
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
 * Fase 3 (multijugador): team:<valor de TEAM_MASCOT_TRIGGERS> · role:<TeamRole> (presentación del rol).
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

// ─── Multijugador (fase 3) ──────────────────────────────────────────────────
// Contrato entre motor, servidor (apps/game-server) y cliente: docs/MULTIPLAYER.md.
// Lógica pura en src/team.ts (roles, permisos, solicitudes, votos, alertas, colaboración) y
// src/teamWire.ts (esquema zod de las acciones y codificación del estado para Colyseus).
// Los tiempos `*AtS` son segundos de sala que pasa quien llama (el motor no tiene reloj).

/** Roles del equipo en una sala: los mismos cuatro de los asesores en solitario. */
export type TeamRole = AdvisorRole;

/** Fases de una sala: las de `MissionPhase` más `lobby` (sala de espera) y `prelaunch` (tras el Go). */
export type RoomPhase = 'lobby' | 'briefing' | 'design' | 'review' | 'prelaunch' | 'launch' | 'operation' | 'report';

/** Permisos por rol (tabla `ROLE_PERMISSIONS`). Pedir la revisión, votar por tus roles, chat y pings no requieren permiso. */
export type TeamPermission =
  | 'design.orbit'
  | 'design.launcher'
  | 'budget.allocate'
  | `design.subsystem.${SubsystemId}`
  | 'mission.startDesign'
  | 'launch.confirm'
  | 'time.control'
  | 'mission.finish'
  | 'mission.redesign'
  | `request.resolve.${ResourceId}`;

/** Reparto del dinero para piezas por subsistema (MUSD). Un subsistema ausente no tiene tope. */
export type SubsystemAllocation = Partial<Record<SubsystemId, number>>;

/** Gasto de un subsistema frente a su asignación (`subsystemSpend`). */
export interface SubsystemSpend {
  subsystem: SubsystemId;
  /** Asignación (MUSD); null = sin tope (sin reparto o subsistema sin asignar). */
  allocatedMUSD: number | null;
  /** Costo de las piezas montadas de ese subsistema (MUSD). */
  usedMUSD: number;
  /** (asignado − usado) / asignado; null si no hay tope o la asignación es 0 sin gasto. */
  margin: number | null;
  status: ResourceStatus;
}

export type GoNoGoVoteValue = 'go' | 'no-go';
/** Motivo de un No-Go: un recurso, los requisitos de la misión, el riesgo u otro (con nota). */
export type NoGoReasonCode = ResourceId | 'requirements' | 'risk' | 'other';
export interface NoGoReason {
  code: NoGoReasonCode;
  /** Texto libre del jugador (obligatorio si `code` es `other`). */
  note?: string;
}

/** Voto de un rol en el Go/No-Go compartido. */
export interface TeamVote {
  role: TeamRole;
  playerId: string;
  value: GoNoGoVoteValue;
  reason?: NoGoReason;
  atS: number;
}

/** Recuento de la votación (`tallyGoNoGo`). */
export interface TeamPollResult {
  status: 'pending' | 'go' | 'no-go';
  /** Roles sin voto válido todavía. */
  missingRoles: TeamRole[];
  /** Votos No-Go válidos que cierran la votación (vacío si no hay). */
  noGoVotes: TeamVote[];
}

/** Último No-Go: del motor (`review`, con sus issues) o de la votación (`vote`, con los votos). */
export interface NoGoRecord {
  source: 'review' | 'vote';
  issues: ValidationIssue[];
  votes: TeamVote[];
  atS: number;
}

/** Destino de un ping (señalar algo al equipo). */
export type PingTarget =
  | { kind: 'subsystem'; id: SubsystemId }
  | { kind: 'component'; id: string }
  | { kind: 'resource'; id: ResourceId }
  | { kind: 'point'; position: [number, number, number] };

/**
 * Única acción que un cliente envía a la sala (mensaje `action`, validado con `teamActionSchema`).
 *  - claim-roles: reemplaza mis roles (se rechaza si alguno lo tiene otro jugador).
 *  - auto-assign-roles / start-mission: anfitrión (reparto con `combineRoles` / lobby → briefing).
 *  - start-design: Dirección, briefing → design.
 *  - remove-component: quita la ÚLTIMA unidad montada de ese componente.
 */
export type TeamAction =
  | { type: 'set-name'; name: string }
  | { type: 'claim-roles'; roles: TeamRole[] }
  | { type: 'auto-assign-roles' }
  | { type: 'start-mission' }
  | { type: 'start-design' }
  | { type: 'add-component'; componentId: string }
  | { type: 'remove-component'; componentId: string }
  | { type: 'select-orbit'; orbitId: OrbitId | null }
  | { type: 'select-launcher'; launcherId: string | null }
  | { type: 'allocate-budget'; allocation: SubsystemAllocation | null }
  | { type: 'request-resource'; resource: ResourceId; amount?: number; subsystem?: SubsystemId; note?: string }
  | { type: 'resolve-request'; requestId: string; approve: boolean; note?: string }
  | { type: 'withdraw-request'; requestId: string }
  | { type: 'request-review' }
  | { type: 'vote'; role: TeamRole; value: GoNoGoVoteValue; reason?: NoGoReason }
  | { type: 'confirm-launch' }
  | { type: 'launch-done' }
  | { type: 'set-time-scale'; accel: number }
  | { type: 'ack-alert'; alertId: string; role: TeamRole }
  | { type: 'finish-operation' }
  | { type: 'redesign' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; target: PingTarget };

export type ResourceRequestStatus = 'open' | 'approved' | 'rejected' | 'withdrawn';

/** Solicitud de recursos (automática por una acción de diseño, o explícita con `request-resource`). */
export interface ResourceRequest {
  id: string;
  fromPlayerId: string;
  fromRole: TeamRole;
  toRole: TeamRole;
  resource: ResourceId;
  /** Cantidad en la unidad del recurso (`RESOURCE_UNITS`); ausente en una explícita sin cantidad. */
  amount?: number;
  subsystem?: SubsystemId;
  componentId?: string;
  /** Acción de diseño en espera (solo solicitudes automáticas). Aprobar la re-aplica sobre el diseño actual. */
  action?: TeamAction;
  /** Texto libre del solicitante. */
  note?: string;
  status: ResourceRequestStatus;
  resolvedByPlayerId?: string;
  /** Texto libre de quien resolvió (p. ej. "propón otra solución"). */
  resolutionNote?: string;
  createdAtS: number;
  resolvedAtS?: number;
  /** Aditivo: explicación del motor (por qué hace falta aprobación), `team.request.*`. */
  why?: MessageRef;
  /** Aditivo: motivo del sistema si se rechazó al aprobar (la acción ya no tenía sentido). */
  resolutionReason?: MessageRef;
  /** Aditivo: roles que ya aprobaron la acción en espera (solicitudes encadenadas). */
  approvedBy?: TeamRole[];
}

export interface AlertAck {
  role: TeamRole;
  playerId: string;
  atS: number;
}

/** Alerta de equipo abierta por un evento de `EVENT_RESPONSE_ROLES` (pausa la simulación). */
export interface TeamAlert {
  id: string;
  event: SimEvent;
  requiredRoles: TeamRole[];
  acks: AlertAck[];
  raisedAtS: number;
  closedAtS: number | null;
  /** true si se cerró por `alertTimeoutS` sin todas las respuestas. */
  timedOut: boolean;
}

/** Pose del avatar en el hangar o la sala de control (metros y radianes). */
export interface AvatarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface TeamPlayer {
  /** sessionId de Colyseus. */
  id: string;
  name: string;
  roles: TeamRole[];
  connected: boolean;
  isHost: boolean;
  pose: AvatarPose | null;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  roles: TeamRole[];
  text: string;
  atS: number;
}

/** Lo que dice la mascota de la sala: cada cliente muestra `pickMascotDialogue(trigger, mascot, variant)`. */
export interface MascotCue {
  trigger: string;
  variant: number;
  /** Contador creciente: cambia aunque se repita el disparador. */
  seq: number;
  atS: number;
}

/** Puntuación de colaboración (`scoreCollaboration`), aparte de `MissionResult`. */
export interface CollaborationScore {
  /** 0-100. */
  score: number;
  /** Solicitudes que cuentan (las retiradas no). */
  requestsTotal: number;
  requestsResolved: number;
  avgRequestResponseS: number | null;
  alertsTotal: number;
  alertAcksExpected: number;
  alertAcksOnTime: number;
  avgAlertResponseS: number | null;
  /** Criterios 0-1 presentes (`requests`, `alerts`). */
  criteria: Record<string, number>;
}

/** Estado de la simulación de la sala. */
export interface RoomSimView {
  /** Aceleración elegida (`TEAM_TIME_SCALES`); se conserva durante una pausa por alerta. */
  accel: number;
  /** Segundos de misión simulados (los clientes que reflejan la simulación avanzan hasta aquí). */
  simT: number;
  snapshot: SimSnapshot | null;
  /** Resultado del lanzamiento; null hasta que se sabe. */
  launchOk: boolean | null;
  finished: boolean;
  /** Pausada por una alerta abierta. */
  paused: boolean;
}

/** Vista plana del estado de la sala (lo que lee la UI): `decodeRoomView(room.state.toJSON())`. */
export interface RoomView {
  roomId: string;
  scenarioId: string;
  phase: RoomPhase;
  /** Intento (0, 1, …): sube con `redesign`. */
  attempt: number;
  /** Semilla del intento (= defaultSeed del escenario + intento, salvo la opción de desarrollo). */
  seed: number;
  /** Jugador anfitrión; null si la sala está vacía. */
  hostId: string | null;
  /** En orden de llegada. */
  players: TeamPlayer[];
  /** `design.scenarioId` es siempre `scenarioId`. */
  design: MissionDesign;
  allocation: SubsystemAllocation | null;
  requests: ResourceRequest[];
  votes: TeamVote[];
  lastNoGo: NoGoRecord | null;
  preLaunch: PreLaunchOutcome | null;
  sim: RoomSimView;
  /** Eventos de la operación (últimos `TEAM_LIMITS.eventHistory`). */
  events: SimEvent[];
  alerts: TeamAlert[];
  result: MissionResult | null;
  collaboration: CollaborationScore | null;
  /** `withCollaboration(result.score, collaboration.score)`. */
  teamScore: ScoreBreakdown | null;
  mascot: MascotCue | null;
  /** Últimos `TEAM_LIMITS.chatHistory` mensajes. */
  chat: ChatMessage[];
}

/** Mensaje efímero `notice` del servidor a un cliente. */
export type ServerNotice =
  | { kind: 'rejected'; action: TeamAction['type']; reason: MessageRef }
  | { kind: 'request-created'; requestId: string }
  | { kind: 'ping'; playerId: string; role: TeamRole | null; target: PingTarget; atS: number };

/** Jugador en el estado de Colyseus: solo primitivos + `roles: string[]`. Mapeo en teamWire.ts. */
export interface PlayerWire {
  id: string;
  name: string;
  roles: string[];
  connected: boolean;
  isHost: boolean;
  /** Orden de llegada (al decodificar, los jugadores se ordenan por este número). */
  order: number;
  /** false = pose null (x, y, z, yaw se ignoran). */
  hasPose: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Estado sincronizado de la sala tal como lo guarda el esquema de Colyseus: SOLO primitivos,
 * arrays de string y el mapa `players`. Los objetos profundos van como cadenas JSON (`''` = null) y
 * las listas de objetos como arrays de cadenas JSON (un elemento por item, para que Colyseus mande
 * deltas). Mapeo campo a campo con `RoomView` en la cabecera de teamWire.ts.
 */
export interface RoomStateWire {
  roomId: string;
  scenarioId: string;
  phase: string;
  attempt: number;
  seed: number;
  hostId: string;
  players: Record<string, PlayerWire>;
  componentIds: string[];
  orbitId: string;
  launcherId: string;
  allocation: string;
  requests: string[];
  votes: string[];
  lastNoGo: string;
  preLaunch: string;
  simAccel: number;
  simT: number;
  simSnapshot: string;
  /** '' = desconocido, 'success' | 'failure'. */
  simLaunch: string;
  simFinished: boolean;
  simPaused: boolean;
  events: string[];
  alerts: string[];
  result: string;
  collaboration: string;
  teamScore: string;
  mascot: string;
  chat: string[];
}

/** Efecto de una acción de diseño sobre un recurso (`actionImpact`). */
export interface ResourceImpact {
  resource: ResourceId;
  before: ResourceStatus;
  after: ResourceStatus;
  /** Cambio del valor usado (unidad del recurso). */
  usedDelta: number;
  /** Disponible > 0 antes y después (si no, el estado no dice nada). */
  evaluable: boolean;
  /** Aditivo: cambio del disponible (p. ej. la vida útil baja al añadir piezas). */
  availableDelta: number;
  /** Aditivo: el estado empeora (ok → tight|over, tight → over). */
  worsened: boolean;
  /** Aditivo: código de unidad (`unit.<código>` en los locales). */
  unit: string;
}

/** Contexto de `checkTeamAction`. Las listas opcionales ausentes se tratan como vacías. */
export interface TeamActionContext {
  phase: RoomPhase;
  actorRoles: readonly TeamRole[];
  isHost: boolean;
  design: MissionDesign;
  allocation: SubsystemAllocation | null;
  catalog?: Catalog;
  requests?: readonly ResourceRequest[];
  /** Reservado: el voto se puede cambiar (cuenta el último), así que no se usa para rechazar. */
  votes?: readonly TeamVote[];
  /** Aditivo: id del jugador que actúa (solo el autor retira su solicitud; roles ocupados por otros). */
  actorId?: string;
  /** Aditivo: jugadores de la sala (roles ocupados en `claim-roles`, roles cubiertos en `start-mission`). */
  players?: readonly Pick<TeamPlayer, 'id' | 'roles' | 'connected'>[];
  /** Aditivo: alertas de la sala (para `ack-alert`). */
  alerts?: readonly TeamAlert[];
}

/** Solicitud que genera una acción (automática o explícita). */
export interface TeamRequestCheck {
  kind: 'request';
  toRole: TeamRole;
  resource: ResourceId;
  /** En la unidad del recurso; 0 en una explícita sin cantidad. */
  amount: number;
  subsystem?: SubsystemId;
  /** Aditivo: rol del solicitante que motiva la acción. */
  fromRole: TeamRole;
  /** Aditivo: pieza implicada (add/remove). */
  componentId?: string;
  /** Aditivo: explicación para la UI (`team.request.*`). */
  why: MessageRef;
  /** Aditivo: roles que ya aprobaron esta acción (cadena de aprobaciones). */
  approvedBy?: TeamRole[];
}

/** Veredicto de `checkTeamAction`: aplicar, convertir en solicitud o rechazar con motivo. */
export type TeamActionCheck = { kind: 'apply' } | TeamRequestCheck | { kind: 'reject'; reason: MessageRef };

/** Resultado de aprobar una solicitud (`applyApprovedRequest`). */
export type ApprovalOutcome =
  | { kind: 'applied'; design: MissionDesign; allocation: SubsystemAllocation | null }
  /** La acción toca además un recurso de otro rol: nueva solicitud encadenada (la asignación ya se actualizó). */
  | { kind: 'request'; check: TeamRequestCheck; allocation: SubsystemAllocation | null }
  | { kind: 'reject'; reason: MessageRef };

/** Entrada de `scoreCollaboration`. */
export interface CollaborationInput {
  requests: readonly Pick<ResourceRequest, 'status' | 'createdAtS' | 'resolvedAtS'>[];
  alerts: readonly Pick<TeamAlert, 'requiredRoles' | 'acks' | 'raisedAtS'>[];
  /** Segundo de sala en que se puntúa (fin de la operación). */
  endedAtS: number;
  /**
   * Aditivo: acumulados de las solicitudes que el servidor ya purgó del estado (`purgeRequests`).
   * `scoreCollaboration({ requests: kept, purged })` da exactamente lo mismo que con la lista completa.
   */
  purged?: PurgedRequestStats;
}

/**
 * Acumulados de solicitudes CERRADAS purgadas del historial (`purgeRequests`). Las retiradas no cuentan
 * (tampoco cuentan en la nota) y las abiertas nunca se purgan.
 */
export interface PurgedRequestStats {
  /** Purgadas que cuentan para la nota (aprobadas o rechazadas). */
  requestsTotal: number;
  /** De ellas, resueltas (hoy siempre = requestsTotal; se separa por si se purgan otros estados). */
  requestsResolved: number;
  /** Σ crédito de respuesta (0-1 cada una), sumado en orden de la lista. */
  requestCreditSum: number;
  /** Σ tiempos de respuesta (s), sumado en orden de la lista. */
  responseSumS: number;
  /** Nº de tiempos sumados en `responseSumS`. */
  responseCount: number;
}

/**
 * Cubeta de fichas de un jugador para solicitudes (`takeRequestToken`): capacidad
 * `TEAM_LIMITS.requestBurst`, se repone una ficha cada `TEAM_LIMITS.requestMinIntervalS`.
 */
export interface RequestRateBucket {
  tokens: number;
  /** Segundo de sala de la última actualización. */
  updatedAtS: number;
}

/** Resultado de `takeRequestToken`: guarda `bucket` en ambos casos; sin ficha, `reason` = `team.reject.requestRateLimited`. */
export type RequestTokenResult =
  | { ok: true; bucket: RequestRateBucket }
  | { ok: false; bucket: RequestRateBucket; reason: MessageRef };
