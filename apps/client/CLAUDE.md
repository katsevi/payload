# @payload/client — cliente web (React 19 + R3F + Rapier + Vite)

Fases 1-3 y fase 4 (diseño de misión): menú → elegir misión → hangar (diseño y Go/No-Go) → partida en el interior de
la nave (mapa del sistema solar, o mapa estelar en la partida libre; saltos, averías) → aterrizaje en destinos con
superficie (descenso, EVA con jetpack, recogida, vuelta, despegue) → fin de sector o de expedición (→ «Rediseñar»).
Además, la base del cooperativo 1-4 (fase 6): menú → «Cooperativo» → sala con código → la misma partida reflejada
desde el servidor. Lee antes el `CLAUDE.md` raíz y el de `packages/shared`. Diseño: `docs/GDD.md`.

## Estructura (`src/`)

| Carpeta | Contenido |
| --- | --- |
| `app/` | `App.tsx`: pantalla (`menu`/`missions`/`design`/`game`), qué escena (`sceneFor`) y qué paneles se pintan; atajos de desarrollo `?play=1&seed=N[&surface=…][&mission=<id>]`, `?design=1[&mission=<id>]`; `devFixtures.ts` (solo desarrollo: diseños de referencia de los fixtures del motor) |
| `game/` | `runStore.ts` (Zustand: crea la `Run`, `tick`, `act`, avisos, mejor marca; `getRun()` = estado vivo; `fx.shake`, `shakeForEvent`, `shipSpawn`, `stopSurfaceLoops`), `layout.ts` (PURO: casco, mamparos, los 9 puestos con la esclusa, `CARGO_BAY`, `nearestStation`, `zoneAt`, `runSecondsBetween`), `interaction.ts` (PURO: `interactionAt` con estimaciones del timón y coste de O₂ de la esclusa, `promptFor`, `holdAction`, `chargedAction`, `altAction`, `nextThrottle`, `sendInChunks`), `surfaceRules.ts` (PURO: posición de la nave en la superficie, `sceneFor`, `surfaceInteractionAt`/`surfacePromptFor`/`surfaceUseAction`/`surfaceAltAction` (herramientas), `toolFor`, `leftOutside`, `nearestReadyTool`, `shipBearing`/`bearingTo`, `brakeThresholdMps`, `stormLevel`, `STORM_WIND_MPS`, `fallDanger`/`predictedImpactMps`, `o2ReturnShort`, ritmo de respiración y pitido), `terrain.ts` (PURO: `createTerrain` → `heightAt`/`chasmAt`, `terrainGrid`), `motion.ts` (PURO: `stepMotion`/`settleMotion`, `SHIP_MOTION`, `surfaceMotion(g, flightLimitsOf(rules))`, `simulateFlight`, `jetpackNetUpMps2`), `noise.ts` (PURO: `hashOf`, `rng`, `mixSeed`, ruido 2D/3D), `dodge.ts` (PURO: esquiva de asteroides en el timón), `repairGames.ts` (PURO: extintor, pulsos y sellado de las averías), `debug.ts` (`reachSurface`, `travelToLandable`, `autoDescend`, `reachStation`, `travelToStation`, `mineForSale`), `effective.ts` (`baseShipOf` = `shipFromDesign(missionDesign)` con diseño o `getShip(shipId)` sin él; `effectiveShipOf`/`effectiveRulesOf`: nave y reglas de superficie con las mejoras, memorizadas; `maxPowerKwOf`: 100 % de la barra de energía a la distancia al Sol actual), `missionDesign.ts` (PURO, fase 4: `addPart`/`removePart` (estructura y propulsión se sustituyen), `PALETTE_GROUPS`/`paletteItems`, `partTokens` (la línea de cada pieza), `previewAdd` (qué se excedería), `meterFill`, `sortedIssues`, `canLaunch`, `destinationOptions`/`launcherOptions`, `startingDesign`, `saveDesign`/`loadDesign`/`sanitizeDesign`/`hasSavedDesign` (localStorage `payload.design.<misión>`), `cycleIndex`/`partKeyAction`), `hangarLayout.ts` (PURO: bloques de la sonda montada con forma, variante, giro, anclaje y orden de montaje; test `hangar.test.ts`), `solarScale.ts` (PURO: escala del mapa solar, ver abajo), `shop.ts` (PURO: terminal de estación: `sellRows`, `supplyRows`, `upgradeRows`/`upgradeDeltas`, `FIELD_INFO`, acciones, `moveFocus`, `cargoFuelPct`, `installedUpgrades`) |
| `scenes/` | `ShipScene` (`<Canvas>`, entorno de reflejos, `GameLoop`: tick + teclas E/Q/V/H + pausa al soltar el ratón; con la nave posada pinta `LandedView` en vez de `SpaceView`), `ShipInterior` (`Hull`), `ShipStations` (`Stations`: los puestos con sus colisiones), `ShipCargo` (`Airlock3D`, `CargoBay`), `ShipFx` (`ZoneLights`, `IncidentFx`, `Markers`), `ShipMinigames` (`DodgeHolo`: holograma de pilotaje sobre el timón; `FlameTarget`: foco del fuego al que se apunta), `SpaceView`, `SpaceBodies` (`Body`), `SurfaceScene` (`<Canvas>` propio: `DescentLoop` o `SurfaceLoop`), `SurfaceTools` (concentrador solar y taladro láser colocados, con sus estados), `SurfaceWorld` (terreno + colisión trimesh, rocas, vetas, terreno inestable, cielo, niebla, tormenta; `liveTerrain`), `ShipExterior` (la nave posada vista desde fuera, baliza, propulsores, colisiones), `MenuScene` (también tras las tarjetas de misión), `HangarScene` (fase 4: la sonda se monta pieza a pieza con grúa, soldadura y holograma de la pieza señalada; `HangarEnv`: nave de integración, plataforma giratoria, torre, grúa puente, focos), `SolarMapScene` (fase 4: mapa 3D del sistema solar, con `lazy` desde `StarMap`) |
| `gfx/` | Gráficos procedurales (sin assets que descargar): `quality.tsx` (`ShaderWarmup`, `useAdaptiveDpr`), `textures.ts`, `materials.ts` (`mats()`), `build.tsx` (`Builder`, `Parts`, `once`), `glsl.ts` (ruido y reloj `TIME`), `shipShaders.ts`, `fxShaders.ts` (`puffMaterial` exportado), `spaceShaders.ts`, `surfaceShaders.ts` (parche del suelo: grietas, borde, lava, explanada; cielo; tormenta; polvo; haces; llama de propulsor), `surfaceLook.ts` (paleta por `worldId` y aspecto de cada material de veta), `bodyLook.ts` (aspecto de los cuerpos del mapa solar: deducido de tipo, tamaño, atmósfera y mundo, con tabla propia para los reconocibles), `rocks.ts` (`rockGeometry`, `pebbleGeometry`, `rockMaterial`), `probeModels.ts` (piezas de la sonda del hangar), `hangarShaders.ts` (holograma, haces de focos, chispas de soldadura), `Glow.tsx`, `Sky.tsx` |
| `ui/` | `kit` (piezas del sistema visual: `Button`, `SegBar`, `Tag`, `KeyHint`, `StatRow`, `SectionLabel`, `Tabs`, `Toast`; ver «Sistema visual (UI)»), `MissionScreens` (fase 4: `MissionsScreen` con las tarjetas y `DesignScreen`, el hangar), `names.ts` (`nodeName`: `catalog.<bodyId>` o el nombre del punto de paso; `distanceText`: años luz o unidades de ruta), `Hud` (barras, viaje, alertas, avisos, acción disponible; con diseño, distancia al Sol y paneles bajo la energía y misión → destino; exporta `Gauge`/`levelOf`), `SkillHud` (mira del extintor y barras de pulso/presión, sin React por frame), `SurfaceHud` (`DescentHud`, `SuitVitals` con teclas del jetpack, racha y herramientas, `ShipCompass`, `ToolCompass`, `FallAlert`, `O2Vignette`, `WorldBadge`), `ToolIcon`, `StarMap`, `PowerPanel`, `StationTerminal` (terminal de estación), `Credits` (`CreditsBadge`, `UpgradeIcon`, `UpgradeStrip`), `Screens`, `common` |
| `player/` | `PlayerController` (controlador cinemático Rapier parametrizado por `MotionParams`, cámaras 1ª/3ª con rayo contra colisiones, sacudida), `input.ts`, `playerState.ts` (`playerState`, `motionEnv`, `resetPlayerState`) |
| `audio/` | Web Audio procedural: `soundLogic.ts` y `musicLogic.ts` (puros), `audioEngine.ts`, `cues.ts` (`cue(id)`), `useAudioDirector.ts`, `SoundCaptions.tsx` |
| `state/` | `ui.ts` (panel abierto, vista, aviso de acción, `descentView`, `hudView`), `settings.ts` (persistido), `minigame.ts` (minijuegos en curso, mutable), `hangar.ts` (pieza señalada en la paleta) |
| `models/` | GLB con `useGLTF`: `Models.tsx` (`FittedModel`, `ModelBoundary` con forma de respaldo) |
| `net/` | Cooperativo (fase 6): `coopSession.ts` (conexión, lobby, envío agrupado, poses, pings) y `coopStore.ts` (`useCoop`, `coopLive`) |
| `i18n/`, `locales/` | i18next: namespace `ui` (`locales/{es,en}.json`) y `sim` (del motor) |
| `data/` | `credits.ts` (espejo de `assets/CREDITS.md`) |

