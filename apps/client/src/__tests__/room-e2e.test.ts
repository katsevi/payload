// Integración REAL de la capa de red del cliente (fase 3): servidor Colyseus de apps/game-server en un puerto
// libre + la APP (createPrivateRoom/RoomSession con el cliente SDK por defecto, stores reales) + 3 clientes
// @colyseus/sdk. Juega una misión completa: roles, diseño con solicitudes aprobadas, No-Go sin motivo
// rechazado, votación Go, lanzamiento, operación acelerada con alertas respondidas, reconexión de la app
// tras cortar su socket, informe con paridad `runMission`. Sin esperas fijas: `waitFor` sondea.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  catalog, createMissionSim, decodeRoomView, EVENT_RESPONSE_ROLES, getScenario, rollPreLaunchEvents, ROLE_SUBSYSTEMS, runMission,
  TEAM_ROLES,
  type MissionDesign, type RoomView, type ServerNotice, type TeamAction, type TeamRole,
} from '@payload/shared';
import okDesignJson from '../../../../prototype/designs/ok-cubesat-leo.json';
import { missionMachine } from '../app/missionMachine';
import {
  configureNet, createPrivateRoom, currentRoomSession, dismissRetry, joinRoomByCode, leaveRoom, resetNetConfig, TOKEN_KEY, type RoomSession,
} from '../net/roomSession';
import { useRoom, type ConnectionStatus } from '../net/roomStore';
import { getSession, useSession } from '../net/sessionStore';
import { useDesign } from '../state/design';
import { getLiveSnapshot, mirrorInfo, snapshotDiff, useSim } from '../state/sim';
import { useUi } from '../state/ui';

// El servidor se importa en tiempo de ejecución (ruta en variable): así tsc del cliente no comprueba sus
// fuentes de Node, y Vite resuelve sus dependencias desde apps/game-server/node_modules.
const SERVER_MODULE = new URL('../../../game-server/src/server.ts', import.meta.url).href;
interface GameServerHandle {
  port: number;
  close(): Promise<void>;
}

const DESIGN = okDesignJson as MissionDesign;
const SCENARIO = getScenario(DESIGN.scenarioId);

/**
 * Semilla con lanzamiento correcto y una alerta de equipo pronto (para no alargar la operación); si se
 * puede, también con eventos pre-lanzamiento (así se prueba la confirmación de la Dirección).
 */
function pickSeed(): { seed: number; alertAtS: number } {
  let fallback: { seed: number; alertAtS: number } | null = null;
  for (let s = SCENARIO.defaultSeed; s < SCENARIO.defaultSeed + 3000; s++) {
    const pre = rollPreLaunchEvents(DESIGN, catalog, s);
    const sim = createMissionSim(DESIGN, catalog, { seed: s, preLaunch: pre });
    if (!sim.snapshot().newEvents.some((e) => e.type === 'launch-success')) continue;
    const alert = sim.step(8 * 3600).newEvents.find((e) => EVENT_RESPONSE_ROLES[e.type]);
    if (!alert) continue;
    if (pre.events.length > 0) return { seed: s, alertAtS: alert.tSeconds };
    fallback ??= { seed: s, alertAtS: alert.tSeconds };
  }
  if (!fallback) throw new Error('sin semilla adecuada para la prueba');
  return fallback;
}

