# prototype/ — prototipos de la fase 0

Tres formas de probar los compromisos de diseño de misión antes (o a la vez) que el juego 3D. Los tres se alimentan del mismo catálogo (`packages/shared/catalog/*.json`).

| Qué | Archivo | Para qué |
| --- | --- | --- |
| CLI del motor | `proto.ts` (lo mantiene el agente del motor) | Probar diseños con el motor real en terminal |
| Hoja de cálculo | `build-sheet.ts` → `payload-prototipo.xlsx` | Explorar compromisos con fórmulas de Excel; sin código |
| Prototipo en papel | `PROTOTIPO-PAPEL.md` + `PLANTILLA-REGISTRO-PRUEBA.md` | Probar con jugadores si los compromisos son divertidos y registrar la sesión |

## CLI (`pnpm proto`)

Desde la raíz del repo:

```bash
pnpm proto
```

Usa el motor de `packages/shared` (`computeBudgets`, `reviewGoNoGo`, `runMission`...). Es la referencia: si la hoja de cálculo y la CLI difieren, manda la CLI. Opciones y uso en el propio `proto.ts`.

## Hoja de cálculo

Genera `prototype/payload-prototipo.xlsx` a partir del catálogo:

```bash
pnpm --filter @payload/shared exec tsx ../../prototype/build-sheet.ts
# opciones
#   --catalog <dir>   directorio con componentes/orbitas/lanzadores/escenarios.json
#   --design <json>   diseño a precargar (ruta o nombre en prototype/designs/; por defecto ok-cubesat-leo)
#   --out <archivo>   ruta de salida del .xlsx
```

Hojas del libro:

- **Léame**: instrucciones y simplificaciones.
- **Diseño**: se abre con un diseño de ejemplo precargado; elige escenario, órbita y lanzador (listas desplegables), escribe la cantidad de cada componente (celdas amarillas) y mira los presupuestos con formato verde / ámbar / rojo y el veredicto Go/No-Go. Todo son fórmulas reales, incluida la mecánica orbital (periodo `=2*PI()*SQRT(a^3/398600)`, eclipse `=ASIN(6371/(6371+h))/PI()`).
- **Componentes / Órbitas / Lanzadores / Escenarios**: copia del catálogo (no editar; regenerar).

Si cambias el catálogo, vuelve a ejecutar el script. El `.xlsx` es un artefacto generado: no se edita a mano.

Replica el modelo del motor: Kepler, eclipse de peor caso, contacto por estación con elevación mínima de 10° y factor 2, masa contra el menor de lanzador y estructura, presupuesto con operación, tiempo (pieza más lenta + 0,25 meses por pieza + espera del lanzador), vida por arrastre y fiabilidad con radiación, umbral "justo" del 15 %. Solo los bloqueantes de `review.ts` dan No-Go; los requisitos del escenario son avisos. **No replica** el aviso de tormenta solar, la simulación de operación, la puntuación ni los eventos.

**Verificación:** el veredicto Go/No-Go de la hoja coincide con `pnpm proto` para los 8 diseños de `prototype/designs/` (se comprobó recalculando cada `.xlsx` con LibreOffice headless, `soffice --headless --convert-to csv`, y comparando con `pnpm proto --brief`). Para repetirlo con otro diseño: `build-sheet.ts --design <json> --out <tmp>.xlsx`, convertir a CSV y leer la fila "VEREDICTO". La hoja distingue "Go" y "Go con avisos"; ambos equivalen a GO del motor.

## Prototipo en papel

`PROTOTIPO-PAPEL.md` explica cartas, tablero de órbitas, dados, hoja de presupuestos, una ronda de 15 minutos y las preguntas a observar. Imprime las cartas desde las hojas de catálogo del `.xlsx`. Para registrar cada sesión usa `PLANTILLA-REGISTRO-PRUEBA.md`. El hito de la fase 0 (*los compromisos son divertidos en papel*) **sigue pendiente de una prueba con personas reales**.
