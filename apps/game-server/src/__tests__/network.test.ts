// Tests de red: servidor Colyseus real (puerto libre) y clientes @colyseus/sdk reales en el mismo proceso.
// Criterios de aceptación de la fase 3: cuatro clientes completan una misión sin desincronizarse (y pueden
// reflejar la simulación), el resultado es idéntico al de runMission, un cliente caído vuelve y recupera el
// estado, y un No-Go exige motivo y devuelve a todos al diseño. Sin esperas fijas: `waitFor` sondea.
import { request as httpRequest } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { Client as SDKClient, MatchMakeError, type Room as SDKRoom } from '@colyseus/sdk';
import {
  catalog, createMissionSim, decodeRoomView, getScenario, rollPreLaunchEvents, runMission, TEAM_LIMITS, TEAM_ROLES,
  type MissionDesign, type RoomView, type ServerNotice, type SimEvent, type TeamAction, type TeamRole,
} from '@payload/shared';
import { MissionRoom } from '../MissionRoom';
import { createGameServer, type GameServer } from '../server';
import { loadPrototypeDesign, roleForComponent, waitFor } from './helpers';

const OK = loadPrototypeDesign('ok-cubesat-leo');
const SCENARIO_ID = OK.scenarioId;

let game: GameServer;
let endpoint: string;

beforeAll(async () => {
  game = await createGameServer({ port: 0 });
  endpoint = `http://127.0.0.1:${game.port}`;
});

afterAll(async () => {
  await game?.close();
});

// ─── Utilidades ─────────────────────────────────────────────────────────────

interface Player {
  room: SDKRoom;
  notices: ServerNotice[];
}

function track(room: SDKRoom): Player {
  const p: Player = { room, notices: [] };
  room.onMessage('notice', (n: ServerNotice) => p.notices.push(n));
  return p;
}

const sdk = () => new SDKClient(endpoint);
const viewOf = (room: SDKRoom): RoomView => decodeRoomView((room.state as { toJSON(): unknown }).toJSON());
const serverRoom = (roomId: string) => matchMaker.getLocalRoomById(roomId) as unknown as MissionRoom;
const serverView = (roomId: string): RoomView => decodeRoomView(serverRoom(roomId).state.toJSON());
const me = (p: Player) => viewOf(p.room).players.find((x) => x.id === p.room.sessionId);
const send = (p: Player, action: TeamAction) => p.room.send('action', action);

/** Todos los clientes ven exactamente lo mismo que el servidor (y el servidor, lo del modelo). */
function synced(players: readonly Player[]): boolean {
  const roomId = players[0]!.room.roomId;
  const server = serverView(roomId);
  return players.every((p) => isDeepStrictEqual(viewOf(p.room), server));
}

async function expectSynced(players: readonly Player[], what: string): Promise<RoomView> {
  await waitFor(() => synced(players), `clientes sincronizados (${what})`);
  const roomId = players[0]!.room.roomId;
  const view = serverView(roomId);
  expect(view).toEqual(serverRoom(roomId).roomModel.view);
  return view;
}

function roleHolder(players: readonly Player[], role: TeamRole): Player {
  const roomId = players[0]!.room.roomId;
  const id = serverView(roomId).players.find((x) => x.roles.includes(role))?.id;
  const p = players.find((x) => x.room.sessionId === id);
  if (!p) throw new Error(`nadie tiene el rol ${role}`);
  return p;
}

/** Abre una sala con `names.length` jugadores (el primero crea, el resto entra con el código) y llega a `design`. */
async function roomInDesign(names: string[], createOptions: Record<string, unknown>): Promise<Player[]> {
  const host = track(await sdk().create('mission', { scenarioId: SCENARIO_ID, name: names[0], ...createOptions }));
  const players = [host];
  for (const name of names.slice(1)) players.push(track(await sdk().joinById(host.room.roomId, { name })));
  await waitFor(() => players.every((p) => viewOf(p.room).players.length === names.length), 'todos en el lobby');
  send(host, { type: 'auto-assign-roles' });
  await waitFor(() => players.every((p) => (me(p)?.roles.length ?? 0) > 0), 'roles repartidos');
  send(host, { type: 'start-mission' });
  await waitFor(() => serverView(host.room.roomId).phase === 'briefing', 'briefing');
  send(roleHolder(players, 'director'), { type: 'start-design' });
  await waitFor(() => players.every((p) => viewOf(p.room).phase === 'design'), 'design');
  return players;
}

