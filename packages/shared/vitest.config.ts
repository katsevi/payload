import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Algunos tests simulan cientos de partidas completas (balance, paridad de mensajes, sectores).
    // En `pnpm validate` corren en paralelo con el build del cliente, así que damos margen.
    testTimeout: 30_000,
  },
});
