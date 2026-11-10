import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ackAlert, alertForEvent, buildResourceRequest, catalog, checkTeamAction, closeRequest, createMissionSim, createRoomView, decodeRoomView,
  defaultAllocation, encodeRoomView, parseTeamAction, reviewGoNoGo, rollPreLaunchEvents, runMission, scoreCollaboration,
  teamActionSchema, TEAM_ACTION_PHASES, TEAM_LIMITS, withCollaboration,
} from '../index';
import type { Catalog, RoomStateWire, RoomView, TeamAction, TeamRequestCheck } from '../types';
import { loadDesign, SCENARIO_ID } from './fixtures';

// ─── Tipo: lo que infiere zod y TeamAction son intercambiables (falla en `pnpm typecheck` si no) ─────
type Assignable<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Parsed = z.infer<typeof teamActionSchema>;
const parsedIsTeamAction: Assignable<Parsed, TeamAction> = true;
const teamActionIsParsed: Assignable<TeamAction, Parsed> = true;
/** Si zod infiriera `any`, la asignabilidad mutua sería trivial: esto lo impide. */
const parsedIsNotAny: IsAny<Parsed> = false;
/** Y una acción ajena no es asignable (el chequeo no es trivialmente cierto). */
const foreignIsRejected: Assignable<{ type: 'fly' }, Parsed> = false;

const VALID: TeamAction[] = [
  { type: 'set-name', name: 'Ada' },
  { type: 'claim-roles', roles: ['science', 'engineering'] },
  { type: 'claim-roles', roles: [] },
  { type: 'auto-assign-roles' },
  { type: 'start-mission' },
  { type: 'start-design' },
  { type: 'add-component', componentId: 'battery-small' },
  { type: 'remove-component', componentId: 'battery-small' },
  { type: 'select-orbit', orbitId: 'SSO' },
  { type: 'select-orbit', orbitId: null },
  { type: 'select-launcher', launcherId: 'launcher-colibri' },
  { type: 'select-launcher', launcherId: null },
  { type: 'allocate-budget', allocation: { payload: 10, power: 2.5 } },
  { type: 'allocate-budget', allocation: null },
  { type: 'request-resource', resource: 'budget', amount: 2, subsystem: 'payload', note: 'más ciencia' },
  { type: 'request-resource', resource: 'power' },
  { type: 'resolve-request', requestId: 'r1', approve: false, note: 'propón otra cosa' },
  { type: 'withdraw-request', requestId: 'r1' },
  { type: 'request-review' },
  { type: 'vote', role: 'director', value: 'go' },
  { type: 'vote', role: 'science', value: 'no-go', reason: { code: 'other', note: 'no me convence' } },
  { type: 'vote', role: 'science', value: 'no-go', reason: { code: 'mass' } },
  { type: 'confirm-launch' },
  { type: 'launch-done' },
  { type: 'set-time-scale', accel: 100 },
  { type: 'ack-alert', alertId: 'a1', role: 'operations' },
  { type: 'finish-operation' },
  { type: 'redesign' },
  { type: 'chat', text: '¿Quién lleva la batería?' },
  { type: 'ping', target: { kind: 'subsystem', id: 'power' } },
  { type: 'ping', target: { kind: 'component', id: 'battery-small' } },
  { type: 'ping', target: { kind: 'resource', id: 'comms' } },
  { type: 'ping', target: { kind: 'point', position: [1.5, 0, -2] } },
];

