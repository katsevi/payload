# @payload/client — cliente web (React 19 + R3F + Rapier + Vite)

Fase 1 (rebanada vertical) + fase 2 parte A (selección de escenario, Academia, mascota, asesores,
glosario, eventos pre-lanzamiento) y parte B (audio procedural, vista del instrumento, Aurora G9, mascota en el lanzamiento). Fase 3: jugar en equipo contra `apps/game-server` (`net/`, `room/`). Flujo: menú (campaña o Academia) → briefing → hangar → revisión
Go/No-Go → [pre-lanzamiento] → lanzamiento → operación → informe. Lee antes el `CLAUDE.md` raíz y el de `packages/shared`.

## Estructura (`src/`)

| Carpeta | Contenido |
| --- | --- |
| `net/` | Fase 3 (capa de red y sesión; contrato en `docs/MULTIPLAYER.md`): `session.ts` (interfaz `MissionSession`), `localSession.ts` (solitario: stores + máquina), `roomSession.ts` (sala Colyseus: `TeamAction` → servidor, estado → stores; `quickMatch`/`createPrivateRoom`/`joinRoomByCode`/`resumeRoom`/`leaveRoom`; tras una caída sin salir, `useRoom.retry {untilMs}` (reloj `performance.now()`, gracia del servidor desde la caída) + `retryRoom()`/`dismissRetry()`; errores del servidor → `room.error.<camelCase>`; SDK con `import()` diferido y `minUptime` 0), `roomStore.ts` (`useRoom`, selectores, `canDo`, `activePhase`, asesores visibles), `roomView.ts` (decodificación con referencias estables), `sessionStore.ts` (`getSession`, `useMissionSession`), `avatar.ts` (`publishAvatarPose`), `index.ts` (barril) |
| `room/` | Fase 3, UI de sala (todo bilingüe en `room.*`): `roomUiLogic.ts` (PURO y testeado: colores/orden de roles, solicitudes, estado de votos, formulario No-Go, tiempo de alertas, no leídos, pings, colocación de avatares, reparto editable, colaboración), `actions.ts` (manejadores de los botones → `getSession()`), `hooks.ts` (`useStableCanDo` = `canDo` sin recalcular a 10 Hz, `useAddChecks`, `useRoomClock`, registro de pings), `RoomEntryScreen` (menú → «Jugar en equipo»), `LobbyScreen`, `TeamBar` (roles, conexión, accesos; dock de paneles), `ChatPanel`, `RequestsPanel`, `BudgetPanel`, `PingsPanel`, `AlertsPanel`, `RoomReview` (`VoteScreen`, `LastNoGoPanel`, `CollaborationSection`), `devRoom.ts` (sala de ejemplo solo dev) |
| `app/` | `App.tsx` (render por fase), `missionMachine.ts` (XState: fases y transiciones; `PLAY {scenarioId}`, fase `prelaunch`, `MENU` global), `useGlobalKeys.ts` (V, I = vista del instrumento en operación, Tab, H = ayuda + mascota `help:<contexto>`, G = glosario; en sala T = chat, R = solicitudes) |
| `state/` | Zustand: `design` (diseño + objeto en mano + intento), `sim` (MissionSim, snapshot vivo, eventos, resultado, `preLaunch`), `settings` (persistido; incluye `mascot`), `progress` (persistido: contador de intento por escenario, Academia completada), `ui` (overlay, vista 1ª/3ª, aviso, `glossaryId`, `highlight`), `launch` |
| `mascot/` | Mascota por datos (`catalog.mascot`): `mascotLogic.ts` (puro: disparadores por fase/evento/recurso/ayuda/informe), `mascotStore.ts` (cola, enfriamiento 15 s, variantes), `MascotBubble.tsx` (burbuja `aria-live` = subtítulo), `MascotAvatar.tsx` (`sprite2d` del JSON o avatar SVG generado en código), `useMascotDirector.ts` (conecta fases, eventos del motor y presupuestos; el resultado del lanzamiento lo dice `ZeroGMascot`), `ZeroGMascot.tsx` (avatar que flota en gravedad cero, `launch.zeroG`), `MascotHint.tsx` (consejo `help:<missionType>` en el briefing) |
| `audio/` | Audio procedural con Web Audio nativa, sin archivos: `musicLogic.ts` y `soundLogic.ts` (puros y testeados: capas de música por fase/estado, tabla de efectos con bus/flash/subtítulo), `audioEngine.ts` (clase `AudioEngine` + singleton `audio`; buses música/efectos/avisos, síntesis, emisores 3D con `PannerNode`), `cues.ts` (`cue(id)`: suena + flash + subtítulo; store `useCues`), `useAudioDirector.ts` (escucha stores y fase), `SoundCaptions.tsx`, `HangarAudio.tsx` (zumbidos posicionales de la consola y la exhibición Aurora) |
| `instrument/` | Vista del instrumento: `instrumentLogic.ts` (puro: `instrumentState` = eclipse/degradado/perdido, `instrumentTarget`, `mainInstrument`, `surfaceKind`, `hasRover`), `instrumentRender.ts` (Canvas 2D procedural), `InstrumentView.tsx` (overlay con lecturas; abre la vista de superficie) |
| `academy/` | `academyLogic.ts` (puro: estado de cada paso según fase y `evaluateAcademyStep`), `academyStore.ts`, `AcademyPanel.tsx` (narración, objetivo, avance automático, resaltado del recurso, salir) |
| `scenes/` | `ControlRoomScene` (sala de control con 4 consolas y avatares; lobby/briefing/prelaunch en sala), `RoomAvatars` (otros jugadores en el hangar y marcadores de ping), `MenuScene`, `HangarScene` (Rapier, estantes, `Ship.tsx` procedural), `LaunchScene`, `SurfaceScene` (superficie lunar/marciana con Aurora G9 caminando, carga diferida desde la vista del instrumento), `OrbitScene` (Tierra procedural en `earth.ts`, escala visual en `orbitMath.ts`) |
| `player/` | `PlayerController` (controlador cinemático Rapier + cámaras 1ª/3ª con transición 0.4 s), `input.ts`, `playerState.ts` |
| `ui/` | `Screens` (menú, `ScenarioSelect`, briefing, ajustes, créditos, revisión, `PreLaunchScreen`, informe con eventos), `Huds` (hangar, lanzamiento, operación, ayuda), `DesignPanel` (modo accesible 2D y selectores), `ResourcePanel` (resalta `ui.highlight`), `LearningPanels` (asesores por rol, glosario y fichas), `catalogViews.ts` (puro: escenarios de campaña, búsqueda en glosario), `eventTone.ts` |
| `models/` | GLB con `useGLTF`: `Models.tsx` (ajuste de tamaño/origen, `ModelBoundary` con forma de respaldo, carga diferida del mecha) |
| `i18n/`, `locales/` | i18next, namespace `ui` (`locales/{es,en}.json`) y `sim` (`simLocales` del motor) |