## Reglas

- **El motor manda.** El cliente no calcula combustible, energía ni daños: llama a `run.apply` y lee
  `run.state`. Toda escritura de juego pasa por `useGame.getState().act(action)`.
- **Dos formas de leer la partida.** La escena 3D lee `getRun()?.state` dentro de `useFrame` (sin
  re-render). React lee `useGame((s) => s.hud)`, una copia que se refresca a ~10 Hz o cuando hay eventos.
  No uses `hud` por frame ni `run.state` en el render.
- **Acciones mantenidas:** mientras se mantiene el control, `GameLoop` envía la acción cada frame con
  `act(action, true)` (el `true` evita un aviso por cada rechazo). Cuentan el **tiempo real** del frame (tope
  1 s), troceado con `sendInChunks` en partes de `MAX_WORK_SECONDS`: a menos de 10 FPS no se alargan (el
  `tick` sí sigue con tope de 0,1 s). Igual al entrar por la rampa. Ver «Interacciones de la nave».
- **Proximidad, no puntería.** El puesto activo es el más cercano dentro de `USE_RADIUS`; no hace falta
  mirarlo. Si añades un puesto, añádelo a `STATIONS`/`STATION_IDS` y a `interactionAt`.
- **Tiempo:** el mapa, el panel de energía, el terminal de estación y la ayuda NO pausan. `pause`, `settings` y `credits` sí
  (`runStore.tick` lo decide). Soltar el ratón con Esc sin panel abierto pone la pausa.
- **i18n sin texto en el código.** UI: `t('clave')` (ns `ui`). Motor: `tr(messageRef)` o
  `t('systemName.x', { ns: 'sim' })` — escribe `ns: 'sim'` en la misma llamada: el test de claves lo usa
  para distinguirlas. Catálogo: `lt(localizedText)`. Toda clave nueva va en `es.json` **y** `en.json`.
- **Poca letra.** Textos de juego de una línea (el test limita a 110 caracteres). Si algo necesita un
  párrafo para entenderse, cambia la mecánica o la señal visual.
- **Rendimiento:** nada de `new` ni `setState` por frame; usa refs y `getState()`. Las escenas se cargan
  con `React.lazy` (no importes `three` desde `app/`, `ui/` ni `game/`: irías al bundle inicial).
  `<Physics timeStep="vary">` es deliberado: con paso fijo de 60 Hz el personaje va lento a 120/144 Hz.
- **Convención de los puestos:** el frente del objeto es +Z local y `Station.yaw` lo gira hacia el punto
  de uso (`useX`, `useZ`).
- **Modelos procedurales (`gfx/`):** la geometría estática de un modelo se describe con `Builder`
  (cajas, cilindros, tornos, tubos) dentro de `once(...)` y se pinta con `<Parts>`: queda fusionada en
  una malla por material. Usa los materiales de `mats()`; no crees `meshStandardMaterial` sueltos para
  piezas estáticas. Solo lo que se mueve o cambia (palas, bobinas, palancas, pantallas) va en su propia malla.
- **Lo visible no cambia las colisiones.** `Hull` y cada puesto conservan sus colisionadores simples; el
  detalle es decoración. Si un adorno sobresale del colisionador, que sea poco (la cámara puede meterse).
- **El estado se ve en el objeto.** Cada puesto refleja el motor sin texto: piloto de estado, palancas del
  panel (arriba = alimentado), medidor de carga, galones de régimen del timón, radar, palas de los motores.
- **Shaders:** uniforme de tiempo común `TIME` (lo avanza `<ShaderClock>`, uno por `<Canvas>`). Los
  shaders emisivos van con `toneMapped: false` y terminan en `#include <colorspace_fragment>`; los
  iluminados terminan con `OUTPUT`. Ruido 2D: usa `NOISE2` de `glsl.ts` (su hash está comprobado sin costuras).
- **Brillo sin post-proceso:** no hay bloom. El resplandor se hace con `<Glow>` (sprite aditivo). Los
  reflejos vienen del `Environment` de `ShipScene`, que se rinde una vez; `ZoneLights` lo atenúa en un apagón.
- **Luces puntuales contadas:** 3 de zona + 1 del reactor + 2 de averías (para las averías más vistosas; las demás solo
  con halo). **El número de luces de cada tipo no debe cambiar nunca en una escena:** three.js recompila todos los
  materiales iluminados cuando cambia (1-3 s de congelación en una GPU integrada). Nada de luces dentro de grupos que
  se ocultan ni montadas a ratos: déjalas siempre y pon la intensidad a 0. Por eso `SpaceView` lleva una direccional y
  una hemisférica apagadas que igualan las de la vista posada (`SurfaceWorld`), y el relleno de la superficie está
  siempre (a 0 si el mundo no lo usa).
  La superficie no añade ninguna: sol direccional + relleno direccional opuesto sin sombras (`fillIntensity`,
  mundos sin aire) + hemisférica + `Environment` horneado una vez; sin mapas de sombra (ver Pendiente); la baliza
  de la nave y las vetas raras son halos y haces aditivos (`fog: false`, se ven desde lejos).