async function waitFor(what: string, cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Bot {
  room: SdkRoom;
  notices: ServerNotice[];
}

let game: GameServerHandle | null = null;
let url = '';
const bots: Bot[] = [];
const storage = new Map<string, string>();

const app = () => useRoom.getState();
const appView = (): RoomView => useRoom.getState().view!;
const session = (): RoomSession => currentRoomSession()!;
const viewOf = (room: SdkRoom): RoomView => decodeRoomView((room.state as { toJSON(): unknown }).toJSON());
const designKey = (d: MissionDesign) => JSON.stringify([d.scenarioId, d.componentIds, d.orbitId, d.launcherId]);

/** Quién tiene el rol: la app o un bot. */
function holderOf(role: TeamRole): 'app' | Bot {
  const id = appView().players.find((p) => p.roles.includes(role))?.id;
  if (id === app().myId) return 'app';
  const bot = bots.find((b) => b.room.sessionId === id);
  if (!bot) throw new Error(`nadie tiene el rol ${role}`);
  return bot;
}

/** La app actúa por su sesión (las mismas operaciones que usa la UI); los bots, con el SDK. */
function act(role: TeamRole, action: TeamAction): void {
  const holder = holderOf(role);
  if (holder !== 'app') {
    holder.room.send('action', action);
    return;
  }
  const s = session();
  switch (action.type) {
    case 'add-component':
      s.addComponent(action.componentId);
      break;
    case 'select-orbit':
      s.selectOrbit(action.orbitId);
      break;
    case 'select-launcher':
      s.selectLauncher(action.launcherId);
      break;
    case 'resolve-request':
      s.resolveRequest(action.requestId, action.approve, action.note);
      break;
    case 'ack-alert':
      s.ackAlert(action.alertId, action.role);
      break;
    case 'set-time-scale':
      s.setTimeScale(action.accel);
      break;
    case 'confirm-launch':
      s.confirmLaunch();
      break;
    case 'finish-operation':
      s.finishOperation();
      break;
    default:
      s.send(action);
  }
}

const roleForComponent = (componentId: string): TeamRole => {
  const sub = catalog.components.find((c) => c.id === componentId)!.subsystem;
  return TEAM_ROLES.find((r) => ROLE_SUBSYSTEMS[r].includes(sub))!;
};

/** Hace una acción de diseño con el rol que toca y aprueba (con el rol dueño) las solicitudes que salgan. */
async function designStep(role: TeamRole, action: TeamAction, done: (v: RoomView) => boolean, approved: string[]): Promise<void> {
  const before = appView().requests.length;
  act(role, action);
  await waitFor(`efecto de ${action.type}`, () => done(appView()) || appView().requests.length > before);
  for (let guard = 0; guard < 10; guard++) {
    const open = appView().requests.find((r) => r.status === 'open');
    if (!open) break;
    act(open.toRole, { type: 'resolve-request', requestId: open.id, approve: true });
    await waitFor(`resolver ${open.id}`, () => appView().requests.find((r) => r.id === open.id)?.status !== 'open');
    approved.push(open.toRole);
  }
  await waitFor(`diseño tras ${action.type}`, () => done(appView()));
}

beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ SERVER_MODULE)) as { createGameServer(o: { port: number }): Promise<GameServerHandle> };
  game = await mod.createGameServer({ port: 0 });
  url = `ws://localhost:${game.port}`;
  // La app usa el cliente SDK por defecto (import diferido); solo cambian la URL y el almacenamiento.
  configureNet({
    url: () => url,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v), removeItem: (k) => void storage.delete(k) },
  });
  const actor = createActor(missionMachine).start();
  useSession.getState().local.bind((e) => actor.send(e));
}, 30_000);

afterAll(async () => {
  await leaveRoom();
  dismissRetry();
  await Promise.all(bots.map((b) => b.room.leave().catch(() => undefined)));
  await game?.close();
  resetNetConfig();
  useSession.getState().local.bind(null);
}, 30_000);

