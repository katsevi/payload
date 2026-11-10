/**
 * Esquema de estado de la sala (Colyseus schema 5, API sin decoradores). Refleja EXACTAMENTE
 * `RoomStateWire`/`PlayerWire` de `@payload/shared` (mismos nombres y tipos de campo; mapeo con
 * `RoomView` en la cabecera de packages/shared/src/teamWire.ts). El cliente no necesita esta clase:
 * Colyseus le envía la reflexión del esquema y hace `decodeRoomView(room.state.toJSON())`.
 *
 * `StateWriter.write(view)` codifica la vista (`createCachedEncoder`: lo mismo que `encodeRoomView` de shared,
 * pero sin re-serializar lo que no cambió) y escribe en el esquema SOLO lo que cambia, para que Colyseus
 * mande deltas pequeños:
 *  - primitivos y cadenas JSON: se asignan solo si difieren;
 *  - arrays de cadenas (componentIds, requests, votes, events, alerts, chat, roles): se detecta el
 *    recorte por delante (historial de eventos/chat que supera su tope) y se borra con `splice(0, k)`;
 *    luego se actualiza por índice lo que difiere, se añade al final lo nuevo y se recorta lo que sobra;
 *  - `players`: mapa por sessionId; se crean, actualizan campo a campo o borran jugadores.
 *
 * OJO con los números: `t.number()` de schema 5 manda los NO enteros como float32 (3.1 llega como
 * 3.0999999…). `simT` debe llegar exacto (los clientes que reflejan la simulación avanzan hasta él) y las
 * poses y la semilla también, así que van en `t.float64()`. `t.number()` solo para enteros pequeños.
 */
import { Encoder, schema, t, type ArraySchema, type MapSchema, type SchemaType } from '@colyseus/schema';
import type { PlayerWire, RoomStateWire, RoomView, TeamPlayer } from '@payload/shared';

/**
 * El `result` completo (con ~1000 eventos) ronda los 116 KB en JSON y el historial de eventos otros
 * ~40 KB: el estado completo de una sala en el informe cabe en 256 KB sin que el codificador tenga que
 * crecer (crecería solo, pero avisando por consola). Se fija antes de crear cualquier sala.
 */
export const STATE_BUFFER_BYTES = 256 * 1024;
if (Encoder.BUFFER_SIZE < STATE_BUFFER_BYTES) Encoder.BUFFER_SIZE = STATE_BUFFER_BYTES;

export const PlayerState = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    roles: t.array('string'),
    connected: t.boolean().default(false),
    isHost: t.boolean().default(false),
    order: t.number().default(0),
    hasPose: t.boolean().default(false),
    x: t.float64().default(0),
    y: t.float64().default(0),
    z: t.float64().default(0),
    yaw: t.float64().default(0),
  },
  'PlayerWire',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const MissionState = schema(
  {
    roomId: t.string().default(''),
    scenarioId: t.string().default(''),
    phase: t.string().default('lobby'),
    attempt: t.number().default(0),
    seed: t.float64().default(0),
    hostId: t.string().default(''),
    players: t.map(PlayerState),
    componentIds: t.array('string'),
    orbitId: t.string().default(''),
    launcherId: t.string().default(''),
    allocation: t.string().default(''),
    requests: t.array('string'),
    votes: t.array('string'),
    lastNoGo: t.string().default(''),
    preLaunch: t.string().default(''),
    simAccel: t.float64().default(1),
    simT: t.float64().default(0),
    simSnapshot: t.string().default(''),
    simLaunch: t.string().default(''),
    simFinished: t.boolean().default(false),
    simPaused: t.boolean().default(false),
    events: t.array('string'),
    alerts: t.array('string'),
    result: t.string().default(''),
    collaboration: t.string().default(''),
    teamScore: t.string().default(''),
    mascot: t.string().default(''),
    chat: t.array('string'),
  },
  'RoomStateWire',
);
export type MissionState = SchemaType<typeof MissionState>;

type Scalar = string | number | boolean;
type ScalarKeys<T> = { [K in keyof T]-?: T[K] extends Scalar ? K : never }[keyof T];
type StringArrayKeys<T> = { [K in keyof T]-?: T[K] extends string[] ? K : never }[keyof T];

const ROOM_SCALARS = [
  'roomId', 'scenarioId', 'phase', 'attempt', 'seed', 'hostId', 'orbitId', 'launcherId', 'allocation', 'lastNoGo', 'preLaunch',
  'simAccel', 'simT', 'simSnapshot', 'simLaunch', 'simFinished', 'simPaused', 'result', 'collaboration', 'teamScore', 'mascot',
] as const satisfies readonly ScalarKeys<RoomStateWire>[];
const ROOM_ARRAYS = ['componentIds', 'requests', 'votes', 'events', 'alerts', 'chat'] as const satisfies readonly StringArrayKeys<RoomStateWire>[];
const PLAYER_SCALARS = [
  'id', 'name', 'connected', 'isHost', 'order', 'hasPose', 'x', 'y', 'z', 'yaw',
] as const satisfies readonly ScalarKeys<PlayerWire>[];

// Comprobación en compilación: el esquema cubre TODOS los campos del contrato (si `RoomStateWire` gana un
// campo y no se añade aquí, tsc falla).
type Covered<All, Listed> = Exclude<All, Listed> extends never ? true : Exclude<All, Listed>;
const roomCovered: Covered<keyof RoomStateWire, (typeof ROOM_SCALARS)[number] | (typeof ROOM_ARRAYS)[number] | 'players'> = true;
const playerCovered: Covered<keyof PlayerWire, (typeof PLAYER_SCALARS)[number] | 'roles'> = true;
void roomCovered;
void playerCovered;

