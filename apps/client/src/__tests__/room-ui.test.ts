import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalog, isTeamScenario, createRoomView, decodeRoomView, encodeRoomView, parseTeamAction, type ResourceRequest, type RoomView, type TeamAlert, type TeamPlayer, type TeamRole, type TeamVote } from '@payload/shared';
import { configureNet, leaveRoom, quickMatch, resetNetConfig, type ClientLike, type RoomLike } from '../net/roomSession';
import { canDoIn, INITIAL_ROOM_STATE, useRoom } from '../net/roomStore';
import { useSession } from '../net/sessionStore';
import { useUi } from '../state/ui';
import { demoRoomView } from '../room/devRoom';
import {
  acknowledgeAlert, approveRequest, sendChat, sendPing, toggleMyRole, voteNoGo,
} from '../room/actions';
import {
  CONSOLE_SLOTS, ROLE_COLOR, ROLE_ORDER, alertPendingRoles, alertRemainingS, allocationFromDraft, allocationRows, chatDraft,
  chatUnread, cleanName, collabRows, durationParts, defaultRoomScenario, draftError, draftFromAllocation, draftTotal, lastFromOthers, lerpPose, myAlertRoles,
  newAlertIds, noGoFormError, noGoReasonFrom, noGoVoteLines, parsePositive, pingActive, pingFade, pingPointFromRay, pingWorldPosition,
  placeAvatars, playerLabel, poseSmoothing, primaryRole, relativeAge, requestFromDraft, requestLine, roleResources, roomNowS, sortRequests,
  toggleRole, uncoveredRoles, pieceToReturn, requestCooldownActive, RETURN_TO_HAND_MS, REQUEST_COOLDOWN_MS, voteStates, canResolveRequest, canWithdrawRequest,
} from '../room/roomUiLogic';
import { campaignScenarios, roomScenarios } from '../ui/catalogViews';
import { confirmLeave, requestLeave } from '../room/leave';

// ─── Dobles mínimos del SDK (como en net.test.ts) ───────────────────────────
type Cb<A extends unknown[]> = (...args: A) => void;
class FakeRoom implements RoomLike {
  state: unknown = undefined;
  sent: { type: string; payload: unknown }[] = [];
  private stateCbs: Cb<[unknown]>[] = [];
  constructor(public roomId = 'ROOM1', public sessionId = 'me', public reconnectionToken = 'ROOM1:tok') {}
  send(type: string, payload?: unknown): void { this.sent.push({ type, payload }); }
  onStateChange(cb: Cb<[unknown]>): void { this.stateCbs.push(cb); }
  private msgs = new Map<string, Cb<[unknown]>[]>();
  onMessage(type: string, cb: Cb<[unknown]>): () => void { this.msgs.set(type, [...(this.msgs.get(type) ?? []), cb]); return () => undefined; }
  message(type: string, payload: unknown): void { (this.msgs.get(type) ?? []).forEach((cb) => cb(payload)); }
  onLeave(): void {}
  onDrop(): void {}
  onReconnect(): void {}
  onError(): void {}
  leave(): Promise<number> { return Promise.resolve(4000); }
  emit(view: RoomView): void {
    const wire = encodeRoomView(view);
    this.state = { toJSON: () => wire };
    this.stateCbs.forEach((cb) => cb(this.state));
  }
  actions(): unknown[] { return this.sent.filter((s) => s.type === 'action').map((s) => s.payload); }
}
class FakeClient implements ClientLike {
  next = new FakeRoom();
  private open = () => Promise.resolve(this.next as RoomLike);
  joinOrCreate = this.open;
  create = this.open;
  joinById = this.open;
  reconnect = this.open;
}

const sc = campaignScenarios()[0]!;
const ALL: TeamRole[] = ['director', 'engineering', 'science', 'operations'];
const player = (id: string, roles: TeamRole[], extra: Partial<TeamPlayer> = {}): TeamPlayer => ({ id, name: id.toUpperCase(), roles, connected: true, isHost: false, pose: null, ...extra });
const view = (patch: Partial<RoomView> = {}): RoomView => ({
  ...createRoomView({ roomId: 'ROOM1', scenarioId: sc.id, attempt: 0, seed: sc.defaultSeed }),
  hostId: 'me',
  players: [player('me', ['director'], { isHost: true }), player('beto', ['engineering', 'science', 'operations'])],
  ...patch,
});

