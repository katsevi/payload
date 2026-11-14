# Fases de desarrollo

Roadmap del juego nuevo (GDD v2). Cada ficha dice qué entra, cómo se comprueba y cuál es su hito.
Las casillas las marca quien **valida** la fase (agente `validator` o una persona), no quien implementa.

| Fase | Contenido | Estado | Ficha |
| --- | --- | --- | --- |
| 1 · Viaje y nave (en solitario) | Mapa estelar, saltos, combustible, interior caminable, sistemas, averías en tiempo real, permadeath | Implementada · pendiente de validación independiente y de prueba con jugadores | [fase-1.md](fase-1.md) |
| 2 · Exploración de superficie | Descenso y aterrizaje, jetpack, oxígeno personal, recolección, gravedad y peligros | Implementada (rama `feat/f2-superficie`) · pendiente de validación independiente final y de prueba con jugadores | [fase-2.md](fase-2.md) |
| 3 · Economía y progresión | Venta en estaciones, mejoras de nave y de equipo, carga | Implementada · validada con observaciones · hito pendiente de prueba con jugadores | [fase-3.md](fase-3.md) |
| 4 · Diseño de misión y sistema solar | Fase de diseño antes de zarpar (objetivo, instrumentos, módulos, lanzador; presupuesto, masa, potencia, plazo; Go/No-Go) y sistema solar real como mapa | Implementada · validada con observaciones · fusionada (PR #6) · hito pendiente de prueba con personas | [fase-4.md](fase-4.md) |
| 5 · Ciencia, datos y astronauta articulado | Instrumentos que generan datos, bajada en ventanas de contacto, puntuación por ciencia, informe post-misión, dificultad, misión guiada de CubeSat, astronauta articulado | Pendiente | [fase-5.md](fase-5.md) |
| 6 · Cooperativo 1-4 con roles | Servidor autoritativo, roles por disciplina, Go/No-Go con voto, astronautas remotos de bajo detalle | Implementada la base (Harry Hernández) · integrada antes de la fase 5 · pendiente de validación y de prueba con 4 personas; falta diseño compartido y voto | [fase-6.md](fase-6.md) |
| 7 · Pulido y lanzamiento | Rankings, mando y táctil, E2E, despliegue | Pendiente (`apps/api` es un marcador) | [fase-7.md](fase-7.md) |
| 8 · Cordura de la tripulación | Salud psicológica por tripulante según los peligros RIDGE y los riesgos HRP de la NASA; bandas con solo debuffs (nunca muerte); contramedidas con sinergia (descanso, llamada a la Tierra, provisiones, mejoras, módulos, rol gestor, cohesión) | No iniciada · planeación documentada (2026-11-14) | [fase-8.md](fase-8.md) |

Las fases 1-3 siguen los tres pilares del plan (`docs/plan/plan-tripulacion-de-exploracion.md` § 2); la 6
es su § 3 (dinámica cooperativa). Las fases 4 y 5 y la renumeración del resto salen del reto NASA Space Apps 2026
(`docs/adr/0015-reto-nasa-y-roadmap.md`). La 8 sale de `docs/diseno/cordura-tripulacion.md` (ADR 0019, propuesta):
depende de la fase 6 y deja un gancho para las ventanas de contacto de la 5. Las fases del simulador anterior (0-4) están en
`docs/archivo/v0.3-simulador/phases/`.

## Reglas de una fase

- Se trabaja en una rama `feat/f<n>-<tema>`.
- El motor va primero y con tests; el cliente solo lo pinta.
- Se cierra con `pnpm validate` en verde, `docs/STATUS.md` y `CHANGELOG.md` al día y una pasada del `validator`.
- El hito con personas reales lo hace el equipo; ningún agente puede darlo por cumplido.