- **Fluidez (`gfx/quality.tsx`):** `ShaderWarmup` va el último dentro del `<Canvas>` de la nave y de la superficie:
  precompila todos los materiales (también los ocultos) con `compileAsync` y no pinta hasta tenerlos (`watch` repite al
  cambiar lo que se ve fuera); toma el pintado con prioridad 1. `useAdaptiveDpr` baja la resolución a 1 si caen los FPS.
  Los cambios de escena dentro de la partida pasan por un fundido (`App.useSceneTransition`, `.scene-veil`,
  `useUi.sceneVeil`) que la escena nueva quita al pintar (`revealScene`). Lo pesado por CPU de la superficie se cachea
  (malla del terreno en `SurfaceWorld`, texturas y rocas preparadas en el puente).
- **Carteles en el mundo (`Markers`):** `Html` de drei; se ocultan a mano cuando quedan detrás de la cámara.
- **Audio:** dispara siempre con `cue(id)` (suena + destello + subtítulo), nunca con `audio.play`. Sonido
  nuevo = `SfxId` en `soundLogic.ts` + clave `sound.<id>` + `case` en `AudioEngine.synth`. Los efectos de
  los eventos del motor salen de `sfxForRunEvent` en `runStore`. Sin Web Audio todo es no-op.
- **Modelos:** `publicDir` = `../../assets/web` (URL `/models/<archivo>.glb`). Registra assets nuevos en
  `assets/CREDITS.md` y en `src/data/credits.ts`. ERIZON (la estación) es CC-BY-NC-ND.

## Interacciones de la nave (no todo es E)

- **Teclas:** E = usar/abrir (mapa, panel de energía, esclusa, aterrizar/despegar manteniendo, tomar los
  mandos del timón); **R** = reparar con repuesto (encajar la pieza: mantener y soltar en la marca, dos tramos;
  misma mecánica que sellar, `minigame.spare`, envía `repair-system {seconds}` y el coste no cambia); **clic izquierdo o Espacio** = la habilidad de
  cada avería; Q = régimen / soltar carga. Las claves están en `interaction.ts` (`KEY_USE`, `KEY_REPAIR`,
  `KEY_SKILL`, `KEY_STEER`) y el aviso las pinta con `Prompt.inputKey` (y `noVerb`, `progressBar`).
- **Esquiva (`game/dodge.ts` + `DodgeHolo`):** con un aviso de impacto, pulsar E en el timón arranca un minijuego
  de duración FIJA `DODGE_DURATION_S` (3 s; dificultad compactada: más rocas/s y llegada más corta que la versión
  de 4 s); las rocas dependen solo de la dificultad, nunca del ETA. Si al tomar los mandos no queda tiempo para
  jugarla entera (`canPlayDodge`: ETA < 3 + `DODGE_LEAD_S` 0,4 = 3,4 s), no se juega: se envía
  `lateDodgeResult(eta, nivel)` = `1 + ⌊1,2·nivel + 2,5·retraso⌋` roces (suave al principio, nunca limpia; el
  aviso dice `prompt.evadeLate` en ámbar). Ventana para llegar (aviso a `warnLeadLy` 4 ly): económico 12,3 − 3,4
  = 8,9 s, crucero 8 − 3,4 = 4,6 s (cruzar la nave cuesta como mucho 3,9 s: un test lo fija), máximo 5 − 3,4 =
  1,6 s. Con el aviso activo y lejos del timón: `HelmPointer` (flecha ámbar junto a la mira hacia el timón,
  `hudView.helm*`) y `warnTick` cada `WARN_REPEAT_S` (1,4 s) hasta llegar. Un test con pilotos simulados (`__tests__/dodgeBots.ts`: torpe, medio,
  bueno) fija que llegar tarde nunca es mejor que jugarla (bien o en la media) y que la dificultad se nota. WASD/flechas mueven la nave del holograma; las
  rocas llegan desde el fondo y proyectan un anillo donde golpearán. Semilla y dificultad del aviso del motor
  (`evadeSeed`, `evadeDifficulty`) o, si faltan, derivadas aquí. Pasos fijos de 1/120 s (no depende de los FPS).
  Al llegar cada roca: limpio, roce (`dodgeGraze`) o choque de lleno (`dodgeHit`, sacudida). Al terminar se
  guarda `minigame.lastDodgeResult: DodgeResult = { grazes, fullHit }` y se envía `evadeAction(result, maxGrazes)`
  = `evade {grazes}` (choque de lleno = `maxGrazes`, esquiva fallida; `maxGrazesOf(catalog.hazards.impact.evade)`).
  El resultado suena y sacude con el evento: `impact-evaded` clean, `impact-hit` graze (roce, sacudida menor) o
  failed (golpe entero). El motor sigue corriendo. Sin llegar al timón, el
  impacto entra como siempre. Señal sin texto: el holograma late con rocas a la deriva y el marcador del timón
  lleva solo iconos.
- **Averías (`game/repairGames.ts`):** se traducen a `work-incident {seconds}` (troceado con `sendInChunks`);
  hacerlo bien entrega más trabajo, mal menos, nunca bloquea. **Fuego**: mantener el clic con la mira sobre el
  foco que se mueve (`FlameTarget`, anillo oscuro sobre las llamas; `aimOnTarget`): ×1,6 acertando, ×0,3 a
  ciegas (ajuste `wideAim`: área ×2). **Cortocircuito**: clic cuando la marca pasa por la zona entre corchetes
  (`PULSE_PERIOD_S` 1,25; acierto = 50 % del `repairS`, dos bastan; fallo = 6 % y espera más larga). **Fuga**: mantener para subir la presión y soltar en la zona
  (55 % / 10 %; pasarse revienta y reinicia). Acierto/fallo: icono ✓/✗ y sonido (`skillHit`/`skillMiss`).
- **Modos simples** (ajustes separados): `simpleDodge` = esquiva manteniendo E (1 roce; si ya no daba tiempo,
  el resultado de llegar tarde) y `simpleRepairs` = averías y repuestos manteniendo R a ritmo normal. `wideAim`
  ensancha el área de acierto del extintor. `promptFor`/`chargedAction` aceptan `SimpleModes`. Para quien no pueda o no quiera los minijuegos.

## Economía y terminal de estación (fase 3, ADR 0014)

- **Abrir:** atracada en una estación con terminal (`hasShop`), la **esclusa** pasa a ser el terminal: E junto a
  ella abre `overlay = 'terminal'` (`interactionAt` → `{ kind: 'terminal' }`, aviso `prompt.terminal` con los créditos).
  También el botón «Terminal de la estación» del mapa estelar. Esc o E lo cierran. Como el mapa, **no pausa**
  (atracada no hay desgaste, pero el O₂ y las averías abiertas siguen): decisión coherente con `map`/`power`.
- **Todo viene del motor:** `run.stationQuote()` (precios, unidades, faltantes, oferta, emergencia) y acciones
  `sell`, `buy-supply`, `buy-upgrade`, `service` por `act()`. Ninguna cifra, id ni precio en el cliente; el
  content-designer puede cambiar `economia.json`/`mejoras.json` sin tocar código. Rechazos: aviso breve dentro del
  terminal (`tr(reason)`), aviso del HUD y, si es `reject.noCredits`, `cue('noCredits')` (en `runStore.act`).
- **Línea de efecto de una mejora** (`upgradeDeltas`): compara `effectiveShip`/`effectiveSurfaceRules` con un nivel
  más frente a los actuales en todos los `UPGRADE_FIELDS`; `FIELD_INFO` dice qué es mejor (sube/baja) y cómo se
  escribe (`abs` «Depósito 100 → 125», `pct01`, `rel` «Consumo −12 %», `kw` «Escudos +8 kW»). Ganancias en verde,
  contrapartidas y masa («+25 kg») en ámbar; como mucho 2 + 2 en UNA línea. Icono por el campo del primer efecto
  (no por id). Un campo nuevo en el contrato exige su entrada en `FIELD_INFO` y `shop.field.*` (lo comprueba un test).
