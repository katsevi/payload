# Estado del proyecto — traspaso entre sesiones

Última actualización: **2026-11-12** · Versión publicada: 0.4.0 · Propuesta: 0.5.0 (sin publicar; ver `CHANGELOG.md`)

> Léelo antes de empezar y actualízalo al terminar una tarea relevante. Las casillas de
> `docs/phases/fase-*.md` las marca quien valida la fase, no quien implementa: aquí solo se resume.

## Lo más importante

**Payload es un cooperativo de supervivencia en una nave** (plan en `docs/plan/plan-tripulacion-de-exploracion.md`,
decisión en ADR 0011). El juego se rehízo el 2026-11-09.

- La **fase 1 está fusionada en `main`** (PR #3). La fase 2 está en la rama **`feat/f2-superficie`**,
  **sin commitear** (nadie ha pedido aún el commit).
- No existe ninguna etiqueta local `v0.3.0-simulador` (`git tag` está vacío): la versión anterior (0.3.0) está en
  el historial, en el commit `76ae5ab` (ADR 0011). Su documentación está en `docs/archivo/v0.3-simulador/`.
- **Fase 2 (exploración de superficie): implementada.** Pendiente de validación independiente final y de prueba
  con jugadores. Nadie ha medido FPS en GPU real, escuchado el audio ni jugado con personas (ver acciones humanas).
- Decisiones de la fase: `docs/adr/0012-superficie-autoridad-dividida.md`.

## Estado por fase

| Fase | Estado |
| --- | --- |
| 1 · Viaje y nave (en solitario) | **Implementada y fusionada en `main`** (PR #3). `pnpm validate` en verde y recorrido manual en Chrome. **Falta:** validación independiente (agente `validator`) y el hito con jugadores. |
| 2 · Exploración de superficie | **Implementada** (rama `feat/f2-superficie`, sin commitear). `pnpm validate` en verde y una pasada del `validator` sin bloqueantes. **Falta:** validación independiente final, la segunda revisión de diseño y el hito con jugadores. |
| 3 · Economía y progresión | No iniciada. |
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

### Fase 2 — qué se hizo (2026-11-12, rama `feat/f2-superficie`, sin commitear)

Ciclo nuevo: atracada en un destino aterrizable → descenso (minijuego de frenado) → salida por la esclusa →
recoger materiales con jetpack y oxígeno limitado → volver → despegar. Un aterrizaje por nodo. Decisiones en ADR 0012.

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

## Métricas verificadas (2026-11-12, estado final de la fase 2)

| Métrica | Valor |
| --- | --- |
| `pnpm validate` | Verde: 11/11 tareas (typecheck + test + build). Total **209 tests** |
| Tests `@payload/shared` | **127** en 7 archivos (`galaxy`, `run`, `surface`, `locales`, `balance`, `purity`, `rng`) |
| Tests `@payload/client` | **82** en 3 archivos (`game`, `surface`, `i18n`) |
| `pnpm balance` · tripulación rápida (3,5 s entre puestos), 3 sectores | Supera S1 100 % · S2 100 % · S3 92 % (con 4 sectores: S4 76 %) |
| `pnpm balance` · tripulación lenta (7 s) | S1 100 % · S2 94 % · S3 73 % (S4 40 %) |
| `pnpm balance` · nadie atiende las averías | S1 5 % · S2 0 % · S3 0 % |
| Perfiles de la fase 1 frente a `main` | Idénticos (confirmado por el `validator`; coinciden con las cifras del 2026-11-10) |
| Explorador prudente (`crew + prudent`) | S1 100 % · S2 99 % · S3 85 % (S4 68 %); 5,0 aterrizajes y 8,4 salidas por partida; vuelven 100 %; salida media 120 s; 47,7 materiales (2046 puntos, 243 por salida); muertes en superficie 1 %; por aterrizaje 413 puntos, 1,7 salidas, 232 s en tierra y 71 % de O₂ de la nave al despegar; puntuación media 6925 frente a 4969 sin explorar |
| Explorador codicioso (`crew + greedy`) | S1 58 % · S2 31 % · S3 14 % (S4 8 %); 3,3 aterrizajes (13 % bruscos) y 5,7 salidas; vuelven 91 %; salida media 132 s; 31,9 materiales (1798 puntos, 318 por salida); muertes en superficie 49 % |
| Explorador «hasta vaciar» (`crew + thorough`, 25 % de margen) | S1 100 % · S2 98 % · S3 86 % (S4 63 %); 4,9 aterrizajes y 19,4 salidas; salida media 91 s; 89,4 materiales (2367 puntos, 122 por salida); muertes en superficie 0 %; por aterrizaje 488 puntos, 4,0 salidas y 448 s en tierra |
| Margen de O₂ para volver (prudente) | 25 % → 213 valor/salida, 0 % muertes · 15 % → 243, 1 % · 8 % → 263, 8 % · 3 % → 265, 35 % (vuelven 95 %) |
| Duración de un sector (tripulante simulado, sin explorar) | ~800 s en 3 sectores simulados (~4-4,5 min por sector) |
| Motor | ~9 ms por partida sin explorar; 70 ms (prudente), 31 ms (codicioso) y 96 ms (hasta vaciar) con superficie |
| Chunks del cliente | `SurfaceWorld` 2,36 MB (0,88 MB gzip; Rapier incrustado, carga diferida); `ShipScene` 63,5 kB; `Models` 1,0 MB; inicio 0,50 MB |
| Modelos servidos (`assets/web/models/`) | ~13 MB (5 GLB; el mecha no se usa) |
| Verificación visual de la superficie | Solo Chrome sin cabeza (SwiftShader, 2-3 FPS): revisadas las escenas de descenso, EVA y bodega. **Ningún FPS medido en GPU real, audio sin escuchar, sin jugar con personas** |
| Prueba manual de la fase 1 (2026-11-10, Chrome, 144 Hz) | Menú, interior, mapa estelar, salto, impacto, fuga, panel de energía, derrota; rediseño gráfico revisado con los ocho puestos y siete destinos. Sin errores en consola |

Cifras de `pnpm balance` (200 partidas, 3 sectores); los 4 sectores (`pnpm balance 200 4`) entre paréntesis.

### Revisión de diseño de la fase 2

Un crítico independiente la evaluó en tres pasadas: **6/10 → 7/10 → 8/10** («sobre el papel ya es una buena fase»). Sobre
el papel cumple el hito (una salida de 2-3 minutos con duda real), con la salida media en el borde bajo (~2 min). Tras la
tercera pasada se cerraron sus tres flecos: ventanas de frenado del descenso, vetas en zona inestable recogibles
desde fuera (ahora hay que pisarla) y caída mortal residual sobre el abismo del mundo pesado. **Esa última corrección no
se ha vuelto a calificar.** Lo que el crítico dejó abierto está en «Decisiones de diseño abiertas».

## Acciones humanas pendientes

Ningún agente puede hacerlas.

0. **Jugar la superficie** (`pnpm dev`, `?play=1&seed=7&surface=1`; semillas por mundo en `apps/client/CLAUDE.md`):
   ¿se duda de verdad entre una veta más y volver? ¿el descenso y el jetpack se sienten bien? Hito de la fase 2.
1. **Medir FPS en GPU real** (portátil de gama media, meta 60) en la superficie y en la nave: solo se ha visto con
   SwiftShader (2-3 FPS), que no mide nada.
2. **Escuchar el audio** (viento, tormenta, respiración, pitido de O₂, propulsor, jetpack, despegue): nadie lo ha oído.
3. **Recalificar la última corrección de la revisión de diseño** (8/10 tras tres pasadas; los tres flecos finales no se han vuelto a evaluar) si se quiere una nota definitiva.
4. **Hito de la fase 1:** prueba con >= 3 personas que no conozcan el juego (ver `docs/phases/fase-1.md`).
5. **Validación independiente final de la fase 2** (agente `validator` o una persona) y marcar las casillas de `docs/phases/fase-2.md`.
6. **Decidir el commit y el PR** de `feat/f2-superficie`.
7. **Probar con ratón capturado** (pointer lock) en una sesión real.
8. **Mirar el rediseño gráfico y opinar** (`?play=1&seed=7&body=<tipo>`): brillo, color y legibilidad, otras semillas.
9. **ERIZON** (CC-BY-NC-ND): decidir si se sustituye antes de cualquier uso comercial.
10. **Crear `.claude/settings.json` compartido** (contenido propuesto en `docs/CONTRIBUTING.md`).

## Decisiones de diseño abiertas

- **Sector de ida.** Hoy se avanza hasta un portal y se pasa a otro sector; el plan habla de «regresar a estaciones seguras». Con la economía (fase 3) hay que decidir si existe una base a la que volver.
- **Servicio de estación gratuito** (depósito lleno, +40 casco, +2 repuestos, una vez): sustituto provisional de la tienda de la fase 3.
- **Sin tutorial.** Solo ayuda con H y carteles. Decidir tras la prueba con jugadores.
- **El mapa solo se abre en la mesa del puente** (hay que ir andando). Es deliberado, pero puede resultar pesado.
- **Los sistemas apagados por el jugador no se encienden solos** tras una sobrecarga: decidir si es buena fricción.
- **Capacidad de carga** (`suit.carryCapacityKg`, hoy 80 kg; lo raro pesa 8-10 kg): a revisar con jugadores (¿se llega al tope antes que al O₂?).
- **Curva de «apurar»** (pendiente del crítico): entre 25 % y 3 % de margen de O₂ solo se gana ~+25 % de valor por salida (213 → 265) a costa de pasar de 0 % a 35 % de muertes. Palancas aplazadas: raros en filones o racha no lineal; decidir con datos de personas.
- **Dos salidas tranquilas rinden algo más que una apurada** (por aterrizaje, el prudente saca 413 puntos y «hasta vaciar» 488 frente a 549 del codicioso, que muere el 49 %): vigilar con jugadores.
- **Explorar baja la supervivencia:** sector 3 con exploración, 85-86 % frente a 92 % sin explorar.
- **La mena es relleno hasta la fase 3** (rinde repuestos, pero no tiene más función).
- **Accesibilidad:** hay intensidad de efectos y recoger con una pulsación, pero no hay mando, táctil ni remapeo de teclas (fase 5).
- **Qué valen cristales y muestras:** hoy solo suman puntuación y ocupan bodega; el precio lo decide la fase 3.
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

## Próximos pasos

1. Cerrar la fase 2: segunda revisión de diseño, validación independiente final, prueba con jugadores y medida de FPS;
   ajustar `catalog/mundos.json` con `pnpm balance` (ver `.claude/skills/add-catalog-item`).
2. Decidir el commit y el PR de `feat/f2-superficie`; después, la prueba con jugadores de la fase 1.
3. Fase 3 (economía): vender cristales y muestras, mejoras sobre `ShipDef`/traje/jetpack; decidir el destino del servicio gratuito de estación.
4. Escribir `docs/MULTIPLAYER.md` nuevo antes de tocar `apps/game-server` (fase 4); el antitrampas de `set-position` y la autoridad dividida (ADR 0012) son su punto de partida.
