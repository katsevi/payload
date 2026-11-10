import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Los tests de red levantan un servidor Colyseus real en un puerto libre y conectan clientes SDK;
    // los de paridad simulan todas las misiones de los fixtures. Margen para `pnpm validate` en paralelo.
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