- **Deshabilitado:** sin créditos el botón queda deshabilitado con el precio en rojo (`.shop-poor`); lleno = «Lleno»;
  al máximo = «Al máximo». Teclado: el foco empieza en el primer botón; flechas arriba/abajo en la columna,
  izquierda/derecha entre venta y tienda (`moveFocus`), Intro compra, Tab también vale.
- **Máximos efectivos:** el HUD (casco, combustible, energía, repuestos), el panel de energía, el descenso, el traje
  (mochila, O₂) y la superficie (`surfaceInteractionAt`, `suitRefill` de la esclusa, límites de vuelo) usan
  `effectiveShipOf`/`effectiveRulesOf` o `run.effectiveSurfaceRules()`; nunca `getShip()` ni `getSurfaceCatalog().rules`.
- **Señales:** `CreditsBadge` (HUD de la nave, mapa y terminal; late y saca «+N/−N» al cambiar), `UpgradeStrip`
  bajo los recursos (icono por mejora con un piloto por nivel: la nave es otra sin tocar la geometría exterior), en el
  mapa «+N % por carga» si `estimateJump().cargoFuelMult` > 1, y en el final créditos ganados/gastados y mejoras.
  Sonidos `sale` (venta y contrato), `purchase`, `upgrade`, `noCredits`; los eventos salen como avisos normales.

## Diseño de misión y sistema solar (fase 4, ADR 0016)

- **Flujo (`runStore`):** `screen` = `menu` → `openMissions()` → `missions` → `openDesign(id)` (último diseño guardado de
  esa misión o `startingDesign`) → `design` → `updateDraft(d)` (lo guarda con try/catch) → `launch()` =
  `startRun(seed, draft)` → `game`. `runDesign` es el diseño de la partida (null = «Partida libre», que sigue en el
  menú). Fin de partida: «Reintentar la misión» (mismo diseño, semilla nueva) y «Rediseñar» (`redesign()`: vuelve al
  hangar con el diseño cargado); «Rediseñar» también en la pausa.
- **Hangar (`DesignScreen`):** arriba destino (UA y sol relativo) y lanzador (coste y toneladas a la zona del destino, o
  «No llega»); a la izquierda la paleta por grupos con una línea por pieza (lo que da en verde, lo que cuesta en gris) y
  ⚠ si añadirla excedería algún presupuesto; a la derecha los seis medidores del motor (`computeDesignBudgets`:
  ok/tight/over, marca blanca = límite, fantasma = cómo quedaría con la pieza señalada), ciencia, fiabilidad y la
  revisión (`reviewDesign`, lo que bloquea primero); «Lanzar» solo con Go. El «¿por qué?» de cada medidor sale al pasar
  el ratón o con **H** (opcional). Teclado: ↑↓ pieza, ←→ grupo, Intro/+ añade, Supr/− quita, Esc vuelve a las misiones.
  Abajo las piezas montadas (clic = quitar una). Detrás, `HangarScene` con la nave montada (`hangarLayout`).
- **Escena del hangar (`HangarScene` + `HangarEnv`, ver abajo).**
- **Nada fijo:** ninguna cifra, id ni nombre del catálogo en la lógica del cliente; nombres `catalog.<id>` (ns `sim`) y
  motivos `design.review.*`/`design.why.*` del motor. Los ids de `gfx/bodyLook.ts` y de `TERRAIN_STYLES`/`SURFACE_LOOKS`
  son solo de aspecto y tienen respaldo.
- **Nave base:** con `state.missionDesign` la base es `shipFromDesign(diseño)` (`baseShipOf`); la usan `effectiveShipOf`,
  la terminal (`upgradeRows`, `upgradeDeltas`, `upgradeOverloads`) y las barras de energía; `overloadsAtCruise` usa
  `cruisePowerMarginKw(nave, state.sunDistanceAu)`. Nunca `getShip(state.ship.shipId)` en una partida con diseño.
- **Mapa del sistema solar (`SolarMapScene`):** sustituye al mapa estelar SOLO en partidas con diseño (la partida libre
  sigue con el SVG). Sol con halo y una luz puntual (lienzo propio), órbitas, cinturón instanciado (rango sacado de las
  zonas sin planetas), cuerpos con los planetas procedurales de `spaceShaders` (luz hacia el Sol), anillos, lunas junto
  a su planeta, puntos de paso, enlaces del tramo, saltos posibles pulsando, destino de la misión en dorado (★), marcador
  de la nave en tránsito (por frame) y etiquetas como sprites de lienzo (no `Html` de drei: dejaba errores de
  desmontaje de raíces de React). OrbitControls; encuadre en la nave, los saltos, la llegada del tramo y el destino.
  Panel lateral: el de siempre (estimación, régimen, saltar) más distancia al Sol, sol relativo, paneles aquí, potencia
  allí (`shipPowerKw`) y aviso si a crucero no da (`cruisePowerMarginKw`); «Saltos posibles» como botones (teclado).
- **Escala (`game/solarScale.ts`):** radio en escena = 10 × √UA (Tierra 10, Marte ~12, cinturón ~16, Saturno ~31) con el
  ángulo del motor (`bodyPositionAu`); lunas y estaciones a `0,9 + 3·√ΔUA` de su planeta (nunca dentro del globo);
  tamaños ∝ `radioKm^0,35` acotados; puntos de paso entre la salida y la llegada del tramo en espacio de escena (en
  bucle si coinciden, p. ej. la vuelta por la zona terrestre). Lineal dejaba Marte encima de la Tierra; logarítmica
  juntaba demasiado los gigantes.
- **Unidades:** con diseño, las distancias del mapa son «u» (unidades de ruta, `map.units`; las cifras de `distanceLy`),
  nunca «años luz»; la distancia al Sol, en UA. La barra de energía va contra `shipPowerKw` a la distancia actual.
## Escena del hangar (fase 4)

- **Disposición (`game/hangarLayout.ts`, PURO):** un bloque por pieza con `shape` (bus, engine, ion, wing, rtg, reactor,
  avionics, dish, whip, radiator, whipple, emitter, tank, pod, instrument), `look` (variante), centro y tamaño de su caja,
  `roll` (giro alrededor de X; +Y local = hacia fuera de su cara), `anchor` (punto del bus, la cercha o el banco donde se
  sujeta), `order` (orden de montaje), `tier` (0-1 dentro de su familia) y `seed` (`hashOf(id)`, solo aspecto). Bus
  octogonal con el eje en X (proa +X); su largo y su radio salen de las ranuras y la masa de la estructura (sin estructura,
  medidas del bastidor vacío). Sitios: popa = adaptador, cercha con los tanques (anillos de ≤ 4) y motor al final; ±Z =
  alas por parejas simétricas (dos alas distintas de una pareja comparten envergadura, la media); diagonales = radiadores
  (popa) y cajas de aviónica (batería, computadora, ruedas, soporte vital, taller y **familias nuevas**); arriba = antenas
  (proa) y módulos presurizados (popa); RTG en brazos diagonales tras la popa; reactor en un mástil hacia abajo; banco de
  instrumentos colgado bajo la proa (filas de 3); Whipple en capas delante; anillos emisores alrededor de la proa.
