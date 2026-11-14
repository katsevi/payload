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
| `getSurfaceCatalog`, `getWorld`, `getMaterial` | `(cat?)` · `(worldId, cat?)` · `(materialId, cat?)` | Superficie (fase 2); lanzan si no existe |
| `getNodeWorld` | `(seed, sector, nodeId, cat) => WorldDef \| null` | Mundo de un nodo aterrizable (determinista, no toca el rng del sector) |
| `generateSurface` | `(seed, sector, nodeId, cat) => SurfaceState \| null` | Lo que genera `land`: zonas, vetas y tormentas |
| `takeOffFuel` | `(world, rules, loadedKg) => number` | `(baseFuel + fuelPerMps2·g) × (1 + kg / massRefKg)` |
| `referenceBrake`, `simulateDescent`, `descentStep` | | Perfil de frenado de referencia (margen `descent.referenceMargin`) y física del descenso (las usa la partida) |
| `streakMultiplier` | `(rules, streakUnits) => number` | Multiplicador de racha de la próxima unidad rara |
| `lodeProgress` | `(deposits, member) => LodeProgress[]` | Por filón de 2+ vetas: `total`, `done` (agotadas por él en esta salida), `bonusReady` |
| `lodeBonusApplies` | `(deposits, deposit, member) => boolean` | Las unidades de esa veta llevarían el bonus de filón completo |
| `suitRefill` | `(rules, suitO2Pct, shipO2Pct) => { suitO2Pct, shipO2Cost }` | Lo que hará `eva-exit` (ciclo de esclusa + relleno), para previsualizarlo |
| `generateSector` | `(seed, index, cat?, shipId?) => SectorMap` | Determinista; reintenta hasta dar un sector completable |
| `isSectorSolvable` | `(sector, ship, marginPct = 15) => boolean` | Ruta hacia delante a régimen económico con repostajes |
| `ecoFuelCost`, `nodeDistanceLy`, `getNode` | | Utilidades del mapa |
| `createRun` | `({ seed, shipId?, catalog?, crewSize?, roles? }) => Run` | La partida. Ver abajo (`crewSize` 1-4, por defecto 1; `roles` por orden, fase 4) |
| `getRoles`, `getRole`, `crewPerks`, `crewCarryCapacityKg`, `crewJetpackDrainPctPerS` | `(cat)` · `(roleId, cat)` · `(member, cat)` · `(rules, member, cat)` | Fase 4 (ADR 0015): roles y sus ventajas pasivas |
| `COOP_LIMITS`, `COOP_ROOM`, `NET`, `parse*`, `sanitizePlayerName`, `makeRoomCode`, `normalizeRoomCode` | | Fase 4: contrato de red (`net.ts`; ver `docs/MULTIPLAYER.md`) |
| `computeScore` | `(stats) => number` | 1000·sector + 50·salto + 20·avería + 30·esquiva + años luz + puntos de materiales guardados a bordo (vender no cambia la puntuación; créditos y mejoras no puntúan) |
| `getEconomy`, `getUpgrades`, `getUpgrade`, `hasShop` | `(cat)` · `(cat)` · `(id, cat)` · `(nodeKindDef)` | Fase 3 (ADR 0014). `hasShop`: `shop` o el obsoleto `service` |
| `effectiveShip`, `effectiveSurfaceRules` | `(base, upgrades, cat) => ShipDef` · `(baseRules, upgrades, cat) => SurfaceRules` | Nave y reglas de traje/jetpack/caídas con las mejoras (puras) |
| `stationOffer` | `(seed, sector, nodeId, cat) => string[]` | Mejoras que ofrece una estación (determinista, flujo propio; `[]` si no es estación) |
| `sectorPriceMults`, `sellUnitPrice`, `upgradePrice` | `(eco, sector) => { sell, buy }` · `(eco, materialId, sector)` · `(upgrade, level, eco, sector)` | Precios con el multiplicador de sector |
| `priceOf`, `affordableUnits` | `(units, unitPrice)` · `(credits, unitPrice)` | Coste entero (hacia arriba) y unidades pagables |
| `cargoMassKg`, `upgradesMassKg`, `cargoFuelMult` | `(cargo, cat)` · `(upgrades, cat)` · `(eco, kg)` | Masa a bordo y su multiplicador del combustible de salto |
| `cruisePowerMarginKw` | `(ship) => number` | Reactor sano − demanda a crucero con todo encendido (negativo = sobrecarga) |
| `fuelPerLy`, `cruiseSpeedLyPerS` | `(ship, throttle, engineHealthPct) => number` | Mismas fórmulas que usa la partida |
| `evadeDamageFraction` | `(hazardRules, grazes) => number` | Fracción del daño que entra tras una esquiva con esos roces |
| `evadeDifficulty` | `(hazardRules, sectorIndex, hullDamage) => number` | Dificultad 0-1 del minijuego (la misma que va en el aviso) |
| `FIXED_STEP_S`, `MAX_WORK_SECONDS` | `0.1` · `0.5` | Paso fijo; tope de trabajo por acción |
| `createRng`, `deriveSeed` | `(seed) => Rng` · `(seed, salt) => seed` | Única fuente de aleatoriedad |
| `simLocales` | `Record<Locale, object>` | Traducciones del namespace `sim` (+ `catalog.<id>` generado) |
| `formatMessage`, `lookupSimKey`, `flattenKeys` | | Texto final sin i18next (tests, scripts, servidor) |

