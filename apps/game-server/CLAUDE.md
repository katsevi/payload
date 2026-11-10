# @payload/game-server — servidor de juego (fase 3)

Servidor autoritativo **Colyseus 0.18** (`@colyseus/core` + `@colyseus/ws-transport`, schema 5) con la sala
`mission` de hasta 4 jugadores. Corre el MISMO motor de `@payload/shared`: los clientes solo envían
acciones (`TeamAction`); la sala valida con la lógica de equipo de shared, recalcula y simula.
Contrato completo (protocolo, roles, solicitudes, Go/No-Go, operación, mascota): **`docs/MULTIPLAYER.md`**.
Presencia y escalado (un proceso, sin Redis): `docs/adr/0010-presencia-y-escalado.md`.

## Estructura (`src/`)

| Archivo | Qué hace |
| --- | --- |
| `roomModel.ts` | **Modelo PURO de la sala** (sin Colyseus ni reloj): `RoomView` + `MissionSim` + contadores (`req-N`, `alert-N`, `msg-N`). `join/drop/reconnect/leave`, `apply(playerId, raw, nowS) → Outgoing[]`, `move`, `tick(dtS, nowS)`. Toda la lógica de fases vive aquí (cabecera del archivo). Inmutable: cada cambio crea una `view` nueva |
| `mascotDirector.ts` | Mascota única por sala: cola con prioridad, hueco mínimo de 6 s, moderación (`phase:*` una vez por intento, eventos de órbita la primera vez, charla cada 120 s), solo disparadores con diálogo en `catalog.mascot` |
| `schema.ts` | Esquema Colyseus (`schema()` + `t.*`, sin decoradores) que refleja EXACTAMENTE `RoomStateWire`/`PlayerWire`, y `StateWriter`: codifica con `createCachedEncoder` (idéntico a `encodeRoomView` de shared, con el JSON de cada objeto cacheado por referencia en un WeakMap: el `result` o un evento no se re-serializan) y escribe SOLO lo que cambia (arrays por índice, recorte por delante, jugadores campo a campo). Números no enteros en `t.float64()` (`t.number()` los manda como float32) |
| `MissionRoom.ts` | Adaptador Colyseus: opciones, mensajes `action`/`move`, avisos `notice` (después del parche), ciclo de vida (`onJoin`, `onDrop` + `allowReconnection`, `onReconnect`, `onLeave`), `lock()` al salir del lobby, metadatos `{ scenarioId, phase, players }`, tick a `simTickHz` |
| `options.ts` | Opciones de creación (`scenarioId`, `private`; `attempt` y `seed` SOLO dev/test, porque eligen la semilla) con errores de código estable |
| `server.ts` | `createGameServer({ port, host?, handleSignals?, greet? })` → `{ server, port, close() }` (tests e `index.ts`) |
| `index.ts` | Proceso real: `PORT` (2567), `HOST`, cierre limpio con SIGINT/SIGTERM |
| `__tests__/` | `abuse` (40 msg/s durante 60 s: el estado queda < 300 KB), `parity` (todos los fixtures `valid` ⇒ mismo `MissionResult` que `runMission`), `roomModel` (fases, permisos, solicitudes, reparto, votos, alertas, rediseño, salidas, chat, pings, move), `mascot`, `schema` (deltas decodificados por reflexión), `options`, `network` (servidor real + clientes `@colyseus/sdk`: CORS, emparejamiento, 4 clientes, reconexión, No-Go) |

## Comandos

```bash
pnpm dev:server                                  # desde la raíz: tsx watch, ws://localhost:2567
pnpm --filter @payload/game-server typecheck     # tsc (incluye la fuente de shared que importa)
pnpm --filter @payload/game-server test          # vitest (~8 s; los de red usan un puerto libre)
pnpm --filter @payload/game-server build         # esbuild → dist/index.js (shared + zod dentro; @colyseus/* externo)
pnpm --filter @payload/game-server start         # node dist/index.js
```

## Reglas

- **Nada de lógica de juego en el adaptador ni fórmulas propias**: todo pasa por `RoomModel`, que usa
  `checkTeamAction`, `applyApprovedRequest`, `validateVote`/`tallyGoNoGo`, `alertForEvent`…, `reviewGoNoGo`,
  `rollPreLaunchEvents`, `createMissionSim` y `scoreCollaboration`/`withCollaboration` de shared.
