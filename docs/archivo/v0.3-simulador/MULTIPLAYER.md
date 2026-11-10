# Multijugador (fase 3) — contrato entre motor, servidor y cliente

> Estado: **implementado y validado (2026-11-09)**; describe lo que hace el código. Documento de referencia para quien toque `packages/shared` (tipos y lógica pura del equipo),
> `apps/game-server` (Colyseus) o `apps/client` (capa de red y UI de sala). Decisión de fondo:
> [ADR 0009](adr/0009-servidor-autoritativo-colyseus.md). Presencia y escalado (Redis): [ADR 0010](adr/0010-presencia-y-escalado.md). Si cambias algo de este contrato, actualiza este
> archivo en el mismo cambio.

## Principios

1. **Servidor autoritativo que corre el mismo motor.** La sala (`MissionRoom`) guarda el diseño, la
   fase y la simulación; los clientes solo envían **acciones** (`TeamAction`). El servidor valida con
   la lógica pura de `@payload/shared` (permisos, fases, solicitudes, votos) y recalcula con
   `computeBudgets`/`reviewGoNoGo`. Nada de fórmulas duplicadas en servidor ni en cliente.
2. **Paridad.** Tras el Go: `preLaunch = rollPreLaunchEvents(design, cat, seed)` y
   `sim = createMissionSim(design, cat, { seed, preLaunch })`. El `MissionResult` de la sala es
   **idéntico** (deep-equal) a `runMission(design, cat, { seed, preLaunch })`. La puntuación de
   colaboración **no** entra en `MissionResult`: va aparte (`collaboration`, `teamScore`).
3. **Lógica de equipo pura y determinista en `shared`.** Roles, permisos, impacto de una acción,
   solicitudes, reparto de presupuesto, votos, alertas y puntuación de colaboración son funciones
   puras (sin reloj: los tiempos los pasa quien llama, en segundos de sala). Sin `Math.random`/`Date.now`.
4. **Todo texto del servidor es `MessageRef`** (`sim:team.*`). El texto libre de los jugadores (chat,
   notas, motivo `other` del No-Go) es contenido de usuario, no texto de interfaz.
5. **El cliente tiene una sola interfaz** para solitario (motor local) y sala (servidor): la UI y las
   escenas siguen leyendo los mismos stores; solo cambia quién los escribe.

## Roles y permisos

Los 4 roles son los de los asesores (`TeamRole = AdvisorRole`: `director`, `engineering`, `science`,
`operations`). Con menos de 4 jugadores un jugador agrupa roles (`combineRoles`).

| Rol | Decide (permisos) | Resuelve solicitudes de |
| --- | --- | --- |
| `director` | órbita, lanzador, reparto de presupuesto, empezar diseño, confirmar lanzamiento, tiempo, terminar operación, rediseñar | `budget`, `time` |
| `engineering` | piezas de `structure`, `power`, `battery`, `obc`, `adcs`, `thermal` | `mass`, `power`, `battery` |
| `science` | piezas de `payload` | — |
| `operations` | piezas de `comms`, tiempo de la operación | `data`, `comms`, `lifetime` |

Todos: pedir la revisión, votar por su(s) rol(es), crear solicitudes, chat y pings. El anfitrión
(primer jugador; si se va, el siguiente) reparte roles y empieza la misión desde el lobby.

Reparto por defecto (`combineRoles`): 1 jugador = los 4 · 2 = `[director, operations]` + `[engineering, science]` ·
3 = `[director, operations]` + `[engineering]` + `[science]` · 4 = uno cada uno (respetando preferencias si se puede).

## Solicitudes de recursos (negociación)

- **Automáticas:** si una acción de diseño de un jugador **empeora** el estado de un recurso que
  pertenece a un rol que ese jugador no tiene (`ok → tight|over`, `tight → over`, y el recurso es
  evaluable antes y después, `available > 0`), la acción **no se aplica**: queda en espera dentro de
  una `ResourceRequest` dirigida al rol dueño (`RESOURCE_OWNER`), con `amount` = lo que sube el uso.
  Ejemplo: Ciencia monta un instrumento de +40 W con poca energía libre → solicitud a Ingeniería.
  Si el jugador también tiene el rol dueño (roles combinados), la acción se aplica directamente.
- **Reparto de presupuesto:** si la Dirección repartió el presupuesto por subsistema
  (`SubsystemAllocation`, MUSD), montar una pieza que deja su subsistema por encima de lo asignado
  genera una solicitud a `director` (`resource: 'budget'`, `subsystem`, `amount` = exceso). Aprobarla
  aplica la acción **y** sube la asignación de ese subsistema. Sin reparto (`null`) no hay topes.
