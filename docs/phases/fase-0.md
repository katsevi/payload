# Fase 0 · Preproducción

**Objetivo:** dejar el diseño por escrito y comprobar, antes de escribir el juego, que los compromisos de diseño de misión son divertidos.

**Hito de salida:** *los compromisos son divertidos en papel* (se valida con la prueba de `prototype/PROTOTIPO-PAPEL.md`).

> **Pendiente:** este hito requiere una **prueba con personas reales** (≥ 3 jugadores) que ningún agente puede sustituir. Hasta que se haga y se registre con `prototype/PLANTILLA-REGISTRO-PRUEBA.md`, el hito no está cumplido aunque el resto de entregables lo esté. La hoja de cálculo y la CLI solo prueban que el modelo es coherente, no que sea divertido.

## Entregables

### Documentación
- [x] `docs/GDD.md` existe, en español, con: visión y pilares, público, bucle, cámaras y controles, modos y roles, mascota y plan B (aviso de derechos de NASA), sistemas, arte y assets, audio, interfaz e idiomas, accesibilidad, alcance por fase y preguntas abiertas.
- [x] `docs/phases/` contiene `README.md` y `fase-0.md` a `fase-4.md`.
- [x] `docs/adr/` contiene `README.md` y los ADR 0001 a 0007.

### Contrato y catálogo
- [x] `packages/shared/src/types.ts` define el contrato de dominio (componentes, órbitas, lanzadores, escenarios, diseño, presupuestos, simulación, informe).
- [x] `packages/shared/catalog/` contiene `componentes.json`, `orbitas.json`, `lanzadores.json` y `escenarios.json`.
- [x] Todo texto del catálogo está en español e inglés (`LocalizedText`) y cada componente, órbita y escenario tiene su "¿por qué?". (✔ 2.ª pasada: `why` es/en en los 4 lanzadores y el escenario; en el esquema es opcional — catalog.ts:99,106)

### Prototipos
- [x] `prototype/PROTOTIPO-PAPEL.md` describe cartas, tablero, dados, hoja de presupuestos, ronda de 15 minutos y preguntas de observación.
- [x] `prototype/build-sheet.ts` genera `prototype/payload-prototipo.xlsx` desde el catálogo real.
- [x] `prototype/README.md` explica los tres prototipos (CLI, hoja, papel).
- [x] Prototipo CLI (`pnpm proto`) ejecutable.

### Assets
- [x] Los 4 modelos originales están en `assets/models/source/` sin modificar.
- [x] `assets/CREDITS.md` registra autor, fuente y licencia de cada uno, con el aviso CC-BY-NC-ND de ERIZON.

## Criterios de aceptación

- [x] `pnpm --filter @payload/shared exec tsx ../../prototype/build-sheet.ts` termina sin error y crea `prototype/payload-prototipo.xlsx`.
- [x] Al abrir el `.xlsx`, la hoja "Diseño" calcula (sin errores `#REF!`/`#NAME?`/`#VALUE!`) masa, energía, batería en eclipse, costo y datos para un diseño de ejemplo, y el veredicto cambia de Go a No-Go al exceder un recurso. (✔ 2.ª pasada: precarga `ok-cubesat-leo`, 0 errores tras recalcular con LibreOffice y los diseños `fail-*` dan No-Go)
- [ ] El periodo de una órbita LEO a 400 km en la hoja es ≈ 92.4–92.6 min. (⚠️ sigue pendiente: la LEO del catálogo está a 450 km → 93.4 min; la hoja no tiene ni fila ni celda de altitud libre para 400 km)
- [x] El catálogo permite al menos **dos diseños válidos distintos** para el escenario de la fase 1 y diseños que fallan por causas distintas (masa vs lanzador, energía en eclipse, datos sin bajar, presupuesto), comprobado con el prototipo CLI o la hoja.
- [ ] Se ha jugado el prototipo en papel con ≥ 3 personas y se han anotado respuestas a las preguntas de observación. (❌ acción humana pendiente: prueba con ≥ 3 personas reales; ya existe `prototype/PLANTILLA-REGISTRO-PRUEBA.md`)
- [ ] En esa prueba, la mayoría de los jugadores quiso repetir con otro diseño (hito "los compromisos son divertidos en papel"). (❌ acción humana pendiente: depende de la prueba en papel)
- [ ] Las preguntas abiertas del GDD tienen responsable asignado. (❌ falta: GDD.md § 15 pone «Responsable: por definir» en las 7 preguntas abiertas; hay que asignar a una persona)
- [ ] La sesión de prueba está registrada con `prototype/PLANTILLA-REGISTRO-PRUEBA.md` (copia en `prototype/pruebas/`) y la conclusión del hito está anotada en `docs/STATUS.md`. (❌ acción humana pendiente; además `docs/STATUS.md` no existe)
- [x] El veredicto Go/No-Go de la hoja de cálculo coincide con `pnpm proto` para cada diseño de `prototype/designs/`. (✔ 2.ª pasada: los 9 diseños coinciden con `pnpm proto` tras recalcular con LibreOffice)
