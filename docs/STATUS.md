# Estado del proyecto — traspaso entre sesiones

Última actualización: **2026-11-07** · Versión: 0.1.0 (ver `CHANGELOG.md`)

> Léelo antes de empezar y actualízalo al terminar una tarea relevante. Las casillas de
> `docs/phases/fase-*.md` las marca quien valida la fase, no quien implementa: aquí solo se resume.
> Nota: el repositorio git existe pero **aún no tiene ningún commit** (`git log` falla en `main`).

## Estado por fase

| Fase | Veredicto de la validación independiente (2 rondas) |
| --- | --- |
| 0 · Preproducción | **Entregables completos.** El hito (*los compromisos son divertidos en papel*) está **pendiente de una prueba en papel con personas reales** (>= 3). |
| 1 · Rebanada vertical en solitario | **Cumple con observaciones** (ver "Acciones humanas" y "Decisiones abiertas"). |
| 2, 3, 4 | No iniciadas. `apps/game-server` y `apps/api` son marcadores sin código. |

### Fase 0 — qué se hizo

- `docs/GDD.md` (visión, pilares, cámaras y controles, roles, mascota con plan B, sistemas, alcance por fase, preguntas abiertas), `docs/phases/` y ADR 0001-0007.
- Contrato `packages/shared/src/types.ts` y catálogo JSON: 27 componentes, 6 órbitas, 4 lanzadores, 1 escenario (`leo-earth-observation`), todo en es/en.
- Prototipos (`prototype/`): CLI `pnpm proto`, hoja de cálculo `payload-prototipo.xlsx` generada por `build-sheet.ts` (su Go/No-Go coincide con la CLI en los 9 diseños) y prototipo en papel con plantilla de registro.
- 9 diseños de ejemplo en `prototype/designs/` (3 válidos, 2 con aviso, 4 que fallan por causas distintas).
- 4 modelos originales en `assets/models/source/` y `assets/CREDITS.md`.

### Fase 1 — qué se hizo

- **Motor** (`packages/shared`): órbita Kepler, eclipse y contacto con estación, presupuestos con "¿por qué?", Go/No-Go, simulación determinista con paso fijo de 30 s, eventos pre-sorteados (tormenta solar, basura espacial, falla de rueda de reacción), puntuación, informe con cadena de causas, i18n del motor (`sim`).
- **Cliente** (`apps/client`): menú, briefing, hangar caminable (1ª/3ª persona, Rapier), montaje de piezas, panel de recursos, selección de órbita/lanzador, revisión Go/No-Go, lanzamiento, operación con aceleración 0×-10 000×, informe y "Rediseñar", ajustes, créditos, modo accesible 2D, es/en.
- **Assets:** 4 GLB optimizados con meshopt; ERIZON solo con compresión de geometría (82 nodos y 51 mallas, igual que el original).

## Métricas verificadas (2026-11-07)

| Métrica | Valor |
| --- | --- |
| `pnpm validate` | Verde: 11/11 tareas (typecheck + test + build) |
| Tests `@payload/shared` | **140** en 10 archivos (balance, budgets, catalog, locales, orbital, purity, review, rng, scoring, simulation) |
| Tests `@payload/client` | **9** en 3 archivos (`i18n`, `flow`, `fixes`) |
| `pnpm --filter @payload/shared bench` | `computeBudgets` 0,013 ms · `reviewGoNoGo` 0,016 ms · `runMission` 30 días 14,5 ms (medianas; objetivos < 1 ms, < 1 ms, < 200 ms) |
| Resultados de `pnpm proto --brief` (semilla por defecto `20260101`) | ok-cubesat-leo 79,3 · ok-microsat-leo-thermal 92,8 · ok-microsat-sso-hires 86,6 · warn-power-storm 91,7 · warn-sso-low-resolution 74,0 · fail-data-uhf 24,1 · fail-budget-gold-plated 52,0 (No-Go) · fail-mass-rideshare 21,7 (No-Go) · fail-battery-eclipse 21,4 (No-Go) |
| Peso de los modelos servidos (`assets/web/models/`) | **~11,9 MB** en total (`du -sh`: 12 MB) |
| Peso de los originales (`assets/models/source/`) | ~59 MB (el mayor, ERIZON, ~31 MB) |

Modelos servidos y cuándo se piden:

| Archivo | Peso | Original | Escena que lo carga |
| --- | --- | --- | --- |
| `astronaut_by_jungle_jim.glb` | 0,34 MB | 1,8 MB | Hangar (avatar en 3ª persona, `PlayerController`) |
| `aurora_g9_expedition_walker_mech.glb` | 3,1 MB | 23 MB | Hangar, exhibición con carga diferida (2,5 s tras montar) |
| `our_milky_way_galaxy.glb` | 1,6 MB | 4,5 MB | Menú (fondo) y escena orbital |
| `programme_erizon.glb` | 7,1 MB | 32 MB | Solo escena orbital, con retardo de 3 s (el menú no lo pide) |

Si un GLB falta, `ModelBoundary` muestra una forma simple de respaldo.

## Acciones humanas pendientes

Ningún agente puede hacerlas; bloquean el cierre formal de las fases.