- **Variantes por datos, nunca por id:** iónico = efecto `fuelPerLy` < 1; escudo activo = algún `systemDrawKw.*` > 0 (si
  no, Whipple); reactor = la más pesada de su familia (con una sola, RTG); plato = la de más `dataRateMbps` (si no, látigo);
  alas de alta eficiencia = más kW/kg; instrumentos por `scienceKind` y su masa/tasa frente a los de su tipo
  (`instrumentLook`: cámara, espectrómetro, radar, pértiga, brazo, analizador, detector, copa). Tamaños con escalas de dibujo
  (∛masa, kW, `heatRejectKw`).
- **Modelos (`gfx/probeModels.ts`):** `probeModel(block)` construye con `Builder` en el marco del bloque (origen en el
  anclaje, girado por `roll`) y cachea por forma + aspecto + medidas: dos alas o cuatro cajas iguales comparten geometría.
  Materiales de `mats()` y `probeMats()` (MLI dorada/negra, celdas estándar/alta eficiencia, pintura blanca, tobera; texturas
  `foilMaps`/`solarCellMaps`, generadas solo al abrir el hangar). Halos (`Glow`) en rejillas iónicas, emisores y reactor; sin
  luces puntuales. `benchParts`, `trussParts`, `dollyParts` (carro de giro con muñones) dependen del conjunto.
- **Montaje (`HangarScene`):** lista de piezas vivas por `${key}:${partId}`; una nueva LLEGA (la grúa la baja; si va en un
  costado, baja al lado y se desliza), se SUELDA (destello + chispas, `Welds`, 6 ranuras) y despliega alas/radiadores/plato;
  una quitada sube y se encoge; si el diseño cambia, las demás se deslizan a su nuevo sitio. Al abrir el hangar el diseño se
  monta escalonado por `order`. Todo en `useFrame` con refs; `setState` solo al cambiar el diseño y al terminar una retirada.
  La pieza en movimiento reclama la grúa (`claimCrane`); mientras hay una, la plataforma se detiene. Holograma de la pieza
  señalada (`ghostMaterial`: Fresnel, líneas y barrido + aristas) y, sin estructura, el bastidor vacío tenue. Cámara
  suavizada que encuadra según la caja de la nave (Z cuenta menos: las alas se ven en escorzo).
- **Probar:** `?design=1&mission=mission-lunar-ice` y `mission-titan-chemistry`; desde la consola
  `__payload.useGame.getState().updateDraft({...})` para montar o quitar piezas.

## Ciencia y datos (fase 5, ADR 0018)

- **HUD (`Hud.tsx`, `ScienceGauges`):** con `state.science`, bajo la energía: datos a bordo/capacidad, ciencia entregada/
  pedida, línea de enlace (`hud.link.*`: bajando, ventana en N s, sin alcance, ventana sin enlace) y «Observando X».
- **Final (`Screens.tsx`):** `missionReport(state)` del motor (`MissionReportView`): titular y eslabones con la causa raíz
  resaltada. Con `science.over` el botón principal es «Reintentar la misión» (no hay sector siguiente).
- **Batería y calor** (`Vitals`): con `ship.batteryMaxKwh` > 0, barra de batería en kWh; con `ship.overheated`, línea roja
  «Calor demanda/disipación kW». `overheat` y `battery-empty` suenan como `alarm`.
- Sonidos: `mission-complete`/`objective-met` → `success`, `storage-full` → `alarm`, `observation-done`/`contact-start` → `ok`.
- **Dificultad y misión guiada (hangar):** fila «Dificultad» en `Pickers` (`setDifficulty`); con `mission.guided` la paleta
  solo trae sus instrumentos (`paletteItems(g, cat, missionId)`, `activeGroups(cat, missionId)`), el lanzador es el fijo,
  `Mounted` no enseña ni quita módulos, `startingDesign`/`sanitizeDesign` fuerzan la nave fija y `GuidedSteps` pinta
  `guidedProgress`. La misión del hangar se muestra con `missionAtDifficulty` (ciencia pedida del nivel).
- **Astronauta articulado:** `models/ArticulatedAstronaut.tsx` (`ArticulatedAstronaut lod="high|low"`, `rig` con las
  articulaciones, `applyAstronautPose`) y `game/astronautPose.ts` (PURO: `astronautPose`, `advanceGait`; convención de
  signos en el archivo; test `astronaut.test.ts`). `PlayerController` lo posa con la velocidad real de los pies;
  `CrewAvatars` (detalle bajo, girado π: su frente es −Z) con la de la pose interpolada. Materiales del traje compartidos
  (`once`); uno de acento por color de rol. El GLB del tripulante ya no se precarga (`AstronautModel` queda sin uso).
- Visto en Chrome: hangar guiado, HUD de ciencia/batería, astronauta andando e informe al perder. Sin FPS medidos.

## Cooperativo (fase 6, ADR 0017; contrato en `docs/MULTIPLAYER.md`)

- **`net/coopSession.ts`**: conecta con el servidor (`createRoom`, `joinRoom(código)`, `leaveRoom`, `sendLobby`),
  recibe `lobby`/`state`/`events`/`result`/`poses`/`ping` y los pasa a `runStore` y `coopStore`. El SDK
  (`@colyseus/sdk`) se carga con `import()`. `reportPose` y `sendPing` (tecla G, `KEY_PING`) los llaman las escenas.
  URL: `VITE_GAME_SERVER_URL` o `ws://<host de la página>:2567`. Los tests inyectan un cliente con `configureCoop`.
- **`net/coopStore.ts`**: `useCoop` (estado de conexión, lobby, mi id, error) para React y `coopLive` (poses y
  pings) para leer por frame.
- **`runStore` en sala** (`isRemote()`): la `Run` es un espejo. `enterRemote`/`remoteState` la hidratan,
  `remoteEvents` reparte los eventos del servidor, `tick` no avanza nada y `act` valida en el espejo con mi
  `crewId`, deshace y envía. **Sigue valiendo la regla: toda escritura pasa por `act`.** No hay pausa en sala.
- **«Yo» es `myCrew(state)`** (`game/me.ts`), nunca `crew[0]`: en sala cada jugador lee su tripulante (su traje,
  su mochila, su escena). `effectiveRulesOf(state)` ya incluye la ventaja de mi rol.
- **Interfaz:** `ui/CoopScreen.tsx` (`CoopScreen`: entrada y lobby sobre el menú; `CrewBar`: tripulación durante
  la partida; `ROLE_COLORS`). Fin de partida en sala: el anfitrión devuelve a todos al lobby.
- **Escena:** `scenes/CrewAvatars.tsx` pinta a los compañeros de la misma zona (`ship` o `surface`) interpolando
  las poses, y los pings como halos. Sin colisión entre jugadores.
- **Diseño compartido (ADR 0020):** en el lobby, `MissionRow` (el anfitrión elige misión con `set-mission`; los demás la
  ven), «Abrir el hangar» (`useGame.openSharedDesign`) y `SharedVote` (voto, recuento, motivo de una línea y «Empezar»
  del anfitrión; `sharedLaunchCheck` repite la regla del servidor). Con `sharedDesign`, `updateDraft` no guarda: calcula
  `designEditsBetween` y las envía (`setSharedDesignSink`, lo registra `coopSession`); `onLobby` llama a
  `syncSharedDesign` (el hangar pinta el diseño del servidor); «volver» (`openMissions`) lleva a la sala y el botón dice
  «Sala»; en el hangar, «Lanzar» es `SharedVote`. Si un estado trae `missionDesign`, `enterRemote` crea el espejo con ese
  diseño. En sala no se ofrece «Rediseñar».