/** Primer desplazamiento k > 0 tal que `cur[k..]` es prefijo de `next` (recorte por delante), o 0. */
function frontTrim(cur: ArraySchema<string>, next: readonly string[]): number {
  const first = next[0];
  if (cur.length === 0 || first === undefined || cur.at(0) === first) return 0;
  for (let k = 1; k < cur.length; k++) {
    if (cur.at(k) !== first) continue;
    const overlap = Math.min(cur.length - k, next.length);
    let ok = true;
    for (let i = 1; i < overlap && ok; i++) ok = cur.at(k + i) === next[i];
    if (ok) return k;
  }
  return 0;
}

/** Deja `cur` igual a `next` con las mínimas operaciones (ver cabecera). */
export function syncStringArray(cur: ArraySchema<string>, next: readonly string[]): void {
  const k = frontTrim(cur, next);
  if (k > 0) cur.splice(0, k);
  const n = Math.min(cur.length, next.length);
  for (let i = 0; i < n; i++) {
    const value = next[i]!;
    if (cur.at(i) !== value) cur[i] = value;
  }
  if (next.length > cur.length) cur.push(...next.slice(cur.length));
  else if (cur.length > next.length) cur.splice(next.length, cur.length - next.length);
}

// Escritura por nombre de campo: los campos de `schema()` son propiedades normales con setters de
// seguimiento; el tipo se garantiza con las listas `satisfies` de arriba.
type Writable = Record<string, Scalar>;

function syncPlayers(map: MapSchema<PlayerState>, next: Record<string, PlayerWire>): void {
  for (const id of [...map.keys()]) if (!Object.hasOwn(next, id)) map.delete(id);
  for (const [id, wire] of Object.entries(next)) {
    let player = map.get(id);
    if (!player) {
      player = new PlayerState();
      map.set(id, player);
    }
    const target = player as unknown as Writable;
    for (const key of PLAYER_SCALARS) if (target[key] !== wire[key]) target[key] = wire[key];
    syncStringArray(player.roles, wire.roles);
  }
}

/** Escribe un `RoomStateWire` en el esquema tocando solo lo que cambia. */
export function writeWire(state: MissionState, wire: RoomStateWire): void {
  const target = state as unknown as Writable;
  for (const key of ROOM_SCALARS) if (target[key] !== wire[key]) target[key] = wire[key];
  for (const key of ROOM_ARRAYS) syncStringArray(state[key], wire[key]);
  syncPlayers(state.players, wire.players);
}

/**
 * Codificador `RoomView → RoomStateWire` IDÉNTICO a `encodeRoomView` de shared (mapeo en la cabecera de
 * packages/shared/src/teamWire.ts; un test lo compara con el de shared en todas las vistas de una partida),
 * pero con el JSON de cada objeto cacheado por REFERENCIA (WeakMap): lo que no cambió no se vuelve a
 * serializar (el `result` de ~116 KB en el informe, cada evento, solicitud, alerta o mensaje de chat).
 * Válido porque `RoomModel` nunca muta un objeto ya publicado: todo cambio crea uno nuevo.
 */
export function createCachedEncoder(): (view: RoomView) => RoomStateWire {
  const cache = new WeakMap<object, string>();
  const json = (value: object | null | undefined): string => {
    if (value === null || value === undefined) return '';
    let s = cache.get(value);
    if (s === undefined) {
      s = JSON.stringify(value);
      cache.set(value, s);
    }
    return s;
  };
  const player = (p: TeamPlayer, order: number): PlayerWire => ({
    id: p.id,
    name: p.name,
    roles: [...p.roles],
    connected: p.connected,
    isHost: p.isHost,
    order,
    hasPose: p.pose !== null,
    x: p.pose?.x ?? 0,
    y: p.pose?.y ?? 0,
    z: p.pose?.z ?? 0,
    yaw: p.pose?.yaw ?? 0,
  });
  return (view) => {
    const players: Record<string, PlayerWire> = {};
    view.players.forEach((p, i) => {
      players[p.id] = player(p, i);
    });
    return {
      roomId: view.roomId,
      scenarioId: view.scenarioId,
      phase: view.phase,
      attempt: view.attempt,
      seed: view.seed,
      hostId: view.hostId ?? '',
      players,
      componentIds: [...view.design.componentIds],
      orbitId: view.design.orbitId ?? '',
      launcherId: view.design.launcherId ?? '',
      allocation: json(view.allocation),
      requests: view.requests.map(json),
      votes: view.votes.map(json),
      lastNoGo: json(view.lastNoGo),
      preLaunch: json(view.preLaunch),
      simAccel: view.sim.accel,
      simT: view.sim.simT,
      simSnapshot: json(view.sim.snapshot),
      simLaunch: view.sim.launchOk === null ? '' : view.sim.launchOk ? 'success' : 'failure',
      simFinished: view.sim.finished,
      simPaused: view.sim.paused,
      events: view.events.map(json),
      alerts: view.alerts.map(json),
      result: json(view.result),
      collaboration: json(view.collaboration),
      teamScore: json(view.teamScore),
      mascot: json(view.mascot),
      chat: view.chat.map(json),
    };
  };
}

/** Escribe vistas sucesivas de la sala en su esquema (solo si la vista cambió de identidad). */
export class StateWriter {
  private last: RoomView | null = null;
  private readonly encode = createCachedEncoder();

  constructor(readonly state: MissionState) {}

  /** true si había algo nuevo que escribir. */
  write(view: RoomView): boolean {
    if (view === this.last) return false;
    writeWire(this.state, this.encode(view));
    this.last = view;
    return true;
  }
}
