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
| `orbitEccentricity`, `solveKeplerEquation`, `trueAnomalyFromMeanAnomaly`, `orbitPhaseAt`, `altitudeAtTrueAnomaly` | `(orbit) => e` · `(M, e) => E` · `(M, e) => ν` · `(tS, periodS, e) => 0-1` · `(orbit, ν) => km` | 2.ª ley de Kepler (fase 2) |
| `computeBudgets` | `(design, cat?, preLaunch?) => BudgetReport` | Pura y barata: se llama en cada cambio del hangar. Con `preLaunch` aplica retraso y recorte |
| `reviewGoNoGo` | `(design, cat?) => GoNoGoResult` | `go=false` si hay algún `blocker` |
| `createMissionSim` | `(design, cat?, {seed, fixedStepSeconds?, preLaunch?}) => MissionSim` | Paso fijo interno; determinista sin importar cómo se trocee `step()` |
| `runMission` | `(design, cat?, {seed, preLaunch?}) => MissionResult` | Misión completa de golpe |
| `rollPreLaunchEvents` | `(design, cat?, seed?) => PreLaunchOutcome` | Fase 2: retraso de lanzamiento y recorte de presupuesto; el cliente lo llama tras el Go |
| `resolveEventTable`, `EVENT_TABLES` | `(scenario) => EventTable` | Tabla de eventos por dificultad + `ScenarioDef.eventTuning` |
| `scoreMission` | `(ScoreInput) => ScoreBreakdown` | `S = w1·obj + w2·ciencia + w3·eficiencia + w4·colab` |
| `energyCriterion` | `(depletions?, finalCapacityPct?) => number \| null` | Criterio de objetivos por agotamientos de batería (ADR 0008) |
| `buildReport` | `(result) => ReportEntry[]` | Cadena de causas con `MessageRef` |
| `adviseByRole` | `(design, budgets, review, cat?) => RoleAdvice[]` | Asesores en solitario: director, engineering, science, operations (`sim:advisor.*`) |
| `pickMascotDialogue` | `(trigger, mascot, variant = 0) => MascotDialogue \| null` | Determinista; `variant` rota entre diálogos con el mismo disparador |
| `mascotTriggerForEvent`, `mascotTriggersFromBudgets` | `(event) => 'event:<tipo>'` · `(budgets) => string[]` | Disparadores de la mascota desde el motor |
| `evaluateAcademyStep` | `(step, design, cat?) => boolean` | Objetivo de un paso de la Academia |
| `getGlossaryEntry` | `(id, cat?) => GlossaryEntry \| null` | Glosario |
| `createRng`, `deriveSeed` | `(seed) => Rng` · `(seed, salt) => seed` | Única fuente de aleatoriedad; `deriveSeed` separa flujos |
| `simLocales` | `Record<Locale, object>` | Traducciones del namespace `sim` (+ subárbol `catalog.<id>` generado) |
| `formatMessage` | `(ref, locale, cat?) => string` | Texto final sin i18next (prototipo, tests, servidor) |
| `resolveMessageParams` | `(ref, locale, cat?) => params` | Params con nombres resueltos, para usos FUERA de las plantillas (no pasar a `t()`) |
| `lookupSimKey`, `CATALOG_ID_PARAMS`, `TIGHT_MARGIN`, `RESOURCE_IDS` | | Utilidades y constantes |
| `withCollaboration`, `scoreWeightSum` | `(score, colab) => ScoreBreakdown` · `(weights) => number` | Fase 3: puntuación de equipo aparte de `MissionResult`; con 100 devuelve el mismo total |
| `combineRoles` | `(playerIds, prefs?) => Record<id, TeamRole[]>` | Reparto 1-4 jugadores; maximiza preferencias; determinista |
| `missingRoles`, `hasPermission`, `roleForPermission` | `(players) => TeamRole[]` · `(roles, perm) => boolean` · `(perm) => TeamRole` | Roles sin jugador conectado; tabla `ROLE_PERMISSIONS` |
| `checkTeamAction` | `(TeamActionContext, TeamAction) => TeamActionCheck` | `apply` · `request` (automática o `request-resource`) · `reject` con `team.reject.*` |
| `applyDesignAction`, `actionImpact`, `isDesignAction` | `(design, action) => design` · `(before, after, cat?) => ResourceImpact[]` | Misma semántica que el store `useDesign` del cliente |
| `sameTeamAction` | `(a, b) => boolean` | Igualdad estructural de acciones (detecta solicitudes duplicadas) |
| `isTeamScenario` | `(scenario) => boolean` | `scenario.team.minPlayers >= 2` |
| `buildResourceRequest`, `applyApprovedRequest`, `closeRequest`, `allocationAfterApproval` | ver `team.ts` | Ciclo de vida de solicitudes (aprobar puede encadenar a otro rol) |
| `allocatableBudgetMUSD`, `defaultAllocation`, `validateAllocation`, `subsystemSpend` | `(scenario, cat?, launcherId?)` · `(scenario, cat?, {launcherId?, design?})` · `(alloc, scenario, cat?, launcherId?)` · `(design, alloc, cat?)` | Reparto del presupuesto por subsistema |
| `validateVote`, `teamVoteFrom`, `tallyGoNoGo` | `(vote, engineGo) => MessageRef \| null` · `(action, playerId, atS) => TeamVote` · `(votes, review) => TeamPollResult` | Go/No-Go compartido |
| `alertForEvent`, `alertSatisfied`, `ackAlert`, `alertTimedOut`, `closeAlert` | `(event, id, atS) => TeamAlert \| null` · … | Alertas de `EVENT_RESPONSE_ROLES` |
| `scoreCollaboration` | `(CollaborationInput) => CollaborationScore` | Criterios `requests` y `alerts` (0-1); sin nada = 100; admite `purged` |
| `purgeRequests` | `(requests, keepClosed = requestHistory, previous?) => { kept, purged }` | Tope del historial sin cambiar la nota |
| `takeRequestToken` | `(bucket \| null, nowS) => RequestTokenResult` | Cubeta de fichas del límite de frecuencia de solicitudes |
| `sanitizePlayerText` | `(text: unknown, maxChars) => string \| null` | Chat, nombres y notas |
| `teamActionSchema`, `parseTeamAction` | zod (Standard Schema) · `(raw) => TeamAction \| null` | Valida el mensaje `action` del cliente |
| `createRoomView`, `encodeRoomView`, `decodeRoomView` | `(init) => RoomView` · `(view) => RoomStateWire` · `(wire: unknown) => RoomView` | Estado Colyseus ↔ vista plana; `decode` nunca lanza |
| `TEAM_ROLES`, `ROOM_PHASES`, `SUBSYSTEM_IDS`, `NO_GO_REASON_CODES`, `RESOURCE_UNITS`, `ROLE_SUBSYSTEMS`, `RESOURCE_OWNER`, `ROLE_PERMISSIONS`, `TEAM_ACTION_PHASES`, `EVENT_RESPONSE_ROLES`, `TEAM_LIMITS`, `TEAM_TIME_SCALES`, `TEAM_MASCOT_TRIGGERS` | | Datos y constantes de la sala (fase 3) |