- **Paridad**: tras el Go, `preLaunch = rollPreLaunchEvents(design, cat, seed)` y
  `createMissionSim(design, cat, { seed, preLaunch })`; el informe usa `sim.finish()`. Ningún cambio puede
  romper `parity.test.ts` ni la comprobación de `network.test.ts`.
- **Sin reloj ni azar en el modelo**: el tiempo entra como `nowS` (segundos de sala). Los tests lo controlan.
- **Todo texto al jugador es `MessageRef`** (`sim:team.*`). Los errores de creación/entrada llegan como
  `MatchMakeError` (código 526) con un mensaje estable: `invalid-scenario`, `academy-scenario`, `invalid-attempt`,
  `invalid-seed`, `room-not-in-lobby`, `room-full`, `already-joined`. El cliente los traduce con
  `room.error.<código en camelCase>` (p. ej. `room.error.invalidScenario`, `room.error.roomNotInLobby`).
- **Estado acotado (anti-abuso)**:
  - Un voto por rol (votar otra vez lo sustituye).
  - Solicitudes: cubeta de fichas por jugador (`takeRequestToken`): ráfaga de `requestBurst` (3) y luego una ficha
    cada `requestMinIntervalS` (2 s). La gastan las solicitudes que inicia el jugador (automáticas y
    `request-resource`); sin ficha ⇒ `team.reject.requestRateLimited {seconds}` y no se crea ni se monta nada. Las
    encadenadas al aprobar no gastan fichas. Además `maxOpenRequestsPerPlayer` (5) abiertas y nada de duplicadas
    (`tooManyRequests`, `requestPending`, de `checkTeamAction`).
  - Historial de solicitudes: tras cada cambio, `purgeRequests` deja todas las abiertas y como mucho
    `requestHistory` (100) cerradas (primero se purgan las retiradas). Los acumulados de lo purgado (`purged`) viven
    en la memoria del modelo (no en `RoomView`), se pasan a `scoreCollaboration` en el informe (misma nota que con la
    lista completa) y se reinician en `redesign`. Toda escritura de la lista pasa por `RoomModel.setRequests`.
  - `maxComponents` (40); chat 1 s y ping 2 s (`team.reject.rateLimited`); 50 mensajes y 200 eventos guardados;
    `move` ≤ 10 Hz (lo de más se descarta sin aviso); Colyseus desconecta a quien pase de 40 mensajes/s.
  - `abuse.test.ts` fija que el estado no pasa de 300 KB a 40 msg/s ni en 30 min de pedir y retirar/rechazar, y que
    la colaboración con purga es idéntica a la de la lista completa.
- **Jugadores y roles**: tope = `team.maxPlayers` del escenario (o 4); `start-mission` exige `team.minPlayers`
  conectados en los escenarios de equipo (`notEnoughPlayers`). Al irse alguien del todo (fuera del lobby), SUS roles
  van SOLO a jugadores conectados (cada rol al que tenga menos; a igualdad, el que llegó antes) y nadie pierde los
  suyos; si no queda nadie conectado, se aparcan en el más antiguo y pasan al primero que vuelva.
- Pasa SIEMPRE el contexto completo a `checkTeamAction` (`actorId`, `requests`, `players`, `alerts`, `catalog`).
- El esquema refleja `RoomStateWire` campo a campo (hay una comprobación de tipos que falla si el contrato
  gana un campo que el esquema no tiene). Cambios en `types.ts`: solo aditivos o ADR, y los hace `sim-engine`.
- No toques `apps/client` (capa de red: agente `client-3d`) ni el catálogo (`content-designer`).

## Cómo probar con varios clientes

- Automático: `network.test.ts` levanta el servidor en un puerto libre y conecta 4 clientes SDK en el mismo
  proceso (crear, `joinById` con el código, roles, diseño con solicitudes, votos, lanzamiento, operación,
  informe; reconexión manual con token y automática del SDK; caída sin vuelta con la gracia acortada vía
  `MissionRoom.reconnectGraceS`).
- A mano: `pnpm dev:server` y `pnpm dev`, y abre el cliente en varias pestañas (cada pestaña es un jugador;
  la del anfitrión crea la sala y comparte el código = `roomId`). Para una partida reproducible arranca con
  `PAYLOAD_ALLOW_SEED=1` y crea la sala con `{ seed }` (o `{ attempt }`).
- Inspección rápida sin cliente: `curl -X POST -H "Content-Type: application/json" -d '{"scenarioId":"leo-earth-observation"}' http://localhost:2567/matchmake/create/mission`.
