/**
 * Estado de la SALA en el cliente (Zustand). Lo escribe solo `RoomSession`; la UI lo lee.
 *
 *  - `view`: última vista del servidor (`decodeRoomView(room.state.toJSON())`), con referencias estables en
 *    las partes que no cambian (net/roomView.ts): seleccionar `s.view?.chat` no re-renderiza si el chat
 *    no cambió. OJO: `view` cambia a ~10 Hz en operación (`sim.simT`); selecciona subcampos.
 *  - `myId` (sessionId), `myRoles`, `isHost`, `status` de la conexión, `roomCode` (= roomId, para invitar),
 *    `error` (clave `ui` + `MessageRef`/código opcional), `notices` (avisos recibidos) y `pings` recientes.
 *
 * Los selectores `select*` son funciones puras de `RoomState`; los que devuelven listas nuevas deben
 * usarse con `useShallow` (zustand/react/shallow) o `useMemo`, nunca directamente en `useRoom(...)`.
 * `canDo(action)` dice si una acción se aplicaría, generaría una solicitud o se rechazaría (y por qué).
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  ADVISOR_ROLES, catalog, checkTeamAction, missingRoles, reviewGoNoGo, sanitizePlayerText, tallyGoNoGo, TEAM_LIMITS,
  validateVote,
  type MessageRef, type PingTarget, type ResourceRequest, type RoomView, type ServerNotice, type TeamAction,
  type TeamActionCheck, type TeamAlert, type TeamPlayer, type TeamPollResult, type TeamRole,
} from '@payload/shared';
import type { PhaseName } from '../app/missionMachine';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

/** Error de conexión o de sala: clave `ui` (`room.error.*`) y, si lo hay, el código del SDK o un `MessageRef`. */
export interface RoomErrorInfo {
  key: string;
  code?: number;
  ref?: MessageRef;
}

/** Aviso `notice` recibido del servidor. */
export interface ReceivedNotice {
  id: number;
  notice: ServerNotice;
  receivedAtMs: number;
}

/** Ping de un jugador, visible hasta `expiresAtMs` (reloj local, `performance.now()`). */
export interface PingMark {
  id: number;
  playerId: string;
  role: TeamRole | null;
  target: PingTarget;
  /** Segundo de sala en que se hizo. */
  atS: number;
  receivedAtMs: number;
  expiresAtMs: number;
}

/** Tiempo que se dibuja un ping. */
export const PING_TTL_MS = 6000;
/** Avisos recibidos que se guardan (los más recientes). */
export const NOTICE_HISTORY = 20;

export interface RoomState {
  status: ConnectionStatus;
  view: RoomView | null;
  myId: string | null;
  myRoles: readonly TeamRole[];
  isHost: boolean;
  /** Código para invitar (= `roomId`); null fuera de una sala. */
  roomCode: string | null;
  error: RoomErrorInfo | null;
  notices: readonly ReceivedNotice[];
  pings: readonly PingMark[];
  /** Id de la última solicitud creada por mí (`notice` `request-created`). */
  lastRequestId: string | null;
  /** Última acción mía que rechazó el servidor (motivo `MessageRef`, ns `sim`; se muestra con `tr`). */
  lastRejected: { action: TeamAction['type']; reason: MessageRef; atMs: number } | null;
  /**
   * Tras perder la conexión SIN salir (caída de red, reconexión automática fallida): el servidor guarda
   * el sitio y los roles `TEAM_LIMITS.reconnectGraceS` desde la caída. Mientras `retry` no sea null se
   * puede volver con `retryRoom()`. `untilMs` usa el reloj de `configureNet.now` (por defecto
   * `performance.now()`, el mismo de `PingMark.expiresAtMs`). Al vencer vuelve a null y se borra el token.
   */
  retry: { untilMs: number } | null;
}

