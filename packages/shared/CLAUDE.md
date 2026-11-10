# @payload/shared — motor del juego

TypeScript puro. Sin React, Three.js, DOM ni APIs de Node en `src/` (los tests y `scripts/` sí pueden
usar Node). Corre en el navegador (solitario) y correrá en el servidor de juego (fase 4).
Diseño que implementa: `docs/GDD.md`. Contrato: `src/types.ts` (reescrito en el ADR 0011).

## API pública (`src/index.ts`)

| Export | Firma | Notas |
| --- | --- | --- |
| `catalog` | `Catalog` | Catálogo por defecto desde `catalog/*.json`, validado con zod al importar |
| `parseCatalog` | `(raw: unknown) => Catalog` | Lanza un error legible si el JSON no cumple el esquema |
| `getShip`, `getNodeKind`, `getThrottle` | `(shipId?, cat?)` · `(kind, cat?)` · `(ship, throttle)` | Lanzan si no existe |
| `generateSector` | `(seed, index, cat?, shipId?) => SectorMap` | Determinista; reintenta hasta dar un sector completable |
| `isSectorSolvable` | `(sector, ship, marginPct = 15) => boolean` | Ruta hacia delante a régimen económico con repostajes |
| `ecoFuelCost`, `nodeDistanceLy`, `getNode` | | Utilidades del mapa |
| `createRun` | `({ seed, shipId?, catalog? }) => Run` | La partida. Ver abajo |
| `computeScore` | `(stats) => number` | 1000·sector + 50·salto + 20·avería + 30·esquiva + años luz |
| `fuelPerLy`, `cruiseSpeedLyPerS` | `(ship, throttle, engineHealthPct) => number` | Mismas fórmulas que usa la partida |
| `FIXED_STEP_S`, `MAX_WORK_SECONDS` | `0.1` · `0.5` | Paso fijo; tope de trabajo por acción |
| `createRng`, `deriveSeed` | `(seed) => Rng` · `(seed, salt) => seed` | Única fuente de aleatoriedad |
| `simLocales` | `Record<Locale, object>` | Traducciones del namespace `sim` (+ `catalog.<id>` generado) |
| `formatMessage`, `lookupSimKey`, `flattenKeys` | | Texto final sin i18next (tests, scripts, servidor) |

Constantes del contrato: `SYSTEM_IDS`, `THROTTLE_IDS`, `INCIDENT_KINDS`, `HAZARD_KINDS`, `NODE_KINDS`.

## `Run` (la partida)

```ts
const run = createRun({ seed: 7 });
run.apply({ type: 'jump', toId });      // { ok: true } | { ok: false, reason: MessageRef }
run.step(dtSeconds);                    // avanza en pasos fijos de 0,1 s
for (const e of run.takeEvents()) …     // RunEvent { type, tone, message, systemId?, incidentKind? }
run.state                               // estado VIVO (solo lectura para quien consume)
run.snapshot()                          // copia profunda (tests, red, React)
run.estimateJump(toId)                  // distancia, combustible/tiempo por régimen, peligros esperados, riskLevel 0-3
```

- **Acciones (`RunAction`):** `jump`, `set-throttle`, `toggle-system`, `work-incident` y `repair-system`
  (con `seconds`: se envían mientras se mantiene la tecla; cada una aporta como mucho `MAX_WORK_SECONDS`),
  `evade`, `service`, `next-sector`.
- **Fases:** `docked` → `transit` → `docked`… → `won` (portal; el tiempo se detiene) → `next-sector`.
  `lost` es definitivo (`lossReason`: `hull` | `oxygen` | `stranded`); toda acción devuelve `reject.runOver`.
- **Eventos:** `step()` devuelve los emitidos en ese avance, pero los de `apply()` solo salen por
  `takeEvents()`. El cliente usa únicamente `takeEvents()`.
- **Determinismo:** misma semilla + mismas acciones en los mismos instantes = misma partida, se trocee
  como se trocee `step()`. Tres flujos de azar con `deriveSeed`: sector, peligros de cada salto
  (pre-sorteados al iniciarlo por posición en el trayecto; van en `transit.hazards`) y desgaste (tres
  tiradas por paso, haya o no avería).
- **Estado derivado** (`refresh()`): `shorted`, `online`, `powerSupplyKw`, `powerDemandKw`, `overloaded`
  y `speedLyPerS` se recalculan en cada paso y tras cada acción; no los escribas a mano.

