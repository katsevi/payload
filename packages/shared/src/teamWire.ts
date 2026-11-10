/**
 * Red de la sala multijugador (fase 3): esquema zod de `TeamAction` y codificación del estado.
 *
 * `teamActionSchema` valida el mensaje `action` del cliente (Colyseus 0.18 acepta Standard Schema en
 * `onMessage`): rechaza tipos desconocidos, campos de más o de tipo erróneo y textos/ids demasiado
 * largos (`TEAM_LIMITS`). La lógica de juego (fase, permisos, ids del catálogo) es `checkTeamAction`.
 *
 * `RoomStateWire` es lo que guarda el esquema de Colyseus: SOLO primitivos, arrays de string y el mapa
 * `players`. `encodeRoomView` (servidor) y `decodeRoomView` (cliente, sobre `room.state.toJSON()`).
 * Mapeo campo a campo (RoomView → RoomStateWire):
 *
 *   roomId, scenarioId, attempt, seed      → igual (string, string, number, number)
 *   phase                                  → phase: string (RoomPhase; desconocida ⇒ 'lobby')
 *   hostId (string | null)                 → hostId: string ('' = null)
 *   players[i] (TeamPlayer)                → players[player.id]: PlayerWire
 *       id, name, connected, isHost        →   igual
 *       roles                              →   roles: string[]
 *       i (orden de llegada)               →   order: number (se ordena por él al decodificar)
 *       pose (AvatarPose | null)           →   hasPose: boolean + x, y, z, yaw: number (0 si null)
 *   design.componentIds                    → componentIds: string[]
 *   design.orbitId / launcherId (… | null) → orbitId / launcherId: string ('' = null)
 *   design.scenarioId                      → (no se envía: es `scenarioId`)
 *   allocation (… | null)                  → allocation: string (JSON; '' = null)
 *   requests[], votes[], events[], alerts[], chat[] → string[] (un JSON por elemento)
 *   lastNoGo, preLaunch, result, collaboration, teamScore, mascot (… | null) → string (JSON; '' = null)
 *   sim.accel, sim.simT                    → simAccel, simT: number
 *   sim.snapshot (SimSnapshot | null)      → simSnapshot: string (JSON; '' = null)
 *   sim.launchOk (boolean | null)          → simLaunch: string ('' | 'success' | 'failure')
 *   sim.finished, sim.paused               → simFinished, simPaused: boolean
 *
 * `decodeRoomView` nunca lanza: campos ausentes, de otro tipo o JSON inválido dan el valor por defecto
 * de `createRoomView` (y los elementos inválidos de una lista se descartan), porque `toJSON()` puede
 * llegar antes de que el servidor haya escrito todo.
 */
import { z } from 'zod';
import { TEAM_LIMITS } from './constants';
import { isTeamRole, ROOM_PHASES, SUBSYSTEM_IDS } from './team';
import type {
  NoGoReasonCode, OrbitId, PlayerWire, ResourceId, RoomPhase, RoomStateWire, RoomView, SubsystemAllocation, SubsystemId,
  TeamAction, TeamPlayer, TeamRole,
} from './types';

// ─── Esquema de acciones ────────────────────────────────────────────────────

const ROLE_VALUES = ['director', 'engineering', 'science', 'operations'] as const satisfies readonly TeamRole[];
const RESOURCE_VALUES = ['mass', 'power', 'battery', 'budget', 'data', 'comms', 'time', 'lifetime'] as const satisfies readonly ResourceId[];
const SUBSYSTEM_VALUES = ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'] as const satisfies readonly SubsystemId[];
const ORBIT_VALUES = ['LEO', 'SSO', 'MEO', 'GEO', 'HEO', 'TLI'] as const satisfies readonly OrbitId[];
const NO_GO_VALUES = [...RESOURCE_VALUES, 'requirements', 'risk', 'other'] as const satisfies readonly NoGoReasonCode[];

const role = z.enum(ROLE_VALUES);
const resource = z.enum(RESOURCE_VALUES);
const subsystem = z.enum(SUBSYSTEM_VALUES);
const entityId = z.string().min(1).max(TEAM_LIMITS.idMaxChars);
const note = z.string().max(TEAM_LIMITS.noteMaxChars);
/** zod 4: `z.number()` ya rechaza NaN e ±Infinity. */
const coordinate = z.number().min(-1e4).max(1e4);

const pingTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('subsystem'), id: subsystem }),
  z.strictObject({ kind: z.literal('component'), id: entityId }),
  z.strictObject({ kind: z.literal('resource'), id: resource }),
  z.strictObject({ kind: z.literal('point'), position: z.tuple([coordinate, coordinate, coordinate]) }),
]);

