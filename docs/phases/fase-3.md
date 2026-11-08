# Fase 3 · Multijugador

**Objetivo:** hasta 4 jugadores cooperando en una misma misión, cada uno con su rol, sobre un servidor autoritativo.

**Hito de salida:** *cuatro jugadores estables en una misión*.

**Prerrequisito:** fase 2 validada. `apps/game-server` es hoy solo un marcador.

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
