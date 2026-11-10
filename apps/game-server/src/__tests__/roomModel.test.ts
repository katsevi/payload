// Modelo puro de la sala: fases, permisos, solicitudes, reparto, votación, alertas, rediseño, salidas,
// chat y pings. Todo con un reloj de test (nowS) para que sea determinista.
import { describe, expect, it } from 'vitest';
import {
  catalog, checkTeamAction, createMissionSim, defaultAllocation, EVENT_RESPONSE_ROLES, getScenario, rollPreLaunchEvents, runMission,
  TEAM_LIMITS, TEAM_ROLES, type MissionDesign, type TeamAction,
} from '@payload/shared';
import { MOVE_MIN_INTERVAL_S, RoomModel } from '../roomModel';
import {
  approveAll, buildDesign, holder, launch, loadPrototypeDesign, ok, rejectKey, rejections, roomInDesign, TestClock,
} from './helpers';

const OK = loadPrototypeDesign('ok-cubesat-leo');
const SCENARIO = getScenario(OK.scenarioId);

function newRoom(over: Partial<ConstructorParameters<typeof RoomModel>[0]> = {}) {
  return new RoomModel({ roomId: 'sala-test', scenarioId: OK.scenarioId, ...over });
}

describe('creación y lobby', () => {
  it('vista inicial: lobby, intento y semilla = defaultSeed + intento (o la fijada)', () => {
    expect(newRoom().view).toMatchObject({ phase: 'lobby', attempt: 0, seed: SCENARIO.defaultSeed, hostId: null, players: [] });
    expect(newRoom({ attempt: 3 }).view).toMatchObject({ attempt: 3, seed: SCENARIO.defaultSeed + 3 });
    expect(newRoom({ attempt: 3, seed: 77 }).view).toMatchObject({ attempt: 3, seed: 77 });
    expect(() => newRoom({ scenarioId: 'no-existe' })).toThrow();
  });

  it('entrar: el primero es anfitrión, nombre saneado, máximo 4 y solo en el lobby', () => {
    const clock = new TestClock();
    const m = newRoom();
    expect(m.join('a', '  Ana\u0000 ', clock.now)).toEqual({ ok: true });
    expect(m.join('b', 'x'.repeat(40), clock.now)).toEqual({ ok: true });
    expect(m.join('c', '   ', clock.now)).toEqual({ ok: true });
    expect(m.join('a', 'otra vez', clock.now)).toEqual({ ok: false, reason: 'already-joined' });
    expect(m.join('d', 42, clock.now)).toEqual({ ok: true });
    expect(m.join('e', 'quinto', clock.now)).toEqual({ ok: false, reason: 'room-full' });
    expect(m.view.players.map((p) => [p.id, p.name, p.isHost])).toEqual([
      ['a', 'Ana', true], ['b', 'x'.repeat(TEAM_LIMITS.nameMaxChars), false], ['c', '', false], ['d', '', false],
    ]);
    expect(m.view.hostId).toBe('a');
    ok(m, 'a', { type: 'auto-assign-roles' }, clock.advance(1));
    ok(m, 'a', { type: 'start-mission' }, clock.advance(1));
    m.leave('d', clock.advance(1));
    expect(m.join('e', 'tarde', clock.now)).toEqual({ ok: false, reason: 'room-not-in-lobby' });
  });

  it('roles: reclamar (no los de otro), reparto del anfitrión y empezar exige los 4 roles cubiertos por conectados', () => {
    const clock = new TestClock();
    const m = newRoom();
    m.join('a', 'Ana', 0);
    m.join('b', 'Bea', 0);
    ok(m, 'a', { type: 'claim-roles', roles: ['science', 'director'] }, clock.advance(1));
    expect(m.player('a')!.roles).toEqual(['director', 'science']);
    expect(rejectKey(m, 'b', { type: 'claim-roles', roles: ['director'] }, clock.advance(1))).toBe('team.reject.roleTaken');
    expect(rejectKey(m, 'b', { type: 'auto-assign-roles' }, clock.advance(1))).toBe('team.reject.notHost');
    expect(rejectKey(m, 'a', { type: 'start-mission' }, clock.advance(1))).toBe('team.reject.missingRoles');
    ok(m, 'a', { type: 'auto-assign-roles' }, clock.advance(1));
    // 2 jugadores: [director, operations] + [engineering, science], respetando que Ana quería director.
    expect(m.view.players.map((p) => p.roles)).toEqual([['director', 'operations'], ['engineering', 'science']]);
    m.drop('b', clock.advance(1));
    expect(rejectKey(m, 'a', { type: 'start-mission' }, clock.advance(1))).toBe('team.reject.missingRoles');
    m.reconnect('b', clock.advance(1));
    ok(m, 'a', { type: 'start-mission' }, clock.advance(1));
    expect(m.view.phase).toBe('briefing');
  });

  it('acciones mal formadas o de un jugador desconocido', () => {
    const m = newRoom();
    m.join('a', 'Ana', 0);
    expect(rejectKey(m, 'a', { type: 'chat', text: 'x'.repeat(TEAM_LIMITS.chatMaxChars + 1) }, 1)).toBe('team.reject.invalidAction');
    expect(rejectKey(m, 'a', { type: 'add-component', componentId: 'battery-small', extra: true }, 1)).toBe('team.reject.invalidAction');
    expect(m.apply('a', { type: 'volar' }, 1)).toEqual([]);
    expect(m.apply('a', null, 1)).toEqual([]);
    expect(m.apply('nadie', { type: 'start-mission' }, 1)).toEqual([]);
  });
});

