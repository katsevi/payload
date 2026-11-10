import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import {
  catalog, componentsForScenario, createMissionSim, createRoomView, encodeRoomView, parseTeamAction, pickMascotDialogue,
  reviewGoNoGo, rollPreLaunchEvents, runMission,
  type MissionDesign, type OrbitId, type RoomView, type SimSnapshot, type SubsystemId, type TeamPlayer, type TeamRole,
} from '@payload/shared';
import { tr } from '../i18n';
import { missionMachine } from '../app/missionMachine';
import { LocalSession } from '../net/localSession';
import {
  configureNet, createPrivateRoom, dismissRetry, joinError, joinRoomByCode, leaveRoom, quickMatch, resetNetConfig, resumeRoom,
  retryRoom, TOKEN_KEY,
  type ClientLike, type RoomLike, type StorageLike,
} from '../net/roomSession';
import es from '../locales/es.json';
import en from '../locales/en.json';
import { flatten } from '../i18n/flatten';
import {
  activePhase, canDo, canDoIn, INITIAL_ROOM_STATE, PING_TTL_MS, selectActivePings, selectAlertsForMe, selectRequestsForMe,
  selectTeamReport, useRoom, visibleAdvisorRoles,
} from '../net/roomStore';
import { decodeRoomState } from '../net/roomView';
import { getSession, useSession } from '../net/sessionStore';
import { publishAvatarPose } from '../net/avatar';
import { resetMascotMemory, useMascot } from '../mascot/mascotStore';
import { useDesign } from '../state/design';
import { useSettings } from '../state/settings';
import { getLiveSnapshot, mirrorInfo, snapshotDiff, useSim } from '../state/sim';
import { useUi } from '../state/ui';
import { campaignScenarios } from '../ui/catalogViews';

// ─── Dobles del SDK de Colyseus ─────────────────────────────────────────────

type Cb<A extends unknown[]> = (...args: A) => void;

/** Subconjunto de `Room` de @colyseus/sdk 0.18 que usa el cliente, con ayudas para simular al servidor. */
class FakeRoom implements RoomLike {
  state: unknown = undefined;
  sent: { type: string; payload: unknown }[] = [];
  left = false;
  private cbs = {
    state: [] as Cb<[unknown]>[],
    leave: [] as Cb<[number, string?]>[],
    drop: [] as Cb<[number, string?]>[],
    reconnect: [] as Cb<[]>[],
    error: [] as Cb<[number, string?]>[],
  };
  private messages = new Map<string, Cb<[unknown]>[]>();

  constructor(
    public roomId = 'ROOM1',
    public sessionId = 'me',
    public reconnectionToken = 'ROOM1:tok-1',
  ) {}

  send(type: string, payload?: unknown): void {
    this.sent.push({ type, payload });
  }
  onStateChange(cb: Cb<[unknown]>): void {
    this.cbs.state.push(cb);
  }
  onMessage(type: string, cb: Cb<[unknown]>): () => void {
    this.messages.set(type, [...(this.messages.get(type) ?? []), cb]);
    return () => undefined;
  }
  onLeave(cb: Cb<[number, string?]>): void {
    this.cbs.leave.push(cb);
  }
  onDrop(cb: Cb<[number, string?]>): void {
    this.cbs.drop.push(cb);
  }
  onReconnect(cb: Cb<[]>): void {
    this.cbs.reconnect.push(cb);
  }
  onError(cb: Cb<[number, string?]>): void {
    this.cbs.error.push(cb);
  }
  leave(consented = true): Promise<number> {
    if (!this.left) {
      this.left = true;
      this.cbs.leave.forEach((cb) => cb(consented ? 4000 : 1006));
    }
    return Promise.resolve(4000);
  }

  // ── Lado del servidor ──
  /** Publica una vista como lo haría el esquema: `state.toJSON()` = `encodeRoomView(view)`. */
  emit(view: RoomView): void {
    const wire = encodeRoomView(view);
    this.state = { toJSON: () => wire };
    this.cbs.state.forEach((cb) => cb(this.state));
  }
  message(type: string, payload: unknown): void {
    (this.messages.get(type) ?? []).forEach((cb) => cb(payload));
  }
  drop(): void {
    this.cbs.drop.forEach((cb) => cb(1006));
  }
  reconnected(token: string): void {
    this.cbs.reconnect.forEach((cb) => cb());
    this.reconnectionToken = token; // el SDK lo actualiza justo después de avisar
  }
  close(code: number): void {
    this.left = true;
    this.cbs.leave.forEach((cb) => cb(code));
  }
  /** Acciones enviadas (`room.send('action', ...)`). */
  actions(): unknown[] {
    return this.sent.filter((s) => s.type === 'action').map((s) => s.payload);
  }
}

class FakeClient implements ClientLike {
  calls: { method: string; args: unknown[] }[] = [];
  next = new FakeRoom();
  fail: unknown = null;
  private open(method: string, args: unknown[]): Promise<RoomLike> {
    this.calls.push({ method, args });
    return this.fail ? Promise.reject(this.fail) : Promise.resolve(this.next);
  }
  joinOrCreate(name: string, options?: Record<string, unknown>) {
    return this.open('joinOrCreate', [name, options]);
  }
  create(name: string, options?: Record<string, unknown>) {
    return this.open('create', [name, options]);
  }
  joinById(id: string, options?: Record<string, unknown>) {
    return this.open('joinById', [id, options]);
  }
  reconnect(token: string) {
    return this.open('reconnect', [token]);
  }
}

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

