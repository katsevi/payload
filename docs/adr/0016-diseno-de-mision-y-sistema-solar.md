# 0016 · Diseño de misión y sistema solar en el motor (fase 4)

- Estado: aceptada
- Fecha: 2026-11-14
- Contexto previo: ADR 0015 (reto NASA y nuevo roadmap), ADR 0014 (economía y mejoras), ADR 0012 (superficie)

## Contexto

La fase 4 añade una pantalla de diseño antes de zarpar (objetivo, destino, módulos, instrumentos, lanzador; masa,
potencia, presupuesto y plazo; Go/No-Go con el porqué) y convierte la partida de las fases 1-3 en la operación de la
misión diseñada sobre el sistema solar real. El motor debía hacerlo sin romper el contrato (`types.ts` aditivo), sin
cambiar las partidas sin diseño (tests y bot de las fases 1-3 idénticos) y manteniéndose puro y determinista.

## Decisiones

### 1. Forma del diseño

`MissionDesign = { missionId, destinationId | null, moduleIds[], instrumentIds[], launcherId | null }`. Es un dato
plano y serializable (sirve para la red de la fase 6). Los ids se pueden repetir (dos tanques); `null` es «sin
elegir», porque la pantalla evalúa diseños a medias en cada cambio. El orden de las piezas no importa.

Contenido en cinco JSON nuevos, validados con zod y opcionales en el catálogo (`parseCatalog` pone los de serie):
`misiones.json` (reglas del diseño + objetivos con requisitos medibles: ciencia mínima, tipos de ciencia obligatorios,
fiabilidad recomendada, presupuesto, plazo, dificultad, destinos), `modulos.json`, `instrumentos.json`,
`lanzadores.json` (capacidad por zona de destino, coste, fiabilidad, espera) y `sistema-solar.json`.

Funciones puras y baratas: `computeDesignBudgets` (seis recursos con used/available/margin/status y una línea de
«¿por qué?») y `reviewDesign` (Go/No-Go con `blocker`/`warning` y su motivo). Los códigos de problema son estables
(`mass-launcher`, `power`, `range`…) para los fixtures y la interfaz.

Escala: la nave de la operación es una nave tripulada del juego (decenas de kW, toneladas), así que módulos e
instrumentos usan cifras «inspiradas en lo real» escaladas a ella (proporciones de CubeSat 101 y de lanzadores reales
con nombres ficticios), no valores de un CubeSat. Cuerpos del sistema solar: datos públicos de NASA (fuente en cada
entrada); estaciones ficticias.

### 2. Integración con la nave y las mejoras

`shipFromDesign(design)` devuelve una `ShipDef`: parte de la nave base del catálogo (`rules.baseShipId`: regímenes,
soporte vital, consumos de serie), pone a 0 los campos que aportan los módulos (`rules.zeroedFields`: casco, depósito,
potencia nuclear, escudos, consumo de motores y escudos) y aplica los `effects` de los módulos con los mismos campos
que las mejoras (`UPGRADE_FIELDS.ship`): por campo, `(valor + Σadd) × Πmult`. Así el contenido nuevo reutiliza la
validación de la fase 3. Dos campos opcionales nuevos en `ShipDef`:

- `solarKwAt1Au`: potencia de los paneles a 1 UA. En la partida, potencia = `(reactorOutputKw + solarKwAt1Au / d²) ×
  salud`, con `d` la distancia al Sol del nodo (interpolada en tránsito). La parte nuclear (RTG, fisión) va en
  `reactorOutputKw` y no depende de `d`.
- `dryMassKg`: masa del diseño. Encarece el combustible por año luz: `fuelPerLy × (masa / referenceMassKg)^exp`. La
  masa de la carga y de las mejoras sigue con `cargoFuelMult` como en la fase 3.

El `id` de la nave diseñada es el de la nave base, para que quien la busque en el catálogo no falle. Las mejoras de
la fase 3 se aplican encima sin cambios (`effectiveShip(shipFromDesign(d), mejoras)`); la partida lo hace sola.

`createRun({ seed, design })` (opcional, aditivo): usa la nave diseñada y el mapa del sistema solar, guarda una copia
del diseño en `state.missionDesign` y expone `state.sunDistanceAu` y `ship.solarSupplyKw`. Sin `design`, la partida no
cambia en nada (ni campos nuevos en el estado). Un diseño No-Go también se puede operar: es la forma de ver por qué
falla.

### 3. Cómo se genera el mapa

Se descartó reescribir `generateSector` o sustituir `SectorMap`: `run.ts`, el bot, la superficie y el cliente dependen
de su forma (columnas, enlaces, estación y portal). Se añadió un generador alternativo, `generateSolarSector`, que
produce la MISMA estructura:

- **Zonas** ordenadas de dentro a fuera (Tierra, Marte, cinturón, Júpiter, Saturno), cada una con su estación.
- **La ruta** es de ida y vuelta entre la Tierra y la zona del destino de la misión (`routeZones`); con la Luna, cada
  tramo es una vuelta por la zona terrestre. La potencia y el alcance del enlace del diseño se miden en el **peor punto
  de la ruta** (`routeWorstSunDistance`): el cuerpo o estación más alejado del Sol de las zonas de la ruta, que puede no
  ser el destino (Ryugu a 1,19 UA en la misión lunar, Psique a 2,92 UA en la del cinturón). Los puntos de paso se
  interpolan entre zonas y nunca lo superan; un test comprueba que ningún diseño Go se sobrecarga a crucero en ningún
  nodo de su ruta.