- **Explícitas:** cualquiera puede pedir (`request-resource`; `checkTeamAction` devuelve `request` también para ellas), p. ej. más presupuesto para un
  subsistema. Aprobar una de presupuesto con `subsystem` sube su asignación; las demás no tienen efecto
  mecánico (cuentan para la colaboración).
- **Aprobaciones encadenadas** (`applyApprovedRequest`): si la acción en espera empeora además recursos de OTROS roles, aprobarla no la aplica aún: se crea una nueva solicitud para el siguiente rol dueño (`approvedBy` acumula los roles conformes; ≤ 4 pasos) y se aprueba rol a rol. `request-created` también se envía en las encadenadas.
- Aprobar re-aplica la acción en espera sobre el diseño ACTUAL (si ya no tiene sentido, se marca
  rechazada con motivo). Rechazar admite nota ("propón otra solución"). Todas son visibles para todos.
  Al pedir la revisión, las solicitudes abiertas quedan abiertas (cuentan como no resueltas). Un rediseño (`redesign`) las limpia TODAS: la colaboración se mide por intento.
- **Fases:** `allocate-budget` vale en `briefing` y `design`; `resolve-request` y `withdraw-request`, solo en `design`.
- **Límites** (`TEAM_LIMITS`): cubeta de fichas por jugador, `requestBurst` (3) repuestas a una cada `requestMinIntervalS` (2 s), también para las automáticas (`takeRequestToken` → `team.reject.requestRateLimited { seconds }`; las encadenadas al aprobar no gastan fichas); historial de `requestHistory` (100) cerradas, las abiertas nunca se purgan (`purgeRequests`; la colaboración no cambia gracias a `CollaborationInput.purged`), `maxOpenRequestsPerPlayer` (5 → `tooManyRequests`), sin duplicadas (`requestPending`) y `maxComponents` (40 → `tooManyComponents`).

## Go/No-Go compartido

1. Cualquiera pide la revisión (`request-review`) en `design`. El servidor calcula `reviewGoNoGo`.
2. Si el motor da **No-Go** (hay blockers): todos vuelven a `design` con `lastNoGo = { source: 'review', issues }`.
3. Si da **Go**: fase `review` y se abre la votación. Cada rol vota (`vote` con `role`; **un voto por rol**, votar otra vez lo reemplaza); un jugador con
   varios roles vota por cada uno. **Un `no-go` exige motivo** (`NoGoReason`: `code` = recurso,
   `requirements`, `risk` u `other`; `other` exige `note` no vacía). Un `go` se rechaza si el motor da No-Go.
4. El primer `no-go` válido cierra la votación: todos vuelven a `design` con
   `lastNoGo = { source: 'vote', votes }` (motivos visibles para todos). `lastNoGo` es `{ source: 'review', issues }` si lo cerró el motor y `{ source: 'vote', votes }` si lo cerró un voto.
5. Con los 4 roles en `go` → `prelaunch`: el servidor sortea `rollPreLaunchEvents`; si no hay eventos
   pasa directo a `launch`; si los hay, la Dirección confirma (`confirm-launch`).

## Operación

- Al entrar en `launch` el servidor crea la `MissionSim` (el resultado del lanzamiento va en el primer
  snapshot). Pasa a `operation` cuando todos los conectados envían `launch-done` o tras
  `TEAM_LIMITS.launchScreenMaxS` (25 s); si el lanzamiento falló, va a `report`.
- El servidor avanza la simulación con un intervalo fijo (`sim.step(dtReal × accel)`, ~10 Hz) y
  sincroniza `simT`, `accel` y el snapshot. `accel` ∈ `TEAM_TIME_SCALES` (`[0, 1, 10, 100, 1000, 10000]`);
  la cambian `director` y `operations`.
- **Alertas de equipo:** los eventos de `EVENT_RESPONSE_ROLES` (tormenta solar, falla de rueda,
  basura espacial, falla de componente, sobrecalentamiento, batería agotada) abren una `TeamAlert`
  que pausa la simulación hasta que respondan (`ack-alert`) todos los roles exigidos o pase
  `TEAM_LIMITS.alertTimeoutS` (45 s); luego se reanuda a la aceleración anterior. Responder **no altera la simulación**
  (la paridad manda): mide la coordinación y el tiempo de respuesta, y la mascota explica el evento. Una alerta abierta cuando termina la misión se cierra sin `timedOut`.
