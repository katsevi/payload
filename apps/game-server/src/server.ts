/**
 * Servidor de juego de Payload (Colyseus 0.18 + WebSocket). `createGameServer` lo usan `index.ts`
 * (proceso real) y los tests (puerto libre con `port: 0`).
 *
 * Presencia y driver LOCALES (un solo proceso): ver docs/adr/0010-presencia-y-escalado.md. Este es el
 * único sitio que construye el `Server` de Colyseus.
 */
import type { AddressInfo } from 'node:net';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { COOP_ROOM } from '@payload/shared';
import { CrewRoom } from './CrewRoom';

export const DEFAULT_PORT = 2567;

export interface GameServerOptions {
  /** Puerto TCP (0 = uno libre, útil en tests). */
  port: number;
  /** Interfaz de red (por defecto todas: hace falta para jugar en red local). */
  host?: string;
  /** Registrar manejadores de SIGINT/SIGTERM (solo el proceso real). */
  handleSignals?: boolean;
}

export interface GameServer {
  server: Server;
  /** Puerto real en que escucha (útil con `port: 0`). */
  port: number;
  /** Cierra las salas y el servidor sin salir del proceso. */
  close(): Promise<void>;
}

export async function createGameServer(opts: GameServerOptions): Promise<GameServer> {
  const transport = new WebSocketTransport();
  const server = new Server({ transport, greet: false, gracefullyShutdown: opts.handleSignals ?? false });
  server.define(COOP_ROOM, CrewRoom);
  await server.listen(opts.port, opts.host);
  const address = transport.server?.address();
  const port = typeof address === 'object' && address !== null ? (address as AddressInfo).port : opts.port;
  let closing: Promise<void> | null = null;
  return { server, port, close: () => (closing ??= server.gracefullyShutdown(false)) };
}