describe('permisos y fases', () => {
  it('la acción de otro rol o fuera de fase se rechaza y solo se avisa a quien actuó', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 4, clock);
    const sci = holder(m, 'science');
    const out = m.apply(sci, { type: 'select-orbit', orbitId: 'LEO' }, clock.advance(1));
    expect(out).toEqual([{ to: sci, notice: { kind: 'rejected', action: 'select-orbit', reason: { key: 'team.reject.permission', params: { role: 'director' } } } }]);
    expect(rejectKey(m, holder(m, 'engineering'), { type: 'add-component', componentId: 'payload-multispectral-basic' }, clock.advance(1))).toBe('team.reject.permission');
    expect(rejectKey(m, holder(m, 'director'), { type: 'finish-operation' }, clock.advance(1))).toBe('team.reject.phase');
    expect(rejectKey(m, sci, { type: 'vote', role: 'science', value: 'go' }, clock.advance(1))).toBe('team.reject.phase');
    expect(rejectKey(m, sci, { type: 'add-component', componentId: 'no-existe' }, clock.advance(1))).toBe('team.reject.invalidId');
    expect(m.view.design.componentIds).toEqual([]);
  });

  it('las validaciones del servidor coinciden con checkTeamAction de shared', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 4, clock);
    const actions: TeamAction[] = [
      { type: 'select-orbit', orbitId: 'GEO' }, { type: 'select-launcher', launcherId: 'launcher-albatros' },
      { type: 'add-component', componentId: 'comms-s-band' }, { type: 'redesign' }, { type: 'start-design' },
    ];
    for (const p of m.view.players) {
      for (const a of actions) {
        const expected = checkTeamAction({ phase: m.view.phase, actorRoles: p.roles, isHost: p.isHost, design: m.view.design, allocation: null }, a);
        const out = m.apply(p.id, a, clock.advance(1));
        expect(rejections(out).length > 0, `${p.roles} ${a.type}`).toBe(expected.kind === 'reject');
      }
    }
  });
});

