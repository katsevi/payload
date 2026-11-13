# 0013 · Minijuegos en el cliente y minería con herramientas desplegables

- Estado: aceptada
- Fecha: 2026-11-12

## Contexto

Con la fase 2 casi todo se hacía con E (a menudo manteniéndola): arreglar, evadir, recoger. El usuario pidió
que no todas las interacciones sean con E por repetitivas, y que minar se parezca a minar de verdad (sin pico).
La mejora no pertenece a ninguna fase del plan (`docs/plan/`).

## Decisión

1. **Los minijuegos son del cliente y su resultado entra al motor como `RunAction` acotada**, con el mismo patrón
   de autoridad dividida del ADR 0012. La esquiva envía `evade {grazes}` (roces, recortados a 0..`maxGrazes`) y el
   motor decide el daño con `catalog/averias.json` (`hazards.impact.evade`). Las reparaciones se traducen a
   `work-incident {seconds}` (más trabajo si se hace bien, menos si se hace mal, nunca bloquea): el motor de
   las averías no cambia.
2. **La extracción la hace el motor a paso fijo, con las herramientas como estado** (`surface.tools`,
   `crew[].tools`): concentrador solar (hielo; se para con tormenta) y taladro láser (mena, cristal, muestra).
   Se colocan con una pulsación, extraen solas, se recoge lo listo y se pueden retirar. Lo que queda fuera
   cuando no queda nadie vivo fuera se pierde; se reponen en cada aterrizaje.
3. **`collect` cambia de significado de forma aditiva:** ahora recoge lo ya extraído; su campo `seconds` queda
   opcional e ignorado. Se añaden `deploy-tool` y `retrieve-tool`, el campo opcional `grazes` de `evade` y eventos
   `tool-*`; se retira la clave de mensaje `event.collected`. No rompe consumidores.
4. **Reparto de teclas:** E usar, abrir, colocar o recoger; Q alternativa (régimen, soltar carga, retirar
   herramienta); clic o Espacio para la habilidad; R reparar con repuesto; WASD para pilotar en la esquiva. El
   ajuste de accesibilidad «interacciones simples» sustituye los minijuegos por mantener una tecla.
5. **No pertenece a ninguna fase del plan:** es una mejora de la fase 2 hecha en
   `feat/f2-herramientas-e-interacciones`.

## Consecuencias

- El servidor de la fase 4 verá resultados de minijuegos como acciones acotadas; el límite de roces y de trabajo
  por acción es el único control, igual que con la posición (ADR 0012).
- Las herramientas añaden estado a la partida y puntos de pérdida (salir sin retirarlas), que el bot de balance simula.
- Las cifras viven en `catalog/mundos.json` (`surface.tools`) y `catalog/averias.json` (`impact.evade`).
- Los minijuegos no se han jugado con teclado y ratón reales; su dificultad es provisional.
