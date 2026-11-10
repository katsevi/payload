# 0009 · Servidor autoritativo con Colyseus que corre el mismo motor

- Estado: aceptada
- Fecha: 2026-11-09

## Contexto
La fase 3 exige hasta 4 jugadores cooperando en una misma misión, cada uno con su rol, sin
desincronizaciones y con un resultado que no dependa de quién lo calcule (ADR 0003 ya dejó el motor
puro y determinista para esto). Un servidor que simplemente retransmita estados de los clientes
permitiría trampas y divergencias; duplicar fórmulas en el servidor rompería la regla de "un solo motor".

## Decisión
- **Servidor autoritativo con Colyseus 0.18** (`apps/game-server`, sala `mission`). Corre el **mismo
  motor** de `@payload/shared`; los clientes solo envían `TeamAction` (mensaje `action`) y `move`
  (pose del avatar, efímera).
- **La lógica de equipo es pura y vive en `shared`** (`team.ts`: roles, permisos, solicitudes, reparto de
  presupuesto, votos, alertas, colaboración). El servidor la usa mediante `RoomModel`, un modelo puro y sin
  reloj (el tiempo entra como `nowS`); `MissionRoom` es solo un adaptador de Colyseus.
- **Estado sincronizado = `RoomStateWire`** (`teamWire.ts`): primitivos, `players` como mapa y los objetos
  profundos o listas como cadenas JSON. `encodeRoomView`/`decodeRoomView` (con test de ida y vuelta) pasan
  de la vista plana `RoomView` al esquema y viceversa; el esquema del servidor refleja el contrato campo a
  campo.
- **Paridad:** tras el Go, `preLaunch = rollPreLaunchEvents(design, cat, seed)` y
  `createMissionSim(design, cat, { seed, preLaunch })`; el `MissionResult` de la sala es idéntico al de
  `runMission` con el mismo diseño y semilla. La **colaboración queda FUERA de `MissionResult`**: se calcula
  aparte (`scoreCollaboration`) y se combina con `withCollaboration` en `teamScore`.
- **Mascota única por sala:** la decide el servidor (`mascotDirector`) y la publica en el estado
  (`mascot = { trigger, variant, seq, atS }`); cada cliente muestra el mismo diálogo del catálogo.
- **Los clientes reflejan la simulación** con la misma semilla, diseño y `preLaunch`, y nunca pasan del
  `simT` del servidor; el servidor sigue siendo la fuente de verdad del resultado.
- Contrato detallado: `docs/MULTIPLAYER.md`. Presencia y escalado: ADR 0010.

## Consecuencias
- Ni trampas ni fórmulas duplicadas: un cambio en el motor llega a solitario y a sala a la vez, y los tests de
  paridad (`apps/game-server/src/__tests__/parity.test.ts`) lo vigilan con todos los fixtures de escenarios.
- `types.ts` y `teamWire.ts` pasan a ser contrato de red: solo cambios aditivos (o ADR); hay una comprobación
  de tipos que falla si el esquema no refleja un campo nuevo de `RoomStateWire`.
- Responder a una alerta de equipo no altera la simulación (la paridad manda): mide coordinación, no cambia el
  resultado.
- Un solo proceso Node por ahora (ADR 0010); si se reinicia, las salas en curso se pierden.
- Coste: el estado sincronizado pesa hasta ~200 KB en el informe y exige un `Encoder.BUFFER_SIZE` de 256 KB.
- El cliente debe tener una interfaz única para solitario y sala (`MissionSession`), de modo que la UI no
  conozca la diferencia.
