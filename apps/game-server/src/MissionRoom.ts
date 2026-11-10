/**
 * Sala `mission` de Colyseus: adaptador fino sobre `RoomModel` (toda la lógica está en el modelo puro).
 * Traduce mensajes (`action`, `move`), el ciclo de vida de los clientes (entrada, caída, reconexión,
 * salida) y el tiempo (`nowS` = segundos desde que se creó la sala), escribe la vista en el esquema
 * (`StateWriter`, deltas mínimos) y envía los avisos `notice` (`ServerNotice`).
 *
 * Opciones de creación: ver `options.ts`. Emparejamiento: `filterBy(['scenarioId'])` (en server.ts); al
 * salir del lobby la sala se bloquea (`lock`), así `joinOrCreate` solo encuentra salas en el lobby. Las
 * reconexiones siguen funcionando con la sala bloqueada (usan la reserva de `allowReconnection`).
 */
import { ErrorCode, Room, ServerError, type Client } from '@colyseus/core';
import { TEAM_LIMITS, type RoomPhase } from '@payload/shared';
import { CreateOptionsError, parseCreateOptions, seedOptionAllowed } from './options';
import { RoomModel, type Outgoing } from './roomModel';
import { MissionState, StateWriter } from './schema';

/** Metadatos de emparejamiento (los ve `client.getAvailableRooms` / el lobby de Colyseus). */
export interface MissionMetadata {
  scenarioId: string;
  phase: RoomPhase;
  players: number;
}

/** Nombre de la sala en el servidor (`client.create('mission', …)`). */
export const MISSION_ROOM = 'mission';
/** Tope de mensajes por segundo de un cliente (move a 10 Hz + acciones): más es abuso y Colyseus lo desconecta. */
export const MAX_MESSAGES_PER_SECOND = 40;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export class MissionRoom extends Room<{ state: MissionState; metadata: MissionMetadata }> {
  /**
   * Gracia de reconexión (s). Es `TEAM_LIMITS.reconnectGraceS` (60 s); solo los tests la acortan para
   * probar el camino real "no vuelve a tiempo ⇒ salida definitiva" sin esperar un minuto.
   */
  static reconnectGraceS: number = TEAM_LIMITS.reconnectGraceS;

  /** 4, o el `team.maxPlayers` del escenario (se fija en onCreate con `RoomModel.maxPlayers`). */
  override maxClients: number = TEAM_LIMITS.maxPlayers;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

  private model!: RoomModel;
  private writer!: StateWriter;
  private readonly t0 = performance.now();
  private lockedForMission = false;
  private lastMetadata = '';

  /** Segundos de sala (precisión de milisegundos). */
  nowS(): number {
    return Math.round(performance.now() - this.t0) / 1000;
  }

  /** Modelo de la sala (para tests de integración en el mismo proceso). */
  get roomModel(): RoomModel {
    return this.model;
  }

  override async onCreate(options: unknown): Promise<void> {
    let opts;
    try {
      opts = parseCreateOptions(options, seedOptionAllowed());
    } catch (e) {
      if (e instanceof CreateOptionsError) throw new ServerError(ErrorCode.APPLICATION_ERROR, e.code);
      throw e;
    }
    this.model = new RoomModel({ roomId: this.roomId, scenarioId: opts.scenarioId, attempt: opts.attempt, seed: opts.seed });
    this.maxClients = this.model.maxPlayers;
    this.state = new MissionState();
    this.writer = new StateWriter(this.state);

    this.onMessage('action', (client: Client, message: unknown) => {
      this.deliver(this.model.apply(client.sessionId, message, this.nowS()));
      this.sync();
    });
    this.onMessage('move', (client: Client, message: unknown) => {
      if (this.model.move(client.sessionId, message, this.nowS())) this.sync();
    });
    this.setTimestep((deltaMs) => {
      this.model.tick(deltaMs / 1000, this.nowS());
      this.sync();
    }, 1000 / TEAM_LIMITS.simTickHz);

    if (opts.private) await this.setPrivate(true);
    this.sync();
  }

  override onJoin(client: Client, options?: unknown): void {
    const name = isObject(options) ? options.name : undefined;
    const joined = this.model.join(client.sessionId, name, this.nowS());
    if (!joined.ok) throw new ServerError(ErrorCode.APPLICATION_ERROR, joined.reason);
    this.sync();
  }

  /** Caída sin consentimiento: el jugador conserva roles y sitio durante `reconnectGraceS`. */
  override onDrop(client: Client): void {
    if (!this.model.player(client.sessionId)) return;
    this.model.drop(client.sessionId, this.nowS());
    this.sync();
    // Si no vuelve a tiempo, Colyseus llama a onLeave (salida definitiva).
    this.allowReconnection(client, MissionRoom.reconnectGraceS).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    this.model.reconnect(client.sessionId, this.nowS());
    this.sync();
  }

  override onLeave(client: Client): void {
    this.model.leave(client.sessionId, this.nowS());
    this.sync();
  }

  /** Avisos: a un jugador (`to`) o a todos (null), después del parche de estado que los explica. */
  private deliver(out: readonly Outgoing[]): void {
    for (const { to, notice } of out) {
      if (to === null) this.broadcast('notice', notice, { afterNextPatch: true });
      else this.clients.get(to)?.send('notice', notice, { afterNextPatch: true });
    }
  }

  /** Lleva la vista del modelo al esquema; bloquea la sala al salir del lobby y actualiza los metadatos. */
  private sync(): void {
    const view = this.model.view;
    if (!this.writer.write(view)) return;
    if (view.phase !== 'lobby' && !this.lockedForMission) {
      this.lockedForMission = true;
      this.lock().catch(() => undefined);
    }
    const metadata: MissionMetadata = { scenarioId: view.scenarioId, phase: view.phase, players: view.players.length };
    const key = JSON.stringify(metadata);
    if (key !== this.lastMetadata) {
      this.lastMetadata = key;
      this.setMetadata(metadata).catch(() => undefined);
    }
  }
}
