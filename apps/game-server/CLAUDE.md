# @payload/game-server — marcador de la fase 3

**Hoy no tiene código** (`src/` vacío; los scripts `typecheck`/`test`/`build` solo hacen `echo`).
La fase 2 está hecha y validada con observaciones: ya puede empezar la fase 3. Punto de partida concreto (qué reutilizar del motor y del cliente) en `docs/phases/fase-3.md` § "Punto de partida"; agente de apoyo: `.claude/agents/game-server.md`.

## Qué irá aquí (según el plan)

- Servidor de juego con **Colyseus** (0.18): `MissionRoom` de hasta 4 jugadores, esquema de estado
  sincronizado, reconexión y emparejamiento; Redis para presencia y escalado.
- Roles (Director/a, Ingeniería, Ciencia y carga útil, Operaciones y comunicaciones), solicitudes de
  recursos, Go/No-Go con votación, chat, *pings* y puntuación de colaboración.

## Flujo del motor que debe correr el servidor

Diseño -> `computeBudgets`/`reviewGoNoGo` -> Go -> `rollPreLaunchEvents(design, cat, seed)` ->
`createMissionSim(design, cat, { seed, preLaunch })` -> `step(dt)` -> `scoreMission`/`buildReport`.
Roles: `ADVISOR_ROLES`/`ROLE_RESOURCES`/`adviseByRole` (`packages/shared/src/advisors.ts`).

## Contrato que debe respetar

- **Servidor autoritativo que corre el mismo motor:** importa `@payload/shared` (`computeBudgets`,
  `reviewGoNoGo`, `createMissionSim`, `scoreMission`...). No duplica fórmulas ni tipos.
- Los clientes solo envían **acciones**; el servidor valida, recalcula y sincroniza.
- Determinismo: una sala con un diseño y una semilla debe dar el mismo `MissionResult` que `runMission`
  (test de integración obligatorio).
- Mensajes al jugador como `MessageRef` (el cliente los traduce); sin texto hardcodeado.
- Cambios en `packages/shared/src/types.ts`: solo aditivos, o ADR.

Arquitectura de conjunto: `docs/ARCHITECTURE.md`.
