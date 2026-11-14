// Paquete AUTOCONTENIDO del servidor de juego: un solo archivo ESM (dist-standalone/payload-game-server.mjs)
// con @payload/shared, zod y Colyseus dentro. En la máquina solo hace falta Node (versión de .nvmrc):
//   PORT=2567 HOST=127.0.0.1 node payload-game-server.mjs
// Se usa cuando la instancia no puede clonar el repo (repo privado sin deploy keys): ver
// docs/despliegue-aws.md § «Actualizar el servidor sin acceso al repo».
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist-standalone/payload-game-server.mjs');

await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  // Algunas dependencias de Colyseus usan require(): se lo damos dentro del ESM.
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

const sha = createHash('sha256').update(readFileSync(outfile)).digest('hex');
console.log(`[payload] ${outfile}\n[payload] sha256 ${sha}`);