- `finish-operation` (Dirección) o el final natural → `report`: `result = sim.finish()`,
  `collaboration = scoreCollaboration(...)`, `teamScore = withCollaboration(result.score, collaboration.score)`.
- `redesign` (Dirección, desde `report`): intento + 1, mismo diseño, vuelve a `design`.
- **Los clientes pueden reflejar la simulación** (recomendado): con `seed`, `preLaunch` y `design`
  crean la misma `MissionSim` y la avanzan hasta `simT` del servidor (nunca más allá). Por
  determinismo, su snapshot coincide con el del servidor; el servidor sigue siendo la fuente de verdad
  del resultado (el cliente implementado lo hace: `useSim.mirrorStart`/`tick`).
- **Limitación:** el servidor no publica su reloj de sala; el cliente lo estima (mayor `atS` visible + reloj local) para horas relativas y la cuenta atrás de las alertas.

## Semillas

Semilla = `defaultSeed` del escenario + intento. El intento de una sala empieza en 0 y sube con
`redesign`. Las opciones de creación `seed` y `attempt` (fijan la semilla de la sala) solo valen en desarrollo/test (`PAYLOAD_ALLOW_SEED=1` o `NODE_ENV=test`); en producción se ignoran.

## Mascota única por sala

El servidor decide qué dice la mascota y lo publica en el estado (`mascot = { trigger, variant, seq, atS }`);
cada cliente muestra `pickMascotDialogue(trigger, catalog.mascot, variant)`, así todos ven lo mismo.
En sala el cliente **no** genera disparadores automáticos propios; la ayuda personal con `H` sigue siendo local.
Prioridades y moderación (cola con prioridad, hueco mínimo de 6 s, `phase:*` una vez por intento, charla cada 120 s): `apps/game-server/CLAUDE.md` (`mascotDirector.ts`). Disparadores nuevos (validados con zod): `team:<valor>` (lista cerrada `TEAM_MASCOT_TRIGGERS`) y
`role:<TeamRole>` (presentación del rol). El servidor además usa `phase:*`, `event:*` (los frecuentes
solo la primera vez), `review:*` y `report:*`.

## Protocolo (Colyseus)

- Sala `mission` (`maxClients` = `ScenarioDef.team.maxPlayers`, o 4 si el escenario no lo define; los escenarios de equipo como `polar-ice-watch-team` (2-4 jugadores) exigen `team.minPlayers` conectados para `start-mission` → `team.reject.notEnoughPlayers`, y no aparecen en la campaña en solitario). Emparejamiento rápido: `joinOrCreate('mission', { scenarioId, name })`
  filtrado por `scenarioId` y solo salas en `lobby`. Sala privada: `create('mission', { scenarioId, name, private: true })`;
  el código para invitar es el `roomId` y se entra con `joinById(code, { name })`. Al salir del lobby la sala se bloquea (`lock`).
- Reconexión: el servidor espera `TEAM_LIMITS.reconnectGraceS` (60 s) a un cliente caído (`allowReconnection`);
  conserva sus roles. El cliente guarda el `reconnectionToken` en `sessionStorage['payload.room.token']` y lo conserva durante la gracia ante cierres no consentidos; ofrece `retryRoom()`/`dismissRetry()` (SDK con `minUptime` 0).
  Si no vuelve, sus roles pasan SOLO a los jugadores conectados (cada rol al que tenga menos; si no queda nadie conectado, quedan «aparcados» en el más antiguo y pasan al primero que vuelva) y, si era anfitrión, el anfitrión pasa al siguiente.
- **Errores de creación/entrada** (`MatchMakeError` 526, mensaje estable): `invalid-scenario`, `academy-scenario`, `invalid-attempt`, `invalid-seed`, `room-not-in-lobby`, `room-full`, `already-joined`; el cliente los traduce como `room.error.<camelCase>`; además, `room.error.locked` cubre el 522 «is locked» de Colyseus (sala llena o ya empezada), distinto de `notFound`.
- **Cliente → servidor:** un único mensaje `action` con un `TeamAction` (validado con `teamActionSchema`, zod,
  exportado por `shared`), más `move` (pose del avatar, ≤ 10 Hz, efímero; un `move` inválido se descarta en silencio).