describe('teamActionSchema', () => {
  it('el tipo inferido por zod coincide con TeamAction', () => {
    expect(parsedIsTeamAction && teamActionIsParsed).toBe(true);
    expect(parsedIsNotAny || foreignIsRejected).toBe(false);
  });

  it('acepta un ejemplo de cada tipo de acción y lo devuelve igual', () => {
    expect(new Set(VALID.map((a) => a.type))).toEqual(new Set(Object.keys(TEAM_ACTION_PHASES)));
    for (const a of VALID) {
      const r = teamActionSchema.safeParse(JSON.parse(JSON.stringify(a)));
      expect(r.success, JSON.stringify(a)).toBe(true);
      expect(r.data).toEqual(a);
      expect(parseTeamAction(a)).toEqual(a);
    }
  });

  it('rechaza tipos desconocidos, campos de más, tipos erróneos y longitudes excesivas', () => {
    const long = (n: number) => 'x'.repeat(n);
    const bad: unknown[] = [
      null, 'chat', 42, [], {}, { type: 'fly' }, { type: 'chat' },
      { type: 'chat', text: 'hola', extra: 1 },
      { type: 'chat', text: '' },
      { type: 'chat', text: long(TEAM_LIMITS.chatMaxChars + 1) },
      { type: 'set-name', name: long(TEAM_LIMITS.nameMaxChars + 1) },
      { type: 'set-name', name: 7 },
      { type: 'claim-roles', roles: ['pilot'] },
      { type: 'claim-roles', roles: ['science', 'science'] },
      { type: 'add-component', componentId: '' },
      { type: 'add-component', componentId: long(TEAM_LIMITS.idMaxChars + 1) },
      { type: 'select-orbit', orbitId: 'LUNA' },
      { type: 'select-orbit' },
      { type: 'allocate-budget', allocation: { laser: 1 } },
      { type: 'allocate-budget', allocation: { payload: -1 } },
      { type: 'allocate-budget', allocation: { payload: '3' } },
      { type: 'request-resource', resource: 'gold' },
      { type: 'request-resource', resource: 'power', amount: 0 },
      { type: 'request-resource', resource: 'power', note: long(TEAM_LIMITS.noteMaxChars + 1) },
      { type: 'resolve-request', requestId: 'r1' },
      { type: 'vote', role: 'director', value: 'maybe' },
      { type: 'vote', role: 'director', value: 'no-go', reason: { code: 'other', note: 'x', extra: true } },
      { type: 'vote', role: 'director', value: 'no-go', reason: { code: 'aliens' } },
      { type: 'set-time-scale', accel: Number.NaN },
      { type: 'set-time-scale', accel: Number.POSITIVE_INFINITY },
      { type: 'set-time-scale', accel: '10' },
      { type: 'ack-alert', alertId: 'a1' },
      { type: 'ping', target: { kind: 'point', position: [0, 1] } },
      { type: 'ping', target: { kind: 'point', position: [0, 1, 1e9] } },
      { type: 'ping', target: { kind: 'resource', id: 'gold' } },
      { type: 'start-mission', now: true },
    ];
    for (const b of bad) {
      expect(teamActionSchema.safeParse(b).success, JSON.stringify(b) ?? String(b)).toBe(false);
      expect(parseTeamAction(b)).toBeNull();
    }
  });

  it('es un Standard Schema (lo que acepta Colyseus en onMessage)', () => {
    const std = (teamActionSchema as unknown as { '~standard': { version: number; validate: (v: unknown) => unknown } })['~standard'];
    expect(std.version).toBe(1);
    expect(std.validate({ type: 'request-review' })).toEqual({ value: { type: 'request-review' } });
  });
});

// ─── Vista de sala ──────────────────────────────────────────────────────────

const OK = loadDesign('ok-cubesat-leo');
const STRESS: Catalog = {
  ...catalog,
  scenarios: catalog.scenarios.map((s) => (s.id !== SCENARIO_ID ? s : {
    ...s,
    operationDays: 5,
    eventTuning: { launchDelayChance: 1, launchDelayMonths: { min: 1, max: 1 }, budgetCutChance: 1, budgetCutPct: { min: 5, max: 5 }, environmentChancePerDay: 1 },
  })),
};

