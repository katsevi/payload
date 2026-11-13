# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.
Cada entrada se agrupa por paquete.

## [Sin publicar]

## Fase 3 · Economía y progresión

Versión propuesta: **0.6.0** (rama `feat/f3-economia-progresion`, 2026-11-13, sin commitear). Decisiones: ADR 0014.

### Añadido

#### `@payload/shared`
- Economía: `RunState.credits` y `RunState.upgrades`; acciones `sell`, `buy-supply` (combustible, casco, repuestos) y `buy-upgrade`; eventos `sale`, `purchase`, `upgrade` y `reward`; `Run.stationQuote()` (precios, oferta, `powerMarginDeltaKw` y `overloadsAtCruise` por mejora), `effectiveShip()`, `effectiveSurfaceRules()` y `cruisePowerMarginKw`. Módulo `economy.ts`.
- Catálogos `catalog/economia.json` (créditos iniciales 60, contrato de 65 por sector, venta hielo 1 / mena 4 / cristal 14 / muestra 24, suministros combustible 1 / casco 1,2 / repuesto 15, multiplicador por sector +0,2 venta y +0,15 compra, ayuda de emergencia, oferta de 5) y `catalog/mejoras.json` (11 mejoras con niveles y contrapartida). `parseCatalog` los rellena por defecto si faltan.
- `NodeKindDef.shop` (marca las estaciones con terminal); oferta de mejoras determinista por semilla, sector y nodo, con flujo de azar propio.
- Estadísticas opcionales `creditsEarned`, `creditsSpent`, `unitsSold` y `upgradesBought`; `ShipState.cargoKg`; `cargoKg` y `cargoFuelMult` en `estimateJump`.
- Bot de balance con política de economía según el estado de la nave. Tests nuevos `economy.test.ts`; total 181 en 8 archivos.

#### `@payload/client`
- Terminal de estación (`ui/StationTerminal.tsx`): venta | tienda y mejoras, una línea de efecto por mejora y aviso de sobrecarga, con teclado; se abre con E en la esclusa atracado en una estación o desde el mapa, y no pausa el juego.
- `ui/Credits.tsx` (`CreditsBadge` en HUD, mapa y terminal; `UpgradeStrip`), resumen de economía en el fin de partida, «+N % por carga» en el mapa, `game/shop.ts` y `game/effective.ts`, cues `sale`, `purchase`, `upgrade` y `noCredits`.
- Depuración: `?play=1&seed=7&station=1` (`&station=bare`) y `__payload.toStation()`. Tests nuevos `shop.test.ts`; total 119 en 5 archivos.

### Cambiado
- `service` deja de ser el servicio completo gratuito: pasa a **ayuda de emergencia** gratuita, una vez por estación (75 % del depósito, 50 % del casco, 1 repuesto). `NodeKindDef.service` queda obsoleto.
- La masa de la bodega y de las mejoras encarece el combustible de cada salto (× (1 + kg / 1000)).
- Hielo y mena se siguen convirtiendo al guardarse; el sobrante va a la bodega y se vende. La mena deja de ser relleno.
- Los créditos y las mejoras no puntúan; vender no suma ni resta puntos.
- Balance (`pnpm balance 200 3`): tripulación rápida S1 100 % · S2 99 % · S3 90 % (antes 100/100/92); lenta S3 71 % (antes 73); explorador prudente S3 82 % (antes 83) con 3,6 mejoras por partida.
- Documentación: ADR 0014, STATUS, GDD § 6 y § 11, ARCHITECTURE, `docs/phases/fase-3.md`, agentes y skill `add-catalog-item`.

### Corregido (tras la validación independiente)
- Tests de las dos mejoras nuevas, bot que las compra, aviso de sobrecarga en el terminal, rechazo de compra duplicada, cierre del overlay y tope de carga efectivo en `isStranded`.

### Mejora fuera del plan: herramientas de minería y minijuegos (rama `feat/f2-herramientas-e-interacciones`, 2026-11-12)

Decisiones: ADR 0013. Pedido del usuario: menos interacciones repetitivas con E y una minería creíble.