## Modelo (resumen; cifras en `catalog/*.json`)

- **Energía:** potencia = `reactorOutputKw × salud`; un corto en el reactor = 0 (apagón). Demanda = suma
  de sistemas encendidos, sanos y sin corto (motores solo en tránsito, × `engineDrawMult` del régimen).
  Demanda > potencia ⇒ `overloaded`: el reactor pierde `overloadReactorDamagePctPerS`.
- **Viaje:** velocidad = crucero × régimen × (0,4 + 0,6 × salud de motores); combustible por año luz =
  base × régimen × (1 + penalización × daño). Motores apagados, en corto o sin energía ⇒ velocidad 0.
- **Oxígeno:** + regeneración del soporte vital (si está en línea, × salud) − tripulación − fugas − fuegos.
- **Averías:** fuego (daña sistema y casco, gasta O₂, salta a otro sistema una vez), corto (apaga el
  sistema y se convierte en fuego), fuga. Como mucho una de cada tipo por sistema y `maxIncidents` en total.
- **Impactos:** aviso cuando faltan `warnLeadLy` y navegación está en línea; `evade` cuesta `evadeFuel`.
  Con escudos en línea se absorbe `shieldAbsorb × salud` y los escudos se desgastan; sin ellos hay daño
  a un sistema y posible fuga.
- **Varada:** en tránsito sin combustible; o con motores/reactor a 0 y sin repuestos; o atracada sin
  servicio de estación disponible y sin combustible para ningún salto en económico.
- **Sector:** `hazardMult = 1 + hazardGrowthPerSector × (índice − 1)`; una columna más cada
  `columnsGrowthEverySectors` hasta `maxColumns`.

## Mensajes (`MessageRef`)

- Claves en `locales/es.json` **y** `locales/en.json`: `event.*`, `loss.*`, `reject.*` y etiquetas
  `system.*` (con artículo, para frases), `systemName.*` (título), `throttle.*`, `incident.*`, `hazard.*`.
- El param `system` lleva un `SystemId` y se muestra con `$t(system.{{system}})` o `$t(systemName.{{system}})`.
  Los nombres propios (`node`) van tal cual. En español evita «a/de + $t(system…)» (daría «a el reactor»): usa «en».
- `simLocales` añade `catalog.<id>` con el nombre de cada nave y tipo de destino.
- `locales.test.ts` comprueba paridad, params, que ningún mensaje pasa de 90 caracteres y que toda
  `MessageRef` emitida en partidas simuladas existe y se resuelve del todo. **Si añades un evento, el test
  falla hasta que algún barrido lo emita.**

## Balance

- `src/__tests__/bot.ts` juega como una persona: ir de un puesto a otro le cuesta `walkS` segundos.
  `skill: 'crew'` atiende averías, evade y gestiona la energía; `'idle'` solo salta.
- `pnpm balance [partidas] [sectores]` imprime cuántas partidas superan cada sector y por qué se pierden.
  Úsalo antes y después de tocar `catalog/*.json`.
- `balance.test.ts` fija umbrales holgados: una tripulación atenta supera el sector 1 (>= 90 %), sin
  atender nada casi nunca (<= 35 %) y el sector 4 no está garantizado (10-75 %).

## Reglas

- `src/types.ts` es el contrato: solo cambios aditivos (ver CLAUDE.md raíz, regla 2).
- Prohibido `Math.random()`, `Date.now()`, temporizadores y APIs de Node/DOM en `src/` (`purity.test.ts`).
- Todo mensaje al jugador es un `MessageRef` de una línea, con clave en ambos idiomas.
- Cada regla nueva lleva test en `src/__tests__/`. Para aislar una mecánica, usa un catálogo modificado
  (`calmCatalog` / `hazardCatalog` en `run.test.ts`) en vez de depender de una semilla concreta.
- Las cifras van en `catalog/*.json`, no en el código.

## Tipos y comandos

`tsconfig.json` cubre `src/` **sin** tipos de Node; `tsconfig.node.json` cubre tests, `scripts/` y Vitest.

```bash
pnpm --filter @payload/shared test
pnpm --filter @payload/shared test:watch
pnpm --filter @payload/shared typecheck
pnpm --filter @payload/shared balance 200 4
```
