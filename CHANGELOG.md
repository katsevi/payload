# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.
Cada entrada se agrupa por paquete.

## [Sin publicar]

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