#### `@payload/shared`
- Herramientas desplegables (`surface.tools` en `mundos.json`, `material.tool`): concentrador solar (hielo; se para con tormenta) y taladro láser (mena, cristal, muestra). Acciones `deploy-tool` y `retrieve-tool`; estado `surface.tools` y `crew[].tools`; eventos `tool-*`. Extracción a paso fijo (4/5/5/6 s por unidad); lo que queda fuera al entrar se pierde y se repone al aterrizar. Mochila de 110 kg.
- Filones: lo raro se agrupa en 2-3 vetas a 8-15 m (`rules.lodes`, `Deposit.lodeId`). Completar un filón en la misma salida da ×1,5 a la última veta (`lodes.completeMult`, `lodeProgress`, `CrewMember.lodeVeinsDone`, subtipo `lode`).
- Hielo escaso también en la luna volcánica y el mundo de tormentas.
- Esquiva por habilidad: `evade {grazes}`, aviso con `etaS`, `evadeSeed` y `evadeDifficulty`; reglas en `averias.json` (`hazards.impact.evade`); eventos `impact-evaded` e `impact-hit` con subtipo.
- Bot de balance con herramientas, tiempo quieto por salida y perfiles de minijuegos (`shipSkill`: medio, simple, torpe) con umbral en `balance.test.ts`. Tests: 148 en 7 archivos.

#### `@payload/client`
- Esquiva en el holograma del timón (WASD) de duración fija (3 s, se juega si quedan >= 3,4 s); llegar tarde aplica un resultado tardío con roces, nunca limpio; flecha hacia el timón y pitido repetido con el aviso.
- Averías con interacción propia: extintor apuntado (fuego), pulsos de sincronía (cortocircuito, dos aciertos), mantener y soltar en la zona de presión (fuga); repuesto con R en dos tramos.
- Accesibilidad en tres ajustes: esquiva simple, averías simples y puntería ancha.
- `SurfaceTools`, `ToolIcon`, brújula de herramientas, brújula de oxígeno que cuenta el rodeo (cuatro estados), avisos y sonidos; avance del filón («2/3») en el HUD y marca en la veta que lo completa. Tests: 100 en 4 archivos (`minigames.test.ts` nuevo).

### Cambiado (mejora)
- `collect` ya no se mantiene: recoge lo que la herramienta ha extraído (el campo `seconds` queda opcional e ignorado). Se retira la clave de mensaje `event.collected`.
- Teclas: E usar, abrir, colocar o recoger; Q alternativa (régimen, soltar carga, retirar herramienta); clic o Espacio la habilidad; R reparar con repuesto. Ya no se mantiene E para recoger ni para arreglar averías (la reparación se hace con su minijuego).

## Fase 2 (resto de lo sin publicar)

Versión propuesta: **0.5.0**, fase 2 «Exploración de superficie» (rama `feat/f2-superficie`, 2026-11-12). Decisiones: ADR 0012.

### Añadido

#### `@payload/shared`
- Contrato aditivo de superficie: `RunPhase` `landing` y `surface`, `LossReason` `crew`, `WorldDef`, `MaterialDef`, `SurfaceRules`, `CrewMember`, `SurfaceState`, `Deposit`, `UnstableZone`, `LandingEstimate` y `TakeOffEstimate`; `RunAction` `land`, `set-descent-brake`, `eva-exit`, `eva-enter`, `set-position`, `jetpack`, `fall-impact`, `collect`, `jettison` y `take-off`; `RunEvent.subtype`; `Run.estimateLanding()` y `estimateTakeOff()`; `createRun({ crewSize })`.
- Catálogo `catalog/mundos.json` (zod, opcional): 7 mundos, 4 materiales y reglas de descenso, despegue, traje, jetpack, caídas, terreno inestable y racha.
- `surface.ts`: mundo y superficie deterministas por nodo, física del descenso y perfil de frenado de referencia, combustible de despegue, racha y relleno del traje.
- Partida: descenso con freno, EVA con oxígeno de traje y jetpack, caídas, tormentas pre-sorteadas, terreno inestable, recogida por mantener, bodega con suministros y puntuación de materiales, despegue, derrota por muerte de toda la tripulación y varada en superficie. La nave sigue viva durante la salida.
- Mensajes de superficie en es/en. Tests nuevos `surface.test.ts` (motor); total 127 en 7 archivos.
- Bot de balance con `explore: 'prudent' | 'greedy' | 'thorough'`, resumen por aterrizaje y curva «margen de O₂ → valor y muertes» en `pnpm balance`.