- **Servidor → cliente:** el estado sincronizado (esquema Colyseus que refleja `RoomStateWire`) y el mensaje
  `notice` (`ServerNotice`: acción rechazada con su `MessageRef`, `request-created`, ping efímero), que llega DESPUÉS del parche de estado.
- **Estado:** el esquema del servidor refleja **exactamente** `RoomStateWire` (tipos de `shared`): primitivos,
  `players` como mapa por `sessionId`, `componentIds` como array, y los objetos profundos o de lista
  (`requests`, `votes`, `alerts`, `events`, `chat`, `preLaunch`, `result`...) como cadenas JSON.
  El cliente hace `decodeRoomView(room.state.toJSON())` → `RoomView` (objeto plano). Los números no enteros (`simT`, `simAccel`, `seed`, pose) van en `float64` porque `t.number()` manda float32. El servidor usa
  `encodeRoomView(view)` para escribir el esquema. Ambos están en `shared` con test de ida y vuelta.
- Límites: nombre 1-24 caracteres; chat 1-280 caracteres sin caracteres de control, se guardan los
  últimos 50 (y 200 eventos); nota de solicitud o de No-Go ≤ 280; chat 1 mensaje/s, ping 1 cada 2 s (`team.reject.rateLimited`), `move` ≤ 10 Hz; `maxMessagesPerSecond` = 40 por cliente en el servidor (Colyseus desconecta al que lo pase). `abuse.test.ts` fija el estado por debajo de 300 KB.

## Tipos (resumen; la fuente de verdad es `packages/shared/src/types.ts`)

```ts
type TeamRole = AdvisorRole;
type RoomPhase = 'lobby' | 'briefing' | 'design' | 'review' | 'prelaunch' | 'launch' | 'operation' | 'report';
type SubsystemAllocation = Partial<Record<SubsystemId, number>>;          // MUSD por subsistema
type GoNoGoVoteValue = 'go' | 'no-go';
type NoGoReasonCode = ResourceId | 'requirements' | 'risk' | 'other';
interface NoGoReason { code: NoGoReasonCode; note?: string }
type PingTarget =
  | { kind: 'subsystem'; id: SubsystemId } | { kind: 'component'; id: string }
  | { kind: 'resource'; id: ResourceId } | { kind: 'point'; position: [number, number, number] };

type TeamAction =
  | { type: 'set-name'; name: string }
  | { type: 'claim-roles'; roles: TeamRole[] }          // reemplaza mis roles (rechaza roles de otro)
  | { type: 'auto-assign-roles' }                       // anfitrión
  | { type: 'start-mission' }                           // anfitrión: lobby → briefing (4 roles cubiertos)
  | { type: 'start-design' }                            // director: briefing → design
  | { type: 'add-component'; componentId: string }
  | { type: 'remove-component'; componentId: string }   // quita la última unidad
  | { type: 'select-orbit'; orbitId: OrbitId | null }
  | { type: 'select-launcher'; launcherId: string | null }
  | { type: 'allocate-budget'; allocation: SubsystemAllocation | null }
  | { type: 'request-resource'; resource: ResourceId; amount?: number; subsystem?: SubsystemId; note?: string }
  | { type: 'resolve-request'; requestId: string; approve: boolean; note?: string }
  | { type: 'withdraw-request'; requestId: string }
  | { type: 'request-review' }
  | { type: 'vote'; role: TeamRole; value: GoNoGoVoteValue; reason?: NoGoReason }
  | { type: 'confirm-launch' }
  | { type: 'launch-done' }
  | { type: 'set-time-scale'; accel: number }
  | { type: 'ack-alert'; alertId: string; role: TeamRole }
  | { type: 'finish-operation' }
  | { type: 'redesign' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; target: PingTarget };
```

Más: `ResourceRequest`, `TeamVote`, `NoGoRecord`, `TeamAlert`, `ChatMessage`, `MascotCue`, `TeamPlayer`,
`CollaborationScore`, `ServerNotice`, `RoomView`, `RoomStateWire` y las funciones puras `checkTeamAction`,
`combineRoles`, `subsystemSpend`, `validateAllocation`, `validateVote`, `tallyGoNoGo`,
`scoreCollaboration`, `withCollaboration`, `encodeRoomView`/`decodeRoomView` (detalle en `packages/shared/CLAUDE.md`).

## No implementado (límites conocidos)

- **Voz WebRTC:** opcional y no implementada (el chat de texto sí).
- **Pings en la vista orbital:** no implementados (sí en el hangar y en el modo accesible 2D).
- **Redis / varias instancias:** no; un proceso (ADR 0010).
