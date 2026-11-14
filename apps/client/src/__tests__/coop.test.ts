// Cooperativo (fase 6): la sesión de sala del cliente contra una sala real del servidor EN MEMORIA
// (el modelo puro `RoomModel`, sin red): lobby, espejo de la partida, validación local, envío por lotes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { designEditsBetween, getNode, NET, type LobbyView, type RunAction } from '@payload/shared';
import { referenceDesign } from '../../../../packages/shared/src/__tests__/missionFixtures';
import { sharedLaunchCheck } from '../ui/CoopScreen';
import { RoomModel } from '../../../game-server/src/roomModel';
import { myCrew } from '../game/me';
import { effectiveRulesOf } from '../game/effective';
import { getRun, isRemote, useGame } from '../game/runStore';
import { configureCoop, createRoom, FLUSH_INTERVAL_MS, joinRoom, leaveRoom, sendLobby, type ClientLike, type RoomLike } from '../net/coopSession';
import { mePlayer, useCoop } from '../net/coopStore';

/** Servidor de mentira: una `RoomModel` y, por cliente, una `RoomLike` que entrega los mensajes al instante. */
class FakeServer {
  model = new RoomModel({ code: 'ABCD', nextSeed: () => 7 });
  nowS = 0;
  private clients = new Map<string, Map<string, (payload: never) => void>>();
  private leaveCbs = new Map<string, (code: number) => void>();
  sent: { id: string; type: string; payload: unknown }[] = [];

  private emit(id: string | null, type: string, payload: unknown): void {
    for (const [cid, handlers] of this.clients) if (id === null || id === cid) handlers.get(type)?.(JSON.parse(JSON.stringify(payload)) as never);
  }

  private lobby(): void {
    this.emit(null, NET.lobby, this.model.view);
  }

  connect(id: string, name: string): RoomLike {
    const joined = this.model.join(id, name);
    if (!joined.ok) throw new Error(joined.code);
    const handlers = new Map<string, (payload: never) => void>();
    this.clients.set(id, handlers);
    return {
      roomId: this.model.code,
      sessionId: id,
      send: (type, payload) => {
        this.sent.push({ id, type, payload });
        if (type === NET.lobby) {
          const before = this.model.view;
          if (!this.model.lobby(id, payload)) return;
          this.lobby();
          if (this.model.view.phase === 'playing' && (before.phase !== 'playing' || before.runId !== this.model.view.runId)) this.emit(null, NET.state, this.model.stateMessage());
        } else if (type === NET.action) {
          const rejected = this.model.action(id, payload, this.nowS);
          if (rejected) this.emit(id, NET.result, rejected);
        }
      },
      onMessage: (type, cb) => {
        handlers.set(type, cb);
        // Como el servidor real: quien entra recibe el lobby en cuanto puede escucharlo.
        if (type === NET.lobby) this.lobby();
      },
      onLeave: (cb) => void this.leaveCbs.set(id, cb),
      leave: async () => {
        this.model.leave(id);
        this.clients.delete(id);
        this.lobby();
      },
    };
  }

  /** Avanza el servidor y difunde como `CrewRoom.tick`. */
  tick(dt = 0.1): void {
    this.nowS += dt;
    const { events, stepped } = this.model.advance(dt);
    if (stepped) this.emit(null, NET.state, this.model.stateMessage());
    if (events.length) this.emit(null, NET.events, events);
  }

  kick(id: string): void {
    this.leaveCbs.get(id)?.(4000);
  }

  actions(id: string): RunAction[] {
    return this.sent.filter((m) => m.id === id && m.type === NET.action).map((m) => (m.payload as { action: RunAction }).action);
  }
}

let server: FakeServer;
const client: ClientLike = {
  create: async (_room, options) => server.connect('me', String(options?.name ?? '')),
  joinById: async (code, options) => {
    if (code !== server.model.code) throw new Error('room "x" not found');
    return server.connect('me', String(options?.name ?? ''));
  },
};
const flushMicrotasks = (): Promise<void> => Promise.resolve().then(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
  server = new FakeServer();
  configureCoop(() => client);
});

afterEach(async () => {
  await leaveRoom();
  useGame.getState().toMenu();
  useCoop.setState({ error: null });
  vi.useRealTimers();
});

/** Yo creo la sala; entra «otro» (jugador del servidor, sin cliente) ya listo y con rol de explorador. */
async function lobbyOfTwo(): Promise<void> {
  expect(await createRoom('  Ana ')).toBe(true);
  await flushMicrotasks();
  server.model.join('otro', 'Beto');
  server.model.lobby('otro', { type: 'set-role', role: 'explorer' });
  server.model.lobby('otro', { type: 'set-ready', ready: true });
}