#### `@payload/client`
- Escenas `SurfaceScene` (descenso y EVA) y `SurfaceWorld` (carga diferida, con Rapier), `ShipExterior`, `ShipCargo` (bodega visible) y `ui/SurfaceHud`.
- Terreno determinista (`game/terrain.ts`), movimiento con jetpack (`game/motion.ts`), reglas de superficie (`game/surfaceRules.ts`), ruido y depuración; capa gráfica de superficie (`gfx/surfaceShaders.ts`, `surfaceLook.ts`, `rocks.ts`).
- Esclusa como noveno puesto; timón con descenso y despegue; mapa con mundo y gravedad de cada destino aterrizable.
- Controles: **Espacio** (salto, jetpack y freno de caída) y **C** (bajar con el jetpack). Ajustes de accesibilidad: intensidad de efectos y recoger con una pulsación.
- Depuración: `?play=1&seed=7&surface=1|descent|landed` y `__payload.toSurface()`. Tests nuevos `surface.test.ts`; total 82 en 3 archivos.

#### `@payload/client`
- Capa gráfica procedural `src/gfx/`: texturas de canvas, materiales compartidos, `Builder` (piezas fusionadas en una malla por material), ruido GLSL y shaders de nave, efectos y espacio. Sin assets ni dependencias nuevas.
- El destino del salto se ve acercarse por la proa en el último tramo del viaje.
- Depuración: `__payload.teleport(x, z)` y `?body=<tipo>` para revisar la escena.

#### Herramientas
- Skills genéricas de three.js `threejs-*` (13, de `cloudai-x/threejs-skills`) en `.claude/skills/`, fijadas en `skills-lock.json`. La skill `3d-models` se mantiene y prevalece en assets (meshopt, licencias, ERIZON ND).

### Cambiado

#### Documentación
- ADR 0012; fase 2, GDD § 10-11, arquitectura y estado al día; `docs/CONTRIBUTING.md`: modelos de los agentes corregidos (`client-3d` opus, `validator` sonnet).

#### `@payload/shared`
- `computeScore` suma los puntos de los materiales guardados a bordo. Los perfiles de balance de la fase 1 no cambian.

#### `@payload/client`
- Se pinta la escena según la fase (`sceneFor`): puente, descenso o superficie. Audio ampliado (propulsor, jetpack, viento, tormenta, respiración, pitido de O₂, despegue).
- Rediseño visual de la nave: casco con cuadernas, vigas, conductos, cristales y mirador de proa; los ocho puestos remodelados y mostrando el estado del motor (palancas, medidor de carga, radar, galones de régimen, palas de los motores); reflejos de entorno y sombras de contacto. Distribución, colisiones e interacción sin cambios.
- Efectos de avería nuevos (llamas, pavesas, humo, chispas, arcos, chorro de gas) y luminarias por zona.
- Exterior nuevo: cielo de nebulosas por sector, estrella cercana, planetas procedurales con atmósfera y anillos, luna con cráteres, asteroides instanciados, nebulosa, pecio y portal con vórtice. Menú con el mismo cielo.
- `ShipInterior.tsx` se divide: el casco queda ahí y los puestos pasan a `ShipStations.tsx`; los cuerpos celestes, a `SpaceBodies.tsx`.

## [0.4.0] - 2026-11-10

**Reinicio del juego.** Payload deja de ser un simulador de diseño de misiones y pasa a ser un cooperativo
de supervivencia en una nave exploradora (plan: `docs/plan/plan-tripulacion-de-exploracion.md`; decisión:
ADR 0011). Esta versión es la **fase 1 nueva: viaje interplanetario y nave, en solitario**. La versión
anterior queda en la etiqueta `v0.3.0-simulador` y su documentación en `docs/archivo/v0.3-simulador/`.

### Añadido

#### `@payload/shared`
- Contrato nuevo (`types.ts`): nave, sistemas, régimen de motores, averías, sector, `RunState`, `RunAction`, `RunEvent`.
- Catálogo nuevo en JSON con zod: `naves.json`, `averias.json`, `destinos.json` (estación, planeta, luna, campo de asteroides, nebulosa, nave abandonada, portal) y `sectores.json`.
- `generateSector` / `isSectorSolvable`: mapa de sector determinista con ruta completable garantizada.
- `createRun`: partida en tiempo real con paso fijo de 0,1 s y determinista. Viaje por régimen (económico, crucero, máxima), energía con sobrecarga y apagón, fuego que se propaga, cortocircuitos que se incendian, fugas de oxígeno, impactos con aviso y maniobra evasiva, escudos, repuestos, servicio de estación, contenedores a la deriva, portal y sectores crecientes, permadeath (casco, oxígeno, nave varada) y puntuación.
- Mensajes del motor en es/en, todos de una línea.
- Tripulante simulado para balance (`src/__tests__/bot.ts`) y comando `pnpm balance`.
- 69 tests en 6 archivos.

