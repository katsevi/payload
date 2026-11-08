# 0007 · Fase 1 en solitario antes que el multijugador

- Estado: aceptada
- Fecha: 2026-11-07

## Contexto
El mayor riesgo es el alcance: el 3D en primera/tercera persona y el multijugador pueden consumir el tiempo del núcleo, que es la simulación de compromisos.

## Decisión
Construir primero una **rebanada vertical en solitario** (hangar, un escenario LEO, panel de recursos, motor con tests, lanzamiento, operación, informe). El multijugador (Colyseus, roles, Go/No-Go compartido) va en la fase 3, cuando el núcleo ya se haya validado con jugadores. En solitario un único jugador asume los cuatro roles.

## Consecuencias
- Se valida el valor del juego antes de invertir en red.
- El motor se diseña desde ya para correr en servidor (ADR 0003), de modo que la fase 3 no lo reescriba.
- `apps/game-server` y `apps/api` quedan como marcadores.
- Si el objetivo es un hackatón, la entrega mínima es la fase 1 más una sala cooperativa básica de la fase 3.
