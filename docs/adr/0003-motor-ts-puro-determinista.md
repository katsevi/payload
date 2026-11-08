# 0003 · Motor de simulación TypeScript puro, compartido y determinista

- Estado: aceptada
- Fecha: 2026-11-07

## Contexto
La simulación debe correr en el navegador (modo solitario) y, en la fase 3, en el servidor autoritativo. Debe permitir comparar diseños de forma justa y ser testeable sin gráficos.

## Decisión
El motor vive en `packages/shared` como **TypeScript puro**: sin React, Three.js, DOM ni APIs de Node en `src/`. Es **determinista**: toda aleatoriedad pasa por `createRng(seed)`; prohibidos `Math.random()` y `Date.now()`. La simulación avanza con paso fijo interno, de modo que el resultado no depende de cómo se trocee el avance. El contrato público es `src/types.ts` (cambios solo aditivos).

## Consecuencias
- Mismo resultado en cliente y servidor; los clientes multijugador solo envían acciones.
- Tests unitarios rápidos con valores de referencia (p. ej. periodo LEO ≈ 92.6 min).
- La misma misión con la misma semilla es reproducible (rankings, comparación).
- El motor no puede usar relojes ni E/S; el tiempo lo aporta quien lo llama.
- El motor devuelve `MessageRef`, no texto (ADR 0005).