- **Sector = tramo:** sale de la estación de la zona de partida, pasa por todos sus cuerpos (primeras columnas), por
  puntos de paso generados (asteroides, naves abandonadas, estaciones; nombre inventado y distancia al Sol
  interpolada) con una estación forzada a mitad, y llega a la estación de la zona siguiente (nodo `gate`).
- **Distancias** en las mismas unidades del mapa (`distanceLy`): longitud del tramo = `base + k·√ΔUA`, acotada; las
  columnas salen de esa longitud. La raíz evita que Saturno sea inviable sin perder que más lejos es más largo.
- **Completable:** reintenta con semillas derivadas hasta que `isSectorSolvable` con la nave diseñada (sin mejoras),
  como `generateSector`. Flujo de azar propio (`SOLAR_SALT`); no toca los otros flujos de la partida.
- **Nodos de cuerpos reales:** `bodyId`, `sunDistanceAu` y `missionTarget` (aditivos en `SectorNode`). Como `name`
  es un texto único, lleva el español de respaldo; el nombre localizado es `catalog.<bodyId>` y los eventos usan
  `event.arrivedBody`/`event.jumpBody` con `{ body }` (i18next no anida `$t` dentro de los valores interpolados).
- **Superficie:** cada cuerpo aterrizable enlaza con un mundo existente de su mismo tipo (`worldId`); los gigantes
  gaseosos y las estaciones no son aterrizables. Si el mundo no está en el catálogo (catálogos de prueba), se elige
  uno de su tipo como en un sector abstracto.
- **Dibujo:** `bodyPositionAu` (órbitas circulares con fase inicial ficticia; lunas separadas de su planeta con una
  escala exagerada) y `solarNodePositionsAu` (los puntos de paso entre la salida y la llegada) dan posiciones en UA.

### 4. Qué queda para la fase 5

Los instrumentos ya llevan `scienceKind`, `scienceValue` y `dataRateMbps`; las antenas, `dataRateMbps` y
`commsRangeAu`; las computadoras, `storageGb`. En la fase 4 solo cuentan para los requisitos del Go/No-Go (ciencia
mínima, tipos obligatorios, alcance del enlace). La generación y bajada de datos en ventanas de contacto, la
puntuación por ciencia entregada y el informe post-misión son de la fase 5. La fiabilidad del lanzamiento solo avisa
(no hay fallo de lanzamiento en la partida).

## Consecuencias

- `types.ts` crece de forma aditiva: `MissionDesign`, `ModuleDef`, `InstrumentDef`, `LauncherDef`, `MissionDef`,
  `DesignRules`, `SolarBodyDef`, `SolarZoneDef`, `SolarSystemDef`, `DesignBudgets`, `DesignReview`, constantes
  `SCIENCE_KINDS`, `MODULE_KINDS`, `DESIGN_RESOURCE_IDS`, y campos opcionales en `ShipDef`, `SectorNode`, `SectorMap`,
  `ShipState`, `RunState`, `RunOptions` y `Catalog`. `cruisePowerMarginKw` admite la distancia al Sol (opcional).
- Cada misión del catálogo necesita su fixture (`src/__tests__/fixtures/missions/<id>.json`) con >= 2 diseños válidos
  distintos y >= 2 fallos por causas distintas; el test falla si falta.
- El cliente que reconstruya la nave efectiva desde el estado debe usar `shipFromDesign(state.missionDesign)` como
  base cuando haya diseño (el `shipId` sigue siendo el de la nave base).
- Marte, las lunas heladas de Júpiter, Titán y Encélado usan mundos propios del sistema solar (`mars-surface` con
  g = 3,7, `ice-moon`, `titan-surface`, `enceladus-surface`) con `weight: 0`: el esquema admite peso 0 y esos mundos
  solo se usan por el `worldId` de su cuerpo, nunca en el sorteo de los sectores clásicos. Otros cuerpos siguen con
  mundos genéricos de su tipo (p. ej. la Luna con la luna de polvo).
- `MissionDesign` tiene esquema zod (`missionDesignSchema`): `createRun` rechaza un diseño mal formado con un error
  claro (`parseMissionDesign`); las funciones puras de la pantalla lo normalizan a vacío (`normalizeDesign`).

## Alternativas descartadas

- **Sustituir los sectores abstractos:** rompía las fases 1-3 y sus umbrales de balance; se mantiene como modo
  clásico (partida sin diseño).
- **Distancias lineales en UA:** Saturno quedaba a 9 veces el tramo de Marte; con `√ΔUA` acotada las rutas lejanas
  son más largas y más caras sin ser imposibles.
- **Efectos de los módulos aplicados en orden (como las mejoras):** dos diseños con las mismas piezas en otro orden
  darían naves distintas; se suman/multiplican por campo.
- **`$t(catalog.<id>)` como `name` del nodo:** i18next no resuelve el anidamiento dentro de valores interpolados
  (`skipOnVariables`), así que se emiten claves propias con el id del cuerpo.
