/**
 * Contrato de red del cooperativo (fase 4, ADR 0015). Tipos y validación PUROS: los usan el servidor
 * (`apps/game-server`) y el cliente (`apps/client/src/net`). Descripción completa: docs/MULTIPLAYER.md.
 *
 * El servidor corre la partida (`createRun`) y es la única fuente de verdad. Los clientes envían
 * `RunAction` y su pose; reciben el estado entero a paso fijo, los eventos del motor y las poses de los demás.
 */
import { ROLE_IDS, type MessageRef, type RoleId, type RunAction, type RunEvent, type RunState, type SectorMap } from './types';

export const COOP_LIMITS = {
  maxPlayers: 4,
  /** Difusión del estado (igual que el paso fijo del motor: no hay nada nuevo que enviar más a menudo). */
  stateHz: 10,
  /** Envío y difusión de poses de avatar. */
  poseHz: 10,
  /** Segundos que se guarda el sitio de un jugador caído. */
  reconnectGraceS: 60,
  nameMaxLen: 16,
  /** Mensajes por segundo de un cliente antes de considerarlo abuso. */
  maxMessagesPerSecond: 60,
  /** Longitud del código de sala (letras y cifras sin ambigüedad). */
  roomCodeLen: 4,
  pingMinIntervalS: 0.4,
  pingTtlS: 6,
  /** Coordenadas de pose aceptadas (m). */
  poseMaxAbs: 2000,
} as const;

/** Alfabeto del código de sala: sin 0/O ni 1/I/L. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Nombre de la sala en el servidor (`client.create(COOP_ROOM, …)`). */
export const COOP_ROOM = 'crew';

/** Tipos de mensaje (cliente ↔ servidor). */
export const NET = {
  lobby: 'lobby',
  action: 'action',
  pose: 'pose',
  ping: 'ping',
  state: 'state',
  events: 'events',
  result: 'result',
  poses: 'poses',
} as const;

export type RoomPhase = 'lobby' | 'playing';

export interface CoopPlayer {
  /** Id de sesión (estable entre reconexiones). */
  id: string;
  name: string;
  role: RoleId | null;
  ready: boolean;
  connected: boolean;
  host: boolean;
  /** Tripulante que controla en la partida en curso (null en el lobby). */
  crewId: number | null;
}

export interface LobbyView {
  /** Código de la sala (lo que se comparte para entrar). */
  code: string;
  phase: RoomPhase;
  players: CoopPlayer[];
  /** Cambia en cada partida nueva de la sala. */
  runId: number;
}

/** Errores de entrada a la sala (códigos estables; el cliente los traduce con claves `ui`). */
export type JoinErrorCode = 'room-full' | 'in-progress';

// ── Cliente → servidor ────────────────────────────────────────────────────────────────────────

export type LobbyAction =
  | { type: 'set-role'; role: RoleId | null }
  | { type: 'set-ready'; ready: boolean }
  /** Solo el anfitrión, con todos los demás listos. */
  | { type: 'start' }
  /** Solo el anfitrión, con la partida perdida: vuelve al lobby. */
  | { type: 'restart' };

export interface ActionMessage {
  /** Número de secuencia del cliente (vuelve en `result` si se rechaza). */
  seq: number;
  action: RunAction;
}

export type PoseArea = 'ship' | 'surface';

/** Pose del avatar (efímera; no entra en el motor). En la nave, coordenadas del interior; fuera, relativas a la nave. */
export interface CrewPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  area: PoseArea;
}

export const PING_KINDS = ['look', 'danger', 'help'] as const;
export type PingKind = (typeof PING_KINDS)[number];

export interface PingMessage {
  kind: PingKind;
  x: number;
  y: number;
  z: number;
  area: PoseArea;
}

// ── Servidor → cliente ────────────────────────────────────────────────────────────────────────

export interface StateMessage {
  /** Pasos fijos del motor ejecutados en esta partida. */
  tick: number;
  /** Estado entero salvo `sector`, que solo viaja cuando cambia (y siempre al entrar o reconectar). */
  state: Omit<RunState, 'sector'>;
  sector?: SectorMap;
}

export type EventsMessage = RunEvent[];

/** Rechazo de una acción (las aceptadas no se confirman: se ven en el estado). */
export interface ResultMessage {
  seq: number;
  reason: MessageRef;
}

/** Poses por `crewId` (solo de jugadores conectados). */
export type PosesMessage = Record<number, CrewPose>;

export interface PingBroadcast extends PingMessage {
  crewId: number;
}

// ── Validación (lo que llega de la red no es de fiar) ─────────────────────────────────────────

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Nombre de jugador: sin caracteres de control, recortado; vacío ⇒ `fallback`. */
export function sanitizePlayerName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const clean = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, COOP_LIMITS.nameMaxLen);
  return clean.length > 0 ? clean : fallback;
}

/** Normaliza un código de sala tecleado (mayúsculas, sin espacios); null si no tiene forma de código. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== COOP_LIMITS.roomCodeLen) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Código de sala a partir de una fuente de azar 0-1 (la pone el servidor; el motor no interviene). */
export function makeRoomCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < COOP_LIMITS.roomCodeLen; i++) code += ROOM_CODE_ALPHABET[Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(random() * ROOM_CODE_ALPHABET.length))];
  return code;
}

export function parseLobbyAction(raw: unknown): LobbyAction | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'set-role':
      if (raw.role === null) return { type: 'set-role', role: null };
      return typeof raw.role === 'string' && (ROLE_IDS as readonly string[]).includes(raw.role) ? { type: 'set-role', role: raw.role as RoleId } : null;
    case 'set-ready':
      return { type: 'set-ready', ready: raw.ready === true };
    case 'start':
      return { type: 'start' };
    case 'restart':
      return { type: 'restart' };
    default:
      return null;
  }
}

/** Solo comprueba la forma: los campos de cada `RunAction` los valida el motor (`run.apply`). */
export function parseActionMessage(raw: unknown): ActionMessage | null {
  if (!isObject(raw) || !isObject(raw.action) || typeof raw.action.type !== 'string') return null;
  const seq = finite(raw.seq) ? Math.trunc(raw.seq) : 0;
  return { seq, action: raw.action as unknown as RunAction };
}

export function parsePose(raw: unknown): CrewPose | null {
  if (!isObject(raw)) return null;
  const { x, y, z, yaw, area } = raw;
  if (!finite(x) || !finite(y) || !finite(z) || !finite(yaw)) return null;
  if (area !== 'ship' && area !== 'surface') return null;
  const max = COOP_LIMITS.poseMaxAbs;
  if (Math.abs(x) > max || Math.abs(y) > max || Math.abs(z) > max) return null;
  const r = (n: number): number => Math.round(n * 100) / 100;
  return { x: r(x), y: r(y), z: r(z), yaw: r(yaw), area };
}

export function parsePing(raw: unknown): PingMessage | null {
  if (!isObject(raw)) return null;
  const pose = parsePose({ ...raw, yaw: 0 });
  if (!pose || typeof raw.kind !== 'string' || !(PING_KINDS as readonly string[]).includes(raw.kind)) return null;
  return { kind: raw.kind as PingKind, x: pose.x, y: pose.y, z: pose.z, area: pose.area };
}
