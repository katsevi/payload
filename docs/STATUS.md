# Estado del proyecto — traspaso entre sesiones

Última actualización: **2026-11-08** · Versión: 0.2.0 (ver `CHANGELOG.md`)

> Léelo antes de empezar y actualízalo al terminar una tarea relevante. Las casillas de
> `docs/phases/fase-*.md` las marca quien valida la fase, no quien implementa: aquí solo se resume.
> Nota: el repositorio git solo tiene el commit inicial (`68c083f`); **todo el trabajo de la fase 2 está sin commitear**
> en la rama `feat/f2-contenido-aprendizaje` (`git status`).

## Estado por fase

| Fase | Estado |
| --- | --- |
| 0 · Preproducción | **Entregables completos.** Hito (*los compromisos son divertidos en papel*) **pendiente de prueba en papel con >= 3 personas**. |
| 1 · Rebanada vertical en solitario | **Hecha · validada con observaciones.** |
| 2 · Contenido y aprendizaje | **Hecha · validada con observaciones** (validación independiente del 2026-11-08). **Hito pendiente de prueba con >= 5 estudiantes.** |
| 3 · Multijugador | No iniciada. `apps/game-server` es un marcador. Ver "Próximos pasos (hacia la fase 3)". |
| 4 · Pulido y lanzamiento | No iniciada. `apps/api` es un marcador. |

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

## Métricas verificadas (2026-11-08)

| Métrica | Valor |
| --- | --- |
| `pnpm validate` | Verde: 11/11 tareas (typecheck + test + build) |
| Tests `@payload/shared` | **237** en 16 archivos |
| Tests `@payload/client` | **67** en 5 archivos (`i18n`, `flow`, `fixes`, `phase2`, `phase2b`) |
| `pnpm --filter @payload/shared bench` | `computeBudgets` 0,014 ms · `reviewGoNoGo` 0,014 ms · `runMission` 30 días 9,4 ms (objetivos < 1 ms, < 1 ms, < 200 ms) |
| `pnpm proto --brief` (semilla `20260101`) | `warn-power-storm` 63,2 (antes 91,7) · `ok-microsat-leo-thermal` 92,7 (antes 92,8); los demás igual que en la fase 1 (79,3 · 86,6 · 74,0 · 24,1 · 52,0 · 21,7 · 21,4). Detalle en `prototype/designs/README.md` |
| Catálogo | 43 componentes · 7 lanzadores · 6 órbitas · 6 escenarios (5 campaña + Academia) · 28 glosario · 74 diálogos · 21 pasos de Academia |
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
10. **Hacer los commits** de la fase 2 (hoy todo está sin commitear) y subir los GLB a GitHub.

## Decisiones de diseño abiertas

- **LEO del catálogo a 450 km** (T = 93,4 min); la referencia del plan (92,6 min) es a 400 km. El motor se prueba con 400 km por tolerancia, pero la hoja de cálculo no tiene celda de altitud libre; el criterio de `fase-0.md` sigue sin cumplirse. Decidir: bajar la LEO a 400 km o cambiar el criterio.
- **`why` de lanzadores y escenario:** opcional en el esquema, relleno en es/en, pero el cliente no lo muestra ni un test lo exige.
- **Mascota 3D:** el JSON admite `model`, pero el cliente solo usa `sprite2d` o el avatar SVG.
- **Radiación:** valorar un campo `radiationShielding` en componentes (hoy se emula con fiabilidad).

### Resueltas en la fase 2

- **`power-storm`:** sigue siendo aviso, pero los agotamientos de batería penalizan la puntuación (`energyCriterion`); `warn-power-storm` baja de 91,7 a 63,2 (ADR 0008 §5).
- **Semilla/intento:** el intento persiste por escenario (`useProgress.claimAttempt`); semilla = `defaultSeed + intento`, de modo que cada partida nueva usa una semilla distinta.

## Deuda técnica conocida

- **Mando y táctil** no implementados (fase 4); tampoco el giro por pasos del modo anti-mareo.
- **Sombra de la Tierra translúcida** en la escena orbital (hay arco de eclipse, no cono de sombra).
- **Chunk del hangar** ~2,28 MB (~0,86 MB gzip).
- **Audio** sin verificar con oído; la mezcla es provisional. Los avisos visuales no dependen del audio.
- **`orbitPhase` cambió de semántica** (anomalía verdadera, no fase uniforme): cualquier consumidor nuevo (servidor, otros clientes) debe leer ADR 0008 §6.
- Sin CI configurado; aún no hay linter (ESLint queda para una fase posterior).

### Resuelta en la fase 2

- Eventos no modelados (sobrecalentamiento, falla de componente, retraso, recorte) y fase orbital no Kepler: implementados (ADR 0008).

## Próximos pasos (hacia la fase 3)

Para quien lleve el multijugador (detalle en `docs/phases/fase-3.md` § "Punto de partida"):

1. **El motor ya es determinista y puro**: corre igual en navegador y Node. No lo toques para la fase 3 salvo cambios aditivos en `types.ts` (o ADR).
2. **Lo que debe correr el servidor:** `computeBudgets` y `reviewGoNoGo` para validar acciones; tras el Go, `rollPreLaunchEvents(design, cat, seed)` y `createMissionSim(design, cat, { seed, preLaunch })`. Misma semilla = mismo `MissionResult` que `runMission` (test de integración obligatorio). Semilla = `defaultSeed + intento`.
3. **`adviseByRole` ya define los 4 roles** (`ADVISOR_ROLES`: director, engineering, science, operations; `ROLE_RESOURCES` indica qué recursos vigila cada uno). En solitario el juego los muestra todos; en sala, cada jugador ve el suyo.
4. **Mascota única por sala** (`catalog.mascot`): el servidor debe decidir qué mensaje ve cada rol o difundir uno solo; la lógica pura está en `apps/client/src/mascot/mascotLogic.ts`.
5. **Cliente:** hoy `useSim`/`useDesign` llaman al motor en local; hay que abstraer una interfaz común (local vs sala). La máquina XState ya tiene `prelaunch`.
6. Cerrar antes (o en paralelo) las acciones humanas 2-5.
7. Fase 4 sigue pendiente (`apps/api`, rankings, guardar/comparar, E2E, mando/táctil).

## Actualización 2026-11-07 (tarde)

- Añadido el modelo `sci-fi_computer_desk_console.glb` (CC-BY 4.0, Inditrion Dradnon) como consola de misión del hangar (`ConsoleModel` en `apps/client/src/models/Models.tsx`). Optimizado 1,87 MB → 0,45 MB. Registrado en `assets/CREDITS.md` y en la pantalla de créditos. Su orientación en el hangar sigue sin confirmar visualmente.
