# Estado del proyecto — traspaso entre sesiones

Última actualización: **2026-11-09** · Versión: 0.3.0 (ver `CHANGELOG.md`)

> Léelo antes de empezar y actualízalo al terminar una tarea relevante. Las casillas de
> `docs/phases/fase-*.md` las marca quien valida la fase, no quien implementa: aquí solo se resume.
> Nota: la fase 2 ya está en `main` (PR #1, rama `feat/f2-contenido-aprendizaje`). La fase 3 está commiteada y subida en la rama
> `feat/f3-multijugador` (4 commits: shared, game-server, client, docs); falta abrir el PR y fusionarla en `main`.

## Estado por fase

| Fase | Estado |
| --- | --- |
| 0 · Preproducción | **Entregables completos.** Hito (*los compromisos son divertidos en papel*) **pendiente de prueba en papel con >= 3 personas**. |
| 1 · Rebanada vertical en solitario | **Hecha · validada con observaciones.** |
| 2 · Contenido y aprendizaje | **Hecha · validada con observaciones** (validación independiente del 2026-11-08). **Hito pendiente de prueba con >= 5 estudiantes.** |
| 3 · Multijugador | **Hecha · validada con observaciones** (validación independiente del 2026-11-09: segunda pasada + verificación de N1-N6). **Hito pendiente: jugar una misión completa con 4 personas en 4 navegadores/equipos distintos.** Contrato: `docs/MULTIPLAYER.md`; ADR 0009 y 0010. |
| 4 · Pulido y lanzamiento | No iniciada. `apps/api` es un marcador. Ver "Próximos pasos (hacia la fase 4)". |

### Fase 0 — qué se hizo

- `docs/GDD.md`, `docs/phases/` y ADR 0001-0007.
- Contrato `packages/shared/src/types.ts` y catálogo JSON inicial.
- Prototipos (`prototype/`): CLI `pnpm proto`, hoja de cálculo `payload-prototipo.xlsx` (su Go/No-Go coincide con la CLI en los 9 diseños) y prototipo en papel con plantilla de registro.
- 9 diseños de ejemplo en `prototype/designs/` (3 válidos, 2 con aviso, 4 que fallan por causas distintas).

### Fase 1 — qué se hizo

- **Motor:** órbita Kepler, eclipse y contacto con estación, presupuestos con "¿por qué?", Go/No-Go, simulación determinista de paso fijo 30 s, eventos pre-sorteados, puntuación, informe con cadena de causas, i18n del motor (`sim`).
- **Cliente:** menú, briefing, hangar caminable (1ª/3ª persona, Rapier), panel de recursos, selección de órbita/lanzador, Go/No-Go, lanzamiento, operación con aceleración 0×-10 000×, informe y "Rediseñar", ajustes, créditos, modo accesible 2D, es/en.
- **Assets:** GLB optimizados con meshopt; ERIZON solo con compresión de geometría.

### Fase 2 — qué se hizo (rama `feat/f2-contenido-aprendizaje`)

**Motor (`packages/shared`, ADR 0008):**
- **Eventos ponderados por dificultad** (`events.ts`, `EVENT_TABLES` + `ScenarioDef.eventTuning`): entorno (tormenta solar, basura, rueda de reacción), salud (sobrecalentamiento si el margen térmico < 15 %; falla de componente según fiabilidad × radiación; **degradan, no destruyen**) y pre-lanzamiento (retraso, recorte de presupuesto) vía `rollPreLaunchEvents` → `MissionSimOptions.preLaunch` y `computeBudgets(design, cat, preLaunch)`. Flujos de azar separados con `deriveSeed`; todo pre-sorteado.
- **Puntuación:** penalización por agotamientos de batería (`energyCriterion`) y criterio de vida lineal 75 % → 100 % (`lifetimeCriterion`).
- **Rueda de reacción con star tracker:** apuntado de respaldo 1°/2°/5° (`wheelBackupPointingDeg`); la falla de componente ADCS se trata igual.
- **Fase orbital de Kepler:** `orbitPhase` = anomalía verdadera / 2π; `meanPhase` y `altitudeKm` opcionales (cambia la semántica: ADR 0008 §6).
- **Pedagogía como datos zod:** `catalog.glossary`, `catalog.mascot`, `catalog.academy` (opcionales); `adviseByRole`, `pickMascotDialogue`, `evaluateAcademyStep`.

**Contenido (`packages/shared/catalog`):** 5 escenarios de campaña (`leo-earth-observation`, `geo-telecom-connect`, `space-telescope-deep-sky`, `lunar-polar-scout`, `mars-aurora-expedition`) + `academy-cubesat-leo`; 43 componentes (16 nuevos, incl. `payload-surface-rover` = Aurora G9), 7 lanzadores (nuevos: Zorzal, Pampero, Jaguar), 6 órbitas, 28 entradas de glosario, mascota original **Orbi** (74 diálogos; **Rise no está en el repo**) y Academia de 21 pasos. Fixtures por escenario en `src/__tests__/fixtures/scenarios/` (>= 2 válidas, >= 2 causas de fallo).

**Cliente (`apps/client`):**
- Selector de escenarios; intento persistente por escenario (semilla = `defaultSeed + intento`); fase `prelaunch` con `PreLaunchScreen`; HUD e informe con los eventos nuevos.
- `OrbitScene` con órbita de Kepler y arco de eclipse.
- **Mascota** (`src/mascot`): lógica pura, cola con enfriamiento, burbuja `aria-live`, avatar SVG o `sprite2d`; `H` = ayuda contextual; desactivable; flota en gravedad cero en el lanzamiento; consejo `help:<missionType>` en el briefing.
- **Academia** (`src/academy`): pasos con `evaluateAcademyStep`; revisión bloqueada hasta `step-go`; `academyDone` solo si se cumplen todos los pasos no manuales; "Rediseñar" vuelve al primer paso pendiente.
- **Asesores por rol** y **glosario** (`G`) en `ui/LearningPanels.tsx`.
- **Audio procedural** con Web Audio (`src/audio`): música adaptativa de 5 capas por fase/estado, 13 efectos, emisores 3D en el hangar, buses y volúmenes, silenciar, subtítulos de sonido y flashes visuales.
- **Vista del instrumento** (`I`, `src/instrument`) con eclipse, desenfoque por apuntado y "sin señal"; `SurfaceScene` con Aurora G9 en las misiones lunar/Marte.

**Assets:** skill `3d-models` portable y con sección "Usar un modelo en una escena"; `CREDITS.md` corregido (columna Cambios) con secciones Aurora fase 2 y Audio; `.gitattributes` con `*.ogg binary`. Los GLB se mantienen en `assets/models/source` y `assets/web/models` (sin LFS); el usuario los subirá manualmente a GitHub.

### Fase 3 — qué se hizo (rama `feat/f3-multijugador`)

Contrato escrito antes de implementar: `docs/MULTIPLAYER.md`. Decisiones: ADR 0009 (servidor autoritativo) y ADR 0010 (un proceso, sin Redis).

**Motor (`packages/shared`):**
- `team.ts`: roles y permisos (`ROLE_PERMISSIONS`, `RESOURCE_OWNER`), `combineRoles`, `checkTeamAction` (solicitudes automáticas y explícitas, límites de `TEAM_LIMITS`), solicitudes con **aprobaciones encadenadas** (`applyApprovedRequest`), reparto de presupuesto por subsistema, votación Go/No-Go (`validateVote`, `tallyGoNoGo`), alertas de equipo (`EVENT_RESPONSE_ROLES`) y `scoreCollaboration`/`withCollaboration` (la colaboración va FUERA de `MissionResult`).
- `teamWire.ts`: `RoomStateWire`, `encodeRoomView`/`decodeRoomView`, `teamActionSchema` (zod).
- `types.ts`: solo cambios aditivos (`TeamAction`, `RoomView`, `ScenarioDef.team { minPlayers, maxPlayers }`…).

**Servidor (`apps/game-server`):** Colyseus 0.18, sala `mission`. `RoomModel` (modelo puro de la sala: fases, permisos, solicitudes, votos, alertas, rediseño, salidas), `mascotDirector` (mascota única con prioridades y moderación), `schema.ts` (esquema que refleja `RoomStateWire`, escritura incremental), `MissionRoom` (adaptador: reconexión con gracia de 60 s, bloqueo al salir del lobby, límite de 40 mensajes/s), `options`, `server`/`index` (`pnpm dev:server`). Paridad: la sala produce el mismo `MissionResult` que `runMission` con todos los fixtures válidos.

**Cliente (`apps/client`):** capa `net/` (interfaz `MissionSession` con `LocalSession` y `RoomSession`, `useRoom`, `canDo`, espejo de la simulación que nunca pasa del `simT` del servidor, SDK de Colyseus en carga diferida) y `room/` (entrada «Jugar en equipo», sala privada por código y partida rápida, lobby, `TeamBar`, chat, solicitudes, reparto de presupuesto, pings, alertas, votación con motivo del No-Go, colaboración en el informe). `ControlRoomScene` (sala de control con 4 consolas y avatares) y `RoomAvatars` (otros jugadores y pings en el hangar). Teclas en sala: `T` chat, `R` solicitudes, `P` ping. Reconexión con token y reintento manual. Atajo dev `?room=demo` (sala de ejemplo sin servidor).

**Contenido:** escenario de equipo `polar-ice-watch-team` (2-4 jugadores; oculto en la campaña en solitario), 10 entradas de glosario nuevas (38) y 34 diálogos de Orbi nuevos (108; disparadores `team:*` y `role:*`).

## Métricas verificadas (2026-11-09)

| Métrica | Valor |
| --- | --- |
| `pnpm validate --force --concurrency=1` | Verde: 11/11 tareas, 0 en caché (typecheck + test + build). Total 535 tests |
| Tests `@payload/shared` | **335** en 18 archivos |
| Tests `@payload/client` | **122** en 8 archivos (`i18n`, `flow`, `fixes`, `phase2`, `phase2b`, `net`, `room-ui`, `room-e2e`; este último levanta el servidor real y 3 clientes SDK) |
| Tests `@payload/game-server` | **78** en 7 archivos (`parity`, `roomModel`, `mascot`, `schema`, `options`, `network`, `abuse`) |
| Prueba manual (coordinador) | Servidor compilado + cliente real en Chrome: sala privada, roles, briefing, hangar, selección de órbita/lanzador por el servidor; E2E por script con paridad `runMission` (79,3 puntos con `ok-cubesat-leo`, semilla 20260101). Revisión visual con `?room=demo`: lobby, votación, operación con alerta e informe |
| `pnpm --filter @payload/shared bench` | `computeBudgets` 0,014 ms · `reviewGoNoGo` 0,014 ms · `runMission` 30 días 9,4 ms (objetivos < 1 ms, < 1 ms, < 200 ms) |
| `pnpm proto --brief` (semilla `20260101`) | `warn-power-storm` 63,2 (antes 91,7) · `ok-microsat-leo-thermal` 92,7 (antes 92,8); los demás igual que en la fase 1 (79,3 · 86,6 · 74,0 · 24,1 · 52,0 · 21,7 · 21,4). Detalle en `prototype/designs/README.md` |
| Catálogo | 43 componentes · 7 lanzadores · 6 órbitas · 7 escenarios (5 campaña + `polar-ice-watch-team` de equipo + Academia) · 38 glosario · 108 diálogos · 21 pasos de Academia |
| Chunk `HangarScene` | ~2,28 MB (límite de aviso de Vite subido a 2500 kB) |
| Peso de modelos servidos (`assets/web/models/`) | ~12 MB (5 GLB; el audio es procedural y no pesa) |

**Notas de balance:** Marte usa TLI (no hay órbita marciana en el catálogo); no existe el campo `radiationShielding` (se emula con la fiabilidad); la resolución en TLI usa perigeo de 200 km. `leo-earth-observation` conserva sus semillas de la fase 1 (`warn-power-storm` falla con `defaultSeed` +1, +4, +7).

## Acciones humanas pendientes

Ningún agente puede hacerlas; bloquean el cierre formal de las fases.

1. **Prueba en papel con >= 3 personas** (hito de la fase 0): `prototype/PROTOTIPO-PAPEL.md` + `prototype/PLANTILLA-REGISTRO-PRUEBA.md` (copias en `prototype/pruebas/`, que aún no existe).
2. **Prueba con >= 5 estudiantes** (hito de la fase 2) usando la plantilla de registro: sin ayuda del equipo, la mayoría debe completar la Academia y una misión de campaña. Anotar conclusiones y ajustes de balance aquí.
3. **Escuchar el audio y ajustar la mezcla:** nadie lo ha oído. Revisar volúmenes por defecto (`volMusic`, `volSfx`, `volAlerts`), el carácter de las 13 piezas y la música adaptativa.
4. **Revisión visual en navegador** de lo que no se ha visto en pantalla: lanzamiento y `PreLaunchScreen`, vista de superficie con Aurora G9, rover montado en el hangar, vista del instrumento, orientación de la consola del hangar y posición de ERIZON (queda bajo el panel de operación según la proyección).
5. **Medir FPS** en el hangar con una laptop de gama media (meta 60, mínimo 50) y probar una misión completa con teclado y ratón por una persona nueva.
6. **Asignar responsables** a las preguntas abiertas del GDD (§ 15).
7. **Mascota:** Rise requiere autorización escrita de NASA; hasta entonces el repositorio solo lleva a Orbi. Decidir si Orbi es la definitiva.
8. **Decidir si se sustituye ERIZON** (CC-BY-NC-ND) antes de cualquier uso comercial.
9. **Crear `.claude/settings.json` compartido** (contenido propuesto en `docs/CONTRIBUTING.md`).
10. **Abrir el PR de `feat/f3-multijugador`** (ya subida) y fusionarla en `main`; subir los GLB a GitHub.
11. **Hito de la fase 3: partida con 4 personas reales** en 4 navegadores/equipos distintos, en red local (no solo `localhost`): misión completa sin desincronizaciones; anotar conclusiones aquí.
12. **Revisión visual a varios anchos** de la UI de sala: por debajo del breakpoint `lg` los paneles del lobby tapan la sala de control.
13. **Probar en juego** si las aprobaciones encadenadas y la pausa por alertas resultan pesadas (ajustar `TEAM_LIMITS` o el flujo).
14. **Decidir la voz WebRTC** (opcional, no implementada): hacerla en la fase 4 o descartarla.

## Decisiones de diseño abiertas

- **LEO del catálogo a 450 km** (T = 93,4 min); la referencia del plan (92,6 min) es a 400 km. El motor se prueba con 400 km por tolerancia, pero la hoja de cálculo no tiene celda de altitud libre; el criterio de `fase-0.md` sigue sin cumplirse. Decidir: bajar la LEO a 400 km o cambiar el criterio.
- **`why` de lanzadores y escenario:** opcional en el esquema, relleno en es/en, pero el cliente no lo muestra ni un test lo exige.
- **Mascota 3D:** el JSON admite `model`, pero el cliente solo usa `sprite2d` o el avatar SVG.
- **Radiación:** valorar un campo `radiationShielding` en componentes (hoy se emula con fiabilidad).

- **Reloj de sala estimado:** el servidor no publica su reloj; el cliente lo estima (`useRoomClock`) para horas relativas y la cuenta atrás de alertas. Valorar publicarlo en `RoomStateWire` (cambio aditivo).
- **Voz WebRTC:** no implementada (opcional en el plan; el chat de texto sí).
- **Pings en la vista orbital:** no implementados (sí en el hangar y el modo accesible 2D).
- **Redis / varias instancias:** ADR 0010; hoy un proceso y las salas se pierden si se reinicia. Activar Redis cuando haya varias instancias (fase 4, AWS).

### Resueltas en la fase 2

- **`power-storm`:** sigue siendo aviso, pero los agotamientos de batería penalizan la puntuación (`energyCriterion`); `warn-power-storm` baja de 91,7 a 63,2 (ADR 0008 §5).
- **Semilla/intento:** el intento persiste por escenario (`useProgress.claimAttempt`); semilla = `defaultSeed + intento`, de modo que cada partida nueva usa una semilla distinta.

## Deuda técnica conocida

- **Mando y táctil** no implementados (fase 4); tampoco el giro por pasos del modo anti-mareo.
- **Sombra de la Tierra translúcida** en la escena orbital (hay arco de eclipse, no cono de sombra).
- **Chunk del hangar** ~2,28 MB (~0,86 MB gzip).
- **Audio** sin verificar con oído; la mezcla es provisional. Los avisos visuales no dependen del audio.
- **`orbitPhase` cambió de semántica** (anomalía verdadera, no fase uniforme): cualquier consumidor nuevo (servidor, otros clientes) debe leer ADR 0008 §6.
- **`Encoder.BUFFER_SIZE` fijado a 256 KB** (global de `@colyseus/schema`, en `schema.ts`): el estado del informe de una sala pesa hasta ~200 KB.
- **Memoria en desarrollo:** en la máquina de desarrollo el sistema se quedó corto de memoria con el servidor de desarrollo, el de juego y las suites a la vez; usa `pnpm validate --concurrency=1` para evitar la presión.
- **`useCanDo`** (`net/roomStore.ts`) exportado pero sin usar (la UI usa `useStableCanDo`).
- Las **solicitudes encadenadas y las alertas** no se han probado con jugadores reales; la sala solo se ha verificado con 3 clientes SDK y un navegador real.
- Sin CI configurado; aún no hay linter (ESLint queda para una fase posterior).

### Resuelta en la fase 2

- Eventos no modelados (sobrecalentamiento, falla de componente, retraso, recorte) y fase orbital no Kepler: implementados (ADR 0008).

## Próximos pasos (hacia la fase 4)

1. **Cerrar el hito de la fase 3** (acción humana 11) y las acciones 2-5 y 12-14.
2. **`apps/api`** (NestJS + Prisma + PostgreSQL): cuentas, diseños guardados, rankings. Un ranking solo es fiable si el servidor recalcula la puntuación con el motor; el servidor de juego ya tiene el `MissionResult` y el `teamScore` de cada sala listos para enviar.
3. **Escalado:** activar Redis (ADR 0010) cuando haya varias instancias; `publicAddress` y afinidad de sesión.
4. **Pulido:** mando y táctil, giro por pasos, voz opcional, pings en órbita, E2E con Playwright, Sentry, despliegue en AWS.
5. **Contrato:** `types.ts` y `teamWire.ts` son ahora contrato de red; solo cambios aditivos (o ADR).

## Actualización 2026-11-07 (tarde)

- Añadido el modelo `sci-fi_computer_desk_console.glb` (CC-BY 4.0, Inditrion Dradnon) como consola de misión del hangar (`ConsoleModel` en `apps/client/src/models/Models.tsx`). Optimizado 1,87 MB → 0,45 MB. Registrado en `assets/CREDITS.md` y en la pantalla de créditos. Su orientación en el hangar sigue sin confirmar visualmente.
