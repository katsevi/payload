import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Algunos tests simulan cientos de misiones (fiabilidad, fuzz de Go/No-Go, paridad de mensajes).
    // En `pnpm validate` corren en paralelo con el build del cliente, así que damos margen.
    testTimeout: 30_000,
  },
});
