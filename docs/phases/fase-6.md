# Fase 6 · Cooperativo 1-4 con roles

Antes fase 4 (renumerada por `docs/adr/0015-reto-nasa-y-roadmap.md`). Plan § 3: *dinámica cooperativa y roles de la tripulación*. Diseño previsto: `docs/GDD.md` § 8 y § 11.
**Implementada la base (Harry Hernández) e integrada antes de la fase 5** (rama original `feat/f4-cooperativo`, commit `6272af2`, 2026-11-13, cuando el cooperativo era la fase 4; integrada en `feat/f6-integrar-cooperativo` el 2026-11-14): servidor, roles, sala con código, capa de sesión del cliente, avatares y pings están implementados; contrato en `docs/MULTIPLAYER.md` y decisiones en `docs/adr/0017-cooperativo-estado-por-mensajes-y-espejo.md`. Las casillas las marca quien valide la fase. Falta la validación independiente y el hito con cuatro equipos; lo pendiente está en `docs/STATUS.md` («Fase 6 — pendiente»). **Prerrequisitos de lo que falta:** fase 4 (diseño de misión, fusionada) y fase 5 (ciencia, datos y astronauta con dos niveles de detalle). La fase 3 aporta créditos, mejoras y terminal de estación.

**Hito:** cuatro personas en cuatro equipos distintos (red local, no solo `localhost`) diseñan una misión entre todas,
deciden juntas el Go/No-Go y completan un sector comunicándose, sin desincronizaciones.

## Estado de implementación (2026-11-14)

Resumen de quien implementa; las casillas de «Alcance previsto» las marca quien valide.

| Punto del alcance | Estado |
| --- | --- |
| Sala autoritativa de hasta 4 que ejecuta `createRun` y aplica las `RunAction` | Implementado (`RoomModel` + `CrewRoom`) |
| Estado sincronizado: `RunState` + posición y orientación de cada tripulante | Implementado (estado entero a 10 Hz + poses) |
| Test de paridad sala-motor | Implementado (`roomModel.test.ts`) |
| Reconexión con token y tolerancia temporal | Implementado con la pestaña abierta (60 s); **falta** reanudar tras recargar la página |
| Varios tripulantes en el estado e interacción simultánea | Implementado (el motor ya lo admitía; el servidor impone quién actúa) |
| Roles asimétricos con ventajas pasivas, sin bloqueos | Implementado para piloto, ingeniero y explorador; el gestor de recursos **no tiene ventaja** (decisión abierta) |
| Capa de sesión local/sala y avatares en la nave y en la superficie | Implementado; avatares provisionales y **sin ver en la superficie** |
| Entrada con código de sala privada y selección de rol | Implementado |
| Pings visuales y sonoros en el espacio 3D | **Parcial:** solo «mirad aquí» (G), visual; faltan peligro y ayuda en la interfaz y el sonido |
| Roles por disciplina (dirección, ingeniería, ciencia, operaciones) | Pendiente (alcance añadido con el ADR 0015 del reto NASA) |
| Diseño compartido y Go/No-Go con voto | Pendiente. Hoy la sala arranca siempre una **partida libre** (clásica, sin diseño). El motor y el espejo del cliente ya admiten una partida con diseño (`createRun({ design })` + `hydrate`, test en `packages/shared/src/__tests__/coop.test.ts`), pero ni el lobby ni el servidor permiten elegir misión |

**Falta para cerrar la fase:** el hito (cuatro equipos en red local), la validación independiente, jugar la
superficie en sala, modo espectador para quien muere, qué hacer con el tripulante de quien se va, completar
los pings, y el diseño compartido con voto (que la sala arranque con un diseño). Detalle en `docs/STATUS.md`.

## Punto de partida

- El motor ya está pensado para el servidor: paso fijo (0,1 s), sin reloj ni azar global, y toda decisión entra
  como `RunAction` (`createRun(...).apply`).
