# Cooperativo: contrato de red (fase 6)

Contrato entre `apps/game-server` y `apps/client` para jugar de 1 a 4 personas la misma partida.
Decisiones: ADR 0017 (y 0009, 0010, 0012). Tipos y validación: `packages/shared/src/net.ts`.
El contrato del simulador anterior está en `docs/archivo/v0.3-simulador/MULTIPLAYER.md` y no aplica.

## Idea

- **El servidor corre la partida.** Una sala tiene una sola `Run` del motor (`createRun`) con un tripulante
  por jugador. Avanza a paso fijo (0,1 s) con su reloj y aplica las `RunAction` que llegan.
- **El cliente refleja.** Guarda una `Run` local que nunca avanza: se hidrata (`run.hydrate`) con cada
  estado del servidor. Sirve para leer el estado y para las consultas (`estimateJump`, `stationQuote`…).
- **Autoridad dividida en superficie** (ADR 0012): cada cliente simula su movimiento y lo informa
  (`set-position`, `jetpack`, `fall-impact`); el motor del servidor manda en recursos y consecuencias.
- **Sin predicción ni rollback.** El cliente valida cada acción contra el último estado recibido (respuesta
  inmediata de «se puede / no se puede») y el cambio se ve cuando vuelve del servidor (≤ 0,1 s más la red).

## Sala

