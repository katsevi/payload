# 0015 · Cooperativo: estado entero por mensajes, espejo hidratado en el cliente y roles como ventajas pasivas

- Estado: aceptada
- Fecha: 2026-11-13

## Contexto

La fase 4 pide que hasta cuatro personas jueguen la misma partida sin desincronizarse. Los ADR 0009 y 0010
ya fijaron servidor autoritativo con Colyseus en un solo proceso, pero su detalle (esquema sincronizado,
lógica de equipo por turnos) era del simulador anterior. Hay que decidir cómo viaja el `RunState`, cómo
responde el cliente sin simular por su cuenta y qué es un rol.

## Decisión

1. **El estado viaja entero por mensaje, sin esquema de Colyseus.** Tras cada paso fijo (10 Hz) el
   servidor difunde el `RunState` (≈ 3 kB); el mapa del sector solo cuando cambia. Colyseus se usa para
   salas, reconexión y transporte. Evita mantener un esquema paralelo a `types.ts`.
2. **El cliente guarda un espejo de la partida.** `Run.hydrate(state)` (aditivo en el contrato) rellena una
   `Run` local con el estado recibido. Las consultas del motor dan lo mismo que en el servidor y la interfaz
   no cambia entre solitario y sala. El espejo nunca avanza.
3. **Sin predicción.** Cada acción se valida en el espejo, se deshace y se envía; el cambio se ve cuando
   vuelve del servidor. Suficiente para un cooperativo en red local o de baja latencia.
4. **El servidor impone quién actúa** (`crewId`) y limita el trabajo mantenido al tiempo real. Los
   resultados de los minijuegos se aceptan del cliente.
5. **Los roles son ventajas pasivas en datos** (`catalog/roles.json`): uno por jugador, único en la sala,
   opcional. Se aplican solo a las acciones que llevan el `crewId` de quien tiene el rol. En solitario no
   hay roles y el balance no cambia.
6. **Salas privadas con código de 4 caracteres**, sin emparejamiento. No se entra a una partida empezada.
7. **La lógica de sala es un modelo puro** (`apps/game-server/src/roomModel.ts`, sin Colyseus ni reloj);
   `CrewRoom` solo adapta la red. El contrato de mensajes vive en `packages/shared/src/net.ts`.

## Consecuencias

- Un cambio en el motor llega igual a solitario y a sala; el test de paridad lo vigila.
- `types.ts` crece de forma aditiva: `RoleId`, `RoleDef`, `Catalog.roles`, `CrewMember.role`,
  `RunOptions.roles`, `crewId` opcional en `work-incident`, `repair-system` y `evade`, y `Run.hydrate`.
- La respuesta a una acción tarda un paso del servidor más la red. Si en internet se nota, habrá que
  añadir predicción para las acciones mantenidas.
- Un cliente modificado puede mentir en los minijuegos y en su posición dentro del límite de velocidad.
  Aceptado: no hay rivales ni ranking hasta la fase 5, que deberá recalcular las partidas.
- Si el proceso se reinicia, las salas se pierden (ADR 0010).
- Sustituye el detalle de implementación del ADR 0009 (esquema, `team.ts`, mascota); su decisión de fondo
  sigue vigente.