- ADR 0009 (servidor autoritativo con Colyseus 0.18) y ADR 0010 (un proceso, sin Redis) siguen siendo la base técnica.
- **Economía (fase 3, ADR 0014):** créditos (`RunState.credits`) y mejoras (`RunState.upgrades`) son de toda la tripulación, en un único `RunState`. `sell`, `buy-supply`, `buy-upgrade` y `service` son `RunAction` deterministas y acotadas: el motor valida estación, créditos y oferta (que sale de semilla + sector + nodo). `run.stationQuote()`, `effectiveShip()` y `effectiveSurfaceRules()` son la fuente única de cifras: el cliente no calcula precios. El terminal no pausa el juego. Falta decidir quién puede gastar (propuesta: el rol «gestor de recursos» lidera el terminal, sin bloqueo rígido).
- **Diseño (fases 4-5):** la misión diseñada y su revisión Go/No-Go son datos deterministas del motor; en cooperativo pasan a ser un estado compartido que se edita y se vota. El nivel de detalle bajo del astronauta (fase 5) sirve para los remotos.
- La sala de la versión anterior (`MissionRoom.ts`) sirve de referencia probada para reconexión y límites de tráfico.

## Alcance previsto

### Servidor (`apps/game-server`)

- [ ] Sala autoritativa de hasta 4 jugadores que ejecuta el bucle de `createRun` y aplica las `RunAction` entrantes.
- [ ] Estado sincronizado: `RunState` + posición y orientación `(x, y, z, yaw)` de cada tripulante.
- [ ] Test de paridad: la sala produce el mismo `RunState` que el motor puro con la misma secuencia de acciones.
- [ ] Reconexión con token y tolerancia temporal ante caídas de red.

### Motor

- [ ] Roles por disciplina, como el Mission Design Lab de Goddard: dirección de misión, ingeniería, ciencia y operaciones. Cada rol lidera una parte del diseño y de la operación; los puestos de la nave (piloto, ingeniero, gestor, explorador) se reparten dentro de ellos.
- [ ] Diseño compartido: varias personas editan el diseño de misión mediante acciones deterministas que el motor valida.
- [ ] Go/No-Go con voto de la tripulación antes de zarpar y regla de empate clara; el motivo sale en una línea.
- [ ] Varios tripulantes en el estado (`crew[]`): interacción simultánea en puestos y averías.
- [ ] Roles asimétricos con ventajas pasivas (Piloto: esquiva ágil; Ingeniero: reparación rápida; Explorador: mayor mochila y eficiencia de jetpack). Sin bloqueos exclusivos para evitar dependencias frustrantes.

### Cliente

- [ ] Capa de sesión local/sala; renderizado de los compañeros en la nave y en la superficie como astronautas remotos en 3D con nivel de detalle bajo, interpolados a 10-15 Hz.
- [ ] Pantalla de diseño compartido y votación Go/No-Go.
- [ ] Pantalla de entrada con código de sala privada (sin matchmaking complejo) y selección de rol.
- [ ] Sistema de pings visuales y sonoros en el espacio 3D para coordinación táctica rápida.

### Fuera de alcance (descartado por tiempo)

- [ ] **Voz integrada por WebRTC:** descartada al 100% por alto riesgo técnico y complejidad de infraestructura (servidores STUN/TURN, códecs y eco); se asume uso de comunicación externa (Discord) o pings en el juego.
- [ ] **Predicción de cliente con rollback para físicas:** descartada; para un cooperativo PvE en red local o baja latencia basta con sincronización de estado autoritativo e interpolación de posiciones (*lerp*).
- [ ] **Bloqueo rígido de consolas por rol:** descartado; cualquier tripulante puede operar cualquier estación de emergencia para evitar partidas perdidas por inactividad o desconexión de un rol.
- [ ] **Lobbies públicos, salas abiertas y emparejamiento automático:** descartado; solo conexión directa mediante código de sala privada.
- [ ] **Edición libre y simultánea del diseño tipo documento:** descartada; las ediciones son acciones discretas validadas por el motor.
- [ ] **Escalado dinámico complejo de dificultad por número de jugadores:** descartado para no desestabilizar el balance ya validado.

## Riesgos

- Latencia en minijuegos de averías y esquiva: asegurar que el resultado local se valide de forma tolerante en el servidor.
- Que un rol se quede sin tareas durante el viaje: las ventajas pasivas y el acceso libre a todas las consolas mitigan el aburrimiento.