## Contenido pedagógico (fase 2, `catalog/*.json`, campos OPCIONALES de `Catalog`)

- `glosario.json` → `catalog.glossary: GlossaryEntry[]` (`id`, `term`, `definition`, `why?`, `related?` con ids del glosario).
- `mascota.json` → `catalog.mascot: MascotDef`. Mascota ORIGINAL **Orbi** (plan B del GDD; Rise no está en el
  repo). Cambiar de mascota = cambiar el JSON. Disparadores `<tipo>:<valor>`, validados con zod:
  `event:<SimEventType>`, `resource-over:<ResourceId>`, `resource-tight:<ResourceId>`, `phase:<MissionPhase>`,
  `academy:<id de paso>`, `help:<contexto>` (libre: `hangar`, `control-room`…), `review:go|no-go`, `report:success|failure`.
  Fase 3 (sala): `team:<valor de TEAM_MASCOT_TRIGGERS>` (lista cerrada en `constants.ts`) y `role:<TeamRole>`.
  Las expresiones de cada diálogo deben estar en `expressions`.
- `academia.json` → `catalog.academy: AcademyDef` sobre el escenario `academy-cubesat-leo` (básico, sin eventos,
  holgado). Objetivos: `add-component` (id de pieza o de subsistema), `select-orbit`, `select-launcher`,
  `resource-ok` (no excedido y evaluable), `go`, `manual` (siempre true: avanza el jugador).

## Eventos (fase 2, ADR 0008, `events.ts`)

