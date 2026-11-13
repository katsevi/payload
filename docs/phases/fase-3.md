# Fase 3 · Economía y progresión

Pilar del plan: *economía y progresión (mejoras)*. Diseño: `docs/GDD.md` § 11. Decisiones: ADR 0014.

**Estado:** implementada · validada con observaciones (rama `feat/f3-economia-progresion`, sin commitear).
`pnpm validate` en verde (181 + 119 = 300 tests). Las casillas las marca quien valida la fase: aquí están
marcadas las que se verificaron contra el código y los tests. **Hito pendiente de prueba con jugadores** (nadie ha
jugado los 20 minutos ni visto el terminal en un navegador con GPU real; ver `docs/STATUS.md`).

**Hito:** en una partida de 20 minutos el jugador vende su carga en la estación, compra al menos dos mejoras y se nota que la nave es otra; dos partidas seguidas acaban con mejoras distintas.

## Punto de partida

- La fase 2 aporta minerales reales en bodega (`ShipCargo`: cristales, menas pesadas, hielo).
- El servicio gratuito de estación de la fase 1 (`NodeKindDef.service`) pasa a ser una tienda de pago con créditos (queda como ayuda de emergencia gratuita, una vez por estación).
- Las cifras de la nave ya son datos (`catalog/naves.json`): una mejora es un cambio numérico sobre `ShipDef`.

## Alcance previsto

### Motor

- [x] Créditos (`credits`) y carga en `RunState`; venta de minerales y muestras por créditos al atracar en la estación (`sell`).
- [x] Tienda de suministros de pago: combustible, reparación de casco y repuestos (`buy-supply`; sustituye al servicio gratuito, que pasa a ayuda de emergencia).
- [x] Catálogo de mejoras de nave por datos (`catalog/mejoras.json`): depósito de combustible, capacidad de escudos, disipación del reactor y tanque de oxígeno para EVA.
- [x] Cada mejora con su coste y contrapartida (precio, consumo o masa sobre `ShipDef`).
- [x] La masa de la carga recolectada encarece el consumo de combustible en cada salto.

### Cliente

- [x] Modal de terminal en la estación (dos columnas: venta de cargamento y tienda/mejoras de nave) con interfaz limpia y sin exceso de texto.
- [x] Indicador de créditos en el HUD de la nave y de la estación.

### Añadido además de lo previsto

- [x] **Ayuda de emergencia** (`service` reconvertido): gratis, una vez por estación (75 % del depósito, 50 % del casco, 1 repuesto) para que llegar sin créditos ni carga no sea una muerte segura.
- [x] **Contrato por sector** (65 créditos al superar cada sector, evento `reward`) y créditos iniciales (60).
- [x] **11 mejoras** (no solo las 4 previstas): también motor de salto, blindaje del casco, traje blindado, propulsores del jetpack, mochila de carga, soporte vital y estabilizadores de motores. Oferta de 5 por estación, determinista por semilla, sector y nodo.
- [x] `run.stationQuote()` (con margen eléctrico y aviso de sobrecarga por mejora), `effectiveShip()` y `effectiveSurfaceRules()` como fuente única de cifras.
- [x] Resumen de economía en el fin de partida, «+N % por carga» en el mapa, mejoras compradas en el HUD y atajo `?play=1&seed=7&station=1`.

### Fuera de alcance (descartado por tiempo)

- [ ] **Mercado con fluctuaciones y oferta/demanda dinámica:** descartado; se usan precios fijos por mineral con multiplicador por sector para asegurar balance predecible y rapidez de implementación.
- [ ] **Cambio de aspecto visual 3D exterior de la nave:** descartado; las mejoras modifican directamente los atributos de `ShipDef` sin alterar la geometría de mallas 3D ni shaders.
- [ ] **Destinos lejanos bloqueados por nivel de motor (*gear-gating*):** descartado para evitar partidas bloqueadas sin salida (*soft-locks*).
- [ ] **Persistencia y árbol de progresión entre partidas (*meta-progression*):** descartado; se mantiene el permadeath puro por partida para respetar el alcance del tiempo restante.

## Riesgos

- Que la tienda vuelva a ser una pantalla de leer tablas. Máximo una línea por mejora y efecto numérico directo.
- Balance económico: el precio del combustible y reparaciones debe exigir minar sin volver la partida imposible. Medido con `pnpm balance`: sin minar sobran ~100 créditos y no se compra ninguna mejora; minar da 3-5. `jump-drive` casi no se compra. Pendiente de personas.
