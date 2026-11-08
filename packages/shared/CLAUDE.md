# @payload/shared — motor de simulación

TypeScript puro. Sin React, Three.js, DOM ni APIs de Node en `src/` (los tests y el prototipo sí
pueden usar Node). Corre en el navegador (solitario) y en el servidor de juego (fase 3).

## API pública (`src/index.ts`)

| Export | Firma | Notas |
| --- | --- | --- |
| `catalog` | `Catalog` | Catálogo por defecto desde `catalog/*.json`, validado con zod al importar |
| `parseCatalog` | `(raw: unknown) => Catalog` | Lanza error legible si el JSON no cumple el esquema |
| `getScenario/getComponent/getOrbit/getLauncher` | `(id, cat?) => Def` | Lanzan si el id no existe |
| `componentsForScenario` | `(scenarioId, cat?) => ComponentDef[]` | Respeta `allowedComponents` |
| `computeOrbitParams` | `(orbit) => OrbitParams` | Kepler: `T = 2π√(a³/μ)`, μ = 398 600 km³/s² |
| `computeBudgets` | `(design, cat?) => BudgetReport` | Pura y barata: se llama en cada cambio del hangar |
| `reviewGoNoGo` | `(design, cat?) => GoNoGoResult` | `go=false` si hay algún `blocker` |
| `createMissionSim` | `(design, cat?, {seed}) => MissionSim` | Paso fijo interno; determinista sin importar cómo se trocee `step()` |
| `runMission` | `(design, cat?, {seed}) => MissionResult` | Misión completa de golpe |
| `scoreMission` | `(ScoreInput) => ScoreBreakdown` | `S = w1·obj + w2·ciencia + w3·eficiencia + w4·colab` |
| `buildReport` | `(result) => ReportEntry[]` | Cadena de causas con `MessageRef` |
| `createRng` | `(seed) => Rng` | Única fuente de aleatoriedad |
| `simLocales` | `Record<Locale, object>` | Traducciones del namespace `sim` (+ subárbol `catalog.<id>` generado) |
| `formatMessage` | `(ref, locale, cat?) => string` | Texto final sin i18next (prototipo, tests, servidor) |
| `resolveMessageParams` | `(ref, locale, cat?) => params` | Params con nombres resueltos, para usos FUERA de las plantillas (no pasar a `t()`) |
| `lookupSimKey`, `CATALOG_ID_PARAMS`, `TIGHT_MARGIN`, `RESOURCE_IDS` | | Utilidades y constantes |

## Mensajes (`MessageRef`) y nombres del catálogo

- Los params `component`, `structure`, `launcher` y `orbit` llevan **ids del catálogo**
  (`payload-thermal-camera`, `launcher-colibri`, `LEO`). Las plantillas de `locales/*.json` los
  muestran con anidamiento de i18next: `"$t(catalog.{{component}}) consume {{powerW}} W"`.
- `simLocales` añade al importar el subárbol `catalog.<id>` con el nombre localizado de cada
  componente, órbita y lanzador (generado desde `catalog/*.json`; no se duplica en los locales).
- Por tanto el cliente solo hace `i18n.t(ref.key, { ns: 'sim', ...ref.params })` y ve nombres
  legibles (i18next interpola primero y luego resuelve `$t(...)`; probado con i18next 27, con
  `keySeparator: false` y recursos aplanados).
- Ids desconocidos (p. ej. `review.unknownComponent`) usan el param `id`, que se muestra tal cual.
- Al añadir un mensaje con un id del catálogo, usa uno de esos 4 nombres de param y escribe
  `$t(catalog.{{param}})` en **es y en**. Un test verifica que toda `MessageRef` emitida existe,
  trae todos sus params y no deja `{{…}}` ni `catalog.<id>` sin resolver.
- Unidades de `ResourceBudget.unit`: códigos estables (`kg`, `W`, `Wh`, `MUSD`, `Mbit`, `Mbit/d`,
  `months`, `years`) traducidos en `unit.<código>`; también hay `resource.<id>` y `status.<estado>`.

## Modelo (resumen; detalle en los comentarios de cada módulo)