describe('sala real: la app + 3 clientes SDK contra el servidor de juego', () => {
  it('juega una misión completa: diseño con solicitudes, votación, operación con alertas, reconexión e informe idéntico a runMission', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { seed, alertAtS } = pickSeed();

    // ── Lobby: la app crea la sala privada; tres jugadores entran con el código.
    expect(await createPrivateRoom({ scenarioId: DESIGN.scenarioId, name: 'Ana', seed })).toBe(true);
    await waitFor('vista del lobby en la app', () => app().view?.phase === 'lobby');
    expect(app()).toMatchObject({ status: 'connected', isHost: true });
    expect(appView().seed).toBe(seed); // el servidor acepta `seed` en NODE_ENV=test
    const code = app().roomCode!;
    expect(storage.get(TOKEN_KEY)).toBeTruthy();
    for (const name of ['Beto', 'Caro', 'Dani']) {
      const room = await new Client(url).joinById(code, { name });
      const bot: Bot = { room, notices: [] };
      room.onMessage('notice', (n: ServerNotice) => bot.notices.push(n));
      bots.push(bot);
    }
    await waitFor('4 jugadores', () => appView().players.length === 4);
    session().autoAssignRoles();
    await waitFor('roles repartidos', () => appView().players.every((p) => p.roles.length === 1));
    expect(app().myRoles.length).toBe(1);
    session().startMission();
    await waitFor('briefing', () => appView().phase === 'briefing');
    act('director', { type: 'start-design' });
    await waitFor('design', () => appView().phase === 'design');

    // ── Diseño: cada pieza la monta su rol; las solicitudes las aprueba el dueño del recurso.
    const approved: string[] = [];
    await designStep('director', { type: 'select-orbit', orbitId: DESIGN.orbitId }, (v) => v.design.orbitId === DESIGN.orbitId, approved);
    await designStep('director', { type: 'select-launcher', launcherId: DESIGN.launcherId }, (v) => v.design.launcherId === DESIGN.launcherId, approved);
    for (const [i, componentId] of DESIGN.componentIds.entries()) {
      const want = JSON.stringify(DESIGN.componentIds.slice(0, i + 1));
      await designStep(roleForComponent(componentId), { type: 'add-component', componentId }, (v) => JSON.stringify(v.design.componentIds) === want, approved);
    }
    // Solicitud explícita de Ciencia a Dirección (presupuesto), aprobada.
    const explicitBefore = appView().requests.length;
    act('science', { type: 'request-resource', resource: 'budget', amount: 1, note: 'margen para el instrumento' });
    await waitFor('solicitud explícita', () => appView().requests.length > explicitBefore);
    const explicit = appView().requests.at(-1)!;
    expect(explicit).toMatchObject({ status: 'open', toRole: 'director', resource: 'budget' });
    act('director', { type: 'resolve-request', requestId: explicit.id, approve: true });
    await waitFor('solicitud aprobada', () => appView().requests.find((r) => r.id === explicit.id)?.status === 'approved');
    approved.push('director');
    expect(approved.length).toBeGreaterThan(0);
    expect(appView().design).toEqual(DESIGN);
    expect(useDesign.getState().design()).toEqual(DESIGN); // la app refleja el diseño de la sala en su store
    for (const b of bots) await waitFor('bots con el mismo diseño', () => designKey(viewOf(b.room).design) === designKey(DESIGN));

    // ── Revisión: un No-Go sin motivo se rechaza (a un bot y a la app); luego todos votan Go.
    session().requestReview();
    await waitFor('review', () => appView().phase === 'review');
    const beto = bots[0]!;
    const betoRole = appView().players.find((p) => p.id === beto.room.sessionId)!.roles[0]!;
    beto.room.send('action', { type: 'vote', role: betoRole, value: 'no-go' });
    await waitFor('rechazo al bot', () => beto.notices.some((n) => n.kind === 'rejected' && n.action === 'vote'));
    expect(beto.notices.find((n) => n.kind === 'rejected')).toMatchObject({ reason: { key: 'team.reject.voteNeedsReason' } });
    session().vote(app().myRoles[0]!, 'no-go');
    await waitFor('rechazo a la app', () => app().lastRejected?.action === 'vote');
    expect(app().lastRejected!.reason.key).toBe('team.reject.voteNeedsReason');
    expect(useUi.getState().notice?.ref?.key).toBe('team.reject.voteNeedsReason');
    expect(appView().phase).toBe('review');
    session().launch(); // vota Go por los roles de la app
    for (const b of bots) {
      const role = appView().players.find((p) => p.id === b.room.sessionId)!.roles[0]!;
      b.room.send('action', { type: 'vote', role, value: 'go' });
    }
    await waitFor('prelaunch o launch', () => appView().phase === 'prelaunch' || appView().phase === 'launch');
    if (appView().phase === 'prelaunch') {
      expect(useSim.getState().preLaunch).toEqual(appView().preLaunch);
      act('director', { type: 'confirm-launch' });
    }

    // ── Lanzamiento: la app refleja la simulación con la semilla de la SALA.
    await waitFor('launch', () => appView().phase === 'launch');
    await waitFor('simulación reflejada', () => mirrorInfo() !== null && useSim.getState().launchOk === true);
    expect(useSim.getState().seed).toBe(seed);
    session().launchDone();
    for (const b of bots) b.room.send('action', { type: 'launch-done' });
    await waitFor('operation', () => appView().phase === 'operation');

    // ── Operación a 10 000×: se responden las alertas; el espejo local nunca pasa del simT del servidor.
    act('director', { type: 'set-time-scale', accel: 10000 });
    const acked = new Set<string>();
    let maxAheadS = Number.NEGATIVE_INFINITY;
    await waitFor('operación pasada la primera alerta respondida', () => {
      const v = appView();
      for (const a of v.alerts) {
        if (a.closedAtS !== null) continue;
        for (const role of a.requiredRoles) {
          const key = `${a.id}:${role}`;
          if (a.acks.some((k) => k.role === role) || acked.has(key)) continue;
          acked.add(key);
          act(role, { type: 'ack-alert', alertId: a.id, role });
        }
      }
      useSim.getState().tick(0.05);
      const live = getLiveSnapshot();
      if (live) maxAheadS = Math.max(maxAheadS, live.tSeconds - v.sim.simT);
      return v.alerts.some((a) => a.closedAtS !== null && !a.timedOut) && v.sim.simT >= alertAtS + 1800;
    }, 30_000);
    expect(maxAheadS).toBeLessThanOrEqual(1e-6);
    const answered = appView().alerts.find((a) => a.closedAtS !== null && !a.timedOut)!;
    expect(answered.acks.map((k) => k.role).sort()).toEqual([...answered.requiredRoles].sort());

    // Pausa (Dirección): el espejo alcanza el instante del servidor y su snapshot coincide.
    act('director', { type: 'set-time-scale', accel: 0 });
    await waitFor('pausa', () => appView().sim.accel === 0);
    await waitFor('espejo = servidor en el mismo simT', () => {
      useSim.getState().tick(0.05);
      const live = getLiveSnapshot();
      const srv = appView().sim.snapshot;
      return !!live && !!srv && Math.abs(live.tSeconds - srv.tSeconds) < 1e-6 && snapshotDiff(live, srv).length === 0 &&
        useSim.getState().snapshot === live;
    });
    expect(getLiveSnapshot()!.tSeconds).toBeLessThanOrEqual(appView().sim.simT + 1e-6);
    const serverEvents = appView().events;
    const localEvents = useSim.getState().events.map(({ id: _id, ...e }) => e);
    expect(localEvents.slice(-serverEvents.length)).toEqual(serverEvents);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('desincronización'))).toEqual([]);

    // ── Reconexión de la app: se corta su socket (sin `leave()`) y el SDK vuelve solo.
    const before = { myId: app().myId, roles: [...app().myRoles], phase: appView().phase, design: appView().design };
    const statuses: ConnectionStatus[] = [];
    const unsub = useRoom.subscribe((s, p) => {
      if (s.status !== p.status) statuses.push(s.status);
    });
    const live = session();
    const raw = live.room.raw as SdkRoom;
    raw.connection.close();
    await waitFor('la app reconecta sola', () => statuses.includes('reconnecting') && app().status === 'connected', 20_000);
    await waitFor('todos conectados', () => appView().players.every((p) => p.connected));
    unsub();
    expect(currentRoomSession()).toBe(live); // la misma sesión: no se volvió al menú
    expect(getSession().kind).toBe('room');
    expect(app().myId).toBe(before.myId);
    expect([...app().myRoles]).toEqual(before.roles);
    expect(appView().phase).toBe(before.phase);
    expect(appView().design).toEqual(before.design);
    expect(useDesign.getState().design()).toEqual(DESIGN);
    expect(app().retry).toBeNull();
    await waitFor('token renovado en sessionStorage', () => storage.get(TOKEN_KEY) === raw.reconnectionToken);

    // ── Informe: el result de la sala es idéntico a runMission y al que ven los demás.
    act('director', { type: 'finish-operation' });
    await waitFor('informe con resultado', () => appView().phase === 'report' && appView().result !== null, 30_000);
    for (const b of bots) await waitFor('informe en los bots', () => viewOf(b.room).result !== null, 30_000);
    const v = appView();
    const expected = runMission(v.design, catalog, { seed: v.seed, ...(v.preLaunch ? { preLaunch: v.preLaunch } : {}) });
    expect(v.result).toStrictEqual(expected);
    expect(useSim.getState().result).toStrictEqual(expected);
    for (const b of bots) expect(viewOf(b.room).result).toStrictEqual(expected);
    expect(v.collaboration).not.toBeNull();
    expect(v.collaboration!.requestsTotal).toBeGreaterThan(0);
    expect(v.collaboration!.alertsTotal).toBeGreaterThan(0);
    expect(v.teamScore).not.toBeNull();

    // ── Salir: la app vuelve al solitario y borra el token.
    await leaveRoom();
    expect(app()).toMatchObject({ status: 'idle', view: null, retry: null });
    expect(storage.has(TOKEN_KEY)).toBe(false);
    warn.mockRestore();
  }, 60_000);
});

