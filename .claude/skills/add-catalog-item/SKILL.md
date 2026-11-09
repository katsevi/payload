---
name: add-catalog-item
description: Añadir o modificar contenido del catálogo de Payload (componente, órbita, lanzador o escenario) en packages/shared/catalog/*.json con textos es/en y su "¿por qué?". Úsala para "agrega un instrumento", "nuevo escenario", "nuevo lanzador", "ajusta el balance".
---

# Añadir contenido al catálogo

Los tipos están en `packages/shared/src/types.ts` (`ComponentDef`, `OrbitDef`, `LauncherDef`,
`ScenarioDef`) y el esquema zod en `packages/shared/src/catalog.ts`.

| Contenido | Archivo |
| --- | --- |
| Componente de nave | `packages/shared/catalog/componentes.json` |
| Órbita | `packages/shared/catalog/orbitas.json` |
| Lanzador | `packages/shared/catalog/lanzadores.json` |
| Escenario | `packages/shared/catalog/escenarios.json` |

Contenido pedagógico opcional (también datos, ver `packages/shared/CLAUDE.md`): `glosario.json`
(`catalog.glossary`), `mascota.json` (mascota intercambiable; Orbi), `academia.json` (pasos de la Academia).

Pasos:
1. Copia una entrada existente del mismo tipo como plantilla; usa un `id` kebab-case único.
2. Rellena `name`, `description` y `why` en **es y en** (el "¿por qué?" en 1-2 frases sencillas).
3. Unidades según el nombre del campo (`massKg`, `powerW`, `costMUSD`, `dataMbitPerDay`...).
   Valores plausibles y simplificados.
4. Si es un escenario, referencia solo ids que existan en `allowedOrbits`, `allowedLaunchers`
   y `allowedComponents`.
5. Si es un **escenario**, crea su fixture `packages/shared/src/__tests__/fixtures/scenarios/<id>.json`
   (>= 2 diseños `valid` y >= 2 `failing` con `cause` distinta; formato en `fixtures.ts`). Ajusta la
   dificultad con `eventTuning` del escenario. Sin fixture, `scenarios.test.ts` falla.
6. Comprueba:
   ```bash
   pnpm --filter @payload/shared test   # valida esquema, referencias y balance
   pnpm proto                           # mira los compromisos en terminal
   ```
7. Si el contenido nuevo cambia el balance de un escenario, anótalo en `docs/STATUS.md`.