- Sala `crew` de Colyseus 0.18, **privada**: no hay emparejamiento. El código de sala es el `roomId`
  (4 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789`). Se crea con `create('crew', { name })` y se entra
  con `joinById(código, { name })`.
- Hasta 4 jugadores. El primero es el anfitrión; si se va, pasa al siguiente conectado.
- **Lobby:** cada jugador elige rol (opcional, único en la sala) y se marca listo. El anfitrión empieza
  cuando los demás conectados están listos. Una persona sola puede empezar.
- Al empezar, la sala se bloquea: nadie entra a una partida en curso (`in-progress`). Los jugadores, por
  orden de entrada, reciben `crewId` 1..n.
- **Misión o partida libre (ADR 0020):** el anfitrión elige la misión (`set-mission`) o deja la partida libre. Con
  misión, todos editan el diseño compartido (`edit-design`, ediciones discretas que valida `applyDesignEdit`) y votan
  Go/No-Go (`vote`). Cada cambio del diseño borra los votos. El anfitrión zarpa cuando la revisión del motor da Go y
  vota Go la **mayoría estricta** de los conectados (empate = No-Go); sin misión, cuando los demás están listos. La
  sala crea `createRun({ seed, crewSize, roles, design })`; el cliente crea su espejo con ese mismo diseño antes de
  hidratarlo (la nave base y el mapa del sistema solar salen del diseño, no del estado).
- **Fin:** tras perder o terminar la misión (`science.over`), el anfitrión envía `restart` y la sala vuelve al lobby
  con el mismo diseño (sin votos).
- Errores de entrada (`ServerError`): `room-full`, `in-progress`.
- Opción de creación solo para desarrollo y tests (`PAYLOAD_ALLOW_SEED=1` o `NODE_ENV=test`): `seed`.

## Mensajes

No se usa el estado sincronizado de Colyseus (esquema): todo va por mensajes. Nombres en `NET`.

### Cliente → servidor

| Mensaje | Carga | Notas |
| --- | --- | --- |
| `lobby` | `LobbyAction`: `set-role {role}`, `set-ready {ready}`, `start`, `restart`, `set-mission {missionId \| null}`, `edit-design {edit: DesignEdit}`, `vote {go: true \| false \| null}` | `start`, `restart` y `set-mission` solo del anfitrión; editar y votar, cualquiera, en el lobby |
| `action` | `{ seq, action: RunAction }` | El servidor pone el `crewId` de quien envía |
| `pose` | `CrewPose { x, y, z, yaw, area: 'ship' \| 'surface' }` | Efímera, ≤ 10 Hz; no entra en el motor |
| `ping` | `{ kind: 'look' \| 'danger' \| 'help', x, y, z, area }` | Como mucho uno cada 0,4 s |

### Servidor → cliente

| Mensaje | Carga | Cuándo |
| --- | --- | --- |
| `lobby` | `LobbyView { code, phase, runId, players[] (con `vote`), design, designRev }` | Al entrar, al reconectar y cada vez que cambia (también al editar o votar) |
| `state` | `{ tick, state, sector? }` | Tras cada paso fijo (10 Hz). `state` es el `RunState` sin `sector`; `sector` solo viaja cuando cambia, al empezar y al reconectar |
| `events` | `RunEvent[]` | Los eventos del motor de ese avance (sonidos, avisos) |
| `result` | `{ seq, reason: MessageRef }` | Solo rechazos, y solo a quien envió la acción |
| `poses` | `Record<crewId, CrewPose>` | Cuando cambian, a ≤ 10 Hz |
| `ping` | `{ crewId, kind, x, y, z, area }` | A todos, incluido quien lo envió |

Tamaño medido: `state` ≈ 2,4-3,5 kB (sin el sector, ≈ 1,8 kB) a 10 Hz.

## Autoridad y antiabuso

- **Nadie actúa por otro:** el servidor sustituye `crewId` por el del jugador que envía en las acciones
  de tripulante (`work-incident`, `repair-system`, `evade`, `eva-exit`, `eva-enter`, `set-position`,
  `jetpack`, `fall-impact`, `deploy-tool`, `collect`, `retrieve-tool`).
- **Trabajo mantenido** (`work-incident`, `repair-system`, `jetpack`): los `seconds` de un jugador no
  pueden sumar más que el tiempo real transcurrido (presupuesto de hasta `MAX_WORK_SECONDS`, con un 15 %
  de holgura por la red). Enviar cien mensajes no repara cien veces más rápido.
- **Movimiento:** el límite de velocidad de `set-position` ya lo impone el motor.
- **Minijuegos:** el resultado (`evade {grazes}`, trabajo entregado) lo informa el cliente y el servidor lo
  acepta dentro de esos límites. Es un cooperativo sin rivales: se prefiere tolerancia a rigor.
- Una acción con campos imposibles se rechaza (`reject.invalid`) y nunca tira la sala.
- Más de 60 mensajes por segundo de un cliente es abuso (Colyseus lo desconecta).

## Cliente: qué envía y cómo

- Las acciones pasan por `useGame.getState().act(action)` como en solitario. En sala, `act` valida en el
  espejo con mi `crewId`, deshace el cambio y, si era válida, la envía.
- La posición y el trabajo mantenido se **agrupan** y salen cada 66 ms (un mensaje por tipo y objetivo, no
  uno por frame). El resto sale al momento, después de vaciar lo agrupado.
- Los eventos personales de otro tripulante (su traje, su esclusa, su mochila) no suenan ni avisan.
- En sala no hay pausa: los paneles `pause`, `settings` y `credits` no detienen nada.

## Caídas y reconexión

- Caída sin despedirse: el servidor guarda sitio, rol y tripulante 60 s (`reconnectGraceS`). El SDK del
  cliente reintenta solo; al volver recibe `lobby` y un `state` entero.
- Si no vuelve a tiempo o sale a propósito, sale de la lista de jugadores y **su tripulante se queda en el
  estado**: a bordo, sin hacer nada; fuera, hasta que se le acabe el oxígeno.
- Sin nadie conectado, el tiempo de la partida no avanza. Cuando no queda nadie con sitio, la sala se cierra.

## Roles

Cuatro roles en `packages/shared/catalog/roles.json`. Solo dan **ventajas pasivas**; ningún puesto se
bloquea y jugar sin rol es válido. La ventaja se aplica cuando la acción la hace quien tiene el rol.

| Rol | Ventaja |
| --- | --- |
| Piloto | La maniobra evasiva cuesta la mitad de combustible y los roces hacen un 25 % menos de daño |
| Ingeniero | Averías y reparaciones con repuesto un 30 % más rápidas |
| Gestor de recursos | Ninguna por ahora (decisión abierta) |
| Explorador | Mochila un 25 % mayor y jetpack un 20 % más eficiente |

Los créditos y las mejoras son de toda la tripulación (un único `RunState`): cualquiera puede comprar.

## Cómo probarlo

```bash
pnpm dev:server                          # servidor en ws://localhost:2567 (imprime las direcciones de red local)
pnpm dev                                 # cliente en http://localhost:5173 (un equipo, varias pestañas)
pnpm dev:lan                             # cliente abierto a la red local: http://<ip>:5173 desde los otros equipos
```

El cliente busca el servidor en `ws://<host de la página>:2567`; `VITE_GAME_SERVER_URL` lo cambia.
Menú → Cooperativo → crear sala → compartir el código.

## Tests

- `packages/shared/src/__tests__/coop.test.ts`: roles, `hydrate` (también con diseño de misión) y validación de mensajes.
- `packages/shared/src/__tests__/sharedDesign.test.ts`: ediciones del diseño, ediciones entre dos diseños, voto.
- `apps/game-server/src/__tests__/roomModel.test.ts`: lobby, **paridad con el motor**, antiabuso, caídas.
- `apps/game-server/src/__tests__/network.test.ts`: servidor real y cuatro clientes SDK (sincronía, reconexión).
- `apps/client/src/__tests__/coop.test.ts`: sesión del cliente contra una sala en memoria.

## Fuera de alcance (ver `docs/phases/fase-6.md`)

Voz integrada, predicción con rollback, bloqueo de puestos por rol, salas públicas y dificultad escalada
por número de jugadores.