describe('lógica pura de la UI de sala', () => {
  it('roles: color, rol principal, alternar y recursos que vigila', () => {
    expect(ROLE_ORDER).toEqual(ALL);
    expect(new Set(Object.values(ROLE_COLOR)).size).toBe(4);
    expect(primaryRole(['operations', 'science'])).toBe('science');
    expect(primaryRole([])).toBeNull();
    expect(toggleRole(['science'], 'director')).toEqual(['director', 'science']);
    expect(toggleRole(['director', 'science'], 'director')).toEqual(['science']);
    expect(roleResources('engineering')).toEqual(['mass', 'power', 'battery']);
    expect(roleResources('science')).toEqual([]);
    expect(uncoveredRoles([player('a', ['director']), player('b', ['science'], { connected: false })])).toEqual(['engineering', 'science', 'operations']);
  });

  it('nombre del jugador y escenario por defecto', () => {
    expect(playerLabel({ name: '  ' }, 2, (n) => `Jugador ${n}`)).toBe('Jugador 3');
    expect(playerLabel({ name: 'Ana' }, 0, (n) => `Jugador ${n}`)).toBe('Ana');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
    expect(defaultRoomScenario([{ id: 'a' }, { id: 't', team: { minPlayers: 2, maxPlayers: 4 } }])).toBe('t');
    expect(defaultRoomScenario([{ id: 'a' }, { id: 'b' }])).toBe('a');
    // los escenarios de equipo no salen en la campaña en solitario, pero sí encabezan la entrada de sala
    const team = catalog.scenarios.filter((s) => isTeamScenario(s));
    expect(team.length).toBeGreaterThan(0);
    expect(campaignScenarios().some((s) => isTeamScenario(s))).toBe(false);
    expect(roomScenarios()[0]!.id).toBe(team[0]!.id);
  });

  it('tiempo relativo y reloj de sala', () => {
    expect(relativeAge(100, 70)).toEqual({ unit: 's', value: 30 });
    expect(relativeAge(500, 100)).toEqual({ unit: 'min', value: 6 });
    expect(relativeAge(8000, 100)).toEqual({ unit: 'h', value: 2 });
    expect(relativeAge(5, 10)).toEqual({ unit: 's', value: 0 });
    const v = demoRoomView('design');
    expect(roomNowS(v)).toBeGreaterThan(200);
    expect(roomNowS(null)).toBe(0);
  });

  it('solicitudes: orden, formato, quién resuelve y quién retira', () => {
    const base = { fromPlayerId: 'a', fromRole: 'science', toRole: 'engineering', resource: 'power', createdAtS: 100 } as const;
    const reqs: ResourceRequest[] = [
      { ...base, id: 'new', status: 'open', createdAtS: 200, amount: 40 },
      { ...base, id: 'old', status: 'open' },
      { ...base, id: 'done', status: 'approved', resolvedAtS: 150 },
      { ...base, id: 'chain', status: 'open', approvedBy: ['engineering'], toRole: 'director', resource: 'budget', subsystem: 'payload' },
    ];
    const { open, closed } = sortRequests(reqs);
    expect(open.map((r) => r.id)).toEqual(['old', 'chain', 'new']);
    expect(closed.map((r) => r.id)).toEqual(['done']);
    const line = requestLine(reqs[0]!, 260);
    expect(line).toMatchObject({ amount: 40, unit: 'W', pendingRole: 'engineering', chained: false, ageS: 60 });
    expect(requestLine(reqs[3]!, 300)).toMatchObject({ chained: true, approvedBy: ['engineering'], subsystem: 'payload' });
    expect(requestLine(reqs[2]!, 300).ageS).toBe(150);
    expect(canResolveRequest(reqs[0]!, ['engineering'])).toBe(true);
    expect(canResolveRequest(reqs[0]!, ['science'])).toBe(false);
    expect(canResolveRequest(reqs[2]!, ['engineering'])).toBe(false);
    expect(canWithdrawRequest(reqs[0]!, 'a')).toBe(true);
    expect(canWithdrawRequest(reqs[0]!, 'b')).toBe(false);
  });

  it('formulario de solicitud explícita', () => {
    expect(parsePositive('2,5')).toBe(2.5);
    expect(parsePositive('0')).toBeNull();
    expect(parsePositive('abc')).toBeNull();
    expect(requestFromDraft({ resource: 'power', amount: '40', subsystem: 'payload', note: ' hola ' })).toEqual({ resource: 'power', amount: 40, subsystem: 'payload', note: 'hola' });
    expect(requestFromDraft({ resource: 'mass', amount: '', subsystem: '', note: '' })).toEqual({ resource: 'mass' });
  });

  it('votos: estado por rol (cuenta el último) y validación del No-Go', () => {
    const votes: TeamVote[] = [
      { role: 'director', playerId: 'me', value: 'go', atS: 1 },
      { role: 'operations', playerId: 'b', value: 'no-go', reason: { code: 'risk' }, atS: 2 },
      { role: 'operations', playerId: 'b', value: 'go', atS: 3 },
    ];
    const st = voteStates(votes, { missingRoles: ['engineering', 'science'] });
    expect(st.map((s) => s.state)).toEqual(['go', 'pending', 'pending', 'go']);
    expect(st[0]!.playerId).toBe('me');
    expect(voteStates([{ role: 'science', playerId: 'c', value: 'no-go', reason: { code: 'other', note: 'x' }, atS: 1 }], null)[2]!.reason).toEqual({ code: 'other', note: 'x' });
    expect(noGoVoteLines([{ role: 'science', playerId: 'c', value: 'no-go', reason: { code: 'mass', note: 'pesa' }, atS: 1 }, votes[0]!])).toEqual([{ role: 'science', playerId: 'c', code: 'mass', note: 'pesa' }]);
    // No-Go sin motivo o «otro» sin nota no se pueden enviar
    expect(noGoFormError({ code: null, note: '' })).toBe('code');
    expect(noGoFormError({ code: 'other', note: '  ' })).toBe('note');
    expect(noGoFormError({ code: 'risk', note: '' })).toBeNull();
    expect(noGoReasonFrom({ code: null, note: 'x' })).toBeNull();
    expect(noGoReasonFrom({ code: 'other', note: ' x ' })).toEqual({ code: 'other', note: 'x' });
    expect(noGoReasonFrom({ code: 'mass', note: '' })).toEqual({ code: 'mass' });
  });

  it('alertas: tiempo restante, roles pendientes y alertas nuevas', () => {
    const alert: TeamAlert = {
      id: 'a1', event: { type: 'solar-storm', tSeconds: 0, message: { key: 'event.solarStorm' } }, requiredRoles: ['engineering', 'operations'],
      acks: [{ role: 'operations', playerId: 'b', atS: 105 }], raisedAtS: 100, closedAtS: null, timedOut: false,
    };
    expect(alertRemainingS(alert, 100)).toBe(45);
    expect(alertRemainingS(alert, 130)).toBe(15);
    expect(alertRemainingS(alert, 500)).toBe(0);
    expect(alertRemainingS({ ...alert, closedAtS: 120 }, 110)).toBe(0);
    expect(alertPendingRoles(alert)).toEqual(['engineering']);
    expect(myAlertRoles(alert, ['engineering', 'operations'])).toEqual(['engineering']);
    expect(myAlertRoles(alert, ['science'])).toEqual([]);
    expect(newAlertIds([alert, { ...alert, id: 'a2' }], new Set(['a1']))).toEqual(['a2']);
  });

  it('chat: no leídos, último de otros y texto', () => {
    const chat = ['1', '2', '3', '4'].map((id, i) => ({ id, playerId: i === 2 ? 'me' : 'x', name: 'n', roles: [], text: id, atS: i }));
    expect(chatUnread(chat, 'me', null)).toBe(3);
    expect(chatUnread(chat, 'me', '2')).toBe(1);
    expect(chatUnread(chat, 'me', '4')).toBe(0);
    expect(chatUnread(chat, 'me', 'fuera-del-historial')).toBe(3);
    expect(lastFromOthers(chat, 'me')!.id).toBe('4');
    expect(lastFromOthers([chat[2]!], 'me')).toBeNull();
    expect(chatDraft('   ')).toBeNull();
    expect(chatDraft('a'.repeat(400))).toHaveLength(280);
  });

  it('pings: caducidad, fundido, punto del rayo y posición en el hangar', () => {
    expect(pingActive({ expiresAtMs: 1000 }, 999)).toBe(true);
    expect(pingActive({ expiresAtMs: 1000 }, 1000)).toBe(false);
    expect(pingFade({ expiresAtMs: 5000 }, 500)).toBe(1);
    expect(pingFade({ expiresAtMs: 1000 }, 900)).toBeCloseTo(0.1);
    expect(pingFade({ expiresAtMs: 1000 }, 1200)).toBe(0);
    // mirando hacia abajo: corta el plano y = 1.5
    expect(pingPointFromRay([0, 2.5, 0], [0, -0.7071, -0.7071])[1]).toBeCloseTo(1.5, 1);
    // mirando horizontal: a 6 m
    expect(pingPointFromRay([0, 1.6, 0], [0, 0, -1])).toEqual([0, 1.6, -6]);
    const layout = { boxes: [{ id: 'c1', pos: [1, 1, -12] as const }], shelves: [{ subsystem: 'power' as const, x: -4 }], shelfZ: -12.4, ship: [0, 0, 0] as const, console: [10, 0, 4] as const };
    expect(pingWorldPosition({ kind: 'point', position: [1, 2, 3] }, layout)).toEqual([1, 2, 3]);
    expect(pingWorldPosition({ kind: 'component', id: 'c1' }, layout)[0]).toBe(1);
    expect(pingWorldPosition({ kind: 'component', id: 'nada' }, layout)[0]).toBe(0);
    expect(pingWorldPosition({ kind: 'subsystem', id: 'power' }, layout)[0]).toBe(-4);
    expect(pingWorldPosition({ kind: 'resource', id: 'power' }, layout)[0]).toBe(10);
  });

  it('avatares: uno junto a la consola de su rol principal; sin rol, en fila', () => {
    expect(CONSOLE_SLOTS.map((s) => s.role)).toEqual(ALL);
    const spots = placeAvatars([player('a', ['science', 'operations']), player('b', []), player('c', []), player('d', ['director'])]);
    const a = spots.find((s) => s.playerId === 'a')!;
    expect(a.role).toBe('science');
    const slot = CONSOLE_SLOTS.find((s) => s.role === 'science')!;
    // junto a la consola (≈1,1 m) y de cara a ella
    expect(Math.hypot(a.position[0] - slot.position[0], a.position[2] - slot.position[2])).toBeCloseTo(1.1, 3);
    expect(Math.cos(a.yaw - (slot.yaw + Math.PI))).toBeCloseTo(1, 5);
    const idle = spots.filter((s) => s.role === null);
    expect(idle).toHaveLength(2);
    expect(idle[0]!.position[0]).not.toBe(idle[1]!.position[0]);
    expect(new Set(spots.map((s) => s.position.join())).size).toBe(4);
  });

  it('interpolación de pose: converge y gira por el camino corto', () => {
    const cur = { x: 0, y: 0, z: 0, yaw: 3 };
    lerpPose(cur, { x: 10, y: 0, z: -10, yaw: -3 }, 0.5);
    expect(cur.x).toBe(5);
    expect(cur.z).toBe(-5);
    // de 3 a -3 rad (≈ +0,28 rad por el camino corto): el giro sube, no baja hacia -3
    expect(cur.yaw).toBeGreaterThan(3);
    expect(poseSmoothing(0)).toBe(0);
    expect(poseSmoothing(1)).toBeGreaterThan(0.99);
  });

  it('reparto de presupuesto editable', () => {
    const d = demoRoomView('design');
    const rows = allocationRows(d.design, d.allocation);
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.subsystem === 'payload')!.allocatedMUSD).toBe(6);
    const draft = draftFromAllocation(null);
    expect(Object.values(draft).every((v) => v === '')).toBe(true);
    expect(allocationFromDraft(draft)).toEqual({});
    expect(draftTotal({ ...draft, power: '3', comms: '1,5' })).toBeCloseTo(4.5);
    expect(allocationFromDraft({ ...draft, power: 'x' })).toBeNull();
    expect(allocationFromDraft({ ...draft, power: '-1' })).toBeNull();
    const scenario = catalog.scenarios.find((s) => s.id === d.scenarioId)!;
    expect(draftError({ ...draft, power: '1' }, scenario, d.design.launcherId)).toBeNull();
    expect(draftError({ ...draft, power: '999999' }, scenario, d.design.launcherId)?.key).toBe('team.reject.allocationOverBudget');
    expect(draftError({ ...draft, power: 'x' }, scenario, d.design.launcherId)?.key).toBe('team.reject.allocationInvalid');
  });

  it('duraciones (no «hace…»)', () => {
    expect(durationParts(42)).toEqual({ key: 's', params: { n: 42 } });
    expect(durationParts(65)).toEqual({ key: 'minS', params: { min: 1, s: 5 } });
    expect(durationParts(120)).toEqual({ key: 'min', params: { n: 2 } });
    expect(durationParts(-3)).toEqual({ key: 's', params: { n: 0 } });
  });

  it('colaboración: filas del desglose', () => {
    const rows = collabRows({ score: 80, requestsTotal: 3, requestsResolved: 2, avgRequestResponseS: 42, alertsTotal: 1, alertAcksExpected: 2, alertAcksOnTime: 1, avgAlertResponseS: null, criteria: {} });
    expect(rows.map((r) => [r.key, r.value, r.total])).toEqual([['requests', 2, 3], ['requestTime', 42, null], ['alerts', 1, 2], ['alertTime', null, null]]);
  });

  it('la sala de ejemplo (?room=demo) es una vista válida para el cable y trae lo prometido', () => {
    for (const phase of ['lobby', 'design', 'review', 'operation', 'report'] as const) {
      const v = demoRoomView(phase);
      const back = decodeRoomView(encodeRoomView(v));
      expect(back.phase).toBe(phase);
      expect(back.players).toHaveLength(3);
    }
    expect(uncoveredRoles(demoRoomView('lobby').players)).toHaveLength(1);
    const design = demoRoomView('design');
    expect(design.requests.length).toBeGreaterThanOrEqual(3);
    expect(design.chat.length).toBeGreaterThan(0);
    expect(demoRoomView('review').votes.length).toBeGreaterThan(0);
    expect(demoRoomView('operation').alerts.some((a) => a.closedAtS === null)).toBe(true);
    const report = demoRoomView('report');
    expect(report.result?.score.total).toBeGreaterThanOrEqual(0);
    expect(report.collaboration?.score).toBe(82);
  });
});

