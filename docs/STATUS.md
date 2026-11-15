# Estado del proyecto — traspaso entre sesiones

## Mapa del sistema solar: carga (2026-11-15, rama `feat/f4-mapa-solar-carga`)

- **Problema:** en las misiones, abrir el mapa del sistema solar congelaba el juego. Medido por CDP en Chrome con la Iris
  Xe (ANGLE/Vulkan) y las cachés de shaders desactivadas (peor caso, como la primera apertura o Windows/D3D11): **2,2 s**
  de hilo principal bloqueado, de los que 2,1 s eran `getProgramInfoLog` (enlace) del shader procedural de planeta
  (`planetMaterial`: cráteres con bucles 3×3×3, simplex con 5 octavas, tres evaluaciones del relieve por píxel). El mapa
  es un `<Canvas>` aparte, así que lo recompila aunque la nave ya lo tenga. Sin ese shader: 0,27 s.
- **Arreglo:** `gfx/planetBake.ts` (PURO) porta el algoritmo a TS y hornea albedo + normal en equirrectangular (512×256
  para los cuerpos de radio de escena ≥ 0,3, 256×128 el resto; la pendiente sale de diferencias en la rejilla, 3× más
  rápido que evaluar tres veces). Lo corren hasta 3 Web Workers (`planetBake.worker.ts`; cola y caché de sesión en
  `planetTextures.ts`, con respaldo en el hilo principal si no hay workers). El mapa usa `mapPlanetMaterial`
  (`spaceShaders.ts`): misma luz, especular, terminador, nubes (deslizándose) y grietas de lava (latiendo). `App` llama a
  `prefetchSolarMap()` 2,5 s después de empezar una partida con misión. Resultado en el mismo peor caso: **~0,27 s**
  (restan programas pequeños y React en modo desarrollo). Capturas lado a lado (Tierra, Júpiter, Saturno, Ío, Luna,
  Marte, Europa, Titán): mismo aspecto; el ruido muy fino (grietas de Europa) sale algo más suave por los mipmaps.
- **Sin verificar:** FPS con el mapa abierto y medición en el build de producción (no expone `__payload`); Windows/D3D11.
  El planeta de proa de la nave (`SpaceBodies`) sigue con el shader procedural (lo precompila `ShaderWarmup`).

## Audio inmersivo (2026-11-15, rama `feat/audio-inmersivo`)

- **Salto que «se oía mal»:** el `jump` arrancaba un bucle de ruido blanco a 0,7 + sierra a 42 Hz que sonaba TODO el
  tránsito (también en pausa), sumado a sierras graves de la música y sin limitador → saturación y fatiga. Ahora: arranque
  de 2,4 s y crucero grave y suave; limitador en el master; los avisos bajan la música (ducking); los bucles bajan en pausa
  (bus `loops`); ruido con varias semillas (antes todos los bucles sumaban la misma secuencia en fase); efectos agendados
  20 ms por delante; sin LFO cuadrado sobre ganancias (clics de la capa `pulse`).
- **Música generativa** (`musicSynth.ts`, `musicVoices.ts`): partitura por escena en Re (menú lidio, hangar mixolidio, a
  bordo dórico, tránsito eólico con ostinato, aterrizaje frigio, EVA en quintas, victoria, lamento de derrota), reverb por
  convolución generada, peligro en 3 escalones con un cambio cada uno, cambios alineados al compás.
- **Efectos:** todos rediseñados (sin sierras crudas, alarmas distinguibles) y 38 nuevos: pasos por suelo y mundo,
  aterrizaje del salto, hover/clic, mapa, paneles, terminal, energía, hangar (pieza, Go/No-Go, lanzamiento), radio con la
  Tierra, observación, sobrecalentamiento, batería, ping y entrada/salida en la sala, crujido del casco, granizo.
- **Niveles:** `BUS_TRIM` (música ×0,7, efectos ×1,12, avisos ×1,25) sin tocar los ajustes guardados; `SFX_GAIN` por sonido.
- **Proceso:** estudio de mercado + rúbrica (`docs/diseno/audio-rubrica.md`, Haiku), compositor (Opus), diseñador de
  efectos (Sonnet), laboratorio offline sin dependencias (`audio/offline/`, `pnpm --filter @payload/client audio:report`) y
  validador independiente (Haiku) en 3 rondas: `docs/diseno/audio-validacion.md`.
- **Sin verificar:** nada se ha ESCUCHADO con personas ni en el juego en marcha (solo métricas offline y Chrome sin
  cabeza para la música). Pendiente: prueba de escucha (fatiga de pasos/hover, granizo, alarmas a ciegas), LUFS de una
  sesión real de 3 min con efectos, y el ducking en partida.

## Objetivo visible y primera misión guiada (2026-11-15, rama `feat/f5-objetivo-y-guia-primera-mision`)

Problema reportado: al zarpar no se sabía qué hacer (el objetivo se perdía). Se pidió que la primera misión, la más fácil
(«Tu primer CubeSat», `mission-cubesat-guided`), se jugara guiada y con más detalle en los tres modos (solitario con diseño,
partida libre y cooperativo). Sin ADR nuevo: cambios aditivos en `types.ts`, sin campos nuevos en `RunState` y **sin cambios
en el contrato de red** (`docs/MULTIPLAYER.md` no se toca).

**Qué se hizo**
- **Motor** (`packages/shared/src/objective.ts`): `currentObjective(state, cat?)`, pura, deriva el objetivo del `RunState`.
  Misión: `launch` → `reach-target` → `observe` → `downlink` → `return`; partida libre: sector 1 `jump` → `repair` (opcional)
  → `station` → `exit`, sector >= 2 solo `exit`. `flightSteps` y `hint` por paso en el bloque `guided` de `misiones.json`
  (validado con zod, claves generadas en `simLocales`). Ver `packages/shared/CLAUDE.md` § «Objetivo actual».
- **Servidor:** sin cambios de código. 5 tests nuevos (misión guiada en sala, ediciones prohibidas ignoradas en silencio,
  objetivo del espejo = servidor = solitario, partida libre en sala). La sala sigue empezando en partida libre.
- **Cliente** (ver `apps/client/CLAUDE.md` § «Guía del objetivo»): panel de objetivo persistente (abajo a la derecha; **O**
  despliega la lista, por defecto desplegada en la guiada y en el sector 1 libre), avisos «Nuevo objetivo» / «Hecho» con
  `cue('objective')`, cartel 3D y flecha hacia el puesto, nodo del objetivo marcado y salto sugerido preseleccionado en los
  mapas estelar y solar, hangar guiado con la ayuda del paso actual y «Todo listo», misión recomendada (foco por defecto en
  el selector; «Elegir» en el lobby cooperativo), ajuste «Guía detallada del objetivo» y fila en la ayuda (H).