- Entorno (tormenta, basura, rueda): mismo flujo y tiradas que la fase 1. Salud (sobrecalentamiento si el
  margen térmico < 15 %, falla de componente según fiabilidad × radiación): flujo derivado con `deriveSeed`.
  Pre-operación (retraso, recorte): `rollPreLaunchEvents`, otro flujo derivado. Todo pre-sorteado.
- Las fallas genéricas degradan, no destruyen (instrumento perdido, radio/OBC/ADCS de respaldo, paneles/
  batería/térmico aislados con 6 h de modo seguro). Sus claves: `event.componentFailure.<caso>`, tipo `component-failure`.
- Un `time`/`budget` excedido SOLO por eventos pre-operación no anula la viabilidad: criterio `overrun-<id>`.
- Probabilidades y rangos por dificultad en `EVENT_TABLES`; un escenario puede ajustarlos con `eventTuning`.

## Multijugador (fase 3, `team.ts`, `teamWire.ts`; contrato en `docs/MULTIPLAYER.md`)

- **Puro y sin reloj**: los tiempos (`atS`, `raisedAtS`…) son segundos de sala que pasa el servidor.
  `MissionResult`, `runMission`, `scoreMission` y `buildReport` no cambian (paridad sala ↔ motor): la
  colaboración va aparte, `teamScore = withCollaboration(result.score, scoreCollaboration(...).score)`.
- **Roles**: `TeamRole = AdvisorRole`. `ROLE_SUBSYSTEMS` (piezas que monta cada rol), `RESOURCE_OWNER` (quién
  resuelve cada recurso, coherente con `ROLE_RESOURCES`) y `ROLE_PERMISSIONS` (tabla del contrato).
  `TEAM_ACTION_PHASES` dice en qué fases vale cada acción (`allocate-budget` también en `briefing`).
- **Solicitudes automáticas** (`checkTeamAction`): una acción de diseño que empeora (ok→tight|over,
  tight→over) un recurso evaluable (disponible > 0 antes y después) de un rol que el actor no tiene ⇒
  `request` al dueño, `amount` = subida del uso (o bajada del disponible, p. ej. vida útil). Con reparto,
  pasarse de la asignación del subsistema ⇒ `request` a `director` (`budget`, `subsystem`, exceso). Gana
  la más grave: over > tight, orden de `RESOURCE_IDS`, a igualdad la del reparto. `request-resource`
  (explícita) también devuelve `request`; el servidor crea ambas con `buildResourceRequest`.
- **Límites del estado** (`TEAM_LIMITS`): `maxComponents` 40 (`add-component` y aprobaciones ⇒
  `team.reject.tooManyComponents`); con `ctx.actorId`, una acción que crearía solicitud se rechaza si el
  jugador ya tiene ABIERTA una con la misma acción en espera (`requestPending`, comparación con
  `sameTeamAction`) o `maxOpenRequestsPerPlayer` (5) abiertas (`tooManyRequests`). Límite de frecuencia
  (lo aplica el servidor con `takeRequestToken`): cubeta de `requestBurst` (3) fichas, una nueva cada
  `requestMinIntervalS` (2 s); sin ficha ⇒ `team.reject.requestRateLimited` (`{ seconds }`).
- **Historial con tope**: `purgeRequests(requests, requestHistory = 100, previous?)` conserva todas las
  abiertas y ≤ 100 cerradas (purga primero retiradas, luego las resueltas más antiguas, solo como prefijo)
  y devuelve `purged` (`PurgedRequestStats`), que se pasa a `scoreCollaboration({ requests: kept, purged })`
  para obtener EXACTAMENTE la misma nota que con la lista completa (mismo orden de sumas; test con 600 pasos).
- **Escenarios de equipo**: `ScenarioDef.team?: { minPlayers, maxPlayers }` (enteros 1-4, min ≤ max, zod).
  Hoy `polar-ice-watch-team` (2-4); los tests no fijan la lista (añadir otro por JSON no rompe nada). `isTeamScenario` = `minPlayers >= 2`; `start-mission` con menos
  jugadores conectados que `minPlayers` ⇒ `team.reject.notEnoughPlayers` (`{ min }`).
