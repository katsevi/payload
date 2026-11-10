/**
 * Decodificación del estado de la sala con REFERENCIAS ESTABLES (puro, sin React).
 *
 * `decodeRoomView` (shared) convierte `room.state.toJSON()` en una `RoomView` plana, pero cada llamada
 * crea objetos nuevos y vuelve a parsear todas las cadenas JSON. Aquí se compara el estado "en crudo"
 * con el anterior: las partes que no cambiaron (mismo texto JSON, mismas listas de cadenas) NO se vuelven
 * a parsear y conservan la referencia de la vista anterior. Así, en operación (el servidor publica ~10 Hz)
 * solo cambian `sim` y lo que de verdad cambió, y la UI que selecciona `view.chat`, `view.requests`…
 * no se vuelve a pintar sin motivo.
 */
import { decodeRoomView, type RoomView } from '@payload/shared';

type Wire = Record<string, unknown>;

export interface DecodedRoom {
  view: RoomView;
  /** Estado crudo con el que se decodificó (para comparar con el siguiente). */
  wire: Wire;
  /** `players` serializado (mapa pequeño de objetos). */
  playersKey: string;
}

/** Campos JSON (cadena) que se pueden reutilizar si no cambian. */
const JSON_FIELDS = ['allocation', 'lastNoGo', 'preLaunch', 'simSnapshot', 'result', 'collaboration', 'teamScore', 'mascot'] as const;
/** Listas de cadenas JSON. */
const LIST_FIELDS = ['requests', 'votes', 'events', 'alerts', 'chat'] as const;

const isObj = (x: unknown): x is Wire => typeof x === 'object' && x !== null && !Array.isArray(x);

function sameList(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const keyOf = (players: unknown): string => {
  try {
    return JSON.stringify(players ?? null);
  } catch {
    return '';
  }
};

/**
 * Decodifica `raw` (normalmente `room.state.toJSON()`) reutilizando lo que no cambió respecto a `prev`.
 * Nunca lanza (como `decodeRoomView`).
 */
export function decodeRoomState(raw: unknown, prev: DecodedRoom | null): DecodedRoom {
  const wire: Wire = isObj(raw) ? raw : {};
  const playersKey = keyOf(wire.players);
  if (!prev) return { view: decodeRoomView(wire), wire, playersKey };

  const pw = prev.wire;
  const p = prev.view;
  // Lo que no cambió se vacía antes de decodificar (no se parsea) y luego se toma de la vista anterior.
  const lite: Wire = { ...wire };
  const same = new Set<string>();
  for (const f of JSON_FIELDS) {
    if (wire[f] === pw[f]) {
      lite[f] = '';
      same.add(f);
    }
  }
  for (const f of LIST_FIELDS) {
    if (sameList(wire[f], pw[f])) {
      lite[f] = [];
      same.add(f);
    }
  }
  const fresh = decodeRoomView(lite);

  const designSame = wire.scenarioId === pw.scenarioId && wire.orbitId === pw.orbitId && wire.launcherId === pw.launcherId &&
    sameList(wire.componentIds, pw.componentIds);
  const simScalarsSame = wire.simAccel === pw.simAccel && wire.simT === pw.simT && wire.simLaunch === pw.simLaunch &&
    wire.simFinished === pw.simFinished && wire.simPaused === pw.simPaused;
  const snapshot = same.has('simSnapshot') ? p.sim.snapshot : fresh.sim.snapshot;
  const pick = <K extends keyof RoomView>(k: K, field: string): RoomView[K] => (same.has(field) ? p[k] : fresh[k]);

  const view: RoomView = {
    ...fresh,
    players: playersKey === prev.playersKey ? p.players : fresh.players,
    design: designSame ? p.design : fresh.design,
    allocation: pick('allocation', 'allocation'),
    requests: pick('requests', 'requests'),
    votes: pick('votes', 'votes'),
    lastNoGo: pick('lastNoGo', 'lastNoGo'),
    preLaunch: pick('preLaunch', 'preLaunch'),
    sim: simScalarsSame && same.has('simSnapshot') ? p.sim : { ...fresh.sim, snapshot },
    events: pick('events', 'events'),
    alerts: pick('alerts', 'alerts'),
    result: pick('result', 'result'),
    collaboration: pick('collaboration', 'collaboration'),
    teamScore: pick('teamScore', 'teamScore'),
    mascot: pick('mascot', 'mascot'),
    chat: pick('chat', 'chat'),
  };
  return { view, wire, playersKey };
}