export const INITIAL_ROOM_STATE: RoomState = {
  status: 'idle',
  view: null,
  myId: null,
  myRoles: [],
  isHost: false,
  roomCode: null,
  error: null,
  notices: [],
  pings: [],
  lastRequestId: null,
  lastRejected: null,
  retry: null,
};

export const useRoom = create<RoomState>(() => ({ ...INITIAL_ROOM_STATE }));

// ─── Fase activa ────────────────────────────────────────────────────────────

/** Fase que se muestra: la del servidor si hay sala; si no, la de la máquina del solitario. */
export function activePhase(machinePhase: PhaseName, view: Pick<RoomView, 'phase'> | null): PhaseName {
  return view ? view.phase : machinePhase;
}

/** Hook: fase activa (App). */
export function useActivePhase(machinePhase: PhaseName): PhaseName {
  const roomPhase = useRoom((s) => s.view?.phase ?? null);
  return roomPhase ?? machinePhase;
}

// ─── Selectores puros ───────────────────────────────────────────────────────

const EMPTY: readonly never[] = [];

export const selectInRoom = (s: RoomState): boolean => s.view !== null;
export const selectMe = (s: RoomState): TeamPlayer | null => s.view?.players.find((p) => p.id === s.myId) ?? null;
export const selectPlayers = (s: RoomState): readonly TeamPlayer[] => s.view?.players ?? EMPTY;
/** Jugador conectado que tiene el rol (o null). */
export const selectRoleHolder = (s: RoomState, role: TeamRole): TeamPlayer | null =>
  s.view?.players.find((p) => p.roles.includes(role) && p.connected) ?? s.view?.players.find((p) => p.roles.includes(role)) ?? null;
/** Roles sin ningún jugador conectado (lobby: para `start-mission` deben estar todos cubiertos). */
export const selectMissingRoles = (s: RoomState): TeamRole[] => (s.view ? missingRoles(s.view.players) : [...ADVISOR_ROLES]);

export const selectOpenRequests = (s: RoomState): ResourceRequest[] => (s.view?.requests ?? EMPTY).filter((r) => r.status === 'open');
/** Solicitudes abiertas que me toca resolver (dirigidas a alguno de mis roles). */
export const selectRequestsForMe = (s: RoomState): ResourceRequest[] =>
  selectOpenRequests(s).filter((r) => s.myRoles.includes(r.toRole));
/** Solicitudes hechas por mí (todas, para ver su estado). */
export const selectMyRequests = (s: RoomState): ResourceRequest[] => (s.view?.requests ?? EMPTY).filter((r) => r.fromPlayerId === s.myId);

export const selectOpenAlerts = (s: RoomState): TeamAlert[] => (s.view?.alerts ?? EMPTY).filter((a) => a.closedAtS === null);
/** Alertas abiertas que esperan la respuesta de alguno de mis roles, con esos roles. */
export const selectAlertsForMe = (s: RoomState): { alert: TeamAlert; roles: TeamRole[] }[] =>
  selectOpenAlerts(s)
    .map((alert) => ({ alert, roles: alert.requiredRoles.filter((r) => s.myRoles.includes(r) && !alert.acks.some((k) => k.role === r)) }))
    .filter((x) => x.roles.length > 0);

/** Recuento de la votación con la revisión técnica actual (null fuera de una sala). */
export function selectPoll(s: RoomState): TeamPollResult | null {
  if (!s.view) return null;
  let go = false;
  try {
    go = reviewGoNoGo(s.view.design, catalog).go;
  } catch {
    /* motor no disponible */
  }
  return tallyGoNoGo(s.view.votes, { go });
}
/** Mis roles que aún no han votado (o cuyo último voto no es válido). */
export const selectMyPendingVotes = (s: RoomState): TeamRole[] => {
  const poll = selectPoll(s);
  return poll ? s.myRoles.filter((r) => poll.missingRoles.includes(r)) : [];
};

/** Pings aún visibles en `nowMs` (reloj de `performance.now()`). */
export const selectActivePings = (s: RoomState, nowMs: number): PingMark[] => s.pings.filter((p) => p.expiresAtMs > nowMs);