/**
 * Envía una acción y espera a que `accepted` se cumpla. Si el servidor la rechaza por frecuencia
 * (`team.reject.requestRateLimited`: el jugador gastó su ráfaga de `requestBurst` solicitudes),
 * espera medio intervalo y la reenvía; cualquier otro rechazo es un fallo del test.
 */
async function sendRetrying(p: Player, action: TeamAction, accepted: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const before = p.notices.length;
    send(p, action);
    await waitFor(() => accepted() || p.notices.slice(before).some((n) => n.kind === 'rejected'), what);
    if (accepted()) return;
    const rejection = p.notices.slice(before).find((n) => n.kind === 'rejected');
    if (rejection?.kind === 'rejected' && rejection.reason.key !== 'team.reject.requestRateLimited') throw new Error(`${what}: ${rejection.reason.key}`);
    await new Promise((r) => setTimeout(r, (TEAM_LIMITS.requestMinIntervalS * 1000) / 2));
  }
  throw new Error(`${what}: sigue limitado por frecuencia`);
}

/**
 * Hace una acción de diseño con el rol que toca y aprueba (con el rol destinatario) las solicitudes que
 * salgan, hasta que `done` se cumple. Devuelve cuántas solicitudes aprobó.
 */
async function designStep(players: Player[], role: TeamRole, action: TeamAction, done: (v: RoomView) => boolean): Promise<number> {
  const roomId = players[0]!.room.roomId;
  const before = serverView(roomId).requests.length;
  await sendRetrying(roleHolder(players, role), action, () => done(serverView(roomId)) || serverView(roomId).requests.length > before, `efecto de ${action.type}`);
  let approved = 0;
  for (let guard = 0; guard < 10; guard++) {
    const open = serverView(roomId).requests.find((r) => r.status === 'open');
    if (!open) break;
    send(roleHolder(players, open.toRole), { type: 'resolve-request', requestId: open.id, approve: true });
    await waitFor(() => serverView(roomId).requests.find((r) => r.id === open.id)?.status !== 'open', `resolver ${open.id}`);
    approved++;
  }
  await waitFor(() => done(serverView(roomId)), `diseño tras ${action.type}`);
  return approved;
}

async function buildDesign(players: Player[], design: MissionDesign): Promise<number> {
  let approved = 0;
  approved += await designStep(players, 'director', { type: 'select-orbit', orbitId: design.orbitId }, (v) => v.design.orbitId === design.orbitId);
  approved += await designStep(players, 'director', { type: 'select-launcher', launcherId: design.launcherId }, (v) => v.design.launcherId === design.launcherId);
  for (const [i, componentId] of design.componentIds.entries()) {
    const want = design.componentIds.slice(0, i + 1);
    approved += await designStep(players, roleForComponent(componentId), { type: 'add-component', componentId }, (v) => isDeepStrictEqual(v.design.componentIds, want));
  }
  return approved;
}

/** Semilla con lanzamiento correcto y, si se pide, con eventos pre-lanzamiento (para probar la confirmación). */
function seedFor(design: MissionDesign, withPreLaunch: boolean): number {
  const base = getScenario(design.scenarioId).defaultSeed;
  for (let s = base; s < base + 500; s++) {
    const pre = rollPreLaunchEvents(design, catalog, s);
    if ((pre.events.length > 0) !== withPreLaunch) continue;
    if (runMission(design, catalog, { seed: s, preLaunch: pre }).launchSuccess) return s;
  }
  throw new Error('sin semilla adecuada');
}

