/**
 * Sesión de SALA (fase 6): conecta con el servidor de juego, refleja su partida en `runStore` y envía las
 * acciones del jugador. Contrato: docs/MULTIPLAYER.md. El servidor es la fuente de verdad.
 *
 * - Lobby: `createRoom`, `joinRoom(código)`, `sendLobby` (rol, listo, empezar, reiniciar), `leaveRoom`.
 * - Partida: cada `state` del servidor hidrata el espejo (`useGame.remoteState`); `events` suenan y avisan;
 *   `result` es un rechazo. Las acciones mantenidas (trabajo, jetpack) y la posición se agrupan y salen a
 *   ~15 Hz; el resto sale al momento.
 * - El SDK se carga bajo demanda (`import()`): el solitario no lo descarga. Los tests inyectan un cliente
 *   falso con `configureCoop`.
 */
import {
  COOP_LIMITS, COOP_ROOM, MAX_WORK_SECONDS, NET, normalizeRoomCode, sanitizePlayerName,
  type CrewPose, type LobbyAction, type LobbyView, type PingBroadcast, type PingKind, type PoseArea, type PosesMessage, type ResultMessage, type RunAction, type RunEvent,
  type RunState, type SectorMap, type StateMessage,
} from '@payload/shared';
import { setSharedDesignSink, useGame } from '../game/runStore';
import { coopLive, INITIAL_COOP, useCoop, type CoopError } from './coopStore';

/** Lo que usa el cliente de un `Room` de @colyseus/sdk (inyectable en tests). */
export interface RoomLike {
  readonly roomId: string;
  readonly sessionId: string;
  send(type: string, payload?: unknown): void;
  onMessage(type: string, cb: (payload: never) => void): unknown;
  onLeave(cb: (code: number) => void): unknown;
  onDrop?(cb: (code: number) => void): unknown;
  onReconnect?(cb: () => void): unknown;
  leave(consented?: boolean): Promise<unknown>;
}

export interface ClientLike {
  create(roomName: string, options?: Record<string, unknown>): Promise<RoomLike>;
  joinById(roomId: string, options?: Record<string, unknown>): Promise<RoomLike>;
}

export type ClientFactory = (url: string) => ClientLike | Promise<ClientLike>;

export const DEFAULT_GAME_SERVER_PORT = 2567;
/** Cadencia de envío de lo agrupado (posición y trabajo mantenido). */
export const FLUSH_INTERVAL_MS = 66;
const POSE_INTERVAL_MS = 1000 / COOP_LIMITS.poseHz;
/** Intentos de crear/entrar si la red falla (una red con pérdidas corta a veces el primer intento). */
export const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_MS = 500;
const NAME_KEY = 'payload.coop.name';
/** Tecla del ping «mirad aquí» (en la nave y en la superficie). */
export const KEY_PING = 'KeyG';

/** URL del servidor: `VITE_GAME_SERVER_URL` o `ws://<host de la página>:2567` (así vale en red local). */
export function gameServerUrl(): string {
  const env = (import.meta.env as Record<string, string | undefined> | undefined)?.VITE_GAME_SERVER_URL;
  if (env) return env;
  const loc = typeof location !== 'undefined' ? location : null;
  return `${loc?.protocol === 'https:' ? 'wss' : 'ws'}://${loc?.hostname || 'localhost'}:${DEFAULT_GAME_SERVER_PORT}`;
}

let factory: ClientFactory = async (url) => {
  const sdk = await import('@colyseus/sdk');
  return new sdk.Client(url) as unknown as ClientLike;
};

/** Solo tests: cliente falso. */
export function configureCoop(f: ClientFactory): void {
  factory = f;
}

export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* sin almacenamiento */
  }
}

// ── Sesión en curso ───────────────────────────────────────────────────────────────────────────

interface Session {
  room: RoomLike;
  seq: number;
  sector: SectorMap | null;
  /** Partida de la sala que se está reflejando (`LobbyView.runId`), o -1. */
  mirroredRunId: number;
  /** Acciones agrupadas a la espera del siguiente envío. */
  position: Extract<RunAction, { type: 'set-position' }> | null;
  work: Map<string, RunAction & { seconds: number }>;
  timer: ReturnType<typeof setInterval> | null;
  lastPoseMs: number;
}