- Órbita (`orbital.ts`): `a = R⊕ + (hp+ha)/2`, `T = 2π√(a³/μ)`, eclipse β=0 `f = asin(R⊕/(R⊕+h))/π`
  (elípticas: h = a − R⊕), contacto por estación con elevación mínima 10°:
  `1440 · (1 − cos λ)/2 · 2`, `λ = acos(R⊕ cos ε/(R⊕+h)) − ε`; GEO = 1440 min.
- Presupuestos (`budgets.ts`): tabla de used/available por recurso; `tight` si margen < 15 %.
  Tiempo = pieza más lenta + 0.25 meses/pieza + espera del lanzador. Vida = min(arrastre,
  `5 · ln 0.7 / ln(R^(1+2·rad))`). Operación = `operationsCostMUSDPerYear × minLifetimeYears`.
- Go/No-Go (`review.ts`): lista de blockers y warnings en la cabecera del módulo; `power-storm`
  avisa si una tormenta solar vaciaría la batería aunque el balance nominal sea positivo.
- Simulación (`simulation.ts`, constantes en `constants.ts`): paso fijo de 30 s. Batería
  coherente con la revisión: `battery-low` al cruzar el suelo de la DoD; por debajo se desgasta
  (−6 % de la capacidad nominal por hora); agotarse = apagón → modo seguro y −10 %; muere por
  debajo del 60 % de la nominal o tras 5 agotamientos. `MissionResult.finalBatteryCapacityPct`.
  Contactos repartidos regularmente; eventos pre-sorteados por día.
- `power-storm` compara déficit de tormenta + eclipse con la energía ÚTIL (capacidad × DoD).
- Puntuación (`scoring.ts`): objetivos = `100 · media · √mín` de los criterios, con criterio de
  viabilidad (0 si masa/energía/batería/presupuesto/tiempo están excedidos); eficiencia por curva
  de margen (15-50 % = 100) × (1 − 0.25 · nº de recursos excedidos).
- Diseños de ejemplo y semillas en las que fallan: `prototype/designs/README.md` (9 diseños; semilla por defecto `20260101`).
- Ojo (decisión abierta, `docs/STATUS.md`): `warn-power-storm` es Go con aviso pero falla con muchas semillas y puntúa 91,7 con la por defecto; la LEO del catálogo está a 450 km (los tests de órbita construyen una de 400 km ≈ 92,6 min).

## Tipos y rendimiento

- `tsconfig.json` cubre `src/` **sin** tipos de Node (si se cuela `process`, `Buffer`... tsc
  falla); `tsconfig.node.json` cubre tests, `scripts/`, Vitest y `prototype/`. `pnpm typecheck`
  ejecuta ambos. `purity.test.ts` vigila además relojes, azar global, `require` y APIs de Node/DOM.
- Los tests de tiempo solo guardan contra regresiones groseras (márgenes 10-20×). La medida fina
  es `pnpm --filter @payload/shared bench` (objetivos: `computeBudgets` < 1 ms, 30 días < 200 ms).

## Reglas

- `src/types.ts` es el contrato: solo cambios aditivos (ver CLAUDE.md raíz, regla 2).
- Prohibido `Math.random()` y `Date.now()` en `src/`.
- Todo mensaje al jugador es un `MessageRef` cuya clave existe en `locales/es.json` y `locales/en.json`.
- Cada fórmula nueva lleva test en `src/__tests__/`. Los valores de referencia (periodo de LEO a
  400 km ≈ 92.6 min, etc.) se comprueban con tolerancia.
- El catálogo debe permitir **varias soluciones válidas** y **diseños que fallen por razones
  distintas** (energía en eclipse, masa vs lanzador, datos sin bajar, presupuesto). Hay tests que lo garantizan.

## Comandos

```bash
pnpm --filter @payload/shared test
pnpm --filter @payload/shared test:watch
pnpm --filter @payload/shared typecheck
pnpm --filter @payload/shared bench   # rendimiento (fuera de los tests)
pnpm proto                       # prototipo de compromisos en terminal (fase 0)
pnpm proto --design ok-cubesat-leo --seed 7 --events --lang en
```
