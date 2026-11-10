/**
 * Modelo PURO de una sala `mission` (fase 3): sin Colyseus, sin reloj y sin azar propio. Guarda la
 * `RoomView` (lo que se sincroniza), la `MissionSim` del intento y los contadores de la sala, y aplica
 * las acciones de los jugadores con la lógica de `@payload/shared` (`checkTeamAction`, solicitudes,
 * votos, alertas, colaboración). El adaptador `MissionRoom` solo traduce mensajes y tiempos; los tests
 * conducen este modelo directamente pasando `nowS` (segundos de sala), así todo es determinista.
 *
 * Inmutable por fuera: cada cambio sustituye `view` por un objeto nuevo (y los subobjetos que cambian),
 * de modo que `model.view !== anterior` significa "hay algo que sincronizar". Nunca se muta una vista
 * ya publicada.
 *
 * Flujo de fases (docs/MULTIPLAYER.md):
 *   lobby ─start-mission (anfitrión, 4 roles cubiertos por conectados)→ briefing ─start-design (Dirección)→ design
 *   design ─request-review→ motor No-Go: sigue en design con lastNoGo {source: 'review', issues: blockers}
 *                         → motor Go: review (votación; el primer No-Go válido vuelve a design con
 *                           lastNoGo {source: 'vote', votes}); los 4 roles en Go → prelaunch
 *   prelaunch: rollPreLaunchEvents(design, cat, seed); sin eventos → launch directo; con eventos → confirm-launch (Dirección)
 *   launch: createMissionSim(design, cat, {seed, preLaunch}); resultado del lanzamiento en el primer snapshot;
 *           → operation cuando todos los conectados mandan launch-done o pasan launchScreenMaxS
 *           (lanzamiento fallido → report)
 *   operation: tick a simTickHz: sim.step(dt × accel) en trozos de SIM_CHUNK_S; un evento de
 *           EVENT_RESPONSE_ROLES abre una alerta y pausa (paused) hasta que respondan los roles o venza el
 *           plazo; finish-operation (Dirección) o el final natural → report
 *   report: result = sim.finish() (paridad con runMission), collaboration, teamScore; redesign (Dirección)
 *           → design con intento + 1 y semilla + 1 (mismo diseño y reparto; se limpian solicitudes, votos,
 *           alertas, eventos y resultado: la colaboración se puntúa por intento).
 */
import {
  ackAlert, alertForEvent, alertTimedOut, applyApprovedRequest, applyDesignAction, buildResourceRequest,
  catalog as defaultCatalog, checkTeamAction, closeAlert, closeRequest, combineRoles, createMissionSim, createRoomView,
  EVENT_RESPONSE_ROLES, getScenario, reviewGoNoGo, roleMascotTrigger, rollPreLaunchEvents, sanitizePlayerText,
  purgeRequests, scoreCollaboration, tallyGoNoGo, takeRequestToken, TEAM_ACTION_PHASES, TEAM_LIMITS, TEAM_ROLES, teamActionSchema, teamVoteFrom, validateVote,
  withCollaboration,
  type AvatarPose, type Catalog, type ChatMessage, type GoNoGoResult, type MessageRef, type MissionSim, type PingTarget,
  type ResourceRequest, type RoomSimView, type RoomView, type ServerNotice, type SimEvent, type SimSnapshot,
  type SubsystemAllocation, type TeamAction, type TeamActionCheck, type TeamActionContext, type TeamAlert, type TeamPlayer,
  type PurgedRequestStats, type RequestRateBucket, type TeamRequestCheck, type TeamRole,
} from '@payload/shared';
import { catalogHasDialogue, MASCOT_CHATTER_MIN_S, MascotDirector, type MascotOfferOptions } from './mascotDirector';

/** Trozo máximo de tiempo simulado por `step` en operación (s): las alertas pausan como mucho este tiempo después del evento. */
export const SIM_CHUNK_S = 60;
/** Tope del tiempo real que se aplica en un tick (s): tras un parón del proceso no se dan saltos enormes. */
export const MAX_TICK_DT_S = 1;
/** Intervalo mínimo entre dos `move` de un jugador (s), con un 10 % de holgura sobre `moveMaxHz` por la variación de la red. */
export const MOVE_MIN_INTERVAL_S = 0.9 / TEAM_LIMITS.moveMaxHz;
/** Límite de las coordenadas de la pose (m): como los puntos de un ping. */
export const POSE_MAX_ABS = 1e4;

/** Aviso para un jugador (`to` = sessionId) o para todos (`to` = null). */
export interface Outgoing {
  to: string | null;
  notice: ServerNotice;
}

export type JoinRejection = 'room-not-in-lobby' | 'room-full' | 'already-joined';
export type JoinResult = { ok: true } | { ok: false; reason: JoinRejection };