// ─── Datos ──────────────────────────────────────────────────────────────────

const sc = campaignScenarios()[0]!;
const ALL_ROLES: TeamRole[] = ['director', 'engineering', 'science', 'operations'];

/** Diseño Go con una pieza por subsistema (como flow.test). */
function findGoDesign(): MissionDesign {
  const comps = componentsForScenario(sc.id, catalog);
  const by = (s: SubsystemId) => comps.filter((c) => c.subsystem === s);
  const subs: SubsystemId[] = ['power', 'battery', 'comms', 'obc', 'adcs', 'thermal'];
  for (const st of by('structure')) {
    for (const orbitId of sc.allowedOrbits as OrbitId[]) {
      for (const launcherId of sc.allowedLaunchers) {
        for (const pl of by('payload')) {
          const ids = [st.id, ...subs.map((s) => by(s)[0]?.id).filter((x): x is string => !!x), pl.id];
          const d: MissionDesign = { scenarioId: sc.id, componentIds: ids, orbitId, launcherId };
          if (reviewGoNoGo(d, catalog).go) return d;
        }
      }
    }
  }
  throw new Error('el catálogo debe permitir al menos un diseño Go');
}
const goDesign = findGoDesign();

/** Semilla con lanzamiento exitoso (para que haya operación). */
function launchingSeed(design: MissionDesign): number {
  for (let s = sc.defaultSeed; s < sc.defaultSeed + 200; s++) {
    const pre = rollPreLaunchEvents(design, catalog, s);
    const first = createMissionSim(design, catalog, { seed: s, preLaunch: pre }).snapshot();
    if (first.newEvents.some((e) => e.type === 'launch-success')) return s;
  }
  throw new Error('sin semilla con lanzamiento exitoso');
}

const player = (id: string, roles: TeamRole[], extra: Partial<TeamPlayer> = {}): TeamPlayer => ({
  id, name: id.toUpperCase(), roles, connected: true, isHost: false, pose: null, ...extra,
});

function roomView(patch: Partial<RoomView> = {}): RoomView {
  return {
    ...createRoomView({ roomId: 'ROOM1', scenarioId: sc.id, attempt: 0, seed: sc.defaultSeed }),
    hostId: 'me',
    players: [player('me', ALL_ROLES, { isHost: true })],
    ...patch,
  };
}

const lastAction = (room: FakeRoom) => room.actions().at(-1);

// ─── Preparación ────────────────────────────────────────────────────────────

let client: FakeClient;
let storage: ReturnType<typeof memoryStorage>;
let clock = 0;
let actor: ReturnType<typeof createActor<typeof missionMachine>>;

beforeEach(() => {
  client = new FakeClient();
  storage = memoryStorage();
  clock = 10_000;
  configureNet({ clientFactory: () => client, storage, now: () => clock, url: () => 'ws://test:2567' });
  actor = createActor(missionMachine).start();
  useSession.getState().local.bind((e) => actor.send(e));
  useUi.setState({ notice: null });
});

afterEach(async () => {
  await leaveRoom();
  dismissRetry();
  resetNetConfig();
  useSession.getState().local.bind(null);
  useRoom.setState({ ...INITIAL_ROOM_STATE });
  useUi.setState({ notice: null });
  vi.restoreAllMocks();
});