#### `@payload/client`
- Interior de la nave caminable en 1ª/3ª persona: puente (timón, mapa estelar, navegación), cubierta media (soporte vital, escudos) y sala de máquinas (panel de energía, reactor, motores).
- Interacción por proximidad con E (pulsar o mantener) y Q; mapa estelar; panel de energía (teclas 1-4); HUD mínimo; pantallas de menú, ayuda, pausa y fin de sector/expedición; mejor marca guardada.
- Efectos: fuego, chispas, gas, luces de alarma por zona, estelas del salto, sacudida en impactos, carteles en el mundo y el destino visible por la proa (la estación ERIZON al atracar en una estación).
- Audio procedural adaptado: efectos por evento del motor y música según el peligro.
- 22 tests en 2 archivos.

### Cambiado
- Regla 6 del proyecto: del «¿por qué?» escrito de cada valor a «se juega, no se lee» (mensajes de una línea).
- `PlayerController`: límites de cámara por parámetro, sacudida, y física con paso variable (corrige que el personaje fuera más lento en pantallas de 120/144 Hz).
- Roadmap nuevo en `docs/phases/` (5 fases) y documentación reescrita: README, GDD, ARCHITECTURE, STATUS, CONTRIBUTING, `CLAUDE.md` de cada paquete, agentes y skills.

### Eliminado
- Motor de diseño de misiones (presupuestos, Go/No-Go, simulación orbital, puntuación, informe, asesores, pedagogía, lógica de equipo) y su catálogo (componentes, órbitas, lanzadores, escenarios, glosario, mascota Orbi, Academia).
- Prototipo de la fase 0 (`prototype/`, `pnpm proto`) y `pnpm --filter @payload/shared bench`.
- Cliente anterior (hangar, lanzamiento, órbita, sala, Academia, mascota, vista del instrumento, modo accesible 2D).
- Servidor Colyseus: `apps/game-server` vuelve a ser un marcador hasta la fase 4; se quita `pnpm dev:server`.
- Dependencias: `xstate`, `@xstate/react`, `@colyseus/*`, `@react-three/postprocessing`, `exceljs`.

> Las entradas siguientes describen el simulador anterior (ver `docs/archivo/v0.3-simulador/`); los
> documentos que citan se movieron allí.

## [0.3.0] - 2026-11-09

Fase 3 (multijugador). Contrato: `docs/archivo/v0.3-simulador/MULTIPLAYER.md`. Decisiones: ADR 0009 y 0010.

### Añadido

#### `@payload/shared`
- Lógica de equipo pura y sin reloj (`team.ts`): roles y permisos (`ROLE_PERMISSIONS`, `RESOURCE_OWNER`, `ROLE_SUBSYSTEMS`), `combineRoles`, `checkTeamAction` (solicitudes automáticas y explícitas), `applyApprovedRequest` con **aprobaciones encadenadas**, reparto de presupuesto por subsistema (`defaultAllocation`, `validateAllocation`), votación Go/No-Go con motivo (`validateVote`, `tallyGoNoGo`), alertas de equipo (`EVENT_RESPONSE_ROLES`, `alertForEvent`, `ackAlert`), `scoreCollaboration` y `withCollaboration` (la colaboración va fuera de `MissionResult`), `sanitizePlayerText`.
- `teamWire.ts`: `RoomView`, `RoomStateWire`, `encodeRoomView`/`decodeRoomView` y `teamActionSchema`/`parseTeamAction` (zod).
- Constantes de sala (`TEAM_LIMITS`, `TEAM_TIME_SCALES`, `TEAM_MASCOT_TRIGGERS`, `TEAM_ACTION_PHASES`…) y mensajes `sim:team.*` en es/en.
- `ScenarioDef.team { minPlayers, maxPlayers }` (cambio aditivo del contrato) y disparadores de mascota `team:*` y `role:*`.
- Historial de solicitudes con tope (`TEAM_LIMITS.requestHistory` = 100 cerradas; las abiertas nunca se purgan): `purgeRequests` + `CollaborationInput.purged` (la nota de colaboración no cambia al purgar).
- Límite de solicitudes como cubeta de fichas: `requestBurst` (3) con `requestMinIntervalS` (2) (`takeRequestToken`, `team.reject.requestRateLimited { seconds }`).
- 335 tests en 18 archivos (antes 237 en 16).