describe('solicitudes de recursos', () => {
  function designedRoom() {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 4, clock);
    buildDesign(m, OK, clock);
    return { m, clock };
  }

  it('Ciencia monta un instrumento que aprieta la energía ⇒ solicitud a Ingeniería; aprobar encadena y termina aplicándolo', () => {
    const { m, clock } = designedRoom();
    const sci = holder(m, 'science');
    const before = m.view.design;
    const out = ok(m, sci, { type: 'add-component', componentId: 'payload-thermal-camera' }, clock.advance(1));
    expect(m.view.design).toBe(before);
    const req = m.view.requests.at(-1)!;
    expect(req).toMatchObject({ id: expect.stringMatching(/^req-\d+$/), fromPlayerId: sci, fromRole: 'science', toRole: 'engineering', resource: 'power', status: 'open' });
    expect(out).toEqual([{ to: sci, notice: { kind: 'request-created', requestId: req.id } }]);
    // Solo Ingeniería la resuelve.
    expect(rejectKey(m, sci, { type: 'resolve-request', requestId: req.id, approve: true }, clock.advance(1))).toBe('team.reject.notRequestOwner');
    // Aprobar: cadena Ingeniería (energía) → Operaciones (comms) → Dirección (calendario) → aplicada.
    const chain: string[] = [];
    for (let i = 0; i < 5; i++) {
      const open = m.view.requests.find((r) => r.status === 'open');
      if (!open) break;
      chain.push(`${open.toRole}:${open.resource}`);
      const res = ok(m, holder(m, open.toRole), { type: 'resolve-request', requestId: open.id, approve: true }, clock.advance(2));
      const next = m.view.requests.find((r) => r.status === 'open');
      if (next) expect(res).toEqual([{ to: sci, notice: { kind: 'request-created', requestId: next.id } }]);
    }
    expect(chain).toEqual(['engineering:power', 'operations:comms', 'director:time']);
    expect(m.view.design.componentIds).toEqual([...OK.componentIds, 'payload-thermal-camera']);
    expect(m.view.requests.every((r) => r.status === 'approved' && r.resolvedAtS !== undefined)).toBe(true);
  });

  it('rechazar no aplica la acción y guarda la nota; retirar solo su autor', () => {
    const { m, clock } = designedRoom();
    const sci = holder(m, 'science');
    const eng = holder(m, 'engineering');
    ok(m, sci, { type: 'add-component', componentId: 'payload-thermal-camera' }, clock.advance(1));
    const req = m.view.requests.at(-1)!;
    ok(m, eng, { type: 'resolve-request', requestId: req.id, approve: false, note: ' propón otra\tsolución ' }, clock.advance(3));
    expect(m.view.design.componentIds).toEqual(OK.componentIds);
    expect(m.view.requests.at(-1)).toMatchObject({ status: 'rejected', resolvedByPlayerId: eng, resolutionNote: 'propón otra solución', resolvedAtS: clock.now });
    expect(rejectKey(m, eng, { type: 'resolve-request', requestId: req.id, approve: true }, clock.advance(1))).toBe('team.reject.requestClosed');
    // Explícita: Ciencia pide presupuesto; solo Ciencia puede retirarla.
    ok(m, sci, { type: 'request-resource', resource: 'budget', amount: 2, note: 'más ciencia' }, clock.advance(1));
    const explicit = m.view.requests.at(-1)!;
    expect(explicit).toMatchObject({ toRole: 'director', resource: 'budget', amount: 2, note: 'más ciencia', status: 'open' });
    expect(rejectKey(m, eng, { type: 'withdraw-request', requestId: explicit.id }, clock.advance(1))).toBe('team.reject.notRequester');
    ok(m, sci, { type: 'withdraw-request', requestId: explicit.id }, clock.advance(1));
    expect(m.view.requests.at(-1)!.status).toBe('withdrawn');
  });

  it('la misma acción ya en espera no crea otra solicitud (requestPending): una solicitud, una cámara', () => {
    const { m, clock } = designedRoom();
    const sci = holder(m, 'science');
    ok(m, sci, { type: 'add-component', componentId: 'payload-thermal-camera' }, clock.advance(TEAM_LIMITS.requestMinIntervalS));
    expect(rejectKey(m, sci, { type: 'add-component', componentId: 'payload-thermal-camera' }, clock.advance(TEAM_LIMITS.requestMinIntervalS))).toBe('team.reject.requestPending');
    expect(m.view.requests.filter((r) => r.status === 'open')).toHaveLength(1);
    approveAll(m, clock);
    expect(m.view.design.componentIds.filter((c) => c === 'payload-thermal-camera')).toHaveLength(1);
  });

  it('cubeta de solicitudes por jugador: ráfaga de requestBurst, luego una cada requestMinIntervalS (requestRateLimited); las encadenadas no gastan fichas', () => {
    const { m, clock } = designedRoom();
    const sci = holder(m, 'science');
    const ops = holder(m, 'operations');
    clock.advance(TEAM_LIMITS.requestBurst * TEAM_LIMITS.requestMinIntervalS); // cubeta llena
    // Ráfaga: la cámara (solicitud automática) y requestBurst − 1 explícitas, seguidas.
    ok(m, sci, { type: 'add-component', componentId: 'payload-thermal-camera' }, clock.advance(0.1));
    for (let i = 1; i < TEAM_LIMITS.requestBurst; i++) ok(m, sci, { type: 'request-resource', resource: 'budget', amount: i }, clock.advance(0.1));
    // Sin ficha: rechazo con los segundos de espera; no se crea nada ni cambia el diseño.
    const before = m.view;
    const out = m.apply(sci, { type: 'request-resource', resource: 'power', amount: 1 }, clock.advance(0.1));
    const reason = rejections(out)[0]!.notice.reason;
    expect(reason.key).toBe('team.reject.requestRateLimited');
    expect(reason.params!.seconds).toBeGreaterThanOrEqual(1);
    expect(m.view.requests).toBe(before.requests);
    expect(m.view.design).toBe(before.design);
    // Las solicitudes encadenadas al aprobar la cámara siguen a nombre de Ciencia pero NO gastan sus fichas.
    for (let i = 0; i < 5; i++) {
      const chained = m.view.requests.find((r) => r.status === 'open' && r.action !== undefined);
      if (!chained) break;
      ok(m, holder(m, chained.toRole), { type: 'resolve-request', requestId: chained.id, approve: true }, clock.now);
    }
    expect(m.view.design.componentIds).toContain('payload-thermal-camera');
    // Cada jugador tiene su cubeta; una acción que se aplica directamente no gasta fichas.
    ok(m, ops, { type: 'request-resource', resource: 'budget', amount: 2 }, clock.now);
    ok(m, sci, { type: 'remove-component', componentId: 'payload-multispectral-basic' }, clock.now);
    // Se repone una ficha cada requestMinIntervalS; con maxOpenRequestsPerPlayer abiertas, tooManyRequests.
    const openOf = () => m.view.requests.filter((r) => r.status === 'open' && r.fromPlayerId === sci).length;
    while (openOf() < TEAM_LIMITS.maxOpenRequestsPerPlayer) {
      ok(m, sci, { type: 'request-resource', resource: 'budget', amount: 10 + openOf() }, clock.advance(TEAM_LIMITS.requestMinIntervalS));
    }
    expect(rejectKey(m, sci, { type: 'request-resource', resource: 'budget', amount: 99 }, clock.advance(TEAM_LIMITS.requestMinIntervalS))).toBe('team.reject.tooManyRequests');
    expect(openOf()).toBe(TEAM_LIMITS.maxOpenRequestsPerPlayer);
  });

  it('reparto del presupuesto (Dirección en briefing): pasarse de lo asignado pide a Dirección y aprobar sube la asignación', () => {
    const clock = new TestClock();
    const m = newRoom();
    ['a', 'b', 'c', 'd'].forEach((id) => m.join(id, id, clock.advance(1)));
    ok(m, 'a', { type: 'auto-assign-roles' }, clock.advance(1));
    ok(m, 'a', { type: 'start-mission' }, clock.advance(1));
    const dir = holder(m, 'director');
    const allocation = { ...defaultAllocation(SCENARIO), payload: 1 };
    expect(rejectKey(m, holder(m, 'science'), { type: 'allocate-budget', allocation }, clock.advance(1))).toBe('team.reject.permission');
    expect(rejectKey(m, dir, { type: 'allocate-budget', allocation: { payload: 1e5 } }, clock.advance(1))).toBe('team.reject.allocationOverBudget');
    ok(m, dir, { type: 'allocate-budget', allocation }, clock.advance(1));
    expect(m.view.allocation).toEqual(allocation);
    ok(m, dir, { type: 'start-design' }, clock.advance(1));
    const sci = holder(m, 'science');
    ok(m, sci, { type: 'add-component', componentId: 'payload-multispectral-basic' }, clock.advance(1));
    const req = m.view.requests.at(-1)!;
    expect(req).toMatchObject({ toRole: 'director', resource: 'budget', subsystem: 'payload', status: 'open' });
    expect(m.view.design.componentIds).toEqual([]);
    ok(m, dir, { type: 'resolve-request', requestId: req.id, approve: true }, clock.advance(5));
    approveAll(m, clock);
    expect(m.view.design.componentIds).toEqual(['payload-multispectral-basic']);
    expect(m.view.allocation!.payload).toBeGreaterThan(1);
    // Quitar el reparto (null) elimina los topes.
    ok(m, dir, { type: 'allocate-budget', allocation: null }, clock.advance(1));
    expect(m.view.allocation).toBeNull();
  });
});