async function joinWith(view: RoomView, roomArgs?: ConstructorParameters<typeof FakeRoom>): Promise<FakeRoom> {
  if (roomArgs) client.next = new FakeRoom(...roomArgs);
  const ok = await quickMatch({ scenarioId: sc.id, name: 'Ana' });
  expect(ok).toBe(true);
  client.next.emit(view);
  return client.next;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('LocalSession (solitario)', () => {
  it('reproduce el flujo de solitario: stores + máquina, como antes', () => {
    const a = createActor(missionMachine).start();
    const s = new LocalSession((e) => a.send(e));
    expect(s.kind).toBe('local');
    s.playScenario(goDesign.scenarioId);
    expect(a.getSnapshot().value).toBe('briefing');
    s.startDesign();
    expect(a.getSnapshot().value).toBe('design');
    goDesign.componentIds.forEach((id) => s.addComponent(id));
    s.selectOrbit(goDesign.orbitId);
    s.selectLauncher(goDesign.launcherId);
    expect(useDesign.getState().design()).toEqual(goDesign);
    // quitar y volver a poner (última unidad; y E sobre la nave = última pieza)
    const last = goDesign.componentIds.at(-1)!;
    s.removeComponent(last);
    expect(useDesign.getState().componentIds).not.toContain(last);
    s.addComponent(last);
    s.removeLast();
    s.addComponent(last);
    expect(useDesign.getState().design()).toEqual(goDesign);

    s.requestReview();
    expect(a.getSnapshot().value).toBe('review');
    s.launch();
    if (a.getSnapshot().value === 'prelaunch') s.confirmLaunch();
    expect(a.getSnapshot().value).toBe('launch');
    expect(useSim.getState().seed).toBe(sc.defaultSeed + useDesign.getState().attempt); // semilla del intento persistido
    s.launchDone();
    if (a.getSnapshot().value === 'operation') {
      expect(s.setTimeScale(1000).kind).toBe('apply');
      expect(useSim.getState().accel).toBe(1000);
      expect(s.setTimeScale(7).kind).toBe('reject');
      for (let i = 0; i < 20; i++) useSim.getState().tick(0.1);
      s.finishOperation();
    }
    expect(a.getSnapshot().value).toBe('report');
    expect(useSim.getState().result).not.toBeNull();
    s.redesign();
    expect(a.getSnapshot().value).toBe('design');
    expect(useDesign.getState().componentIds).toEqual(goDesign.componentIds);
    s.toMenu();
    expect(a.getSnapshot().value).toBe('menu');
    useSim.getState().clear();
  });

  it('las operaciones de equipo no tienen efecto en solitario', () => {
    const s = new LocalSession(() => undefined);
    expect(s.vote('director', 'go').kind).toBe('reject');
    expect(s.chat('hola').kind).toBe('reject');
    expect(s.move({ x: 1, y: 0, z: 2, yaw: 0 })).toBe(false);
    expect(getSession().kind).toBe('local');
    expect(publishAvatarPose(1, 0, 2, 0)).toBe(false);
  });
});

describe('RoomSession: acciones al servidor', () => {
  it('cada operación envía el TeamAction correcto (y válido para el esquema del servidor)', async () => {
    const view = roomView({ phase: 'design', design: { ...goDesign } });
    const room = await joinWith(view);
    expect(client.calls[0]).toEqual({ method: 'joinOrCreate', args: ['mission', { scenarioId: sc.id, name: 'Ana' }] });
    const s = getSession();
    expect(s.kind).toBe('room');
    const comp = goDesign.componentIds[0]!;
    const cases: [() => unknown, unknown][] = [
      [() => s.addComponent(comp), { type: 'add-component', componentId: comp }],
      [() => s.removeComponent(comp), { type: 'remove-component', componentId: comp }],
      [() => s.removeLast(), { type: 'remove-component', componentId: goDesign.componentIds.at(-1) }],
      [() => s.selectOrbit(null), { type: 'select-orbit', orbitId: null }],
      [() => s.selectOrbit(goDesign.orbitId), { type: 'select-orbit', orbitId: goDesign.orbitId }],
      [() => s.selectLauncher(goDesign.launcherId), { type: 'select-launcher', launcherId: goDesign.launcherId }],
      [() => s.startDesign(), { type: 'start-design' }],
      [() => s.requestReview(), { type: 'request-review' }],
      [() => s.confirmLaunch(), { type: 'confirm-launch' }],
      [() => s.launchDone(), { type: 'launch-done' }],
      [() => s.setTimeScale(100), { type: 'set-time-scale', accel: 100 }],
      [() => s.finishOperation(), { type: 'finish-operation' }],
      [() => s.redesign(), { type: 'redesign' }],
      [() => s.setName('  Ana​ López  '), { type: 'set-name', name: 'Ana López' }],
      [() => s.claimRoles(['science', 'science', 'operations']), { type: 'claim-roles', roles: ['science', 'operations'] }],
      [() => s.autoAssignRoles(), { type: 'auto-assign-roles' }],
      [() => s.startMission(), { type: 'start-mission' }],
      [() => s.allocateBudget({ payload: 5, power: undefined, comms: 2 }), { type: 'allocate-budget', allocation: { payload: 5, comms: 2 } }],
      [() => s.allocateBudget(null), { type: 'allocate-budget', allocation: null }],
      [() => s.requestResource({ resource: 'power' }), { type: 'request-resource', resource: 'power' }],
      [() => s.requestResource({ resource: 'budget', amount: 3, subsystem: 'payload', note: ' más dinero ' }), { type: 'request-resource', resource: 'budget', amount: 3, subsystem: 'payload', note: 'más dinero' }],
      [() => s.resolveRequest('r1', true), { type: 'resolve-request', requestId: 'r1', approve: true }],
      [() => s.resolveRequest('r1', false, 'propón otra'), { type: 'resolve-request', requestId: 'r1', approve: false, note: 'propón otra' }],
      [() => s.withdrawRequest('r1'), { type: 'withdraw-request', requestId: 'r1' }],
      [() => s.vote('science', 'no-go', { code: 'other', note: ' riesgo ' }), { type: 'vote', role: 'science', value: 'no-go', reason: { code: 'other', note: 'riesgo' } }],
      [() => s.vote('science', 'no-go', { code: 'power', note: '   ' }), { type: 'vote', role: 'science', value: 'no-go', reason: { code: 'power' } }],
      [() => s.ackAlert('a1', 'engineering'), { type: 'ack-alert', alertId: 'a1', role: 'engineering' }],
      [() => s.chat('  hola equipo  '), { type: 'chat', text: 'hola equipo' }],
      [() => s.ping({ kind: 'resource', id: 'power' }), { type: 'ping', target: { kind: 'resource', id: 'power' } }],
    ];
    for (const [op, expected] of cases) {
      op();
      const sent = lastAction(room);
      expect(sent).toEqual(expected);
      expect(parseTeamAction(sent), JSON.stringify(expected)).toEqual(expected);
    }

    // «Lanzar» en sala = votar Go por cada rol propio.
    const before = room.actions().length;
    s.launch();
    expect(room.actions().slice(before)).toEqual(ALL_ROLES.map((role) => ({ type: 'vote', role, value: 'go' })));

    // Sin equivalente / texto vacío: no se envía nada.
    const n = room.actions().length;
    expect(s.backToDesign()).toEqual({ kind: 'reject', reason: { key: 'team.reject.voteNeedsReason' } });
    expect(useUi.getState().notice?.ref?.key).toBe('team.reject.voteNeedsReason');
    expect(s.chat('   ').kind).toBe('reject');
    expect(s.setName('').kind).toBe('reject');
    expect(room.actions().length).toBe(n);
  });

  it('move: como mucho 10 Hz y solo si la pose cambia', async () => {
    const room = await joinWith(roomView({ phase: 'design' }));
    const moves = () => room.sent.filter((m) => m.type === 'move');
    expect(publishAvatarPose(1, 0, 2, 0.5)).toBe(true);
    expect(publishAvatarPose(1.5, 0, 2, 0.5)).toBe(false); // < 100 ms
    clock += 100;
    expect(publishAvatarPose(1, 0, 2, 0.5)).toBe(false); // sin cambios
    expect(publishAvatarPose(1.5, 0, 2, 0.5)).toBe(true);
    expect(moves().map((m) => m.payload)).toEqual([{ x: 1, y: 0, z: 2, yaw: 0.5 }, { x: 1.5, y: 0, z: 2, yaw: 0.5 }]);
    // Reconectando no se envían poses (no se acumulan en el buffer del SDK).
    room.drop();
    clock += 1000;
    expect(publishAvatarPose(3, 0, 2, 0.5)).toBe(false);
  });

  it('dos intentos de entrar a la vez usan la misma conexión', async () => {
    const [a, b] = await Promise.all([quickMatch({ scenarioId: sc.id, name: 'A' }), quickMatch({ scenarioId: sc.id, name: 'B' })]);
    expect(a && b).toBe(true);
    expect(client.calls.length).toBe(1);
  });
});

describe('RoomSession: estado del servidor → stores', () => {
  it('aplicar una RoomView actualiza useRoom, useDesign y la fase', async () => {
    const view = roomView({
      phase: 'design',
      attempt: 2,
      hostId: 'p2',
      players: [player('p2', ['director', 'engineering', 'operations'], { isHost: true }), player('me', ['science'])],
      design: { ...goDesign },
      lastNoGo: { source: 'review', atS: 5, votes: [], issues: [
        { severity: 'blocker', code: 'mass', message: { key: 'review.massOver' } },
        { severity: 'warning', code: 'power', message: { key: 'review.powerTight' } },
      ] },
    });
    expect(activePhase('menu', useRoom.getState().view)).toBe('menu');
    await joinWith(view);
    const r = useRoom.getState();
    expect(r.status).toBe('connected');
    expect(r.myId).toBe('me');
    expect(r.myRoles).toEqual(['science']);
    expect(r.isHost).toBe(false);
    expect(r.roomCode).toBe('ROOM1');
    expect(r.view?.phase).toBe('design');
    expect(activePhase('menu', r.view)).toBe('design');
    expect(useDesign.getState().design()).toEqual(goDesign);
    expect(useDesign.getState().attempt).toBe(2);
    expect(useDesign.getState().lastIssues.map((i) => i.code)).toEqual(['mass']);
    // Asesores: solo los míos en sala; todos en solitario.
    expect(visibleAdvisorRoles(true, r.myRoles)).toEqual(['science']);
    expect(visibleAdvisorRoles(false, r.myRoles)).toHaveLength(4);
    expect(visibleAdvisorRoles(true, [])).toHaveLength(4);
  });

  it('referencias estables: lo que no cambia conserva la referencia de la vista anterior', async () => {
    const v1 = roomView({ phase: 'operation', chat: [{ id: 'c1', playerId: 'me', name: 'ME', roles: ['director'], text: 'hola', atS: 1 }] });
    const d1 = decodeRoomState(encodeRoomView(v1), null);
    const v2 = { ...v1, sim: { ...v1.sim, simT: 50 } };
    const d2 = decodeRoomState(encodeRoomView(v2), d1);
    expect(d2.view.sim.simT).toBe(50);
    expect(d2.view.chat).toBe(d1.view.chat);
    expect(d2.view.players).toBe(d1.view.players);
    expect(d2.view.design).toBe(d1.view.design);
    expect(d2.view.sim).not.toBe(d1.view.sim);
    const v3 = { ...v2, chat: [...v2.chat, { id: 'c2', playerId: 'me', name: 'ME', roles: ['director' as const], text: 'otra', atS: 2 }] };
    const d3 = decodeRoomState(encodeRoomView(v3), d2);
    expect(d3.view.chat).not.toBe(d2.view.chat);
    expect(d3.view.chat).toHaveLength(2);
    expect(d3.view).toEqual(v3);
  });

  it('lobby en el servidor ⇒ fase lobby; el informe usa el result del servidor y expone la colaboración', async () => {
    const room = await joinWith(roomView({ phase: 'lobby' }));
    expect(activePhase('menu', useRoom.getState().view)).toBe('lobby');
    const result = runMission(goDesign, catalog, { seed: sc.defaultSeed });
    const collaboration = { score: 80, requestsTotal: 1, requestsResolved: 1, avgRequestResponseS: 30, alertsTotal: 0, alertAcksExpected: 0, alertAcksOnTime: 0, avgAlertResponseS: null, criteria: { requests: 0.8 } };
    const teamScore = { ...result.score, collaboration: 80 };
    room.emit(roomView({ phase: 'report', design: { ...goDesign }, result, collaboration, teamScore }));
    expect(activePhase('menu', useRoom.getState().view)).toBe('report');
    expect(useSim.getState().result).toEqual(result);
    expect(selectTeamReport(useRoom.getState())).toEqual({ result, collaboration, teamScore });
  });
});

describe('canDo', () => {
  it('permitida, rechazada con motivo o convertida en solicitud', async () => {
    expect(canDo({ type: 'request-review' }).kind).toBe('reject'); // fuera de una sala
    const view = roomView({
      phase: 'design',
      hostId: 'p2',
      players: [player('p2', ['director', 'engineering', 'operations'], { isHost: true }), player('me', ['science'])],
      design: { ...goDesign },
    });
    await joinWith(view);
    expect(canDo({ type: 'request-review' })).toEqual({ kind: 'apply' });
    expect(canDo({ type: 'select-orbit', orbitId: null })).toEqual({ kind: 'reject', reason: { key: 'team.reject.permission', params: { role: 'director' } } });
    const explicit = canDo({ type: 'request-resource', resource: 'power', amount: 10 });
    expect(explicit).toMatchObject({ kind: 'request', toRole: 'engineering', resource: 'power', amount: 10, fromRole: 'science' });
    // Solicitud automática: Ciencia monta instrumentos hasta empeorar un recurso de otro rol.
    const payloads = componentsForScenario(sc.id, catalog).filter((c) => c.subsystem === 'payload');
    let auto: ReturnType<typeof canDo> | null = null;
    for (let copies = 0; copies < 6 && !auto; copies++) {
      for (const p of payloads) {
        const design = { ...goDesign, componentIds: [...goDesign.componentIds, ...Array<string>(copies).fill(p.id)] };
        const c = canDoIn({ ...useRoom.getState(), view: { ...view, design } }, { type: 'add-component', componentId: p.id });
        if (c.kind === 'request') {
          auto = c;
          break;
        }
      }
    }
    expect(auto, 'algún instrumento debe necesitar el permiso de otro rol').not.toBeNull();
    expect(auto).toMatchObject({ kind: 'request', fromRole: 'science' });
    expect(tr((auto as { why: Parameters<typeof tr>[0] }).why)).not.toMatch(/\{\{|team\.request/);
    // Contenido del voto (fase review): No-Go sin motivo se rechaza aunque el rol sea mío.
    const review = { ...view, phase: 'review' as const };
    const st = { ...useRoom.getState(), view: review };
    expect(canDoIn(st, { type: 'vote', role: 'science', value: 'no-go' })).toEqual({ kind: 'reject', reason: { key: 'team.reject.voteNeedsReason' } });
    expect(canDoIn(st, { type: 'vote', role: 'science', value: 'no-go', reason: { code: 'risk' } }).kind).toBe('apply');
    expect(canDoIn(st, { type: 'vote', role: 'director', value: 'go' })).toMatchObject({ kind: 'reject', reason: { key: 'team.reject.notYourRole' } });
    expect(canDoIn(st, { type: 'chat', text: '  ' })).toEqual({ kind: 'reject', reason: { key: 'team.reject.emptyText' } });
  });

  it('selectores de solicitudes y alertas para mis roles', async () => {
    await joinWith(roomView({
      phase: 'operation',
      players: [player('p2', ['director', 'science'], { isHost: true }), player('me', ['engineering', 'operations'])],
      requests: [
        { id: 'r1', fromPlayerId: 'p2', fromRole: 'science', toRole: 'engineering', resource: 'power', status: 'open', createdAtS: 1 },
        { id: 'r2', fromPlayerId: 'me', fromRole: 'engineering', toRole: 'director', resource: 'budget', status: 'open', createdAtS: 2 },
      ],
      alerts: [{ id: 'a1', event: { type: 'solar-storm', tSeconds: 9, message: { key: 'event.solarStorm' } }, requiredRoles: ['engineering', 'operations'], acks: [{ role: 'engineering', playerId: 'me', atS: 3 }], raisedAtS: 1, closedAtS: null, timedOut: false }],
    }));
    const st = useRoom.getState();
    expect(selectRequestsForMe(st).map((r) => r.id)).toEqual(['r1']);
    expect(selectAlertsForMe(st)).toEqual([{ alert: st.view!.alerts[0], roles: ['operations'] }]);
  });
});

describe('simulación reflejada', () => {
  const design = goDesign;
  const seed = launchingSeed(design);
  const preLaunch = rollPreLaunchEvents(design, catalog, seed);

  function opView(simT: number, snapshot: SimSnapshot | null, patch: Partial<RoomView['sim']> = {}): RoomView {
    return roomView({
      phase: 'operation', seed, attempt: seed - sc.defaultSeed, design: { ...design }, preLaunch,
      sim: { accel: 100, simT, snapshot, launchOk: true, finished: false, paused: false, ...patch },
    });
  }

  it('usa la semilla de la sala, alcanza el simT del servidor y nunca lo pasa', async () => {
    const ref = createMissionSim(design, catalog, { seed, preLaunch });
    const simT = 1.5 * 86400;
    const refSnap = ref.step(simT);
    const room = await joinWith(opView(simT, refSnap));
    expect(useSim.getState().seed).toBe(seed);
    expect(mirrorInfo()).toMatchObject({ capS: simT, t: 0, driven: false });

    useSim.getState().tick(0.016); // muy por detrás: salta hasta el servidor
    expect(getLiveSnapshot()!.tSeconds).toBeCloseTo(simT, 6);
    expect(snapshotDiff(getLiveSnapshot()!, refSnap)).toEqual([]);
    expect(useSim.getState().snapshot?.tSeconds).toBeCloseTo(simT, 6);
    useSim.getState().tick(5);
    expect(getLiveSnapshot()!.tSeconds).toBeCloseTo(simT, 6); // no pasa del servidor

    // El servidor avanza 30 s: a 100× la local avanza 10 s por cada 0,1 s real, sin pasarse.
    const snap2 = ref.step(30);
    room.emit(opView(simT + 30, snap2));
    useSim.getState().tick(0.1);
    expect(mirrorInfo()!.t).toBeCloseTo(simT + 10, 6);
    useSim.getState().tick(1);
    expect(mirrorInfo()!.t).toBe(simT + 30);
    expect(getLiveSnapshot()!.tSeconds).toBeLessThanOrEqual(simT + 30 + 1e-6);
    expect(snapshotDiff(getLiveSnapshot()!, snap2)).toEqual([]);

    // Pausa por alerta: el servidor no avanza ⇒ la local se queda quieta.
    room.emit(opView(simT + 30, snap2, { paused: true }));
    useSim.getState().tick(10);
    expect(mirrorInfo()!.t).toBe(simT + 30);
    // Los eventos del motor llegan al registro (como en solitario).
    expect(useSim.getState().events.length).toBeGreaterThan(0);
  });

  it('una desincronización se registra y se resincroniza', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ref = createMissionSim(design, catalog, { seed, preLaunch });
    const simT = 3600;
    const tampered = { ...ref.step(simT) };
    tampered.batteryWh += 50;
    await joinWith(opView(simT, tampered));
    useSim.getState().tick(0.016);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('desincronización'))).toBe(true);
    expect(mirrorInfo()!.resyncs).toBe(1);
    expect(getLiveSnapshot()!.tSeconds).toBeCloseTo(simT, 6);
  });
});