Constantes del contrato: `SYSTEM_IDS`, `THROTTLE_IDS`, `INCIDENT_KINDS`, `HAZARD_KINDS`, `NODE_KINDS`, `SUPPLY_IDS`,
`UPGRADE_TARGETS`, `UPGRADE_FIELDS`, `ROLE_IDS`, `PING_KINDS`.

## `Run` (la partida)

```ts
const run = createRun({ seed: 7 });
run.apply({ type: 'jump', toId });      // { ok: true } | { ok: false, reason: MessageRef }
run.step(dtSeconds);                    // avanza en pasos fijos de 0,1 s
for (const e of run.takeEvents()) …     // RunEvent { type, tone, message, systemId?, incidentKind?, crewId?, subtype? }
run.state                               // estado VIVO (solo lectura para quien consume)
run.snapshot()                          // copia profunda (tests, red, React)
run.estimateJump(toId)                  // distancia, combustible/tiempo por régimen, peligros esperados, riskLevel 0-3
run.estimateLanding()                   // atracado en nodo aterrizable: descenso (perfil de referencia) + despegue en vacío
run.estimateTakeOff()                   // en superficie: despegue con lo cargado aquí y en vacío
run.stationQuote()                      // atracada en estación: venta, suministros, emergencia y mejoras ofrecidas (si no, null)
run.effectiveShip()                     // nave con mejoras (objeto vivo, solo lectura)
run.effectiveSurfaceRules()             // reglas de traje/jetpack/caídas con mejoras (objeto vivo, solo lectura)
run.hydrate(state)                      // fase 4: sustituye el estado por el recibido del servidor (espejo; no lo avances después)
```

- **Acciones (`RunAction`):** `jump`, `set-throttle`, `toggle-system`, `work-incident` y `repair-system`
  (con `seconds`: se envían mientras se mantiene la tecla; cada una aporta como mucho `MAX_WORK_SECONDS`),
  `evade {grazes?}`, `service` (fase 3: ayuda de emergencia), `next-sector`. Estación (fase 3): `sell {materialId?, units?}`,
  `buy-supply {supply, amount?}`, `buy-upgrade {upgradeId}`. Superficie (fase 2): `land`, `set-descent-brake {on}`, `eva-exit`,
  `eva-enter`, `set-position {x, z, grounded}` (silenciosa), `jetpack {seconds}`, `fall-impact {speedMps}`,
  `deploy-tool {depositId}`, `collect {depositId}` (recoge lo extraído; `seconds` se ignora),
  `retrieve-tool {depositId}`, `jettison`, `take-off`. Las de tripulante aceptan `crewId?` (por defecto, el
  primero vivo). `toggle-system`, `work-incident` y `repair-system` exigen a alguien vivo a bordo
  (`reject.crewOutside`); `jump`, `evade` y `service` en tierra dan `reject.onSurface`.