- **Aprobar** (`applyApprovedRequest(state, req, cat, approverRoles)`): re-aplica la acción sobre el diseño
  actual (`reject` con motivo si ya no tiene sentido), sube la asignación (`allocationAfterApproval`) y, si
  la acción toca además un recurso de un tercer rol, devuelve `request` ENCADENADA (`approvedBy` acumula
  los roles conformes; ≤ 4 pasos). Ej.: Ciencia + cámara térmica ⇒ Ingeniería (energía) ⇒ Operaciones
  (comms) ⇒ Dirección (calendario) ⇒ aplicada.
- **Reparto** (`defaultAllocation`): dinero para piezas (`allocatableBudgetMUSD` = presupuesto − operación −
  lanzador elegido o el más barato que llega) en proporción al costo mediano de las piezas permitidas de
  cada subsistema; con `{ design }` cubre primero lo ya montado. Subsistema sin asignación = sin tope.
- **Votación**: `validateVote` (No-Go exige motivo; `other` exige nota; Go rechazado si el motor da No-Go),
  `tallyGoNoGo` (cuenta el último voto de cada rol; un No-Go válido cierra; Go con los 4 y el motor en Go).
- **Alertas**: `EVENT_RESPONSE_ROLES` (tormenta, rueda, basura, falla de componente, sobrecalentamiento,
  batería agotada); `ackAlert` cierra al responder todos; `alertTimedOut` a los `TEAM_LIMITS.alertTimeoutS`.
- **Colaboración** (`scoreCollaboration`): `requests` (resuelta ≤ 60 s = 1 → 0,5 a 300 s; abierta = 0;
  retiradas no cuentan) y `alerts` (≤ 20 s = 1 → 0 a 70 s, así el cierre a 45 s vale 0,5; sin respuesta =
  0). `score = 100 · media`; sin nada = 100. Umbrales en `TEAM_LIMITS`.
- **Red**: `teamActionSchema` (zod estricto, Standard Schema para Colyseus; un test garantiza que su tipo
  es `TeamAction`). `RoomStateWire` = solo primitivos, arrays de string y `players` (mapa de `PlayerWire`);
  objetos y listas de objetos como JSON (`''` = null). Mapeo campo a campo en la cabecera de `teamWire.ts`.
  Texto libre de jugadores: siempre por `sanitizePlayerText`.
- Mensajes en `sim:team.*` (`team.reject.*`, `team.request.*`) con etiquetas `team.role|phase|subsystem|noGoReason.<id>`;
  los roles, subsistemas, recursos, unidades y estados se anidan con `$t(team.role.{{role}})`, `$t(resource.{{resource}})`…
  `locales.test.ts` barre la lógica de equipo y comprueba que todo se resuelve.

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
- Puntuación con agotamientos (ADR 0008): en misiones completadas, criterio `energía = clamp(1 − 0,15·agot.) ·
  clamp((cap − 60)/40)`; `warn-power-storm` con la semilla por defecto puntúa 63,2 (antes 91,7). `power-storm` sigue
  siendo aviso. La LEO del catálogo está a 450 km (los tests de órbita construyen una de 400 km ≈ 92,6 min).
- Falla de rueda: apuntado de respaldo 1° (star tracker + magnetopares), 2° (star tracker solo) o 5°
  (`wheelBackupPointingDeg`). Vida útil en la puntuación: `lifetimeCriterion` = lineal de 0 (75 % de la
  vida exigida) a 1 (100 %).
- Fase orbital: `orbitPhase` = anomalía verdadera / 2π (Kepler); eclipse, contactos y energía siguen en tiempo
  (anomalía media), así que los presupuestos no cambian. `SimSnapshot.meanPhase` y `altitudeKm` son opcionales.

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
  distintas** (energía en eclipse, masa vs lanzador, datos sin bajar, presupuesto). `scenarios.test.ts` lo
  comprueba para TODOS los escenarios con `src/__tests__/fixtures/scenarios/<scenarioId>.json`
  (≥ 2 `valid` y `failing` con ≥ 2 `cause` distintas; formato en `fixtures.ts`). **Escenario nuevo ⇒ fixture nuevo**
  (el test falla si falta).

## Comandos

```bash
pnpm --filter @payload/shared test
pnpm --filter @payload/shared test:watch
pnpm --filter @payload/shared typecheck
pnpm --filter @payload/shared bench   # rendimiento (fuera de los tests)
pnpm proto                       # prototipo de compromisos en terminal (fase 0)
pnpm proto --design ok-cubesat-leo --seed 7 --events --lang en
```
