# 0008 · Eventos aleatorios por dificultad, penalización de agotamientos y fase de Kepler

- Estado: sustituida por 0011 (el motor al que se refiere ya no existe)
- Fecha: 2026-11-08

## Contexto
La fase 2 pide eventos aleatorios ponderados por dificultad (sobrecalentamiento, falla de componente,
retraso de lanzamiento, recorte de presupuesto) además de los tres de la fase 1, siempre deterministas
con `createRng(seed)`. `docs/STATUS.md` dejaba dos decisiones abiertas: `warn-power-storm` puntuaba
~91,7 terminando con la batería al 0 % (un aviso que no se notaba en la nota) y la fase orbital era
uniforme también en órbitas elípticas (HEO). Las semillas documentadas de la fase 1 (`warn-power-storm`
falla con `defaultSeed+1`, `+4` y `+7`) no debían cambiar.

## Decisión
1. **Tres familias de eventos, cada una con su flujo de azar** (`deriveSeed(seed, sal)`), todas
   pre-sorteadas al crear la simulación (el troceo de `step()` no influye):
   - *Entorno* (tormenta solar, basura espacial, falla de rueda): mismo flujo y tiradas que la fase 1.
   - *Salud de la nave* (dependen del diseño): sobrecalentamiento con `p = base · F`,
     `F = clamp((15 % − margen térmico)/15 %, 0, 2)`; falla de componente con
     `p = 1 − R_eff^(A/(5·365))`, `R_eff = Π r_i^(1+2·radiación)`, y la pieza que falla elegida con
     peso `1 − r_i^(1+2·radiación)`. `A` es una aceleración de juego por dificultad.
   - *Pre-operación* (retraso y recorte): función pura `rollPreLaunchEvents(design, cat, seed)` que el
     cliente llama tras el Go; su resultado entra en `MissionSimOptions.preLaunch` y en
     `computeBudgets(design, cat, preLaunch)`.
2. **Tabla por dificultad** `EVENT_TABLES` (constants.ts) con un ajuste opcional por escenario
   (`ScenarioDef.eventTuning`).
3. **Las fallas genéricas degradan, no destruyen**: instrumento perdido; radio, computadora o ADCS
   pasan a la otra unidad o a un modo degradado; paneles, batería o térmico se aíslan con 6 h de modo
   seguro. Así se conserva la garantía de la fase 1: un diseño Go sin aviso `power-storm` no se pierde
   en operación (solo puede fallar el lanzamiento).
4. **Sobrecostes por eventos pre-operación**: un recurso duro (`time`, `budget`) que pasa a excedido
   *solo* por el evento no anula la viabilidad (el diseño pasó el Go); añade el criterio de objetivos
   `overrun-<recurso> = disponible/usado` y la penalización normal de eficiencia.
5. **Agotamientos de batería en la puntuación** (decisión abierta a): en misiones completadas se añade
   el criterio `energía = clamp(1 − 0,15·agotamientos) · clamp((capacidad final % − 60)/40)`.
   `power-storm` sigue siendo un aviso del Go/No-Go, no un blocker. Con la semilla por defecto
   `warn-power-storm` baja de 91,7 a 63,2 (objetivos 100 → 29), por debajo de las tres soluciones válidas.
6. **Fase de Kepler** (decisión abierta b): `SimSnapshot.orbitPhase` es la anomalía verdadera / 2π
   (M → E por Newton-Raphson → ν). El tiempo de la simulación (eclipse, contactos, energía) sigue en
   anomalía media, así que los presupuestos no cambian; se añaden `meanPhase` y `altitudeKm` (opcionales).

7. **Revisión de balance (content-designer, mismo día):**
   - *Falla de rueda con star tracker:* el apuntado de respaldo depende de los ADCS sanos
     (`wheelBackupPointingDeg`): star tracker (≤ 0,1°) + magnetopares → **1°** (la actitud se conoce con
     precisión y los magnetopares la corrigen); star tracker solo → **2°**; sin star tracker → **5°**.
     Nunca mejora el apuntado previo.
   - *Vida útil más dura:* criterio `vida = clamp((estimada/exigida − 0,75)/0,25)` (0 al 75 %, 1 al
     100 %) en vez de `estimada/exigida`. 3,6 de 4 años vale 0,6 (objetivos < 80, antes ~93).
     Los 9 diseños de ejemplo y los fixtures de los 6 escenarios no cambian de puntuación/veredicto.

## Consecuencias
- Las semillas y resultados de la fase 1 se mantienen (tests de balance sin cambios), salvo efectos de
  los eventos de salud en diseños con margen térmico justo (`warn-power-storm`, `ok-microsat-leo-thermal`).
- Cambios en `types.ts` solo aditivos: `SimEventType` (`overheating`, `launch-delay`, `budget-cut`),
  `EventTable`, `ScenarioEventTuning`, `PreLaunchOutcome`, campos opcionales en `ScenarioDef`,
  `MissionSimOptions`, `MissionResult` y `SimSnapshot`.
- El cliente debe: llamar a `rollPreLaunchEvents` tras el Go y pasar el resultado a la simulación;
  colocar la nave con `orbitPhase` como ángulo desde el perigeo (en circulares no cambia nada).
- La aceleración `A` y las probabilidades son de juego, no realistas; el content-designer las ajusta
  con `eventTuning` sin tocar código.
