# Fase 2 · Contenido y aprendizaje

**Objetivo:** convertir la rebanada vertical en un juego con contenido y ayuda pedagógica.

**Hito de salida:** *pruebas de juego con estudiantes* (observar si entienden los compromisos y si el "¿por qué?" ayuda).

**Prerrequisito:** fase 1 validada.

## Alcance previsto

- **Contenido (datos, sin tocar código):** cinco escenarios (observación de la Tierra, telecomunicaciones, telescopio espacial, exploración lunar, exploración de Marte), las seis órbitas (LEO, SSO, MEO, GEO, HEO, TLI), más lanzadores, más componentes (niveles básico/avanzado) y niveles de dificultad.
- **Eventos aleatorios** ponderados por dificultad: falla de rueda de reacción, tormenta solar, basura espacial, retraso de lanzamiento, recorte de presupuesto. Siempre vía `createRng(seed)`.
- **Academia** (tutorial): mini-misión de CubeSat en LEO que enseña cada recurso.
- **Mascota guía:** Rise **solo con autorización escrita de NASA**; si no, mascota propia (plan B del GDD). Sistema de mascota intercambiable por datos (modelo, expresiones, animaciones, diálogos JSON, versión 2D). Tecla `H` de ayuda contextual.
- **Asesores por rol** controlados por el juego en solitario.
- **Glosario y fichas** (altitud orbital, carga útil, tasa de datos, enlace).
- **Audio:** música adaptativa por capas, voces/avisos, efectos 3D, subtítulos y señales visuales.
- **Vista del instrumento** en operación (primera persona).
- Aurora G9 como vehículo de exploración en las misiones lunar/Marte (opcional).

## Entregables

Estado al 2026-11-08 (validación independiente: cumple con observaciones). Las casillas sin marcar dependen de personas.

- [x] 5 escenarios en `escenarios.json` con briefing, requisitos y pesos propios, en es/en (+ `academy-cubesat-leo`).
- [x] 6 órbitas y lanzadores con capacidad por órbita (7 lanzadores; Marte usa TLI).
- [x] Sistema de eventos con tests de determinismo (`events.test.ts`, ADR 0008): tormenta, basura, rueda, sobrecalentamiento, falla de componente, retraso y recorte.
- [x] Academia jugable de principio a fin (21 pasos, `evaluateAcademyStep`). *Falta observarla con estudiantes.*
- [x] Mascota con diálogos disparados por eventos del motor: **Orbi** (propia, 74 diálogos, intercambiable por JSON). Rise no está en el repositorio.
- [x] Glosario bilingüe (28 entradas, tecla `G`).
- [x] Asesores por rol en solitario (`adviseByRole`), vista del instrumento (`I`) y Aurora G9 en lunar/Marte.
- [x] Música adaptativa y efectos: procedurales (Web Audio), sin archivos externos que licenciar; subtítulos y flashes visuales. *Nadie los ha oído: pendiente de escucha y ajuste de mezcla.*
- [ ] Informe de pruebas con estudiantes y ajustes de balance resultantes (humano; usar `prototype/PLANTILLA-REGISTRO-PRUEBA.md`).

## Criterios de aceptación

- [x] `pnpm validate` en verde con el catálogo ampliado (11/11 tareas; 237 + 67 tests).
- [x] Cada escenario admite >= 2 soluciones válidas y fallos por causas distintas (`scenarios.test.ts` con fixtures por escenario).
- [ ] Una prueba con >= 5 estudiantes sin ayuda del equipo: la mayoría completa la Academia y una misión de campaña (humano; **es el hito de salida**).
- [x] Sin autorización documentada de NASA, el repositorio no contiene a Rise.

## Observaciones de la validación (pendientes, no bloquean)

- Sin verificar en pantalla/oído: audio, lanzamiento y `PreLaunchScreen`, superficie con Aurora y rover en el hangar, FPS.
- Chunk `HangarScene` ~2,28 MB; la mascota no usa aún `model` 3D; `orbitPhase` cambió de semántica (ADR 0008 §6).
- Detalle y acciones humanas: `docs/STATUS.md`.