describe('Go/No-Go compartido', () => {
  it('revisión con el motor en No-Go: sigue en diseño con los blockers', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 2, clock);
    ok(m, 'p2', { type: 'request-review' }, clock.advance(1));
    expect(m.view.phase).toBe('design');
    expect(m.view.lastNoGo).toMatchObject({ source: 'review', votes: [], atS: clock.now });
    expect(m.view.lastNoGo!.issues.length).toBeGreaterThan(0);
    expect(m.view.lastNoGo!.issues.every((i) => i.severity === 'blocker')).toBe(true);
  });

  it('un No-Go exige motivo (y nota si es "otro"); el primero válido devuelve a todos al diseño con el motivo', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 4, clock);
    buildDesign(m, OK, clock);
    ok(m, 'p1', { type: 'request-review' }, clock.advance(1));
    expect(m.view.phase).toBe('review');
    ok(m, holder(m, 'director'), { type: 'vote', role: 'director', value: 'go' }, clock.advance(1));
    const eng = holder(m, 'engineering');
    expect(rejectKey(m, eng, { type: 'vote', role: 'engineering', value: 'no-go' }, clock.advance(1))).toBe('team.reject.voteNeedsReason');
    expect(rejectKey(m, eng, { type: 'vote', role: 'engineering', value: 'no-go', reason: { code: 'other' } }, clock.advance(1))).toBe('team.reject.voteNeedsNote');
    expect(rejectKey(m, eng, { type: 'vote', role: 'engineering', value: 'no-go', reason: { code: 'other', note: '   ' } }, clock.advance(1))).toBe('team.reject.voteNeedsNote');
    expect(rejectKey(m, eng, { type: 'vote', role: 'science', value: 'go' }, clock.advance(1))).toBe('team.reject.notYourRole');
    expect(m.view.phase).toBe('review');
    expect(m.view.votes).toHaveLength(1);
    ok(m, eng, { type: 'vote', role: 'engineering', value: 'no-go', reason: { code: 'power', note: 'sin margen' } }, clock.advance(1));
    expect(m.view.phase).toBe('design');
    expect(m.view.votes).toEqual([]);
    expect(m.view.lastNoGo).toEqual({
      source: 'vote', issues: [], atS: clock.now,
      votes: [{ role: 'engineering', playerId: eng, value: 'no-go', reason: { code: 'power', note: 'sin margen' }, atS: clock.now }],
    });
    // Se puede volver a pedir la revisión: la nueva votación empieza de cero.
    ok(m, 'p3', { type: 'request-review' }, clock.advance(1));
    expect(m.view).toMatchObject({ phase: 'review', votes: [], lastNoGo: null });
  });

  it('un voto por rol: votar otra vez sustituye al anterior (no se acumulan) y cambiar a No-Go cierra la votación', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 4, clock);
    buildDesign(m, OK, clock);
    ok(m, 'p1', { type: 'request-review' }, clock.advance(1));
    const dir = holder(m, 'director');
    for (let i = 0; i < 10; i++) ok(m, dir, { type: 'vote', role: 'director', value: 'go' }, clock.advance(1));
    ok(m, holder(m, 'science'), { type: 'vote', role: 'science', value: 'go' }, clock.advance(1));
    expect(m.view.votes.map((v) => v.role)).toEqual(['director', 'science']);
    expect(m.view.votes.find((v) => v.role === 'director')!.atS).toBe(clock.now - 1); // el último voto de Dirección
    ok(m, dir, { type: 'vote', role: 'director', value: 'no-go', reason: { code: 'risk' } }, clock.advance(1));
    expect(m.view.phase).toBe('design');
    expect(m.view.lastNoGo!.votes).toHaveLength(1);
  });

  it('cuatro Go ⇒ pre-lanzamiento; con eventos la Dirección confirma; sin eventos se lanza directamente', () => {
    // Semilla con eventos pre-lanzamiento y otra sin ellos.
    const withEvents = Array.from({ length: 400 }, (_, i) => SCENARIO.defaultSeed + i).find((s) => rollPreLaunchEvents(OK, catalog, s).events.length > 0)!;
    const without = Array.from({ length: 400 }, (_, i) => SCENARIO.defaultSeed + i).find((s) => rollPreLaunchEvents(OK, catalog, s).events.length === 0)!;
    for (const seed of [withEvents, without]) {
      const clock = new TestClock();
      const m = newRoom({ seed });
      roomInDesign(m, 3, clock);
      buildDesign(m, OK, clock);
      ok(m, 'p1', { type: 'request-review' }, clock.advance(1));
      for (const role of TEAM_ROLES) ok(m, holder(m, role), { type: 'vote', role, value: 'go' }, clock.advance(1));
      expect(m.view.preLaunch).toEqual(rollPreLaunchEvents(OK, catalog, seed));
      if (seed === withEvents) {
        expect(m.view.phase).toBe('prelaunch');
        expect(m.simulation).toBeNull();
        expect(rejectKey(m, holder(m, 'engineering') === holder(m, 'director') ? 'p3' : holder(m, 'engineering'), { type: 'confirm-launch' }, clock.advance(1))).toBe('team.reject.permission');
        ok(m, holder(m, 'director'), { type: 'confirm-launch' }, clock.advance(1));
      }
      expect(m.view.phase).toBe('launch');
      // El resultado del lanzamiento sale del primer snapshot, como en solitario.
      const mirror = createMissionSim(m.view.design, catalog, { seed, preLaunch: m.view.preLaunch! });
      const first = mirror.snapshot();
      expect(m.view.events).toEqual(first.newEvents);
      expect(m.view.sim.snapshot).toEqual({ ...first, newEvents: [] });
      expect(m.view.sim.launchOk).toBe(first.newEvents.some((e) => e.type === 'launch-success'));
    }
  });
});