/** Un cliente refleja la simulación: misma MissionSim avanzada hasta simT ⇒ mismo snapshot y eventos. */
function expectMirror(view: RoomView): void {
  const sim = createMissionSim(view.design, catalog, { seed: view.seed, preLaunch: view.preLaunch! });
  const snap = sim.step(view.sim.simT);
  expect({ ...snap, newEvents: [] }).toEqual(view.sim.snapshot);
  const events: SimEvent[] = snap.newEvents;
  expect(events.slice(-view.events.length)).toEqual(view.events);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('servidor HTTP', () => {
  it('CORS: preflight y POST de emparejamiento desde otro origen (el cliente de Vite)', async () => {
    const origin = 'http://localhost:5173';
    const call = (method: string, body?: string) =>
      new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
        const req = httpRequest(`${endpoint}/matchmake/joinOrCreate/mission`, {
          method,
          headers: {
            Origin: origin,
            ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } : {}),
            ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          },
        }, (res) => {
          let data = '';
          res.on('data', (c: Buffer) => (data += c.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    const pre = await call('OPTIONS');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(origin);
    expect(String(pre.headers['access-control-allow-methods'])).toContain('POST');
    expect(String(pre.headers['access-control-allow-headers']).toLowerCase()).toContain('content-type');
    const post = await call('POST', JSON.stringify({ scenarioId: 'geo-telecom-connect', name: 'cors' }));
    expect(post.status).toBe(200);
    expect(post.headers['access-control-allow-origin']).toBe(origin);
    expect(JSON.parse(post.body)).toMatchObject({ name: 'mission', roomId: expect.any(String), sessionId: expect.any(String) });
  });

  it('opciones de creación: escenario obligatorio y válido, nunca la Academia', async () => {
    const fail = async (options: Record<string, unknown>) => {
      try {
        await sdk().create('mission', options);
      } catch (e) {
        expect(e).toBeInstanceOf(MatchMakeError);
        return (e as Error).message;
      }
      throw new Error('se esperaba un error');
    };
    expect(await fail({})).toBe('invalid-scenario');
    expect(await fail({ scenarioId: 'no-existe' })).toBe('invalid-scenario');
    expect(await fail({ scenarioId: 'academy-cubesat-leo' })).toBe('academy-scenario');
    expect(await fail({ scenarioId: SCENARIO_ID, attempt: -1 })).toBe('invalid-attempt');
  });

  it('emparejamiento por escenario, salas privadas por código y bloqueo al salir del lobby', async () => {
    const a = track(await sdk().joinOrCreate('mission', { scenarioId: 'lunar-polar-scout', name: 'A' }));
    const b = track(await sdk().joinOrCreate('mission', { scenarioId: 'mars-aurora-expedition', name: 'B' }));
    const c = track(await sdk().joinOrCreate('mission', { scenarioId: 'lunar-polar-scout', name: 'C' }));
    expect(b.room.roomId).not.toBe(a.room.roomId);
    expect(c.room.roomId).toBe(a.room.roomId);
    const [listing] = await matchMaker.query({ roomId: a.room.roomId });
    expect(listing?.metadata).toEqual({ scenarioId: 'lunar-polar-scout', phase: 'lobby', players: 2 });
    // Privada: no aparece en el emparejamiento, pero se entra con el código.
    const priv = track(await sdk().create('mission', { scenarioId: 'mars-aurora-expedition', name: 'P', private: true }));
    const d = track(await sdk().joinOrCreate('mission', { scenarioId: 'mars-aurora-expedition', name: 'D' }));
    expect(d.room.roomId).toBe(b.room.roomId);
    const e = track(await sdk().joinById(priv.room.roomId, { name: 'E' }));
    expect(e.room.roomId).toBe(priv.room.roomId);
    // Al empezar la misión la sala se bloquea: joinOrCreate abre otra y joinById falla.
    send(a, { type: 'auto-assign-roles' });
    await waitFor(() => (me(a)?.roles.length ?? 0) > 0, 'roles');
    send(a, { type: 'start-mission' });
    await waitFor(() => viewOf(c.room).phase === 'briefing', 'briefing');
    await waitFor(() => serverRoom(a.room.roomId).locked, 'sala bloqueada');
    const f = track(await sdk().joinOrCreate('mission', { scenarioId: 'lunar-polar-scout', name: 'F' }));
    expect(f.room.roomId).not.toBe(a.room.roomId);
    await expect(sdk().joinById(a.room.roomId, { name: 'G' })).rejects.toThrow();
    await Promise.all([a, b, c, d, e, f, priv].map((p) => p.room.leave()));
  });
});

describe('misión con cuatro clientes', () => {
  it('cuatro clientes completan una misión sin desincronizarse; resultado idéntico a runMission', async () => {
    const seed = seedFor(OK, true);
    const players = await roomInDesign(['Ana', 'Bea', 'Caro', 'Dani'], { seed });
    const roomId = players[0]!.room.roomId;
    expect(serverView(roomId)).toMatchObject({ seed, attempt: 0 });
    // Uno cada rol.
    expect(players.map((p) => me(p)!.roles)).toEqual(TEAM_ROLES.map((r) => [r]));

    // ── Diseño con las acciones de cada rol (aprobando lo que salga).
    await buildDesign(players, OK);
    // Solicitud automática por la red: Ciencia monta la cámara térmica ⇒ Ingeniería la rechaza con nota.
    const sci = roleHolder(players, 'science');
    const eng = roleHolder(players, 'engineering');
    send(sci, { type: 'add-component', componentId: 'payload-thermal-camera' });
    await waitFor(() => sci.notices.some((n) => n.kind === 'request-created'), 'aviso request-created');
    const req = serverView(roomId).requests.find((r) => r.status === 'open')!;
    expect(req).toMatchObject({ toRole: 'engineering', resource: 'power', fromPlayerId: sci.room.sessionId });
    send(eng, { type: 'resolve-request', requestId: req.id, approve: false, note: 'nos quedamos sin energía' });
    await waitFor(() => serverView(roomId).requests.every((r) => r.status !== 'open'), 'solicitud rechazada');
    // Explícita: Ciencia pide presupuesto a Dirección, que la aprueba.
    // (Si Ciencia ya gastó su ráfaga de solicitudes, el servidor la limita y se reintenta.)
    await sendRetrying(sci, { type: 'request-resource', resource: 'budget', amount: 1, note: 'otro instrumento' }, () => serverView(roomId).requests.some((r) => r.status === 'open'), 'solicitud explícita');
    send(roleHolder(players, 'director'), { type: 'resolve-request', requestId: serverView(roomId).requests.at(-1)!.id, approve: true });
    // Avatar y chat.
    players[1]!.room.send('move', { x: 1.5, y: 0, z: -2.25, yaw: 0.75 });
    send(players[2]!, { type: 'chat', text: '¿listos para la revisión?' });
    await waitFor(() => serverView(roomId).chat.length === 1 && serverView(roomId).players[1]!.pose !== null, 'chat y pose');
    let view = await expectSynced(players, 'tras el diseño');
    expect(view.design).toEqual(OK);
    expect(view.players[1]!.pose).toEqual({ x: 1.5, y: 0, z: -2.25, yaw: 0.75 });
    expect(view.requests.map((r) => r.status)).toContain('rejected');

    // ── Go/No-Go: los cuatro votan Go a la vez.
    send(players[3]!, { type: 'request-review' });
    await waitFor(() => serverView(roomId).phase === 'review', 'review');
    for (const p of players) send(p, { type: 'vote', role: me(p)!.roles[0]!, value: 'go' });
    await waitFor(() => serverView(roomId).phase === 'prelaunch', 'prelaunch');
    expect(serverView(roomId).preLaunch).toEqual(rollPreLaunchEvents(OK, catalog, seed));
    send(roleHolder(players, 'director'), { type: 'confirm-launch' });
    await waitFor(() => players.every((p) => viewOf(p.room).phase === 'launch'), 'launch');
    for (const p of players) send(p, { type: 'launch-done' });
    await waitFor(() => serverView(roomId).phase === 'operation', 'operation');

    // ── Operación acelerada; se responden las alertas; pausa para el punto de control.
    const director = roleHolder(players, 'director');
    send(director, { type: 'set-time-scale', accel: 10000 });
    await waitFor(() => {
      const v = serverView(roomId);
      const open = v.alerts.find((a) => a.closedAtS === null && a.acks.length === 0);
      if (open) for (const role of open.requiredRoles) send(roleHolder(players, role), { type: 'ack-alert', alertId: open.id, role });
      return v.sim.simT > 4 * 3600 && v.events.some((e) => e.type === 'eclipse-enter');
    }, 'cuatro horas de misión', 30_000);
    send(roleHolder(players, 'operations'), { type: 'set-time-scale', accel: 0 });
    await waitFor(() => serverView(roomId).sim.accel === 0, 'pausa');
    view = await expectSynced(players, 'en operación');
    expect(view.phase).toBe('operation');
    // Cada cliente refleja la simulación con seed/preLaunch/design de la vista y coincide con el servidor.
    for (const p of players) expectMirror(viewOf(p.room));

    // ── Fin de la operación ⇒ informe.
    send(director, { type: 'finish-operation' });
    await waitFor(() => serverView(roomId).phase === 'report', 'report');
    view = await expectSynced(players, 'informe');
    const expected = runMission(OK, catalog, { seed, preLaunch: rollPreLaunchEvents(OK, catalog, seed) });
    for (const p of players) expect(viewOf(p.room).result).toStrictEqual(expected);
    // El resultado completo (cientos de eventos) viaja entero por el esquema.
    expect(JSON.stringify(view.result).length).toBeGreaterThan(50_000);
    expect(view.result!.events.length).toBeGreaterThan(200);
    expect(view.collaboration).not.toBeNull();
    expect(view.teamScore).not.toBeNull();

    // ── Un cliente que vuelve en el informe recibe el estado completo (con el resultado) de golpe.
    const last = players[3]!;
    last.room.reconnection.enabled = false;
    const token = last.room.reconnectionToken;
    void last.room.leave(false);
    await waitFor(() => serverView(roomId).players.some((x) => x.id === last.room.sessionId && !x.connected), 'caída en el informe');
    const back = track(await sdk().reconnect(token));
    players[3] = back;
    await expectSynced(players, 'vuelta en el informe');
    expect(viewOf(back.room).result).toStrictEqual(expected);

    await Promise.all(players.map((p) => p.room.leave()));
  });
});

describe('reconexión', () => {
  it('un cliente caído sin consentimiento vuelve con su token y recupera roles, fase y cambios hechos mientras no estaba', async () => {
    const players = await roomInDesign(['Ana', 'Bea', 'Caro'], {});
    const roomId = players[0]!.room.roomId;
    const victim = players[1]!;
    const sessionId = victim.room.sessionId;
    const roles = me(victim)!.roles;
    expect(roles.length).toBeGreaterThan(0);
    victim.room.reconnection.enabled = false;
    const token = victim.room.reconnectionToken;
    void victim.room.leave(false); // cierre sin consentimiento ⇒ onDrop en el servidor
    await waitFor(() => viewOf(players[0]!.room).players.find((x) => x.id === sessionId)?.connected === false, 'los demás ven connected=false');
    expect(serverView(roomId).players.find((x) => x.id === sessionId)!.roles).toEqual(roles);
    // Cambios mientras está fuera.
    send(roleHolder(players, 'director'), { type: 'select-orbit', orbitId: 'LEO' });
    send(players[2]!, { type: 'chat', text: 'Bea se ha caído' });
    await waitFor(() => serverView(roomId).design.orbitId === 'LEO' && serverView(roomId).chat.length === 1, 'cambios');
    // Vuelve con el token (como hará el cliente desde sessionStorage).
    const back = track(await sdk().reconnect(token));
    expect(back.room.sessionId).toBe(sessionId);
    players[1] = back;
    const view = await expectSynced(players, 'tras reconectar');
    expect(view.players.find((x) => x.id === sessionId)).toMatchObject({ connected: true, roles });
    expect(view.phase).toBe('design');
    expect(view.design.orbitId).toBe('LEO');
    expect(view.chat.map((m) => m.text)).toEqual(['Bea se ha caído']);
    // Y puede seguir actuando con su rol.
    const role = roles[0]!;
    const component = { engineering: 'battery-small', science: 'payload-multispectral-basic', operations: 'comms-s-band', director: null }[role];
    if (component) {
      send(back, { type: 'add-component', componentId: component });
      await waitFor(() => serverView(roomId).design.componentIds.includes(component) || serverView(roomId).requests.length > 0, 'acción tras volver');
    }

    // Reconexión AUTOMÁTICA del SDK (sin intervención): cae la conexión y el SDK vuelve solo.
    const auto = players[2]!;
    auto.room.reconnection.minUptime = 0;
    auto.room.reconnection.minDelay = 20;
    auto.room.reconnection.maxDelay = 200;
    let reconnected = false;
    auto.room.onReconnect(() => (reconnected = true));
    void auto.room.leave(false);
    await waitFor(() => reconnected, 'reconexión automática');
    await waitFor(() => serverView(roomId).players.every((x) => x.connected), 'todos conectados');
    await expectSynced(players, 'tras la reconexión automática');
    await Promise.all(players.map((p) => p.room.leave()));
  });

  it('si no vuelve a tiempo, sale del todo: el anfitrión migra y sus roles se reparten entre los que quedan', async () => {
    const grace = MissionRoom.reconnectGraceS;
    MissionRoom.reconnectGraceS = 0.3;
    try {
      const players = await roomInDesign(['Ana', 'Bea', 'Caro'], {});
      const roomId = players[0]!.room.roomId;
      const host = players[0]!;
      host.room.reconnection.enabled = false;
      void host.room.leave(false); // caída del anfitrión, sin volver
      await waitFor(() => serverView(roomId).players.some((x) => x.id === host.room.sessionId && !x.connected), 'caída');
      expect(serverView(roomId).hostId).toBe(host.room.sessionId); // durante la gracia sigue siendo anfitrión
      await waitFor(() => serverView(roomId).players.length === 2, 'salida al vencer la gracia');
      const rest = players.slice(1);
      const view = await expectSynced(rest, 'tras la salida');
      expect(view.hostId).toBe(rest[0]!.room.sessionId);
      expect(view.players.map((p) => p.isHost)).toEqual([true, false]);
      expect(view.players.flatMap((p) => p.roles).sort()).toEqual([...TEAM_ROLES].sort());
      // Salida consentida del nuevo anfitrión: el último jugador se queda con los 4 roles.
      await rest[0]!.room.leave();
      await waitFor(() => serverView(roomId).players.length === 1, 'salida consentida');
      const solo = await expectSynced([rest[1]!], 'solo');
      expect(solo.players[0]).toMatchObject({ isHost: true, roles: [...TEAM_ROLES] });
      await rest[1]!.room.leave();
    } finally {
      MissionRoom.reconnectGraceS = grace;
    }
  });
});

describe('Go/No-Go por la red', () => {
  it('No-Go sin motivo (o "otro" sin nota) se rechaza solo a quien vota; con motivo devuelve a todos al diseño', async () => {
    const players = await roomInDesign(['Ana', 'Bea'], {});
    const [p1, p2] = players as [Player, Player];
    const roomId = p1.room.roomId;
    // Revisión con el motor en No-Go (diseño vacío): sigue en diseño con los blockers.
    send(p2, { type: 'request-review' });
    await waitFor(() => serverView(roomId).lastNoGo !== null, 'No-Go del motor');
    let view = await expectSynced(players, 'No-Go del motor');
    expect(view.phase).toBe('design');
    expect(view.lastNoGo!.source).toBe('review');
    expect(view.lastNoGo!.issues.length).toBeGreaterThan(0);

    await buildDesign(players, OK);
    send(p1, { type: 'request-review' });
    await waitFor(() => players.every((p) => viewOf(p.room).phase === 'review'), 'review');
    const role = me(p2)!.roles[0]!;
    send(p2, { type: 'vote', role, value: 'no-go' });
    await waitFor(() => p2.notices.some((n) => n.kind === 'rejected'), 'rechazo sin motivo');
    send(p2, { type: 'vote', role, value: 'no-go', reason: { code: 'other' } });
    await waitFor(() => p2.notices.filter((n) => n.kind === 'rejected').length === 2, 'rechazo sin nota');
    expect(p2.notices.filter((n) => n.kind === 'rejected')).toEqual([
      { kind: 'rejected', action: 'vote', reason: { key: 'team.reject.voteNeedsReason' } },
      { kind: 'rejected', action: 'vote', reason: { key: 'team.reject.voteNeedsNote' } },
    ]);
    // Ida y vuelta de p1 (chat) para asegurar que, si le hubiera llegado algún rechazo, ya estaría aquí.
    send(p1, { type: 'chat', text: 'sigo aquí' });
    await waitFor(() => viewOf(p1.room).chat.length === 1, 'chat de p1');
    expect(p1.notices.filter((n) => n.kind === 'rejected')).toEqual([]);
    expect(serverView(roomId).phase).toBe('review');

    send(p2, { type: 'vote', role, value: 'no-go', reason: { code: 'mass', note: 'vamos justos' } });
    await waitFor(() => players.every((p) => viewOf(p.room).phase === 'design'), 'todos vuelven al diseño');
    view = await expectSynced(players, 'No-Go votado');
    expect(view.lastNoGo).toMatchObject({ source: 'vote', votes: [{ role, value: 'no-go', reason: { code: 'mass', note: 'vamos justos' }, playerId: p2.room.sessionId }] });
    expect(view.votes).toEqual([]);
    await Promise.all(players.map((p) => p.room.leave()));
  });
});