- **Fases:** `docked` → `transit` → `docked`… → `won` (portal; el tiempo se detiene) → `next-sector`.
  Desde `docked` en un nodo aterrizable: `land` → `landing` (descenso) → `surface` → `take-off` → `docked`
  en el mismo nodo (una vez por nodo: `landedIds`). `lost` es definitivo (`lossReason`: `hull` | `oxygen` |
  `stranded` | `crew`); toda acción devuelve `reject.runOver`.
- **Eventos:** `step()` devuelve los emitidos en ese avance, pero los de `apply()` solo salen por
  `takeEvents()`. El cliente usa únicamente `takeEvents()`. `subtype` distingue variantes sin mirar `tone`
  ni la clave: `landing` soft/hard, `suit-o2` low/critical, `airlock` exit/enter, `crew-dead` oxygen/fall,
  `cargo-stored` stored/processed, `material-collected` lode (bonus de filón completo), `impact-evaded` clean y `impact-hit` graze/failed (solo con esquiva por
  habilidad), `tool-stopped`/`tool-resumed` storm, `tool-lost` left, `purchase` fuel/hull/spares. Fase 3: `sale`,
  `purchase`, `upgrade`, `reward` (contrato del sector) y `service` (ayuda de emergencia).
- **Determinismo:** misma semilla + mismas acciones en los mismos instantes = misma partida, se trocee
  como se trocee `step()`. Tres flujos de azar con `deriveSeed`: sector, peligros de cada salto
  (pre-sorteados al iniciarlo por posición en el trayecto; van en `transit.hazards`) y desgaste (tres
  tiradas por paso en `transit`, `landing` y `surface`, haya o no avería; ninguna atracada). Superficie: el
  mundo de cada nodo y su generación usan semillas derivadas (índice de sector + índice de nodo), así que no
  alteran el sector ni los otros flujos; el aterrizaje brusco usa otra derivada pura.
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
- **Esquiva por habilidad** (`hazards.impact.evade`): el aviso (`state.warnings[]`) trae `etaS` (tiempo
  hasta el impacto), `evadeSeed` (determinista: semilla + sector + id del peligro) y `evadeDifficulty`
  (0-1: `difficultyBase + difficultyPerSector·(sector−1) + difficultyFromSeverity·gravedad`). El cliente juega
  el minijuego y envía `evade {grazes}` antes del impacto (se redondea y recorta a 0..`maxGrazes`). Al llegar:
  0 roces = `impact-evaded` (subtype clean); 1..max−1 = `impact-hit` graze con `grazes × grazeDamageFrac` del
  daño (casco, sistema, desgaste de escudos; sin fuga; `stats.impactsGrazed`); `maxGrazes` = `impact-hit`
  failed con `failDamageFrac` (cuenta en `impactsTaken`, puede abrir fuga). Sin `grazes`, igual que siempre.
- **Varada:** en tránsito sin combustible; o con motores/reactor a 0 y sin repuestos (en una estación cuentan la
  emergencia y lo que se puede comprar); o atracada sin combustible para ningún salto en económico contando, en una
  estación, la ayuda de emergencia, los créditos y la venta de la bodega.
- **Sector:** `hazardMult = 1 + hazardGrowthPerSector × (índice − 1)`; una columna más cada
  `columnsGrowthEverySectors` hasta `maxColumns`.

## Economía y mejoras (fase 3, ADR 0014; cifras en `catalog/economia.json` y `catalog/mejoras.json`)

- **Catálogo:** `economy` y `upgrades` son opcionales en el JSON (`parseCatalog` pone los de por defecto). Se valida
  que `sellPrices` use materiales existentes, que cada efecto toque un campo de `UPGRADE_FIELDS` y que los ids no se
  repitan con el resto del catálogo. Los nombres de las mejoras van en `catalog.<id>`.