export interface RoomModelInit {
  roomId: string;
  scenarioId: string;
  /** Intento inicial (por defecto 0). */
  attempt?: number;
  /** Semilla fija del intento inicial (solo desarrollo/tests); por defecto defaultSeed + intento. */
  seed?: number | null;
  catalog?: Catalog;
  /**
   * Solicitudes CERRADAS que se conservan en la vista (`purgeRequests`); por defecto `TEAM_LIMITS.requestHistory`.
   * Solo los tests lo cambian (p. ej. `Infinity` para comparar la colaboración con y sin purga).
   */
  requestHistory?: number;
}

const LAUNCH_EVENTS: ReadonlySet<string> = new Set(['launch-success', 'launch-failure']);
const ONCE: MascotOfferOptions = { oncePerAttempt: true };

const ref = (key: string, params?: MessageRef['params']): MessageRef => (params ? { key, params } : { key });
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Snapshot sincronizado: sin `newEvents` (los eventos van en `view.events`). */
const strip = (s: SimSnapshot): SimSnapshot => ({ ...s, newEvents: [] });
const trimEvents = (events: SimEvent[]): SimEvent[] =>
  events.length > TEAM_LIMITS.eventHistory ? events.slice(-TEAM_LIMITS.eventHistory) : events;

/** Tipo de acción de un mensaje que no pasó el esquema (para poder decir qué se rechazó), o null. */
function rawActionType(raw: unknown): TeamAction['type'] | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null;
  return Object.hasOwn(TEAM_ACTION_PHASES, raw.type) ? (raw.type as TeamAction['type']) : null;
}