- Tests nuevos: 17 en `packages/shared/src/__tests__/objective.test.ts`, `apps/client/src/__tests__/objective.test.ts` y 5 en
  `apps/game-server`. `pnpm test` en esta rama (salida real): 403 shared + 219 client + 34 game-server = 656 tests, todos en verde. `pnpm validate`
  completo (typecheck + build) queda para quien entregue.

**Verificado** (Chrome, panel del navegador): misión guiada completa hasta «misión cumplida», partida libre (salto, avería,
estación), superficie, hangar, sala cooperativa con la guiada.

**Sin verificar:** sala sin diseño con 2 jugadores; la línea «Tu objetivo sigue» de la pantalla de tramo; pantallas
< 1090 px; el sonido del cue `objective`; FPS; prueba con personas (¿el objetivo ya no se pierde?).

**Pendiente**
- En EVA la etiqueta «Ve a: Mapa estelar» podría ser «vuelve a la nave».
- Si dos pasos se cumplen a la vez, el aviso «Hecho» solo nombra el primero.
- Validación independiente (`validator`) y `pnpm validate` final antes de fusionar.

## Corrección del cooperativo y del rendimiento (2026-11-15, rama `fix/coop-y-rendimiento`)

Cinco fallos reportados tras probar con personas. Causas medidas y arreglos:

1. **El cuarto jugador no podía entrar («la partida ya ha empezado»).** Colyseus bloquea la sala sola cuando clientes +
   asientos reservados llegan a `maxClients`, y un intento de conexión fallido deja su asiento reservado 15 s (el cliente
   reintenta hasta 3 veces). Reproducido en un test de red (`room "…" is locked`). Arreglo: `maxClients` = 8 y el límite
   de 4 lo pone `RoomModel` (`room-full`).
2. **El anfitrión pasaba a otro jugador.** `pickHost` lo traspasaba con cualquier caída y no lo devolvía al volver.
   Ahora el anfitrión es el creador mientras siga en la sala (también durante la gracia de reconexión); solo pasa a otro
   si se va del todo, y lo recupera si vuelve a entrar con su clave privada (`key`, por pestaña). Tests en
   `roomModel.test.ts` y `network.test.ts`.
3. **Tirones en el aterrizaje** y 4. **en la nave.** Medido en el navegador con una GPU integrada AMD (ANGLE/D3D11):
   cada avería que aparecía recompilaba 15 shaders (1,3 s; con dos, 3 s) porque su luz estaba dentro de un grupo oculto
   y cambiaba el número de luces; volver al puente tras posarse congelaba 2,6 s; entrar al descenso, 1,3 s. Ahora:
   averías sin recompilación (máx. 21 ms por frame), vuelta al puente ~0,18 s (producción) y bajo un fundido a negro, y el
   montaje del descenso (~0,9 s de React en producción: contexto WebGL, física, mundo) también queda bajo el fundido.
   Durante el descenso, 60 FPS. Ver `apps/client/CLAUDE.md` § «Luces puntuales contadas» y «Fluidez».
5. **Paredes que parpadeaban.** La cámara en 3ª persona atravesaba el dintel de las puertas (sin colisión) y podía
   quedarse dentro de las paredes si el pivote del hombro caía dentro; además había caras coplanares (remates de las
   lámparas, pantallas a 2 mm de su consola). Arreglado (colisión del dintel, pivote limitado, techo de cámara más bajo,
   plano cercano 8 cm, caras separadas). Comprobado que la cámara ya no entra en el dintel; el parpadeo en sí no se pudo
   ver en capturas fijas.

**Sin verificar:** prueba con 4 personas en el servidor publicado (hay que desplegar el servidor de esta rama a la vez que
el cliente), FPS a pantalla completa en otras GPU, y el parpadeo de paredes a ojo con jugadores.

## Rediseño de la interfaz (2026-11-14, rama `feat/ui-tecnologica`)

- Nuevo sistema visual de toda la interfaz 2D (menú, pantallas, paneles y HUD): tokens y clases en `apps/client/src/index.css`,
  kit en `ui/kit.tsx`, reglas en `apps/client/CLAUDE.md` § «Sistema visual (UI)». Solo presentación: ni lógica ni acciones.
- Tipografías OFL (Chakra Petch, Barlow, JetBrains Mono) como dependencias `@fontsource` del cliente; en `assets/CREDITS.md`.
- Claves i18n nuevas (es/en): `menu.desc.*`, `menu.build`, `menu.hintMove`, `menu.hintSelect`, `menu.keyEnter`,
  `menu.navLabel`, `credits.sourceFonts`, `credits.modifiedNone`, `credits.font*`; `credits.intro` actualizado.
- Verificado: typecheck, test y build del cliente; capturas de Chrome sin cabeza a 1440×900 y 1280×720. Pendiente: verlo en una
  GPU real, el lobby con servidor, la barra de tripulación y las alertas de averías en vivo; pantallas de menos de 1280 px.

## Reto NASA y roadmap nuevo (2026-11-14)

El equipo evaluó Payload frente al reto «Space Mission Design Game» (NASA Space Apps 2026: diseñar, gestionar y simular una
misión y explicar por qué sale bien o mal). Decisión: conservar el juego y reordenar el roadmap para que la partida de
supervivencia sea la *operación* de la misión diseñada (ADR `docs/adr/0015-reto-nasa-y-roadmap.md`).

