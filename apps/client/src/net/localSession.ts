/**
 * Sesión de SOLITARIO: envuelve exactamente el comportamiento de las fases 1-2. El diseño se escribe en
 * `useDesign`, la aceleración en `useSim` y el flujo se manda como eventos a la máquina XState
 * (`missionMachine`), que App enlaza con `bind(send)`. La Academia y el intento persistente siguen igual
 * (los gestiona la máquina: `PLAY`, `REDESIGN`, guardas de la Academia…).
 */
import type {
  AvatarPose, GoNoGoVoteValue, NoGoReason, OrbitId, PingTarget, SubsystemAllocation, TeamRole,
} from '@payload/shared';
import type { MissionEvent } from '../app/missionMachine';
import { academyScenarioId } from '../academy/academyLogic';
import { useAcademy } from '../academy/academyStore';
import { useDesign } from '../state/design';
import { isTimeScale, useSim } from '../state/sim';
import { APPLY, INVALID_ACTION, type MissionSession, type ResourceRequestInput, type SessionResult } from './session';

export type MissionSender = (event: MissionEvent) => void;

export class LocalSession implements MissionSession {
  readonly kind = 'local' as const;
  private sender: MissionSender | null;

  constructor(sender?: MissionSender) {
    this.sender = sender ?? null;
  }

  /** Enlaza la máquina de fases (App: `useMachine(...)[1]`). */
  bind(sender: MissionSender | null): void {
    this.sender = sender;
  }

  private send(event: MissionEvent): SessionResult {
    if (!this.sender) {
      console.warn('[session] LocalSession sin máquina enlazada:', event.type);
      return INVALID_ACTION;
    }
    this.sender(event);
    return APPLY;
  }

  // ─── Solo solitario: empezar partida ──────────────────────────────────────
  /** Menú → briefing de un escenario de campaña. */
  playScenario(scenarioId: string): void {
    useAcademy.getState().exit();
    this.send({ type: 'PLAY', scenarioId });
  }

  /** Menú → Academia (mini-misión guiada). */
  playAcademy(): void {
    useAcademy.getState().start();
    this.send({ type: 'PLAY', scenarioId: academyScenarioId() });
  }

  // ─── Diseño ───────────────────────────────────────────────────────────────
  addComponent(componentId: string): SessionResult {
    useDesign.getState().add(componentId);
    return APPLY;
  }
  removeComponent(componentId: string): SessionResult {
    useDesign.getState().removeOne(componentId);
    return APPLY;
  }
  removeLast(): SessionResult {
    useDesign.getState().popLast();
    return APPLY;
  }
  selectOrbit(orbitId: OrbitId | null): SessionResult {
    useDesign.getState().setOrbit(orbitId);
    return APPLY;
  }
  selectLauncher(launcherId: string | null): SessionResult {
    useDesign.getState().setLauncher(launcherId);
    return APPLY;
  }

  // ─── Flujo ────────────────────────────────────────────────────────────────
  startDesign(): SessionResult {
    return this.send({ type: 'START_DESIGN' });
  }
  requestReview(): SessionResult {
    return this.send({ type: 'REQUEST_REVIEW' });
  }
  backToDesign(): SessionResult {
    return this.send({ type: 'BACK_TO_DESIGN' });
  }
  launch(): SessionResult {
    return this.send({ type: 'LAUNCH' });
  }
  confirmLaunch(): SessionResult {
    return this.send({ type: 'CONFIRM_LAUNCH' });
  }
  launchDone(): SessionResult {
    return this.send({ type: 'LAUNCH_DONE' });
  }
  setTimeScale(accel: number): SessionResult {
    if (!isTimeScale(accel)) return { kind: 'reject', reason: { key: 'team.reject.timeScale', params: { accel: Number.isFinite(accel) ? accel : 0 } } };
    useSim.getState().setAccel(accel);
    return APPLY;
  }
  finishOperation(): SessionResult {
    return this.send({ type: 'FINISH' });
  }
  redesign(): SessionResult {
    return this.send({ type: 'REDESIGN' });
  }
  toMenu(): void {
    useAcademy.getState().exit();
    this.send({ type: 'MENU' });
  }

  // ─── Equipo: sin efecto en solitario ──────────────────────────────────────
  setName(_name: string): SessionResult {
    return INVALID_ACTION;
  }
  claimRoles(_roles: TeamRole[]): SessionResult {
    return INVALID_ACTION;
  }
  autoAssignRoles(): SessionResult {
    return INVALID_ACTION;
  }
  startMission(): SessionResult {
    return INVALID_ACTION;
  }
  allocateBudget(_allocation: SubsystemAllocation | null): SessionResult {
    return INVALID_ACTION;
  }
  requestResource(_req: ResourceRequestInput): SessionResult {
    return INVALID_ACTION;
  }
  resolveRequest(_requestId: string, _approve: boolean, _note?: string): SessionResult {
    return INVALID_ACTION;
  }
  withdrawRequest(_requestId: string): SessionResult {
    return INVALID_ACTION;
  }
  vote(_role: TeamRole, _value: GoNoGoVoteValue, _reason?: NoGoReason): SessionResult {
    return INVALID_ACTION;
  }
  ackAlert(_alertId: string, _role: TeamRole): SessionResult {
    return INVALID_ACTION;
  }
  chat(_text: string): SessionResult {
    return INVALID_ACTION;
  }
  ping(_target: PingTarget): SessionResult {
    return INVALID_ACTION;
  }
  move(_pose: AvatarPose): boolean {
    return false;
  }
}
