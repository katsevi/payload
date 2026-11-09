/**
 * Lógica pura de la vista del instrumento (sin React): qué muestra el visor según el estado de la
 * misión. Todo sale del motor (snapshot y eventos); aquí solo se interpreta para la presentación.
 */
import { catalog, type Catalog, type ComponentDef, type MissionType, type SimStatus } from '@payload/shared';

/** Qué ve el instrumento. */
export type InstrumentTarget = 'earth' | 'stars' | 'moon' | 'mars';

export function instrumentTarget(missionType: MissionType | undefined): InstrumentTarget {
  switch (missionType) {
    case 'space-telescope': return 'stars';
    case 'lunar-exploration': return 'moon';
    case 'mars-exploration': return 'mars';
    default: return 'earth';
  }
}

/** Estado de presentación del visor. `condition` resume el más grave (perdido > eclipse > degradado > nominal). */
export type InstrumentCondition = 'nominal' | 'eclipse' | 'degraded' | 'lost' | 'noInstrument';

/** Subconjunto de `SimEvent` que usa la lógica (acepta también los eventos con id del store). */
export interface InstrumentEvent {
  type: string;
  message?: { key: string; params?: Record<string, unknown> };
}

export interface InstrumentInput {
  /** Instrumentos ópticos del diseño (subsistema `payload` SIN el rover: este solo cuenta para la vista de superficie). */
  payloadCount: number;
  /** Apuntado requerido por el instrumento principal (°). Si se omite, no se puede comparar y cualquier aviso de apuntado degrada. */
  requiredPointingDeg?: number;
  inEclipse: boolean;
  status: SimStatus;
  /** Eventos acumulados de la misión. */
  events: readonly InstrumentEvent[];
}

export interface InstrumentState {
  condition: InstrumentCondition;
  /** Imagen oscura (eclipse). */
  dark: boolean;
  /** Apuntado degradado: imagen desenfocada y con temblor (rueda de reacción o ADCS averiados). */
  degraded: boolean;
  /** Sin imagen: todos los instrumentos perdidos o la misión terminó en fallo. */
  lost: boolean;
  /** Por qué se perdió (para el texto). */
  lostReason: 'payload' | 'mission' | null;
  /** 0-1 intensidad del desenfoque. */
  blur: number;
  /** 0-1 intensidad del temblor. */
  shake: number;
  /** Instrumentos averiados hasta ahora. */
  failedPayloads: number;
}

const PAYLOAD_FAILURE_KEY = 'event.componentFailure.payload';
const ADCS_FAILURE_KEY = 'event.componentFailure.adcs';

export function instrumentState(input: InstrumentInput): InstrumentState {
  const { payloadCount, inEclipse, status, events, requiredPointingDeg } = input;
  let failedPayloads = 0;
  let allGone = false;
  let pointingEvents = false;
  /** Apuntado resultante (°) según los parámetros de los eventos; null si el motor no lo informa. */
  let pointingDeg: number | null = null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  for (const e of events) {
    const p = e.message?.params;
    if (e.type === 'reaction-wheel-failure') {
      pointingEvents = true;
      const deg = num(p?.pointingDeg) ?? num(p?.backupDeg);
      if (deg !== null) pointingDeg = Math.max(pointingDeg ?? 0, deg);
    }
    if (e.type !== 'component-failure') continue;
    const key = e.message?.key;
    if (key === ADCS_FAILURE_KEY) {
      pointingEvents = true;
      const deg = num(p?.pointingDeg) ?? num(p?.accuracyDeg);
      if (deg !== null) pointingDeg = deg;
    }
    if (key === PAYLOAD_FAILURE_KEY) {
      // El rover averiado no afecta a la vista orbital.
      if (typeof p?.component === 'string' && roverComponentIds([p.component]).length > 0) continue;
      failedPayloads++;
      if (p?.remaining === 0) allGone = true;
    }
  }
  // Desenfoque: el apuntado resultante frente al requerido; sin dato de apuntado, cualquier aviso degrada.
  const pointingLost =
    pointingEvents &&
    (pointingDeg === null ? true : requiredPointingDeg === undefined ? false : pointingDeg > requiredPointingDeg);
  if (payloadCount > 0 && failedPayloads >= payloadCount) allGone = true;

  if (payloadCount === 0) {
    return { condition: 'noInstrument', dark: false, degraded: false, lost: true, lostReason: null, blur: 0, shake: 0, failedPayloads: 0 };
  }
  const missionLost = status === 'failed';
  const lost = allGone || missionLost;
  const degraded = pointingLost && !lost;
  const dark = inEclipse && !lost;
  const condition: InstrumentCondition = lost ? 'lost' : dark ? 'eclipse' : degraded ? 'degraded' : 'nominal';
  return {
    condition,
    dark,
    degraded,
    lost,
    lostReason: lost ? (allGone ? 'payload' : 'mission') : null,
    blur: degraded ? 1 : 0,
    shake: degraded ? 1 : 0,
    failedPayloads,
  };
}

/** Archivo del modelo del rover Aurora G9 en el catálogo (`model` del componente). */
export const ROVER_MODEL_FILE = 'aurora_g9_expedition_walker_mech.glb';

/** Ids de componentes del diseño que son el rover Aurora (se reconocen por su `model`, no por su id). */
export function roverComponentIds(componentIds: readonly string[], cat: Catalog = catalog): string[] {
  return componentIds.filter((id) => cat.components.find((c) => c.id === id)?.model === ROVER_MODEL_FILE);
}

export const hasRover = (componentIds: readonly string[], cat: Catalog = catalog): boolean => roverComponentIds(componentIds, cat).length > 0;

/** La vista de superficie solo existe en las misiones lunar y marciana con rover. */
export function surfaceKind(missionType: MissionType | undefined, componentIds: readonly string[], cat: Catalog = catalog): 'moon' | 'mars' | null {
  if (!hasRover(componentIds, cat)) return null;
  if (missionType === 'lunar-exploration') return 'moon';
  if (missionType === 'mars-exploration') return 'mars';
  return null;
}

/**
 * Instrumento principal del diseño: el de mejor resolución en suelo; sin resoluciones, el de más valor
 * científico; empate, el primero montado. El rover no cuenta como instrumento de observación.
 */
export function mainInstrument(componentIds: readonly string[], cat: Catalog = catalog): ComponentDef | null {
  const payloads = componentIds
    .map((id) => cat.components.find((c) => c.id === id))
    .filter((c): c is ComponentDef => !!c && c.subsystem === 'payload');
  if (payloads.length === 0) return null;
  const optics = payloads.filter((c) => c.model !== ROVER_MODEL_FILE);
  const pool = optics.length > 0 ? optics : payloads;
  const withRes = pool.filter((c) => c.groundResolutionAt500KmM !== undefined);
  if (withRes.length > 0) return withRes.reduce((a, b) => (b.groundResolutionAt500KmM! < a.groundResolutionAt500KmM! ? b : a));
  return pool.reduce((a, b) => (b.scienceValue > a.scienceValue ? b : a));
}

/** Instrumentos ópticos del diseño: payloads que no son el rover. */
export const payloadCountOf = (componentIds: readonly string[], cat: Catalog = catalog): number =>
  componentIds.filter((id) => {
    const c = cat.components.find((x) => x.id === id);
    return c?.subsystem === 'payload' && c.model !== ROVER_MODEL_FILE;
  }).length;
