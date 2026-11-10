/**
 * Interfaz común de la partida (fase 3): la UI y las escenas hacen TODAS sus escrituras de juego a
 * través de una `MissionSession`, sin saber si juegan en solitario o en una sala.
 *
 *  - `LocalSession` (solitario, net/localSession.ts): escribe en los stores (`useDesign`, `useSim`) y
 *    manda eventos a la máquina XState, exactamente como antes.
 *  - `RoomSession` (sala, net/roomSession.ts): envía un `TeamAction` al servidor y escribe en los MISMOS
 *    stores lo que dice el estado de la sala. Las escenas siguen leyendo `useDesign`, `useSim`…
 *
 * La sesión activa: `getSession()` (fuera de React, p. ej. en manejadores) o `useMissionSession()`
 * (net/sessionStore.ts). Cada operación devuelve al instante un `TeamActionCheck` con la PREVISIÓN
 * (`apply` · `request` · `reject` con motivo `sim:team.reject.*`); en sala, la confirmación llega después
 * con el estado del servidor (o con un aviso `rejected`). En solitario, las operaciones de equipo no
 * tienen efecto y devuelven `reject` (`team.reject.invalidAction`).
 */
import type {
  AvatarPose, GoNoGoVoteValue, NoGoReason, OrbitId, PingTarget, ResourceId, SubsystemAllocation, SubsystemId,
  TeamActionCheck, TeamRole,
} from '@payload/shared';

export type SessionKind = 'local' | 'room';

/** Previsión inmediata de una operación (la sala la confirma con su estado). */
export type SessionResult = TeamActionCheck;

export interface ResourceRequestInput {
  resource: ResourceId;
  amount?: number;
  subsystem?: SubsystemId;
  /** Texto libre (se sanea y recorta a `TEAM_LIMITS.noteMaxChars`). */
  note?: string;
}

export interface MissionSession {
  readonly kind: SessionKind;

  // ─── Diseño (hangar 3D y panel 2D) ────────────────────────────────────────
  /** Monta una unidad de la pieza. Sala: `add-component` (puede convertirse en solicitud). */
  addComponent(componentId: string): SessionResult;
  /** Quita la ÚLTIMA unidad montada de esa pieza. Sala: `remove-component`. */
  removeComponent(componentId: string): SessionResult;
  /** Quita la última pieza montada (E sobre la nave sin nada en la mano). */
  removeLast(): SessionResult;
  selectOrbit(orbitId: OrbitId | null): SessionResult;
  selectLauncher(launcherId: string | null): SessionResult;

  // ─── Flujo de la misión ───────────────────────────────────────────────────
  /** Briefing → hangar. Sala: `start-design` (Dirección). */
  startDesign(): SessionResult;
  /** Pedir la revisión Go/No-Go. Sala: `request-review` (cualquiera). */
  requestReview(): SessionResult;
  /**
   * Solitario: volver al hangar desde la revisión (con los motivos del No-Go). Sala: NO hay acción
   * equivalente (un No-Go se vota con motivo: usa `vote(role, 'no-go', reason)`); devuelve `reject`
   * `team.reject.voteNeedsReason` y lo muestra como aviso.
   */
  backToDesign(): SessionResult;
  /** Solitario: autorizar el lanzamiento (Go). Sala: vota `go` por CADA rol propio. */
  launch(): SessionResult;
  /** Pre-lanzamiento → lanzamiento. Sala: `confirm-launch` (Dirección). */
  confirmLaunch(): SessionResult;
  /** Fin de la secuencia de lanzamiento en pantalla. Sala: `launch-done`. */
  launchDone(): SessionResult;
  /** Aceleración del tiempo (`TIME_SCALES`). Sala: `set-time-scale` (Dirección u Operaciones). */
  setTimeScale(accel: number): SessionResult;
  /** Terminar la operación → informe. Sala: `finish-operation` (Dirección). */
  finishOperation(): SessionResult;
  /** Informe → hangar con el mismo diseño y otro intento. Sala: `redesign` (Dirección). */
  redesign(): SessionResult;
  /** Volver al menú. Sala: sale de la sala (y el cliente vuelve al menú en solitario). */
  toMenu(): void;

  // ─── Equipo (solo sala) ───────────────────────────────────────────────────
  setName(name: string): SessionResult;
  /** Reemplaza mis roles (lobby). */
  claimRoles(roles: TeamRole[]): SessionResult;
  /** Anfitrión: reparto automático (`combineRoles`). */
  autoAssignRoles(): SessionResult;
  /** Anfitrión: lobby → briefing (con los 4 roles cubiertos). */
  startMission(): SessionResult;
  /** Dirección: reparto del presupuesto por subsistema (null = sin topes). */
  allocateBudget(allocation: SubsystemAllocation | null): SessionResult;
  requestResource(req: ResourceRequestInput): SessionResult;
  resolveRequest(requestId: string, approve: boolean, note?: string): SessionResult;
  withdrawRequest(requestId: string): SessionResult;
  /** Voto de un rol propio. Un No-Go exige `reason` (y `other` exige `note`). */
  vote(role: TeamRole, value: GoNoGoVoteValue, reason?: NoGoReason): SessionResult;
  ackAlert(alertId: string, role: TeamRole): SessionResult;
  chat(text: string): SessionResult;
  ping(target: PingTarget): SessionResult;
  /**
   * Pose del avatar (metros/radianes; `yaw` = giro Y del modelo, que mira a +Z). Limitado a 10 Hz y solo
   * si cambió; devuelve true si se envió. En solitario no hace nada (false). No crea objetos si no envía.
   */
  move(pose: AvatarPose): boolean;
}

/** Motivo genérico para operaciones sin sentido en el modo actual (p. ej. votar en solitario). */
export const INVALID_ACTION: SessionResult = { kind: 'reject', reason: { key: 'team.reject.invalidAction' } };
export const APPLY: SessionResult = { kind: 'apply' };
