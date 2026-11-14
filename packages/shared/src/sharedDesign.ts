/**
 * Diseño compartido y voto Go/No-Go del cooperativo (fase 6, ADR 0020). PURO: lo usan el servidor (aplica y valida) y
 * el cliente (convierte los cambios del hangar en ediciones y enseña el voto).
 *
 * - Las ediciones son acciones DISCRETAS (añadir o quitar una pieza, cambiar destino, lanzador o nivel), no una copia
 *   entera del diseño: dos personas pueden editar a la vez sin pisarse el trabajo (ADR 0020 § 2).
 * - El voto: Go si la revisión del motor da Go y vota Go la MAYORÍA ESTRICTA de los conectados; el empate es No-Go.
 */
import { catalog as defaultCatalog } from './catalog';
import { emptyDesign, getDifficulties, getInstruments, getMissions, getModules, getLaunchers, guidedStartDesign } from './design';
import type { Catalog, MissionDesign } from './types';

/** Tope de piezas (módulos + instrumentos) de un diseño compartido: ninguna entrada de red infla la sala. */
export const MAX_DESIGN_PARTS = 40;

/** Módulos que solo van una vez: al añadir otro de la misma familia, sustituye al anterior. */
const SINGLE_KINDS = ['structure', 'propulsion'];

export type DesignEdit =
  | { op: 'add-module'; id: string }
  | { op: 'remove-module'; id: string }
  | { op: 'add-instrument'; id: string }
  | { op: 'remove-instrument'; id: string }
  | { op: 'set-destination'; id: string | null }
  | { op: 'set-launcher'; id: string | null }
  | { op: 'set-difficulty'; id: string }
  /** Vacía módulos e instrumentos (en la misión guiada, solo la carga). */
  | { op: 'clear' };

const DESIGN_OPS = ['add-module', 'remove-module', 'add-instrument', 'remove-instrument', 'set-destination', 'set-launcher', 'set-difficulty', 'clear'] as const;

/** Diseño con el que empieza una misión en la sala: el de la misión guiada, o vacío con el destino si solo hay uno. */
export function missionStartDesign(missionId: string, cat: Catalog = defaultCatalog): MissionDesign | null {
  const mission = getMissions(cat).find((m) => m.id === missionId);
  if (!mission) return null;
  const guided = guidedStartDesign(missionId, cat);
  if (guided) return guided;
  const d = emptyDesign(missionId);
  if (mission.destinations.length === 1) d.destinationId = mission.destinations[0] ?? null;
  return d;
}

/** Valida la forma de una edición que llega por red (los ids los valida `applyDesignEdit`). */
export function parseDesignEdit(raw: unknown): DesignEdit | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.op !== 'string' || !(DESIGN_OPS as readonly string[]).includes(o.op)) return null;
  const op = o.op as DesignEdit['op'];
  if (op === 'clear') return { op };
  const id = o.id;
  if (op === 'set-destination' || op === 'set-launcher') {
    if (id === null) return { op, id: null };
    return typeof id === 'string' && id.length > 0 && id.length <= 64 ? { op, id } : null;
  }
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? ({ op, id } as DesignEdit) : null;
}

/**
 * Aplica una edición. Devuelve el diseño nuevo, o `null` si la edición no vale (id desconocido, destino que la misión no
 * tiene, pieza que la misión guiada no admite, tope de piezas) o no cambia nada. Nunca lanza.
 */