#### `@payload/game-server`
- Servidor autoritativo Colyseus 0.18 (sala `mission`, hasta 4 jugadores) que corre el mismo motor: `RoomModel` (modelo puro), `MissionRoom` (adaptador), `schema.ts` (esquema que refleja `RoomStateWire`, escritura incremental), `mascotDirector` (mascota única por sala), `options`, `server` e `index`.
- Sala privada por código (`roomId`) y partida rápida por escenario; bloqueo al salir del lobby; reconexión con gracia de 60 s; reparto de los roles de quien se va solo a jugadores conectados; límites anti-abuso (40 mensajes/s, solicitudes, piezas, chat, ping, `move`).
- Variables `PORT`, `HOST` y `PAYLOAD_ALLOW_SEED`; script raíz `pnpm dev:server` (`ws://localhost:2567`).
- La lista de solicitudes solo se escribe con `setRequests` (purga incremental); cubeta de fichas por jugador (las solicitudes encadenadas al aprobar no gastan fichas).
- 78 tests en 7 archivos: `parity` (la sala da el mismo `MissionResult` que `runMission`), `roomModel`, `mascot`, `schema`, `options`, `network` (servidor real + clientes SDK) y `abuse`.

#### `@payload/client`
- Capa `net/`: interfaz `MissionSession` con `LocalSession` (solitario) y `RoomSession` (sala), `useRoom`, `canDo`, espejo de la simulación (nunca pasa del `simT` del servidor) y SDK de Colyseus en carga diferida (chunk propio). `VITE_GAME_SERVER_URL` o `ws(s)://<hostname>:2567`.
- UI de sala (`room/`, textos `room.*` en es/en): «Jugar en equipo», sala privada y partida rápida, lobby, `TeamBar`, chat (`T`), solicitudes (`R`), reparto de presupuesto, pings (`P`), alertas, votación con motivo del No-Go y colaboración en el informe; reintento tras una caída.
- `ControlRoomScene` (sala de control con avatares), `RoomAvatars` (avatares y pings en el hangar), `NoticeBanner`; atajo de desarrollo `?room=demo`.
- `room.error.locked` (sala llena o ya empezada: Colyseus responde 522 «is locked») distinto de `notFound`; reintento tras una caída (`useRoom.retry`, `retryRoom`, `dismissRetry`, banner con «Reintentar»/«Descartar»); en 3D la pieza vuelve a la mano si el servidor rechaza el montaje; en 2D, enfriamiento de 2 s de los «+» que piden permiso; escenarios de equipo ocultos en la campaña en solitario y destacados en «Jugar en equipo».
- 122 tests en 8 archivos (antes 67 en 5): `net`, `room-ui` y `room-e2e` (app real + 3 clientes SDK contra el servidor real; también 5.º jugador, entrada tras empezar y código inexistente).

#### Contenido del catálogo
- Escenario de equipo `polar-ice-watch-team` (2-4 jugadores; oculto en la campaña en solitario): 7 escenarios en total.
- Glosario 28 -> 38 entradas y mascota Orbi 74 -> 108 diálogos (incluye `team:*` y `role:*`).

#### Documentación
- ADR 0009 (servidor autoritativo con Colyseus) y ADR 0010 (un proceso, sin Redis por ahora); `docs/MULTIPLAYER.md`; `docs/phases/fase-3.md` con casillas marcadas.

#### Dependencias
- `apps/game-server`: `@colyseus/core` 0.18.27, `@colyseus/ws-transport` 0.18.4, `@colyseus/schema` 5.0.45; dev `@colyseus/sdk` 0.18.9, `vitest`, `tsx`, `esbuild`, `typescript`, `@types/node`.
- `apps/client`: `@colyseus/sdk` 0.18.9.
- `pnpm-workspace.yaml`: `allowBuilds.msgpackr-extract: false` (acelerador nativo opcional de msgpackr: se usa la versión JS y no se ejecutan scripts de instalación de terceros).

