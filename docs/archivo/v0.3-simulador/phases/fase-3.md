# Fase 3 · Multijugador

**Objetivo:** hasta 4 jugadores cooperando en una misma misión, cada uno con su rol, sobre un servidor autoritativo.

**Hito de salida:** *cuatro jugadores estables en una misión*.

**Prerrequisito:** fase 2 validada (hecho).

**Estado:** hecha · validada con observaciones (2026-11-09). **El hito humano está pendiente**: jugar una misión completa con 4 personas reales en 4 navegadores/equipos distintos (hasta ahora solo con 3-4 clientes SDK en `localhost`, un navegador real y la sala de ejemplo `?room=demo`). Ver el apartado "Resultado".

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
- (Al empezar la fase) `apps/game-server` era un marcador; agente de apoyo: `.claude/agents/game-server.md`.

## Alcance previsto

- **Servidor de juego** con Colyseus (0.18): salas de hasta 4, estado autoritativo que **corre el mismo motor** de `packages/shared`; los clientes solo envían acciones ("agregar instrumento", "votar Go"); reconexión y emparejamiento. Redis para presencia y escalado.
- **Roles:** Director/a de misión, Ingeniería de nave, Ciencia y carga útil, Operaciones y comunicaciones; combinación de roles con menos de 4 jugadores.
- **Colaboración:** solicitudes de recursos visibles para todos, presupuestos asignados por subsistema (reasignar requiere negociar), **Go/No-Go compartido** con voto por rol y motivo del No-Go, eventos en operación que exigen a varios roles.
- **Sala de control compartida** con avatares (astronauta del proyecto), chat de texto, *pings* sobre la nave y voz opcional por WebRTC.
- **Puntuación de colaboración** (solicitudes resueltas, tiempo de respuesta a eventos).
- Modo cooperativo.

## Entregables previstos

- [x] `apps/game-server` con sala `MissionRoom` y esquema de estado sincronizado.
- [x] Capa de cliente que alterna entre motor local (solitario) y servidor (sala) con la misma interfaz.
- [x] Roles, permisos por rol y solicitudes de recursos.
- [x] Go/No-Go con votación.
- [x] Sala de control con avatares, chat y pings; voz opcional (voz opcional no implementada; pings en la vista orbital tampoco).
- [x] Tests de integración servidor-motor (mismo resultado que el motor local con la misma semilla).

## Criterios de aceptación previstos

- [x] Cuatro clientes completan una misión sin desincronizaciones (`network.test.ts` con 4 clientes SDK y `room-e2e.test.ts`; falta la prueba con 4 personas reales, ver hito).
- [x] El resultado de una sala es idéntico al de `runMission` con el mismo diseño y semilla.
- [x] Un cliente que se desconecta puede volver a la sala y recupera el estado.
- [x] Un No-Go exige motivo y devuelve a todos al diseño.
- [x] `pnpm validate` en verde, incluidos los tests del servidor.

## Resultado

- **Validación independiente 2026-11-09:** segunda pasada y verificación de N1-N6; `pnpm validate --force --concurrency=1` en verde (11/11 tareas, 0 en caché). Tests: `@payload/shared` 335, `@payload/client` 122, `@payload/game-server` 78 (535 en total). Paridad: la sala produce el mismo `MissionResult` que `runMission` con todos los fixtures válidos.
- **Hito de salida (*cuatro jugadores estables en una misión*):** pendiente de prueba humana con 4 personas en equipos distintos (red local); ver `docs/STATUS.md`, acciones 11-14.
- **Fuera de alcance / pendiente:** voz WebRTC (opcional, no implementada), pings en la vista orbital, Redis (ADR 0010).
- **Documentos:** contrato en [`docs/MULTIPLAYER.md`](../MULTIPLAYER.md); decisiones en [ADR 0009](../adr/0009-servidor-autoritativo-colyseus.md) y [ADR 0010](../adr/0010-presencia-y-escalado.md); servidor en [`apps/game-server/README.md`](../../apps/game-server/README.md); estado en [`docs/STATUS.md`](../STATUS.md).