describe('lanzamiento y operación', () => {
  it('pasa a operación cuando todos los CONECTADOS terminan de ver el lanzamiento o a los launchScreenMaxS', () => {
    const clock = new TestClock();
    const m = newRoom({ seed: SCENARIO.defaultSeed });
    roomInDesign(m, 3, clock);
    buildDesign(m, OK, clock);
    ok(m, 'p1', { type: 'request-review' }, clock.advance(1));
    for (const role of TEAM_ROLES) ok(m, holder(m, role), { type: 'vote', role, value: 'go' }, clock.advance(1));
    if (m.view.phase === 'prelaunch') ok(m, holder(m, 'director'), { type: 'confirm-launch' }, clock.advance(1));
    expect(m.view.phase).toBe('launch');
    ok(m, 'p1', { type: 'launch-done' }, clock.advance(1));
    m.drop('p3', clock.advance(1));
    expect(m.view.phase).toBe('launch');
    m.tick(0.1, clock.advance(1));
    expect(m.view.phase).toBe('launch');
    ok(m, 'p2', { type: 'launch-done' }, clock.advance(1)); // p3 está caído: no se le espera
    expect(m.view.phase).toBe(m.view.sim.launchOk ? 'operation' : 'report');

    // Tope de tiempo: nadie manda launch-done.
    const m2 = newRoom({ seed: SCENARIO.defaultSeed });
    const c2 = new TestClock();
    roomInDesign(m2, 2, c2);
    buildDesign(m2, OK, c2);
    ok(m2, 'p1', { type: 'request-review' }, c2.advance(1));
    for (const role of TEAM_ROLES) ok(m2, holder(m2, role), { type: 'vote', role, value: 'go' }, c2.advance(1));
    if (m2.view.phase === 'prelaunch') ok(m2, holder(m2, 'director'), { type: 'confirm-launch' }, c2.advance(1));
    m2.tick(0.1, c2.advance(TEAM_LIMITS.launchScreenMaxS - 1));
    expect(m2.view.phase).toBe('launch');
    m2.tick(0.1, c2.advance(1));
    expect(m2.view.phase).not.toBe('launch');
  });

  it('lanzamiento fallido ⇒ informe directo (tras la pantalla de lanzamiento) con el resultado de runMission', () => {
    // Diseño con Go: el fallo es la tirada de fiabilidad del lanzador, así que buscamos una semilla en la que falla.
    const seed = Array.from({ length: 2000 }, (_, i) => i).find((s) => !runMission(OK, catalog, { seed: s, preLaunch: rollPreLaunchEvents(OK, catalog, s) }).launchSuccess)!;
    const clock = new TestClock();
    const m = newRoom({ seed });
    roomInDesign(m, 1, clock);
    buildDesign(m, OK, clock);
    launch(m, clock);
    expect(m.view.phase).toBe('report');
    expect(m.view.sim.launchOk).toBe(false);
    expect(m.view.result).toStrictEqual(runMission(OK, catalog, { seed, preLaunch: rollPreLaunchEvents(OK, catalog, seed) }));
  });

  /** Diseño + semilla cuya misión abre una alerta de equipo. */
  function alertCase(): { design: MissionDesign; seed: number } {
    for (let s = SCENARIO.defaultSeed; s < SCENARIO.defaultSeed + 300; s++) {
      const r = runMission(OK, catalog, { seed: s, preLaunch: rollPreLaunchEvents(OK, catalog, s) });
      if (r.launchSuccess && r.events.some((e) => EVENT_RESPONSE_ROLES[e.type])) return { design: OK, seed: s };
    }
    throw new Error('ninguna semilla abre alertas');
  }

  function roomInOperation(players: number) {
    const { design, seed } = alertCase();
    const clock = new TestClock();
    const m = newRoom({ seed });
    roomInDesign(m, players, clock);
    buildDesign(m, design, clock);
    launch(m, clock);
    expect(m.view.phase).toBe('operation');
    return { m, clock, seed };
  }

  /** Avanza a 10 000× hasta que se abre una alerta. */
  function untilAlert(m: RoomModel, clock: TestClock) {
    ok(m, holder(m, 'operations'), { type: 'set-time-scale', accel: 10000 }, clock.advance(0.1));
    for (let i = 0; i < 5000 && !m.view.alerts.some((a) => a.closedAtS === null); i++) m.tick(1, clock.advance(1));
    const alert = m.view.alerts.find((a) => a.closedAtS === null)!;
    expect(alert).toBeDefined();
    return alert;
  }

  it('una alerta pausa la simulación hasta que responden todos sus roles; luego se reanuda', () => {
    const { m, clock } = roomInOperation(4);
    const alert = untilAlert(m, clock);
    expect(alert).toMatchObject({ id: expect.stringMatching(/^alert-\d+$/), acks: [], closedAtS: null, timedOut: false, raisedAtS: clock.now });
    expect(alert.requiredRoles).toEqual(EVENT_RESPONSE_ROLES[alert.event.type]);
    expect(m.view.sim.paused).toBe(true);
    // La simulación se detiene en el trozo del evento (≤ SIM_CHUNK_S después).
    expect(m.view.sim.simT - alert.event.tSeconds).toBeLessThanOrEqual(60);
    const simT = m.view.sim.simT;
    m.tick(1, clock.advance(1));
    expect(m.view.sim.simT).toBe(simT);
    expect(m.view.sim.accel).toBe(10000); // la aceleración elegida se conserva durante la pausa
    const [first, ...rest] = alert.requiredRoles;
    const notRequired = TEAM_ROLES.find((r) => !alert.requiredRoles.includes(r))!;
    expect(rejectKey(m, holder(m, notRequired), { type: 'ack-alert', alertId: alert.id, role: notRequired }, clock.advance(1))).toBe('team.reject.alertRole');
    ok(m, holder(m, first!), { type: 'ack-alert', alertId: alert.id, role: first! }, clock.advance(2));
    expect(rejectKey(m, holder(m, first!), { type: 'ack-alert', alertId: alert.id, role: first! }, clock.advance(1))).toBe('team.reject.alertAcked');
    expect(m.view.sim.paused).toBe(true);
    for (const role of rest) ok(m, holder(m, role), { type: 'ack-alert', alertId: alert.id, role }, clock.advance(1));
    const closed = m.view.alerts.find((a) => a.id === alert.id)!;
    expect(closed).toMatchObject({ closedAtS: clock.now, timedOut: false });
    expect(m.view.sim.paused).toBe(false);
    m.tick(1, clock.advance(1));
    expect(m.view.sim.simT).toBeGreaterThan(simT);
  });

  it('una alerta sin respuesta se cierra sola a los alertTimeoutS y la colaboración lo refleja', () => {
    const { m, clock, seed } = roomInOperation(2);
    const alert = untilAlert(m, clock);
    m.tick(1, clock.advance(TEAM_LIMITS.alertTimeoutS - 2));
    expect(m.view.sim.paused).toBe(true);
    m.tick(0.1, clock.advance(2));
    expect(m.view.alerts.find((a) => a.id === alert.id)).toMatchObject({ timedOut: true, closedAtS: clock.now });
    ok(m, holder(m, 'director'), { type: 'finish-operation' }, clock.advance(1));
    expect(m.view.phase).toBe('report');
    expect(m.view.collaboration!.alertsTotal).toBeGreaterThan(0);
    expect(m.view.collaboration!.criteria.alerts).toBeLessThan(1);
    expect(m.view.teamScore!.total).toBeLessThanOrEqual(m.view.result!.score.total);
    expect(m.view.result).toStrictEqual(runMission(m.view.design, catalog, { seed, preLaunch: rollPreLaunchEvents(OK, catalog, seed) }));
  });

  it('tiempo: solo Dirección y Operaciones, y solo escalas de TEAM_TIME_SCALES; 0 = pausa', () => {
    const { m, clock } = roomInOperation(4);
    expect(rejectKey(m, holder(m, 'science'), { type: 'set-time-scale', accel: 100 }, clock.advance(1))).toBe('team.reject.permission');
    expect(rejectKey(m, holder(m, 'director'), { type: 'set-time-scale', accel: 7 }, clock.advance(1))).toBe('team.reject.timeScale');
    ok(m, holder(m, 'director'), { type: 'set-time-scale', accel: 0 }, clock.advance(1));
    const simT = m.view.sim.simT;
    const before = m.view;
    m.tick(1, clock.advance(1));
    expect(m.view.sim.simT).toBe(simT);
    // Sin cambios no hay vista nueva (nada que sincronizar), salvo la mascota.
    expect({ ...m.view, mascot: null }).toEqual({ ...before, mascot: null });
  });
});

