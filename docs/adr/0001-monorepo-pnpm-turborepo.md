# 0001 · Monorepo pnpm + Turborepo

- Estado: aceptada
- Fecha: 2026-11-07

## Contexto
El juego tiene cliente, servidor de juego, API y un paquete compartido de tipos, catálogo y motor. Todos en TypeScript y con cambios que suelen cruzar paquetes (p. ej. un campo nuevo del contrato).

## Decisión
Un único repositorio con **pnpm workspaces** (`apps/*`, `packages/*`) y **Turborepo** para orquestar tareas (`build`, `test`, `typecheck`) con caché.

## Consecuencias
- Cambios atómicos entre cliente, motor y servidor; un solo `pnpm validate`.
- Dependencias compartidas y versiones coherentes.
- Hay que mantener la configuración de Turborepo y cuidar que `packages/shared` no dependa de las apps.
- Los marcadores `apps/game-server` y `apps/api` existen desde el inicio pero están vacíos hasta sus fases.