/** Vista no trivial: jugadores, solicitudes, votos, No-Go, preLaunch, simulación, alertas y resultado real. */
function richView(): RoomView {
  const seed = 20260103;
  const preLaunch = rollPreLaunchEvents(OK, STRESS, seed);
  const sim = createMissionSim(OK, STRESS, { seed, preLaunch });
  const snapshot = sim.step(6 * 3600);
  const result = runMission(OK, STRESS, { seed, preLaunch });
  const action: TeamAction = { type: 'add-component', componentId: 'payload-thermal-camera' };
  const check = checkTeamAction({ phase: 'design', actorRoles: ['science'], isHost: false, design: OK, allocation: null }, action) as TeamRequestCheck;
  const auto = buildResourceRequest(check, action, { id: 'r1', fromPlayerId: 'p2', atS: 40 });
  const explicitAction: TeamAction = { type: 'request-resource', resource: 'budget', amount: 1.5, subsystem: 'payload', note: 'una cámara mejor' };
  const explicit = buildResourceRequest(
    checkTeamAction({ phase: 'design', actorRoles: ['science'], isHost: false, design: OK, allocation: null }, explicitAction) as TeamRequestCheck,
    explicitAction, { id: 'r2', fromPlayerId: 'p2', atS: 50 },
  );
  const closed = closeRequest(auto, { status: 'rejected', atS: 70, byPlayerId: 'p1', note: 'mejor otra', reason: { key: 'team.reject.componentAbsent', params: { component: 'battery-small' } } });
  const storm = result.events.find((e) => e.type === 'solar-storm') ?? { type: 'solar-storm' as const, tSeconds: 10, message: { key: 'event.solarStorm' } };
  let alert = alertForEvent(storm, 'a1', 300)!;
  alert = ackAlert(alert, { role: 'engineering', playerId: 'p1', atS: 310 });
  const collaboration = scoreCollaboration({ requests: [closed, explicit], alerts: [alert], endedAtS: 900 });
  const view = createRoomView({ roomId: 'ABCD', scenarioId: SCENARIO_ID, attempt: 3, seed });
  return {
    ...view,
    phase: 'report',
    hostId: 'p1',
    players: [
      { id: 'p1', name: 'Ada', roles: ['director', 'operations'], connected: true, isHost: true, pose: { x: 1.25, y: 0, z: -3.5, yaw: 1.5707963267948966 } },
      { id: 'p2', name: 'Grace', roles: ['engineering', 'science'], connected: false, isHost: false, pose: null },
      { id: 'p0', name: 'Ñandú 🚀', roles: [], connected: true, isHost: false, pose: { x: -0.1, y: 2, z: 0.3, yaw: -3 } },
    ],
    design: { ...OK, componentIds: [...OK.componentIds] },
    allocation: defaultAllocation(catalog.scenarios.find((s) => s.id === SCENARIO_ID)!),
    requests: [closed, explicit],
    votes: [
      { role: 'director', playerId: 'p1', value: 'go', atS: 80 },
      { role: 'science', playerId: 'p2', value: 'no-go', reason: { code: 'other', note: 'faltan datos' }, atS: 81 },
    ],
    lastNoGo: { source: 'review', issues: reviewGoNoGo(loadDesign('fail-battery-eclipse')).issues, votes: [], atS: 60 },
    preLaunch,
    sim: { accel: 100, simT: snapshot.tSeconds, snapshot, launchOk: result.launchSuccess, finished: true, paused: false },
    events: result.events.slice(0, TEAM_LIMITS.eventHistory),
    alerts: [alert],
    result,
    collaboration,
    teamScore: withCollaboration(result.score, collaboration.score),
    mascot: { trigger: 'team:vote-no-go', variant: 1, seq: 7, atS: 99 },
    chat: [
      { id: 'c1', playerId: 'p1', name: 'Ada', roles: ['director', 'operations'], text: '¿Go?', atS: 79 },
      { id: 'c2', playerId: 'p2', name: 'Grace', roles: ['engineering', 'science'], text: 'No-Go: faltan datos', atS: 80 },
    ],
  };
}

/** El estado sincronizado solo tiene primitivos, arrays de string y el mapa players de primitivos. */
function expectColyseusFriendly(wire: RoomStateWire): void {
  const primitive = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v);
  const stringArray = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string');
  for (const [key, value] of Object.entries(wire)) {
    if (key === 'players') {
      for (const p of Object.values(value as Record<string, unknown>)) {
        for (const [pk, pv] of Object.entries(p as Record<string, unknown>)) {
          expect(pk === 'roles' ? stringArray(pv) : primitive(pv), `players.${pk}`).toBe(true);
        }
      }
      continue;
    }
    expect(primitive(value) || stringArray(value), key).toBe(true);
  }
}

