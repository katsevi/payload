# Fase 4 · Cooperativo 1-4 con roles

Plan § 3: *dinámica cooperativa y roles de la tripulación*. Diseño previsto: `docs/GDD.md` § 8 y § 11.
No iniciada: `apps/game-server` es un marcador.

**Hito:** cuatro personas en cuatro equipos distintos (red local, no solo `localhost`) completan un
sector hablando entre sí, sin desincronizaciones.

## Punto de partida

- El motor ya está pensado para el servidor: paso fijo, sin reloj ni azar global, y toda decisión entra
  como `RunAction` (`createRun(...).apply`). `MAX_WORK_SECONDS` limita lo que aporta una acción.
- ADR 0009 (servidor autoritativo con Colyseus) y ADR 0010 (un proceso, sin Redis) siguen siendo la base.
- La sala de la versión anterior es buena referencia de reconexión, límites anti-abuso y pruebas de red:
  `git show v0.3.0-simulador:apps/game-server/src/MissionRoom.ts` y `docs/archivo/v0.3-simulador/MULTIPLAYER.md`.
  No sirve tal cual: sincronizaba un diseño por turnos, no una nave en tiempo real.

## Alcance previsto

### Servidor (`apps/game-server`)

- [ ] Sala de hasta 4 jugadores que corre `createRun` y aplica las `RunAction` de cada cliente.
- [ ] Estado sincronizado: `RunState` + posición y puesto de cada tripulante.
- [ ] Test de paridad: la sala produce el mismo `RunState` que el motor con las mismas acciones.
- [ ] Reconexión, salida de jugadores y límites de frecuencia.

### Motor

- [ ] Varios tripulantes: trabajo simultáneo en una avería, un jugador por puesto.
- [ ] Roles y permisos (piloto, ingeniero, gestor de recursos, explorador); con 2-3 jugadores se agrupan.
- [ ] Dificultad escalada con el número de jugadores.

### Cliente

- [ ] Capa de sesión local/sala; los demás tripulantes visibles en la nave y en la superficie.
- [ ] Sala de espera, elección de rol, pings; voz opcional.
- [ ] Contrato escrito antes de implementar (`docs/MULTIPLAYER.md` nuevo).

## Riesgos

- Latencia en acciones mantenidas (arreglar, evadir): decidir qué predice el cliente.
- Que un rol se aburra: cada rol necesita algo que hacer en cada momento del ciclo.