/** Datos del informe de equipo: el `result` del servidor y la colaboración (null fuera de una sala). */
export const selectTeamReport = (s: RoomState) =>
  s.view ? { result: s.view.result, collaboration: s.view.collaboration, teamScore: s.view.teamScore } : null;

// ─── Asesores por rol ───────────────────────────────────────────────────────

/** Roles de asesor que se muestran: en sala, solo los míos (todos si aún no tengo rol); en solitario, todos. */
export function visibleAdvisorRoles(inRoom: boolean, myRoles: readonly TeamRole[]): readonly TeamRole[] {
  if (!inRoom || myRoles.length === 0) return ADVISOR_ROLES;
  return ADVISOR_ROLES.filter((r) => myRoles.includes(r));
}

export function useVisibleAdvisorRoles(): readonly TeamRole[] {
  const inRoom = useRoom(selectInRoom);
  const myRoles = useRoom((s) => s.myRoles);
  return useMemo(() => visibleAdvisorRoles(inRoom, myRoles), [inRoom, myRoles]);
}

// ─── ¿Puedo hacerlo? ────────────────────────────────────────────────────────

const reject = (key: string, params?: MessageRef['params']): TeamActionCheck => ({ kind: 'reject', reason: params ? { key, params } : { key } });

/**
 * Veredicto local de una acción con la vista y mis roles (`checkTeamAction` de shared), más lo que el
 * servidor también comprueba aparte: el contenido del voto (`validateVote`) y el texto vacío (chat, nombre).
 * `apply` = se aplicará · `request` = se convertirá en una solicitud a `toRole` (con `why`) ·
 * `reject` = el servidor la rechazará (`reason`, ns `sim`). Fuera de una sala: `reject` invalidAction.
 */
export function canDoIn(s: Pick<RoomState, 'view' | 'myId' | 'myRoles' | 'isHost'>, action: TeamAction): TeamActionCheck {
  const view = s.view;
  if (!view) return reject('team.reject.invalidAction');
  const check = checkTeamAction(
    {
      phase: view.phase,
      actorRoles: s.myRoles,
      isHost: s.isHost,
      design: view.design,
      allocation: view.allocation,
      catalog,
      requests: view.requests,
      votes: view.votes,
      ...(s.myId ? { actorId: s.myId } : {}),
      players: view.players,
      alerts: view.alerts,
    },
    action,
  );
  if (check.kind === 'reject') return check;
  if (action.type === 'vote') {
    let go = false;
    try {
      go = reviewGoNoGo(view.design, catalog).go;
    } catch {
      /* motor no disponible */
    }
    const bad = validateVote(action, go);
    if (bad) return { kind: 'reject', reason: bad };
  }
  if (action.type === 'chat' && sanitizePlayerText(action.text, TEAM_LIMITS.chatMaxChars) === null) return reject('team.reject.emptyText');
  if (action.type === 'set-name' && sanitizePlayerText(action.name, TEAM_LIMITS.nameMaxChars) === null) return reject('team.reject.emptyText');
  return check;
}

/** `canDoIn` con el estado actual de `useRoom`. */
export function canDo(action: TeamAction): TeamActionCheck {
  return canDoIn(useRoom.getState(), action);
}

/**
 * Hook: veredicto de una acción, recalculado cuando cambian la vista o mis roles. Pasa una acción
 * memorizada (o null); p. ej. `useCanDo(useMemo(() => ({ type: 'select-orbit', orbitId }), [orbitId]))`.
 */
export function useCanDo(action: TeamAction | null): TeamActionCheck | null {
  const view = useRoom((s) => s.view);
  const myId = useRoom((s) => s.myId);
  const myRoles = useRoom((s) => s.myRoles);
  const isHost = useRoom((s) => s.isHost);
  return useMemo(() => (action ? canDoIn({ view, myId, myRoles, isHost }, action) : null), [action, view, myId, myRoles, isHost]);
}