describe('informe y rediseño', () => {
  it('redesign: intento + 1 y semilla + 1, mismo diseño, vuelve al diseño limpio', () => {
    const clock = new TestClock();
    const m = newRoom({ seed: 500 });
    roomInDesign(m, 2, clock);
    buildDesign(m, OK, clock);
    ok(m, 'p2', { type: 'chat', text: 'hola' }, clock.advance(1));
    launch(m, clock);
    if (m.view.phase === 'operation') ok(m, holder(m, 'director'), { type: 'finish-operation' }, clock.advance(1));
    expect(m.view.phase).toBe('report');
    expect(rejectKey(m, holder(m, 'engineering') === holder(m, 'director') ? 'p2' : holder(m, 'engineering'), { type: 'redesign' }, clock.advance(1))).toBe('team.reject.permission');
    ok(m, holder(m, 'director'), { type: 'redesign' }, clock.advance(1));
    expect(m.view).toMatchObject({
      phase: 'design', attempt: 1, seed: 501, requests: [], votes: [], lastNoGo: null, preLaunch: null, events: [], alerts: [],
      result: null, collaboration: null, teamScore: null, sim: { accel: 1, simT: 0, snapshot: null, launchOk: null, finished: false, paused: false },
    });
    expect(m.view.design.componentIds).toEqual(OK.componentIds);
    expect(m.view.chat).toHaveLength(1);
    expect(m.simulation).toBeNull();
    // El segundo intento también tiene paridad con su nueva semilla.
    launch(m, clock);
    if (m.view.phase === 'operation') ok(m, holder(m, 'director'), { type: 'finish-operation' }, clock.advance(1));
    expect(m.view.result).toStrictEqual(runMission(OK, catalog, { seed: 501, preLaunch: rollPreLaunchEvents(OK, catalog, 501) }));
    // Sin semilla fija: defaultSeed + intento.
    const m2 = newRoom({ attempt: 2 });
    expect(m2.view.seed).toBe(SCENARIO.defaultSeed + 2);
  });
});