- **Estado:** `credits` (enteros, `startCredits` al empezar), `upgrades` (id → nivel), `ship.cargoKg` (derivado:
  bodega + mejoras) y `stats.creditsEarned/creditsSpent/unitsSold/upgradesBought`.
- **Terminal** (tipos con `shop`; atracada, si no `reject.notAtStation`; en tránsito `reject.inTransit`):
  `sell` vende al precio fijo por material × `1 + sellPerSector·(sector − 1)` (`reject.nothingToSell`);
  `buy-supply` compra lo que quepa y se pueda pagar a `supplyPrices × 1 + buyPerSector·(sector − 1)` (coste entero
  hacia arriba; `reject.supplyFull`, `reject.noCredits {credits}`); `buy-upgrade` compra el siguiente nivel si la
  estación lo ofrece (`reject.notOffered`, `reject.upgradeMaxed`, `reject.noCredits`).
- **Ayuda de emergencia** (`service`): gratis, una vez por estación (`servicedIds`): combustible hasta `fuelPct` %
  del depósito, casco hasta `hullPct` %, repuestos hasta `minSpares` (`reject.serviceNotNeeded`/`serviceUsed`/`noService`).
- **Contrato:** al superar un sector, `sectorRewardCredits × multiplicador de venta` (evento `reward`).
- **Masa → combustible:** cada salto × `1 + (bodega + mejoras) kg / cargoFuel.massRefKg`, en el consumo y en
  `estimateJump` (`cargoKg`, `cargoFuelMult`).
- **Mejoras:** cada nivel tiene `price`, `massKg` y efectos `{target: ship|suit|jetpack|falls, field, mult?, add?}`
  (primero `mult`). Todo el motor usa la nave y las reglas efectivas; un depósito o casco mayor no se llena solo.
  Hay depósito, condensador de escudos, disipador del reactor, tanque de O₂ del traje, motores de salto, blindaje,
  traje reforzado, propulsores del jetpack y mochila de carga; cada nivel con contrapartida (masa, consumo u O₂).
- **Aviso eléctrico:** cada `stationQuote().upgrades[]` trae `powerMarginDeltaKw` (cambio del margen a crucero con todo
  encendido que traería el siguiente nivel) y `overloadsAtCruise` (con él, ese margen sería negativo). Con todo al
  máximo no cabe todo encendido: aceptado mientras motores + soporte vital + escudos o navegación quepan (test).
- **Oferta:** `stationOffer` elige `offer.size` mejoras por estación con un flujo propio (semilla + sector + índice
  del nodo): determinista y distinta entre partidas. El sector se genera con la nave base.
- **Hielo y mena** se siguen procesando al guardarse si caben; lo que no cabe va a la bodega y se vende barato.

## Cooperativo (fase 4, ADR 0015; cifras en `catalog/roles.json`; red en `docs/MULTIPLAYER.md`)

- **Roles** (`ROLE_IDS`: `pilot`, `engineer`, `manager`, `explorer`): `createRun({ crewSize, roles })` pone
  `crew[i].role`. Solo dan ventajas pasivas (`RolePerks`) y solo a quien las tiene: `repairSpeedMult`
  (ingeniero: `work-incident` y `repair-system`), `evadeFuelMult` y `evadeDamageMult` (piloto: `evade`),
  `carryCapacityMult` y `jetpackDrainMult` (explorador). El gestor de recursos no tiene ninguna por ahora.
  Nombre en `catalog.<id>`. `Catalog.roles` es opcional en el JSON (`parseCatalog` pone el de por defecto).
- **Quién actúa:** `work-incident`, `repair-system` y `evade` aceptan `crewId?`. Sin él (solitario) no hay
  ventaja; con él, cuenta el rol de ese tripulante si está vivo y a bordo. El servidor siempre lo pone.
  Con la ventaja del piloto, una esquiva fallida entra con menos daño y cuenta como roce (sin fuga).
- **Sin roles nada cambia:** el solitario y el bot de balance no los usan.
- **`hydrate(state)`:** copia un `RunState` recibido por red dentro de la partida (conserva las referencias
  internas y recalcula la nave y las reglas efectivas). No restaura los flujos de azar ni los contadores: una
  partida hidratada sirve para leer y consultar, no para avanzarla. El cliente la crea con la misma semilla,
  tripulación y roles que el servidor.
