# Estado del proyecto — traspaso entre sesiones

Última actualización: **2026-11-13** · Rama actual: `feat/f3-economia-progresion` (cambios sin commitear) · Versión publicada: 0.4.0 · Propuesta: 0.6.0 (sin publicar; la 0.5.0 propuesta es la fase 2; ver `CHANGELOG.md`)

> Léelo antes de empezar y actualízalo al terminar una tarea relevante. Las casillas de
> `docs/phases/fase-*.md` las marca quien valida la fase, no quien implementa: aquí solo se resume.

## Lo más importante

**Payload es un cooperativo de supervivencia en una nave** (plan en `docs/plan/plan-tripulacion-de-exploracion.md`,
decisión en ADR 0011). El juego se rehízo el 2026-11-09.

- La **fase 1 está fusionada en `main`** (PR #3), y la fase 2 con las herramientas de minería y los minijuegos
  (ADR 0013) entró por el PR #4 (`feat/f2-herramientas-e-interacciones`). La **fase 3 (economía y progresión)**
  está **implementada pero sin commitear** en **`feat/f3-economia-progresion`** (ADR 0014).
- No existe ninguna etiqueta local `v0.3.0-simulador` (`git tag` está vacío): la versión anterior (0.3.0) está en
  el historial, en el commit `76ae5ab` (ADR 0011). Su documentación está en `docs/archivo/v0.3-simulador/`.
- **Fase 2 (exploración de superficie): implementada.** Pendiente de validación independiente final y de prueba
  con jugadores. Nadie ha medido FPS en GPU real, escuchado el audio ni jugado con personas (ver acciones humanas).
- Decisiones de la fase: `docs/adr/0012-superficie-autoridad-dividida.md`; de la mejora: `docs/adr/0013-minijuegos-y-herramientas.md`.
- **Fase 3 (economía y progresión): implementada · validada con observaciones · hito pendiente de prueba con jugadores.**
  Créditos, terminal de estación de pago (venta, suministros, 11 mejoras con contrapartida), ayuda de emergencia
  gratuita (sustituye al servicio gratuito) y la masa a bordo encarece cada salto. `pnpm validate` 11/11, **300 tests**
  (181 + 119). Nadie ha jugado 20 minutos para comprobar el hito ni ha visto el terminal con GPU real. Decisiones: ADR 0014.
- **Siguiente: fase 4 (cooperativo 1-4).** Toda la economía entra como `RunAction` y es determinista (ver «Próximos pasos»).

## Estado por fase

| Fase | Estado |
| --- | --- |
| 1 · Viaje y nave (en solitario) | **Implementada y fusionada en `main`** (PR #3). `pnpm validate` en verde y recorrido manual en Chrome. **Falta:** validación independiente (agente `validator`) y el hito con jugadores. |
| 2 · Exploración de superficie | **Implementada** (commit `d8ce24d` en `feat/f2-superficie`; mejoras sin commitear en `feat/f2-herramientas-e-interacciones`). `pnpm validate` en verde y una pasada del `validator` sin bloqueantes. **Falta:** validación independiente final, la segunda revisión de diseño y el hito con jugadores. |
| 3 · Economía y progresión | **Implementada · validada con observaciones** (rama `feat/f3-economia-progresion`, sin commitear). `pnpm validate` en verde (300 tests) y validación independiente «cumple con observaciones» (sin exploits de dinero ni soft-locks). **Falta:** el hito con jugadores (20 min: vender, >= 2 mejoras, la nave se siente otra), ver el terminal y los créditos en un navegador con GPU real y escuchar los cues. |
| 4 · Cooperativo 1-4 | No iniciada. `apps/game-server` es un marcador. |
| 5 · Pulido y lanzamiento | No iniciada. `apps/api` es un marcador. |

### Fase 1 — qué se hizo

**Motor (`packages/shared`, contrato nuevo):**
- `types.ts` reescrito (ADR 0011) y catálogo nuevo: `naves.json` (nave Colibrí), `averias.json`, `destinos.json` (7 tipos) y `sectores.json`.
- `galaxy.ts`: `generateSector` determinista con ruta completable garantizada (`isSectorSolvable`).
- `run.ts`: `createRun` con paso fijo de 0,1 s; viaje por régimen, energía y sobrecarga, fuego/corto/fuga, impactos con aviso y maniobra evasiva, repuestos, estaciones, contenedores, portal y sectores crecientes, permadeath (casco, oxígeno, varada), puntuación.
- Mensajes en `locales/{es,en}.json` (todos de una línea). Tripulante simulado para balance (`src/__tests__/bot.ts`, `pnpm balance`).

**Cliente (`apps/client`):**
- `game/`: `layout` (ocho puestos en tres zonas), `interaction` (qué hace E/Q en cada puesto), `runStore` (la partida, avisos, mejor marca).
- `scenes/`: `ShipScene` (bucle y teclas), `ShipInterior` (casco), `ShipStations` (puestos), `ShipFx` (alarmas, fuego, chispas, gas, carteles), `SpaceView` y `SpaceBodies` (estelas del salto y el destino por la proa), `MenuScene`.
- `ui/`: `Hud`, `StarMap`, `PowerPanel`, `Screens` (menú, ajustes, créditos, ayuda, pausa, fin de partida).
- Audio procedural adaptado: efectos por evento del motor y música según el peligro.

**Rediseño gráfico (2026-11-10, solo `apps/client`; sin cambios de reglas, de distribución ni de colisiones):**
- `gfx/` nuevo: texturas procedurales de canvas (paneles, cubierta, metal, roca, halos), materiales
  compartidos (`mats()`), `Builder` (modela por piezas y fusiona una malla por material), ruido GLSL y shaders.
- **Casco:** cubierta con chapa antideslizante y pasillo central, cuadernas que siguen como vigas del techo,
  molduras, conductos, cristales, mirador de proa de tres caras, marcos de puerta con franja de aviso y
  sombras de contacto pintadas en el suelo. Reflejos por un `Environment` que se rinde una vez.
- **Puestos (los ocho de siempre, remodelados):** reactor con columna de plasma, bobinas y pilares; motores
  con palas que giran según el empuje; soporte vital con biorreactor y botellas; generador de escudos con
  campo y aros; sensores con radar y antena; panel con palancas, pilotos y medidor de carga; mesa del mapa
  con proyector; timón con arco holográfico. Cada uno muestra el estado del motor sin texto.
- **Efectos:** llamas, pavesas, humo, chispas, arcos y chorro de gas calculados en la GPU; luminarias por zona.
- **Exterior:** cielo de nebulosas horneado a un cubemap (distinto por sector), estrella cercana, planetas
  procedurales (cinco tipos de superficie, atmósfera, anillos), luna con cráteres, campo de asteroides
  instanciado, nebulosa, pecio con baliza y portal con vórtice. El destino aparece lejos al final del salto y
  frena hasta su sitio (antes aparecía de golpe al llegar).
- **No se añadió ningún objeto nuevo** ni dependencia: mismos puestos, mismos tipos de destino, mismos GLB.

**Reutilizado de la versión anterior:** `rng.ts`, infraestructura de `MessageRef` e i18n, patrón de catálogo con zod, `PlayerController` (1ª/3ª persona con Rapier), `Models.tsx` y los cinco GLB, `AudioEngine` y `cue()`, ajustes, créditos, estilos.

**Retirado:** motor de diseño de misiones (presupuestos, Go/No-Go, simulación orbital, puntuación, informe, asesores, pedagogía, equipo), su catálogo (43 componentes, escenarios, glosario, mascota Orbi, Academia), `prototype/`, el cliente antiguo (hangar, lanzamiento, órbita, sala) y el servidor Colyseus. Dependencias quitadas: `xstate`, `@xstate/react`, `@colyseus/*`, `@react-three/postprocessing`, `exceljs`.

### Fase 2 — qué se hizo (2026-11-12, commit `d8ce24d` en `feat/f2-superficie`)

Ciclo nuevo: atracada en un destino aterrizable → descenso (minijuego de frenado) → salida por la esclusa →
recoger materiales (hoy con herramientas, ver más abajo) con jetpack y oxígeno limitado → volver → despegar. Un aterrizaje por nodo. Decisiones en ADR 0012.

**Motor (`packages/shared`; contrato aditivo, ver `packages/shared/CLAUDE.md`):**
- `types.ts`: `RunPhase` gana `landing` y `surface`; `LossReason` gana `crew`; tipos de superficie (`WorldDef`,
  `MaterialDef`, `SurfaceRules`, `CrewMember`, `SurfaceState`, `Deposit`, `UnstableZone`, estimaciones de
  aterrizaje y despegue); acciones `land`, `set-descent-brake`, `eva-exit`, `eva-enter`, `set-position`, `jetpack`,
  `fall-impact`, `collect`, `jettison`, `take-off`; `RunEvent.subtype` explícito (`landing`, `suit-o2`, `airlock`,
  `crew-dead`, `cargo-stored`).
- Catálogo nuevo `catalog/mundos.json` (zod; opcional, con valores por defecto): 7 mundos (roca errante, núcleo
  de hielo, luna de polvo, luna volcánica, mundo de tormentas, mundo fracturado, mundo pesado), 4 materiales
  (hielo, mena, cristales, muestra científica) y reglas de descenso, despegue, traje, jetpack, caídas, terreno y racha.
- `surface.ts` (módulo nuevo): mundo por nodo, `generateSurface`, física del descenso, perfil de frenado de
  referencia, combustible de despegue, racha y relleno del traje. `run.ts` crece (~500 líneas): descenso, EVA,
  oxígeno del traje, jetpack, caídas, tormentas pre-sorteadas, terreno inestable, recogida por mantener, bodega,
  `jettison`, despegue y varada; la nave sigue viva en tierra (`shipWearMult`).
- Correcciones tras la revisión de diseño (tres pasadas; ver «Revisión de diseño»): salir cuesta O₂ de la nave (ciclo de
  esclusa y relleno del traje; en tierra la nave apenas regenera O₂), racha solo con lo raro (cristales y muestras),
  hielo solo en asteroides, descenso con margen propio por mundo, vetas de zona inestable no alcanzables desde suelo firme, terreno inestable que no se reinicia al saltar, `collect` exige
  suelo, jetpack con techo de ascenso por gravedad, ventana de frenado del descenso ampliada, tormentas más duras con
  retardo inicial (`firstStartMinS`), mundos mayores y recogida más rápida, `land` exige combustible para bajar y
  despegar y motores en línea.
- Bot de balance con `explore: 'prudent' | 'greedy'` y curva «margen de O₂ → valor y muertes» en `pnpm balance`.

**Cliente (`apps/client`; detalle en `apps/client/CLAUDE.md`):**
- Timón: mantener E en un destino aterrizable inicia el descenso (mundo, gravedad y combustible en una línea); en
  tierra, mantener E despega y Q suelta la carga si pesa demasiado. Mapa: mundo y gravedad de cada aterrizable.
- Descenso con vista exterior (`SurfaceScene mode="descent"`): Espacio/E frena; HUD de altitud, velocidad con zona
  segura y marca de «frena» (`referenceBrake`), combustible; llamas, polvo, sacudida y sonido según el golpe.
- Esclusa (noveno puesto) y bodega visible (cajas por unidad de `ship.cargo`); por las ventanas se ve la superficie.
- EVA (`SurfaceScene mode="eva"`): terreno determinista (`game/terrain.ts`, abismos con pasos, hoyos al ceder), siete
  paletas, rocas instanciadas, vetas con forma propia (las raras brillan), grietas que se encienden al crujir,
  tormentas con aviso, jetpack (`game/motion.ts`: Espacio sube o frena, C baja), baliza de la nave, brújula, O₂ que
  se ve y se oye. Ajustes de accesibilidad: efectos 0-1 y recoger con una pulsación.
- Atajos: `?play=1&seed=7&surface=1|descent|landed` y `__payload.toSurface()`.

**Reutilizado:** `PlayerController` (parametrizado en gravedad y jetpack), audio procedural y `cue()`, `gfx/`.
**No se usa:** el mecha Aurora G9 (aplazado, ADR 0012).

### Mejora fuera del plan: herramientas e interacciones (2026-11-12, rama `feat/f2-herramientas-e-interacciones`, sin commitear)

A petición del usuario («no todas las interacciones deben ser con E, es muy repetitivo»; minar «como se haría de
verdad, sin pico»). No pertenece a ninguna fase del plan. Decisiones: ADR 0013. Reglas completas en
`packages/shared/CLAUDE.md` y `apps/client/CLAUDE.md`.

**Motor (`packages/shared`; contrato aditivo):**
- **Herramientas de minería** (`surface.tools` en `mundos.json`, `material.tool`): concentrador solar (hielo; se
  para con tormenta) y taladro láser (mena, cristal, muestra). Acciones `deploy-tool`, `collect` (**ahora recoge lo
  ya extraído**; `seconds` opcional e ignorado) y `retrieve-tool`; estado `surface.tools` y `crew[].tools`;
  eventos `tool-*`. La extracción corre a paso fijo (4/5/5/6 s por unidad: hielo, mena, cristal, muestra). Lo que
  queda fuera cuando no queda nadie vivo fuera se pierde; se reponen al aterrizar. Mochila de 110 kg.
  El hielo también aparece, escaso y lejos de la nave, en la luna volcánica y el mundo de tormentas.
- **Filones:** lo raro (cristal, muestra) fuera de zonas inestables se agrupa en filones de 2-3 vetas a 8-15 m
  (`rules.lodes`, `Deposit.lodeId`), para que una herramienta y un paseo corto rindan más que ir de veta en veta.
  **Bonus por completar un filón** en la misma salida: la última veta vale ×1,5 sobre la racha
  (`lodes.completeMult`, `lodeProgress`, `CrewMember.lodeVeinsDone`, subtipo `lode`).
- **Esquiva por habilidad** (`averias.json`, `hazards.impact.evade`): el aviso trae `etaS`, `evadeSeed` y
  `evadeDifficulty`; `evade {grazes}` (0..4 roces; 20 % del daño por roce; 4 = fallo, 90 %). Eventos `impact-evaded`
  y `impact-hit` con subtipo. Sin `grazes`, igual que antes.
- Se retira la clave de mensaje `event.collected`. Bot de balance: coloca y retira herramientas, mide el tiempo
  quieto por salida y simula los minijuegos con perfiles de habilidad (`shipSkill`: medio, simple, torpe), con
  umbral en `balance.test.ts`.

**Cliente (`apps/client`):**
- Esquiva en el holograma del timón (`game/dodge.ts`, `DodgeHolo`, WASD) de **duración fija (3 s)**; se juega si
  quedan >= 3,4 s al llegar, si no se aplica un resultado tardío (más suave al principio, con roces, nunca limpio).
  Con el aviso de impacto hay flecha hacia el timón y pitido repetido desde cualquier punto de la nave. Ventana para
  llegar al timón: 8,9 s en económico, 4,6 s en crucero y 1,6 s en máximo.
- Averías con interacción propia (`game/repairGames.ts`): fuego (apuntar el extintor al foco), cortocircuito
  (pulsos de sincronía, dos aciertos), fuga (mantener y soltar en la zona de presión). El repuesto es una
  acción de dos tramos con R (encajar la pieza: mantener y soltar en la marca).
- Accesibilidad en tres ajustes separados, que sustituyen a «interacciones simples»: esquiva simple (mantener E),
  averías simples (mantener R) y puntería ancha (área del extintor ×2).
- Herramientas en superficie (`scenes/SurfaceTools.tsx`, `ui/ToolIcon.tsx`, brújula de herramientas, avisos y
  sonidos). La brújula de oxígeno cuenta el rodeo por las herramientas colocadas, con cuatro estados
  (`ok`, `fetch`, `leave`, `short`). Un haz por filón; el HUD muestra el avance del filón («2/3») y la escena marca la veta que lo completa.
- Teclas: E usar/abrir/colocar/recoger; Q alternativa; clic o Espacio la habilidad; R reparar con repuesto.

### Fase 3 — qué se hizo (2026-11-13, rama `feat/f3-economia-progresion`, sin commitear)

La carga de la bodega pasa a ser progreso: en una estación se vende, se compra y se mejora la nave. Decisiones y
reglas completas en ADR 0014, `packages/shared/CLAUDE.md` y `apps/client/CLAUDE.md`. Contrato aditivo.

**Motor (`packages/shared`):**
- `RunState.credits` y `RunState.upgrades` (obligatorios en el estado; ver ADR 0014). Acciones atracada en una estación
  (`reject.notAtStation` si no): `sell {materialId?, units?}`, `buy-supply {supply: fuel|hull|spares, amount?}` y
  `buy-upgrade {upgradeId}`. `service` se reconvierte en **ayuda de emergencia gratuita, una vez por estación**
  (75 % del depósito, 50 % del casco, 1 repuesto): mínimo anti-callejón. `NodeKindDef.shop` marca la estación; `service` queda obsoleto.
- Módulo `economy.ts` y catálogos `economia.json` (créditos iniciales 60; **contrato de 65 por sector superado**;
  venta: hielo 1, mena 4, cristal 14, muestra 24; suministros: combustible 1, casco 1,2, repuesto 15; multiplicador por
  sector +0,2 en venta y +0,15 en compra; referencia de masa 1000 kg; oferta de 5 mejoras por estación) y
  `mejoras.json` (**11 mejoras** con niveles y contrapartida: `fuel-tank`, `shield-capacitor`, `reactor-heatsink`,
  `eva-o2-tank`, `jump-drive`, `hull-plating`, `armored-suit`, `jetpack-thrusters`, `cargo-backpack`,
  `life-support-boost`, `engine-stabilizers`). `parseCatalog` rellena ambos con valores por defecto si faltan.
- `run.stationQuote()` (precios, oferta y, por mejora, `powerMarginDeltaKw` y `overloadsAtCruise`), `effectiveShip()` y
  `effectiveSurfaceRules()` (el motor solo usa las efectivas), `cruisePowerMarginKw`. Oferta de mejoras determinista por
  semilla, sector y nodo con un flujo propio de azar (dos partidas acaban con mejoras distintas).
- **La masa a bordo encarece cada salto** (bodega + mejoras; combustible × (1 + kg / 1000)), en el consumo real y en `estimateJump`.
- Hielo y mena **se siguen convirtiendo al guardarse** (combustible y repuestos) y el sobrante va a la bodega y se vende.
  **Los créditos y las mejoras no puntúan**; el material descubierto puntúa una vez al guardarse, vender no suma ni resta.
- Bot de balance con política de economía según el estado de la nave (vende, repone, compra mejoras).

**Cliente (`apps/client`):**
- **Terminal de estación** (`ui/StationTerminal.tsx`; E en la esclusa atracado en una estación o botón del mapa): dos
  columnas (venta | tienda y mejoras), una línea de efecto por mejora y aviso de sobrecarga, teclado, **no pausa** el juego.
- `ui/Credits.tsx` (`CreditsBadge` en HUD, mapa y terminal; `UpgradeStrip`), resumen de economía en el fin de partida,
  «+N % por carga» en el mapa, `game/shop.ts` y `game/effective.ts` (topes con la nave y las reglas efectivas), cues
  `sale`, `purchase`, `upgrade` y `noCredits`.
- Atajo: `?play=1&seed=7&station=1` (`&station=bare` sin la oferta) y `__payload.toStation()`.

**Fuera de alcance (respetado):** mercado dinámico, cambio visual exterior de la nave, *gear-gating*, meta-progresión.

**Validación independiente:** «cumple con observaciones». Corregido después: tests de las dos mejoras nuevas, bot que las
compra, aviso de sobrecarga, rechazo duplicado, cierre del overlay y tope en `isStranded`.

## Métricas verificadas (2026-11-13, fase 3)

| Métrica | Valor |
| --- | --- |
| `pnpm validate` | Verde: 11/11 tareas (typecheck + test + build). Total **300 tests** |
| Tests `@payload/shared` | **181** en 8 archivos (`economy` nuevo) |
| Tests `@payload/client` | **119** en 5 archivos (`shop` nuevo) |
| `pnpm balance 200 3` · tripulación rápida (3,5 s), sin minar | S1 100 % · S2 99 % · S3 90 % (antes 100/100/92); 0 mejoras; 224 créditos ganados / 182 gastados |
| `pnpm balance 200 3` · tripulación lenta (7 s) | S1 100 % · S2 94 % · S3 71 % (antes 73) |
| `pnpm balance 200 3` · explorador prudente | S1 99 % · S2 96 % · S3 82 % (antes 83); 3,6 mejoras por partida; 111 combinaciones de mejoras distintas en 200 partidas; 734 créditos ganados / 646 gastados |
| Sin verificar | Hito de 20 minutos con personas, terminal y créditos en GPU real, audio de los cues nuevos, FPS |

Línea base de balance de la fase 3: las cifras de esta tabla (con la economía). Las de la tabla siguiente son anteriores.

## Métricas verificadas (2026-11-12, antes de la fase 3; históricas)

| Métrica | Valor |
| --- | --- |
| `pnpm validate` | Verde: 11/11 tareas (typecheck + test + build). Total **248 tests** |
| Tests `@payload/shared` | **148** en 7 archivos (`galaxy`, `run`, `surface`, `locales`, `balance`, `purity`, `rng`) |
| Tests `@payload/client` | **100** en 4 archivos (`game`, `surface`, `minigames`, `i18n`) |
| `pnpm balance` · tripulación rápida (3,5 s entre puestos), 3 sectores | Supera S1 100 % · S2 100 % · S3 92 % (con 4 sectores: S4 76 %) |
| `pnpm balance` · tripulación lenta (7 s) | S1 100 % · S2 94 % · S3 73 % (S4 40 %) |
| `pnpm balance` · nadie atiende las averías | S1 5 % · S2 0 % · S3 0 % |
| Perfiles de la fase 1 frente a `main` | Idénticos (siguen coincidiendo con las cifras del 2026-11-10) |
| Minijuegos de la nave (tripulación rápida; medio / simple / torpe a 5 s) | Medio: S1 100 % · S2 99 % · S3 89 % (S4 66 %), 7,6 roces por partida. Simple: S1 100 % · S2 99 % · S3 89 % (S4 65 %), 18,4 roces. Torpe: S1 100 % · S2 94 % · S3 62 % (S4 30 %) |
| Explorador prudente (`crew + prudent`) | S1 99 % · S2 97 % · S3 83 % (S4 66 %); 4,9 aterrizajes y 7,7 salidas por partida; vuelven 99 %; salida media 124 s (quieto 21 s, 17 %); 52,4 materiales (2402 puntos, 310 por salida); muertes en superficie 5 %; por aterrizaje 486 puntos, 1,6 salidas, 221 s en tierra y 63 % de O₂ de la nave al despegar; puntuación media 7185 |
| Explorador codicioso (`crew + greedy`) | S1 66 % · S2 40 % · S3 20 % (S4 8 %); 3,7 aterrizajes (11 % bruscos) y 5,5 salidas; vuelven 92 %; salida media 134 s (quieto 26 s, 19 %); 34,4 materiales (1763 puntos, 323 por salida); muertes en superficie 44 % |
| Explorador «hasta vaciar» (`crew + thorough`, 25 % de margen) | S1 98 % · S2 96 % · S3 83 % (S4 65 %); 4,9 aterrizajes y 18,1 salidas; salida media 77 s (quieto 13 s, 17 %); 76,5 materiales (2612 puntos, 145 por salida); muertes en superficie 0 %; por aterrizaje 529 puntos, 3,7 salidas y 340 s en tierra |
| Margen de O₂ para volver (prudente) | 25 % → 291 valor/salida, 0 % muertes · 15 % → 310, 5 % · 8 % → 301, 20 % · 3 % → 289, 39 % (vuelven 93 %) |
| Duración de un sector (tripulante simulado, sin explorar) | ~800 s en 3 sectores simulados (~4-4,5 min por sector) |
| Motor | ~9 ms por partida sin explorar; unos 70 ms (prudente) y 50 ms (codicioso) con superficie |
| Chunks del cliente | `SurfaceWorld` 2,35 MB (0,88 MB gzip; Rapier incrustado, carga diferida); `ShipScene` 79,5 kB; `Models` 1,0 MB; inicio 0,53 MB |
| Modelos servidos (`assets/web/models/`) | ~13 MB (5 GLB; el mecha no se usa) |
| Verificación visual de la superficie | Solo Chrome sin cabeza (SwiftShader, ~2 FPS): descenso, EVA, bodega, herramientas y minijuegos. **Ningún FPS medido en GPU real, audio sin escuchar, sin jugar con personas; los minijuegos, las herramientas y los filones no se han probado con teclado y ratón reales ni los filones, el «2/3», la corona del filón ni la flecha al timón se han visto en el navegador** |
| Prueba manual de la fase 1 (2026-11-10, Chrome, 144 Hz) | Menú, interior, mapa estelar, salto, impacto, fuga, panel de energía, derrota; rediseño gráfico revisado con los ocho puestos y siete destinos. Sin errores en consola |

Cifras de `pnpm balance` (200 partidas, 3 sectores); los 4 sectores (`pnpm balance 200 4`) entre paréntesis. Antes de las herramientas (2026-11-12, 209 tests) el prudente tenía S3 85 %, 243 puntos por salida y 1 % de muertes, y la curva de margen iba de 213 a 265 de valor por salida.

### Revisión de diseño de la fase 2

Un crítico independiente la evaluó en tres pasadas: **6/10 → 7/10 → 8/10** («sobre el papel ya es una buena fase»). Sobre
el papel cumple el hito (una salida de 2-3 minutos con duda real), con la salida media en el borde bajo (~2 min). Tras la
tercera pasada se cerraron sus tres flecos: ventanas de frenado del descenso, vetas en zona inestable recogibles
desde fuera (ahora hay que pisarla) y caída mortal residual sobre el abismo del mundo pesado. **Esa última corrección no
se ha vuelto a calificar.** Lo que el crítico dejó abierto está en «Decisiones de diseño abiertas».

### Revisión de diseño de las herramientas y los minijuegos

Un crítico independiente la evaluó en dos pasadas: **7,5/10 global** (minería 6,5, esquiva 6,5, averías 7,5) y, tras las
correcciones, **8/10 global (minería 7,5, esquiva 8, averías 8)**: «las correcciones son reales»; la minería con
herramientas y filones es «mejor juego, por poco» que mantener E, con la excepción de la curva de riesgo. La última ronda
(bonus de filón, esquiva de 3 s, flecha y pitido al timón) responde a sus dos recomendaciones finales y **no se ha
recalificado**.

## Acciones humanas pendientes

Ningún agente puede hacerlas.

F3-a. **Hito de la fase 3:** jugar 20 minutos (`pnpm dev`, `?play=1&seed=7&station=1`): ¿se vende, se compran >= 2 mejoras y la nave se siente otra? ¿dos partidas seguidas acaban con mejoras distintas? ¿los precios dan duda real?
F3-b. **Ver el terminal de estación** (E en la esclusa atracado, animación de créditos, pantalla de fin de partida) en un navegador con GPU real, y **escuchar** los cues `sale`, `purchase`, `upgrade` y `noCredits` (nadie los ha oído).
0. **Jugar la superficie** (`pnpm dev`, `?play=1&seed=7&surface=1`; semillas por mundo en `apps/client/CLAUDE.md`):
   ¿se duda de verdad entre una veta más y volver? ¿el descenso y el jetpack se sienten bien? Hito de la fase 2.
1. **Medir FPS en GPU real** (portátil de gama media, meta 60) en la superficie y en la nave: solo se ha visto con
   SwiftShader (2-3 FPS), que no mide nada.
2. **Escuchar el audio** (viento, tormenta, respiración, pitido de O₂, propulsor, jetpack, despegue): nadie lo ha oído.
3. **Jugar las herramientas, los filones y los minijuegos con teclado y ratón reales** (solo se han visto en un navegador sin cabeza a ~2 FPS, y los filones ni eso) y escuchar sus sonidos; decidir si la dificultad de la esquiva y de las averías es la buena y si los tres ajustes de accesibilidad bastan.
4. **Recalificar la última corrección de la revisión de diseño** (8/10 tras tres pasadas; los tres flecos finales no se han vuelto a evaluar) si se quiere una nota definitiva.
5. **Hito de la fase 1:** prueba con >= 3 personas que no conozcan el juego (ver `docs/phases/fase-1.md`).
6. **Validación independiente final de la fase 2** (agente `validator` o una persona) y marcar las casillas de `docs/phases/fase-2.md`.
7. **Decidir el commit** de `feat/f3-economia-progresion` (cambios sin commitear) y el PR de la fase 3.
8. **Probar con ratón capturado** (pointer lock) en una sesión real.
9. **Mirar el rediseño gráfico y opinar** (`?play=1&seed=7&body=<tipo>`): brillo, color y legibilidad, otras semillas.
10. **ERIZON** (CC-BY-NC-ND): decidir si se sustituye antes de cualquier uso comercial.
11. **Crear `.claude/settings.json` compartido** (contenido propuesto en `docs/CONTRIBUTING.md`).

## Decisiones de diseño abiertas

- **Sector de ida.** Hoy se avanza hasta un portal y se pasa a otro sector; el plan habla de «regresar a estaciones seguras». Con la economía ya existente hay que decidir si hace falta una base a la que volver (el contrato de 65 créditos se cobra al superar el sector, sin volver).
- **Economía (fase 3), a decidir con jugadores:**
  - Los **créditos no puntúan** (ni las mejoras): el explorador que gasta no pierde puntos, pero el dinero no vale nada al final.
  - **Sin minar sobran ~100 créditos** y no se compra ninguna mejora; minando, el explorador prudente simulado compra unas 3,6 por partida.
  - **`jump-drive` casi no se compra** (0,03-0,05 por partida, por precio) y `reactor-heatsink` poco (0,26): revisar precio o efecto.
  - **No se puede soltar carga atracado ni en el espacio** (`jettison` solo en superficie), aunque pese y encarezca el salto.
  - **La ayuda de emergencia se da aunque haya créditos** (gratis, una vez por estación): decidir si solo debería darse sin ellos.
  - **La oferta no se renueva** (fija por estación).
  - **Con todas las mejoras, la demanda con todo encendido supera el reactor** (aceptado por diseño, con aviso de sobrecarga en el terminal).
  - **`isSectorSolvable` asume repostaje completo en estación** (hoy 75 % gratis y el resto de pago): un sector «completable» puede no serlo para quien llegue sin créditos ni carga y con mucha masa. Vigilar varadas en la prueba con personas.
- **Sin tutorial.** Solo ayuda con H y carteles. Decidir tras la prueba con jugadores.
- **El mapa solo se abre en la mesa del puente** (hay que ir andando). Es deliberado, pero puede resultar pesado.
- **Los sistemas apagados por el jugador no se encienden solos** tras una sobrecarga: decidir si es buena fricción.
- **Capacidad de carga** (`suit.carryCapacityKg`, hoy 110 kg; lo raro pesa 8-10 kg): a revisar con jugadores (¿se llega al tope antes que al O₂?).
- **Curva de «apurar»** (pendiente del crítico): entre 25 % y 3 % de margen de O₂ solo se gana ~+25 % de valor por salida (213 → 265) a costa de pasar de 0 % a 35 % de muertes. Palancas aplazadas: raros en filones o racha no lineal; decidir con datos de personas.
- **Dos salidas tranquilas rinden algo más que una apurada** (por aterrizaje, el prudente saca 413 puntos y «hasta vaciar» 488 frente a 549 del codicioso, que muere el 49 %): vigilar con jugadores.
- **Explorar baja la supervivencia:** sector 3 con exploración, 85-86 % frente a 92 % sin explorar.
- **La mena ya no es relleno:** con los repuestos llenos se vende (4 créditos por unidad), pero pesa y encarece cada salto; vale poco frente a cristales (14) y muestras (24).
- **Accesibilidad:** hay intensidad de efectos y tres ajustes separados (esquiva simple, averías simples, puntería ancha), pero no hay mando, táctil ni remapeo de teclas (fase 5).
- **Curva de «apurar el oxígeno»: el criterio de cierre del revisor NO se alcanzó.** Pedía +15 % o más de valor por salida entre
  25 % y 8-15 % de margen con <= 10 % de muertes. Con el bonus de filón queda en **+6,5 % con 5 % de muertes** (291 → 310
  puntos por salida a 15 %; a 8 % baja a 301 con 20 % de muertes): el bonus sube el botín de todos los perfiles un 15-17 %
  pero no la pendiente. Por indicación del revisor no se sigue ajustando contra el bot: se decide con jugadores reales. El
  umbral de `balance.test.ts` está relajado. Palancas: retorno automático de herramientas (descartado: quitaría la decisión
  de abandonarlas); aviso de cuándo estará lista la siguiente pieza del filón (pendiente).
- **Esquiva y llegada al timón:** el piloto torpe puede salir mejor llegando un instante tarde que jugando la esquiva (dificultad
  0,3: 0,20 frente a 0,29), y a régimen máximo (ventana de 1,6 s) casi nunca da tiempo a jugarla.
- **Los filones no se han visto en pantalla** (solo cifras y tests; tampoco el avance «2/3» ni la veta que completa); su legibilidad y su distancia (8-15 m) son provisionales.
- **Minijuegos sin datos de personas:** dificultad de la esquiva (`averias.json`, `impact.evade`), tamaño de las zonas de reparación y efecto de acertar o fallar son provisionales.
- **Qué hace el hielo de la luna volcánica y el mundo de tormentas:** escaso, lejos y con tormentas que paran el concentrador; el bot no lo busca de forma especial. Ver con jugadores si vale el viaje.
- **Qué valen cristales y muestras:** además de puntuar al guardarse, se venden por 14 y 24 créditos (más por sector). Precios provisionales hasta la prueba con personas.
- **Mecha Aurora G9:** aplazado (ADR 0012). Decidir en fases posteriores si vuelve como vehículo o se retira del GDD.
- **Mascota:** no hay. Si vuelve, Rise sigue necesitando autorización de NASA.

## Deuda técnica conocida

- **La escena 3D no tiene tests** (ni E2E): se validó a mano. Lo que sí está cubierto es la lógica pura (`layout`, `interaction`, `runStore`, `terrain`, `motion`, `surfaceRules`).
- **Cámara en 3ª persona:** se limita al casco pero puede atravesar mamparos y puestos.
- **Carteles en el mundo (`Markers`)** ocultan a mano los que quedan detrás de la cámara (drei `Html` no siempre lo hace con la cámara quieta).
- **El resplandor son halos (`Glow`):** `postprocessing` ya no está. La escena de la nave pesa 63,5 kB; la física (Rapier) va en `SurfaceWorld`.
- **Modelos procedurales, no GLB:** casco, puestos y cuerpos celestes se generan en código (`gfx/`). No
  pesan ni tienen licencia, pero no se pueden editar en Blender; si algún día se quieren esculpir, hay que exportarlos.
- **Sin sombras proyectadas:** en la nave las de contacto están pintadas en el suelo y la luz de la estrella entra sin oclusión; en la superficie no hay mapas de sombra.
- **Despegue sin vista exterior:** el despegue solo se oye y se nota; no hay escena de ascenso como la del descenso.
- **`SurfaceWorld` pesa ~2,36 MB** (Rapier incrustado, carga diferida): solo se baja al entrar en una superficie.
- **El cliente aún distingue algunos subtipos de evento por `tone`** en vez de por `RunEvent.subtype`; migrarlos.
- **El aviso de O₂ para volver supone línea recta** (`o2ReturnShort`): no cuenta abismos ni rodeos.
- **El bot prudente casi nunca muere** (1 % de las partidas con su margen habitual): no demuestra que la superficie sea difícil para quien juega con cuidado; el riesgo lo muestran el codicioso y el barrido de márgenes.
- **Rendimiento del rediseño apenas medido** (ver métricas): 10 luces puntuales y shaders de planeta por píxel. Si faltan FPS,
  lo primero es bajar `dpr` en `ShipScene` y las octavas de `fbm` en `spaceShaders.ts`.
- **Mando y táctil** no implementados. Sin CI ni linter.
- **`fx` y `playerState`** son objetos mutables de módulo (leídos por frame sin pasar por React).

## Próximos pasos (hacia la fase 4)

1. Cerrar la fase 2: segunda revisión de diseño, validación independiente final, prueba con jugadores y medida de FPS;
   ajustar `catalog/mundos.json` con `pnpm balance` (ver `.claude/skills/add-catalog-item`).
2. La prueba con jugadores de la fase 1.
3. Cerrar la fase 3: commit y PR de `feat/f3-economia-progresion`, prueba de 20 minutos con personas y ajuste de precios y mejoras (`economia.json`, `mejoras.json`) con `pnpm balance`.
4. Escribir `docs/MULTIPLAYER.md` nuevo antes de tocar `apps/game-server` (fase 4); el antitrampas de `set-position` y la autoridad dividida (ADR 0012) son su punto de partida.
5. **Lo que el cooperativo debe saber de la economía** (para `docs/MULTIPLAYER.md` y `apps/game-server`):
   - Todo el comercio entra como `RunAction` (`sell`, `buy-supply`, `buy-upgrade`, `service`) y es determinista: la oferta sale de semilla + sector + nodo, sin azar propio del servidor. El motor valida estación, créditos y oferta, así que el servidor solo reenvía acciones.
   - `run.stationQuote()` es la fuente única de precios y oferta; `effectiveShip()` y `effectiveSurfaceRules()`, de la nave y las reglas con mejoras. El cliente no calcula cifras y el servidor debe usar las mismas.
   - Los **créditos y las mejoras son de la tripulación** (un único `RunState`, compartidos). Falta decidir quién gasta: propuesta, el rol «gestor de recursos» lidera el terminal, sin bloqueo rígido (como pide `docs/phases/fase-4.md`). El motor ya rechaza compras duplicadas o sin créditos.
   - `RunState.credits` y `upgrades` son obligatorios: cualquier `RunState` armado a mano (fixtures, red) debe incluirlos.
   - El terminal **no pausa** el juego: la nave sigue viva mientras se compra.
