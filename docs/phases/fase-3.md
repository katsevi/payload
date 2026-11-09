# Fase 3 · Multijugador

**Objetivo:** hasta 4 jugadores cooperando en una misma misión, cada uno con su rol, sobre un servidor autoritativo.

**Hito de salida:** *cuatro jugadores estables en una misión*.

**Prerrequisito:** fase 2 validada. `apps/game-server` es hoy solo un marcador.

## Punto de partida (estado al terminar la fase 2)

Qué existe y debe **reutilizarse** (no reescribir). Estado y acciones humanas: `docs/STATUS.md`.

- **Motor determinista y puro** (`packages/shared`): `computeBudgets`, `reviewGoNoGo`, `createMissionSim`/`runMission`, `scoreMission`, `buildReport`. Misma semilla = mismo resultado, sin importar cómo se trocee `step()`. Semilla del cliente = `defaultSeed + intento`.
- **Flujo que debe reproducir el servidor:** diseño válido → Go → `rollPreLaunchEvents(design, cat, seed)` → `createMissionSim(design, cat, { seed, preLaunch })` → `step(dt)` → `scoreMission`/`buildReport`. Los eventos están pre-sorteados con flujos separados (`deriveSeed`), así que cliente y servidor coinciden.
- **Roles:** `adviseByRole` y `ADVISOR_ROLES`/`ROLE_RESOURCES` (`advisors.ts`) ya definen los 4 roles y los recursos que vigila cada uno (claves `sim:advisor.*`). Con menos de 4 jugadores, un jugador agrupa roles.
- **Contrato:** `packages/shared/src/types.ts` (solo cambios aditivos; ADR si se rompe). `MessageRef` para todo texto; el cliente traduce.
- **Mascota y Academia** son datos (`catalog.mascot`, `catalog.academy`) con lógica pura en `apps/client/src/{mascot,academy}`. Decidir qué ve cada rol en una sala (una sola mascota por sala).
- **Cliente:** `useSim`, `useDesign` y `missionMachine` (XState, con fase `prelaunch`) llaman al motor en local; hay que poner detrás una interfaz común (local vs sala). La Academia y el intento persistente (`state/progress.ts`) son solitario.
- **Tests de referencia:** `simulation.test.ts` (determinismo) y `scenarios.test.ts` + fixtures por escenario (diseños válidos/fallidos listos para probar paridad servidor-motor).
- **Pendiente heredado de la fase 2:** hito con estudiantes, escucha del audio, revisión visual; `orbitPhase` es anomalía verdadera (ADR 0008 §6).
- `apps/game-server` es un marcador; agente de apoyo: `.claude/agents/game-server.md`.

## Alcance previsto

- **Servidor de juego** con Colyseus (0.18): salas de hasta 4, estado autoritativo que **corre el mismo motor** de `packages/shared`; los clientes solo envían acciones ("agregar instrumento", "votar Go"); reconexión y emparejamiento. Redis para presencia y escalado.
- **Roles:** Director/a de misión, Ingeniería de nave, Ciencia y carga útil, Operaciones y comunicaciones; combinación de roles con menos de 4 jugadores.
- **Colaboración:** solicitudes de recursos visibles para todos, presupuestos asignados por subsistema (reasignar requiere negociar), **Go/No-Go compartido** con voto por rol y motivo del No-Go, eventos en operación que exigen a varios roles.
- **Sala de control compartida** con avatares (astronauta del proyecto), chat de texto, *pings* sobre la nave y voz opcional por WebRTC.
- **Puntuación de colaboración** (solicitudes resueltas, tiempo de respuesta a eventos).
- Modo cooperativo.

## Entregables previstos

- [ ] `apps/game-server` con sala `MissionRoom` y esquema de estado sincronizado.
- [ ] Capa de cliente que alterna entre motor local (solitario) y servidor (sala) con la misma interfaz.
- [ ] Roles, permisos por rol y solicitudes de recursos.
- [ ] Go/No-Go con votación.
- [ ] Sala de control con avatares, chat y pings; voz opcional.
- [ ] Tests de integración servidor-motor (mismo resultado que el motor local con la misma semilla).

## Criterios de aceptación previstos

- [ ] Cuatro clientes completan una misión sin desincronizaciones.
- [ ] El resultado de una sala es idéntico al de `runMission` con el mismo diseño y semilla.
- [ ] Un cliente que se desconecta puede volver a la sala y recupera el estado.
- [ ] Un No-Go exige motivo y devuelve a todos al diseño.
- [ ] `pnpm validate` en verde, incluidos los tests del servidor.