describe('createRoomView / encodeRoomView / decodeRoomView', () => {
  it('vista inicial: lobby, sin jugadores, diseño vacío, 1×', () => {
    const v = createRoomView({ roomId: 'R1', scenarioId: SCENARIO_ID, attempt: 0, seed: 20260101 });
    expect(v).toMatchObject({
      roomId: 'R1', scenarioId: SCENARIO_ID, phase: 'lobby', attempt: 0, seed: 20260101, hostId: null, players: [],
      design: { scenarioId: SCENARIO_ID, componentIds: [], orbitId: null, launcherId: null }, allocation: null,
      sim: { accel: 1, simT: 0, snapshot: null, launchOk: null, finished: false, paused: false },
      result: null, collaboration: null, teamScore: null, mascot: null,
    });
    expect(decodeRoomView(encodeRoomView(v))).toEqual(v);
  });

  it('el estado codificado es representable en un esquema de Colyseus', () => {
    const wire = encodeRoomView(richView());
    expectColyseusFriendly(wire);
    expect(wire.orbitId).toBe('LEO');
    expect(wire.simLaunch).toMatch(/^(success|failure)$/);
    expect(wire.players.p2).toMatchObject({ order: 1, hasPose: false, x: 0, roles: ['engineering', 'science'] });
    expect(wire.requests).toHaveLength(2);
    expect(JSON.parse(wire.requests[0]!)).toMatchObject({ id: 'r1', status: 'rejected' });
    const empty = encodeRoomView(createRoomView({ roomId: 'R', scenarioId: SCENARIO_ID, attempt: 0, seed: 1 }));
    expectColyseusFriendly(empty);
    expect(empty).toMatchObject({ hostId: '', orbitId: '', launcherId: '', allocation: '', result: '', simLaunch: '', simSnapshot: '' });
  });

  it('ida y vuelta: decode(encode(v)) es igual a v (también tras pasar por JSON, como toJSON())', () => {
    const v = richView();
    expect(v.result!.events.length).toBeGreaterThan(0);
    expect(v.preLaunch!.events.length).toBeGreaterThan(0);
    expect(decodeRoomView(encodeRoomView(v))).toEqual(v);
    expect(decodeRoomView(JSON.parse(JSON.stringify(encodeRoomView(v))))).toEqual(v);
    // El resultado decodificado sigue siendo el de runMission (paridad sala ↔ motor).
    const seed = 20260103;
    expect(decodeRoomView(encodeRoomView(v)).result).toEqual(runMission(OK, STRESS, { seed, preLaunch: rollPreLaunchEvents(OK, STRESS, seed) }));
  });

  it('ordena los jugadores por orden de llegada aunque el mapa venga desordenado', () => {
    const wire = encodeRoomView(richView());
    const reversed = Object.fromEntries(Object.entries(wire.players).reverse());
    expect(decodeRoomView({ ...wire, players: reversed }).players.map((p) => p.id)).toEqual(['p1', 'p2', 'p0']);
  });

  it('tolera entradas parciales o malformadas sin lanzar', () => {
    for (const junk of [undefined, null, 42, 'estado', [], {}, { players: 'x', requests: 'y', phase: 7 }]) {
      const v = decodeRoomView(junk);
      expect(v).toEqual(createRoomView({ roomId: '', scenarioId: '', attempt: 0, seed: 0 }));
    }
    const v = decodeRoomView({
      roomId: 'R', scenarioId: SCENARIO_ID, phase: 'warp', attempt: '3', seed: Number.NaN, hostId: 5,
      componentIds: ['battery-small', 3, null], orbitId: '', launcherId: 'launcher-colibri',
      players: { a: { name: 7, roles: ['science', 'pilot'], connected: 'yes', hasPose: true, x: 'n', y: 1 }, b: 'nope' },
      allocation: '{"payload": 3, "laser": 2, "power": -1}',
      requests: ['{roto', '"cadena"', '[1,2]', '{"id":"r1","status":"open"}', 5],
      result: '{', simLaunch: 'maybe', simAccel: Number.POSITIVE_INFINITY, simT: 120, simPaused: true, mascot: '{"trigger":"team:alert","variant":0,"seq":1,"atS":3}',
    });
    expect(v.phase).toBe('lobby');
    expect(v.attempt).toBe(0);
    expect(v.seed).toBe(0);
    expect(v.hostId).toBeNull();
    expect(v.design).toEqual({ scenarioId: SCENARIO_ID, componentIds: ['battery-small'], orbitId: null, launcherId: 'launcher-colibri' });
    expect(v.players).toEqual([{ id: 'a', name: '', roles: ['science'], connected: false, isHost: false, pose: { x: 0, y: 1, z: 0, yaw: 0 } }]);
    expect(v.allocation).toEqual({ payload: 3 });
    expect(v.requests).toEqual([{ id: 'r1', status: 'open' }]);
    expect(v.result).toBeNull();
    expect(v.sim).toEqual({ accel: 1, simT: 120, snapshot: null, launchOk: null, finished: false, paused: true });
    expect(v.mascot).toEqual({ trigger: 'team:alert', variant: 0, seq: 1, atS: 3 });
  });
});