let session: Session | null = null;

const workKey = (a: RunAction): string | null =>
  a.type === 'work-incident' ? `w:${a.incidentId}` : a.type === 'repair-system' ? `r:${a.systemId}` : a.type === 'jetpack' ? 'j' : null;

function sendNow(s: Session, action: RunAction): void {
  s.room.send(NET.action, { seq: ++s.seq, action });
}

/** Envía lo agrupado: primero la posición (las demás acciones dependen de dónde estoy). */
function flushPending(s: Session): void {
  if (s.position) {
    sendNow(s, s.position);
    s.position = null;
  }
  for (const [key, action] of s.work) {
    const seconds = Math.min(action.seconds, MAX_WORK_SECONDS);
    sendNow(s, { ...action, seconds } as RunAction);
    if (action.seconds - seconds > 1e-6) action.seconds -= seconds;
    else s.work.delete(key);
  }
}

function sendAction(action: RunAction): void {
  const s = session;
  if (!s) return;
  if (action.type === 'set-position') {
    s.position = action;
    return;
  }
  const key = workKey(action);
  if (key !== null) {
    const seconds = Math.max(0, Number((action as { seconds: number }).seconds) || 0);
    const pending = s.work.get(key);
    // Como mucho un segundo acumulado: el servidor no acepta más trabajo que el tiempo real.
    if (pending) pending.seconds = Math.min(1, pending.seconds + seconds);
    else s.work.set(key, { ...action, seconds } as RunAction & { seconds: number });
    return;
  }
  flushPending(s);
  sendNow(s, action);
}

function onLobby(s: Session, view: LobbyView): void {
  useCoop.setState({ lobby: view, status: 'connected' });
  // Fase 6: el diseño compartido manda sobre lo que se esté pintando en el hangar.
  useGame.getState().syncSharedDesign(view.design ?? null);
  // La sala volvió al lobby (reinicio tras perder): se deja de reflejar la partida.
  if (view.phase === 'lobby' && s.mirroredRunId !== -1) {
    s.mirroredRunId = -1;
    s.sector = null;
    useGame.getState().exitRemote();
  }
}

function onState(s: Session, msg: StateMessage): void {
  if (msg.sector) s.sector = msg.sector;
  const { lobby, myId } = useCoop.getState();
  const me = lobby?.players.find((p) => p.id === myId);
  if (!s.sector || !lobby || lobby.phase !== 'playing' || !me || me.crewId === null) return;
  const state: RunState = { ...msg.state, sector: s.sector };
  const game = useGame.getState();
  if (s.mirroredRunId !== lobby.runId) {
    s.mirroredRunId = lobby.runId;
    coopLive.poses = {};
    coopLive.pings = [];
    game.enterRemote(state, { crewId: me.crewId, send: sendAction, leave: () => void leaveRoom() });
  } else game.remoteState(state);
}

function closeSession(error: CoopError | null): void {
  const s = session;
  session = null;
  if (s?.timer) clearInterval(s.timer);
  coopLive.poses = {};
  coopLive.pings = [];
  useGame.getState().exitRemote();
  useGame.getState().closeSharedDesign();
  useCoop.setState({ ...INITIAL_COOP, error });
}

