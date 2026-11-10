# @payload/client — cliente web (React 19 + R3F + Rapier + Vite)

Fase 1 del juego nuevo: menú → partida en el interior de la nave (mapa estelar, saltos, averías) → fin de
sector o de expedición. Lee antes el `CLAUDE.md` raíz y el de `packages/shared`. Diseño: `docs/GDD.md`.

## Estructura (`src/`)

| Carpeta | Contenido |
| --- | --- |
| `app/` | `App.tsx`: menú o partida, qué paneles se pintan; atajo de desarrollo `?play=1&seed=N` |
| `game/` | `runStore.ts` (Zustand: crea la `Run`, `tick`, `act`, avisos, mejor marca; `getRun()` = estado vivo; `fx.shake`), `layout.ts` (PURO: casco, mamparos, los 8 puestos, `nearestStation`, `zoneAt`, `runSecondsBetween`), `interaction.ts` (PURO: `interactionAt`, `promptFor`, `holdAction`, `nextThrottle`) |
| `scenes/` | `ShipScene` (`<Canvas>`, entorno de reflejos, `GameLoop`: tick + teclas E/Q/V/H + pausa al soltar el ratón), `ShipInterior` (`Hull`: casco y colisiones), `ShipStations` (`Stations`: los 8 puestos con sus colisiones), `ShipFx` (`ZoneLights`, `IncidentFx`, `Markers`), `SpaceView` (estrellas, estrella cercana, estelas del salto, destino por la proa), `SpaceBodies` (`Body`: planeta, luna, asteroides, nebulosa, pecio, portal, estación), `MenuScene` |
| `gfx/` | Gráficos procedurales (sin assets que descargar): `textures.ts` (canvas: paneles, cubierta, metal, roca, halos), `materials.ts` (`mats()`: materiales compartidos), `build.tsx` (`Builder`, `Parts`, `once`: modelado por piezas fusionadas por material), `glsl.ts` (ruido y reloj `TIME`), `shipShaders.ts`, `fxShaders.ts`, `spaceShaders.ts`, `Glow.tsx` (halo y `ShaderClock`), `Sky.tsx` (cielo horneado a cubemap) |
| `ui/` | `Hud` (barras, viaje, alertas, avisos, acción disponible), `StarMap`, `PowerPanel`, `Screens` (menú, ajustes, créditos, ayuda, pausa, fin), `common` (`Panel`, `Modal`, `fmt`) |
| `player/` | `PlayerController` (controlador cinemático Rapier, cámaras 1ª/3ª, sacudida), `input.ts`, `playerState.ts` |
| `audio/` | Web Audio procedural: `soundLogic.ts` y `musicLogic.ts` (puros), `audioEngine.ts`, `cues.ts` (`cue(id)`), `useAudioDirector.ts`, `SoundCaptions.tsx` |
| `state/` | `ui.ts` (panel abierto, vista, aviso de acción), `settings.ts` (persistido) |
| `models/` | GLB con `useGLTF`: `Models.tsx` (`FittedModel`, `ModelBoundary` con forma de respaldo) |
| `i18n/`, `locales/` | i18next: namespace `ui` (`locales/{es,en}.json`) y `sim` (del motor) |
| `data/` | `credits.ts` (espejo de `assets/CREDITS.md`) |

## Reglas

- **El motor manda.** El cliente no calcula combustible, energía ni daños: llama a `run.apply` y lee
  `run.state`. Toda escritura de juego pasa por `useGame.getState().act(action)`.
- **Dos formas de leer la partida.** La escena 3D lee `getRun()?.state` dentro de `useFrame` (sin
  re-render). React lee `useGame((s) => s.hud)`, una copia que se refresca a ~10 Hz o cuando hay eventos.
  No uses `hud` por frame ni `run.state` en el render.
- **Acciones mantenidas:** mientras E está pulsada, `GameLoop` envía `holdAction(...)` cada frame con
  `act(action, true)` (el `true` evita un aviso por cada rechazo). La maniobra evasiva acumula
  `EVADE_HOLD_S` en el cliente y envía `evade` una vez.
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
- **Carteles en el mundo (`Markers`):** `Html` de drei; se ocultan a mano cuando quedan detrás de la cámara.
- **Audio:** dispara siempre con `cue(id)` (suena + destello + subtítulo), nunca con `audio.play`. Sonido
  nuevo = `SfxId` en `soundLogic.ts` + clave `sound.<id>` + `case` en `AudioEngine.synth`. Los efectos de
  los eventos del motor salen de `sfxForRunEvent` en `runStore`. Sin Web Audio todo es no-op.
- **Modelos:** `publicDir` = `../../assets/web` (URL `/models/<archivo>.glb`). Registra assets nuevos en
  `assets/CREDITS.md` y en `src/data/credits.ts`. ERIZON (la estación) es CC-BY-NC-ND.

## Cómo añadir…

- **Un puesto:** `layout.ts` (`STATIONS`) → `interaction.ts` → componente en `ShipStations.tsx` dentro de
  `Stations` (geometría con `Builder` + su colisionador) → textos `station.<id>` y `prompt.*` → test en `game.test.ts`.
- **Un tipo de destino:** su cuerpo en `SpaceBodies.tsx` (`Body`). El aspecto sale del id del nodo
  (`hashOf`), nunca de `Math.random`: el mismo destino se ve siempre igual.
- **Un panel:** componente en `ui/` con `Modal`/`Panel`, valor nuevo en `Overlay` (`state/ui.ts`), render
  en `App.tsx`; decide en `runStore.tick` si pausa.
- **Una escena:** componente con su `<Canvas>` cargado con `lazy` desde `App.tsx`.
- **Un efecto de avería:** `IncidentFx` en `ShipFx.tsx` (un grupo reutilizable por avería, sin estado React).

## Depurar

En desarrollo `window.__payload` expone `{ getRun, useGame, useUi, playerState }`:

```js
__payload.getRun().step(30)                              // avanzar 30 s
__payload.useGame.getState().act({ type: 'evade' })
__payload.useUi.getState().setOverlay('map')
__payload.teleport(0, 8)                                 // colocar al tripulante en (x, z)
__payload.playerState.yaw = Math.PI                      // y girar la vista (rad)
```

`?play=1&seed=7&body=planet` fuerza el cuerpo que se ve por la proa (`station`, `planet`, `moon`,
`asteroid`, `nebula`, `derelict`, `gate`) para revisar su aspecto sin viajar.

## Comandos

```bash
pnpm --filter @payload/client dev        # http://localhost:5173  (?play=1&seed=7)
pnpm --filter @payload/client typecheck
pnpm --filter @payload/client test       # game.test.ts (lógica) e i18n.test.ts
pnpm --filter @payload/client build
```

## Pendiente conocido

Sin tests de la escena 3D; la cámara en 3ª persona puede atravesar mamparos; mando y táctil no
implementados; audio sin escuchar con el juego nuevo; el rediseño gráfico no tiene FPS medidos en un
portátil de gama media. Ver `docs/STATUS.md`.