## Reglas

- **El motor manda.** El cliente solo importa de `@payload/shared`; nunca duplica fórmulas. Cada frame de
  operación llama `useSim.getState().tick(dt)` → `sim.step(dt * aceleración)`. El snapshot "vivo" se lee con
  `getLiveSnapshot()` (sin re-render); React solo recibe actualizaciones a ~10 Hz o con eventos.
- **i18n sin texto hardcodeado.** UI: `t('clave')` (ns `ui`, claves planas con puntos; los JSON se aplanan
  al cargar, `keySeparator: false`). Motor: `tr(messageRef)`. Catálogo: `lt(localizedText)`. Toda clave nueva
  va en `es.json` **y** `en.json` (hay un test de paridad). Los componentes que usan `lt/tr` deben llamar `useTranslation()`.
- **Rendimiento:** nada de `new` ni de `setState` por frame salvo lo imprescindible; usa refs, `getState()` y
  `useFrame`. Las escenas se cargan con `React.lazy`. El hangar no se monta en modo accesible 2D. El mecha
  (3 MB) carga diferido. No añadas post-procesado ni sombras sin respetar el ajuste `shadows`.
- **Modelos:** `publicDir` = `../../assets/web` (URL `/models/<archivo>.glb`). Si un GLB falta, `ModelBoundary`
  muestra una forma simple. Registra assets nuevos en `assets/CREDITS.md` y en `src/data/credits.ts`.
- **Órbita (Kepler):** `orbitPhase` es la anomalía verdadera / 2π desde el perigeo; `orbitShape().atTo(θ)` la usa
  directamente (perigeo en +X, lado del Sol). El eclipse del motor está en la fase MEDIA 0.5 ± f/2: `eclipseArc`
  la convierte a anomalía verdadera con `trueAnomalyFromMeanAnomaly` del motor. La cámara orbital se centra en la
  elipse (`shape.centerX = −a·e`). La escala visual (`visualRadius`) no es real y achata el HEO.