### Cambiado
- Los escenarios con `team.minPlayers >= 2` no se ofrecen en la campaña en solitario.
- `apps/game-server` deja de ser un marcador.

### Problemas conocidos
Ver `docs/STATUS.md`: hito sin hacer (misión completa con 4 personas reales en equipos distintos); voz WebRTC no implementada (opcional); sin pings en la vista orbital; reloj de sala estimado por el cliente; UI de sala con paneles que tapan la sala por debajo de `lg`; sin Redis (un proceso).

## [0.2.0] - 2026-11-08

Fase 2 (contenido y aprendizaje). Estado, métricas y acciones pendientes: `docs/STATUS.md`. Decisiones: ADR 0008.

### Añadido

#### `@payload/shared`
- Eventos aleatorios ponderados por dificultad (`EVENT_TABLES`, `ScenarioDef.eventTuning`): sobrecalentamiento, falla de componente (fiabilidad x radiación; degradan sin destruir), retraso de lanzamiento y recorte de presupuesto (`rollPreLaunchEvents`, `MissionSimOptions.preLaunch`, tercer argumento de `computeBudgets`). `deriveSeed` para flujos de azar separados.
- Rueda de reacción con star tracker: apuntado de respaldo 1°/2°/5° (`wheelBackupPointingDeg`).
- Fase orbital de Kepler (`orbitPhase`, `meanPhase`, `altitudeKm`; `solveKeplerEquation`, `trueAnomalyFromMeanAnomaly`, `orbitPhaseAt`).
- Contenido pedagógico como datos zod: `glosario.json`, `mascota.json`, `academia.json` (`catalog.glossary/mascot/academy`, opcionales); `adviseByRole`, `pickMascotDialogue`, `evaluateAcademyStep`, `getGlossaryEntry`.
- Catálogo: 5 escenarios de campaña + `academy-cubesat-leo`, 43 componentes (16 nuevos, incl. `payload-surface-rover`), 7 lanzadores (Zorzal, Pampero, Jaguar), 28 entradas de glosario, mascota original Orbi (74 diálogos) y Academia de 21 pasos.
- Fixtures por escenario (`src/__tests__/fixtures/scenarios/`) y `scenarios.test.ts`; 237 tests en 16 archivos.
- ADR 0008.

#### `@payload/client`
- Selector de escenarios, intento persistente por escenario (`state/progress.ts`) y fase `prelaunch` con `PreLaunchScreen`.
- Mascota (`src/mascot`, tecla `H`), Academia (`src/academy`), asesores por rol y glosario (tecla `G`).
- Audio procedural con Web Audio (`src/audio`): música adaptativa de 5 capas, 13 efectos, emisores 3D, buses y volúmenes, silenciar, subtítulos de sonido y flashes visuales.
- Vista del instrumento (tecla `I`, `src/instrument`) y `SurfaceScene` con Aurora G9 en las misiones lunar y Marte.
- 67 tests en 5 archivos (`phase2.test.ts`, `phase2b.test.ts`).

#### `assets/`
- Aurora G9 como `payload-surface-rover`; secciones Aurora fase 2 y Audio en `CREDITS.md`; `.gitattributes` con `*.ogg binary`.

### Cambiado
- Puntuación: penalización por agotamientos de batería (`energyCriterion`; `warn-power-storm` 91,7 -> 63,2 con la semilla por defecto) y criterio de vida lineal 75 % -> 100 % (`lifetimeCriterion`).
- `orbitPhase` pasa a ser la anomalía verdadera / 2π (antes fase uniforme); el tiempo de la simulación sigue en anomalía media, así que los presupuestos no cambian (ADR 0008 §6).
- La semilla de una partida es `defaultSeed + intento`, con el intento persistido por escenario (antes se reiniciaba a 0).
- `OrbitScene` dibuja la órbita de Kepler con arco de eclipse; cotas de `catalog.test` subidas (<= 50 componentes, <= 8 lanzadores).
- Skill `3d-models` portable (sin `stat -c` ni `realpath`) y con sección "Usar un modelo en una escena"; `CREDITS.md` corregido (columna Cambios).

### Corregido
- Incoherencia entre falla de rueda y ADCS; Academia saltable (revisión bloqueada hasta `step-go`); paso de lanzamiento (`step-launch`); "Rediseñar" en la Academia; desenfoque de la vista del instrumento; el rover contaba en `payloadCount`; fugas de listeners del audio; consumo de CPU de la música (se paran capas con volumen 0).

