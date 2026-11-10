/**
 * Sesión de SALA (fase 3): envía `TeamAction` al servidor Colyseus y aplica su estado a los stores que
 * leen las escenas y paneles. Contrato: docs/MULTIPLAYER.md. El servidor es la fuente de verdad: el
 * cliente NO aplica nada por su cuenta (sin actualizaciones optimistas); solo prevé con `canDo`.
 *
 * Estado del servidor → cliente (`applyView`), en este orden (la escena de la fase nueva ya encuentra
 * los stores listos):
 *   1. `useDesign` ← `view.design` (+ intento y motivos del último No-Go como `lastIssues`);
 *   2. efectos de entrar en fase (como las acciones de entrada de la máquina del solitario);
 *   3. `useSim`: `preLaunch`; en `launch`/`operation` simulación REFLEJADA con la semilla de la sala
 *      (`mirrorStart`/`mirrorFollow`, nunca pasa de `sim.simT`); en `report`, `result` del servidor;
 *   4. `useRoom` ← vista, mis roles, anfitrión (esto cambia la fase visible de App);
 *   5. mascota: una vez por `view.mascot.seq`, `pickMascotDialogue(trigger, catalog.mascot, variant)`.
 *
 * Conexión: `quickMatch`, `createPrivateRoom`, `joinRoomByCode`, `resumeRoom` (token en
 * `sessionStorage['payload.room.token']`) y `leaveRoom`. La reconexión automática del SDK se refleja en
 * `useRoom.status` (`reconnecting` → `connected`); si falla o el servidor cierra, se vuelve al menú en solitario.
 * El SDK se carga bajo demanda (`import()`), así el solitario no lo descarga. Los tests inyectan un
 * cliente falso con `configureNet`.
 */
import {
  sanitizePlayerText, TEAM_LIMITS,
  type AvatarPose, type GoNoGoVoteValue, type MessageRef, type NoGoReason, type OrbitId, type PingTarget, type RoomView,
  type ServerNotice, type SubsystemAllocation, type TeamAction, type TeamRole, type ValidationIssue,
} from '@payload/shared';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { useAcademy } from '../academy/academyStore';
import { useMascot } from '../mascot/mascotStore';
import { useDesign } from '../state/design';
import { isMirroring, mirrorInfo, useSim } from '../state/sim';
import { useUi } from '../state/ui';
import { decodeRoomState, type DecodedRoom } from './roomView';
import {
  canDo, INITIAL_ROOM_STATE, NOTICE_HISTORY, PING_TTL_MS, useRoom,
  type ConnectionStatus, type PingMark, type ReceivedNotice, type RoomErrorInfo,
} from './roomStore';
import { APPLY, INVALID_ACTION, type MissionSession, type ResourceRequestInput, type SessionResult } from './session';
import { getLocalSession, useSession } from './sessionStore';

// ─── Abstracción del SDK (subconjunto que se usa; inyectable en tests) ──────

/** Lo que usa el cliente de un `Room` de @colyseus/sdk 0.18. */
export interface RoomLike {
  readonly roomId: string;
  readonly sessionId: string;
  /** Cambia tras cada reconexión (el SDK lo actualiza al volver a unirse). */
  readonly reconnectionToken: string;
  /** Estado sincronizado (esquema de Colyseus con `toJSON()`, o un objeto plano en tests). */
  readonly state: unknown;
  send(type: string, payload?: unknown): void;
  onStateChange(cb: (state: unknown) => void): void;
  onMessage(type: string, cb: (payload: unknown) => void): (() => void) | void;
  onLeave(cb: (code: number, reason?: string) => void): void;
  onDrop(cb: (code: number, reason?: string) => void): void;
  onReconnect(cb: () => void): void;
  onError(cb: (code: number, message?: string) => void): void;
  leave(consented?: boolean): Promise<number>;
  /** Solo diagnóstico/tests: el `Room` real del SDK (p. ej. para cortar el socket sin `leave()`). */
  readonly raw?: unknown;
}

/** Lo que usa el cliente de un `Client` de @colyseus/sdk. */
export interface ClientLike {
  joinOrCreate(roomName: string, options?: Record<string, unknown>): Promise<RoomLike>;
  create(roomName: string, options?: Record<string, unknown>): Promise<RoomLike>;
  joinById(roomId: string, options?: Record<string, unknown>): Promise<RoomLike>;
  reconnect(reconnectionToken: string): Promise<RoomLike>;
}