/** Esquema zod de `TeamAction` (estricto). Úsalo con `safeParse` o como Standard Schema en Colyseus. */
export const teamActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set-name'), name: z.string().min(1).max(TEAM_LIMITS.nameMaxChars) }),
  z.strictObject({
    type: z.literal('claim-roles'),
    roles: z.array(role).max(ROLE_VALUES.length).refine((rs) => new Set(rs).size === rs.length, 'roles repetidos'),
  }),
  z.strictObject({ type: z.literal('auto-assign-roles') }),
  z.strictObject({ type: z.literal('start-mission') }),
  z.strictObject({ type: z.literal('start-design') }),
  z.strictObject({ type: z.literal('add-component'), componentId: entityId }),
  z.strictObject({ type: z.literal('remove-component'), componentId: entityId }),
  z.strictObject({ type: z.literal('select-orbit'), orbitId: z.enum(ORBIT_VALUES).nullable() }),
  z.strictObject({ type: z.literal('select-launcher'), launcherId: entityId.nullable() }),
  z.strictObject({
    type: z.literal('allocate-budget'),
    allocation: z.partialRecord(subsystem, z.number().min(0).max(1e6)).nullable(),
  }),
  z.strictObject({
    type: z.literal('request-resource'),
    resource,
    amount: z.number().positive().max(1e9).optional(),
    subsystem: subsystem.optional(),
    note: note.optional(),
  }),
  z.strictObject({ type: z.literal('resolve-request'), requestId: entityId, approve: z.boolean(), note: note.optional() }),
  z.strictObject({ type: z.literal('withdraw-request'), requestId: entityId }),
  z.strictObject({ type: z.literal('request-review') }),
  z.strictObject({
    type: z.literal('vote'),
    role,
    value: z.enum(['go', 'no-go']),
    reason: z.strictObject({ code: z.enum(NO_GO_VALUES), note: note.optional() }).optional(),
  }),
  z.strictObject({ type: z.literal('confirm-launch') }),
  z.strictObject({ type: z.literal('launch-done') }),
  z.strictObject({ type: z.literal('set-time-scale'), accel: z.number() }),
  z.strictObject({ type: z.literal('ack-alert'), alertId: entityId, role }),
  z.strictObject({ type: z.literal('finish-operation') }),
  z.strictObject({ type: z.literal('redesign') }),
  z.strictObject({ type: z.literal('chat'), text: z.string().min(1).max(TEAM_LIMITS.chatMaxChars) }),
  z.strictObject({ type: z.literal('ping'), target: pingTarget }),
]);

/** Parsea un mensaje desconocido como `TeamAction` (null si no cumple el esquema). */
export function parseTeamAction(raw: unknown): TeamAction | null {
  const r = teamActionSchema.safeParse(raw);
  return r.success ? r.data : null;
}

// ─── Vista inicial ──────────────────────────────────────────────────────────

/** Vista de una sala recién creada (fase `lobby`, sin jugadores, diseño vacío, aceleración 1×). */
export function createRoomView(init: { roomId: string; scenarioId: string; attempt: number; seed: number }): RoomView {
  return {
    roomId: init.roomId,
    scenarioId: init.scenarioId,
    phase: 'lobby',
    attempt: init.attempt,
    seed: init.seed,
    hostId: null,
    players: [],
    design: { scenarioId: init.scenarioId, componentIds: [], orbitId: null, launcherId: null },
    allocation: null,
    requests: [],
    votes: [],
    lastNoGo: null,
    preLaunch: null,
    sim: { accel: 1, simT: 0, snapshot: null, launchOk: null, finished: false, paused: false },
    events: [],
    alerts: [],
    result: null,
    collaboration: null,
    teamScore: null,
    mascot: null,
    chat: [],
  };
}

// ─── Codificación ───────────────────────────────────────────────────────────

const toJson = (value: unknown): string => (value === null || value === undefined ? '' : JSON.stringify(value));

function encodePlayer(p: TeamPlayer, order: number): PlayerWire {
  return {
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
  };
}

