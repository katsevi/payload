/**
 * Servidor de juego de Payload (Colyseus 0.18 + WebSocket). `createGameServer` lo usan `index.ts`
 * (proceso real) y los tests (puerto libre con `port: 0`).
 *
 * - Sala `mission` filtrada por `scenarioId` en el emparejamiento (`joinOrCreate` solo junta jugadores
 *   del mismo escenario y, como la sala se bloquea al salir del lobby, solo salas en el lobby).
 * - Presencia y driver de emparejamiento LOCALES (un solo proceso): ver docs/adr/0010-presencia-y-escalado.md.
 * - CORS: las rutas HTTP de emparejamiento (`POST /matchmake/<método>/<sala>`) responden al preflight
 *   (`OPTIONS`, 204) y devuelven `Access-Control-Allow-Origin` = el `Origin` de la petición (Colyseus lo
 *   hace por defecto), así el cliente de Vite (otro origen, p. ej. http://localhost:5173) puede emparejar.
 */
import type { AddressInfo } from 'node:net';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MISSION_ROOM, MissionRoom } from './MissionRoom';

export const DEFAULT_PORT = 2567;

export interface GameServerOptions {
  /** Puerto TCP (0 = uno libre, útil en tests). */
  port: number;
  /** Interfaz de red (por defecto todas). */
  host?: string;
  /** Registrar manejadores de SIGINT/SIGTERM que cierran el servidor y salen del proceso (solo el proceso real). */
  handleSignals?: boolean;
  /** Mostrar el saludo de Colyseus al arrancar. */
  greet?: boolean;
}

export interface GameServer {
  server: Server;
  /** Puerto real en que escucha (útil con `port: 0`). */
  port: number;
  /** Cierra las salas y el servidor HTTP/WebSocket sin salir del proceso. */
  close(): Promise<void>;
}

export async function createGameServer(opts: GameServerOptions): Promise<GameServer> {
  const transport = new WebSocketTransport();
  const server = new Server({
    transport,
    greet: opts.greet ?? false,
    gracefullyShutdown: opts.handleSignals ?? false,
  });
  server.define(MISSION_ROOM, MissionRoom).filterBy(['scenarioId']);
  await server.listen(opts.port, opts.host);
  const address = transport.server?.address();
  const port = typeof address === 'object' && address !== null ? (address as AddressInfo).port : opts.port;
  let closing: Promise<void> | null = null;
  return {
    server,
    port,
    close: () => (closing ??= server.gracefullyShutdown(false)),
  };
}