describe('avisos y mascota de la sala', () => {
  it('notice rejected → aviso en pantalla; ping → useRoom con caducidad; lo inválido se ignora', async () => {
    const room = await joinWith(roomView({ phase: 'design' }));
    room.message('notice', { kind: 'rejected', action: 'select-orbit', reason: { key: 'team.reject.permission', params: { role: 'director' } } });
    const n = useUi.getState().notice!;
    expect(n.tone).toBe('warn');
    expect(n.ref).toEqual({ key: 'team.reject.permission', params: { role: 'director' } });
    expect(tr(n.ref)).not.toMatch(/\{\{|team\.(reject|role)/);
    expect(useRoom.getState().lastRejected).toMatchObject({ action: 'select-orbit', reason: n.ref });
    room.message('notice', { kind: 'ping', playerId: 'p2', role: 'engineering', target: { kind: 'resource', id: 'power' }, atS: 12 });
    const st = useRoom.getState();
    expect(st.pings).toHaveLength(1);
    expect(st.pings[0]).toMatchObject({ playerId: 'p2', role: 'engineering', expiresAtMs: clock + PING_TTL_MS });
    expect(selectActivePings(st, clock + 1)).toHaveLength(1);
    expect(selectActivePings(st, clock + PING_TTL_MS + 1)).toHaveLength(0);
    room.message('notice', { kind: 'nada' });
    room.message('notice', { kind: 'rejected', reason: 'x' });
    expect(useRoom.getState().notices).toHaveLength(2);
  });

  it('request-created: aviso con la explicación de la solicitud cuando llega a la vista', async () => {
    const room = await joinWith(roomView({ phase: 'design' }));
    useUi.setState({ notice: null });
    room.message('notice', { kind: 'request-created', requestId: 'r9' });
    expect(useRoom.getState().lastRequestId).toBe('r9');
    expect(useUi.getState().notice).toBeNull(); // aún no está en la vista
    const why = { key: 'team.request.explicit', params: { fromRole: 'science', toRole: 'engineering', resource: 'power', unit: 'W' } };
    room.emit(roomView({ phase: 'design', requests: [{ id: 'r9', fromPlayerId: 'me', fromRole: 'science', toRole: 'engineering', resource: 'power', status: 'open', createdAtS: 3, why }] }));
    expect(useUi.getState().notice).toMatchObject({ tone: 'info', ref: why });
  });

  it('la mascota dice lo del servidor una sola vez por seq, con su variante', async () => {
    resetMascotMemory();
    useSettings.setState({ mascot: true });
    const trigger = 'event:solar-storm';
    const mascot = catalog.mascot!;
    const room = await joinWith(roomView({ phase: 'design', mascot: { trigger, variant: 1, seq: 1, atS: 0 } }));
    expect(useMascot.getState().current?.text).toEqual(pickMascotDialogue(trigger, mascot, 1)!.text);
    useMascot.getState().clear();
    room.emit(roomView({ phase: 'design', mascot: { trigger, variant: 1, seq: 1, atS: 0 }, chat: [] , attempt: 1 }));
    expect(useMascot.getState().current).toBeNull();
    room.emit(roomView({ phase: 'design', mascot: { trigger, variant: 0, seq: 2, atS: 4 } }));
    expect(useMascot.getState().current?.text).toEqual(pickMascotDialogue(trigger, mascot, 0)!.text);
  });
});

describe('conexión, reconexión y salida', () => {
  it('sala privada: guarda el token, refleja la reconexión y lo usa al recargar', async () => {
    const ok = await createPrivateRoom({ scenarioId: sc.id, name: 'Ana' });
    expect(ok).toBe(true);
    expect(client.calls[0]).toEqual({ method: 'create', args: ['mission', { scenarioId: sc.id, name: 'Ana', private: true }] });
    const room = client.next;
    room.emit(roomView({ phase: 'lobby' }));
    expect(storage.data.get(TOKEN_KEY)).toBe('ROOM1:tok-1');
    room.drop();
    expect(useRoom.getState().status).toBe('reconnecting');
    expect(useUi.getState().notice?.key).toBe('room.status.reconnecting');
    room.reconnected('ROOM1:tok-2');
    expect(useRoom.getState().status).toBe('connected');
    await Promise.resolve();
    expect(storage.data.get(TOKEN_KEY)).toBe('ROOM1:tok-2');

    // «Recargar la página»: se pierde la memoria pero no sessionStorage.
    useSession.setState({ room: null });
    useRoom.setState({ ...INITIAL_ROOM_STATE });
    client.next = new FakeRoom('ROOM1', 'me', 'ROOM1:tok-3');
    expect(await resumeRoom()).toBe(true);
    expect(client.calls.at(-1)).toEqual({ method: 'reconnect', args: ['ROOM1:tok-2'] });
    expect(getSession().kind).toBe('room');
    expect(storage.data.get(TOKEN_KEY)).toBe('ROOM1:tok-3');
  });

  it('reanudar sin token no conecta; con un token caducado lo borra y avisa', async () => {
    expect(await resumeRoom()).toBe(false);
    expect(client.calls).toHaveLength(0);
    storage.setItem(TOKEN_KEY, 'ROOM1:viejo');
    client.fail = Object.assign(new Error('expired'), { code: 524 });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await resumeRoom()).toBe(false);
    expect(storage.data.has(TOKEN_KEY)).toBe(false);
    expect(useRoom.getState()).toMatchObject({ status: 'error', error: { key: 'room.error.resume', code: 524 } });
  });

  it('errores al entrar: código inexistente o servidor inalcanzable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    client.fail = Object.assign(new Error('not found'), { code: 522 });
    expect(await joinRoomByCode(' ABC ', { name: 'Ana' })).toBe(false);
    expect(client.calls[0]).toEqual({ method: 'joinById', args: ['ABC', { name: 'Ana' }] });
    expect(useRoom.getState().error?.key).toBe('room.error.notFound');
    expect(useUi.getState().notice).toMatchObject({ tone: 'bad', key: 'room.error.notFound' });
    client.fail = new TypeError('fetch failed');
    expect(await quickMatch({ scenarioId: sc.id, name: 'Ana' })).toBe(false);
    expect(useRoom.getState().error?.key).toBe('room.error.unreachable');
    expect(getSession().kind).toBe('local');
  });

  it('salir de la sala vuelve al menú en solitario', async () => {
    actor.send({ type: 'PLAY', scenarioId: sc.id });
    expect(actor.getSnapshot().value).toBe('briefing');
    const room = await joinWith(roomView({ phase: 'design', design: { ...goDesign } }));
    expect(activePhase('briefing', useRoom.getState().view)).toBe('design');
    getSession().toMenu();
    await Promise.resolve();
    expect(room.left).toBe(true);
    expect(useRoom.getState()).toMatchObject({ status: 'idle', view: null, myId: null, error: null });
    expect(getSession().kind).toBe('local');
    expect(storage.data.has(TOKEN_KEY)).toBe(false);
    expect(actor.getSnapshot().value).toBe('menu');
    expect(activePhase('menu', useRoom.getState().view)).toBe('menu');
  });

  it('si el servidor cierra o la reconexión falla, vuelve al menú con el error', async () => {
    const room = await joinWith(roomView({ phase: 'operation', design: { ...goDesign } }));
    room.close(4003);
    expect(useRoom.getState()).toMatchObject({ status: 'disconnected', view: null, error: { key: 'room.error.lost', code: 4003 } });
    expect(useUi.getState().notice).toMatchObject({ tone: 'bad', key: 'room.error.lost' });
    expect(getSession().kind).toBe('local');
    expect(actor.getSnapshot().value).toBe('menu');
    expect(useSim.getState().snapshot).toBeNull();
  });
});

