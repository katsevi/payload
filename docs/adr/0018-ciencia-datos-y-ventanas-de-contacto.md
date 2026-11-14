# 0018 · Ciencia, datos y ventanas de contacto (fase 5)

- Estado: propuesta
- Fecha: 2026-11-14
- Contexto previo: ADR 0015 (reto NASA y roadmap), ADR 0016 (diseño de misión y sistema solar), ADR 0017 (cooperativo)

## Contexto

La fase 4 dejó los instrumentos (`scienceValue`, `dataRateMbps`), las antenas (`dataRateMbps`, `commsRangeAu`), las
computadoras (`storageGb`) y el destino (`missionTarget`) contando solo para el Go/No-Go. La fase 5 debe convertirlos
en juego: la misión produce ciencia, los datos tienen que llegar a la Tierra, la misión termina y un informe explica
por qué salió bien o mal (`docs/phases/fase-5.md` § «Decisiones que debe tomar la fase 5»). Restricciones de siempre:
`types.ts` solo aditivo, motor puro y determinista, y la partida clásica (sin diseño) idéntica.

## Decisiones

### 1. Condición de éxito y fin de la misión

- **Objetivo:** entregar en la Tierra al menos `requirements.minScience` puntos de ciencia (la misma cifra que exige
  el Go/No-Go). Al conseguirlo, evento `objective-met`; la partida sigue.
- **Fin:** la misión termina al volver a la zona de la Tierra (llegar al portal de un tramo cuya zona de llegada es la
  primera) **después de haber visitado el destino** (`missionTarget`). Entonces `phase = 'won'` con
  `science.over = true` y `next-sector` se rechaza (`reject.missionOver`). Resultado: `success` si se cumplió el
  objetivo, `partial` si no. Sin haber visitado el destino, la ruta se repite como en la fase 4.
- **Al volver**, lo que quede a bordo se descarga en la estación de la Tierra (`homeDeliversAll`). Por eso bajar datos
  en ruta no es burocracia: **solo está a salvo lo ya entregado**; si la nave se pierde, lo de a bordo se pierde.
- Se mantiene `RunPhase` sin valores nuevos (el cliente distingue el fin por `science.over`).

### 2. Modelo de datos

- Unidades **de juego**: «MB» (megabytes de juego). Conversión en el catálogo (`catalog/ciencia.json`):
  `observeMbPerMbps` (MB por segundo y por Mbps del instrumento), `storageMbPerGb`, `downlinkMbPerMbps`. Las cifras de
  los instrumentos y antenas no cambian; solo se escalan al tiempo de la partida.
- **Observar:** atracada en un nodo con `bodyId` de un cuerpo (no estación), o posada en su superficie, cada
  instrumento genera datos y ciencia mientras la navegación esté en línea (los instrumentos cuelgan de ella). Cada
  cuerpo se puede observar como mucho `observeMaxS` segundos (rendimiento decreciente: obliga a moverse). Ciencia por
  segundo = `scienceValue × tipo × lugar / observeMaxS`, con tipo = 1 si la misión lo pide y `offKindScienceMult` si
  no (como en el diseño), y lugar = `targetMult` en el destino (1), `surfaceMult` posada en él, `otherBodyMult` en
  otros cuerpos. Observar el destino entero en órbita da exactamente la ciencia del diseño.
- **Almacenamiento:** `storageGb × storageMbPerGb` de todas las computadoras. Los datos y su ciencia van juntos en un
  único búfer (la ciencia por MB es la media del búfer: simplificación aceptada). Lleno, lo nuevo se pierde
  (`lostMb`, `lostScience`) y se avisa una vez (`storage-full`).

### 3. Ventanas de contacto deterministas

- Periódicas: `contactPeriodS` y `contactWindowS`; el desfase sale de `deriveSeed(seed, CONTACT_SALT)` (no consume
  azar). Hay enlace si está dentro de la ventana, la navegación en línea y la distancia al Sol `≤ commsRangeAu` de
  alguna antena (el mismo criterio que el Go/No-Go).
- Tasa = suma de `dataRateMbps` de las antenas con alcance × `downlinkMbPerMbps` × `min(1, refAu / dTierra)^exp`, con
  `dTierra = max(refAu, |d − 1|)`. Más lejos, menos tasa; la antena de alta ganancia importa.
- En superficie no hay enlace (el cuerpo tapa la Tierra): obliga a elegir entre observar abajo y bajar datos.

### 4. Puntuación

`computeScore` suma `stats.sciencePoints` (ciencia entregada × `scorePerScience`, más `successBonus` al terminar con
éxito). Solo puntúa lo entregado. El resto de la puntuación no cambia; sin diseño el campo no existe y nada cambia.

### 5. Informe con cadena de causas

`missionReport(state, cat)` (puro) devuelve el resultado (`success` | `partial` | `lost` | `in-progress`) y como mucho
**6 eslabones** en orden causal: destino, energía de los instrumentos, almacenamiento, enlace, ciencia entregada y
supervivencia. Cada eslabón es `ok`/`bad` con un `MessageRef` de una línea y sale de contadores del estado
(`science.blockedS`, `lostMb`, `outOfRangeS`, datos a bordo al perder la nave…), nunca de suposiciones. El primero en
`bad` es la causa raíz que destaca el cliente. Explicación opcional: nunca bloquea.

### 6. Fiabilidad, calor, batería y fallo de lanzamiento (segunda entrega, implementada)

Cifras en `catalog/misiones.json` → `rules.operations` (opcional: sin él no tienen efecto). Solo con diseño.