- **Menú:** «Diseñar una misión», «Partida libre» y «Cooperativo» (abre `CoopScreen`).
- Probar: `pnpm dev:server` + `pnpm dev`, dos pestañas, Menú → Cooperativo. Test: `__tests__/coop.test.ts`.

## Superficie (fase 2)

- **Qué escena se pinta:** `sceneFor(phase, crew[0].location, ui.descentView)`. Si la nave se pierde en el
  descenso, el evento `lost` apaga `descentView` y el final se pinta sobre el puente. `land` → `descentView` (lo
  enciende `runStore` con el evento `descent`) → `SurfaceScene mode="descent"`; unos segundos tras tocar tierra
  `DescentLoop` lo apaga y se vuelve al puente. En la nave posada, la esclusa (`eva-exit`) monta
  `SurfaceScene mode="eva"`; `eva-enter` vuelve a `ShipScene` junto a la esclusa (`shipSpawn`).
- **Coordenadas:** las de `set-position` (m relativos a la nave). El origen es el pie de la rampa (ahí se
  sale y ahí se entra: `airlockRangeM`); la nave está en `SHIP_OFFSET` con la cubierta a `DECK_Y` = 2,6 m
  (se puede pasar por debajo). `superficie = interior + SHIP_OFFSET`; `LandedView` desplaza el mundo al revés.
- **Terreno:** `createTerrain` (semilla de la partida + sector + nodo; mismo destino, mismo relieve). Explanada
  llana alrededor de la nave, un anillo de abismo (dos y grietas radiales en el fracturado) con pasos de roca
  para cruzar andando, cráteres/dunas según el mundo, borde de cráter pasado `radiusM`. Las vetas nunca caen
  al fondo del abismo. Una zona `collapsed` abre un hoyo de `pitDepthM` con el perfil `pitDropM` (fondo
  plano hasta media zona y pared en rampa de ~65° como mucho hasta `pitRimM`; un test comprueba en los 7 mundos
  que se sale con el jetpack lleno): la malla y el trimesh se rehacen solo cuando cambia la firma de zonas
  hundidas (`useLiveTerrain`). Estilo por mundo en `TERRAIN_STYLES`.
- **El motor manda en recursos; el cliente en física.** `SurfaceLoop` informa `set-position` a 10 Hz (y al
  cambiar `grounded`), `jetpack {seconds}` con lo empujado (si lo rechaza, `motionEnv.canThrust = false`),
  `fall-impact` desde 3 m/s y las acciones de las herramientas. Nunca escribe en `run.state`.
- **Minería con herramientas** (no se mantiene nada): junto a una veta libre, **E** (pulsar, con los pies en el
  suelo) → `deploy-tool`; el aviso muestra la herramienta que toca (`toolFor`: el motor la elige por
  `material.tool`), su icono (`ToolIcon`: sol / taladro) y cuántas quedan. Trabaja sola. Con piezas listas,
  **E** → `collect` (recoge lo que quepa); veta agotada sin piezas, **E** guarda la herramienta; **Q** →
  `retrieve-tool` antes de tiempo. Mientras extrae, el aviso enseña su avance (bloqueado: no hay nada que hacer).
  Al entrar por la rampa siendo el último fuera, el aviso lleva `prompt.toolsOut`/`prompt.readyOut` en ámbar
  (se pierden). HUD: herramientas en la mochila (icono ×N), piezas listas fuera (paquete con número) y
  `ToolCompass` (flecha hacia la herramienta con piezas más cercana, `hudView.tool*`). Sonidos por eventos
  (`tool-placed`, `tool-done`, `tool-stopped`/`tool-resumed`, `tool-lost`) y `toolReady` cuando suben las
  piezas listas.
- **`SurfaceTools`:** 12 huecos reutilizables que leen `surface.tools` cada frame. Concentrador: trípode, seis
  espejos articulados (abiertos = plato; plegados con tormenta o veta agotada), haz de luz concentrada al hielo,
  vapor que sube a la campana y trampa fría con serpentín que se llena con `progress`. Taladro: cuatro patas,
  cabezal que barre la roca con un haz láser, penacho hacia el colector con bobinas magnéticas. Piezas listas:
  una pieza apilada por unidad y baliza verde alta que parpadea. Piloto ámbar intermitente = parada por tormenta.
  Sin luces puntuales (haces `beamMaterial` y halos `Glow`). El colector mira lejos de la veta vecina más cercana.
- **Filones** (`deposit.lodeId`, vetas raras agrupadas): un único haz por filón (la primera veta que quede) y
  halos más pequeños para que no se fundan. Avance con `lodeProgress` del motor (`crew[].lodeVeinsDone`):
  `currentLode` (filón de la veta de filón más cercana, o el de más avance) → «◆ 2/3» junto a la racha en el HUD
  (late con destello si `bonusReady`); `lodeFinisherIds` → `LodeFinishers` (corona giratoria con tres gemas en
  órbita y halo sobre la veta que completa el filón). Tolerante: sin `lodeVeinsDone` no se pinta nada.
- **Movimiento:** `game/motion.ts`. Jetpack = mantener Espacio en el aire (pulsar = salto corto, con coyote de
  120 ms); aceleración neta 3-6 m/s² hasta 7 m/s² de gravedad y apenas 0,5 en el mundo pesado; sin pegado al
  suelo al subir o caer. El salto dura como mucho `MAX_JUMP_AIR_S` (2 s; en microgravedad se recorta).
  - **Potente:** sube a `jetpackMaxUpMps(g)` (4 m/s en microgravedad, 4,5 hasta 7 m/s², 3 en el pesado) y con
    el empuje activo va a `jetMps` = 1,5 × correr con control completo (en caída libre, 40 % y velocidad de
    correr): es la forma rápida de cruzar.
  - **No mata: techo de vuelo sobre el suelo de debajo** (`ceilingM`; `MotionInput.heightM` = pies − `heightAt`).
    Cerca del techo el empuje solo deja subir a `√(2g·(techo − altura))`, así que el punto más alto nunca lo
    pasa. Techo = 0,97 × mín(altura cuya caída da inofensivo + 60 % del tramo hasta mortal, máx(15 m, lo que pide
    subir a tope en microgravedad + 5 m)), y además techo + fondo más hondo del mundo (`deepestDropM`: abismo o
    hoyo, `surfaceMotion(g, limits, dropM)`) cae por debajo de `WORST_FALL_FRAC` × mortal (peor caso residual:
    volar al techo sobre el borde y pasar sobre el abismo sin jetpack); cifras `falls` y `jetpack` del catálogo. Al ser relativo al suelo,
    pegado a una pared se sigue subiendo (así se sale de un hoyo).
  - **Estabilizador:** al soltar Espacio subiendo tras usar el jetpack, el ascenso se corta enseguida (sin gastar):
    en microgravedad no se sigue flotando hacia arriba. Un salto sin jetpack sigue siendo balístico.
  - Cayendo, Espacio **frena** (al menos `BRAKE_NET_MIN_MPS2`, también en el pesado). **C** empuja hacia abajo
    hasta `0,85 × harmlessMps` (no Ctrl: Ctrl+W cierra la pestaña). Ambos gastan jetpack.
  - `simulateFlight(p, thrustS, { run })` es la referencia de los tests (tabla de los 7 mundos). Pasado `radiusM`
    hay un empuje suave hacia dentro. La tormenta empuja de lado `STORM_WIND_MPS` × intensidad (`motionEnv.wind*`).