describe('salidas, anfitrión y reparto de roles', () => {
  it('caída: conectado=false con roles intactos; vuelta: conectado=true', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 4, clock);
    const roles = m.player('p2')!.roles;
    m.drop('p2', clock.advance(1));
    expect(m.player('p2')).toMatchObject({ connected: false, roles });
    ok(m, holder(m, 'director'), { type: 'select-orbit', orbitId: 'LEO' }, clock.advance(1));
    m.reconnect('p2', clock.advance(1));
    expect(m.player('p2')).toMatchObject({ connected: true, roles });
  });

  it('si el anfitrión se va, el anfitrión pasa al siguiente conectado y sus roles se reparten (la misión sigue)', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 4, clock);
    expect(m.view.players.map((p) => p.roles)).toEqual([['director'], ['engineering'], ['science'], ['operations']]);
    m.drop('p2', clock.advance(1)); // p2 caído: el anfitrión debe pasar a p3, no a p2
    m.leave('p1', clock.advance(1));
    expect(m.view.hostId).toBe('p3');
    expect(m.view.players.map((p) => [p.id, p.isHost])).toEqual([['p2', false], ['p3', true], ['p4', false]]);
    // Los 4 roles siguen cubiertos sin repetir y cada uno conserva el suyo.
    const all = m.view.players.flatMap((p) => p.roles).sort();
    expect(all).toEqual([...TEAM_ROLES].sort());
    // Cada uno conserva el suyo; el caído (p2) NO recibe nada: Dirección va a un conectado (p3, el primero con menos roles).
    expect(m.player('p2')!.roles).toEqual(['engineering']);
    expect(m.player('p3')!.roles).toEqual(['director', 'science']);
    expect(m.player('p4')!.roles).toEqual(['operations']);
    // El nuevo Director puede seguir: elegir órbita.
    ok(m, holder(m, 'director'), { type: 'select-orbit', orbitId: 'LEO' }, clock.advance(1));
    // Se quedan solos: uno con los 4 roles.
    m.leave('p2', clock.advance(1));
    m.leave('p4', clock.advance(1));
    expect(m.view.players).toHaveLength(1);
    expect(m.player('p3')).toMatchObject({ isHost: true, roles: [...TEAM_ROLES] });
  });

  it('los roles de quien se va pasan SOLO a conectados: sale Dirección+Operaciones con un caído y un conectado ⇒ al conectado', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 3, clock);
    expect(m.view.players.map((p) => p.roles)).toEqual([['director', 'operations'], ['engineering'], ['science']]);
    m.drop('p2', clock.advance(1));
    m.leave('p1', clock.advance(1));
    expect(m.player('p2')).toMatchObject({ connected: false, roles: ['engineering'] });
    expect(m.player('p3')).toMatchObject({ connected: true, roles: ['director', 'science', 'operations'], isHost: true });
    // Sigue pudiendo jugarse: el conectado decide órbita y tiempo.
    ok(m, 'p3', { type: 'select-orbit', orbitId: 'LEO' }, clock.advance(1));
    // Al volver, el caído conserva lo suyo (nadie se lo quitó).
    m.reconnect('p2', clock.advance(1));
    expect(m.player('p2')!.roles).toEqual(['engineering']);
  });

  it('si no queda nadie conectado, los roles se aparcan en el más antiguo y pasan al primero que vuelva', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 4, clock);
    m.drop('p2', clock.advance(1));
    m.drop('p3', clock.advance(1));
    m.drop('p4', clock.advance(1));
    m.leave('p1', clock.advance(1)); // Dirección se va y no hay nadie conectado
    expect(m.player('p2')!.roles).toEqual(['director', 'engineering']); // aparcado en el más antiguo
    expect(m.view.players.flatMap((p) => p.roles).sort()).toEqual([...TEAM_ROLES].sort());
    m.reconnect('p3', clock.advance(1)); // vuelve otro: se lleva lo aparcado
    expect(m.player('p3')!.roles).toEqual(['director', 'science']);
    expect(m.player('p2')!.roles).toEqual(['engineering']);
    m.reconnect('p2', clock.advance(1)); // ya no hay nada aparcado
    expect(m.player('p2')!.roles).toEqual(['engineering']);
    // Y si vuelve primero el propio "aparcador", se queda con ellos.
    const m2 = newRoom();
    const c2 = new TestClock();
    roomInDesign(m2, 3, c2);
    m2.drop('p2', c2.advance(1));
    m2.drop('p3', c2.advance(1));
    m2.leave('p1', c2.advance(1));
    expect(m2.player('p2')!.roles).toEqual(['director', 'engineering', 'operations']);
    m2.reconnect('p2', c2.advance(1));
    m2.reconnect('p3', c2.advance(1));
    expect(m2.player('p2')!.roles).toEqual(['director', 'engineering', 'operations']);
    expect(m2.player('p3')!.roles).toEqual(['science']);
  });

  it('escenario de equipo: no empieza con menos de team.minPlayers conectados; tope team.maxPlayers', () => {
    const team = catalog.scenarios.find((s) => (s.team?.minPlayers ?? 1) >= 2)!;
    const m = new RoomModel({ roomId: 'equipo', scenarioId: team.id });
    m.join('a', 'A', 0);
    ok(m, 'a', { type: 'auto-assign-roles' }, 1);
    expect(rejectKey(m, 'a', { type: 'start-mission' }, 2)).toBe('team.reject.notEnoughPlayers');
    for (let i = 1; i < team.team!.minPlayers; i++) m.join(`b${i}`, 'B', 3);
    ok(m, 'a', { type: 'auto-assign-roles' }, 4);
    ok(m, 'a', { type: 'start-mission' }, 5);
    // Tope de jugadores del escenario (catálogo de prueba con maxPlayers 2).
    const small = { ...catalog, scenarios: catalog.scenarios.map((s) => (s.id === team.id ? { ...s, team: { minPlayers: 2, maxPlayers: 2 } } : s)) };
    const m2 = new RoomModel({ roomId: 'equipo2', scenarioId: team.id, catalog: small });
    expect(m2.maxPlayers).toBe(2);
    expect(m2.join('a', 'A', 0)).toEqual({ ok: true });
    expect(m2.join('b', 'B', 0)).toEqual({ ok: true });
    expect(m2.join('c', 'C', 0)).toEqual({ ok: false, reason: 'room-full' });
    expect(newRoom().maxPlayers).toBe(TEAM_LIMITS.maxPlayers);
  });

  it('en el lobby, salir libera los roles (no se reparten)', () => {
    const m = newRoom();
    m.join('a', 'A', 0);
    m.join('b', 'B', 0);
    ok(m, 'a', { type: 'auto-assign-roles' }, 1);
    m.leave('a', 2);
    expect(m.view.players).toEqual([{ id: 'b', name: 'B', roles: ['engineering', 'science'], connected: true, isHost: true, pose: null }]);
    expect(m.view.hostId).toBe('b');
  });
});

