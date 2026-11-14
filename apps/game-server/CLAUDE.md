# @payload/game-server — servidor del cooperativo (fase 6)

Servidor autoritativo para 1-4 jugadores que corre **el mismo motor** que el cliente (`@payload/shared`).
Colyseus 0.18 sobre WebSocket, un solo proceso. Contrato de red: `docs/MULTIPLAYER.md`. Decisiones:
ADR 0017 (y 0009, 0010, 0012). Lee antes el `CLAUDE.md` raíz y el de `packages/shared`.

## Estructura (`src/`)

| Archivo | Contenido |
| --- | --- |
| `roomModel.ts` | **Toda la lógica**, pura: sin Colyseus ni reloj (el tiempo entra como `nowS` y `dt`). Lobby, roles, la `Run`, quién actúa, presupuesto de trabajo, caídas, poses y pings |
| `CrewRoom.ts` | Adaptador de Colyseus: mensajes, entrada, caída, reconexión, salida y el tick de 10 Hz. Código de sala = `roomId` |
| `server.ts` | `createGameServer({ port })`: único sitio que construye el `Server` de Colyseus |
| `index.ts` | Arranque del proceso (`PORT`, `HOST`, `PAYLOAD_ALLOW_SEED`) |
| `__tests__/roomModel.test.ts` | Lobby, paridad con el motor, antiabuso, caídas, vuelta al lobby |
| `__tests__/network.test.ts` | Servidor real en un puerto libre y clientes `@colyseus/sdk` reales |

## Reglas

- **La lógica va en `RoomModel`, no en `CrewRoom`.** Si algo se puede probar sin red, se prueba sin red.
- **No se duplican tipos ni fórmulas:** todo sale de `@payload/shared`. Los mensajes y su validación
  están en `packages/shared/src/net.ts`; si añades un mensaje, añádelo allí y en `docs/MULTIPLAYER.md`.
- **Paridad obligatoria:** la sala produce el mismo `RunState` y los mismos eventos que el motor con las
  mismas acciones en los mismos pasos. Un cambio que la rompa no entra.
- **Lo que llega de la red no es de fiar:** se valida la forma (`parse*`) y el motor valida el fondo.
  Ninguna entrada puede tirar la sala.
- **El servidor pone el `crewId`** de quien envía. No confíes en el que venga en la acción.
- Mensajes al jugador como `MessageRef`; sin texto en el código.
- Aquí sí se puede usar `Math.random()` y el reloj (semilla de la partida, código de sala), pero nunca
  dentro de lo que decide el resultado de la partida: eso es del motor.

## Comandos

```bash
pnpm dev:server                              # desde la raíz: tsx watch, ws://localhost:2567
pnpm --filter @payload/game-server test
pnpm --filter @payload/game-server typecheck
pnpm --filter @payload/game-server build     # bundle ESM en dist/index.js (esbuild)
pnpm --filter @payload/game-server start     # node dist/index.js
```

## Pendiente conocido

- La sala arranca siempre una partida libre (clásica): aún no se puede elegir misión ni diseño (diseño compartido y voto, `docs/phases/fase-6.md`). El espejo del cliente ya admite estados con diseño.
- Un jugador que se va con su tripulante fuera de la nave bloquea el despegue hasta que se le acaba el oxígeno.
- No hay reanudación tras recargar la página (el SDK reconecta solo si la pestaña sigue abierta).
- Sin Redis ni varias instancias (ADR 0010). Sin despliegue ni TLS (fase 7; el despliegue de AWS Amplify de `docs/despliegue-aws.md` solo sirve el cliente estático).