- **Aviso de caída:** `SurfaceLoop` predice el golpe (`fallDanger`: altura sobre `heightAt`, velocidad y freno
  si se está frenando); por encima de `harmlessMps` → `cue('fallWarn')` una vez por caída, `hudView.fallDanger`
  (marco ámbar `FallAlert` y la fila del jetpack en rojo).
- **Oxígeno frente a distancia:** `o2RouteStatus` cuenta el rodeo por las herramientas colocadas
  (`tourDistanceM`: la más cercana cada vez y a la rampa) → `hudView.o2Route`: `ok`; `fetch` (brújula ámbar
  con un taladro que late y la flecha de herramientas apuntando a la más cercana: «ve ya a por ellas»);
  `leave` (brújula ámbar con el paquete tachado: «déjalas y vuelve»); `short` (roja y latiendo: vuelve ya,
  `hudView.o2Short`). Márgenes: 1,5 × (holgura) y `FETCH_MIN_MARGIN` 1,15.
- **Avisos compactos (`Prompt.badges`):** la esclusa muestra el O₂ de la nave que cuesta salir (`suitRefill` del
  motor, con el ciclo de la esclusa); si el traje no se llena, todo el aviso va en ámbar con el % con el que se
  sale. Al despegar, el timón muestra las unidades que quedan en el mundo y el O₂ de la nave si está por debajo
  de `SHIP_O2_LOW_PCT`. Rechazos del motor visibles antes de intentar: recoger en el aire sale bloqueado
  (`prompt.collectAirborne`, y no se envía `collect`), aterrizar sin motores (`prompt.landNoEngines`) o sin
  combustible (`prompt.landNoFuel`).
- **Eventos del motor:** sonido y sacudida salen de `type` + `subtype` (`landing` soft/hard, `suit-o2`
  low/critical, `cargo-stored` stored/processed…), nunca del `tone`.
  La racha (`streakMult` del tripulante) va como «×1,3» junto a la carga cuando pasa de ×1.
- **Accesibilidad (`state/settings.ts`):** `effects` (0-1) escala la sacudida de cámara y la viñeta de O₂;
  la recogida ya no se mantiene (ver herramientas). El O₂ crítico se ve también sin viñeta (marco rojo y triángulo
  en la barra, pitido con destello y subtítulo).
- **Señales del oxígeno:** respiración (`breath`/`breathFast`) cada `breathIntervalS`, pitido `o2Critical` por
  debajo del crítico, viñeta roja y oscurecimiento (`O2Vignette`), barra con la marca del umbral bajo.
- **Bucles de sonido:** `thruster`, `jetpack`, `wind` (crece durante el aviso de tormenta con
  `audio.setLoopLevel`), `storm`, `takeOff` (y el `roar` del salto) se arrancan con
  `cue(id)` y se paran con `audio.stopLoop(id)`; `stopSurfaceLoops()` al cambiar de partida o al despegar.

## Cómo añadir…

- **Un puesto:** `layout.ts` (`STATIONS`) → `interaction.ts` → componente en `ShipStations.tsx` dentro de
  `Stations` (geometría con `Builder` + su colisionador) → textos `station.<id>` y `prompt.*` → test en `game.test.ts`.
- **Un cuerpo del sistema solar:** nada obligatorio (aspecto deducido en `gfx/bodyLook.ts`); para uno reconocible, su
  entrada en `LOOK_OVERRIDES`.
- **Un tipo de destino:** su cuerpo en `SpaceBodies.tsx` (`Body`). El aspecto sale del id del nodo
  (`hashOf`), nunca de `Math.random`: el mismo destino se ve siempre igual.
- **Un panel:** componente en `ui/` con `Modal`/`Panel`, valor nuevo en `Overlay` (`state/ui.ts`), render
  en `App.tsx`; decide en `runStore.tick` si pausa.
- **Una escena:** componente con su `<Canvas>` cargado con `lazy` desde `App.tsx`. Al desmontarse limpia
  `fx.shake`, `useUi.prompt` y `resetPlayerState()`.
- **Un mundo:** paleta en `SURFACE_LOOKS` (`gfx/surfaceLook.ts`) y relieve en `TERRAIN_STYLES` (`game/terrain.ts`);
  sin ellos usa los de la luna de polvo. Las cifras de juego van en `packages/shared/catalog/mundos.json`.
- **Un material de veta:** forma en `depositGeometries` (`SurfaceWorld.tsx`) y color/brillo en `DEPOSIT_LOOKS`.
- **Una herramienta de minería:** cifras en `catalog/mundos.json` (`surface.tools`, `material.tool`); icono en
  `ToolIcon.tsx`; modelo y estados en `SurfaceTools.tsx` (rama por `toolId`).
- **Una micro-interacción:** lógica pura en `game/` (semilla, paso, resultado → segundos de trabajo o acción del
  motor) con test en `minigames.test.ts`; estado en `state/minigame.ts`; lo visible en `ShipMinigames.tsx`
  o `SkillHud.tsx` sin `setState` por frame; un modo «simple» que mantenga una tecla.
- **Un efecto de avería:** `IncidentFx` en `ShipFx.tsx` (un grupo reutilizable por avería, sin estado React).

## Depurar

En desarrollo `window.__payload` expone `{ getRun, useGame, useUi, playerState }`:

```js
__payload.getRun().step(30)                              // avanzar 30 s
__payload.useGame.getState().act({ type: 'evade' })
__payload.useUi.getState().setOverlay('map')
__payload.teleport(0, 8)                                 // colocar al tripulante en (x, z)
__payload.teleport(-6, 4, 30)                            // … o soltarlo a 30 m del suelo (aviso de caída)
__payload.playerState.yaw = Math.PI                      // y girar la vista (rad)
__payload.startDodge()                                   // tomar los mandos (con un aviso de impacto activo)
__payload.minigame                                       // minijuegos en curso (esquiva, reparación)
__payload.toSurface()                                    // viajar al aterrizable más cercano, aterrizar y salir
__payload.toSurface('descent')                           // … o quedarse al empezar el descenso ('landed' = a bordo)
__payload.liveTerrain.current.heightAt(10, 5)            // altura del suelo (en la escena de superficie)
```

`?play=1&seed=7&station=1` atraca en la estación más cercana tras bajar a por carga vendible y abre el terminal
(`&station=bare`: sin bajar). Desde la consola: `__payload.toStation()` / `__payload.toStation(false)`. Con la semilla 7
la estación es el nodo de salida.

`?play=1&seed=7&surface=1` entra directo a la EVA; `&surface=descent` al minijuego del descenso;
`&surface=landed` a bordo con la nave posada. Semillas que llevan a cada mundo (el aterrizable más cercano):
1 luna de polvo, 2 mundo fracturado, 3 núcleo de hielo, 4 mundo pesado, 5 roca errante, 6 mundo de
tormentas, 13 luna volcánica.

`?design=1&mission=<id>` abre el hangar de esa misión (sin `mission`, la primera). `?play=1&seed=7&mission=<id>` zarpa con
el diseño de referencia del fixture (`packages/shared/src/__tests__/fixtures/missions/<id>.json`, primer válido; sin
fixture, el último guardado), p. ej. `?play=1&seed=7&mission=mission-mars-habitability`.

`?play=1&seed=7&body=planet` fuerza el cuerpo que se ve por la proa (`station`, `planet`, `moon`,
`asteroid`, `nebula`, `derelict`, `gate`) para revisar su aspecto sin viajar.

## Comandos