- **`net.ts`:** tipos de mensaje, límites (`COOP_LIMITS`) y validación de lo que llega de la red. Puro, como
  el resto de `src/`. `makeRoomCode(random)` recibe la fuente de azar (la pone el servidor).
- Tests: `src/__tests__/coop.test.ts`.

## Superficie (fase 2; cifras en `catalog/mundos.json`)

- **Autoridad:** el cliente simula movimiento y física (Rapier) e informa (`set-position`, `fall-impact`,
  `jetpack`); el motor manda en recursos y consecuencias. No simula terreno ni colisiones.
- **Catálogo:** `surface = { rules, materials, worlds }`. Opcional en el JSON (`parseCatalog` pone el de por
  defecto); se valida que cada tipo `landable` tenga algún mundo, que los materiales existan, que ningún
  mundo esté en un tipo no aterrizable y que los ids no se repitan. Cada mundo: gravedad, descenso
  (altitud y velocidad iniciales), radio explorable, nº de vetas, tabla de materiales (`minDistanceFrac`,
  `dangerWeightMult`), tormentas (o `null`), terreno inestable (zonas, radio, profundidad del hoyo) y
  `shipWearMult`.
- **Descenso:** a paso fijo, `v += (g − freno) dt`; con freno `v ≥ minSpeedMps` (no se flota) y gasta
  `brakeFuelPerS`; el freno exige motores en línea. Contacto por encima de `safeSpeedMps` ⇒ casco
  `−exceso·hullDamagePerMps`, un sistema `−exceso·systemDamagePerMps` y fuga o corto con probabilidad
  `exceso·incidentChancePerMps`. El perfil de referencia (anticipa un paso de gravedad; margen
  `world.descent.referenceMargin` ?? `rules.descent.referenceMargin`) tarda 15-25 s; en todos los mundos pide
  frenar >= 3 s después de empezar y deja >= 2,5 s hasta el último instante útil (>= 2 s en asteroides). En
  asteroides, llegar 1 s tarde cuesta <= 8 de casco y frenar todo el camino <= 12 de combustible y <= 45 s.
  `land` exige motores en línea (`reject.enginesOffline`: el descenso no se cancela) y combustible para el
  descenso de referencia + el despegue en vacío (`reject.landFuel {fuel}` con el total).
- **Salir no es gratis:** `eva-exit` cobra del O₂ de la nave el ciclo de esclusa (`suit.airlockCycleShipO2Pct`)
  y el relleno del traje (`refillShipO2PctPerTank` por tanque entero, proporcional), sin bajarla de
  `refillMinShipO2Pct`; si no alcanza se sale a medias (`event.airlock.exitPartial {o2}`). El jetpack se
  rellena gratis. **En tierra** (`landing`/`surface`) el soporte vital cubre el consumo de quien está a
  bordo, pero del excedente solo regenera `rules.shipO2.surfaceSurplusRegenMult`: el O₂ gastado en trajes
  no vuelve hasta despegar (en vuelo y atracada se regenera como siempre).
- **Racha (solo lo raro):** los materiales con `streak: true` (cristal, muestra) suman racha; cada pieza rara
  que se lleva encima revaloriza la siguiente: `round(valuePerUnit × (1 + min(maxBonus, bonusPerUnit ×
  streakUnits)))`. Lo común ni suma ni se revaloriza. `crew[].streakMult` es el multiplicador de la próxima
  rara, `streakUnits` las raras que lleva y `carriedUnits` todas. Se consolida al guardar y se pierde al morir.
- **Tripulante (`crew[]`, 1 en solitario, `crewSize` hasta 4):** fuera, el O₂ del traje baja
  `o2DrainPctPerS` (+ `storm.o2DrainPctPerS × intensidad` en tormenta) y a 0 muere; avisos bajo/crítico con
  histéresis (`o2Alert`). Jetpack: gasta al informarlo, recarga solo `grounded`. `set-position` acumula como
  mucho `maxMoveSpeedMps × 1 s` de movimiento (antitrampas por pasos fijos) y no sale del radio.
  `fall-impact`: por encima de `harmlessMps` se pierde O₂, desde `lethalMps` muere. Con todos muertos ⇒
  `lose('crew')`; lo que llevaba encima se pierde.