describe('permisos de la UI salen de canDo (no se duplican reglas)', () => {
  it('Ciencia no puede montar piezas de energía: rechazo con motivo; sí las suyas', () => {
    const v = demoRoomView('design', 'science');
    const comps = catalog.components;
    const power = comps.find((c) => c.subsystem === 'power')!;
    const payload = comps.find((c) => c.subsystem === 'payload')!;
    const st = { view: v, myId: 'me', myRoles: ['science'] as TeamRole[], isHost: true };
    expect(canDoIn(st, { type: 'add-component', componentId: power.id }).kind).toBe('reject');
    expect(['apply', 'request']).toContain(canDoIn(st, { type: 'add-component', componentId: payload.id }).kind);
    expect(canDoIn(st, { type: 'select-orbit', orbitId: null }).kind).toBe('reject');
    const dir = { ...st, myRoles: ['director'] as TeamRole[] };
    expect(canDoIn(dir, { type: 'select-orbit', orbitId: null }).kind).toBe('apply');
  });
});

describe('solicitudes: el «+» sale de canDo (requestPending, tooManyRequests)', () => {
  it('con una solicitud mía abierta para la misma acción, montar la pieza se rechaza (requestPending)', () => {
    const v = demoRoomView('design', 'science');
    const st = { view: v, myId: 'me', myRoles: ['science'] as TeamRole[], isHost: true };
    const pick = catalog.components.find((c) => canDoIn(st, { type: 'add-component', componentId: c.id }).kind === 'request');
    expect(pick, 'el catálogo debe tener una pieza que genere solicitud a Ciencia').toBeTruthy();
    const action = { type: 'add-component' as const, componentId: pick!.id };
    const first = canDoIn(st, action);
    if (first.kind !== 'request') throw new Error('esperaba una solicitud');
    const open: ResourceRequest = {
      id: 'mine', fromPlayerId: 'me', fromRole: first.fromRole, toRole: first.toRole, resource: first.resource, amount: first.amount,
      action, status: 'open', createdAtS: 1, ...(first.componentId ? { componentId: first.componentId } : {}),
    };
    const pending = canDoIn({ ...st, view: { ...v, requests: [open] } }, action);
    expect(pending).toMatchObject({ kind: 'reject', reason: { key: 'team.reject.requestPending' } });
    // con muchas solicitudes mías abiertas (otras acciones) se rechaza por el tope
    const many = Array.from({ length: 12 }, (_, i): ResourceRequest => ({ ...open, id: `m${i}`, action: undefined, componentId: undefined, resource: 'budget', toRole: 'director' }));
    const capped = canDoIn({ ...st, view: { ...v, requests: many } }, action);
    expect(capped).toMatchObject({ kind: 'reject', reason: { key: 'team.reject.tooManyRequests' } });
  });
});

