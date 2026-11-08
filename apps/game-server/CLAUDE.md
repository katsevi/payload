# @payload/game-server — marcador de la fase 3

**Hoy no tiene código** (`src/` vacío; los scripts `typecheck`/`test`/`build` solo hacen `echo`).
No lo rellenes hasta que la fase 2 esté validada (`docs/phases/fase-3.md`).

## Qué irá aquí (según el plan)

- Servidor de juego con **Colyseus** (0.18): `MissionRoom` de hasta 4 jugadores, esquema de estado
  sincronizado, reconexión y emparejamiento; Redis para presencia y escalado.
- Roles (Director/a, Ingeniería, Ciencia y carga útil, Operaciones y comunicaciones), solicitudes de
  recursos, Go/No-Go con votación, chat, *pings* y puntuación de colaboración.

## Contrato que debe respetar

- **Servidor autoritativo que corre el mismo motor:** importa `@payload/shared` (`computeBudgets`,
  `reviewGoNoGo`, `createMissionSim`, `scoreMission`...). No duplica fórmulas ni tipos.
- Los clientes solo envían **acciones**; el servidor valida, recalcula y sincroniza.
- Determinismo: una sala con un diseño y una semilla debe dar el mismo `MissionResult` que `runMission`
  (test de integración obligatorio).
- Mensajes al jugador como `MessageRef` (el cliente los traduce); sin texto hardcodeado.
- Cambios en `packages/shared/src/types.ts`: solo aditivos, o ADR.

Arquitectura de conjunto: `docs/ARCHITECTURE.md`.
