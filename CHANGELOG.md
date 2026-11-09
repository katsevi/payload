# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.
Cada entrada se agrupa por paquete.

## [Sin publicar]

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
