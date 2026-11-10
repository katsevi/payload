# @payload/game-server

Servidor de juego multijugador de Payload (**fase 3**): Colyseus 0.18 con la sala `mission` (hasta 4
jugadores, un rol por jugador o roles combinados), estado autoritativo que ejecuta el mismo motor de
`@payload/shared`, Go/No-Go compartido, solicitudes de recursos, chat, pings, reconexión y emparejamiento.

Contrato con el cliente: [`docs/MULTIPLAYER.md`](../../docs/MULTIPLAYER.md) · Guía del paquete: [`CLAUDE.md`](CLAUDE.md) ·
Escalado (sin Redis por ahora): [ADR 0010](../../docs/adr/0010-presencia-y-escalado.md).

## Arrancar

```bash
pnpm install
pnpm dev:server        # desde la raíz del repo: recarga al guardar (tsx watch)
# o, en producción:
pnpm --filter @payload/game-server build
pnpm --filter @payload/game-server start
```

Escucha en `ws://localhost:2567` (WebSocket) y `http://localhost:2567/matchmake/...` (emparejamiento HTTP, con
CORS para cualquier origen, p. ej. el cliente de Vite en `http://localhost:5173`).

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | `2567` | Puerto TCP |
| `HOST` | (todas las interfaces) | Interfaz de red |
| `PAYLOAD_ALLOW_SEED` | — | `1` permite las opciones de creación `seed` y `attempt` (ambas eligen la semilla: partidas reproducibles, solo desarrollo). Sin ella se ignoran (intento 0, semilla del escenario). En tests (`NODE_ENV=test`) siempre están permitidas |

## Conectarse (resumen)

```ts
import { Client } from '@colyseus/sdk';
import { decodeRoomView } from '@payload/shared';

const client = new Client('http://localhost:2567');
const room = await client.joinOrCreate('mission', { scenarioId: 'leo-earth-observation', name: 'Ana' });
// sala privada: client.create('mission', { scenarioId, name, private: true }); código = room.roomId
// unirse con código: client.joinById(code, { name })
room.onMessage('notice', (n) => { /* ServerNotice: rejected | request-created | ping */ });
room.onStateChange(() => { const view = decodeRoomView(room.state.toJSON()); /* RoomView */ });
room.send('action', { type: 'chat', text: 'hola' });          // TeamAction
room.send('move', { x: 0, y: 0, z: 0, yaw: 0 });              // pose del avatar, ≤ 10 Hz
// reconexión: guarda room.reconnectionToken (sessionStorage) y usa client.reconnect(token)
```

Errores de creación o entrada: `MatchMakeError` (código 526) cuyo mensaje es un código estable
(`invalid-scenario`, `academy-scenario`, `invalid-attempt`, `invalid-seed`, `room-not-in-lobby`, `room-full`,
`already-joined`); el cliente lo muestra con la clave `room.error.<código en camelCase>` (p. ej. `room.error.roomFull`).

## Límites

| Límite | Valor | Si se supera |
| --- | --- | --- |
| Jugadores por sala | 4 (o `team.maxPlayers` del escenario); los escenarios de equipo exigen `team.minPlayers` conectados para empezar | `room-full` / `team.reject.notEnoughPlayers` |
| Solicitudes de recursos | ráfaga de 3 por jugador y luego una cada 2 s (también las automáticas; las encadenadas al aprobar no cuentan), 5 abiertas por jugador, sin duplicadas | `team.reject.requestRateLimited` (con los segundos de espera) / `tooManyRequests` / `requestPending` |
| Historial de solicitudes | todas las abiertas y las 100 cerradas más recientes (la colaboración cuenta también las purgadas) | se purgan las más antiguas |
| Votos | uno por rol (votar otra vez sustituye al anterior) | — |
| Piezas montadas | 40 | `team.reject.tooManyComponents` |
| Chat / pings | 1 mensaje/s, 1 ping cada 2 s; se guardan 50 mensajes y 200 eventos | `team.reject.rateLimited` |
| `move` | 10 Hz | se descarta sin aviso |
| Mensajes por cliente | 40/s | Colyseus desconecta al cliente |
| Reconexión | 60 s de gracia; si no vuelve, sus roles pasan a los jugadores conectados | — |

## Tests

`pnpm --filter @payload/game-server test`: paridad sala ↔ `runMission` para todos los diseños válidos de los
fixtures, modelo de la sala, mascota, esquema (deltas y caché), abuso (estado acotado a 40 msg/s) y red real con
4 clientes SDK (CORS, emparejamiento, misión completa sin desincronización, reconexión y No-Go).