describe('sesión de sala del cliente', () => {
  it('crea una sala, ve el lobby y elige rol', async () => {
    await lobbyOfTwo();
    expect(useCoop.getState()).toMatchObject({ status: 'connected', myId: 'me', error: null });
    expect(useCoop.getState().lobby?.code).toBe('ABCD');
    sendLobby({ type: 'set-role', role: 'engineer' });
    const view = useCoop.getState().lobby as LobbyView;
    expect(view.players.map((p) => [p.name, p.role])).toEqual([['Ana', 'engineer'], ['Beto', 'explorer']]);
    expect(mePlayer(useCoop.getState())).toMatchObject({ host: true, crewId: null });
    expect(useGame.getState().screen).toBe('menu');
  });

  it('un código mal escrito o inexistente no entra', async () => {
    expect(await joinRoom('AB', 'Ana')).toBe(false);
    expect(useCoop.getState().error).toBe('not-found');
    expect(await joinRoom('ZZZZ', 'Ana')).toBe(false);
    expect(useCoop.getState()).toMatchObject({ status: 'idle', lobby: null, error: 'not-found' });
  });

  it('al empezar refleja la partida del servidor y sabe quién soy', async () => {
    await lobbyOfTwo();
    sendLobby({ type: 'set-role', role: 'engineer' });
    sendLobby({ type: 'start' });
    expect(useGame.getState().screen).toBe('game');
    expect(isRemote()).toBe(true);
    const run = getRun()!;
    expect(run.snapshot()).toEqual(server.model.run!.snapshot());
    expect(myCrew(run.state)).toMatchObject({ id: 1, role: 'engineer' });
    // El tiempo lo lleva el servidor: `tick` local no avanza nada.
    useGame.getState().tick(5);
    expect(run.state.stats.timeS).toBe(0);
    server.tick();
    server.tick();
    expect(run.state.stats.timeS).toBeCloseTo(0.2, 9);
    expect(useGame.getState().hud?.stats.timeS).toBeCloseTo(0.2, 9);
    // Las consultas del espejo dan lo mismo que el servidor.
    const link = getNode(run.state.sector, run.state.locationId)!.links[0]!;
    expect(run.estimateJump(link)).toEqual(server.model.run!.estimateJump(link));
    expect(run.stationQuote()).toEqual(server.model.run!.stationQuote());
  });

  it('una acción se valida aquí, se envía y el estado solo cambia cuando lo dice el servidor', async () => {
    await lobbyOfTwo();
    sendLobby({ type: 'start' });
    const run = getRun()!;
    const toId = getNode(run.state.sector, run.state.locationId)!.links[0]!;
    expect(useGame.getState().act({ type: 'jump', toId }).ok).toBe(true);
    expect(run.state.phase).toBe('docked'); // aún no lo ha dicho el servidor
    expect(server.model.run!.state.phase).toBe('transit');
    server.tick();
    expect(run.state.phase).toBe('transit');
    expect(useGame.getState().toasts).toEqual([]); // el evento `jump` no da aviso de texto
    // Un rechazo local no se envía y avisa.
    const sentBefore = server.actions('me').length;
    expect(useGame.getState().act({ type: 'jump', toId }).ok).toBe(false);
    expect(server.actions('me')).toHaveLength(sentBefore);
    expect(useGame.getState().toasts.at(-1)?.message.key).toBe('reject.inTransit');
  });

  it('el trabajo mantenido y la posición salen agrupados, no un mensaje por frame', async () => {
    await lobbyOfTwo();
    sendLobby({ type: 'start' });
    const game = useGame.getState();
    const run = getRun()!;
    game.act({ type: 'jump', toId: getNode(run.state.sector, run.state.locationId)!.links[0]! });
    for (let i = 0; i < 6000 && run.state.incidents.length === 0 && run.state.phase !== 'docked'; i++) server.tick();
    const inc = run.state.incidents[0];
    if (!inc) return; // semilla sin averías en este salto
    const before = server.actions('me').length;
    // 12 frames de 1/60 s manteniendo la reparación.
    for (let i = 0; i < 12; i++) game.act({ type: 'work-incident', incidentId: inc.id, seconds: 1 / 60 }, true);
    expect(server.actions('me')).toHaveLength(before);
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS + 1);
    const sent = server.actions('me').slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'work-incident', incidentId: inc.id });
    expect((sent[0] as { seconds: number }).seconds).toBeCloseTo(0.2, 6);
  });

  it('la ventaja de mi rol se ve en mis reglas (mochila del explorador)', async () => {
    expect(await createRoom('Ana')).toBe(true);
    await flushMicrotasks();
    sendLobby({ type: 'set-role', role: 'explorer' });
    sendLobby({ type: 'start' });
    const state = getRun()!.state;
    const base = getRun()!.effectiveSurfaceRules();
    expect(effectiveRulesOf(state).suit.carryCapacityKg).toBeGreaterThan(base.suit.carryCapacityKg);
    expect(effectiveRulesOf(state).jetpack.drainPctPerS).toBeLessThan(base.jetpack.drainPctPerS);
  });

  it('salir al menú abandona la sala; perder la conexión vuelve al menú con el motivo', async () => {
    await lobbyOfTwo();
    sendLobby({ type: 'start' });
    useGame.getState().toMenu();
    await flushMicrotasks();
    expect(isRemote()).toBe(false);
    expect(useCoop.getState()).toMatchObject({ status: 'idle', lobby: null });
    expect(server.model.view.players.map((p) => p.id)).toEqual(['otro']);
    expect(myCrew({ crew: [] })).toBeUndefined();

    server = new FakeServer();
    expect(await createRoom('Ana')).toBe(true);
    await flushMicrotasks();
    sendLobby({ type: 'start' });
    expect(useGame.getState().screen).toBe('game');
    server.kick('me');
    expect(useGame.getState().screen).toBe('menu');
    expect(useCoop.getState()).toMatchObject({ status: 'idle', error: 'lost' });
  });
});