- **Fiabilidad:** el desgaste en vuelo y en tierra × `1 + k·(1 − fiabilidad)` (k = 1,5; fiabilidad = producto de
  módulos, instrumentos y lanzador, la misma del Go/No-Go). Más averías, no muerte súbita. Sin fallo de lanzamiento
  aleatorio: perder la partida antes de jugar no enseña nada.
- **Calor:** la demanda se convierte en calor; si supera `heatRejectKw` (estructura + radiadores), el reactor pierde
  `0,001 %/s` por kW de exceso (tope `0,1 %/s`) y se avisa una vez (`overheat`). Es un desgaste lento a propósito: con
  0,03 %/s por kW las misiones largas con aviso `thermal` perdían el reactor y la nave en cadena (sobrecarga →
  apagón → casco); con 0,001 Europa y el cinturón quedan como antes y Titán (aviso `thermal`) paga algo.
- **Batería:** empieza llena (`batteryKwh` de los módulos). Con sobrecarga, el déficit sale de ella
  (`batteryKwhPerKwS` = 0,07 kWh por kW y segundo de juego) y el reactor no se daña; agotada, se avisa
  (`battery-empty`) y vuelve el daño de siempre. Con excedente se recarga al 50 %. Los `effects` de los módulos de
  batería y radiadores sobre `overloadReactorDamagePctPerS` se mantienen (amortiguan cuando ya no hay carga).

### 7. Dificultad (tercera entrega, implementada)

`misiones.json` → `rules.difficulties` (fácil, normal, difícil) y `defaultDifficultyId`. `MissionDesign.difficultyId`
(opcional; sin él, normal = todo × 1, partida idéntica). Escala el presupuesto, el plazo y la ciencia mínima de la
misión (`missionAtDifficulty`: lo usan el Go/No-Go y el objetivo de la partida) y, en vuelo, el desgaste, los peligros
por tramo y la duración de las ventanas de contacto. Se elige en el hangar, junto al destino y el lanzador (no en las
tarjetas: así se ve al momento qué presupuesto aprieta). La reserva de combustible no se escala: ya la cubre el
presupuesto de combustible del diseño.

### 8. Misión guiada de CubeSat (tercera entrega, implementada)

«Tu primer CubeSat» (`mission-cubesat-guided`, la primera de la lista): la nave tripulada, el lanzador y el destino (la
Luna) vienen fijos (`MissionDef.guided`) y el jugador solo elige la carga entre cuatro instrumentos a escala de CubeSat
(`InstrumentDef.cubesat`: 0,5-2,5 kg, decenas de vatios), que no salen en las demás misiones. No se reescalan los
módulos de la nave: la carga es el CubeSat. Cuatro pasos opcionales de una línea que se marcan solos
(`guidedProgress`: instrumento, tipo pedido, ciencia mínima, Go). El Go/No-Go bloquea si se toca la nave
(`guided-ship`) o se lleva un instrumento que no es suyo (`guided-instrument`).

### 9. Astronauta articulado (tercera entrega, implementada)

El GLB del tripulante tiene licencia compatible (CC-BY 4.0) pero **no tiene esqueleto** y sus 23 mallas van por material,
no por extremidad: articularlo exigía riggearlo en Blender. Se hizo un astronauta **procedural** (sin assets ni licencias
nuevas): cadera, rodillas, hombros, codos, tronco y cabeza como grupos anidados, posados cada frame por una función pura
(`game/astronautPose.ts`: andar, correr, reposo, salto, caída y jetpack a partir de la velocidad real). Dos niveles de
detalle: `high` para el jugador en 3ª persona y `low` (≈ la mitad de mallas y segmentos) para los compañeros del
cooperativo, que se posan con la velocidad de sus poses interpoladas. El GLB se sigue sirviendo pero ya no se carga.
**FPS sin medir en GPU real.**

## Consecuencias

- Además (entregas 3): `DifficultyDef`, `DesignRules.difficulties`/`defaultDifficultyId`, `MissionDesign.difficultyId`,
  `MissionDef.guided` (`GuidedMissionDef`, `GuidedStepCheck`), `InstrumentDef.cubesat`.
- `types.ts` crece de forma aditiva: `ScienceRules`, `ScienceState`, `MissionReport`, `ReportLink`; campos opcionales
  `Catalog.science`, `RunState.science`, `RunStats.sciencePoints`/`scienceDelivered`; eventos `observation-done`,
  `storage-full`, `contact-start`, `objective-met`, `mission-complete`, `overheat`, `battery-empty`; `DesignRules.operations`
  y en `ShipState` `batteryKwh`, `batteryMaxKwh`, `heatRejectKw`, `overheated` (solo con diseño).
- Catálogo nuevo `catalog/ciencia.json` (opcional en el JSON; `parseCatalog` pone el de serie).
- El cooperativo (fase 6) no cambia: `science` va en `RunState` y viaja con él; `hydrate` lo copia.
- El bot de balance espera en el destino a terminar de observar y el informe de balance mide misiones cumplidas.

## Alternativas descartadas

- **Mbit reales:** con tasas y almacenamiento reales, el búfer nunca se llenaría ni la antena importaría en minutos de
  juego.
- **Terminar la partida al llegar al destino:** quitaba la vuelta (la mitad de la ruta y su riesgo) y el valor de bajar
  datos antes de volver.
- **Fallo de lanzamiento aleatorio:** frustrante y sin decisión del jugador; la fiabilidad se siente como más averías.
