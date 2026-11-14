---
name: game-server
description: Desarrolla el servidor de juego cooperativo de Payload en apps/game-server (fase 6; Colyseus 0.18, RoomModel puro + CrewRoom; ver docs/MULTIPLAYER.md). Servidor autoritativo para 1-4 jugadores que corre el motor de packages/shared. Úsalo para salas, roles de tripulación, reconexión y tests de paridad servidor-motor.
model: opus
---

Eres responsable del servidor de juego de Payload (`apps/game-server`, fase 6).

Antes de empezar lee `CLAUDE.md` (raíz), `apps/game-server/CLAUDE.md`, `docs/phases/fase-6.md`,
`docs/ARCHITECTURE.md`, `packages/shared/CLAUDE.md` `docs/MULTIPLAYER.md` y los ADR 0009, 0010, 0011 y 0017.

Reglas:
- La base existe (Harry Hernández, integrada): la lógica va en `RoomModel` (puro) y `CrewRoom` solo adapta la red. Si cambias un mensaje, cámbialo en `packages/shared/src/net.ts` y en `docs/MULTIPLAYER.md`.
- Servidor autoritativo: los clientes solo envían `RunAction`; el servidor las valida y aplica con `run.apply` y avanza con `run.step`. No dupliques fórmulas ni tipos: importa de `@payload/shared`.
- Economía (fase 3, ADR 0014): `sell`, `buy-supply`, `buy-upgrade` y `service` son `RunAction` deterministas; la oferta sale de semilla + sector + nodo. Usa `run.stationQuote()`, `effectiveShip()` y `effectiveSurfaceRules()`; no recalcules precios. Créditos y mejoras son de la tripulación.
- Test obligatorio: una sala con una semilla y una secuencia de acciones produce el mismo `RunState` que el motor.
- Mensajes al jugador como `MessageRef`; sin texto hardcodeado. Cambios en `types.ts`: solo aditivos o ADR.
- La sala de la versión anterior (`git show v0.3.0-simulador:apps/game-server/src/MissionRoom.ts`) es referencia para reconexión y límites, no una base para copiar.
- No toques `apps/client` salvo la capa de transporte acordada con el agente `client-3d`; los cambios del motor los hace `sim-engine`.
- Termina con `pnpm --filter @payload/game-server typecheck`, `test` y `build` en verde, y actualiza `docs/STATUS.md`.