function attach(room: RoomLike): void {
  const s: Session = { room, seq: 0, sector: null, mirroredRunId: -1, position: null, work: new Map(), timer: null, lastPoseMs: 0 };
  session = s;
  useCoop.setState({ status: 'connected', myId: room.sessionId, error: null });
  room.onMessage(NET.lobby, (view: LobbyView) => session === s && onLobby(s, view));
  room.onMessage(NET.state, (msg: StateMessage) => session === s && onState(s, msg));
  room.onMessage(NET.events, (events: RunEvent[]) => session === s && useGame.getState().remoteEvents(events));
  room.onMessage(NET.result, (r: ResultMessage) => session === s && useGame.getState().remoteReject(r.reason));
  room.onMessage(NET.poses, (poses: PosesMessage) => {
    if (session === s) coopLive.poses = poses;
  });
  room.onMessage(NET.ping, (ping: PingBroadcast) => {
    if (session !== s) return;
    const now = performance.now();
    coopLive.pings = [...coopLive.pings.filter((p) => now - p.atMs < COOP_LIMITS.pingTtlS * 1000), { ...ping, atMs: now }];
  });
  room.onDrop?.(() => session === s && useCoop.setState({ status: 'reconnecting' }));
  room.onReconnect?.(() => session === s && useCoop.setState({ status: 'connected' }));
  room.onLeave(() => {
    // Salida no pedida (el servidor cerró o no se pudo reconectar): al menú con el motivo.
    if (session === s) closeSession('lost');
  });
  s.timer = setInterval(() => flushPending(s), FLUSH_INTERVAL_MS);
}

function errorOf(e: unknown): CoopError {
  const text = String((e as { message?: unknown })?.message ?? e);
  if (text.includes('room-full')) return 'room-full';
  if (text.includes('in-progress') || text.includes('locked')) return 'in-progress';
  if (/not found|no rooms|invalid/i.test(text)) return 'not-found';
  return 'unreachable';
}

async function connect(open: (client: ClientLike, name: string) => Promise<RoomLike>, rawName: string): Promise<boolean> {
  if (session || useCoop.getState().status === 'connecting') return false;
  const name = sanitizePlayerName(rawName, '');
  savePlayerName(name);
  useCoop.setState({ status: 'connecting', error: null });
  let error: CoopError = 'unreachable';
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    try {
      const client = await factory(gameServerUrl());
      attach(await open(client, name));
      return true;
    } catch (e) {
      error = errorOf(e);
      // Solo se reintenta lo que parece de red (conexión que no llega o se corta al abrir el WebSocket): una sala
      // llena, empezada o inexistente no cambia por insistir. Crear de nuevo es seguro: la reserva que no se usó
      // caduca sola en el servidor y su sala vacía se descarta.
      if (error !== 'unreachable' || attempt === CONNECT_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, CONNECT_RETRY_MS));
    }
  }
  useCoop.setState({ ...INITIAL_COOP, error });
  return false;
}

export function createRoom(name: string): Promise<boolean> {
  return connect((client, n) => client.create(COOP_ROOM, n ? { name: n } : {}), name);
}

export async function joinRoom(rawCode: string, name: string): Promise<boolean> {
  const code = normalizeRoomCode(rawCode);
  if (!code) {
    useCoop.setState({ error: 'not-found' });
    return false;
  }
  return connect((client, n) => client.joinById(code, n ? { name: n } : {}), name);
}

export async function leaveRoom(): Promise<void> {
  const s = session;
  if (!s) return;
  closeSession(null);
  try {
    await s.room.leave(true);
  } catch {
    /* ya estaba cerrada */
  }
}

export function sendLobby(action: LobbyAction): void {
  session?.room.send(NET.lobby, action);
}

// Fase 6 (ADR 0020): los cambios del hangar compartido salen como ediciones discretas, en orden.
setSharedDesignSink((edits) => {
  for (const edit of edits) sendLobby({ type: 'edit-design', edit });
});

/** Informa mi pose a los compañeros (llamar por frame; sale como mucho a `poseHz`). */
export function reportPose(x: number, y: number, z: number, yaw: number, area: PoseArea): void {
  const s = session;
  if (!s || s.mirroredRunId === -1) return;
  const now = performance.now();
  if (now - s.lastPoseMs < POSE_INTERVAL_MS) return;
  s.lastPoseMs = now;
  const pose: CrewPose = { x, y, z, yaw, area };
  s.room.send(NET.pose, pose);
}

export function sendPing(kind: PingKind, x: number, y: number, z: number, area: PoseArea): void {
  const s = session;
  if (!s || s.mirroredRunId === -1) return;
  s.room.send(NET.ping, { kind, x, y, z, area });
}

export const inRoom = (): boolean => session !== null;
