// Tests de red: servidor Colyseus real (puerto libre) y clientes @colyseus/sdk reales en el mismo proceso.
// Hito de la fase 6 en pequeño: cuatro clientes juegan la misma partida sin desincronizarse, uno se cae y
// vuelve con el estado entero, y nadie entra a una partida empezada. Sin esperas fijas: `waitFor` sondea.
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { Client as SDKClient, type Room as SDKRoom } from '@colyseus/sdk';
import {
  COOP_ROOM, createRun, getNode, NET, normalizeRoomCode,
  type LobbyAction, type LobbyView, type PingBroadcast, type PosesMessage, type ResultMessage, type RunAction, type RunEvent, type RunState, type SectorMap, type StateMessage,
} from '@payload/shared';
import { CrewRoom } from '../CrewRoom';
import { createGameServer, type GameServer } from '../server';

let game: GameServer;
let endpoint: string;

beforeAll(async () => {
  game = await createGameServer({ port: 0 });
  endpoint = `http://127.0.0.1:${game.port}`;
});

afterAll(async () => {
  await game?.close();
});

async function waitFor(cond: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Player {
  room: SDKRoom;
  lobby: LobbyView | null;
  tick: number;
  state: RunState | null;
  sector: SectorMap | null;
  events: RunEvent[];
  results: ResultMessage[];
  poses: PosesMessage;
  pings: PingBroadcast[];
}

type Dyn = { send(type: string, payload?: unknown): void; onMessage(type: string, cb: (payload: never) => void): void };

function track(room: SDKRoom): Player {
  const p: Player = { room, lobby: null, tick: -1, state: null, sector: null, events: [], results: [], poses: {}, pings: [] };
  const dyn = room as unknown as Dyn;
  dyn.onMessage(NET.lobby, (v: LobbyView) => (p.lobby = v));
  dyn.onMessage(NET.state, (m: StateMessage) => {
    if (m.sector) p.sector = m.sector;
    p.tick = m.tick;
    p.state = p.sector ? { ...m.state, sector: p.sector } : null;
  });
  dyn.onMessage(NET.events, (e: RunEvent[]) => p.events.push(...e));
  dyn.onMessage(NET.result, (r: ResultMessage) => p.results.push(r));
  dyn.onMessage(NET.poses, (m: PosesMessage) => (p.poses = m));
  dyn.onMessage(NET.ping, (m: PingBroadcast) => p.pings.push(m));
  return p;
}

const sdk = (): SDKClient => new SDKClient(endpoint);
const send = (p: Player, type: string, payload: unknown): void => (p.room as unknown as Dyn).send(type, payload);
const lobby = (p: Player, action: LobbyAction): void => send(p, NET.lobby, action);
let seq = 0;
const act = (p: Player, action: RunAction): void => send(p, NET.action, { seq: ++seq, action });
const serverRoom = (code: string): CrewRoom => matchMaker.getLocalRoomById(code) as unknown as CrewRoom;

async function openRoom(names: string[], seed: number): Promise<Player[]> {
  const host = track(await sdk().create(COOP_ROOM, { name: names[0], seed }));
  const players = [host];
  for (const name of names.slice(1)) players.push(track(await sdk().joinById(host.room.roomId, { name })));
  await waitFor(() => players.every((p) => p.lobby?.players.length === names.length), 'todos ven a todos en el lobby');
  return players;
}

async function startRun(players: Player[]): Promise<void> {
  for (const p of players.slice(1)) lobby(p, { type: 'set-ready', ready: true });
  await waitFor(() => players[0]!.lobby!.players.slice(1).every((x) => x.ready), 'todos listos');
  lobby(players[0]!, { type: 'start' });
  await waitFor(() => players.every((p) => p.lobby?.phase === 'playing' && p.state !== null), 'partida empezada en todos');
}

/** Todos los clientes tienen el mismo paso y el mismo estado. */
const synced = (players: Player[]): boolean => players.every((p) => p.tick === players[0]!.tick && isDeepStrictEqual(p.state, players[0]!.state));

describe('sala cooperativa en red', () => {
  it('cuatro clientes entran con el código, eligen rol y juegan la misma partida', async () => {
    const players = await openRoom(['Ana', 'Beto', 'Cira', 'Dani'], 7);
    const [ana, beto, cira, dani] = players as [Player, Player, Player, Player];
    const code = ana.room.roomId;
    expect(normalizeRoomCode(code)).toBe(code);
    expect(ana.lobby!.code).toBe(code);

    lobby(ana, { type: 'set-role', role: 'pilot' });
    lobby(beto, { type: 'set-role', role: 'engineer' });
    lobby(cira, { type: 'set-role', role: 'pilot' }); // ocupado: se ignora
    lobby(dani, { type: 'set-role', role: 'explorer' });
    await waitFor(() => dani.lobby!.players.map((p) => p.role).join() === 'pilot,engineer,,explorer', 'roles repartidos');

    await startRun(players);
    expect(ana.state!.crew.map((c) => c.role)).toEqual(['pilot', 'engineer', undefined, 'explorer']);
    expect(ana.lobby!.players.map((p) => p.crewId)).toEqual([1, 2, 3, 4]);
    // Mismo estado inicial que el motor con esa semilla.
    const engine = createRun({ seed: 7, crewSize: 4, roles: ['pilot', 'engineer', null, 'explorer'] });
    expect(ana.sector).toEqual(engine.state.sector);

    // Cira (sin rol) traza la ruta: cualquiera puede usar cualquier puesto.
    const toId = getNode(ana.state!.sector, ana.state!.locationId)!.links[0]!;
    act(cira, { type: 'jump', toId });
    await waitFor(() => players.every((p) => p.state!.phase === 'transit'), 'todos en tránsito');
    await waitFor(() => players.every((p) => p.events.some((e) => e.type === 'jump')), 'evento de salto en todos');
    await waitFor(() => ana.state!.transit !== null && ana.state!.transit.traveledLy > 0 && synced(players), 'clientes sincronizados en ruta');
    // Y lo que ven es lo que tiene el servidor.
    await waitFor(() => {
      const model = serverRoom(code).roomModel;
      return ana.tick === model.tick && isDeepStrictEqual(ana.state, model.run!.snapshot());
    }, 'cliente igual que el servidor');

    // Un rechazo vuelve solo a quien lo provocó, con su número de secuencia.
    act(beto, { type: 'jump', toId });
    await waitFor(() => beto.results.length === 1, 'rechazo a quien lo pidió');
    expect(beto.results[0]).toMatchObject({ seq, reason: { key: 'reject.inTransit' } });
    expect(ana.results).toEqual([]);

    // Poses y pings llegan a los demás con el tripulante de quien los envía.
    send(dani, NET.pose, { x: 1.5, y: 0, z: -2, yaw: 1, area: 'ship' });
    await waitFor(() => ana.poses[4]?.x === 1.5, 'pose de Dani en Ana');
    send(beto, NET.ping, { kind: 'danger', x: 0, y: 1, z: 0, area: 'ship' });
    await waitFor(() => cira.pings.length === 1, 'ping de Beto en Cira');
    expect(cira.pings[0]).toMatchObject({ crewId: 2, kind: 'danger' });

    // Nadie entra a una partida empezada.
    await expect(sdk().joinById(code, { name: 'Eva' })).rejects.toThrow();
    await Promise.all(players.map((p) => p.room.leave()));
  });

  it('un cliente caído vuelve con su tripulante y el estado entero', async () => {
    const players = await openRoom(['Ana', 'Beto'], 11);
    const [ana, beto] = players as [Player, Player];
    await startRun(players);
    const code = ana.room.roomId;
    const token = beto.room.reconnectionToken;

    // Corta el socket de Beto sin despedirse.
    beto.room.reconnection.maxRetries = 0;
    (beto.room.connection as unknown as { close(code?: number): void }).close(4010);
    await waitFor(() => ana.lobby!.players[1]!.connected === false, 'Ana ve a Beto caído');
    expect(serverRoom(code).roomModel.run!.state.crew).toHaveLength(2);

    const back = track(await sdk().reconnect(token));
    await waitFor(() => back.state !== null && back.lobby !== null, 'Beto recibe lobby y estado entero al volver');
    expect(back.sector).toEqual(ana.sector);
    await waitFor(() => ana.lobby!.players[1]!.connected === true, 'Ana ve a Beto de vuelta');
    expect(back.lobby!.players[1]).toMatchObject({ name: 'Beto', crewId: 2 });
    await waitFor(() => synced([ana, back]), 'sincronizados tras la reconexión');
    await Promise.all([ana.room.leave(), back.room.leave()]);
  });

  it('la sala no existe con un código inventado', async () => {
    await expect(sdk().joinById('ZZZZ', { name: 'Eva' })).rejects.toThrow();
  });
});