- **Tormentas:** pre-sorteadas al aterrizar (`surface.storms`, relativas al contacto); `surface.storm` da
  `active`, `intensity`, `nextInS`, `endsInS`, `warned`. Eventos de aviso (`warnS` antes), inicio y fin.
  La primera nunca empieza antes de `storms.firstStartMinS` tras el contacto.
- **Terreno inestable:** `surface.zones`; pisarla (`grounded`) suma a `crackingS` (aviso al empezar a
  pisarla: `pressed`) y a `collapseS` queda `collapsed` (la caída la informa el cliente). Salir o ir en
  jetpack NO lo reinicia: baja `terrain.decayPerS` por segundo. `collect` exige `grounded`
  (`reject.collectAirborne`), así que saltar no anula el riesgo.
- **Herramientas** (`surface.tools` del catálogo; cada material declara su `tool`): concentrador solar
  (hielo; se para con tormenta activa y sigue después) y taladro láser (mena, cristal, muestra). En cada
  `land` cada tripulante recibe `perCrew` de cada una en `crew[].tools`. `deploy-tool {depositId}` la coloca
  (en alcance `collectRangeM`, con `grounded`, veta con unidades y sin otra herramienta, quedándole alguna en
  la mochila). Extrae sola a paso fijo: una unidad cada `collectS / speedMult` s pasa de la veta a
  `surface.tools[].ready`; el estado expone `depositId`, `materialId`, `progress`, `ready` y `stopped`
  (`'storm'` | `'depleted'` | null). `collect {depositId}` recoge al instante lo listo que quepa (racha y
  valor como siempre, `event.pickedUp`); con la veta agotada y nada pendiente, la herramienta vuelve sola a la
  mochila. `retrieve-tool {depositId}` la retira: recoge lo que quepa y lo demás vuelve a la veta. Si la zona
  se hunde, la herramienta sigue recuperable. Cuando no queda nadie vivo fuera (al entrar o al morir), lo
  colocado y lo extraído se pierden en este aterrizaje (`tool-lost`, `surface.toolsLost`); se reponen al
  siguiente `land`. Si se pierde la herramienta del hielo, sus vetas ya no evitan la varada.
- **Vetas:** `surface.deposits` (≤ 20). Una bien dentro de cada zona inestable (a <= 0,3 × radio y sin
  alcanzarse desde fuera con `collectRangeM`: hay que pisarla); el resto repartidas. **Filones**
  (`rules.lodes`): lo raro (con `streak`) fuera de zonas se agrupa en filones de `size` vetas (2-3) a
  `spacingM` (8-15 m) de la primera, con su propio flujo de azar (3 tiradas por veta rara; no cambia material,
  unidades ni orden de las vetas). `deposit.lodeId` dice a qué filón pertenece (para pintarlo); lo común no
  lleva. **Filón completo:** si un tripulante agota (recoge hasta la última unidad) todas las vetas de un filón
  de 2+ vetas menos una en la misma salida, las unidades de la que queda valen ×`lodes.completeMult` (encima
  de la racha); `material-collected` lleva entonces `subtype: 'lode'`. `crew[].lodeVeinsDone` guarda las vetas
  agotadas en la salida en curso: se vacía al salir, al guardar en la nave y al morir. `lodeProgress` da el
  avance por filón para pintarlo sin texto.
  `valuePerUnit = value × (1 + distanceBonus·d/R) × (1 + dangerBonus si risky)`. Se extraen con herramienta
  (arriba); la carga se limita por masa (`carryCapacityKg`). `deposit.progress` refleja el de su herramienta.
- **Bodega:** al entrar (`airlockRangeM`), cada unidad se procesa en suministros si caben (`yields`: hielo →
  combustible, mena → repuestos) o va a `ship.cargo`. `stats.materialsValue` suma los puntos de todo lo
  guardado; `jettison` suelta lo guardado en este mundo y resta sus puntos.