export type ClientFactory = (url: string) => ClientLike | Promise<ClientLike>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Nombre de la sala en el servidor. */
export const ROOM_NAME = 'mission';
/** Clave de `sessionStorage` con el token de reconexión. */
export const TOKEN_KEY = 'payload.room.token';
/** Intervalo mínimo entre dos `move` (≤ `TEAM_LIMITS.moveMaxHz`). */
export const MOVE_MIN_INTERVAL_MS = 1000 / TEAM_LIMITS.moveMaxHz;
/** Puerto por defecto del servidor de juego. */
export const DEFAULT_GAME_SERVER_PORT = 2567;
/**
 * `reconnection.minUptime` del SDK (por defecto 5000 ms): si la conexión caía antes de ese tiempo, el SDK
 * no reintentaba y el jugador perdía el sitio aunque el servidor se lo guarda `reconnectGraceS`. Los
 * reintentos siguen acotados por `reconnection.maxRetries` (15, con espera exponencial).
 */
export const RECONNECT_MIN_UPTIME_MS = 0;
/** Cierres sin consentimiento tras los que el servidor guarda el sitio (se puede `retryRoom`). */
const RETRYABLE_CLOSE_CODES: ReadonlySet<number> = new Set([
  1001, // GOING_AWAY
  1005, // NO_STATUS_RECEIVED
  1006, // ABNORMAL_CLOSURE (también: caída antes de minUptime)
  4003, // FAILED_TO_RECONNECT (se agotaron los reintentos automáticos)
  4010, // MAY_TRY_RECONNECT
]);

/** URL del servidor: `VITE_GAME_SERVER_URL` o `ws://<hostname>:2567` (`wss://` si la página es https). */
export function gameServerUrl(): string {
  const env = import.meta.env?.VITE_GAME_SERVER_URL;
  if (env) return env;
  const loc = typeof location !== 'undefined' ? location : null;
  const host = loc?.hostname || 'localhost';
  return `${loc?.protocol === 'https:' ? 'wss' : 'ws'}://${host}:${DEFAULT_GAME_SERVER_PORT}`;
}

/** Adapta un `Room` real del SDK a `RoomLike` (getters: roomId/token/estado cambian al reconectar). */
function adaptRoom(room: SdkRoom): RoomLike {
  // El SDK tipa send/onMessage según el servidor; aquí los mensajes son dinámicos ('action', 'move', 'notice').
  const dyn = room as unknown as {
    send(type: string, payload?: unknown): void;
    onMessage(type: string, cb: (payload: unknown) => void): () => void;
  };
  room.reconnection.minUptime = RECONNECT_MIN_UPTIME_MS;
  return {
    raw: room,
    get roomId() {
      return room.roomId;
    },
    get sessionId() {
      return room.sessionId;
    },
    get reconnectionToken() {
      return room.reconnectionToken;
    },
    get state() {
      return room.state as unknown;
    },
    send: (type, payload) => dyn.send(type, payload),
    onStateChange: (cb) => {
      room.onStateChange(cb);
    },
    onMessage: (type, cb) => dyn.onMessage(type, cb),
    onLeave: (cb) => {
      room.onLeave(cb);
    },
    onDrop: (cb) => {
      room.onDrop(cb);
    },
    onReconnect: (cb) => {
      room.onReconnect(cb);
    },
    onError: (cb) => {
      room.onError(cb);
    },
    leave: (consented) => room.leave(consented),
  };
}

/** Cliente real: el SDK se importa bajo demanda (no pesa en el solitario). */
async function sdkClientFactory(url: string): Promise<ClientLike> {
  const { Client } = await import('@colyseus/sdk');
  const client = new Client(url);
  return {
    joinOrCreate: async (name, options) => adaptRoom(await client.joinOrCreate(name, options)),
    create: async (name, options) => adaptRoom(await client.create(name, options)),
    joinById: async (id, options) => adaptRoom(await client.joinById(id, options)),
    reconnect: async (token) => adaptRoom(await client.reconnect(token)),
  };
}

function browserStorage(): StorageLike | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

interface NetConfig {
  clientFactory: ClientFactory;
  /** `sessionStorage` (null = sin almacenamiento: no hay reanudación al recargar). */
  storage: StorageLike | null;
  url: () => string;
  /** Reloj en ms (limitador de `move`, caducidad de pings). */
  now: () => number;
}

const defaultConfig = (): NetConfig => ({
  clientFactory: sdkClientFactory,
  storage: browserStorage(),
  url: gameServerUrl,
  now: () => (typeof performance !== 'undefined' ? performance.now() : 0),
});
let config: NetConfig = defaultConfig();

/** Inyecta dependencias (tests: cliente falso, almacenamiento en memoria, reloj). */
export function configureNet(patch: Partial<NetConfig>): void {
  config = { ...config, ...patch };
}
/** Vuelve a la configuración por defecto (tests). */
export function resetNetConfig(): void {
  config = defaultConfig();
}