- **Fase 4 · Diseño de misión y sistema solar: implementada · validada con observaciones · fusionada en `main`** (PR #6, commit `750255a`; ADR 0016). `pnpm validate` 11/11 con **430 tests** (257 shared + 173 client). Diseño de misión antes de zarpar (6 misiones, módulos, instrumentos, lanzadores, Go/No-Go con motivo), sistema solar con 25 cuerpos reales y potencia 1/d², hangar y mapa solar 3D, glosario opcional. Partida clásica idéntica a la fase 3. **Pendiente para la fase 5:** ver «Fase 4 — qué se hizo» y `docs/phases/fase-4.md` § «Pendiente heredado» (el objetivo no termina la partida, avisos sin efecto, Europa/Titán sin vuelta, CubeSat). **Sin verificar por personas:** diseñar una misión en < 10 min, FPS con el mapa solar, tramos con Júpiter/Saturno y los mundos nuevos en superficie.
- **Fase 5 · Ciencia, datos y astronauta articulado:** `docs/phases/fase-5.md` (lista las decisiones que hay que tomar antes de empezar).
- **Fase 6 · Cooperativo 1-4 con roles** (antigua fase 4; ficha `fase-6.md`) y **fase 7 · Pulido y lanzamiento** (antigua fase 5; `fase-7.md`).
- **Regla 6 revisada:** se permiten explicaciones opcionales de una línea (ayuda con tecla, glosario, motivo del Go/No-Go, informe final); nunca lectura obligatoria.
- **Fase 6 · Cooperativo 1-4: base implementada por Harry Hernández e integrada antes de la fase 5** (commit `6272af2` de la rama `feat/f4-cooperativo`, escrita cuando era la fase 4; integrada desde `feat/f6-integrar-cooperativo` el 2026-11-14 en el **PR #9**). Su ADR se renumeró de 0015 a **0017**. Ver «Fase 6 — qué se hizo» y «Fase 6 — pendiente». Los ADR 0009 y 0010 siguen aceptados; el 0017 sustituye el detalle de implementación del 0009. En las notas antiguas de este archivo, el cooperativo que aparece como «fase 4» es ahora la fase 6.
- **Fase 8 · Cordura de la tripulación: implementada en `feat/phase-8-implementation` (2026-11-14), `psych.enabled: true`; `pnpm validate` 11/11 (shared 378, client 195, game-server 25). Falta: validación independiente, prueba visual en navegador y hito con personas.** Ficha `docs/phases/fase-8.md`, diseño detallado `docs/diseno/cordura-tripulacion.md`, fuentes NASA `docs/diseno/cordura-fuentes-nasa.md` y ADR 0019 (propuesta).

Última actualización: **2026-11-15** (corrección del cooperativo y del rendimiento, rama `fix/coop-y-rendimiento`; antes: planeación de la fase 8) · rama `feat/f5-ciencia-y-datos` (desde `main` con la fase 4 y el cooperativo, PR #9, fusionados) · Propuesta: 0.7.0 (fase 4; ver `CHANGELOG.md`). Guía para probar el juego: [`docs/guias/primera-mision.md`](guias/primera-mision.md)

> Léelo antes de empezar y actualízalo al terminar una tarea relevante. Las casillas de
> `docs/phases/fase-*.md` las marca quien valida la fase, no quien implementa: aquí solo se resume.

## Cooperativo publicado — diagnóstico (2026-11-14, rama `feat/f6-diseno-cooperativo`)

- **«Solo deja elegir Partida libre»:** el cliente probado era el de la fase 6 y el servidor de EC2 es el paquete de `main`
  (su lobby no trae `design` ni `designRev` e ignora `set-mission`; comprobado creando una sala contra
  `wss://18-215-99-217.sslip.io`). Arreglo: subir el paquete de esta rama (`bundle:standalone`, `docs/despliegue-aws.md`)
  **a la vez** que el cliente. El lobby ahora avisa si el servidor es antiguo.
- **`WebSocket connection … failed` al crear:** fallos de conexión TCP intermitentes (también en `/matchmake`). Desde la
  misma red fallaban igual el puerto 22 de la instancia y hosts ajenos (API de EC2, GitHub, 1.1.1.1): era la red local, no
  el servidor. El cliente reintenta solo hasta 3 veces. Sin mirar los registros de la instancia (no hay acceso desde aquí).

## Fase 5 — primera entrega (2026-11-14, rama `feat/f5-ciencia-y-datos`)

Decisiones en el ADR 0018 (propuesta: revisarla en equipo). Qué hay:

- **Motor (`science.ts`, `catalog/ciencia.json`):** atracada junto a un cuerpo real (no estación) o posada en él, con
  navegación en línea, los instrumentos generan datos (MB de juego) y ciencia hasta un tope de segundos por cuerpo (45 s
  el destino, en órbita y en superficie por separado; 15 s los demás). Observar entero el destino en órbita da la ciencia
  del diseño; posada, ×1,5 más. Almacenamiento = GB de las computadoras × 16; lleno, lo nuevo se pierde. Ventanas de
  contacto de 35 s cada 90 s (desfase por semilla); bajada = antenas con alcance × 4 × (1 UA / distancia a la Tierra);
  en tierra no hay enlace. La misión termina al volver a la zona de la Tierra tras visitar el destino (lo de a bordo se
  entrega); si la nave se pierde, se pierde lo no bajado. Puntúa solo lo entregado (×20) y +1500 si se cumple el objetivo.
- **Informe (`missionReport`):** resultado y 6 eslabones (destino, energía de los instrumentos, almacenamiento, enlace,
  ciencia, supervivencia), con la causa raíz = primer eslabón que falla.
- **Cliente:** HUD (datos, ciencia, enlace, «Observando X») y pantalla final con el informe; sonidos de los eventos.
- **Balance (`pnpm balance 40 3`):** misiones fáciles cumplidas 90-100 % (tripulación atenta), Marte 95-100 %, cinturón
  30-95 % según diseño y ritmo, Europa 3-18 % y Titán ~0 %: las lejanas siguen pesando por la vuelta (heredado de la
  fase 4). Quien aterriza en el destino entrega 2-3 veces más ciencia. `ligera-a-bennu` nunca llega a Bennu (ya en la
  fase 4: decisión 10 de la ficha). El bot espera a observar; no busca ventanas de contacto a propósito.
- **Sin verificar:** nada de la fase 5 se ha visto en el navegador ni jugado con personas; el cooperativo arranca sin
  diseño, así que en sala no hay ciencia todavía.
- **Segunda entrega (fiabilidad, calor y batería, `rules.operations` de `misiones.json`):** desgaste × `1 + 1,5·(1 −
  fiabilidad)`; demanda por encima de los radiadores → el reactor pierde 0,001 %/s por kW (tope 0,1) y aviso
  `overheat`; la batería cubre la sobrecarga sin daño hasta agotarse (`battery-empty`) y se recarga con el excedente. HUD:
  barra de batería y aviso de calor. **Ajuste:** con 0,03 %/s por kW (primer intento) las misiones largas con aviso
  `thermal` se hundían (Titán llegaba al destino 4/30, Ganimedes 4/30); el calor era la causa (la fiabilidad y la
  batería apenas movían nada). Con 0,001: Europa 17/30 y cinturón 27/30 (como sin efectos); Titán 11/30 (antes 19/30).
- **Test frágil:** `design.test.ts` «300 evaluaciones en menos de un segundo» falló una vez con `pnpm validate` (1,1 s)
  por la carga en paralelo; solo pasa. Si se repite, subir el umbral.
- **Tercera entrega (ADR 0018 § 7-9):** dificultad fácil/normal/difícil en el hangar (presupuesto, plazo, ciencia pedida;
  en vuelo desgaste, peligros y ventanas); el diseño lunar de referencia es No-Go en difícil por ciencia (65 < 72).
  Misión guiada «Tu primer CubeSat» (nave fija, carga entre 4 instrumentos CubeSat, 4 pasos que se marcan solos).
  Astronauta articulado procedural con dos niveles de detalle (jugador y compañeros); el GLB del tripulante ya no se
  carga porque no tiene esqueleto.
- **Visto en el navegador (Chrome, 2026-11-14):** hangar de la misión guiada (pasos, Go), partida con el HUD de batería,
  datos, ciencia y enlace, el astronauta en 3ª persona en reposo y andando, y el informe final al perder la nave (causa
  «No se llegó a Luna»). Sin errores en consola. **No visto:** una misión completa jugada hasta el final con éxito, el
  calor en pantalla, los compañeros articulados en sala, FPS en GPU real.
- **Siguiente:** validación independiente (`validator`), medir FPS y el hito con una persona (una misión completa y el
  informe). Pendiente de decidir: si la dificultad debe elegirse también en la tarjeta de la misión.

## Lo más importante

**Payload es un cooperativo de supervivencia en una nave** (plan en `docs/plan/plan-tripulacion-de-exploracion.md`,
decisión en ADR 0011). El juego se rehízo el 2026-11-09.

- La **fase 1 está fusionada en `main`** (PR #3), y la fase 2 con las herramientas de minería y los minijuegos
  (ADR 0013) entró por el PR #4 (`feat/f2-herramientas-e-interacciones`). La **fase 3 (economía y progresión)**
  está **fusionada en `main`** (PR #5, ADR 0014). La **fase 4 (diseño de misión)** está
  **fusionada** (PR #6) y la base de la **fase 6 (cooperativo)** de Harry Hernández (`feat/f4-cooperativo`) se integra
  en `feat/f6-integrar-cooperativo` (ADR 0017, contrato en `docs/MULTIPLAYER.md`).
- No existe ninguna etiqueta local `v0.3.0-simulador` (`git tag` está vacío): la versión anterior (0.3.0) está en
  el historial, en el commit `76ae5ab` (ADR 0011). Su documentación está en `docs/archivo/v0.3-simulador/`.
- **Fase 2 (exploración de superficie): implementada.** Pendiente de validación independiente final y de prueba
  con jugadores. Nadie ha medido FPS en GPU real, escuchado el audio ni jugado con personas (ver acciones humanas).
- Decisiones de la fase: `docs/adr/0012-superficie-autoridad-dividida.md`; de la mejora: `docs/adr/0013-minijuegos-y-herramientas.md`.
- **Fase 3 (economía y progresión): implementada · validada con observaciones · hito pendiente de prueba con jugadores.**
  Créditos, terminal de estación de pago (venta, suministros, 11 mejoras con contrapartida), ayuda de emergencia
  gratuita (sustituye al servicio gratuito) y la masa a bordo encarece cada salto. `pnpm validate` 11/11, **300 tests**
  (181 + 119). Nadie ha jugado 20 minutos para comprobar el hito ni ha visto el terminal con GPU real. Decisiones: ADR 0014.
- **Fase 4 (diseño de misión y sistema solar) fusionada (PR #6); siguiente: fase 5 (ciencia y datos).** Toda la economía entra como `RunAction` y es determinista (ver «Próximos pasos»).
- **Fase 6 (cooperativo 1-4): base implementada (Harry Hernández) e integrada.** Hay servidor autoritativo
  (`apps/game-server`, Colyseus 0.18), roles con ventajas pasivas, sala privada con código, capa de sesión en el
  cliente, avatares y pings. Tras la integración, `pnpm validate` 11/11 con **472 tests** (274 shared + 18 game-server +
  180 client). Probado por Harry en un solo equipo con dos pestañas de Chrome contra el servidor real; **nadie lo ha jugado
  en red local con varios equipos** ni ha pasado la validación independiente. La sala arranca siempre partidas libres
  (sin diseño). Ver «Fase 6 — qué se hizo».

## Estado por fase

| Fase | Estado |
| --- | --- |
| 1 · Viaje y nave (en solitario) | **Implementada y fusionada en `main`** (PR #3). `pnpm validate` en verde y recorrido manual en Chrome. **Falta:** validación independiente (agente `validator`) y el hito con jugadores. |
| 2 · Exploración de superficie | **Implementada** (commit `d8ce24d` en `feat/f2-superficie`; mejoras sin commitear en `feat/f2-herramientas-e-interacciones`). `pnpm validate` en verde y una pasada del `validator` sin bloqueantes. **Falta:** validación independiente final, la segunda revisión de diseño y el hito con jugadores. |
| 3 · Economía y progresión | **Implementada · validada con observaciones** (rama `feat/f3-economia-progresion`, sin commitear). `pnpm validate` en verde (300 tests) y validación independiente «cumple con observaciones» (sin exploits de dinero ni soft-locks). **Falta:** el hito con jugadores (20 min: vender, >= 2 mejoras, la nave se siente otra), ver el terminal y los créditos en un navegador con GPU real y escuchar los cues. |
| 4 · Diseño de misión y sistema solar | **Implementada · validada con observaciones · fusionada** (PR #6). `pnpm validate` en verde (430 tests). **Falta:** el hito con personas (diseñar una misión en < 10 min), FPS con el mapa solar y las decisiones heredadas para la fase 5. Ficha: `docs/phases/fase-4.md`; decisiones: ADR 0015 y 0016. |
| 5 · Ciencia, datos y astronauta articulado | **En curso** (rama `feat/f5-ciencia-y-datos`, ADR 0018 propuesta). Entregas 1-3 hechas: datos, contacto, fin de misión, puntuación, informe; fiabilidad, calor y batería; dificultad, misión guiada de CubeSat y astronauta articulado. `pnpm validate` en verde (315 + 187 tests). **Falta:** validación independiente, FPS en GPU real y prueba con personas. |
| 6 · Cooperativo 1-4 con roles | **Base implementada (Harry Hernández) · integrada en esta rama antes de la fase 5** (antigua fase 4). Servidor, roles, sala, sesión del cliente, avatares y pings; `pnpm validate` en verde. **Falta:** validación independiente, el hito con cuatro equipos en red local, diseño compartido y voto, y lo listado en «Fase 6 — pendiente». Ficha: `docs/phases/fase-6.md`; decisiones: ADR 0017. |
| 7 · Pulido y lanzamiento | No iniciada (antigua fase 5). `apps/api` es un marcador. |
| 8 · Cordura de la tripulación | Implementada (rama `feat/phase-8-implementation`, 2026-11-14) · `pnpm validate` en verde · pendiente de validación independiente y prueba con personas. Curva `pnpm balance 100` (cordura media S1-S4): ignora 99/92/68/32, descansa 99/93/82/83. Depende de la fase 6; gancho previsto para las ventanas de contacto de la fase 5. Ficha: `docs/phases/fase-8.md`; diseño: `docs/diseno/cordura-tripulacion.md`; decisión: ADR 0019 (propuesta). |

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

### Fase 3 — qué se hizo (2026-11-13, fusionada en `main` por el PR #5)

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

### Fase 4 — qué se hizo (2026-11-14, rama `feat/f4-diseno-de-mision`, fusionada en el PR #6)

Antes de zarpar se **diseña la misión** (destino, lanzador, módulos e instrumentos) y la partida de supervivencia pasa a ser su operación en un sistema solar real. Decisiones: ADR 0015 y 0016; guía de juego: `docs/guias/primera-mision.md`. Contrato aditivo; sin diseño, `createRun` da la partida clásica.

**Motor (`packages/shared`):**
- `design.ts`: `MissionDesign`, `emptyDesign`, `missionDesignSchema`/`parseMissionDesign`/`normalizeDesign` (`createRun` lanza con un diseño mal formado; las funciones de diseño lo normalizan a vacío), `computeDesignBudgets` (masa, potencia, coste, calendario, ranuras y combustible con «¿por qué?» de una línea), `reviewDesign` (Go/No-Go con bloqueos y avisos) y `shipFromDesign` (la nave de la partida). La potencia se mide en el **peor punto de la ruta** (`routeWorstSunDistance`: Luna/asteroide Ryugu 1,19 UA, Marte Schiaparelli 1,524, cinturón Psique 2,92, Júpiter Galileo 5,203, Saturno Huygens 9,537; `DesignTotals.worstAu/worstBodyId/solarKwAtWorst/powerAtWorstKw`, mensaje `design.why.power.worst`). `rules.maxShieldAbsorb` limita el blindaje.
- `solar.ts`: `generateSolarSector` (ruta por zonas, ida y vuelta, `missionTarget` en el destino), potencia solar 1/d² (`solarPowerFactor`, `solarKw`, `shipPowerKw`), `bodyPositionAu`, `solarNodePositionsAu`.
- Catálogos: `misiones.json` (6), `modulos.json` (22), `instrumentos.json` (13), `lanzadores.json` (4: Cóndor, Ariete, Cóndor Pesado, Coloso) y `sistema-solar.json` (25 cuerpos con fuente NASA + 7 estaciones ficticias). Mundos `mars-surface`, `ice-moon`, `titan-surface` y `enceladus-surface` con `weight: 0` (solo sistema solar; el esquema admite 0 y exige que cada tipo aterrizable tenga algún mundo con peso > 0). Júpiter y Saturno no son aterrizables.
- Fixtures por misión (`src/__tests__/fixtures/missions/`) con >= 2 diseños válidos y fallos por causas distintas.

**Cliente (`apps/client`):**
- Menú («Diseñar una misión» / «Partida libre») → misiones → **hangar de diseño** (`ui/MissionScreens.tsx`, `scenes/HangarScene.tsx`, `game/missionDesign.ts`, `game/hangarLayout.ts`): paleta en grupos, medidores vivos con vista previa, Go/No-Go, «Lanzar» solo con Go, guardado `payload.design.<misión>`, H «¿por qué?», G glosario de 14 términos (`ui/Glossary.tsx`, `game/glossary.ts`) → partida → «Rediseñar» / «Reintentar la misión» en el fin de partida.
- **Mapa solar 3D** (`scenes/SolarMapScene.tsx`, `game/solarScale.ts`: escala 10·√UA); el `StarMap` SVG queda solo en la partida libre. HUD con UA y potencia de los paneles; unidades «u» en lugar de años luz. `baseShipOf` (la nave base sale del diseño), `isLandableNode`, caché LRU de etiquetas (`game/lru.ts`).
- Atajos: `?design=1&mission=<id>` (hangar) y `?play=1&seed=7&mission=<id>` (partida con el diseño de referencia de los fixtures y, si no hay, el último guardado; solo desarrollo).

**Validación independiente:** «cumple con observaciones» (lo abierto está en `docs/phases/fase-4.md` § «Pendiente heredado»).

## Métricas verificadas (2026-11-14, fase 4)

| Métrica | Valor |
| --- | --- |
| `pnpm validate` | Verde: 11/11 tareas (typecheck + test + build). Total **430 tests** |
| Tests `@payload/shared` | **257** en 11 archivos |
| Tests `@payload/client` | **173** en 6 archivos |
| Partida clásica | Idéntica bit a bit a la fase 3 (validador: 28 partidas, mismo hash); perfiles de `pnpm balance` iguales a la línea base de la fase 3 |
| Sin verificar | Diseñar una misión en < 10 min con personas, FPS con el mapa solar (dos `<Canvas>`), tramos con Júpiter y Saturno, mundos nuevos en superficie |

### Balance por misión (`pnpm balance 100 3`, tripulación 3,5 s)

Ruta completa = 2·(zonas−1) tramos. Columnas: % que acaba la ruta / % que llega al objetivo.

| Misión | Diseño | Ruta / objetivo |
| --- | --- | --- |
| Luna | `alas-solares-y-radar` | 100 / 100 |
| Luna | `ionica-estandar` | 100 / 100 |
| Asteroide | `taladro-camara-e-infrarrojo-a-ryugu` | 100 / 100 |
| Asteroide | `ligera-a-bennu` | 98 / 8 |
| Marte | `tres-alas-solares` | 100 / 100 |
| Marte | `hibrida-rtg` | 100 / 100 |
| Cinturón | `fision-doble-rtg-blindada` | 91 / 100 |
| Cinturón | `fision-rtg-justa-de-potencia` | 74 / 97 |
| Europa | `coloso-nuclear-completa` | 8 / 87 |
| Europa | `ligera-sin-escudos-a-ganimedes` | 5 / 40 |
| Titán | `quimica-con-fision-y-rtg` | 1 / 53 |
| Titán | `ionica-con-dos-reactores` | 0 / 37 |

Problemas que enseña la tabla: `ligera-a-bennu` casi nunca llega a Bennu; en Europa y Titán casi todas las partidas se pierden en la **vuelta** (varada o casco). Los No-Go representativos se pierden en vuelo (paneles en Júpiter: 90 pérdidas por casco; solo RTG en Titán: 100; sin combustible de vuelta en Marte: 100 % varadas). El No-Go `antena-corta` del cinturón juega igual que un Go porque el enlace aún no tiene efecto (fase 5).

### Fase 6 — qué se hizo (2026-11-13, Harry Hernández, rama `feat/f4-cooperativo`; integrada el 2026-11-14)

Hasta cuatro personas juegan la misma partida: el servidor corre el motor y los clientes lo reflejan. Decisiones en
ADR 0017; contrato de red en `docs/MULTIPLAYER.md`. Contrato del motor aditivo.

**Motor (`packages/shared`):**
- **Roles** en datos (`catalog/roles.json`, `roles.ts`): piloto (esquiva a mitad de combustible, roces −25 %), ingeniero
  (repara ×1,3), explorador (mochila ×1,25, jetpack −20 %) y gestor de recursos (sin ventaja por ahora).
  `createRun({ crewSize, roles })`, `CrewMember.role`, y `crewId?` en `work-incident`, `repair-system` y `evade`.
  Sin roles (solitario, bot de balance) nada cambia: las cifras de balance son las de `main`.
- **`Run.hydrate(state)`**: copia un estado recibido por red en una partida local (espejo del cliente).
- **`net.ts`**: mensajes, límites (`COOP_LIMITS`) y validación de lo que llega de la red; código de sala de 4 caracteres.

**Servidor (`apps/game-server`, antes un marcador):**
- `roomModel.ts` (puro): lobby (rol único y opcional, listo, anfitrión), una `Run` con un tripulante por jugador, el
  servidor impone el `crewId` de quien actúa, presupuesto de trabajo mantenido (no más que el tiempo real), caídas y
  salidas, vuelta al lobby tras perder, poses y pings.
- `CrewRoom.ts` (Colyseus 0.18): sala privada `crew`, código = `roomId`, tick de 10 Hz que difunde el estado entero
  (≈ 3 kB; el sector solo cuando cambia), reconexión con 60 s de gracia, bloqueo al empezar.
- Tests: paridad sala-motor (mismo estado y eventos), antiabuso y, con servidor y cuatro clientes SDK reales,
  sincronía, rechazos, poses, pings y reconexión.

**Cliente (`apps/client`):**
- `net/coopSession.ts` y `net/coopStore.ts`; `runStore` en modo espejo (`enterRemote`, `remoteState`, `remoteEvents`):
  `act` valida en local con mi tripulante y envía; la posición y el trabajo mantenido salen agrupados cada 66 ms.
- `game/me.ts` (`myCrew`): todo lo «mío» deja de ser `crew[0]`. `effectiveRulesOf` incluye la ventaja de mi rol.
- `ui/CoopScreen.tsx`: Menú → Cooperativo (nombre, crear sala, entrar con código), lobby y `CrewBar` en partida.
  Fin de partida en sala: el anfitrión devuelve a todos al lobby.
- `scenes/CrewAvatars.tsx`: compañeros (astronauta simple con el color del rol) y pings (tecla G) en la nave y fuera.
- `pnpm dev:server` y `pnpm dev:lan` en la raíz.

**Comprobado a mano (Chrome, un equipo, servidor real):** crear sala, entrar con código desde otra pestaña, rol
ocupado rechazado, empezar, saltar y apagar un sistema a través del servidor, barra de tripulación y avatar del
compañero visibles, sin errores en consola.

**Integración con la fase 4 (2026-11-14):** `Catalog` lleva `roles` y los campos del diseño; `createRun` admite
`roles` y `design` a la vez. La sala arranca siempre una **partida libre** (clásica). El espejo del cliente
(`runStore.enterRemote`) se crea con el `missionDesign` del estado si lo trae (test de `hydrate` con diseño en
`packages/shared/src/__tests__/coop.test.ts`), así que permitir misiones en sala solo exige que el lobby y el
servidor elijan el diseño. En sala, el fin de partida no ofrece «Rediseñar». El menú tiene «Diseñar una misión»,
«Partida libre» y «Cooperativo».

### Fase 6 — pendiente

- **Diseño compartido y Go/No-Go con voto** (alcance de la fase 6 tras el ADR 0015): hoy el anfitrión no puede elegir
  misión ni diseño; la sala juega la partida libre. Los roles por disciplina tampoco existen.

- **Hito sin probar:** cuatro equipos en red local completando un sector. Solo se ha visto con dos pestañas en un equipo.
- **Validación independiente** (agente `validator`) y marcar las casillas de `docs/phases/fase-6.md`.
- **La superficie en sala no se ha jugado:** descenso con varios, dos tripulantes fuera a la vez, avatares en la
  superficie y despegue con todos a bordo solo están cubiertos por los tests del motor, no vistos en pantalla.
- **Minijuegos con latencia** (esquiva, averías): funcionan por diseño (el cliente informa el resultado), sin probar en red.
- **Avatares provisionales:** sin animación ni nombre flotante; el aspecto se vio en una sola captura. Todos aparecen
  en el mismo punto de la nave y no hay colisión entre jugadores.
- **Pings:** solo «mirad aquí» (G) tiene tecla; `danger` y `help` existen en el contrato pero no en la interfaz. Sin sonido.
- **Tripulante muerto:** quien muere fuera se queda mirando la escena sin poder hacer nada (no hay modo espectador).
- **Quien se va con su tripulante fuera** bloquea el despegue hasta que se le acaba el oxígeno.
- **Recargar la página pierde el sitio** (el SDK solo reconecta con la pestaña abierta); no se guarda el token.
- **El chunk inicial del cliente creció** de 0,53 a 0,59 MB; revisar si el SDK queda fuera del arranque.

## Métricas verificadas (2026-11-13, fase 6 en la rama de Harry, antes de integrar)

| Métrica | Valor |
| --- | --- |
| `pnpm validate` | Verde: 11/11 tareas. Total **341 tests** |
| Tests `@payload/shared` | **197** en 9 archivos (`coop` nuevo) |
| Tests `@payload/game-server` | **18** en 2 archivos (`roomModel`, `network`) |
| Tests `@payload/client` | **126** en 6 archivos (`coop` nuevo) |
| Mensaje `state` | ≈ 2,4 kB atracada y ≈ 3,5 kB en tránsito (sin el sector, ≈ 1,8 kB), 10 por segundo |
| Balance | Sin cambios respecto a la fase 3 (sin roles el motor es el mismo) |
| Sin verificar | Red local con varios equipos, latencia real, superficie en sala, FPS con avatares |

## Métricas verificadas (2026-11-14, integración fase 4 + fase 6)

| Métrica | Valor |
| --- | --- |
| `pnpm validate` | Verde: 11/11 tareas. Total **472 tests** |
| Tests `@payload/shared` | **274** en 12 archivos (257 de la fase 4 + 16 de `coop` + 1 de `hydrate` con diseño) |
| Tests `@payload/game-server` | **18** en 2 archivos |
| Tests `@payload/client` | **180** en 7 archivos (173 + 7 de `coop`) |
| Balance (`pnpm balance 100 3`) | Perfiles clásicos y por misión idénticos a `main` (los roles no se usan en solitario ni en el bot) |
| Sin verificar | Sala con varios clientes reales en navegador tras la integración, red local, superficie en sala |

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

F4-a. **Hito de la fase 4:** que una persona nueva diseñe una misión en < 10 min (`pnpm dev`, «Diseñar una misión»; guía en `docs/guias/primera-mision.md`; atajo `?design=1&mission=mission-lunar-ice`): ¿entiende por qué sale No-Go con la línea de H? ¿lo que diseñó es lo que juega?
F4-b. **Medir FPS** del mapa solar abierto en GPU real (dos `<Canvas>`), jugar un tramo con Júpiter y Saturno y entrar en superficie en Marte, hielo, Titán y Encélado (mundos nuevos).
F4-c. **Decidir las cuestiones heredadas** de la fase 4 antes de empezar la 5 (ver `docs/phases/fase-5.md` § «Decisiones que debe tomar la fase 5»).
F6-a. **Hito de la fase 6 (cooperativo):** cuatro personas en cuatro equipos de la misma red (`pnpm dev:server` y `pnpm dev:lan` en uno; los demás abren `http://<ip>:5173`) completan un sector. ¿Se desincroniza algo? ¿se nota el retardo al reparar o esquivar?
F6-b. **Jugar la superficie en sala** con al menos dos personas fuera a la vez y mirar los avatares en la nave y fuera.
F6-c. **Decidir** la ventaja del gestor de recursos, quién puede gastar créditos y qué pasa con el tripulante de quien se va, y cómo se elige y vota el diseño de misión en sala.
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
7. **Abrir el PR** de `feat/f4-cooperativo` cuando se decida (la rama está subida). (La fase 3 ya entró por el PR #5.)
8. **Probar con ratón capturado** (pointer lock) en una sesión real.
9. **Mirar el rediseño gráfico y opinar** (`?play=1&seed=7&body=<tipo>`): brillo, color y legibilidad, otras semillas.
10. **ERIZON** (CC-BY-NC-ND): decidir si se sustituye antes de cualquier uso comercial.
11. **Crear `.claude/settings.json` compartido** (contenido propuesto en `docs/CONTRIBUTING.md`).

## Decisiones de diseño abiertas

- **Fase 4 (a decidir en la fase 5):** condición de éxito de la misión (`missionTarget` aún no termina ni puntúa; la ruta se repite); efecto de `thermal`, `reliability`, `no-battery`, `comms-range` y del fallo de lanzamiento (hoy solo avisan o no hacen nada); Europa y Titán casi no completan la vuelta y `ligera-a-bennu` llega al objetivo el 8 %; gravedades escaladas a la jugabilidad (Encélado 0,5 frente a 0,11, Ceres 0,6 frente a 0,28, Ío 2,4 frente a 1,8, cuerpos pequeños 0,4); los paneles escalan con la salud del reactor; dos `<Canvas>` con el mapa abierto; misión guiada de CubeSat con otra escala de módulos.

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
- **Cooperativo (fase 6), a decidir con jugadores:**
  - **El gestor de recursos no tiene ventaja pasiva** (el plan solo define las de piloto, ingeniero y explorador).
  - **Cualquiera puede gastar los créditos** de la tripulación; la propuesta de que lidere el gestor no está en el juego.
  - **Jugar sin rol es válido** y una persona sola en sala con rol va algo mejor que en solitario (tiene una ventaja).
  - **La dificultad no escala** con el número de jugadores (descartado en `fase-6.md`): cuatro personas lo tendrán más fácil.
  - **No hay pausa en sala** y los que se caen no detienen la partida mientras quede alguien conectado.
- **Cordura (fase 8), a decidir antes de implementar** (detalle en `docs/diseno/cordura-tripulacion.md` § 15):
  - Nombre visible: «Cordura» o «Ánimo»/«Tensión» (se recomienda «Ánimo» en la interfaz).
  - Si entra el evento ficticio del «tercer trimestre» (sin respaldo NASA; por defecto desactivado).
  - Integración con las ventanas de contacto de la fase 5: ¿la llamada a la Tierra compite con la bajada de datos?
  - Cohesión solo en el motor (recomendado) o también por cercanía con poses desde el servidor.
- **Sin tutorial.** Solo ayuda con H y carteles. Decidir tras la prueba con jugadores.
- **El mapa solo se abre en la mesa del puente** (hay que ir andando). Es deliberado, pero puede resultar pesado.
- **Los sistemas apagados por el jugador no se encienden solos** tras una sobrecarga: decidir si es buena fricción.
- **Capacidad de carga** (`suit.carryCapacityKg`, hoy 110 kg; lo raro pesa 8-10 kg): a revisar con jugadores (¿se llega al tope antes que al O₂?).
- **Curva de «apurar»** (pendiente del crítico): entre 25 % y 3 % de margen de O₂ solo se gana ~+25 % de valor por salida (213 → 265) a costa de pasar de 0 % a 35 % de muertes. Palancas aplazadas: raros en filones o racha no lineal; decidir con datos de personas.
- **Dos salidas tranquilas rinden algo más que una apurada** (por aterrizaje, el prudente saca 413 puntos y «hasta vaciar» 488 frente a 549 del codicioso, que muere el 49 %): vigilar con jugadores.
- **Explorar baja la supervivencia:** sector 3 con exploración, 85-86 % frente a 92 % sin explorar.
- **La mena ya no es relleno:** con los repuestos llenos se vende (4 créditos por unidad), pero pesa y encarece cada salto; vale poco frente a cristales (14) y muestras (24).
- **Accesibilidad:** hay intensidad de efectos y tres ajustes separados (esquiva simple, averías simples, puntería ancha), pero no hay mando, táctil ni remapeo de teclas (fase 7).
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

## Hangar con nave realista (2026-11-15, rama `feat/f4-hangar-nave-realista`)

La pantalla de diseño ahora monta una sonda creíble pieza a pieza (grúa, soldadura, despliegue) en un hangar con torre y focos.
Detalle en `apps/client/CLAUDE.md` § «Escena del hangar». Typecheck, 205 tests del cliente y build en verde; revisado en el navegador
(misiones lunar y de Titán, diseño vacío y uno grande). **Sin verificar:** el destello de soldadura en pantalla, FPS en GPU real.
**Pendiente:** brazo robótico (solo hay grúa), cajas de aviónica que se solapan si se pasa del límite de ranuras, banco de instrumentos poco
visible desde la altura de la cámara.

## Despliegue

- **Cliente: publicado** en AWS Amplify Hosting (`https://main.d24izpi0hbzbl0.amplifyapp.com/`, rama `main`, se publica
  sola al fusionar). Configuración: `amplify.yml`, `customHttp.yml`. Guía: `docs/despliegue-aws.md`.
- **Servidor del cooperativo: publicado** (2026-11-14) en EC2 `payload-game` con Caddy en `wss://18-215-99-217.sslip.io`; Amplify lleva `VITE_GAME_SERVER_URL`. Sala creada y unida con el código desde la página publicada. Detalle y cómo actualizarlo: `docs/despliegue-aws.md` § «En producción». Pendiente: limitar el puerto 22 y decidir si se activan las deploy keys en `katsevi` para actualizar con `git pull`.
- **Licencia:** `programme_erizon.glb` es CC-BY-NC-ND y impide el uso comercial; hay que sustituirlo antes de un despliegue comercial (acción humana 10).

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

0. **Fase 5 (ciencia, datos y astronauta articulado):** empezar por `docs/phases/fase-5.md` § «Decisiones que debe tomar la fase 5» y un ADR 0018 (el 0017 es el del cooperativo); el punto de partida (campos de datos de instrumentos, antenas y computadoras, `missionTarget`) está en esa ficha y en ADR 0016 § 4. Antes, el hito de la fase 4 con personas (F4-a) y la medida de FPS (F4-b).
   - **Fase 8 (cordura), más adelante:** revisar y aceptar el ADR 0019 resolviendo las decisiones abiertas de `docs/phases/fase-8.md`; empezar cuando la fase 6 esté validada. Orden de agentes en `docs/diseno/cordura-tripulacion.md` § 14.

### Cooperativo (fase 6, base integrada en el PR #9)

- **Diseño compartido y voto (2026-11-14, rama `feat/f6-diseno-cooperativo`, ADR 0020 propuesta):** el anfitrión elige la
  misión en el lobby; todos editan en el hangar (ediciones discretas validadas por el motor, sin pisarse); voto Go/No-Go
  con mayoría estricta (empate = No-Go) y Go del motor; la partida arranca con el diseño y su ciencia; al terminar la
  misión se vuelve al lobby con el diseño. Probado en Chrome con dos pestañas (CubeSat guiado: dos ediciones a la vez,
  2/2 Go, partida en los dos espejos). **Falta:** roles por disciplina, probar con 3-4 equipos en red local, modo espectador
  y reanudar tras recargar.

- **Cómo probar la sala:** `pnpm dev:server` (ws://localhost:2567) y `pnpm dev` (o `pnpm dev:lan` para otros equipos); Menú → Cooperativo → Crear sala → en otra pestaña o equipo, escribir el código → Estoy listo → el anfitrión pulsa Empezar expedición. Probado con 2 pestañas en un equipo; falta con 3-4 jugadores y en red local.
- **Siguiente paso de la fase 6:** roles por disciplina en el diseño, el hito con 3-4 equipos en red local y la validación.
- **Despliegue:** el servidor necesita WebSockets y no va en Amplify (ver `docs/despliegue-aws.md`).


1. Cerrar la fase 2: segunda revisión de diseño, validación independiente final, prueba con jugadores y medida de FPS;
   ajustar `catalog/mundos.json` con `pnpm balance` (ver `.claude/skills/add-catalog-item`).
2. La prueba con jugadores de la fase 1.
3. Cerrar la fase 3 (fusionada en `main`): prueba de 20 minutos con personas y ajuste de precios y mejoras (`economia.json`, `mejoras.json`) con `pnpm balance`.
4. Fase 6: probar en red local, pasar el `validator` y resolver «Fase 6 — pendiente» (diseño compartido y voto, espectador, reanudación tras recargar, pings de peligro y ayuda, avatares). Contrato: `docs/MULTIPLAYER.md`.
5. **Lo que el cooperativo debe saber de la economía** (para `docs/MULTIPLAYER.md` y `apps/game-server`):
   - Todo el comercio entra como `RunAction` (`sell`, `buy-supply`, `buy-upgrade`, `service`) y es determinista: la oferta sale de semilla + sector + nodo, sin azar propio del servidor. El motor valida estación, créditos y oferta, así que el servidor solo reenvía acciones.
   - `run.stationQuote()` es la fuente única de precios y oferta; `effectiveShip()` y `effectiveSurfaceRules()`, de la nave y las reglas con mejoras. El cliente no calcula cifras y el servidor debe usar las mismas.
   - Los **créditos y las mejoras son de la tripulación** (un único `RunState`, compartidos). Falta decidir quién gasta: propuesta, el rol «gestor de recursos» lidera el terminal, sin bloqueo rígido (como pide `docs/phases/fase-6.md`). El motor ya rechaza compras duplicadas o sin créditos.
   - `RunState.credits` y `upgrades` son obligatorios: cualquier `RunState` armado a mano (fixtures, red) debe incluirlos.
   - El terminal **no pausa** el juego: la nave sigue viva mientras se compra.
