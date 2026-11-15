import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Versión del cliente para la ficha técnica del menú.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Modelos optimizados: assets/web/models/*.glb se sirven como /models/*.glb
  publicDir: '../../assets/web',
  build: { chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