1. **Prueba en papel con >= 3 personas reales** con `prototype/PROTOTIPO-PAPEL.md`; registrar cada sesión con `prototype/PLANTILLA-REGISTRO-PRUEBA.md` (copia en `prototype/pruebas/`, que aún no existe), anotar la conclusión del hito aquí y enlazar las sesiones. Es el hito de la fase 0.
2. **Prueba manual con teclado y ratón** de una misión completa por una persona nueva (briefing hasta informe sin ayuda) y **medición de FPS** en el hangar en una laptop de gama media (meta 60, mínimo 50). Nadie ha medido FPS en hardware real.
3. **Asignar responsables** a las 7 preguntas abiertas del GDD (`docs/GDD.md` § 15, hoy "Responsable: por definir").
4. **Confirmar visualmente ERIZON** en la escena orbital: según la proyección de la cámara por defecto queda (NDC ~ -0,72, 0,8) bajo el panel "Operación de la misión"; no se pudo confirmar con una captura.
5. **Rise:** conseguir la autorización de NASA o decidir una mascota propia (el sistema debe permitir cambiarla). Sin autorización, Rise no debe estar en el repositorio.
6. **Decidir si se sustituye ERIZON** (CC-BY-NC-ND) antes de cualquier uso comercial.
7. **Crear `.claude/settings.json` compartido** con permisos para el equipo. No se pudo crear automáticamente; el contenido propuesto está en `docs/CONTRIBUTING.md` § "Permisos compartidos sugeridos".
8. Hacer el **primer commit** del repositorio (hoy no hay historial).

## Decisiones de diseño abiertas (detectadas por el validador)

- **`power-storm` es un aviso, pero hace fallar ~70 % de las veces.** El diseño `warn-power-storm` es Go con aviso y, aun así, falla en operación con muchas semillas (`defaultSeed` +1, +4, +7; con +2 falla el lanzamiento). Además, con la semilla por defecto **puntúa 91,7** (la segunda mejor) pese a terminar con la batería al 0 %. Decidir: ¿subir `power-storm` a bloqueador, o penalizar en la puntuación los agotamientos de batería?
- **El intento/semilla se reinicia a 0 en cada partida nueva** (`startScenario`): al volver al menú y jugar de nuevo se repite la misma semilla (`defaultSeed`), así que el primer intento siempre es idéntico. Decidir si el intento debe persistir o aleatorizarse por partida.
- **LEO del catálogo a 450 km** (T = 93,4 min). La referencia del plan, 92,6 min, es a 400 km. El motor se prueba con 400 km por tolerancia, pero la hoja de cálculo no tiene una celda de altitud libre; el criterio "periodo de LEO a 400 km en la hoja" de `fase-0.md` sigue sin cumplirse. Decidir si bajar la LEO a 400 km o cambiar el criterio.
- **`why` de lanzadores y escenario** (opcional en el esquema, `catalog.ts`): está rellenado en es/en pero el cliente no lo muestra ni un test lo exige.

## Deuda técnica conocida

- **Mando y táctil** no implementados (previstos en fase 4). Tampoco el **giro por pasos** del modo anti-mareo (el FOV ajustable y el balanceo desactivable sí existen).
- **Sombra de la Tierra translúcida** en la escena orbital (el eclipse se pinta centrado en la fase 0,5 con ancho `eclipseFraction`).
- **Órbita con fase uniforme, no Kepler:** `orbitPhase` avanza de forma uniforme con el tiempo (no sigue la 2.ª ley de Kepler); el periodo sí es Kepler.
- **Eventos de fase 2 no modelados:** sobrecalentamiento, falla de componente, retrasos de lanzamiento y recortes de presupuesto. Hoy solo hay tormenta solar, basura espacial y falla de rueda de reacción.
- Un solo escenario y chunk grande del hangar (`HangarScene` ~2,3 MB, ~0,86 MB gzip; el límite de aviso de Vite está subido a 2500 kB).
- Sin commits ni CI configurados; aún no hay linter configurado (ESLint queda para una fase posterior).

## Próximos pasos (hacia la fase 2)

1. Cerrar las acciones humanas 1-4 y resolver las decisiones abiertas de arriba (en especial `power-storm`).
2. Ampliar el catálogo (datos, sin tocar código): 5 escenarios, órbitas MEO/GEO/HEO/TLI con lanzadores con capacidad por órbita, más componentes. Usa la skill `add-catalog-item` y el agente `content-designer`.
3. Pedir al agente `sim-engine` los eventos que faltan (con tests de determinismo) y la fase orbital no uniforme.
4. Academia (mini-misión de CubeSat) y mascota intercambiable por datos (Rise solo con autorización).
5. Audio con licencias registradas en `assets/CREDITS.md`.
6. Pruebas con >= 5 estudiantes y ajuste de balance.

Referencia: `docs/phases/fase-2.md`.

## Actualización 2026-11-07 (tarde)

- Añadido el modelo `sci-fi_computer_desk_console.glb` (CC-BY 4.0, Inditrion Dradnon) como consola de misión del hangar
  (`ConsoleModel` en `apps/client/src/models/Models.tsx`, usado en `MissionConsole` de `HangarScene.tsx`; las cajas
  anteriores quedan como fallback). Optimizado 1.87 MB → 0.45 MB. Registrado en `assets/CREDITS.md` y en la pantalla de créditos.
- Pendiente: confirmar visualmente la orientación de la consola en el hangar (puede requerir ajustar `rotation`).
