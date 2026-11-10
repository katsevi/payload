/**
 * Arranque del servidor de juego: `pnpm dev:server` (tsx watch) o `node dist/index.js` tras el build.
 * Variables: `PORT` (por defecto 2567), `HOST` (opcional) y `PAYLOAD_ALLOW_SEED=1` (permite la opción
 * de creación `seed`, solo desarrollo). Cierre limpio con SIGINT/SIGTERM (Colyseus desconecta las salas).
 */
import { createGameServer, DEFAULT_PORT } from './server';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[payload] PORT no válido: ${process.env.PORT}`);
  process.exit(1);
}

const game = await createGameServer({ port, ...(process.env.HOST ? { host: process.env.HOST } : {}), handleSignals: true, greet: false });
console.log(`[payload] servidor de juego escuchando en ws://localhost:${game.port} (sala "mission")`);
