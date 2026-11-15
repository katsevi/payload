/**
 * Sala `crew` de Colyseus: adaptador fino sobre `RoomModel` (toda la lógica está en el modelo puro).
 * Traduce mensajes, el ciclo de vida de los clientes (entrada, caída, reconexión, salida) y el tiempo.
 *
 * No usa el estado sincronizado de Colyseus (esquema): el `RunState` del motor viaja entero por mensaje
 * a cada paso fijo (10 Hz), que es cuando cambia. Contrato: docs/MULTIPLAYER.md.
 *
 * El código de sala es el `roomId` (4 caracteres): se entra con `joinById(código)`. Las salas son privadas
 * (no hay emparejamiento) y se bloquean al empezar la partida; las reconexiones siguen funcionando.
 */
import { ErrorCode, Room, ServerError, type Client } from '@colyseus/core';
import { COOP_LIMITS, makeRoomCode, NET } from '@payload/shared';
import { RoomModel } from './roomModel';

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Códigos en uso en este proceso (un solo proceso: ADR 0010). */
const usedCodes = new Set<string>();

function freshCode(): string {
  for (let i = 0; i < 200; i++) {
    const code = makeRoomCode(Math.random);
    if (!usedCodes.has(code)) return code;
  }
  throw new ServerError(ErrorCode.APPLICATION_ERROR, 'no-codes');
}

/** ¿Se permite fijar la semilla al crear la sala? Solo desarrollo y tests. */
export function seedOptionAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PAYLOAD_ALLOW_SEED === '1' || env.NODE_ENV === 'test';
}

const randomSeed = (): number => Math.floor(Math.random() * 0x1_0000_0000) >>> 0;

export class CrewRoom extends Room {
  /** Gracia de reconexión (s). Solo los tests la acortan. */
  static reconnectGraceS: number = COOP_LIMITS.reconnectGraceS;

  /**
   * Cupo de Colyseus con holgura. Colyseus bloquea la sala solo en cuanto clientes + asientos reservados llegan a
   * `maxClients`, y un intento de entrada que no llega a abrir el WebSocket deja su asiento reservado unos segundos
   * (`seatReservationTimeout`). Con el cupo exacto, tres jugadores y un reintento bastaban para que el cuarto
   * recibiera «sala bloqueada» (que el cliente muestra como partida empezada). El límite real de jugadores lo pone
   * `RoomModel.join` (`room-full`), y el bloqueo por partida empezada lo hace `syncLobby`.
   */
  override maxClients: number = COOP_LIMITS.maxPlayers * 2;
  override maxMessagesPerSecond: number = COOP_LIMITS.maxMessagesPerSecond;

  private model!: RoomModel;
  private readonly t0 = performance.now();
  private lockedForRun = false;
  private lastLobby = '';
  private lastRunKey = 'lobby:0';
  private lastPoses = '{}';

  /** Segundos de sala. */
  private nowS(): number {
    return (performance.now() - this.t0) / 1000;
  }

  /** Modelo de la sala (para tests de integración en el mismo proceso). */
  get roomModel(): RoomModel {
    return this.model;
  }

  override async onCreate(options: unknown): Promise<void> {
    const code = freshCode();
    usedCodes.add(code);
    this.roomId = code;
    const fixedSeed = isObject(options) && typeof options.seed === 'number' && Number.isFinite(options.seed) && seedOptionAllowed() ? Math.trunc(options.seed) >>> 0 : null;
    let runs = 0;
    this.model = new RoomModel({ code, nextSeed: () => (fixedSeed === null ? randomSeed() : (fixedSeed + runs++) >>> 0) });
    await this.setPrivate(true);

    this.onMessage(NET.lobby, (client: Client, message: unknown) => {
      if (this.model.lobby(client.sessionId, message)) this.syncLobby();
    });
    this.onMessage(NET.action, (client: Client, message: unknown) => {
      const rejected = this.model.action(client.sessionId, message, this.nowS());
      if (rejected) client.send(NET.result, rejected);
    });
    this.onMessage(NET.pose, (client: Client, message: unknown) => this.model.pose(client.sessionId, message));
    this.onMessage(NET.ping, (client: Client, message: unknown) => {
      const ping = this.model.ping(client.sessionId, message, this.nowS());
      if (ping) this.broadcast(NET.ping, ping);
    });
    this.setTimestep((deltaMs) => this.tick(deltaMs / 1000), 1000 / COOP_LIMITS.stateHz);
  }

  override onJoin(client: Client, options?: unknown): void {
    const joined = this.model.join(client.sessionId, isObject(options) ? options.name : undefined, isObject(options) ? options.key : undefined);
    if (!joined.ok) throw new ServerError(ErrorCode.APPLICATION_ERROR, joined.code);
    this.syncLobby(true);
  }

  /** Caída sin consentimiento: conserva sitio y tripulante durante la gracia. */
  override onDrop(client: Client): void {
    this.model.drop(client.sessionId);
    this.syncLobby();
    // Si no vuelve a tiempo, Colyseus llama a onLeave (salida definitiva).
    this.allowReconnection(client, CrewRoom.reconnectGraceS).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    this.model.reconnect(client.sessionId);
    this.syncLobby(true);
    // Quien vuelve necesita el estado entero (con el sector), no solo el siguiente paso.
    const full = this.model.stateMessage(true);
    if (full) client.send(NET.state, full);
  }

  override onLeave(client: Client): void {
    this.model.leave(client.sessionId);
    this.syncLobby();
  }

  override onDispose(): void {
    usedCodes.delete(this.model?.code ?? this.roomId);
  }

  private tick(dt: number): void {
    const { events, stepped } = this.model.advance(dt);
    if (stepped) {
      const state = this.model.stateMessage();
      if (state) this.broadcast(NET.state, state);
    }
    if (events.length > 0) this.broadcast(NET.events, events);
    const poses = this.model.poses;
    const key = JSON.stringify(poses);
    if (key !== this.lastPoses) {
      this.lastPoses = key;
      this.broadcast(NET.poses, poses);
    }
  }

  /** Difunde la vista del lobby si cambió (`force`: alguien acaba de entrar y aún no la tiene). */
  private syncLobby(force = false): void {
    const view = this.model.view;
    const key = JSON.stringify(view);
    if (!force && key === this.lastLobby) return;
    const runKey = `${view.phase}:${view.runId}`;
    const phaseChanged = runKey !== this.lastRunKey;
    this.lastRunKey = runKey;
    this.lastLobby = key;
    this.broadcast(NET.lobby, view);
    if (view.phase === 'playing' && !this.lockedForRun) {
      this.lockedForRun = true;
      this.lock().catch(() => undefined);
    } else if (view.phase === 'lobby' && this.lockedForRun) {
      this.lockedForRun = false;
      this.unlock().catch(() => undefined);
    }
    // Partida nueva: todos reciben el estado inicial entero sin esperar al primer paso.
    if (view.phase === 'playing' && phaseChanged) {
      const state = this.model.stateMessage();
      if (state) this.broadcast(NET.state, state);
    }
  }
}