- **Mascota intercambiable:** el cliente no conoce ni el nombre ni los textos de Orbi; todo sale de
  `catalog.mascot`. Si falta un diálogo, la ayuda (H) usa `help.<fase>` de ui. Desactivable en Ajustes.
- **Escenarios:** se leen de `catalog.scenarios`; el único id fijo es el de la Academia (`catalog.academy.scenarioId`,
  respaldo `academy-cubesat-leo`). Semilla = `defaultSeed + intento`, con el intento persistido por escenario
  (`useProgress.claimAttempt`): cada partida nueva o «Rediseñar» usa uno nuevo.
- **Eventos pre-lanzamiento:** la acción `rollPreLaunch` de la máquina llama `rollPreLaunchEvents` al entrar en
  `prelaunch` (tras el Go); si no hay eventos se pasa directo a `launch`. `useSim.start` pasa `preLaunch` a
  `createMissionSim` y `PreLaunchScreen` muestra `computeBudgets(design, cat, preLaunch)`.

- **Audio:** el `AudioContext` se crea solo en `audio.unlock()` (primer `pointerdown`/`keydown`); sin Web Audio todo es no-op
  (tests en node). Tres buses con volumen en Ajustes (`volMusic`, `volSfx`, `volAlerts` = avisos y voz de la mascota) más
  `muteAll` (suspende el contexto) y `soundCaptions`. La música son 5 capas permanentes (pad, pulse, tension, drive, resolve)
  cuya ganancia objetivo sale de `musicMixFor({phase, launchPhase, status, batteryPct, inEclipse, success})` con fundido de ~1.6 s.
  Nuevo sonido = añadir un `SfxId` en `soundLogic.ts` (+ clave `sound.<id>` con corchetes en ui) y un `case` en `AudioEngine.synth`.
  Dispara siempre con `cue(id)`, nunca con `audio.play` directo: así hay flash y subtítulo (los avisos visuales no dependen del audio).
- **Sesión (fase 3):** toda escritura de juego de la UI y las escenas pasa por `getSession()` (`addComponent`,
  `selectOrbit`, `requestReview`, `launch`, `launchDone`, `setTimeScale`, `finishOperation`, `redesign`, `toMenu`…).
  En solitario es `LocalSession` (mismo comportamiento de siempre); en sala, `RoomSession` envía `TeamAction` y NO
  aplica nada por su cuenta: el servidor manda y `applyView` escribe `useDesign`, `useSim` y `useRoom`. Las escenas
  y paneles siguen LEYENDO los mismos stores. Fase visible: `view.phase` si hay sala (añade `lobby`), si no la máquina.
  Lo que se lleva en la mano (`heldId`), la vista 1ª/3ª, saltar el lanzamiento y la ayuda H son siempre locales.
- **Simulación en sala:** `useSim.mirrorStart` crea la `MissionSim` con la semilla, el diseño y el `preLaunch` de la
  SALA; `tick` la avanza hacia `view.sim.simT` sin pasarlo nunca (pausa del servidor = local quieta; muy por detrás =
  salto). Si el snapshot local difiere del del servidor en el mismo instante: `console.warn` y se recrea (tras 3 veces
  se usan los snapshots del servidor). El `result` del informe es el del servidor (`setResult`).
- **Mascota en sala:** `useMascotDirector` y `ZeroGMascot` no disparan nada; `RoomSession` muestra `view.mascot` una
  vez por `seq` con su `variant` (`useMascot.say(trigger, { variant, force: true })`).
- **Avisos:** `useUi.showNotice({ tone, ref | key })` + `NoticeBanner` (rechazos del servidor con `tr(reason)`,
  solicitudes enviadas, estado de la conexión). Token de reconexión en `sessionStorage['payload.room.token']`.
  Servidor: `VITE_GAME_SERVER_URL` o `ws(s)://<hostname>:2567`.
- **Vista del instrumento (I):** `InstrumentView` lee `getLiveSnapshot()` para pintar y el store para las lecturas. Eclipse =
  imagen oscura (`inEclipse`); `reaction-wheel-failure` o `component-failure` de ADCS = desenfoque + temblor; todos los instrumentos
  averiados (`event.componentFailure.payload` con `remaining: 0`) o `status: 'failed'` = sin señal. La resolución sale de
  `computeBudgets(...).totals.groundResolutionM`. Si cambian las claves de esos mensajes del motor, actualiza `instrumentLogic.ts`.