const storageGet = (k: string): string | null => {
  try {
    return config.storage?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const storageSet = (k: string, v: string): void => {
  try {
    config.storage?.setItem(k, v);
  } catch {
    /* almacenamiento no disponible */
  }
};
const storageRemove = (k: string): void => {
  try {
    config.storage?.removeItem(k);
  } catch {
    /* almacenamiento no disponible */
  }
};

/** ¿Hay un token de reconexión guardado (p. ej. tras recargar la página)? */
export const hasSavedRoom = (): boolean => storageGet(TOKEN_KEY) !== null;

// ─── Utilidades ─────────────────────────────────────────────────────────────

const reject = (key: string, params?: MessageRef['params']): SessionResult => ({ kind: 'reject', reason: params ? { key, params } : { key } });
const EMPTY_ROLES: readonly TeamRole[] = [];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Texto libre saneado (`sanitizePlayerText`) que además cabe en el límite del esquema (unidades UTF-16). */
export function clipPlayerText(text: unknown, max: number): string | null {
  const clean = sanitizePlayerText(text, max);
  if (clean === null || clean.length <= max) return clean;
  const points = Array.from(clean);
  while (points.length > 0 && points.join('').length > max) points.pop();
  const out = points.join('').trim();
  return out.length > 0 ? out : null;
}

const toPlain = (state: unknown): unknown => {
  const s = state as { toJSON?: () => unknown } | null | undefined;
  return s && typeof s.toJSON === 'function' ? s.toJSON() : state;
};

/** Motivos del último No-Go como `lastIssues` del hangar: bloqueos del motor o motivos de la votación. */
export function noGoIssues(lastNoGo: RoomView['lastNoGo']): ValidationIssue[] {
  if (!lastNoGo) return [];
  if (lastNoGo.source === 'review') return lastNoGo.issues.filter((i) => i.severity === 'blocker');
  return lastNoGo.votes
    .filter((v) => v.value === 'no-go' && v.reason)
    .map((v) => ({ severity: 'blocker' as const, code: `vote-${v.reason!.code}`, message: { key: `team.noGoReason.${v.reason!.code}` } }));
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameIssues = (a: readonly ValidationIssue[], b: readonly ValidationIssue[]) =>
  a.length === b.length && a.every((x, i) => x.code === b[i]!.code && x.message.key === b[i]!.message.key && x.severity === b[i]!.severity);

/** Valida la forma de un `notice` del servidor (datos externos: se descarta lo que no encaje). */
export function parseNotice(raw: unknown): ServerNotice | null {
  if (!isObj(raw)) return null;
  switch (raw.kind) {
    case 'rejected': {
      const r = raw.reason;
      if (!isObj(r) || typeof r.key !== 'string' || typeof raw.action !== 'string') return null;
      return raw as unknown as ServerNotice;
    }
    case 'request-created':
      return typeof raw.requestId === 'string' ? (raw as unknown as ServerNotice) : null;
    case 'ping':
      return typeof raw.playerId === 'string' && isObj(raw.target) && typeof raw.target.kind === 'string'
        ? (raw as unknown as ServerNotice)
        : null;
    default:
      return null;
  }
}

/**
 * Mensajes estables del servidor (`MatchMakeError.message`, códigos 525/526): al crear (options.ts) y al
 * entrar (`RoomModel.join`). Cada uno tiene su clave `room.error.<camelCase>` en los locales `ui`.
 */
const SERVER_JOIN_ERRORS: Readonly<Record<string, string>> = {
  'invalid-scenario': 'room.error.invalidScenario',
  'academy-scenario': 'room.error.academyScenario',
  'invalid-attempt': 'room.error.invalidAttempt',
  'invalid-seed': 'room.error.invalidSeed',
  'room-not-in-lobby': 'room.error.roomNotInLobby',
  'room-full': 'room.error.roomFull',
  'already-joined': 'room.error.alreadyJoined',
};

/**
 * Error del SDK al unirse → clave ui. Primero el mensaje estable del servidor (`SERVER_JOIN_ERRORS`);
 * si no, el código de `ErrorCode` (@colyseus/shared-types 0.18); sin código, servidor inalcanzable.
 */
export function joinError(e: unknown, fallback = 'room.error.join'): RoomErrorInfo {
  const code = isObj(e) && typeof e.code === 'number' ? e.code : undefined;
  const message = isObj(e) && typeof e.message === 'string' ? e.message.trim() : e instanceof Error ? e.message.trim() : '';
  const known = Object.prototype.hasOwnProperty.call(SERVER_JOIN_ERRORS, message) ? SERVER_JOIN_ERRORS[message] : undefined;
  if (known) return code === undefined ? { key: known } : { key: known, code };
  if (code === undefined) return { key: 'room.error.unreachable' };
  // Colyseus bloquea la sala antes de `onJoin` (llena o ya empezada): 522 `room "<id>" is locked`.
  if (code === 522 && /is locked/i.test(message)) return { key: 'room.error.locked', code };
  if (code === 522 || code === 524) return { key: fallback === 'room.error.join' ? 'room.error.notFound' : fallback, code }; // INVALID_ROOM_ID (`not found`), EXPIRED
  if (code === 525 || code === 526) return { key: 'room.error.rejected', code }; // AUTH_FAILED, APPLICATION_ERROR
  return { key: fallback, code };
}

// ─── Sesión de sala ─────────────────────────────────────────────────────────

export class RoomSession implements MissionSession {
  readonly kind = 'room' as const;
  private decoded: DecodedRoom | null = null;
  private lastMascotSeq: number | null = null;
  private leaving = false;
  private ended = false;
  private lastMoveAt = Number.NEGATIVE_INFINITY;
  private lastPose: AvatarPose | null = null;
  private pendingRequestNotice: string | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private seq = 0;
  /** Instante (reloj de `configureNet.now`) de la última caída sin reconectar todavía. */
  private droppedAtMs: number | null = null;

  constructor(readonly room: RoomLike) {}

  /** Enlaza los eventos del SDK y pasa a ser la sesión activa. */
  attach(): void {
    const room = this.room;
    useAcademy.getState().exit();
    useMascot.getState().clear();
    useSim.getState().clear();
    useSession.setState({ room: this });
    useRoom.setState({ ...INITIAL_ROOM_STATE, status: 'connected', myId: room.sessionId, roomCode: room.roomId });
    this.saveToken();
    room.onStateChange((state) => this.onState(state));
    room.onMessage('notice', (payload) => this.onNotice(payload));
    room.onDrop(() => {
      if (this.ended) return;
      this.droppedAtMs ??= config.now();
      this.setStatus('reconnecting');
      useUi.getState().showNotice({ tone: 'warn', key: 'room.status.reconnecting' });
    });
    room.onReconnect(() => {
      if (this.ended) return;
      this.droppedAtMs = null;
      this.setStatus('connected');
      useUi.getState().showNotice({ tone: 'info', key: 'room.status.reconnected' });
      // El SDK actualiza el token justo DESPUÉS de este aviso.
      void Promise.resolve().then(() => this.saveToken());
    });
    room.onLeave((code) => {
      if (this.leaving) {
        this.end('idle', null);
        return;
      }
      // Caída sin salir: el servidor guarda el sitio `reconnectGraceS` desde la caída ⇒ se ofrece `retryRoom`.
      const retryable = RETRYABLE_CLOSE_CODES.has(code);
      this.end(
        'disconnected',
        { key: retryable ? 'room.error.lost' : 'room.error.closed', code },
        retryable ? (this.droppedAtMs ?? config.now()) + TEAM_LIMITS.reconnectGraceS * 1000 : null,
      );
    });
    room.onError((code, message) => {
      console.warn('[room] error del servidor', code, message);
      if (!this.ended) useRoom.setState({ error: { key: 'room.error.server', code } });
    });
    // Si el estado completo ya llegó antes de enlazar, se aplica ahora (el getter del SDK puede lanzar
    // si aún no hay serializador).
    let initial: unknown;
    try {
      initial = room.state;
    } catch {
      initial = undefined;
    }
    this.onState(initial);
  }

  /** ¿Sigue activa (no se salió ni se perdió la conexión)? */
  get active(): boolean {
    return !this.ended;
  }

  // ─── Estado del servidor ──────────────────────────────────────────────────

  /** Aplica un estado recibido (también lo usan los tests con un estado plano). */
  onState(state: unknown): void {
    if (this.ended) return;
    let raw: unknown;
    try {
      raw = toPlain(state);
    } catch (e) {
      console.warn('[room] estado ilegible', e);
      return;
    }
    // Hasta que el servidor escribe su primer estado, el esquema puede venir vacío: se ignora.
    if (!isObj(raw) || typeof raw.phase !== 'string' || raw.phase === '') return;
    const prev = this.decoded?.view ?? null;
    this.decoded = decodeRoomState(raw, this.decoded);
    this.applyView(this.decoded.view, prev);
  }

  private applyView(view: RoomView, prev: RoomView | null): void {
    const myId = this.room.sessionId;
    // 1-3. Stores que leen escenas y paneles, ANTES de cambiar la fase visible.
    this.syncDesign(view, prev);
    if (!prev || prev.phase !== view.phase) this.enterPhase(view);
    this.syncSim(view);
    // 4. Sala.
    const me = view.players.find((p) => p.id === myId) ?? null;
    const cur = useRoom.getState();
    useRoom.setState({
      view,
      myId,
      myRoles: me?.roles ?? EMPTY_ROLES,
      isHost: view.hostId !== null && view.hostId === myId,
      roomCode: view.roomId || this.room.roomId,
      status: cur.status === 'connecting' ? 'connected' : cur.status,
    });
    // 5. Mascota única de la sala.
    this.syncMascot(view);
    if (this.pendingRequestNotice) this.showRequestNotice(this.pendingRequestNotice);
  }

  private syncDesign(view: RoomView, prev: RoomView | null): void {
    const d = useDesign.getState();
    const vd = view.design;
    const patch: Partial<ReturnType<typeof useDesign.getState>> = {};
    if (d.scenarioId !== view.scenarioId) patch.scenarioId = view.scenarioId;
    if (!sameIds(d.componentIds, vd.componentIds)) patch.componentIds = [...vd.componentIds];
    if (d.orbitId !== vd.orbitId) patch.orbitId = vd.orbitId;
    if (d.launcherId !== vd.launcherId) patch.launcherId = vd.launcherId;
    if (d.attempt !== view.attempt) patch.attempt = view.attempt;
    if (!prev || prev.lastNoGo !== view.lastNoGo) {
      const issues = noGoIssues(view.lastNoGo);
      if (!sameIssues(d.lastIssues, issues)) patch.lastIssues = issues;
    }
    if (Object.keys(patch).length > 0) useDesign.setState(patch);
  }

  /** Efectos de entrar en una fase (los mismos que las acciones de entrada de la máquina del solitario). */
  private enterPhase(view: RoomView): void {
    switch (view.phase) {
      case 'lobby':
      case 'briefing':
        useDesign.getState().hold(null);
        useSim.getState().clear();
        break;
      case 'design':
        useDesign.getState().hold(null);
        useSim.getState().clear();
        useUi.getState().setView('first');
        break;
      case 'launch':
      case 'operation':
        useUi.getState().setView('third');
        break;
      default:
        break;
    }
  }

  private syncSim(view: RoomView): void {
    const phase = view.phase;
    const sim = useSim.getState();
    if ((phase === 'prelaunch' || phase === 'launch' || phase === 'operation' || phase === 'report') && view.preLaunch && view.preLaunch !== sim.preLaunch) {
      useSim.setState({ preLaunch: view.preLaunch });
    }
    if (phase === 'launch' || phase === 'operation') {
      if (!isMirroring()) useSim.getState().mirrorStart({ design: view.design, seed: view.seed, preLaunch: view.preLaunch });
      useSim.getState().mirrorFollow({
        simT: view.sim.simT,
        accel: view.sim.accel,
        snapshot: view.sim.snapshot,
        launchOk: view.sim.launchOk,
        finished: view.sim.finished,
      });
      if (mirrorInfo()?.driven) useSim.getState().mirrorEvents(view.events);
    }
    if (phase === 'report') useSim.getState().setResult(view.result);
  }

  private syncMascot(view: RoomView): void {
    const cue = view.mascot;
    if (!cue || cue.seq === this.lastMascotSeq) return;
    this.lastMascotSeq = cue.seq;
    useMascot.getState().say(cue.trigger, { variant: cue.variant, force: true });
  }

  // ─── Mensajes efímeros ────────────────────────────────────────────────────

  /** Aplica un `notice` del servidor (también lo usan los tests). */
  onNotice(payload: unknown): void {
    if (this.ended) return;
    const notice = parseNotice(payload);
    if (!notice) return;
    const now = config.now();
    const entry: ReceivedNotice = { id: ++this.seq, notice, receivedAtMs: now };
    useRoom.setState((s) => ({ notices: [...s.notices, entry].slice(-NOTICE_HISTORY) }));
    switch (notice.kind) {
      case 'rejected':
        useRoom.setState({ lastRejected: { action: notice.action, reason: notice.reason, atMs: now } });
        useUi.getState().showNotice({ tone: 'warn', ref: notice.reason });
        break;
      case 'request-created':
        useRoom.setState({ lastRequestId: notice.requestId });
        this.showRequestNotice(notice.requestId);
        break;
      case 'ping': {
        const mark: PingMark = {
          id: entry.id, playerId: notice.playerId, role: notice.role, target: notice.target, atS: notice.atS,
          receivedAtMs: now, expiresAtMs: now + PING_TTL_MS,
        };
        useRoom.setState((s) => ({ pings: [...s.pings.filter((p) => p.expiresAtMs > now), mark] }));
        this.later(PING_TTL_MS + 50, () => {
          const t = config.now();
          useRoom.setState((s) => (s.pings.some((p) => p.expiresAtMs <= t) ? { pings: s.pings.filter((p) => p.expiresAtMs > t) } : s));
        });
        break;
      }
    }
  }

  /** Aviso «solicitud enviada» con su explicación (`why`) en cuanto la solicitud está en la vista. */
  private showRequestNotice(requestId: string): void {
    const req = useRoom.getState().view?.requests.find((r) => r.id === requestId);
    if (!req) {
      this.pendingRequestNotice = requestId;
      return;
    }
    this.pendingRequestNotice = null;
    if (req.fromPlayerId !== this.room.sessionId) return;
    useUi.getState().showNotice(req.why ? { tone: 'info', ref: req.why } : { tone: 'info', key: 'room.notice.requestCreated' });
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.ended) fn();
    }, ms);
    this.timers.add(t);
  }

  // ─── Conexión ─────────────────────────────────────────────────────────────

  private setStatus(status: ConnectionStatus): void {
    if (useRoom.getState().status !== status) useRoom.setState({ status });
  }

  private saveToken(): void {
    const token = this.room.reconnectionToken;
    if (token && !this.ended) storageSet(TOKEN_KEY, token);
  }

  /** Sale de la sala (consentido: el servidor reparte mis roles) y vuelve al menú en solitario. */
  async leave(): Promise<void> {
    if (this.ended) return;
    this.leaving = true;
    storageRemove(TOKEN_KEY);
    try {
      await this.room.leave(true);
    } catch (e) {
      console.warn('[room] leave', e);
    }
    this.end('idle', null);
  }

  /**
   * Fin de la sesión (salida, cierre del servidor o reconexión fallida): todo vuelve al solitario. Con
   * `retryUntilMs` (caída sin consentimiento aún dentro de la gracia del servidor) se CONSERVA el token y
   * se publica `useRoom.retry` para que el jugador pueda volver con `retryRoom()`.
   */
  private end(status: ConnectionStatus, error: RoomErrorInfo | null, retryUntilMs: number | null = null): void {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const canRetry = retryUntilMs !== null && retryUntilMs > config.now() && storageGet(TOKEN_KEY) !== null;
    if (!canRetry) storageRemove(TOKEN_KEY);
    if (useSession.getState().room === this) useSession.setState({ room: null });
    useSim.getState().clear();
    useMascot.getState().clear();
    useDesign.getState().hold(null);
    useRoom.setState({ ...INITIAL_ROOM_STATE, status, error });
    if (canRetry) offerRetry(retryUntilMs);
    getLocalSession().toMenu();
    if (error) useUi.getState().showNotice({ tone: 'bad', key: error.key });
  }

  // ─── Acciones ─────────────────────────────────────────────────────────────

  /** Envía la acción (el servidor decide) y devuelve la previsión local (`canDo`). */
  send(action: TeamAction): SessionResult {
    if (this.ended) return INVALID_ACTION;
    const check = canDo(action);
    this.room.send('action', action);
    return check;
  }

  addComponent(componentId: string): SessionResult {
    return this.send({ type: 'add-component', componentId });
  }
  removeComponent(componentId: string): SessionResult {
    return this.send({ type: 'remove-component', componentId });
  }
  removeLast(): SessionResult {
    const ids = useRoom.getState().view?.design.componentIds ?? [];
    const last = ids[ids.length - 1];
    return last ? this.removeComponent(last) : INVALID_ACTION;
  }
  selectOrbit(orbitId: OrbitId | null): SessionResult {
    return this.send({ type: 'select-orbit', orbitId });
  }
  selectLauncher(launcherId: string | null): SessionResult {
    return this.send({ type: 'select-launcher', launcherId });
  }

  startDesign(): SessionResult {
    return this.send({ type: 'start-design' });
  }
  requestReview(): SessionResult {
    return this.send({ type: 'request-review' });
  }
  backToDesign(): SessionResult {
    const r = reject('team.reject.voteNeedsReason');
    if (r.kind === 'reject') useUi.getState().showNotice({ tone: 'warn', ref: r.reason });
    return r;
  }
  launch(): SessionResult {
    const roles = useRoom.getState().myRoles;
    if (roles.length === 0) return reject('team.reject.noRole');
    let out: SessionResult = APPLY;
    for (const role of roles) {
      const r = this.vote(role, 'go');
      if (r.kind === 'reject') out = r;
    }
    return out;
  }
  confirmLaunch(): SessionResult {
    return this.send({ type: 'confirm-launch' });
  }
  launchDone(): SessionResult {
    return this.send({ type: 'launch-done' });
  }
  setTimeScale(accel: number): SessionResult {
    return this.send({ type: 'set-time-scale', accel });
  }
  finishOperation(): SessionResult {
    return this.send({ type: 'finish-operation' });
  }
  redesign(): SessionResult {
    return this.send({ type: 'redesign' });
  }
  toMenu(): void {
    void this.leave();
  }

  setName(name: string): SessionResult {
    const clean = clipPlayerText(name, TEAM_LIMITS.nameMaxChars);
    return clean ? this.send({ type: 'set-name', name: clean }) : reject('team.reject.emptyText');
  }
  claimRoles(roles: TeamRole[]): SessionResult {
    return this.send({ type: 'claim-roles', roles: [...new Set(roles)] });
  }
  autoAssignRoles(): SessionResult {
    return this.send({ type: 'auto-assign-roles' });
  }
  startMission(): SessionResult {
    return this.send({ type: 'start-mission' });
  }
  allocateBudget(allocation: SubsystemAllocation | null): SessionResult {
    // Sin claves `undefined`: el esquema del servidor es estricto.
    const clean = allocation === null
      ? null
      : (Object.fromEntries(Object.entries(allocation).filter(([, v]) => typeof v === 'number')) as SubsystemAllocation);
    return this.send({ type: 'allocate-budget', allocation: clean });
  }
  requestResource(req: ResourceRequestInput): SessionResult {
    const note = req.note !== undefined ? clipPlayerText(req.note, TEAM_LIMITS.noteMaxChars) : null;
    return this.send({
      type: 'request-resource',
      resource: req.resource,
      ...(req.amount !== undefined ? { amount: req.amount } : {}),
      ...(req.subsystem !== undefined ? { subsystem: req.subsystem } : {}),
      ...(note ? { note } : {}),
    });
  }
  resolveRequest(requestId: string, approve: boolean, note?: string): SessionResult {
    const clean = note !== undefined ? clipPlayerText(note, TEAM_LIMITS.noteMaxChars) : null;
    return this.send({ type: 'resolve-request', requestId, approve, ...(clean ? { note: clean } : {}) });
  }
  withdrawRequest(requestId: string): SessionResult {
    return this.send({ type: 'withdraw-request', requestId });
  }
  vote(role: TeamRole, value: GoNoGoVoteValue, reason?: NoGoReason): SessionResult {
    let r: NoGoReason | undefined;
    if (reason) {
      const note = reason.note !== undefined ? clipPlayerText(reason.note, TEAM_LIMITS.noteMaxChars) : null;
      r = note ? { code: reason.code, note } : { code: reason.code };
    }
    return this.send({ type: 'vote', role, value, ...(r ? { reason: r } : {}) });
  }
  ackAlert(alertId: string, role: TeamRole): SessionResult {
    return this.send({ type: 'ack-alert', alertId, role });
  }
  chat(text: string): SessionResult {
    const clean = clipPlayerText(text, TEAM_LIMITS.chatMaxChars);
    return clean ? this.send({ type: 'chat', text: clean }) : reject('team.reject.emptyText');
  }
  ping(target: PingTarget): SessionResult {
    return this.send({ type: 'ping', target });
  }

  move(pose: AvatarPose): boolean {
    if (this.ended || useRoom.getState().status !== 'connected') return false;
    const t = config.now();
    if (t - this.lastMoveAt < MOVE_MIN_INTERVAL_MS) return false;
    if (![pose.x, pose.y, pose.z, pose.yaw].every(Number.isFinite)) return false;
    const l = this.lastPose;
    const E = 1e-3;
    if (l && Math.abs(l.x - pose.x) < E && Math.abs(l.y - pose.y) < E && Math.abs(l.z - pose.z) < E && Math.abs(l.yaw - pose.yaw) < E) return false;
    this.lastMoveAt = t;
    this.lastPose = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw };
    this.room.send('move', this.lastPose);
    return true;
  }
}