describe('errores del servidor al crear o entrar (M2)', () => {
  const cases: [string, string][] = [
    ['invalid-scenario', 'room.error.invalidScenario'],
    ['academy-scenario', 'room.error.academyScenario'],
    ['invalid-attempt', 'room.error.invalidAttempt'],
    ['invalid-seed', 'room.error.invalidSeed'],
    ['room-not-in-lobby', 'room.error.roomNotInLobby'],
    ['room-full', 'room.error.roomFull'],
    ['already-joined', 'room.error.alreadyJoined'],
  ];

  it('el mensaje estable del servidor se traduce a su clave room.error.<camelCase> (existe en es y en)', () => {
    const esKeys = flatten(es);
    const enKeys = flatten(en);
    for (const [message, key] of cases) {
      expect(joinError(Object.assign(new Error(message), { code: 526 }))).toEqual({ key, code: 526 });
      expect(esKeys[key], key).toBeTruthy();
      expect(enKeys[key], key).toBeTruthy();
    }
    // Respaldo por código si el mensaje no es conocido.
    expect(joinError(Object.assign(new Error('otra cosa'), { code: 526 }))).toEqual({ key: 'room.error.rejected', code: 526 });
    expect(joinError(Object.assign(new Error('x'), { code: 522 }))).toEqual({ key: 'room.error.notFound', code: 522 });
    // El servidor real: sala inexistente = 522 «not found»; sala llena o ya empezada = 522 «is locked» (Colyseus bloquea antes de onJoin).
    expect(joinError(Object.assign(new Error('room "x" not found'), { code: 522 }))).toEqual({ key: 'room.error.notFound', code: 522 });
    expect(joinError(Object.assign(new Error('room "abc" is locked'), { code: 522 }))).toEqual({ key: 'room.error.locked', code: 522 });
    expect(joinError(Object.assign(new Error('x'), { code: 524 }), 'room.error.resume')).toEqual({ key: 'room.error.resume', code: 524 });
    expect(joinError(new TypeError('fetch failed'))).toEqual({ key: 'room.error.unreachable' });
    expect(joinError(Object.assign(new Error('x'), { code: 999 }))).toEqual({ key: 'room.error.join', code: 999 });
  });

  it('entrar en una sala que ya empezó muestra su motivo', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    client.fail = Object.assign(new Error('room-not-in-lobby'), { code: 526 });
    expect(await joinRoomByCode('ABC', { name: 'Ana' })).toBe(false);
    expect(useRoom.getState().error).toEqual({ key: 'room.error.roomNotInLobby', code: 526 });
    expect(useUi.getState().notice).toMatchObject({ tone: 'bad', key: 'room.error.roomNotInLobby' });
  });
});

