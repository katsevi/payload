# @payload/client — cliente web (React 19 + R3F + Rapier + Vite)

Rebanada vertical de la fase 1: una misión completa en solitario (menú → briefing → hangar →
revisión Go/No-Go → lanzamiento → operación → informe). Lee antes el `CLAUDE.md` raíz y el de `packages/shared`.

## Estructura (`src/`)

| Carpeta | Contenido |
| --- | --- |
| `app/` | `App.tsx` (render por fase), `missionMachine.ts` (XState: fases y transiciones), `useGlobalKeys.ts` (V, Tab, H) |
| `state/` | Zustand: `design` (diseño + objeto en mano), `sim` (MissionSim, snapshot vivo, eventos, resultado), `settings` (persistido), `ui` (overlay, vista 1ª/3ª, aviso), `launch` |
| `scenes/` | `MenuScene`, `HangarScene` (Rapier, estantes, `Ship.tsx` procedural), `LaunchScene`, `OrbitScene` (Tierra procedural en `earth.ts`, escala visual en `orbitMath.ts`) |
| `player/` | `PlayerController` (controlador cinemático Rapier + cámaras 1ª/3ª con transición 0.4 s), `input.ts`, `playerState.ts` |
| `ui/` | `Screens` (menú, briefing, ajustes, créditos, revisión, informe), `Huds` (hangar, lanzamiento, operación, ayuda), `DesignPanel` (modo accesible 2D y selectores), `ResourcePanel` |
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
- Decisión visual asumida: la fase 0 de la órbita (`orbitPhase = 0`) es el punto subsolar y el eclipse se pinta
  centrado en la fase 0.5 con ancho `eclipseFraction`. Si el motor cambia dónde ocurre el eclipse, ajusta `OrbitScene`.

## Pendiente conocido

Mando/táctil y giro por pasos no implementados; sombra de la Tierra translúcida; la nave avanza con fase
uniforme. Ver `docs/STATUS.md` (deuda técnica) y `docs/ARCHITECTURE.md` (flujo de datos).

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
pnpm --filter @payload/client typecheck
pnpm --filter @payload/client test       # 9 tests: paridad i18n (ui), flujo de la máquina, integración con el motor
pnpm --filter @payload/client build
```