/** RoomView → RoomStateWire (lo que el servidor escribe en su esquema de Colyseus). */
export function encodeRoomView(view: RoomView): RoomStateWire {
  const players: Record<string, PlayerWire> = {};
  view.players.forEach((p, i) => {
    players[p.id] = encodePlayer(p, i);
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
    allocation: toJson(view.allocation),
    requests: view.requests.map(toJson),
    votes: view.votes.map(toJson),
    lastNoGo: toJson(view.lastNoGo),
    preLaunch: toJson(view.preLaunch),
    simAccel: view.sim.accel,
    simT: view.sim.simT,
    simSnapshot: toJson(view.sim.snapshot),
    simLaunch: view.sim.launchOk === null ? '' : view.sim.launchOk ? 'success' : 'failure',
    simFinished: view.sim.finished,
    simPaused: view.sim.paused,
    events: view.events.map(toJson),
    alerts: view.alerts.map(toJson),
    result: toJson(view.result),
    collaboration: toJson(view.collaboration),
    teamScore: toJson(view.teamScore),
    mascot: toJson(view.mascot),
    chat: view.chat.map(toJson),
  };
}

// ─── Decodificación tolerante ───────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, fallback = ''): string => (typeof x === 'string' ? x : fallback);
const num = (x: unknown, fallback = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const bool = (x: unknown, fallback = false): boolean => (typeof x === 'boolean' ? x : fallback);
const strList = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);

/** Objeto JSON de una cadena, o null si está vacía, es inválida o no es un objeto. */
function jsonObject<T>(s: unknown): T | null {
  if (typeof s !== 'string' || s === '') return null;
  try {
    const v: unknown = JSON.parse(s);
    return isObj(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

/** Lista de objetos JSON (descarta los elementos inválidos). */
function jsonList<T>(x: unknown): T[] {
  const out: T[] = [];
  for (const s of strList(x)) {
    const v = jsonObject<T>(s);
    if (v !== null) out.push(v);
  }
  return out;
}

function decodeAllocation(s: unknown): SubsystemAllocation | null {
  const raw = jsonObject<Obj>(s);
  if (raw === null) return null;
  const out: SubsystemAllocation = {};
  for (const sub of SUBSYSTEM_IDS) {
    const v = raw[sub];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[sub] = v;
  }
  return out;
}

function decodePlayers(x: unknown): TeamPlayer[] {
  if (!isObj(x)) return [];
  const entries: { order: number; player: TeamPlayer }[] = [];
  Object.entries(x).forEach(([key, p], i) => {
    if (!isObj(p)) return;
    const id = str(p.id) || key;
    entries.push({
      order: num(p.order, i),
      player: {
        id,
        name: str(p.name),
        roles: strList(p.roles).filter(isTeamRole),
        connected: bool(p.connected),
        isHost: bool(p.isHost),
        pose: bool(p.hasPose) ? { x: num(p.x), y: num(p.y), z: num(p.z), yaw: num(p.yaw) } : null,
      },
    });
  });
  entries.sort((a, b) => a.order - b.order || (a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0));
  return entries.map((e) => e.player);
}

/**
 * RoomStateWire (normalmente `room.state.toJSON()`) → RoomView. Tolera entradas parciales o
 * malformadas: nunca lanza y rellena con los valores de `createRoomView`.
 */
export function decodeRoomView(wire: unknown): RoomView {
  const w: Obj = isObj(wire) ? wire : {};
  const scenarioId = str(w.scenarioId);
  const view = createRoomView({ roomId: str(w.roomId), scenarioId, attempt: num(w.attempt), seed: num(w.seed) });
  const phase = str(w.phase);
  const launch = str(w.simLaunch);
  return {
    ...view,
    phase: (ROOM_PHASES as readonly string[]).includes(phase) ? (phase as RoomPhase) : 'lobby',
    hostId: str(w.hostId) || null,
    players: decodePlayers(w.players),
    design: {
      scenarioId,
      componentIds: strList(w.componentIds),
      orbitId: (str(w.orbitId) || null) as OrbitId | null,
      launcherId: str(w.launcherId) || null,
    },
    allocation: decodeAllocation(w.allocation),
    requests: jsonList(w.requests),
    votes: jsonList(w.votes),
    lastNoGo: jsonObject(w.lastNoGo),
    preLaunch: jsonObject(w.preLaunch),
    sim: {
      accel: num(w.simAccel, view.sim.accel),
      simT: num(w.simT),
      snapshot: jsonObject(w.simSnapshot),
      launchOk: launch === 'success' ? true : launch === 'failure' ? false : null,
      finished: bool(w.simFinished),
      paused: bool(w.simPaused),
    },
    events: jsonList(w.events),
    alerts: jsonList(w.alerts),
    result: jsonObject(w.result),
    collaboration: jsonObject(w.collaboration),
    teamScore: jsonObject(w.teamScore),
    mascot: jsonObject(w.mascot),
    chat: jsonList(w.chat),
  };
}