describe('volver tras una caída: useRoom.retry y retryRoom (M3)', () => {
  const GRACE_MS = 60_000;

  it('caída sin salir: conserva el token durante la gracia (desde la caída) y retryRoom vuelve a la sala', async () => {
    const room = await joinWith(roomView({ phase: 'design', design: { ...goDesign } }));
    const dropAt = clock;
    room.drop(); // el SDK reintenta…
    expect(useRoom.getState().status).toBe('reconnecting');
    clock += 20_000;
    room.close(4003); // …y se rinde (o la caída fue antes de minUptime)
    expect(useRoom.getState()).toMatchObject({
      status: 'disconnected', view: null, error: { key: 'room.error.lost', code: 4003 }, retry: { untilMs: dropAt + GRACE_MS },
    });
    expect(storage.data.get(TOKEN_KEY)).toBe('ROOM1:tok-1');
    expect(getSession().kind).toBe('local');
    expect(actor.getSnapshot().value).toBe('menu');

    client.next = new FakeRoom('ROOM1', 'me', 'ROOM1:tok-2');
    expect(await retryRoom()).toBe(true);
    expect(client.calls.at(-1)).toEqual({ method: 'reconnect', args: ['ROOM1:tok-1'] });
    expect(getSession().kind).toBe('room');
    expect(useRoom.getState()).toMatchObject({ status: 'connected', retry: null });
    expect(storage.data.get(TOKEN_KEY)).toBe('ROOM1:tok-2');
    client.next.emit(roomView({ phase: 'design', design: { ...goDesign } }));
    expect(useDesign.getState().design()).toEqual(goDesign);
  });

  it('sin onDrop (cierre anormal directo) la gracia cuenta desde el cierre; al vencer, retryRoom no conecta y borra todo', async () => {
    const room = await joinWith(roomView({ phase: 'lobby' }));
    room.close(1006);
    expect(useRoom.getState().retry).toEqual({ untilMs: clock + GRACE_MS });
    clock += GRACE_MS + 1;
    const calls = client.calls.length;
    expect(await retryRoom()).toBe(false);
    expect(client.calls.length).toBe(calls);
    expect(useRoom.getState().retry).toBeNull();
    expect(storage.data.has(TOKEN_KEY)).toBe(false);
  });

  it('si el servidor ya no guarda el sitio se descarta; si no responde, se puede volver a intentar', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let room = await joinWith(roomView({ phase: 'lobby' }));
    room.close(1006);
    client.fail = new TypeError('fetch failed'); // sin red todavía
    expect(await retryRoom()).toBe(false);
    expect(useRoom.getState()).toMatchObject({ status: 'error', error: { key: 'room.error.unreachable' }, retry: { untilMs: expect.any(Number) } });
    expect(storage.data.has(TOKEN_KEY)).toBe(true);
    client.fail = Object.assign(new Error('expired'), { code: 524 }); // la gracia venció en el servidor
    expect(await retryRoom()).toBe(false);
    expect(useRoom.getState()).toMatchObject({ error: { key: 'room.error.resume', code: 524 }, retry: null });
    expect(storage.data.has(TOKEN_KEY)).toBe(false);

    // Descartar a mano.
    client.fail = null;
    client.next = new FakeRoom();
    room = await joinWith(roomView({ phase: 'lobby' }));
    room.close(1006);
    expect(useRoom.getState().retry).not.toBeNull();
    dismissRetry();
    expect(useRoom.getState().retry).toBeNull();
    expect(storage.data.has(TOKEN_KEY)).toBe(false);
  });

  it('cierre del servidor (apagado) o salida consentida: sin retry y sin token', async () => {
    let room = await joinWith(roomView({ phase: 'lobby' }));
    room.close(4001);
    expect(useRoom.getState()).toMatchObject({ status: 'disconnected', error: { key: 'room.error.closed', code: 4001 }, retry: null });
    expect(storage.data.has(TOKEN_KEY)).toBe(false);
    client.next = new FakeRoom();
    room = await joinWith(roomView({ phase: 'lobby' }));
    await leaveRoom();
    expect(useRoom.getState()).toMatchObject({ status: 'idle', retry: null });
    expect(storage.data.has(TOKEN_KEY)).toBe(false);
  });
});