// ─── Entrar y salir de una sala ─────────────────────────────────────────────

// ─── Volver tras una caída (`useRoom.retry`) ────────────────────────────────

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetryTimer(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

/** Publica `useRoom.retry` y programa su caducidad (al vencer se borran el token y `retry`). */
function offerRetry(untilMs: number): void {
  clearRetryTimer();
  useRoom.setState({ retry: { untilMs } });
  const t = setTimeout(() => expireRetry(untilMs), Math.max(0, untilMs - config.now()));
  // En Node (tests) el temporizador no debe mantener vivo el proceso.
  (t as { unref?: () => void }).unref?.();
  retryTimer = t;
}

/** Vence (o se descarta) la oportunidad de volver: borra el token y `retry`. Con `untilMs`, solo si sigue siendo esa. */
function expireRetry(untilMs?: number): void {
  const r = useRoom.getState().retry;
  if (untilMs !== undefined && r?.untilMs !== untilMs) return;
  clearRetryTimer();
  storageRemove(TOKEN_KEY);
  if (r) useRoom.setState({ retry: null });
}

let inFlight: Promise<boolean> | null = null;

interface ConnectOptions {
  /** Clave ui de respaldo si el error no tiene una propia (`joinError`). */
  errorKey?: string;
  /** Tras un fallo (ya con `useRoom.error` escrito). */
  onFail?: (error: RoomErrorInfo) => void;
  /** Conservar `useRoom.retry` mientras se intenta (solo `retryRoom`). */
  keepRetry?: boolean;
}

/**
 * Abre una sala con `open` y la convierte en la sesión activa. Si ya hay un intento en curso, devuelve
 * ese mismo (doble clic, StrictMode). Si ya hay una sala, sale primero. Nunca lanza: devuelve false y deja
 * `useRoom.status = 'error'` con `error` (y un aviso en pantalla).
 */
function connect(open: (client: ClientLike) => Promise<RoomLike>, opts: ConnectOptions = {}): Promise<boolean> {
  if (inFlight) return inFlight;
  const run = async (): Promise<boolean> => {
    const current = useSession.getState().room;
    if (current) await current.leave();
    const retry = opts.keepRetry ? useRoom.getState().retry : null;
    if (!retry) clearRetryTimer();
    useRoom.setState({ ...INITIAL_ROOM_STATE, status: 'connecting', retry });
    try {
      const client = await config.clientFactory(config.url());
      const room = await open(client);
      clearRetryTimer();
      new RoomSession(room).attach();
      return true;
    } catch (e) {
      console.warn('[room] no se pudo entrar en la sala', e);
      const error = joinError(e, opts.errorKey);
      useRoom.setState({ ...INITIAL_ROOM_STATE, status: 'error', error, retry });
      opts.onFail?.(error);
      useUi.getState().showNotice({ tone: 'bad', key: error.key });
      return false;
    }
  };
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

const playerName = (name: string): string => clipPlayerText(name, TEAM_LIMITS.nameMaxChars) ?? '';

/** Partida rápida: se une a una sala en `lobby` de ese escenario o crea una pública. */
export function quickMatch(opts: { scenarioId: string; name: string }): Promise<boolean> {
  return connect((c) => c.joinOrCreate(ROOM_NAME, { scenarioId: opts.scenarioId, name: playerName(opts.name) }));
}

/**
 * Sala privada: el código para invitar es `useRoom.roomCode` (= roomId). `seed` es SOLO para desarrollo
 * y tests: el servidor solo la acepta con `NODE_ENV=test` o `PAYLOAD_ALLOW_SEED=1` (si no, la ignora).
 */
export function createPrivateRoom(opts: { scenarioId: string; name: string; seed?: number }): Promise<boolean> {
  return connect((c) => c.create(ROOM_NAME, {
    scenarioId: opts.scenarioId, name: playerName(opts.name), private: true, ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  }));
}

/** Entrar con el código de una sala (privada o no). */
export function joinRoomByCode(code: string, opts: { name: string }): Promise<boolean> {
  const id = code.trim();
  if (!id) {
    useRoom.setState({ ...INITIAL_ROOM_STATE, status: 'error', error: { key: 'room.error.notFound' } });
    return Promise.resolve(false);
  }
  return connect((c) => c.joinById(id, { name: playerName(opts.name) }));
}

/** Tras recargar la página: vuelve a la sala con el token guardado (si lo hay). */
export function resumeRoom(): Promise<boolean> {
  const token = storageGet(TOKEN_KEY);
  if (!token) return Promise.resolve(false);
  return connect((c) => c.reconnect(token), { errorKey: 'room.error.resume', onFail: () => storageRemove(TOKEN_KEY) });
}

/**
 * Vuelve a la sala tras una caída (mientras `useRoom.retry` siga vigente) con el token guardado: mismos
 * roles y sitio. Si el servidor responde que ya no hay sitio (la gracia venció), se descarta `retry`;
 * si el servidor no responde (sigue sin red), `retry` se mantiene para volver a intentarlo.
 */
export function retryRoom(): Promise<boolean> {
  const r = useRoom.getState().retry;
  const token = storageGet(TOKEN_KEY);
  if (!r || !token || config.now() >= r.untilMs) {
    expireRetry();
    return Promise.resolve(false);
  }
  return connect((c) => c.reconnect(token), {
    errorKey: 'room.error.resume',
    keepRetry: true,
    onFail: (error) => {
      if (error.code !== undefined) expireRetry();
    },
  });
}

/** El jugador renuncia a volver (p. ej. «Descartar» en el aviso): borra el token y `retry`. */
export function dismissRetry(): void {
  expireRetry();
}

/** Sale de la sala actual (si la hay) y vuelve al menú en solitario. */
export async function leaveRoom(): Promise<void> {
  await useSession.getState().room?.leave();
}

/** La sesión de sala activa (o null). */
export const currentRoomSession = (): RoomSession | null => useSession.getState().room;
