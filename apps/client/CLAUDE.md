# @payload/client — cliente web (React 19 + R3F + Rapier + Vite)

Fases 1 y 2 del juego nuevo: menú → partida en el interior de la nave (mapa estelar, saltos, averías) →
aterrizaje en destinos con superficie (descenso, EVA con jetpack, recogida, vuelta, despegue) → fin de sector
o de expedición. Lee antes el `CLAUDE.md` raíz y el de `packages/shared`. Diseño: `docs/GDD.md`.

## Estructura (`src/`)

| Carpeta | Contenido |
| --- | --- |
| `app/` | `App.tsx`: menú o partida, qué escena (`sceneFor`) y qué paneles se pintan; atajos de desarrollo `?play=1&seed=N[&surface=…]` |
| `game/` | `runStore.ts` (Zustand: crea la `Run`, `tick`, `act`, avisos, mejor marca; `getRun()` = estado vivo; `fx.shake`, `shakeForEvent`, `shipSpawn`, `stopSurfaceLoops`), `layout.ts` (PURO: casco, mamparos, los 9 puestos con la esclusa, `CARGO_BAY`, `nearestStation`, `zoneAt`, `runSecondsBetween`), `interaction.ts` (PURO: `interactionAt` con estimaciones del timón y coste de O₂ de la esclusa, `promptFor`, `holdAction`, `chargedAction`, `altAction`, `nextThrottle`, `sendInChunks`), `surfaceRules.ts` (PURO: posición de la nave en la superficie, `sceneFor`, `surfaceInteractionAt`/`surfacePromptFor`/`surfaceUseAction`/`surfaceAltAction` (herramientas), `toolFor`, `leftOutside`, `nearestReadyTool`, `shipBearing`/`bearingTo`, `brakeThresholdMps`, `stormLevel`, `STORM_WIND_MPS`, `fallDanger`/`predictedImpactMps`, `o2ReturnShort`, ritmo de respiración y pitido), `terrain.ts` (PURO: `createTerrain` → `heightAt`/`chasmAt`, `terrainGrid`), `motion.ts` (PURO: `stepMotion`/`settleMotion`, `SHIP_MOTION`, `surfaceMotion(g, flightLimitsOf(rules))`, `simulateFlight`, `jetpackNetUpMps2`), `noise.ts` (PURO: `hashOf`, `rng`, `mixSeed`, ruido 2D/3D), `dodge.ts` (PURO: esquiva de asteroides en el timón), `repairGames.ts` (PURO: extintor, pulsos y sellado de las averías), `debug.ts` (`reachSurface`, `travelToLandable`, `autoDescend`) |
| `scenes/` | `ShipScene` (`<Canvas>`, entorno de reflejos, `GameLoop`: tick + teclas E/Q/V/H + pausa al soltar el ratón; con la nave posada pinta `LandedView` en vez de `SpaceView`), `ShipInterior` (`Hull`), `ShipStations` (`Stations`: los puestos con sus colisiones), `ShipCargo` (`Airlock3D`, `CargoBay`), `ShipFx` (`ZoneLights`, `IncidentFx`, `Markers`), `ShipMinigames` (`DodgeHolo`: holograma de pilotaje sobre el timón; `FlameTarget`: foco del fuego al que se apunta), `SpaceView`, `SpaceBodies` (`Body`), `SurfaceScene` (`<Canvas>` propio: `DescentLoop` o `SurfaceLoop`), `SurfaceTools` (concentrador solar y taladro láser colocados, con sus estados), `SurfaceWorld` (terreno + colisión trimesh, rocas, vetas, terreno inestable, cielo, niebla, tormenta; `liveTerrain`), `ShipExterior` (la nave posada vista desde fuera, baliza, propulsores, colisiones), `MenuScene` |
| `gfx/` | Gráficos procedurales (sin assets que descargar): `textures.ts`, `materials.ts` (`mats()`), `build.tsx` (`Builder`, `Parts`, `once`), `glsl.ts` (ruido y reloj `TIME`), `shipShaders.ts`, `fxShaders.ts` (`puffMaterial` exportado), `spaceShaders.ts`, `surfaceShaders.ts` (parche del suelo: grietas, borde, lava, explanada; cielo; tormenta; polvo; haces; llama de propulsor), `surfaceLook.ts` (paleta por `worldId` y aspecto de cada material de veta), `rocks.ts` (`rockGeometry`, `pebbleGeometry`, `rockMaterial`), `Glow.tsx`, `Sky.tsx` |
| `ui/` | `Hud` (barras, viaje, alertas, avisos, acción disponible; exporta `Gauge`/`levelOf`), `SkillHud` (mira del extintor y barras de pulso/presión, sin React por frame), `SurfaceHud` (`DescentHud`, `SuitVitals` con teclas del jetpack, racha y herramientas, `ShipCompass`, `ToolCompass`, `FallAlert`, `O2Vignette`, `WorldBadge`), `ToolIcon`, `StarMap`, `PowerPanel`, `Screens`, `common` |
| `player/` | `PlayerController` (controlador cinemático Rapier parametrizado por `MotionParams`, cámaras 1ª/3ª con rayo contra colisiones, sacudida), `input.ts`, `playerState.ts` (`playerState`, `motionEnv`, `resetPlayerState`) |
| `audio/` | Web Audio procedural: `soundLogic.ts` y `musicLogic.ts` (puros), `audioEngine.ts`, `cues.ts` (`cue(id)`), `useAudioDirector.ts`, `SoundCaptions.tsx` |
| `state/` | `ui.ts` (panel abierto, vista, aviso de acción, `descentView`, `hudView`), `settings.ts` (persistido), `minigame.ts` (minijuegos en curso, mutable) |
| `models/` | GLB con `useGLTF`: `Models.tsx` (`FittedModel`, `ModelBoundary` con forma de respaldo) |
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
- **Tiempo:** el mapa, el panel de energía y la ayuda NO pausan. `pause`, `settings` y `credits` sí
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
- **Luces puntuales contadas:** 3 de zona + 1 del reactor + 6 de averías. Antes de añadir otra, usa un halo.
  La superficie no añade ninguna: sol direccional + relleno direccional opuesto sin sombras (`fillIntensity`,
  mundos sin aire) + hemisférica + `Environment` horneado una vez; sin mapas de sombra (ver Pendiente); la baliza
  de la nave y las vetas raras son halos y haces aditivos (`fog: false`, se ven desde lejos).
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