### Problemas conocidos
Ver `docs/STATUS.md`: hito con estudiantes sin hacer; audio sin escuchar; lanzamiento, `PreLaunchScreen` y superficie sin verificar en pantalla; chunk `HangarScene` 2,28 MB; mascota sin modelo 3D; Rise no incluida (requiere autorización de NASA).

## [0.1.0] - 2026-11-07

Fases 0 (preproducción) y 1 (rebanada vertical en solitario). Estado y acciones pendientes: `docs/STATUS.md`.

### Añadido

#### Repositorio y documentación
- Monorepo pnpm + Turborepo (`apps/*`, `packages/*`), TypeScript estricto, `.nvmrc` (Node 24), `engines.node >= 22`.
- `docs/GDD.md`, `docs/phases/` (fases 0-4), ADR 0001-0007, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, `README.md` y `CLAUDE.md` por paquete.
- Agentes del proyecto (`sim-engine`, `client-3d`, `content-designer`, `asset-pipeline`, `validator`, `docs-writer`) y skills (`3d-models`, `validate`, `add-catalog-item`) en `.claude/`.
- Marcadores `apps/game-server` (fase 3) y `apps/api` (fase 4), sin código.

#### `@payload/shared` (motor)
- Contrato de dominio `src/types.ts` (catálogo, diseño, presupuestos, simulación, informe, `MessageRef`).
- Catálogo JSON validado con zod: 27 componentes, 6 órbitas, 4 lanzadores y 1 escenario LEO, en es/en con su "¿por qué?".
- Mecánica orbital: periodo de Kepler, eclipse, contacto con estación (elevación mínima 10°).
- `computeBudgets` (masa, energía, batería, presupuesto, tiempo, datos, comunicaciones, vida) con margen, estado y `why`.
- `reviewGoNoGo` con bloqueadores, avisos e información, incluido el aviso `power-storm`.
- Simulación determinista con paso fijo de 30 s (`createMissionSim`, `runMission`), baterías con desgaste y agotamiento, eventos pre-sorteados (tormenta solar, basura espacial, falla de rueda de reacción) y `createRng(seed)`.
- `scoreMission` (objetivos, ciencia, eficiencia, colaboración) y `buildReport` con cadena de causas.
- i18n del motor (namespace `sim`, es/en), `formatMessage` y anidamiento `$t(catalog.{{id}})`.
- 140 tests en 10 archivos (incluye pureza, determinismo, paridad es/en y balance de diseños) y `bench` de rendimiento.

#### `@payload/client`
- Flujo de misión con máquina XState: menú, briefing, hangar, revisión Go/No-Go, lanzamiento, operación e informe, con "Rediseñar".
- Hangar caminable en 1ª/3ª persona (Rapier, transición de cámara de 0,4 s), montaje de piezas en estantes y nave procedural.
- Panel de recursos (`Tab`), selector de órbita y lanzador, escena de lanzamiento, escena orbital con aceleración temporal 0×-10 000×.
- Informe con puntuación y cadena de causas; ayuda `H`; ajustes (idioma, FOV, balanceo, sensibilidad, sombras); pantalla de créditos.
- Modo accesible 2D equivalente a todo el flujo.
- i18n es/en (namespace `ui`) sin recargar; stores Zustand; carga diferida de escenas y modelos pesados.
- 9 tests en 3 archivos (paridad i18n, flujo de la máquina, integración con el motor).
- Atajos de desarrollo `?phase=briefing|design|launch|operation|report` (solo `pnpm dev`).

#### `assets/`
- 4 modelos GLB de Sketchfab: originales en `models/source/`, optimizados con meshopt en `web/models/` (~11,9 MB servidos); `CREDITS.md` con licencias y aviso CC-BY-NC-ND de ERIZON.

#### `prototype/` (fase 0)
- CLI `pnpm proto` sobre el motor real, hoja de cálculo `payload-prototipo.xlsx` generada desde el catálogo, prototipo en papel y plantilla de registro de pruebas.
- 9 diseños de ejemplo en `prototype/designs/` (válidos, con aviso y que fallan por causas distintas).

### Problemas conocidos
Ver `docs/STATUS.md`: hito de la fase 0 sin probar con personas, `power-storm` demasiado benigno para su efecto real, LEO a 450 km, sin mando/táctil.
