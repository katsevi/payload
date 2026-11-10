# Fase 3 · Economía y progresión

Pilar del plan: *economía y progresión (mejoras)*. Diseño previsto: `docs/GDD.md` § 11. No iniciada.
Requiere la fase 2 (sin superficie no hay nada que vender).

**Hito:** en una partida de 20 minutos el jugador compra al menos dos mejoras y se nota que la nave es
otra; dos partidas seguidas acaban con mejoras distintas.

## Punto de partida

- El servicio de estación de la fase 1 (`NodeKindDef.service`: repostar, +casco, +repuestos, gratis y una vez) es el sustituto provisional de la tienda.
- Las cifras de la nave ya son datos (`catalog/naves.json`): una mejora es un cambio sobre `ShipDef`.

## Alcance previsto

### Motor

- [ ] Créditos y carga a bordo; la masa de la carga encarece cada salto.
- [ ] Mercado por estación: precios de venta de minerales y muestras, con variación por sector.
- [ ] Tienda: combustible, reparación de casco, repuestos (sustituye al servicio gratuito).
- [ ] Mejoras de nave por datos (`catalog/mejoras.json`): depósito, escudos, motores de salto, reactor.
- [ ] Mejoras de equipo personal: traje, tanque de oxígeno, jetpack.
- [ ] Cada mejora con su coste oculto (masa, consumo eléctrico, precio): no hay mejoras gratis.
- [ ] Destinos lejanos que exigen mejores motores.

### Cliente

- [ ] Terminal de estación (vender, comprar, mejorar) con poca letra y comparación antes/después.
- [ ] La nave cambia de aspecto con las mejoras.

## Riesgos

- Que la tienda vuelva a ser una pantalla de leer tablas. Máximo una línea por mejora y efecto visible.
- Balance: con permadeath, el progreso se pierde entero; hay que decidir si algo persiste entre partidas.