describe('pieza en la mano y enfriamiento', () => {
  it('un rechazo de add-component justo tras soltar la pieza la devuelve a la mano', () => {
    const dropped = { id: 'panel-1', atMs: 1000 };
    expect(pieceToReturn({ action: 'add-component', atMs: 1200 }, dropped, null)).toBe('panel-1');
    expect(pieceToReturn({ action: 'add-component', atMs: 1000 + RETURN_TO_HAND_MS + 1 }, dropped, null)).toBeNull(); // demasiado tarde
    expect(pieceToReturn({ action: 'add-component', atMs: 900 }, dropped, null)).toBeNull(); // rechazo anterior
    expect(pieceToReturn({ action: 'select-orbit', atMs: 1200 }, dropped, null)).toBeNull();
    expect(pieceToReturn({ action: 'add-component', atMs: 1200 }, dropped, 'otra')).toBeNull(); // ya lleva otra
    expect(pieceToReturn(null, dropped, null)).toBeNull();
    expect(pieceToReturn({ action: 'add-component', atMs: 1200 }, null, null)).toBeNull();
  });
  it('enfriamiento de 2 s tras una solicitud propia', () => {
    expect(requestCooldownActive(1500, 1000)).toBe(true);
    expect(requestCooldownActive(1000 + REQUEST_COOLDOWN_MS, 1000)).toBe(false);
    expect(requestCooldownActive(5000, null)).toBe(false);
  });
});

