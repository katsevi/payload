# Fase 4 · Cooperativo 1-4 con roles

Plan § 3: *dinámica cooperativa y roles de la tripulación*. Diseño previsto: `docs/GDD.md` § 8 y § 11.
**En curso** (rama `feat/f4-cooperativo`, 2026-11-13): servidor, roles, sala con código, capa de sesión del cliente, avatares y pings están implementados; contrato en `docs/MULTIPLAYER.md` y decisiones en ADR 0015. Las casillas las marca quien valide la fase. Falta la validación independiente y el hito con cuatro equipos; lo pendiente está en `docs/STATUS.md`. La fase 3 (economía) está implementada, así que el cooperativo hereda créditos, mejoras y terminal de estación.

**Hito:** cuatro personas en cuatro equipos distintos (red local, no solo `localhost`) completan un
sector comunicándose, sin desincronizaciones.

## Estado de implementación (2026-11-13)

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

**Falta para cerrar la fase:** el hito (cuatro equipos en red local), la validación independiente, jugar la
superficie en sala, modo espectador para quien muere, qué hacer con el tripulante de quien se va y completar
los pings. Detalle en `docs/STATUS.md` («Fase 4 — pendiente»).

## Punto de partida

- El motor ya está pensado para el servidor: paso fijo (0,1 s), sin reloj ni azar global, y toda decisión entra
  como `RunAction` (`createRun(...).apply`).
- ADR 0009 (servidor autoritativo con Colyseus 0.18) y ADR 0010 (un proceso, sin Redis) siguen siendo la base técnica.
- **Economía (fase 3, ADR 0014):** créditos (`RunState.credits`) y mejoras (`RunState.upgrades`) son de toda la tripulación, en un único `RunState`. `sell`, `buy-supply`, `buy-upgrade` y `service` son `RunAction` deterministas y acotadas: el motor valida estación, créditos y oferta (que sale de semilla + sector + nodo). `run.stationQuote()`, `effectiveShip()` y `effectiveSurfaceRules()` son la fuente única de cifras: el cliente no calcula precios. El terminal no pausa el juego. Falta decidir quién puede gastar (propuesta: el rol «gestor de recursos» lidera el terminal, sin bloqueo rígido).
- La sala de la versión anterior (`MissionRoom.ts`) sirve de referencia probada para reconexión y límites de tráfico.

## Alcance previsto

### Servidor (`apps/game-server`)

- [ ] Sala autoritativa de hasta 4 jugadores que ejecuta el bucle de `createRun` y aplica las `RunAction` entrantes.
- [ ] Estado sincronizado: `RunState` + posición y orientación `(x, y, z, yaw)` de cada tripulante.
- [ ] Test de paridad: la sala produce el mismo `RunState` que el motor puro con la misma secuencia de acciones.
- [ ] Reconexión con token y tolerancia temporal ante caídas de red.

### Motor

- [ ] Varios tripulantes en el estado (`crew[]`): interacción simultánea en puestos y averías.
- [ ] Roles asimétricos con ventajas pasivas (Piloto: esquiva ágil; Ingeniero: reparación rápida; Explorador: mayor mochila y eficiencia de jetpack). Sin bloqueos exclusivos para evitar dependencias frustrantes.

### Cliente

- [ ] Capa de sesión local/sala; renderizado de los avatares de los compañeros en la nave y en la superficie.
- [ ] Pantalla de entrada con código de sala privada (sin matchmaking complejo) y selección de rol.
- [ ] Sistema de pings visuales y sonoros en el espacio 3D para coordinación táctica rápida.

### Fuera de alcance (descartado por tiempo)

- [ ] **Voz integrada por WebRTC:** descartada al 100% por alto riesgo técnico y complejidad de infraestructura (servidores STUN/TURN, códecs y eco); se asume uso de comunicación externa (Discord) o pings en el juego.
- [ ] **Predicción de cliente con rollback para físicas:** descartada; para un cooperativo PvE en red local o baja latencia basta con sincronización de estado autoritativo e interpolación de posiciones (*lerp*).
- [ ] **Bloqueo rígido de consolas por rol:** descartado; cualquier tripulante puede operar cualquier estación de emergencia para evitar partidas perdidas por inactividad o desconexión de un rol.
- [ ] **Lobbies públicos, salas abiertas y emparejamiento automático:** descartado; solo conexión directa mediante código de sala privada.
- [ ] **Escalado dinámico complejo de dificultad por número de jugadores:** descartado para no desestabilizar el balance ya validado.

## Riesgos

- Latencia en minijuegos de averías y esquiva: asegurar que el resultado local se valide de forma tolerante en el servidor.
- Que un rol se quede sin tareas durante el viaje: las ventajas pasivas y el acceso libre a todas las consolas mitigan el aburrimiento.
