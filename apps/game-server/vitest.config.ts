import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Los tests de red levantan un servidor Colyseus real en un puerto libre y conectan clientes SDK.
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