```bash
pnpm --filter @payload/client dev        # http://localhost:5173  (?play=1&seed=7)
pnpm --filter @payload/client typecheck
pnpm --filter @payload/client test       # game, surface, minigames, shop, design (fase 4: hangar, guardado, escala solar, flujo), hangar (sonda montada), coop (fase 6: sesión contra una sala en memoria) e i18n
pnpm --filter @payload/client build
```

## Sistema visual (UI)

Ciencia ficción técnica y **funcional** (2026-11-14, rama `feat/ui-tecnologica`). Principios tomados como inspiración, nunca
copiados: menús a pantalla completa sobre fondo 3D vivo con navegación lateral y jerarquía título → descripción → acción;
HUD diegético de líneas de 1 px, corchetes en las esquinas y cifras monoespaciadas; fichas industriales con códigos,
unidades y barras segmentadas. Ningún logo, tipografía, icono ni texto de otro juego.

- **Tokens (`src/index.css`, `@theme`):** superficies `void` (fondo), `panel`, `panel-2`; líneas `line` y `line-strong`;
  texto `ink`; acento frío `accent` (#4cd8ff: interacción, selección, datos propios) y `accent-dim`; `signal` (cálido, solo
  marcas destacadas, no es estado); estados `ok`/`warn`/`bad` (mismo significado que antes). La escala `slate-*` está
  retintada en neutros fríos: **`slate-400` o más claro** para texto sobre panel (AA); `slate-500` solo para texto grande
  o decorativo. Radios a 0-3 px: la forma la dan los chaflanes (`--cut-lg` 14 px, `--cut` 9, `--cut-sm` 6).
- **Tipografías (OFL 1.1, `@fontsource`, importadas en `main.tsx`, solo latino):** `font-display` Chakra Petch (títulos,
  botones, etiquetas; mayúsculas con espaciado), `font-sans` Barlow (texto), `font-mono` JetBrains Mono (cifras, códigos;
  clase `.num`). Registradas en `assets/CREDITS.md` y `src/data/credits.ts`. Sin peticiones a terceros en ejecución.
- **Clases base:** `.console-panel` (superficie con chaflán, aristas de 1 px y marca de acento; la variable `--edge` cambia
  la arista), `.chamfer` (igual, chaflán menor), `.chip` (esquina cortada pequeña), `.hud-frame` (HUD: fondo leve y
  corchetes; `.is-warn`/`.is-bad`), `.btn` + `.btn-primary` (relleno claro = acción principal o «encendido/seleccionado»)
  / `.btn-danger` / `.btn-ghost` / `.btn-lg`, `.seg-option` (pastillas y pestañas: el estado sale de `aria-checked`,
  `aria-selected` o `aria-pressed`, no de clases), `.kbd`, `.tag`, `.label-code` (etiqueta de ficha técnica), `.panel-head`
  / `.panel-code`, `.ticks` (regla con marcas), `.rule`, `.segbar` (+ `-fill`, `-ghost`, `-mark`, `tone-*`), `.toast`,
  `.banner` (alerta central), `.field` (inputs), `.modal-backdrop`, `.scanlines`, `.menu-*` (menú), `.mission-card`,
  `.map-grid`, `.ui-enter` / `.ui-stagger` (entrada de 220 ms).
- **Componentes:** `ui/common.tsx` → `Panel` (`title`, `code` decorativo, `aside`) y `Modal` (fondo desenfocado y
  entrada). `ui/kit.tsx` → `Button` (`variant`, `size`), `SegBar` (`pct`, `tone`, `marker`, `ghost`, `max`, `seg`,
  `solid`, `pulse`), `Tag`, `KeyHint`, `StatRow` (dentro de un `<dl>` en rejilla), `SectionLabel` (código + título +
  marcas), `Tabs`, `Toast`. `Hud.tsx` exporta `HudHead` (código y regla de un bloque del HUD) y `Gauge` (ya con `SegBar`).
- **Reglas:** usa los componentes y clases antes que utilidades sueltas de color y borde; nada de `rounded-*` nuevo (sale
  recto); un solo acento por vista; ámbar y rojo solo para estados. Los **códigos decorativos** («SYS-PA», «EXP-03»,
  «QA-06») no comunican nada y no van por i18n; si un texto informa, va por `t()` (es + en). Foco: `:focus-visible` con
  contorno de acento; en elementos con `clip-path` (botones, paneles) el foco es un borde interior (el contorno se
  recortaría). Deshabilitado: rayado + texto `slate-500`, nunca solo opacidad. `prefers-reduced-motion`: sin entradas ni
  transiciones y los `animate-pulse` pasan a 3 s. Rendimiento: todo es CSS; el HUD sigue leyendo `hud` (~10 Hz) y lo que
  cambia por frame toca clases o estilos con refs (`useFrameFlag`), nunca `setState`.
- **Menú (`MenuScreen`):** capas `menu-veil` + `menu-grid` + `scanlines` sobre `MenuScene` (la cámara mira a la izquierda
  del centro: la galaxia queda a la derecha). Entradas con índice; la señalada (foco o ratón) muestra su línea
  `menu.desc.<id>` en la ficha de la derecha; ↑↓ mueven el foco, Intro elige. Versión de `package.json` vía
  `__APP_VERSION__` (`define` en `vite.config.ts`).

## Pendiente conocido

Hangar: visto en el panel del navegador (lunar, Titán, diseño vacío, diseño cargado de todo); sin FPS medidos y el destello de soldadura no se llegó a capturar en una imagen. Fase 4: hangar y mapa solar revisados en el panel del navegador (sin GPU dedicada ni FPS medidos); solo se vio el
tramo 1 de cada misión (no un tramo con Júpiter o Saturno como nodos) ni pantallas pequeñas; el mapa solar es un
segundo `<Canvas>` sobre el de la nave mientras está abierto (no pausa). Los mundos de los cuerpos reales
(`mars-surface`, `ice-moon`, `titan-surface`, `enceladus-surface`) tienen relieve y paleta pero no se han visitado.

Sin tests de la escena 3D (la superficie se revisó con Chrome sin cabeza y SwiftShader, no en una GPU real);
mando y táctil no implementados; audio sin escuchar con el juego nuevo; sin FPS medidos en un portátil de
gama media. Superficie: sin sombras (decisión: un mapa de sombra del sol tendría que cubrir ~200 m de terreno y
repetir el pase de terreno y rocas; sin GPU real para medirlo se prefirió el relleno direccional); el
despegue no tiene vista exterior (solo sonido y sacudida); el bucle `wind`, `fallWarn` y los sonidos de herramientas no se han escuchado; la parada del
concentrador por tormenta (hay hielo, escaso y lejos, en la luna volcánica y el mundo de tormentas) solo se ha
visto forzándola en el navegador sin cabeza, no jugando.
Sistema visual (UI): revisado con capturas de Chrome sin cabeza (SwiftShader) a 1440×900 y 1280×720 de menú (es/en),
misiones, hangar, partida, superficie, descenso, mapa estelar y solar, terminal, energía, pausa, ajustes, ayuda,
cooperativo (entrada sin servidor) y fin de partida. No visto: lobby con servidor, `CrewBar`, hangar compartido, glosario
abierto, minijuegos de avería (`SkillHud`), alertas de impacto y averías en vivo, ni pantallas de menos de 1280 px.
Terminal de estación: verificado en el navegador con el panel oculto (sin `requestAnimationFrame`), así que la
tecla E en la esclusa y la animación de créditos no se vieron en marcha (la lógica tiene test). Ver `docs/STATUS.md`.
