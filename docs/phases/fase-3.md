# Fase 3 · Economía y progresión

Pilar del plan: *economía y progresión (mejoras)*. Diseño previsto: `docs/GDD.md` § 11. No iniciada.
Punto de partida listo: fase 2 implementada (hay minerales y bodega de carga a bordo).

**Hito:** en una partida de 20 minutos el jugador vende su carga en la estación, compra al menos dos mejoras y se nota que la nave es otra; dos partidas seguidas acaban con mejoras distintas.

## Punto de partida

- La fase 2 aporta minerales reales en bodega (`ShipCargo`: cristales, menas pesadas, hielo).
- El servicio gratuito de estación de la fase 1 (`NodeKindDef.service`) pasa a ser una tienda de pago con créditos.
- Las cifras de la nave ya son datos (`catalog/naves.json`): una mejora es un cambio numérico sobre `ShipDef`.

## Alcance previsto

### Motor

- [ ] Créditos (`credits`) y carga en `RunState`; venta de minerales y muestras por créditos al atracar en la estación.
- [ ] Tienda de suministros de pago: combustible, reparación de casco y repuestos (sustituye al servicio gratuito).
- [ ] Catálogo de mejoras de nave por datos (`catalog/mejoras.json`): depósito de combustible, capacidad de escudos, disipación del reactor y tanque de oxígeno para EVA.
- [ ] Cada mejora con su coste y contrapartida (precio, consumo o masa sobre `ShipDef`).
- [ ] La masa de la carga recolectada encarece el consumo de combustible en cada salto.

### Cliente

- [ ] Modal de terminal en la estación (dos columnas: venta de cargamento y tienda/mejoras de nave) con interfaz limpia y sin exceso de texto.
- [ ] Indicador de créditos en el HUD de la nave y de la estación.

### Fuera de alcance (descartado por tiempo)

- [ ] **Mercado con fluctuaciones y oferta/demanda dinámica:** descartado; se usan precios fijos por mineral con multiplicador por sector para asegurar balance predecible y rapidez de implementación.
- [ ] **Cambio de aspecto visual 3D exterior de la nave:** descartado; las mejoras modifican directamente los atributos de `ShipDef` sin alterar la geometría de mallas 3D ni shaders.
- [ ] **Destinos lejanos bloqueados por nivel de motor (*gear-gating*):** descartado para evitar partidas bloqueadas sin salida (*soft-locks*).
- [ ] **Persistencia y árbol de progresión entre partidas (*meta-progression*):** descartado; se mantiene el permadeath puro por partida para respetar el alcance del tiempo restante.

## Riesgos

- Que la tienda vuelva a ser una pantalla de leer tablas. Máximo una línea por mejora y efecto numérico directo.
- Balance económico: el precio del combustible y reparaciones debe exigir minar sin volver la partida imposible.
