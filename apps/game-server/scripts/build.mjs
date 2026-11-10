// Build de producción del servidor de juego: un único bundle ESM para Node (dist/index.js).
// @payload/shared se publica como fuente TS + JSON, así que va DENTRO del bundle (con zod).
// Colyseus (y sus dependencias: ws, express, msgpackr...) se quedan externos y se resuelven desde
// apps/game-server/node_modules al ejecutar `node dist/index.js`.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['@colyseus/*'],
  logLevel: 'info',
});