describe('chat, pings y avatares', () => {
  it('chat saneado, límite de frecuencia y solo los últimos chatHistory mensajes', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 2, clock);
    ok(m, 'p1', { type: 'chat', text: '  hola\n\nequipo​ ' }, clock.advance(1));
    expect(m.view.chat).toEqual([{ id: 'msg-1', playerId: 'p1', name: 'Jugador 1', roles: m.player('p1')!.roles, text: 'hola equipo', atS: clock.now }]);
    expect(rejectKey(m, 'p1', { type: 'chat', text: 'otra' }, clock.advance(TEAM_LIMITS.chatMinIntervalS / 2))).toBe('team.reject.rateLimited');
    ok(m, 'p2', { type: 'chat', text: 'otro jugador sí puede' }, clock.now);
    expect(rejectKey(m, 'p2', { type: 'chat', text: '\u0007 \t' }, clock.advance(5))).toBe('team.reject.emptyText');
    for (let i = 0; i < TEAM_LIMITS.chatHistory + 5; i++) ok(m, 'p1', { type: 'chat', text: `m${i}` }, clock.advance(TEAM_LIMITS.chatMinIntervalS));
    expect(m.view.chat).toHaveLength(TEAM_LIMITS.chatHistory);
    expect(m.view.chat.at(-1)!.text).toBe(`m${TEAM_LIMITS.chatHistory + 4}`);
    expect(m.view.chat[0]!.text).toBe('m5');
  });

  it('ping: aviso a todos con el rol de quien señala, con límite de frecuencia; no toca el estado', () => {
    const clock = new TestClock();
    const m = newRoom();
    roomInDesign(m, 2, clock);
    const before = m.view;
    const out = ok(m, 'p2', { type: 'ping', target: { kind: 'subsystem', id: 'power' } }, clock.advance(1));
    expect(out).toEqual([{ to: null, notice: { kind: 'ping', playerId: 'p2', role: 'engineering', target: { kind: 'subsystem', id: 'power' }, atS: clock.now } }]);
    expect(rejectKey(m, 'p2', { type: 'ping', target: { kind: 'resource', id: 'mass' } }, clock.advance(1))).toBe('team.reject.rateLimited');
    ok(m, 'p2', { type: 'ping', target: { kind: 'point', position: [1, 2, 3] } }, clock.advance(TEAM_LIMITS.pingMinIntervalS));
    expect({ ...m.view, mascot: null }).toEqual({ ...before, mascot: null });
  });

  it('move: pose validada y como mucho moveMaxHz por jugador', () => {
    const clock = new TestClock();
    const m = newRoom();
    m.join('a', 'A', 0);
    expect(m.move('a', { x: 1, y: 0, z: -2, yaw: 0.5 }, clock.advance(1))).toBe(true);
    expect(m.player('a')!.pose).toEqual({ x: 1, y: 0, z: -2, yaw: 0.5 });
    expect(m.move('a', { x: 2, y: 0, z: -2, yaw: 0.5 }, clock.advance(MOVE_MIN_INTERVAL_S / 2))).toBe(false);
    expect(m.move('a', { x: 2, y: 0, z: -2, yaw: 0.5 }, clock.advance(1 / TEAM_LIMITS.moveMaxHz))).toBe(true);
    for (const bad of [null, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0, yaw: Number.NaN }, { x: 1e9, y: 0, z: 0, yaw: 0 }, { x: 1, y: 0, z: 0, yaw: 0, extra: 1 }]) {
      expect(m.move('a', bad, clock.advance(1))).toBe(false);
    }
    expect(m.move('nadie', { x: 0, y: 0, z: 0, yaw: 0 }, clock.advance(1))).toBe(false);
  });
});