describe('diseño compartido en sala (ADR 0020)', () => {
  it('el anfitrión elige misión; el hangar compartido envía ediciones, refleja las de los demás y vota', async () => {
    await lobbyOfTwo();
    sendLobby({ type: 'set-mission', missionId: 'mission-mars-habitability' });
    const design = useCoop.getState().lobby!.design!;
    expect(design.missionId).toBe('mission-mars-habitability');
    useGame.getState().openSharedDesign(design);
    expect(useGame.getState()).toMatchObject({ screen: 'design', sharedDesign: true });

    // Mi cambio en el hangar sale como edición discreta y vuelve en el lobby.
    useGame.getState().updateDraft({ ...design, moduleIds: ['frame-standard'] });
    const edits = server.sent.filter((m) => m.type === NET.lobby && (m.payload as { type: string }).type === 'edit-design');
    expect(edits.map((m) => m.payload)).toEqual([{ type: 'edit-design', edit: { op: 'add-module', id: 'frame-standard' } }]);
    expect(server.model.view.design!.moduleIds).toEqual(['frame-standard']);

    // Lo que añade otro jugador aparece en mi hangar sin pisar lo mío.
    server.model.lobby('otro', { type: 'edit-design', edit: { op: 'add-instrument', id: 'inst-drill' } });
    sendLobby({ type: 'vote', go: false }); // fuerza una difusión del lobby
    expect(useGame.getState().draft).toMatchObject({ moduleIds: ['frame-standard'], instrumentIds: ['inst-drill'] });

    // El diseño aún es No-Go: aunque se vote Go, no se puede zarpar.
    sendLobby({ type: 'vote', go: true });
    const check = sharedLaunchCheck(useCoop.getState().lobby!)!;
    expect(check.motorGo).toBe(false);
    expect(check.canStart).toBe(false);

    // Volver del hangar lleva al lobby de la sala, no a las misiones.
    useGame.getState().openMissions();
    expect(useGame.getState()).toMatchObject({ screen: 'menu', sharedDesign: false });
  });

  it('con Go del motor y mayoría de Go, la partida empieza con el diseño en todos los espejos', async () => {
    await lobbyOfTwo();
    sendLobby({ type: 'set-mission', missionId: 'mission-mars-habitability' });
    const target = referenceDesign('mission-mars-habitability');
    for (const edit of designEditsBetween(useCoop.getState().lobby!.design!, target)) sendLobby({ type: 'edit-design', edit });
    sendLobby({ type: 'vote', go: true });
    server.model.lobby('otro', { type: 'vote', go: true });
    sendLobby({ type: 'vote', go: true }); // sin cambio: no difunde, pero el servidor ya cuenta los dos votos
    expect(server.model.canStart()).toBe(true);
    sendLobby({ type: 'start' });
    expect(useGame.getState().screen).toBe('game');
    const run = getRun()!;
    expect(run.state.missionDesign?.missionId).toBe('mission-mars-habitability');
    expect(run.state.science).toBeDefined();
    expect(run.snapshot()).toEqual(server.model.run!.snapshot());
  });
});
