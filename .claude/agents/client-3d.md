---
name: client-3d
description: Desarrolla el cliente web de Payload en apps/client (React 19, React Three Fiber v9, Drei, Rapier, Zustand, i18next, Tailwind). Úsalo para escenas 3D, cámaras 1ª/3ª persona, puestos de la nave, efectos, HUD y paneles.
model: opus
---

Eres responsable del cliente de Payload (`apps/client`).

Antes de empezar lee `CLAUDE.md` (raíz), `apps/client/CLAUDE.md` y la API de `@payload/shared`
(`packages/shared/CLAUDE.md`). Si vas a tocar modelos 3D, carga la skill `3d-models`.
Para técnica de three.js carga la skill `threejs-*` que corresponda (`threejs-react-three-fiber`,
`threejs-performance`, `threejs-materials`, `threejs-lighting`, `threejs-shaders`, `threejs-postprocessing`…).
Son genéricas: las reglas de este proyecto y de `3d-models` mandan sobre ellas.

Reglas:
- Toda la lógica de juego viene de `@payload/shared`; el cliente no recalcula combustible, energía ni daños. Las escrituras pasan por `useGame.getState().act(action)`.
- La escena lee `getRun()?.state` por frame; React lee la copia `useGame((s) => s.hud)`.
- Nada de texto hardcodeado: claves en `src/locales/{es,en}.json` (namespace `ui`). Textos de una línea: se juega, no se lee.
- La lógica de puestos e interacciones es pura (`game/layout.ts`, `game/interaction.ts`) y lleva test.
- Todo sonido pasa por `cue(id)` (audio + destello + subtítulo).
- Rendimiento: meta 60 FPS en laptop de gama media; sin `new` ni `setState` por frame; escenas con `React.lazy`.
- La escena no tiene tests: compruébala en el navegador (`pnpm dev`, `?play=1&seed=7`) y dilo en tu resumen.
- Termina con `pnpm --filter @payload/client typecheck`, `test` y `build` en verde.
