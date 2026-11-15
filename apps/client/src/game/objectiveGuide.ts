/**
 * Guía del objetivo en vuelo (PURO, sin React ni Three.js). Lo que el motor da con `currentObjective` se traduce aquí a
 * decisiones de interfaz: cuándo avisar de un objetivo nuevo o cumplido, qué puesto señalar, cómo se llama, cómo se
 * pinta el progreso, adónde saltar primero y qué misión recomendar para empezar. Tests: `objective.test.ts`.
 */
import type { MessageRef, MissionDef, ObjectiveProgress, ObjectiveStationId, ObjectiveStep, ObjectiveView, RunPhase, SectorMap } from '@payload/shared';

// ─── Avisos: objetivo nuevo y paso cumplido ─────────────────────────────────────────────────────

/** Lo que se recuerda de la última vista para compararla con la siguiente. */
export interface ObjectiveMemo {
  /** Identidad del paso actual (`objectiveKey`); '' si no hay paso actual. */
  key: string;
  /** Pasos hechos (por id). */
  done: string[];
  awaitingNextSector: boolean;
}

export type ObjectiveNotice =
  | { kind: 'new'; step: ObjectiveStep }
  | { kind: 'done'; step: ObjectiveStep }
  | { kind: 'next-sector' };

/**
 * Identidad del paso actual: id del paso + su texto (clave y parámetros). Cambia si cambia lo que hay que hacer (otro
 * paso, otra avería) pero NO con el progreso ni con la ayuda, que puede cambiar a cada tick (`nextWindow {seconds}`).
 * El título entra para que un sector nuevo con el mismo paso (`exit`) cuente como objetivo nuevo.
 */
export function objectiveKey(view: ObjectiveView): string {
  const step = view.current >= 0 ? view.steps[view.current] : undefined;
  if (!step) return '';
  return `${refKey(view.title)}#${step.id}#${refKey(step.text)}`;
}

const refKey = (m: MessageRef): string => (m.params ? `${m.key}${JSON.stringify(m.params)}` : m.key);

export function memoOf(view: ObjectiveView): ObjectiveMemo {
  return { key: objectiveKey(view), done: view.steps.filter((s) => s.done).map((s) => s.id), awaitingNextSector: view.awaitingNextSector };
}

/**
 * Avisos que tocan al pasar de `prev` a `view`. Sin `prev` (al zarpar o al entrar en la sala), solo el objetivo actual.
 * Con la misión terminada o la partida perdida no se avisa nada (la pantalla final manda). Orden: lo cumplido primero.
 */
export function objectiveNotices(prev: ObjectiveMemo | null, view: ObjectiveView): ObjectiveNotice[] {
  if (view.status !== 'active') return [];
  const cur = view.current >= 0 ? view.steps[view.current] : undefined;
  if (!prev) return cur && !view.awaitingNextSector ? [{ kind: 'new', step: cur }] : [];
  const out: ObjectiveNotice[] = [];
  const wasDone = new Set(prev.done);
  // Solo el primer paso recién cumplido: dos a la vez (p. ej. al volver de un tramo) serían ruido.
  const justDone = view.steps.find((s) => s.done && !wasDone.has(s.id));
  if (justDone) out.push({ kind: 'done', step: justDone });
  if (view.awaitingNextSector) {
    if (!prev.awaitingNextSector) out.push({ kind: 'next-sector' });
    return out;
  }
  const key = objectiveKey(view);
  if (cur && key !== prev.key) out.push({ kind: 'new', step: cur });
  return out;
}

// ─── Puesto que señalar ─────────────────────────────────────────────────────────────────────────

const NAMED_STATIONS: ReadonlySet<string> = new Set(['helm', 'map', 'power', 'airlock']);

/** Clave i18n del nombre del puesto: `station.*` (ui) o `systemName.*` (sim, una avería). Con diseño, el mapa es solar. */
export function stationLabel(station: ObjectiveStationId, solar: boolean): { key: string; ns: 'ui' | 'sim' } {
  if (station === 'map' && solar) return { key: 'station.solarMap', ns: 'ui' };
  if (NAMED_STATIONS.has(station)) return { key: `station.${station}`, ns: 'ui' };
  return { key: `systemName.${station}`, ns: 'sim' };
}