- **Despegue:** con todos los vivos a bordo y motores; `takeOffFuel(world, rules, surface.loadedKg)`.
  Rechazos `reject.takeOffHeavy` (en vacío sí alcanza: suelta carga) o `reject.takeOffFuel`. Varada
  (`stranded`) si, con todos a bordo, ni en vacío alcanza y no queda nada que dé combustible; o motores/reactor
  a 0 sin repuestos ni mena. `land` exige combustible para descenso + despegue en vacío.
- **La nave sigue viva:** averías, O₂ y sobrecarga corren en `landing`/`surface`; desgaste
  `chancePerS × shipWearMult`. El O₂ de la nave lo gastan los tripulantes a bordo y las salidas (esclusa y
  relleno); en tierra apenas se regenera.
- **Contenido (diseño):** el hielo abunda en asteroides (neto medio de unos +18 de combustible en la roca
  errante y +22 en el núcleo de hielo); la luna volcánica y el mundo de tormentas tienen algo de hielo lejos
  de la nave (desde 0,6 del radio, vetas de 2-3), pero bajar sigue costando combustible neto (medias −2,8 y
  −5,5; percentil 90 ≈ 0) y es una apuesta de puntos: allí el concentrador solar se para con las tormentas.
  Las demás lunas y planetas no tienen hielo. Lo raro pesa 8-10 kg con mochila de 110 kg (una docena de
  piezas como mucho); las herramientas extraen en 4-6 s por unidad. Ningún hoyo mata de la
  caída (el del mundo pesado, 7 m, por debajo del vuelo máximo del jetpack allí).

## Mensajes (`MessageRef`)

- Claves en `locales/es.json` **y** `locales/en.json`: `event.*`, `loss.*`, `reject.*` y etiquetas
  `system.*` (con artículo, para frases), `systemName.*` (título), `throttle.*`, `incident.*`, `hazard.*`.
- El param `system` lleva un `SystemId` y se muestra con `$t(system.{{system}})` o `$t(systemName.{{system}})`.
  Los nombres propios (`node`) van tal cual. En español evita «a/de + $t(system…)» (daría «a el reactor»): usa «en».
- `simLocales` añade `catalog.<id>` con el nombre de cada nave, tipo de destino, mundo y material
  (params `world` y `material` se muestran con `$t(catalog.{{world}})`).
- `locales.test.ts` comprueba paridad, params, que ningún mensaje pasa de 90 caracteres y que toda
  `MessageRef` emitida en partidas simuladas existe y se resuelve del todo. **Si añades un evento, el test
  falla hasta que algún barrido lo emita.**

## Balance

- `src/__tests__/bot.ts` juega como una persona: ir de un puesto a otro le cuesta `walkS` segundos.
  `skill: 'crew'` atiende averías, evade y gestiona la energía (nunca aterriza); `'idle'` solo salta.
  `shipSkill: 'medium' | 'simple' | 'clumsy'` (`SHIP_SKILLS`) simula minijuegos imperfectos: informa roces en
  `evade {grazes}` según una distribución y repara a un ritmo distinto de 1 (sin él, como en la fase 1).
  `explore: 'prudent' | 'greedy' | 'thorough'` (con `crew`) aterriza y sale a recoger a 4,75 m/s nominales (el ritmo real
  de cada salida es 0,55-1 × eso y el bot no lo sabe); devuelve `evas` (duración, si volvió, valor, motivo).
  Con herramientas: coloca las libres en las vetas más rentables a las que le da tiempo (valorando el bonus de
  filón completo; con una herramienta en la veta que lo completa apura 4 puntos más el margen), espera junto a la que
  antes tenga algo listo, recoge, y al volver pasa a retirarlas si el O₂ da para el rodeo con su margen de
  vuelta (si no, o si hay una avería a bordo y es prudente, las pierde).
  El prudente evita el terreno inestable, cuenta con las tormentas, vuelve con 12-18 % de margen o si hay
  una avería a bordo, reserva combustible para el salto que hará después (más 20 si el mundo no es un
  asteroide), prioriza el hielo si va justo y, tras despegar, espera atracado a tener >= 85 % de O₂; el
  codicioso apura (2-12 %), solo ve la tormenta cuando la tiene encima, frena tarde a veces y la mitad de
  las salidas se mete en terreno inestable; `thorough` («hasta vaciar») es el prudente con 25 % de margen
  que repite salidas mientras quede botín y el relleno le deje el traje a 2/3. `returnMarginPct` fija el
  margen. `landings` resume cada aterrizaje (valor, salidas, tiempo en tierra, O₂ al despegar, averías);
  cada salida trae `idleS` (segundos sin moverse: esperando a las herramientas, colocando o recogiendo).
  Los exploradores tienen 7200 s de tope (los de la fase 1, 3600).