export function applyDesignEdit(design: MissionDesign, edit: DesignEdit, cat: Catalog = defaultCatalog): MissionDesign | null {
  const mission = getMissions(cat).find((m) => m.id === design.missionId);
  if (!mission) return null;
  const guided = mission.guided;
  const parts = design.moduleIds.length + design.instrumentIds.length;
  const without = (list: string[], id: string): string[] | null => {
    const at = list.lastIndexOf(id);
    return at < 0 ? null : [...list.slice(0, at), ...list.slice(at + 1)];
  };
  switch (edit.op) {
    case 'add-module': {
      const def = getModules(cat).find((m) => m.id === edit.id);
      if (!def || guided || parts >= MAX_DESIGN_PARTS) return null;
      const kept = SINGLE_KINDS.includes(def.kind) ? design.moduleIds.filter((id) => getModules(cat).find((m) => m.id === id)?.kind !== def.kind) : design.moduleIds;
      return { ...design, moduleIds: [...kept, edit.id] };
    }
    case 'remove-module': {
      if (guided) return null;
      const next = without(design.moduleIds, edit.id);
      return next ? { ...design, moduleIds: next } : null;
    }
    case 'add-instrument': {
      const def = getInstruments(cat).find((i) => i.id === edit.id);
      if (!def || parts >= MAX_DESIGN_PARTS) return null;
      // La carga de la misión guiada es la suya; los instrumentos CubeSat no van en las demás.
      if (guided ? !guided.instrumentIds.includes(edit.id) : def.cubesat) return null;
      return { ...design, instrumentIds: [...design.instrumentIds, edit.id] };
    }
    case 'remove-instrument': {
      const next = without(design.instrumentIds, edit.id);
      return next ? { ...design, instrumentIds: next } : null;
    }
    case 'set-destination':
      if (guided || edit.id === design.destinationId) return null;
      if (edit.id !== null && !mission.destinations.includes(edit.id)) return null;
      return { ...design, destinationId: edit.id };
    case 'set-launcher':
      if (guided || edit.id === design.launcherId) return null;
      if (edit.id !== null && !getLaunchers(cat).some((l) => l.id === edit.id)) return null;
      return { ...design, launcherId: edit.id };
    case 'set-difficulty':
      if (edit.id === design.difficultyId || !getDifficulties(cat).some((d) => d.id === edit.id)) return null;
      return { ...design, difficultyId: edit.id };
    case 'clear':
      if (design.instrumentIds.length === 0 && (guided || design.moduleIds.length === 0)) return null;
      return { ...design, moduleIds: guided ? design.moduleIds : [], instrumentIds: [] };
  }
}

/** Cuántas veces aparece cada id. */
function counts(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of list) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/**
 * Ediciones que llevan de `from` a `to` (el cliente las calcula tras cada cambio del hangar y las envía en orden):
 * primero lo que se quita, luego lo que se añade y al final destino, lanzador y nivel. Vaciar todo es un `clear`.
 */
export function designEditsBetween(from: MissionDesign, to: MissionDesign): DesignEdit[] {
  const edits: DesignEdit[] = [];
  const emptied = to.moduleIds.length === 0 && to.instrumentIds.length === 0 && from.moduleIds.length + from.instrumentIds.length > 1;
  if (emptied) edits.push({ op: 'clear' });
  else {
    for (const [kind, a, b] of [['module', from.moduleIds, to.moduleIds], ['instrument', from.instrumentIds, to.instrumentIds]] as const) {
      const ca = counts(a);
      const cb = counts(b);
      for (const [id, n] of ca) for (let i = 0; i < n - (cb.get(id) ?? 0); i++) edits.push({ op: kind === 'module' ? 'remove-module' : 'remove-instrument', id });
      for (const [id, n] of cb) for (let i = 0; i < n - (ca.get(id) ?? 0); i++) edits.push({ op: kind === 'module' ? 'add-module' : 'add-instrument', id });
    }
  }
  if (to.destinationId !== from.destinationId) edits.push({ op: 'set-destination', id: to.destinationId });
  if (to.launcherId !== from.launcherId) edits.push({ op: 'set-launcher', id: to.launcherId });
  if (to.difficultyId !== undefined && to.difficultyId !== from.difficultyId) edits.push({ op: 'set-difficulty', id: to.difficultyId });
  return edits;
}

/** Recuento del voto Go/No-Go entre los jugadores conectados (`null` = aún no ha votado). */
export interface VoteTally {
  go: number;
  noGo: number;
  pending: number;
  /** Conectados que cuentan. */
  voters: number;
  /** Mayoría estricta de Go (el empate NO pasa). */
  passed: boolean;
}

export function voteTally(votes: (boolean | null)[]): VoteTally {
  const go = votes.filter((v) => v === true).length;
  const noGo = votes.filter((v) => v === false).length;
  const voters = votes.length;
  return { go, noGo, pending: voters - go - noGo, voters, passed: voters > 0 && go * 2 > voters };
}
