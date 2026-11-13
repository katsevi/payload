# 0014 · Economía y mejoras: créditos, terminal de estación de pago y nave efectiva

- Estado: aceptada (motor); cifras provisionales hasta el balance del content-designer y la prueba con personas
- Fecha: 2026-11-13

## Contexto

La fase 3 (`docs/phases/fase-3.md`, GDD § 11) convierte la carga de la bodega en progreso: las estaciones compran
minerales y venden suministros y mejoras, y el servicio gratuito de la fase 1 (`NodeKindDef.service`) desaparece.
Había que decidir qué pasa con el hielo y la mena (que ya rinden combustible y repuestos al guardarlos), cómo evitar
partidas sin salida al llegar a una estación sin créditos, cómo afecta la economía a la puntuación y cómo aplicar
las mejoras sin romper el contrato (`types.ts`, solo cambios aditivos).

## Decisión

1. **Créditos enteros en `RunState.credits`**, con `economy.startCredits` al empezar. Se ganan vendiendo carga y
   con el **contrato del sector** (`sectorRewardCredits` al superar cada sector, evento `reward`); se gastan en
   suministros y mejoras. `stats.creditsEarned/creditsSpent/unitsSold/upgradesBought` (opcionales) los resumen.
2. **Precios fijos por material y suministro con multiplicador por sector** (`catalog/economia.json`):
   `precio × (1 + porSector × (sector − 1))`, uno para vender (y el contrato) y otro para comprar. Sin mercado
   dinámico (fuera de alcance). Lo que no tiene precio en `sellPrices` no se vende.
3. **Hielo y mena se siguen procesando al guardarse** si caben (hielo → combustible, mena → repuestos); lo que no
   cabe va a la bodega y **se vende barato** (1 y 4 créditos por unidad frente a 14 y 24 de cristales y muestras).
   Así la mena deja de ser relleno (vale créditos con los repuestos llenos) sin quitar el colchón de supervivencia
   que el hielo da en los asteroides. Todo lo de la bodega pesa (punto 6), así que subir mena con los repuestos
   llenos es una decisión: unos créditos frente a combustible en cada salto.
4. **Terminal de estación** en los tipos con `shop: true` (o con el antiguo `service`, que pasa a obsoleto y
   solo marca la estación). Acciones nuevas, todas atracada en una estación (`reject.notAtStation`):
   `sell {materialId?, units?}` (una unidad, todo un material o toda la bodega), `buy-supply {supply, amount?}`
   (combustible, casco o repuestos; compra lo que quepa y se pueda pagar) y `buy-upgrade {upgradeId}`.
5. **Mínimo anti-callejón: la acción `service` pasa a ser la ayuda de emergencia**, gratis y una vez por estación:
   sube el combustible a `emergency.fuelPct` % del depósito, el casco a `hullPct` % y los repuestos a `minSpares`.
   Llegar sin créditos ni carga no es una muerte segura; llegar con ellos permite irse con el depósito lleno, el
   casco entero y mejoras. La varada en una estación cuenta la emergencia, los créditos y la venta de la bodega.
6. **La masa a bordo encarece cada salto:** combustible × (1 + (bodega + mejoras) kg / `cargoFuel.massRefKg`),
   en el consumo real y en `estimateJump` (`cargoKg`, `cargoFuelMult`; `ship.cargoKg` en el estado).
7. **Mejoras por datos** (`catalog/mejoras.json`): niveles con precio, masa y efectos numéricos (`mult` y luego
   `add`) sobre campos permitidos (`UPGRADE_FIELDS`) de la nave (`ShipDef`, incluido `systemDrawKw.<sistema>`) o de
   las reglas del traje, el jetpack y las caídas. Cada nivel tiene contrapartida: precio y masa, consumo eléctrico
   o más O₂ (validado por test). La nave y las reglas efectivas se calculan con funciones puras
   (`effectiveShip`, `effectiveSurfaceRules`) y el motor solo usa las efectivas. `RunState.upgrades` guarda el nivel
   de cada una. Un depósito o casco mayor no se llena solo.
8. **Oferta por estación determinista y variada:** cada estación ofrece `offer.size` mejoras elegidas con un flujo
   propio (`deriveSeed(seed, sal + sector)` y el índice del nodo), sin tocar los demás flujos de azar. Dos partidas
   acaban con mejoras distintas (hito de la fase).
9. **Puntuación: lo descubierto puntúa una vez, al guardarlo en la bodega** (`stats.materialsValue`, como en la
   fase 2). Vender no suma ni resta puntos y los créditos y las mejoras no puntúan: son el medio para llegar más
   lejos, que es lo que más puntúa (1000 por sector). Así nada puntúa dos veces y el explorador que gasta en
   mejoras no pierde puntos frente al que acumula créditos.
10. **El sector se sigue generando con la nave base** (`generateSector` comprueba que sea completable repostando
   en estaciones): las mejoras no cambian el mapa.

## Consecuencias

- Contrato: todo es aditivo (`credits`, `upgrades`, `shop`, `economy`, `upgrades` del catálogo, acciones, eventos
  `sale`/`purchase`/`upgrade`/`reward`, subtipos `fuel`/`hull`/`spares`, `Run.stationQuote`, `effectiveShip` y
  `effectiveSurfaceRules`). `service` cambia de significado (de servicio completo a ayuda de emergencia) sin cambiar
  de forma, como `collect` en el ADR 0013; `NodeKindDef.service` queda obsoleto.
- `RunState.credits` y `RunState.upgrades` son **obligatorios** (no opcionales): es aditivo para quien lee el estado,
  pero quien construya un `RunState` a mano (fixtures, red) debe incluirlos. Los campos nuevos de `RunStats`,
  `ShipState.cargoKg` y `JumpEstimate` sí son opcionales.
- `isSectorSolvable` (generación del sector) sigue suponiendo **repostaje completo en cada estación**. Hoy eso exige
  la ayuda de emergencia (75 % gratis) más pagar el resto; un sector «completable» puede no serlo para quien llegue
  sin créditos ni carga y con mucha masa a bordo. Si el bot o las personas se quedan varados por esto, la generación
  deberá contar solo con lo gratuito.
- `stationQuote().upgrades[]` trae `powerMarginDeltaKw` y `overloadsAtCruise` (margen eléctrico a crucero con todo
  encendido, `cruisePowerMarginKw`): con todas las mejoras al máximo no cabe todo encendido a la vez (hay que apagar
  escudos o navegación), y está aceptado por diseño siempre que motores + soporte vital + uno de los dos quepan
  (test en `economy.test.ts`).
- `parseCatalog` rellena `economy` y `upgrades` con los de por defecto si faltan: los catálogos antiguos siguen
  siendo válidos.
- El cliente necesita un terminal de estación (venta | tienda y mejoras) y el indicador de créditos; mientras no
  exista, el botón del mapa ofrece la ayuda de emergencia.
- El servidor de la fase 4 verá el comercio como acciones acotadas: el motor valida estación, créditos y oferta.
- Balance inicial (bot, `pnpm balance`): sin minar se supera el sector 3 casi como antes (la emergencia y el
  contrato cubren lo básico); minar da los créditos para comprar 4-5 mejoras en tres sectores. Las cifras son
  provisionales: las afina el content-designer y se validan con personas.