`?play=1&seed=7&surface=1` entra directo a la EVA; `&surface=descent` al minijuego del descenso;
`&surface=landed` a bordo con la nave posada. Semillas que llevan a cada mundo (el aterrizable más cercano):
1 luna de polvo, 2 mundo fracturado, 3 núcleo de hielo, 4 mundo pesado, 5 roca errante, 6 mundo de
tormentas, 13 luna volcánica.

`?play=1&seed=7&body=planet` fuerza el cuerpo que se ve por la proa (`station`, `planet`, `moon`,
`asteroid`, `nebula`, `derelict`, `gate`) para revisar su aspecto sin viajar.

## Comandos

```bash
pnpm --filter @payload/client dev        # http://localhost:5173  (?play=1&seed=7)
pnpm --filter @payload/client typecheck
pnpm --filter @payload/client test       # game.test.ts, surface.test.ts, minigames.test.ts (lógica) e i18n.test.ts
pnpm --filter @payload/client build
```

## Pendiente conocido

Sin tests de la escena 3D (la superficie se revisó con Chrome sin cabeza y SwiftShader, no en una GPU real);
mando y táctil no implementados; audio sin escuchar con el juego nuevo; sin FPS medidos en un portátil de
gama media. Superficie: sin sombras (decisión: un mapa de sombra del sol tendría que cubrir ~200 m de terreno y
repetir el pase de terreno y rocas; sin GPU real para medirlo se prefirió el relleno direccional); el
despegue no tiene vista exterior (solo sonido y sacudida); el bucle `wind`, `fallWarn` y los sonidos de herramientas no se han escuchado; la parada del
concentrador por tormenta (hay hielo, escaso y lejos, en la luna volcánica y el mundo de tormentas) solo se ha
visto forzándola en el navegador sin cabeza, no jugando.
Ver `docs/STATUS.md`.