- **Aurora G9:** el rover se reconoce por el `model` del componente (`ROVER_MODEL_FILE`), no por su id. En el hangar aparece junto
  a la nave (`MountedRover`); en misiones lunar/Marte, la vista del instrumento ofrece «Ver la superficie» (`SurfaceScene`). El GLB
  no trae animaciones: se simula la marcha con un bamboleo. Atribución CC-BY en `data/credits.ts` y `assets/CREDITS.md`.

- **UI de sala (fase 3):** la fase `lobby` pinta `LobbyScreen`; `review` en sala, `VoteScreen` (No-Go con motivo obligatorio); `TeamBar` en todas las fases de sala. Todo permiso sale de `canDo` (nunca reglas propias): botones desactivados con el motivo en `title`/texto, y las piezas que generarán solicitud llevan borde ámbar y su `why`. Teclas en sala: `T` chat, `R` solicitudes, `P` ping en el hangar (a la pieza apuntada o al punto al que se mira); los inputs no disparan teclas del juego (`useGlobalKeys`, hangar e `input.ts` ignoran INPUT/TEXTAREA/SELECT). Alertas de equipo: `AlertsPanel` + `cue('radioStatic')` al abrirse una nueva. El reloj de sala es aproximado (`useRoomClock`: mayor `atS` visible + reloj local). En modo accesible 2D no se monta `ControlRoomScene`.

## Pendiente conocido

- **Voz WebRTC (pendiente, opcional):** no implementada. Cuando se aborde: señalización por la sala Colyseus (mensajes efímeros como `move`), audio por malla P2P con 4 jugadores, silenciar por jugador y alternativa de texto (el chat ya existe).
- La UI de sala se ha probado con `?room=demo`, tests (incl. `room-e2e`) y una sesión manual con servidor real en Chrome, pero no con 4 personas en equipos distintos ni a varios anchos (por debajo de `lg` los paneles del lobby tapan la sala). El reloj de sala es una estimación del cliente; no hay pings en la vista orbital.

Mando/táctil y giro por pasos no implementados; sombra de la Tierra translúcida. La mascota no usa aún
`model` (GLB 3D) del JSON, solo `sprite2d` o el avatar generado. El audio y la vista del instrumento no se han verificado con oído/pantalla completos (ver `docs/STATUS.md`); el balance de volúmenes es provisional. Ver `docs/STATUS.md` (deuda técnica) y `docs/ARCHITECTURE.md` (flujo de datos).

## Cómo añadir…

- **Una escena:** componente en `scenes/` con su propio `<Canvas>`, exportado por nombre; regístralo con
  `lazyScene(...)` en `App.tsx` y renderízalo por fase. Una fase nueva: estado en `missionMachine.ts` + `PhaseName`.
- **Un panel/HUD:** componente en `ui/`, estilos con `Panel`/`.btn`/`.num` (Tailwind 4, tema en `index.css`),
  textos en ambos JSON. Los paneles modales usan `Modal` y `useUi.setOverlay`.
- **Un control 3D:** tecla global en `useGlobalKeys`; teclas del hangar (E/Q) en `HangarScene > Interaction`.

## Comandos

```bash
pnpm --filter @payload/client dev        # http://localhost:5173
# Atajos solo en dev: ?phase=briefing|design|launch|operation|report  (design admite &demo=1 y &view=third)
#   ?room=demo&phase=lobby|briefing|design|review|prelaunch|operation|report[&role=director|engineering|science|operations]
#     sala de ejemplo sin servidor (3 jugadores, solicitudes, votos, alerta abierta, chat, pings; `report` con runMission real)
#   en operación, la tecla I abre la vista del instrumento
pnpm --filter @payload/client typecheck
pnpm --filter @payload/client test       # paridad i18n, máquina, integración con el motor, fase 2 (Academia, escenarios, mascota, glosario, Kepler), 2B (`phase2b.test.ts`: audio, instrumento, rover, mascota) y fase 3 (`room-ui.test.ts`: lógica de la UI de sala, permisos vía canDo y botones → acción con FakeRoom; `net.test.ts`: LocalSession, RoomSession con FakeRoom, canDo, simulación reflejada, avisos, mascota, reconexión, errores y `retry`; `room-e2e.test.ts`: servidor real de apps/game-server en un puerto libre + la app + 3 clientes SDK, misión completa con paridad `runMission`, ~7 s)
pnpm --filter @payload/client build
```
