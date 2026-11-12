# 0012 · Superficie: autoridad dividida, oxígeno como único recurso que no vuelve y recompensa sin economía

- Estado: aceptada
- Fecha: 2026-11-12

## Contexto

La fase 2 añade bajar a la superficie con jetpack y oxígeno personal. El terreno, la física y los
colisionadores viven en el cliente (Rapier); el motor (`packages/shared`) debe seguir siendo TS puro,
determinista y reutilizable por el servidor de la fase 4. Además, la economía (fase 3) aún no existe, así
que hay que decidir qué se gana al recoger materiales y cómo se evita que la superficie sea «la nave con otro
fondo».

## Decisión

1. **Autoridad dividida.** El cliente simula terreno, física y posición y las informa como `RunAction`
   (`set-position`, `jetpack`, `fall-impact`). El motor es autoritativo en recursos y consecuencias: oxígeno,
   jetpack, carga, tormentas, terreno inestable, daño y muerte. Como antitrampas, `set-position` acumula como
   mucho `maxMoveSpeedMps × 1 s` de movimiento, pensado para que el servidor de la fase 4 no crea posiciones imposibles.
2. **El oxígeno es el único recurso que no se recupera fuera de la nave.** El jetpack recarga despacio en el
   suelo. Las caídas y las tormentas se cobran en oxígeno. Salir cuesta oxígeno de la nave (rellenar el traje).
3. **Recompensa sin economía.** Los materiales comunes (hielo, mena) rinden suministros (combustible,
   repuestos) al guardarlos en la nave; los raros (cristales, muestras) dan puntuación y quedan en la bodega
   (`ship.cargo`) para venderse en la fase 3.
4. **La nave sigue viva durante la salida**, con desgaste reducido por mundo (`shipWearMult`): averías,
   oxígeno y sobrecarga siguen corriendo.
5. **Un aterrizaje por nodo** (`landedIds`), para que la superficie no sea una fuente infinita de recursos.
6. **El mecha Aurora G9 no se usa en esta fase.** El GDD lo preveía como vehículo; queda aplazado.

## Consecuencias

- El motor no necesita terreno ni colisiones y sigue corriendo igual en el servidor; a cambio, la posición es
  información del cliente y el antitrampas es solo un límite de velocidad. Una verificación más fuerte
  (p. ej. el servidor simulando el suelo) queda para la fase 4 si hace falta.
- Todo el contrato nuevo es aditivo (`RunPhase` `landing`/`surface`, `LossReason` `crew`, `CrewMember`,
  `SurfaceState`, `RunAction` y `RunEvent` nuevos, `Catalog.surface`); no rompe consumidores.
- `catalog/mundos.json` concentra las cifras de superficie y se ajusta con `pnpm balance`.
- La fase 3 debe decidir qué precio tienen cristales y muestras; hasta entonces solo suman puntuación.
- Los eventos de superficie llevan `subtype` explícito; el cliente aún distingue algunos por `tone`
  (pendiente en `docs/STATUS.md`).
