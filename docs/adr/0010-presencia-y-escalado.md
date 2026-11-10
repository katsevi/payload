# 0010 · Presencia y escalado del servidor de juego: un proceso, sin Redis (por ahora)

- Estado: aceptada
- Fecha: 2026-11-09

## Contexto
Colyseus guarda la **presencia** (qué salas existen, reservas de asiento, reconexiones) y el **driver de
emparejamiento** (listado de salas para `joinOrCreate`/`joinById`) en memoria del proceso por defecto
(`LocalPresence` y `LocalDriver`). Con varios procesos o instancias, cada uno solo vería sus salas: un
jugador podría no encontrar la sala de su equipo o reconectar contra otro proceso. El plan original
preveía Redis para presencia y escalado.

En la fase 3 el objetivo es *cuatro jugadores estables en una misión*: un solo proceso Node aguanta de
sobra muchas salas de 4 (la simulación avanza a 10 Hz con paso fijo de 30 s y el estado pesa ~200 KB
como mucho, en el informe). Añadir Redis ahora suma un servicio más que instalar en cada máquina de
desarrollo y en CI sin ningún beneficio con un único proceso.

## Decisión
En la fase 3, `apps/game-server` corre en **un solo proceso** con la presencia y el driver locales de
Colyseus. **No se usa Redis.** El código no depende de esa elección: `createGameServer` (src/server.ts)
es el único sitio que construye el `Server` de Colyseus.

Hará falta Redis cuando haya **más de un proceso o instancia** sirviendo salas: varios núcleos en una
máquina, varias réplicas detrás de un balanceador o el despliegue de la fase 4 en AWS (ElastiCache para
Redis). Se activará así:

1. `pnpm --filter @payload/game-server add @colyseus/redis-presence @colyseus/redis-driver` (versiones 0.18).
2. En `createGameServer`, si existe la variable `REDIS_URL`, pasar
   `presence: new RedisPresence(REDIS_URL)` y `driver: new RedisDriver(REDIS_URL)` al `new Server({...})`;
   sin `REDIS_URL` se mantiene el modo local (desarrollo y tests no cambian).
3. Dar a cada proceso una `publicAddress` alcanzable por los clientes (las reservas de asiento indican a
   qué proceso conectar el WebSocket) y usar afinidad de sesión en el balanceador para el WebSocket.

## Consecuencias
- Desarrollo y CI sin servicios externos: `pnpm dev:server` y los tests levantan el servidor solo.
- Límite conocido: un único proceso es un único punto de fallo y no reparte carga entre núcleos. Si el
  proceso se reinicia, las salas en curso se pierden (los clientes no pueden reconectar a una sala que ya
  no existe).
- Pasar a varios procesos es un cambio de configuración en `createGameServer` más una variable de
  entorno; la lógica de la sala (`RoomModel`) y el protocolo con el cliente no cambian.