/**
 * Puesto al que guiar dentro de la nave ahora mismo, o null. En pleno salto el mapa no sirve (no se puede saltar), así
 * que no se manda al jugador allí; tampoco con la misión terminada o perdida.
 */
export function guideStation(view: ObjectiveView, phase: RunPhase): ObjectiveStationId | null {
  if (view.status !== 'active' || !view.station) return null;
  if (phase === 'transit' && view.station === 'map') return null;
  if (phase === 'won' || phase === 'lost') return null;
  return view.station;
}

// ─── Progreso ───────────────────────────────────────────────────────────────────────────────────

/** Texto del progreso (clave ui `objective.progress.<unidad>`) y fracción 0-1 para la barra. */
export function progressView(p: ObjectiveProgress): { key: string; params: { value: number; max: number }; frac: number } {
  const frac = p.max > 0 ? Math.max(0, Math.min(1, p.value / p.max)) : 0;
  const value = p.unit === 's' ? Math.floor(p.value) : Math.floor(p.value * 10 + 1e-6) / 10;
  return { key: `objective.progress.${p.unit}`, params: { value: p.unit === 'jumps' ? Math.round(p.value) : value, max: p.max }, frac };
}

// ─── Panel desplegado o compacto ────────────────────────────────────────────────────────────────

/**
 * ¿Lista completa por defecto? En la misión guiada y en el sector 1 de la partida libre (es la guía), salvo que el
 * jugador haya ocultado la guía detallada en los ajustes.
 */
export function defaultExpanded(view: ObjectiveView, guidedMission: boolean, showGuide: boolean, sectorIndex: number): boolean {
  if (!showGuide) return false;
  return view.mode === 'mission' ? guidedMission : sectorIndex === 1;
}

// ─── Mapa: adónde saltar ────────────────────────────────────────────────────────────────────────

/**
 * Primer salto del camino más corto (en saltos) de `fromId` a `targetId` por los enlaces del sector, o null si no hay
 * camino o ya se está allí. Empate: el primer enlace en el orden del sector (estable entre refrescos).
 */
export function nextHopToward(sector: SectorMap, fromId: string, targetId: string): string | null {
  if (fromId === targetId) return null;
  const byId = new Map(sector.nodes.map((n) => [n.id, n]));
  if (!byId.has(fromId) || !byId.has(targetId)) return null;
  const firstHop = new Map<string, string>();
  const queue: string[] = [];
  for (const id of byId.get(fromId)!.links) {
    if (firstHop.has(id) || !byId.has(id)) continue;
    firstHop.set(id, id);
    queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (id === targetId) return firstHop.get(id)!;
    for (const next of byId.get(id)!.links) {
      if (next === fromId || firstHop.has(next) || !byId.has(next)) continue;
      firstHop.set(next, firstHop.get(id)!);
      queue.push(next);
    }
  }
  return null;
}

// ─── Misión recomendada para empezar ────────────────────────────────────────────────────────────

/** La misión para empezar: la guiada más fácil; sin guiadas, la más fácil (en empate, la primera del catálogo). */
export function recommendedMissionId(missions: readonly MissionDef[]): string | null {
  const pool = missions.some((m) => m.guided) ? missions.filter((m) => m.guided) : missions;
  let best: MissionDef | null = null;
  for (const m of pool) if (!best || m.difficulty < best.difficulty) best = m;
  return best?.id ?? null;
}

/** Misión señalada al abrir el selector: la última elegida si sigue existiendo; si no, la recomendada. */
export function defaultMissionId(missions: readonly MissionDef[], lastId: string | null): string | null {
  if (lastId && missions.some((m) => m.id === lastId)) return lastId;
  return recommendedMissionId(missions);
}

const LAST_MISSION_KEY = 'payload.lastMission';

/** Última misión abierta en el hangar (localStorage; null sin almacenamiento). */
export function loadLastMission(): string | null {
  try {
    return localStorage.getItem(LAST_MISSION_KEY);
  } catch {
    return null;
  }
}

export function saveLastMission(missionId: string): void {
  try {
    localStorage.setItem(LAST_MISSION_KEY, missionId);
  } catch {
    /* sin almacenamiento */
  }
}