describe('sala real: entrar con la sala bloqueada (N2)', () => {
  const open: SdkRoom[] = [];
  const host = async (): Promise<SdkRoom> => {
    const room = await new Client(url).create('mission', { scenarioId: DESIGN.scenarioId, name: 'Host', private: true });
    open.push(room);
    return room;
  };
  const hostView = (r: SdkRoom): RoomView => {
    try {
      return viewOf(r);
    } catch {
      return { players: [], phase: 'lobby' } as unknown as RoomView; // el estado aún no llegó
    }
  };

  it('un 5.º jugador en una sala de 4 recibe room.error.locked', async () => {
    await leaveRoom();
    const h = await host();
    for (const name of ['B', 'C', 'D']) open.push(await new Client(url).joinById(h.roomId, { name }));
    await waitFor('4 jugadores', () => hostView(h).players.length === 4);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await joinRoomByCode(h.roomId, { name: 'Quinto' })).toBe(false);
    expect(app().error).toMatchObject({ key: 'room.error.locked' });
    expect(useUi.getState().notice).toMatchObject({ tone: 'bad', key: 'room.error.locked' });
  }, 30_000);

  it('quien entra con la misión ya empezada recibe room.error.locked; un código inexistente, notFound', async () => {
    const h = await host();
    h.send('action', { type: 'auto-assign-roles' });
    await waitFor('roles', () => (hostView(h).players[0]?.roles.length ?? 0) === 4);
    h.send('action', { type: 'start-mission' });
    await waitFor('briefing', () => hostView(h).phase === 'briefing');
    expect(await joinRoomByCode(h.roomId, { name: 'Tarde' })).toBe(false);
    expect(app().error).toMatchObject({ key: 'room.error.locked' });
    expect(await joinRoomByCode('no-existe', { name: 'X' })).toBe(false);
    expect(app().error).toMatchObject({ key: 'room.error.notFound' });
  }, 30_000);

  afterAll(async () => {
    await Promise.all(open.map((r) => r.leave().catch(() => undefined)));
  });
});