/** Pose del avatar validada (`{x, y, z, yaw}` finitos y acotados, sin campos de más), o null. */
export function parsePose(raw: unknown): AvatarPose | null {
  if (!isObject(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 4) return null;
  const out: Record<string, number> = {};
  for (const k of ['x', 'y', 'z', 'yaw'] as const) {
    const v = raw[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > POSE_MAX_ABS) return null;
    out[k] = v;
  }
  return { x: out.x!, y: out.y!, z: out.z!, yaw: out.yaw! };
}

const rejected = (to: string, action: TeamAction['type'], reason: MessageRef): Outgoing => ({
  to,
  notice: { kind: 'rejected', action, reason },
});

export class RoomModel {
  readonly catalog: Catalog;
  readonly mascot: MascotDirector;
  private _view: RoomView;
  private sim: MissionSim | null = null;
  /** Revisión del motor con la que se abrió la votación (el diseño no cambia en `review`). */
  private engineReview: GoNoGoResult | null = null;
  private launchStartedAtS: number | null = null;
  private readonly launchDone = new Set<string>();
  /** Semilla = seedBase + intento. */
  private readonly seedBase: number;
  private nextRequestId = 1;
  private nextAlertId = 1;
  private nextChatId = 1;
  private readonly lastChatAt = new Map<string, number>();
  private readonly lastPingAt = new Map<string, number>();
  private readonly lastMoveAt = new Map<string, number>();
  /** Cubeta de fichas de cada jugador para crear solicitudes (`takeRequestToken`: ráfaga `requestBurst`, una ficha cada `requestMinIntervalS`). */
  private readonly requestBuckets = new Map<string, RequestRateBucket | null>();
  /** Acumulados de las solicitudes cerradas purgadas de la vista en este intento (para `scoreCollaboration`). */
  private purgedRequests: PurgedRequestStats | undefined = undefined;
  private readonly requestHistory: number;
  /**
   * Roles "aparcados": de alguien que se fue cuando no quedaba NINGÚN jugador conectado; los guarda el
   * jugador más antiguo (caído) y pasan al primero que vuelva (ver `leave` y `reconnect`).
   */
  private readonly parkedRoles = new Set<TeamRole>();
  /** Jugadores admitidos: 4, o menos si el escenario de equipo lo dice (`ScenarioDef.team.maxPlayers`). */
  readonly maxPlayers: number;

  constructor(init: RoomModelInit) {
    this.catalog = init.catalog ?? defaultCatalog;
    const scenario = getScenario(init.scenarioId, this.catalog);
    this.maxPlayers = Math.max(1, Math.min(TEAM_LIMITS.maxPlayers, scenario.team?.maxPlayers ?? TEAM_LIMITS.maxPlayers));
    this.requestHistory = init.requestHistory ?? TEAM_LIMITS.requestHistory;
    const attempt = init.attempt ?? 0;
    const seed = init.seed ?? scenario.defaultSeed + attempt;
    this.seedBase = seed - attempt;
    this._view = createRoomView({ roomId: init.roomId, scenarioId: init.scenarioId, attempt, seed });
    this.mascot = new MascotDirector(catalogHasDialogue(this.catalog));
  }

  /** Vista actual (objeto nuevo tras cada cambio). */
  get view(): RoomView {
    return this._view;
  }

  /** Simulación del intento (null antes del lanzamiento y tras `redesign`). */
  get simulation(): MissionSim | null {
    return this.sim;
  }

  player(id: string): TeamPlayer | undefined {
    return this._view.players.find((p) => p.id === id);
  }

  // ─── Jugadores ──────────────────────────────────────────────────────────

  /** Entra un jugador (solo en el lobby). El primero es el anfitrión. Nombre saneado ('' si vacío). */
  join(playerId: string, rawName: unknown, nowS: number): JoinResult {
    if (this.player(playerId)) return { ok: false, reason: 'already-joined' };
    if (this._view.phase !== 'lobby') return { ok: false, reason: 'room-not-in-lobby' };
    if (this._view.players.length >= this.maxPlayers) return { ok: false, reason: 'room-full' };
    const name = sanitizePlayerText(rawName, TEAM_LIMITS.nameMaxChars) ?? '';
    const first = this._view.hostId === null;
    const player: TeamPlayer = { id: playerId, name, roles: [], connected: true, isHost: first, pose: null };
    this.update({ players: [...this._view.players, player], hostId: first ? playerId : this._view.hostId });
    this.offer(first ? 'team:lobby' : 'team:player-joined', nowS);
    this.flushMascot(nowS);
    return { ok: true };
  }

  /** Caída sin consentimiento: conserva roles y sitio mientras dura la gracia de reconexión. */
  drop(playerId: string, nowS: number): void {
    if (!this.player(playerId)) return;
    this.updatePlayer(playerId, (p) => ({ ...p, connected: false }));
    this.offer('team:player-left', nowS);
    this.maybeEndLaunch(nowS);
    this.flushMascot(nowS);
  }

  /**
   * Vuelve un jugador caído: recupera su sitio y sus roles. Si había roles aparcados (se fueron cuando no
   * quedaba nadie conectado), pasan a quien vuelve.
   */
  reconnect(playerId: string, nowS: number): void {
    if (!this.player(playerId)) return;
    let players = this._view.players.map((p) => (p.id === playerId ? { ...p, connected: true } : p));
    const parked = [...this.parkedRoles];
    if (parked.length > 0) {
      this.parkedRoles.clear();
      players = players.map((p) => {
        if (p.id === playerId) return { ...p, roles: TEAM_ROLES.filter((r) => p.roles.includes(r) || parked.includes(r)) };
        return p.connected ? p : { ...p, roles: p.roles.filter((r) => !parked.includes(r)) };
      });
      this.offer('team:roles-combined', nowS);
    }
    this.update({ players });
    this.offer('team:player-back', nowS);
    this.flushMascot(nowS);
  }

  /**
   * Salida definitiva (consentida o tras agotar la gracia). Migra el anfitrión al siguiente jugador
   * conectado (orden de llegada; si no hay ninguno, al más antiguo) y, fuera del lobby, reparte SUS roles
   * solo entre los jugadores CONECTADOS (`handOverRoles`): los demás conservan los suyos y un jugador caído
   * no recibe roles que no podría ejercer. En el lobby los roles simplemente se liberan.
   */
  leave(playerId: string, nowS: number): void {
    const leaving = this.player(playerId);
    if (!leaving) return;
    let players = this._view.players.filter((p) => p.id !== playerId);
    let hostId = this._view.hostId;
    if (hostId === playerId) {
      const next = players.find((p) => p.connected) ?? players[0] ?? null;
      hostId = next?.id ?? null;
      players = players.map((p) => ({ ...p, isHost: p.id === hostId }));
      if (next) this.offer('team:host-changed', nowS);
    }
    let recombined = false;
    if (this._view.phase !== 'lobby' && players.length > 0 && leaving.roles.length > 0) {
      players = this.handOverRoles(players, leaving.roles);
      recombined = true;
    }
    this.update({ players, hostId });
    this.launchDone.delete(playerId);
    this.requestBuckets.delete(playerId);
    this.lastChatAt.delete(playerId);
    this.lastPingAt.delete(playerId);
    this.lastMoveAt.delete(playerId);
    if (leaving.connected) this.offer('team:player-left', nowS);
    if (recombined) this.offer('team:roles-combined', nowS);
    this.maybeEndLaunch(nowS);
    this.flushMascot(nowS);
  }

  /** Pose del avatar (≤ moveMaxHz por jugador; lo que llega más rápido se descarta). true si se aplicó. */
  move(playerId: string, raw: unknown, nowS: number): boolean {
    if (!this.player(playerId)) return false;
    const pose = parsePose(raw);
    if (!pose) return false;
    const last = this.lastMoveAt.get(playerId);
    if (last !== undefined && nowS - last < MOVE_MIN_INTERVAL_S) return false;
    this.lastMoveAt.set(playerId, nowS);
    this.updatePlayer(playerId, (p) => ({ ...p, pose }));
    return true;
  }

  // ─── Acciones ───────────────────────────────────────────────────────────

  /**
   * Aplica el mensaje `action` de un jugador. Devuelve los avisos a enviar: el rechazo (con su
   * `MessageRef`) SOLO a quien actuó, `request-created` a quien originó la solicitud y los pings a todos.
   */
  apply(playerId: string, raw: unknown, nowS: number): Outgoing[] {
    const player = this.player(playerId);
    if (!player) return [];
    const out: Outgoing[] = [];
    const parsed = teamActionSchema.safeParse(raw);
    if (!parsed.success) {
      const type = rawActionType(raw);
      if (type) out.push(rejected(playerId, type, ref('team.reject.invalidAction')));
      return out;
    }
    const action: TeamAction = parsed.data;
    const check = checkTeamAction(this.context(player), action);
    if (check.kind === 'reject') {
      out.push(rejected(playerId, action.type, check.reason));
    } else {
      const reason = this.perform(player, action, check, nowS, out);
      if (reason) out.push(rejected(playerId, action.type, reason));
    }
    this.flushMascot(nowS);
    return out;
  }

  /** Paso periódico (simTickHz): fin de la pantalla de lanzamiento, alertas, simulación y mascota. */
  tick(dtS: number, nowS: number): void {
    if (this._view.phase === 'launch') this.maybeEndLaunch(nowS);
    else if (this._view.phase === 'operation') this.tickOperation(dtS, nowS);
    this.flushMascot(nowS);
  }

  private context(player: TeamPlayer): TeamActionContext {
    const v = this._view;
    return {
      phase: v.phase,
      actorRoles: player.roles,
      isHost: player.isHost,
      design: v.design,
      allocation: v.allocation,
      catalog: this.catalog,
      requests: v.requests,
      votes: v.votes,
      actorId: player.id,
      players: v.players,
      alerts: v.alerts,
    };
  }

  /** Ejecuta una acción ya validada por `checkTeamAction`. Devuelve un motivo de rechazo o null. */
  private perform(player: TeamPlayer, action: TeamAction, check: Exclude<TeamActionCheck, { kind: 'reject' }>, nowS: number, out: Outgoing[]): MessageRef | null {
    switch (action.type) {
      case 'set-name': {
        const name = sanitizePlayerText(action.name, TEAM_LIMITS.nameMaxChars);
        if (name === null) return ref('team.reject.emptyText');
        this.updatePlayer(player.id, (p) => ({ ...p, name }));
        return null;
      }
      case 'claim-roles':
        this.updatePlayer(player.id, (p) => ({ ...p, roles: TEAM_ROLES.filter((r) => action.roles.includes(r)) }));
        return null;
      case 'auto-assign-roles':
        this.autoAssignRoles(nowS);
        return null;
      case 'start-mission':
        this.update({ phase: 'briefing' });
        this.offer('phase:briefing', nowS, ONCE);
        for (const role of TEAM_ROLES) this.offer(roleMascotTrigger(role), nowS);
        return null;
      case 'start-design':
        this.update({ phase: 'design' });
        this.offer('phase:design', nowS, ONCE);
        return null;
      case 'add-component':
      case 'remove-component':
      case 'select-orbit':
      case 'select-launcher':
        if (check.kind === 'request') return this.openPlayerRequest(check, action, player.id, nowS, out);
        this.update({ design: applyDesignAction(this._view.design, action) });
        return null;
      case 'allocate-budget':
        this.update({ allocation: action.allocation === null ? null : ({ ...action.allocation } satisfies SubsystemAllocation) });
        this.offer('team:allocation', nowS);
        return null;
      case 'request-resource':
        return check.kind === 'request' ? this.openPlayerRequest(check, action, player.id, nowS, out) : null;
      case 'resolve-request':
        this.resolveRequest(player, action, nowS, out);
        return null;
      case 'withdraw-request':
        this.replaceRequest(action.requestId, (r) => closeRequest(r, { status: 'withdrawn', atS: nowS, byPlayerId: player.id }));
        return null;
      case 'request-review':
        this.requestReview(nowS);
        return null;
      case 'vote':
        return this.vote(player, action, nowS);
      case 'confirm-launch':
        this.startLaunch(nowS);
        return null;
      case 'launch-done':
        this.launchDone.add(player.id);
        this.maybeEndLaunch(nowS);
        return null;
      case 'set-time-scale':
        this.updateSim({ accel: action.accel });
        return null;
      case 'ack-alert':
        this.ackAlert(player, action.alertId, action.role, nowS);
        return null;
      case 'finish-operation':
        this.finishMission(nowS);
        return null;
      case 'redesign':
        this.redesign(nowS);
        return null;
      case 'chat':
        return this.chat(player, action.text, nowS);
      case 'ping':
        return this.ping(player, action.target, nowS, out);
    }
  }

  // ─── Lobby ──────────────────────────────────────────────────────────────

  /** Reparto con `combineRoles` entre los jugadores CONECTADOS (respeta lo que ya tenía cada uno si cabe). */
  private autoAssignRoles(nowS: number): void {
    const connected = this._view.players.filter((p) => p.connected);
    const assignment = combineRoles(
      connected.map((p) => p.id),
      Object.fromEntries(this._view.players.map((p) => [p.id, p.roles])),
    );
    this.update({ players: this._view.players.map((p) => ({ ...p, roles: assignment[p.id] ?? [] })) });
    if (connected.length > 0 && connected.length < TEAM_LIMITS.maxPlayers) this.offer('team:roles-combined', nowS);
  }

  /**
   * Reparte los roles de quien se fue SOLO entre los jugadores conectados: cada rol (orden de
   * `TEAM_ROLES`) va al conectado con menos roles (a igualdad, el que llegó antes). Nadie pierde los suyos.
   * Si no queda nadie conectado, se aparcan en el jugador más antiguo (caído) y pasan al primero que
   * vuelva (`reconnect`); así ningún rol queda sin dueño y la misión puede seguir en cuanto haya alguien.
   */
  private handOverRoles(players: TeamPlayer[], roles: readonly TeamRole[]): TeamPlayer[] {
    const connected = players.filter((p) => p.connected);
    const recipients = connected.length > 0 ? connected : players.slice(0, 1);
    const count = new Map(players.map((p) => [p.id, p.roles.length] as const));
    const extra = new Map<string, TeamRole[]>();
    for (const role of TEAM_ROLES.filter((r) => roles.includes(r))) {
      const target = recipients.reduce((best, p) => (count.get(p.id)! < count.get(best.id)! ? p : best));
      count.set(target.id, count.get(target.id)! + 1);
      extra.set(target.id, [...(extra.get(target.id) ?? []), role]);
      if (connected.length > 0) this.parkedRoles.delete(role);
      else this.parkedRoles.add(role);
    }
    return players.map((p) => {
      const add = extra.get(p.id);
      return add ? { ...p, roles: TEAM_ROLES.filter((r) => p.roles.includes(r) || add.includes(r)) } : p;
    });
  }

  // ─── Solicitudes ────────────────────────────────────────────────────────

  /**
   * Solicitud que nace de una acción del jugador (automática o explícita, `checkTeamAction` → `request`):
   * gasta una ficha de su cubeta (`takeRequestToken`: ráfaga de `requestBurst`, una ficha nueva cada
   * `requestMinIntervalS`). Sin ficha ⇒ `team.reject.requestRateLimited {seconds}` y no se crea la solicitud
   * ni se aplica nada. El tope de abiertas por jugador y las duplicadas los rechaza antes `checkTeamAction`
   * (`tooManyRequests`, `requestPending`). Las encadenadas al aprobar no gastan fichas (no las inicia el jugador).
   */
  private openPlayerRequest(check: TeamRequestCheck, action: TeamAction, playerId: string, nowS: number, out: Outgoing[]): MessageRef | null {
    const token = takeRequestToken(this.requestBuckets.get(playerId) ?? null, nowS);
    this.requestBuckets.set(playerId, token.bucket);
    if (!token.ok) return token.reason;
    this.openRequest(check, action, playerId, nowS, out);
    return null;
  }

  private openRequest(check: TeamRequestCheck, action: TeamAction | undefined, fromPlayerId: string, nowS: number, out: Outgoing[]): ResourceRequest {
    const req = buildResourceRequest(check, action, { id: `req-${this.nextRequestId++}`, fromPlayerId, atS: nowS });
    this.setRequests([...this._view.requests, req]);
    out.push({ to: fromPlayerId, notice: { kind: 'request-created', requestId: req.id } });
    this.offer('team:request-open', nowS);
    return req;
  }

  private replaceRequest(id: string, fn: (r: ResourceRequest) => ResourceRequest): void {
    this.setRequests(this._view.requests.map((r) => (r.id === id ? fn(r) : r)));
  }

  /**
   * Única vía para cambiar la lista de solicitudes: conserva todas las abiertas y como mucho
   * `requestHistory` cerradas (`purgeRequests`, primero las retiradas). Lo purgado se acumula en
   * `purgedRequests` (memoria del modelo, no la vista) para que la colaboración del informe sea idéntica
   * a la de la lista completa.
   */
  private setRequests(requests: ResourceRequest[]): void {
    const { kept, purged } = purgeRequests(requests, this.requestHistory, this.purgedRequests);
    this.purgedRequests = purged;
    this.update({ requests: kept });
  }

  /**
   * Aprobar re-aplica la acción en espera sobre el diseño ACTUAL (`applyApprovedRequest`): aplicada,
   * encadenada (se cierra esta como aprobada y se abre la siguiente al otro rol afectado, con el mismo
   * solicitante) o rechazada con el motivo del sistema. Rechazar la cierra con la nota.
   */
  private resolveRequest(player: TeamPlayer, action: Extract<TeamAction, { type: 'resolve-request' }>, nowS: number, out: Outgoing[]): void {
    const req = this._view.requests.find((r) => r.id === action.requestId);
    if (!req) return;
    const close = (status: 'approved' | 'rejected', reason?: MessageRef) =>
      this.replaceRequest(req.id, (r) => closeRequest(r, { status, atS: nowS, byPlayerId: player.id, note: action.note, ...(reason ? { reason } : {}) }));
    if (!action.approve) {
      close('rejected');
      this.offer('team:request-rejected', nowS);
      return;
    }
    const outcome = applyApprovedRequest({ design: this._view.design, allocation: this._view.allocation }, req, this.catalog, player.roles);
    switch (outcome.kind) {
      case 'applied':
        close('approved');
        this.update({ design: outcome.design, allocation: outcome.allocation });
        this.offer('team:request-approved', nowS);
        return;
      case 'request':
        close('approved');
        this.update({ allocation: outcome.allocation });
        this.offer('team:request-approved', nowS);
        this.openRequest(outcome.check, req.action, req.fromPlayerId, nowS, out);
        return;
      case 'reject':
        close('rejected', outcome.reason);
        this.offer('team:request-rejected', nowS);
        return;
    }
  }

  // ─── Go/No-Go ───────────────────────────────────────────────────────────

  private requestReview(nowS: number): void {
    const review = reviewGoNoGo(this._view.design, this.catalog);
    if (!review.go) {
      this.update({
        lastNoGo: { source: 'review', issues: review.issues.filter((i) => i.severity === 'blocker'), votes: [], atS: nowS },
      });
      this.offer('review:no-go', nowS);
      return;
    }
    this.engineReview = review;
    this.update({ phase: 'review', votes: [], lastNoGo: null });
    this.offer('review:go', nowS);
    this.offer('team:vote-open', nowS);
    this.offer('phase:review', nowS, ONCE);
  }

  /** Voto de un rol. El primer No-Go válido cierra la votación y devuelve a todos al diseño. */
  private vote(player: TeamPlayer, action: Extract<TeamAction, { type: 'vote' }>, nowS: number): MessageRef | null {
    const review = this.engineReview ?? reviewGoNoGo(this._view.design, this.catalog);
    const invalid = validateVote(action, review.go);
    if (invalid) return invalid;
    // Un voto por rol: el nuevo SUSTITUYE al anterior de ese rol (el estado no crece con votos repetidos).
    const votes = [...this._view.votes.filter((v) => v.role !== action.role), teamVoteFrom(action, player.id, nowS)];
    const tally = tallyGoNoGo(votes, review);
    if (tally.status === 'no-go') {
      this.engineReview = null;
      this.update({ phase: 'design', votes: [], lastNoGo: { source: 'vote', issues: [], votes: tally.noGoVotes, atS: nowS } });
      this.offer('team:vote-no-go', nowS);
      this.offer('phase:design', nowS, ONCE);
    } else if (tally.status === 'go') {
      this.update({ votes });
      this.offer('team:vote-go', nowS);
      this.enterPrelaunch(nowS);
    } else {
      this.update({ votes });
    }
    return null;
  }

  // ─── Lanzamiento ────────────────────────────────────────────────────────

  private enterPrelaunch(nowS: number): void {
    const preLaunch = rollPreLaunchEvents(this._view.design, this.catalog, this._view.seed);
    this.update({ phase: 'prelaunch', preLaunch });
    for (const e of preLaunch.events) this.mascot.offerEvent(e.type, nowS, 'prelaunch');
    if (preLaunch.events.length === 0) this.startLaunch(nowS);
  }

  /** Crea la simulación como el cliente en solitario: el resultado del lanzamiento sale del primer snapshot. */
  private startLaunch(nowS: number): void {
    const v = this._view;
    const preLaunch = v.preLaunch ?? rollPreLaunchEvents(v.design, this.catalog, v.seed);
    const sim = createMissionSim(v.design, this.catalog, { seed: v.seed, preLaunch });
    let snap = sim.snapshot();
    const events = [...snap.newEvents];
    if (!events.some((e) => LAUNCH_EVENTS.has(e.type))) {
      snap = sim.step(0);
      events.push(...snap.newEvents);
    }
    const launchOk = !(events.some((e) => e.type === 'launch-failure') || snap.status === 'failed');
    this.sim = sim;
    this.launchStartedAtS = nowS;
    this.launchDone.clear();
    this.update({
      phase: 'launch',
      preLaunch,
      events: trimEvents(events),
      sim: { accel: v.sim.accel, simT: snap.tSeconds, snapshot: strip(snap), launchOk, finished: sim.isFinished(), paused: false },
    });
    this.offer('phase:launch', nowS, ONCE);
  }

  /** Pasa a operación (o al informe si el lanzamiento falló) cuando todos los conectados terminaron de verlo o venció el tope. */
  private maybeEndLaunch(nowS: number): void {
    if (this._view.phase !== 'launch' || this.launchStartedAtS === null) return;
    const allDone = this._view.players.filter((p) => p.connected).every((p) => this.launchDone.has(p.id));
    if (!allDone && nowS - this.launchStartedAtS < TEAM_LIMITS.launchScreenMaxS) return;
    this.launchStartedAtS = null;
    if (this._view.sim.launchOk) {
      this.update({ phase: 'operation' });
      this.mascot.offerEvent('launch-success', nowS, 'operation');
      this.offer('phase:operation', nowS, ONCE);
    } else {
      this.finishMission(nowS);
    }
  }

  // ─── Operación ──────────────────────────────────────────────────────────

  private updatePause(): void {
    const paused = this._view.alerts.some((a) => a.closedAtS === null);
    if (paused !== this._view.sim.paused) this.updateSim({ paused });
  }

  private tickOperation(dtS: number, nowS: number): void {
    // Alertas vencidas: se cierran por tiempo (el juego nunca se queda congelado).
    if (this._view.alerts.some((a) => alertTimedOut(a, nowS))) {
      this.update({ alerts: this._view.alerts.map((a) => (alertTimedOut(a, nowS) ? closeAlert(a, nowS, true) : a)) });
      this.offer('team:alert-timeout', nowS);
    }
    this.updatePause();

    const sim = this.sim;
    if (!sim) return;
    const { accel, paused } = this._view.sim;
    if (!paused && accel > 0 && dtS > 0 && !sim.isFinished()) {
      let remaining = Math.min(dtS, MAX_TICK_DT_S) * accel;
      const fresh: SimEvent[] = [];
      const opened: TeamAlert[] = [];
      let snap: SimSnapshot | null = null;
      // En trozos: si salta un evento que pide respuesta, la simulación se detiene justo después.
      while (remaining > 1e-9 && opened.length === 0 && !sim.isFinished()) {
        const chunk = Math.min(remaining, SIM_CHUNK_S);
        remaining -= chunk;
        snap = sim.step(chunk);
        for (const e of snap.newEvents) {
          fresh.push(e);
          if (!EVENT_RESPONSE_ROLES[e.type]) continue;
          const alert = alertForEvent(e, `alert-${this.nextAlertId}`, nowS);
          if (alert) {
            this.nextAlertId += 1;
            opened.push(alert);
          }
        }
      }
      if (snap) {
        this.update({
          events: fresh.length > 0 ? trimEvents([...this._view.events, ...fresh]) : this._view.events,
          alerts: opened.length > 0 ? [...this._view.alerts, ...opened] : this._view.alerts,
          sim: { ...this._view.sim, simT: snap.tSeconds, snapshot: strip(snap), finished: sim.isFinished(), paused: opened.length > 0 },
        });
        for (const e of fresh) this.mascot.offerEvent(e.type, nowS, 'operation');
        if (opened.length > 0) this.offer('team:alert', nowS);
      }
    }
    if (sim.isFinished()) this.finishMission(nowS);
  }

  private ackAlert(player: TeamPlayer, alertId: string, role: TeamAlert['requiredRoles'][number], nowS: number): void {
    const before = this._view.alerts.find((a) => a.id === alertId);
    if (!before) return;
    const after = ackAlert(before, { role, playerId: player.id, atS: nowS });
    this.update({ alerts: this._view.alerts.map((a) => (a.id === alertId ? after : a)) });
    if (before.closedAtS === null && after.closedAtS !== null) this.offer('team:alert-answered', nowS);
    this.updatePause();
  }

  /**
   * Fin de la operación (Dirección o final natural) o lanzamiento fallido: `result = sim.finish()`
   * (idéntico a `runMission` con el mismo diseño, semilla y preLaunch), colaboración y puntuación de
   * equipo. Las alertas aún abiertas se puntúan como abiertas y luego se cierran sin `timedOut`.
   */
  private finishMission(nowS: number): void {
    const sim = this.sim;
    if (!sim) return;
    const result = sim.finish();
    const tail = sim.snapshot();
    const v = this._view;
    const collaboration = scoreCollaboration({
      requests: v.requests, alerts: v.alerts, endedAtS: nowS, ...(this.purgedRequests ? { purged: this.purgedRequests } : {}),
    });
    this.launchStartedAtS = null;
    this.update({
      phase: 'report',
      result,
      collaboration,
      teamScore: withCollaboration(result.score, collaboration.score),
      alerts: v.alerts.map((a) => (a.closedAtS === null ? closeAlert(a, nowS, false) : a)),
      events: tail.newEvents.length > 0 ? trimEvents([...v.events, ...tail.newEvents]) : v.events,
      sim: { ...v.sim, simT: tail.tSeconds, snapshot: strip(tail), finished: true, paused: false },
    });
    if (!result.launchSuccess) this.mascot.offerEvent('launch-failure', nowS, 'report');
    this.offer(result.launchSuccess && result.status !== 'failed' ? 'report:success' : 'report:failure', nowS);
    this.offer('phase:report', nowS, ONCE);
  }

  /** Nuevo intento con el mismo diseño: intento + 1, semilla + 1, vuelta al diseño. */
  private redesign(nowS: number): void {
    const v = this._view;
    const attempt = v.attempt + 1;
    const fresh = createRoomView({ roomId: v.roomId, scenarioId: v.scenarioId, attempt, seed: this.seedBase + attempt });
    this.sim = null;
    this.engineReview = null;
    this.launchStartedAtS = null;
    this.launchDone.clear();
    this.purgedRequests = undefined;
    this.update({
      phase: 'design',
      attempt,
      seed: fresh.seed,
      requests: [],
      votes: [],
      lastNoGo: null,
      preLaunch: null,
      sim: fresh.sim,
      events: [],
      alerts: [],
      result: null,
      collaboration: null,
      teamScore: null,
    });
    this.mascot.resetAttempt();
    this.offer('phase:design', nowS, ONCE);
  }

  // ─── Chat y pings ───────────────────────────────────────────────────────

  private chat(player: TeamPlayer, text: string, nowS: number): MessageRef | null {
    const last = this.lastChatAt.get(player.id);
    if (last !== undefined && nowS - last < TEAM_LIMITS.chatMinIntervalS) return ref('team.reject.rateLimited');
    const clean = sanitizePlayerText(text, TEAM_LIMITS.chatMaxChars);
    if (clean === null) return ref('team.reject.emptyText');
    this.lastChatAt.set(player.id, nowS);
    const msg: ChatMessage = {
      id: `msg-${this.nextChatId++}`, playerId: player.id, name: player.name, roles: [...player.roles], text: clean, atS: nowS,
    };
    const chat = [...this._view.chat, msg];
    this.update({ chat: chat.length > TEAM_LIMITS.chatHistory ? chat.slice(-TEAM_LIMITS.chatHistory) : chat });
    this.offer('team:chat', nowS, { minIntervalS: MASCOT_CHATTER_MIN_S });
    return null;
  }

  private ping(player: TeamPlayer, target: PingTarget, nowS: number, out: Outgoing[]): MessageRef | null {
    const last = this.lastPingAt.get(player.id);
    if (last !== undefined && nowS - last < TEAM_LIMITS.pingMinIntervalS) return ref('team.reject.rateLimited');
    this.lastPingAt.set(player.id, nowS);
    out.push({ to: null, notice: { kind: 'ping', playerId: player.id, role: player.roles[0] ?? null, target, atS: nowS } });
    this.offer('team:ping', nowS, { minIntervalS: MASCOT_CHATTER_MIN_S });
    return null;
  }

  // ─── Utilidades ─────────────────────────────────────────────────────────

  private update(patch: Partial<RoomView>): void {
    this._view = { ...this._view, ...patch };
  }

  private updateSim(patch: Partial<RoomSimView>): void {
    this.update({ sim: { ...this._view.sim, ...patch } });
  }

  private updatePlayer(id: string, fn: (p: TeamPlayer) => TeamPlayer): void {
    this.update({ players: this._view.players.map((p) => (p.id === id ? fn(p) : p)) });
  }

  private offer(trigger: string, nowS: number, opts?: MascotOfferOptions): void {
    this.mascot.offer(trigger, nowS, this._view.phase, opts);
  }

  private flushMascot(nowS: number): void {
    const cue = this.mascot.flush(nowS, this._view.phase);
    if (cue) this.update({ mascot: cue });
  }
}