describe('botones principales → acción correcta (con la sala de pruebas)', () => {
  let client: FakeClient;
  beforeEach(() => {
    client = new FakeClient();
    configureNet({ clientFactory: () => client, storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, now: () => 10_000, url: () => 'ws://test:2567' });
    useUi.setState({ notice: null });
  });
  afterEach(async () => {
    await leaveRoom();
    resetNetConfig();
    useSession.getState().local.bind(null);
    useRoom.setState({ ...INITIAL_ROOM_STATE });
  });
  async function join(v: RoomView): Promise<FakeRoom> {
    expect(await quickMatch({ scenarioId: sc.id, name: 'Ana' })).toBe(true);
    client.next.emit(v);
    return client.next;
  }
  const last = (r: FakeRoom) => r.actions().at(-1);

  it('reclamar y soltar roles (un jugador puede llevar varios)', async () => {
    const room = await join(view({ phase: 'lobby', players: [player('me', ['director'], { isHost: true })] }));
    toggleMyRole('science');
    expect(last(room)).toEqual({ type: 'claim-roles', roles: ['director', 'science'] });
    toggleMyRole('director');
    expect(last(room)).toEqual({ type: 'claim-roles', roles: [] });
  });

  it('No-Go con motivo: envía el voto; sin motivo no envía nada', async () => {
    const room = await join(view({ phase: 'review', players: [player('me', ALL, { isHost: true })] }));
    const before = room.actions().length;
    expect(voteNoGo('director', { code: null, note: '' })).toBeNull();
    expect(voteNoGo('director', { code: 'other', note: '' })).toBeNull();
    expect(room.actions()).toHaveLength(before);
    voteNoGo('science', { code: 'other', note: 'falta un instrumento' });
    expect(last(room)).toEqual({ type: 'vote', role: 'science', value: 'no-go', reason: { code: 'other', note: 'falta un instrumento' } });
    voteNoGo('director', { code: 'mass', note: '' });
    expect(parseTeamAction(last(room))).toBeTruthy();
    expect(last(room)).toEqual({ type: 'vote', role: 'director', value: 'no-go', reason: { code: 'mass' } });
  });

  it('aprobar y rechazar una solicitud', async () => {
    const room = await join(view({ phase: 'design', players: [player('me', ['engineering'], { isHost: true }), player('b', ['director', 'science', 'operations'])] }));
    approveRequest('r1', 'ok');
    expect(last(room)).toEqual({ type: 'resolve-request', requestId: 'r1', approve: true, note: 'ok' });
  });

  it('responder una alerta con cada rol propio', async () => {
    const room = await join(view({ phase: 'operation' }));
    acknowledgeAlert('a1', 'director');
    expect(last(room)).toEqual({ type: 'ack-alert', alertId: 'a1', role: 'director' });
  });

  it('un rechazo por límite de frecuencia se avisa y queda como último rechazo (y la pieza vuelve a la mano)', async () => {
    const room = await join(view({ phase: 'design' }));
    room.message('notice', { kind: 'rejected', action: 'add-component', reason: { key: 'team.reject.requestRateLimited', params: { seconds: 2 } } });
    expect(useUi.getState().notice?.ref?.key).toBe('team.reject.requestRateLimited');
    const rej = useRoom.getState().lastRejected!;
    expect(rej.action).toBe('add-component');
    expect(pieceToReturn(rej, { id: 'p', atMs: rej.atMs - 100 }, null)).toBe('p');
  });

  it('chat y ping', async () => {
    const room = await join(view({ phase: 'design' }));
    expect(sendChat('   ')).toBeNull();
    sendChat('  hola equipo ');
    expect(last(room)).toEqual({ type: 'chat', text: 'hola equipo' });
    sendPing({ kind: 'subsystem', id: 'power' });
    expect(last(room)).toEqual({ type: 'ping', target: { kind: 'subsystem', id: 'power' } });
    sendPing({ kind: 'point', position: [1, 1.5, -2] });
    expect(last(room)).toEqual({ type: 'ping', target: { kind: 'point', position: [1, 1.5, -2] } });
  });

  it('salir: en el lobby sale directo; en una sala empezada pide confirmación propia', async () => {
    const room = await join(view({ phase: 'lobby' }));
    requestLeave();
    expect(useUi.getState().confirmLeave).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(useSession.getState().room).toBeNull();
    void room;
    await join(view({ phase: 'design' }));
    requestLeave();
    expect(useUi.getState().confirmLeave).toBe(true);
    expect(useSession.getState().room).not.toBeNull();
    confirmLeave();
    expect(useUi.getState().confirmLeave).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(useSession.getState().room).toBeNull();
  });
});