- `pnpm balance [partidas] [sectores]` imprime cuántas partidas superan cada sector, por qué se pierden
  (`timeout` = tope del bot), la puntuación media y, para los exploradores, la salida media (incluidas las
  fatales), el tiempo quieto, el valor por salida y la curva «margen de O₂ para volver → valor/muertes»; y
  los perfiles de minijuegos (medio, simple, torpe). Úsalo antes y después de tocar `catalog/*.json`.
- `balance.test.ts` fija umbrales holgados: una tripulación atenta supera el sector 1 (>= 90 %), sin
  atender nada casi nunca (<= 35 %) y el sector 4 no está garantizado (10-75 %). Con minijuegos imperfectos,
  el jugador medio y el modo simple superan el sector 3 como mucho 8 puntos por debajo del perfecto y el torpe
  (puesto a puesto 5 s) en >= 55 % de las partidas. Superficie: el prudente
  vuelve en >= 95 % de las salidas y muere en <= 10 % de las partidas, el codicioso muere en 20-50 %, la
  salida media (incluidas las fatales) dura 110-180 s y el prudente puntúa 1,2-1,8 × lo que puntúa no
  explorar. Con 8 % de margen se saca > 10 % más valor por salida que con 25 %, con 5-20 % de muertes
  (<= 2 % con 25 %); con 3 % se muere aún más (ya no compensa). «Hasta vaciar» saca <= 1,3 × por aterrizaje
  que «pocas salidas apuradas» (prudente
  con 3 %) y lo paga: despega con > 15 puntos menos de O₂, pasa > 1,5 × más tiempo en tierra y sufre más
  averías.
- `locales.test.ts` barre además partidas del explorador, un guion en superficie (rechazos, `jettison`,
  aterrizaje brusco, traje a medias y una caída letal, que el bot casi nunca provoca) y otro en la terminal de estación.
- **Fase 3 en el bot:** en cada llegada a una estación vende toda la bodega, pide la ayuda de emergencia, llena el
  depósito, repone hasta 3 repuestos, repara el casco y compra mejoras (`CREW_UPGRADES` / `EXPLORER_UPGRADES`, las
  que ofrezca la estación) guardando `BOT_CREDIT_RESERVE`: primero la de más prioridad según cómo llegó (casco bajo →
  blindaje, depósito bajo → depósito y estabilizadores, reactor dañado → disipador, O₂ bajo → soporte vital, nave sana
  → motores de salto) y nunca una que deje sobrecarga a crucero. El explorador no sube lastre (lo que no rinde un
  suministro necesario y vale < 1 crédito/kg) con 60 kg o más en la bodega. `economyPolicy: false` apaga mejoras y
  lastre (lo usan la curva «una veta más» y los umbrales de superficie de la fase 2, para comparar estilos con el traje de serie). El informe añade créditos ganados/gastados, mejoras por partida,
  combinaciones distintas y ayudas de emergencia; `balance.test.ts` exige que sin minar se supere el sector 1 (>= 95 %)
  y el 3 (>= 80 %), que el explorador compre >= 2 mejoras de media y gane > 2 × los créditos del que no mina, que
  las combinaciones de mejoras varíen entre partidas y que los créditos nunca sean negativos.

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
