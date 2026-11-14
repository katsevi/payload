/**
 * Arranque del servidor de juego: `pnpm dev:server` (tsx watch) o `node dist/index.js` tras el build.
 * Variables: `PORT` (por defecto 2567), `HOST` (opcional) y `PAYLOAD_ALLOW_SEED=1` (permite fijar la
 * semilla al crear una sala; solo desarrollo).
 */
import { networkInterfaces } from 'node:os';
import { createGameServer, DEFAULT_PORT } from './server';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[payload] PORT no válido: ${process.env.PORT}`);
  process.exit(1);
}

const game = await createGameServer({ port, ...(process.env.HOST ? { host: process.env.HOST } : {}), handleSignals: true });
console.log(`[payload] servidor de juego en ws://localhost:${game.port}`);
// Direcciones de red local: las que hay que abrir desde los otros equipos.
for (const list of Object.values(networkInterfaces())) {
  for (const net of list ?? []) if (net.family === 'IPv4' && !net.internal) console.log(`[payload]   red local: ws://${net.address}:${game.port}`);
}
