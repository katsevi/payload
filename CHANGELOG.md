# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.
Cada entrada se agrupa por paquete.

## [Sin publicar]

### Audio inmersivo (rama `feat/audio-inmersivo`)
- **client:** el salto ya no satura: arranque y crucero suaves en lugar de ruido blanco fuerte todo el tránsito; limitador
  en el master, ducking de la música con los avisos, bucles que bajan en pausa y ruido descorrelado.
- **client:** música adaptativa generativa por escena (menú, hangar, a bordo, tránsito, aterrizaje, EVA, victoria, derrota)
  con escalada de peligro en 3 escalones.
- **client:** todos los efectos rediseñados y 38 sonidos nuevos (pasos, interfaz, mapa, paneles, hangar, radio, sala…),
  con subtítulos es/en donde informan.
- **client:** laboratorio de audio offline sin dependencias (`audio:report`) y test de regresión contra clipping, clics y
  ruido de banda ancha. Rúbrica y validación en `docs/diseno/`.

### Corrección del cooperativo y del rendimiento (rama `fix/coop-y-rendimiento`)
- **game-server:** el cuarto jugador ya puede entrar. Colyseus bloqueaba la sala sola en cuanto clientes + asientos
  reservados llegaban a 4, y un intento de conexión fallido (el cliente reintenta) dejaba un asiento reservado 15 s:
  el cuarto recibía «sala bloqueada», que el cliente mostraba como «la partida ya ha empezado». Ahora el cupo de
  Colyseus tiene holgura (8) y el límite de 4 lo pone `RoomModel` (`room-full`).
- **game-server:** el anfitrión es quien crea la sala y no cambia por una caída (conserva el sitio durante la gracia);
  solo pasa a otro si se va del todo. Si el creador vuelve a entrar con el código, recupera el anfitrión gracias a una
  clave privada por pestaña (`key` en las opciones de entrada; no se difunde).
- **client:** sin tirones de 1-3 s al aparecer o apagarse una avería (sus luces estaban dentro de grupos que se
  ocultaban y three.js recompilaba todos los shaders al cambiar el número de luces) ni al aterrizar o despegar (la vista
  posada y el espacio tienen ahora las mismas luces). Precompilación de shaders en paralelo (`gfx/quality.tsx`,
  `ShaderWarmup`) al montar la nave y la superficie, resolución adaptativa (`PerformanceMonitor`) y fundido a negro
  entre escenas (nave ↔ descenso ↔ EVA) que tapa el montaje. El terreno se reutiliza entre escenas, las herramientas no
  se montan en el descenso y las texturas de roca se preparan en el puente.
- **client:** menos parpadeo de paredes: el dintel de las puertas tiene colisión (la cámara en 3ª persona lo
  atravesaba), el pivote de la cámara no entra en las paredes, la cámara no sube hasta las tuberías del techo, plano
  cercano a 8 cm y separadas las caras coplanares encontradas (remates de las lámparas, pantallas de las consolas).

### Rediseño del sistema visual de la interfaz (`@payload/client`)
- Sistema de diseño en `index.css` (tokens fríos con estados ok/ámbar/rojo, chaflanes, líneas de 1 px, barras segmentadas, etiquetas de ficha técnica, entradas cortas que respetan `prefers-reduced-motion`) y kit `ui/kit.tsx` (`Button`, `SegBar`, `Tag`, `KeyHint`, `StatRow`, `SectionLabel`, `Tabs`, `Toast`); `Panel` con cabecera de código y `Modal` con fondo desenfocado.
- Menú principal nuevo: logotipo tipográfico, navegación lateral con índice y teclado (↑↓ + Intro), ficha con la descripción de la entrada señalada, versión y teclas; la galaxia del fondo pasa a la derecha.
- Misiones como expedientes, hangar, ajustes, créditos, ayuda, pausa, fin de partida tipo informe, cooperativo, mapa estelar y solar, terminal, panel de energía, glosario y HUD de nave, superficie y descenso con el nuevo estilo (sin cambios de lógica ni de información).
- Tipografías OFL 1.1 empaquetadas (Chakra Petch, Barlow, JetBrains Mono vía `@fontsource`), registradas en `assets/CREDITS.md` y en la pantalla de créditos.

### Hangar con nave realista (`@payload/client`)
- El hangar del diseño de misión pinta una sonda creíble en lugar de bloques: modelo procedural por familia (bus octogonal con MLI, tobera o propulsores iónicos, alas solares con celdas, RTG y reactor con radiadores, antena parabólica o de látigo, radiadores, escudo Whipple o generador, tanques en cercha, instrumentos bajo la proa), variantes deducidas de los datos del catálogo.
- Montaje pieza a pieza: cada pieza baja de la grúa, se suelda con chispas y se despliega; al quitarla se retira. Fantasma holográfico de la pieza señalada, bastidor vacío sin estructura y hangar con torre de servicio, grúa puente, focos y plataforma giratoria. Archivos nuevos: `gfx/probeModels.ts`, `gfx/hangarShaders.ts`, `scenes/HangarEnv.tsx`; tests en `__tests__/hangar.test.ts`.

## Fase 8 · Cordura de la tripulación

Rama `feat/phase-8-implementation` (2026-11-14). Diseño: `docs/diseno/cordura-tripulacion.md`; ADR 0019 (propuesta).

### Añadido
- **shared:** `sanity.ts` (bandas con histéresis, drenaje por peligros RIDGE, debuffs, lapsus deterministas, llamada según retraso, cohesión), `catalog/cordura.json`, estado aditivo en `CrewMember`/`RunState.psych`, acciones `rest`, `call-earth` y `buy-provisions`, mejoras con target `crew`, módulos `habitat-cabin` y `greenhouse-pod`, aviso `crew-wellbeing`, perks del gestor, `psychPolicy` en el bot y métricas en `pnpm balance`. Nunca mata ni hace perder.
- **game-server:** `rest` y `call-earth` como acciones de tripulante y de trabajo.
- **client:** medidor «Ánimo», puestos de litera y comunicaciones, provisiones en la terminal, viñeta por banda con ajuste «Reducir efectos de estrés», filas en la pantalla final y tip de ayuda.

## Fase 6 · Diseño compartido y voto Go/No-Go en sala

Rama `feat/f6-diseno-cooperativo` (2026-11-14, desde la fase 5). Decisiones: ADR 0020 (propuesta).

### Añadido
- `@payload/shared`: `sharedDesign.ts` (`DesignEdit`, `applyDesignEdit`, `designEditsBetween`, `missionStartDesign`, `parseDesignEdit`, `voteTally`); `LobbyAction` `set-mission`, `edit-design` y `vote`; `LobbyView.design`/`designRev`; `CoopPlayer.vote`. Tests `sharedDesign.test.ts`.
- `@payload/game-server`: la sala guarda el diseño y los votos, solo zarpa con Go del motor y mayoría estricta de Go (empate = No-Go), crea la partida con el diseño y vuelve al lobby también al terminar la misión. Tests de lobby, voto y paridad con diseño.
- `@payload/client`: en el lobby, misión (la elige el anfitrión), estado del diseño, «Abrir el hangar» y voto; el hangar en modo compartido envía ediciones, refleja las de los demás y sustituye «Lanzar» por el voto. Tests de sesión con diseño compartido.

### Corregido
- `@payload/client`: con un servidor anterior a la fase 6 (sin `designRev`), el selector de misión del lobby volvía solo a «Partida libre» sin decir por qué; ahora se oculta y avisa en una línea de que hay que actualizar el servidor (`missionsSupported`).
- `@payload/client`: crear o entrar en una sala reintenta solo hasta 3 veces (`CONNECT_ATTEMPTS`) si la conexión no llega (`WebSocket connection … failed` con redes que pierden conexiones); una sala llena, empezada o inexistente no se reintenta.
- `design.test.ts` «300 evaluaciones en menos de un segundo» medía también la lectura de los fixtures del disco (fallaba con carga); ahora solo mide la revisión.

### Despliegue en producción
- Servidor del cooperativo publicado en EC2 (Caddy, `wss://18-215-99-217.sslip.io`) y conectado al cliente de Amplify. Script `pnpm --filter @payload/game-server bundle:standalone` (paquete autocontenido) y guía para actualizarlo sin acceso al repo.

### Despliegue del servidor de juego
- `apps/game-server/deploy/`: servicio systemd (`payload-game.service`), `Caddyfile` (HTTPS automático y proxy de WebSocket) y `update.sh`. `docs/despliegue-aws.md` explica cómo publicar el servidor en AWS Lightsail y conectar el cliente de Amplify con `VITE_GAME_SERVER_URL`; explica también el timeout del cooperativo cuando falta.

## Fase 5 · Ciencia, datos y astronauta articulado (entregas 1-3)

Rama `feat/f5-ciencia-y-datos` (2026-11-14). Decisiones: ADR 0018 (propuesta).

### Añadido

#### `@payload/shared`
- `science.ts`: observación (atracada junto a un cuerpo o posada en él, con navegación en línea; tope de segundos por cuerpo), almacenamiento con tope (lo que no cabe se pierde), ventanas de contacto deterministas por semilla, tasa de bajada según antenas y distancia (sin enlace en tierra), `missionReport` (resultado y hasta 6 eslabones). Catálogo `catalog/ciencia.json`.
- Partida con diseño: `state.science`; la misión termina al volver a la zona de la Tierra tras visitar el destino (`phase` `won`, `science.over`, `reject.missionOver`); al volver se entrega lo de a bordo; perder la nave pierde lo no bajado. `computeScore` suma `stats.sciencePoints` (ciencia entregada × 20 y bonus de éxito 1500). Sin diseño nada cambia.
- Eventos `observation-done`, `storage-full`, `contact-start`, `objective-met`, `mission-complete` (success/partial). Textos `report.*` en es/en.
- Bot: espera atracado a que acaben de observar; termina al cerrar la misión. `pnpm balance` muestra misiones cumplidas, parciales y ciencia media. Tests `science.test.ts` (15) y umbral de balance de la fase 5; total 292.

- Segunda entrega (ADR 0018 § 6, `catalog/misiones.json` → `rules.operations`): la fiabilidad del diseño multiplica el desgaste (`1 + 1,5·(1 − fiabilidad)`); con la demanda por encima de los radiadores el reactor se desgasta despacio (0,001 %/s por kW, tope 0,1) y se avisa (`overheat`); la batería cubre el déficit de una sobrecarga sin daño hasta agotarse (`battery-empty`) y se recarga con el excedente. `designOperations(design)`. Tests `operations.test.ts` (8); total 300.

- Tercera entrega (ADR 0018 § 7-9): niveles de dificultad (`rules.difficulties`, `MissionDesign.difficultyId`, `getDifficulty`, `missionAtDifficulty`) que escalan presupuesto, plazo, ciencia mínima, desgaste, peligros y ventanas; misión guiada «Tu primer CubeSat» (`MissionDef.guided`, cuatro instrumentos `cubesat`, `guidedStartDesign`, `guidedProgress`, bloqueos `guided-ship`/`guided-instrument`) con su fixture. Tests `difficulty.test.ts` (11); total 315.

#### `@payload/client`
- Hangar: selector de dificultad; en la misión guiada, nave fija, paleta solo con sus instrumentos CubeSat y pasos que se marcan solos; etiqueta «Guiada» en su tarjeta.
- Astronauta articulado procedural (`models/ArticulatedAstronaut.tsx`, pose pura en `game/astronautPose.ts`) con dos niveles de detalle: el jugador en 3ª persona (alto) y los compañeros del cooperativo (bajo). El GLB del tripulante ya no se carga. Tests `astronaut.test.ts`; total 187.
- HUD con diseño: batería (kWh) y aviso de calor (demanda/disipación) bajo la energía; alarma con `overheat` y `battery-empty`.
- HUD con diseño: datos a bordo/capacidad, ciencia entregada/pedida, enlace (bajando, próxima ventana, sin alcance) y qué se observa.
- Pantalla final: «¡Misión cumplida!» / «Misión incompleta» e informe con la causa raíz resaltada; al terminar la misión, «Reintentar la misión» en vez de saltar de sector. Sonidos de los eventos nuevos. Total 180 tests.

### Despliegue
- Configuración de AWS Amplify Hosting: `amplify.yml` (Node de `.nvmrc`, pnpm por corepack, build del cliente) y `customHttp.yml` (caché por tipo de archivo y cabeceras de seguridad). Guía en `docs/despliegue-aws.md`.

### Documentación
- Planeación de la fase 8 · Cordura de la tripulación (sin código): diseño detallado `docs/diseno/cordura-tripulacion.md`, fuentes NASA `docs/diseno/cordura-fuentes-nasa.md`, ficha `docs/phases/fase-8.md` y ADR 0019 (propuesta). Índices actualizados: README de fases, índice de ADR, STATUS, GDD y CLAUDE.md.

## Fase 6 · Cooperativo 1-4 (Harry Hernández, integrado en el PR #9)

Commit `6272af2` de Harry Hernández (rama `feat/f4-cooperativo`, 2026-11-13, escrita cuando el cooperativo era la fase 4), integrado en `main` el 2026-11-14 desde `feat/f6-integrar-cooperativo`, **antes de la fase 5**. Decisiones: ADR 0017 (escrito como 0015; renumerado al integrarlo). Contrato de red: `docs/MULTIPLAYER.md`.

### Añadido

#### `@payload/shared`
- Roles de tripulación en datos (`catalog/roles.json`, `roles.ts`): `ROLE_IDS`, `RoleDef`, `RolePerks`, `Catalog.roles`, `CrewMember.role`, `RunOptions.roles`; `crewId` opcional en `work-incident`, `repair-system` y `evade` para aplicar la ventaja de quien actúa. Sin roles el motor se comporta igual.
- `Run.hydrate(state)`: espejo de una partida recibida por red.
- `net.ts`: contrato de red del cooperativo (mensajes, `COOP_LIMITS`, validación, código de sala).
- Tests `coop.test.ts` (en la rama original, 197 tests en 9 archivos).

#### `@payload/game-server`
- Deja de ser un marcador: servidor autoritativo con Colyseus 0.18. `RoomModel` (lógica pura de sala) y `CrewRoom` (adaptador): sala privada con código de 4 caracteres, lobby con roles, partida compartida a 10 Hz, reconexión con 60 s de gracia, antiabuso del trabajo mantenido, poses y pings.
- Tests de paridad sala-motor y de red con clientes reales; 18 en 2 archivos.

#### `@payload/client`
- Cooperativo desde el menú: crear sala o entrar con código, lobby con roles y listo, barra de tripulación en partida, avatares de los compañeros y ping con G.
- `net/coopSession.ts`, `net/coopStore.ts`, `game/me.ts` (`myCrew`) y `runStore` en modo espejo.
- Tests `coop.test.ts` (en la rama original, 126 tests en 6 archivos).

#### Raíz
- Scripts `pnpm dev:server` y `pnpm dev:lan`.

### Cambiado
- El cliente ya no asume un único tripulante (`crew[0]`): lee el suyo con `myCrew`.
- El menú sustituye el aviso «cooperativo en una fase posterior» por el botón Cooperativo (junto a «Diseñar una misión» y «Partida libre»).

### Pendiente
- Prueba en red local con cuatro equipos, validación independiente y la lista de «Fase 6 — pendiente» de `docs/STATUS.md`. Diseño compartido y Go/No-Go con voto: la sala arranca siempre una partida libre.

### Integración con la fase 4
- `Catalog` lleva a la vez `roles` y los campos del diseño de misión; `RunOptions` admite `roles` y `design` juntos.
- El espejo del cliente (`runStore.enterRemote`) se crea con el `missionDesign` del estado recibido si lo trae; test de `hydrate` con diseño en `packages/shared/src/__tests__/coop.test.ts`. La sala sigue arrancando partidas libres.
- `effectiveRulesOf` combina la nave base del diseño (`baseShipOf`) con la ventaja de rol de mi tripulante.
- En sala, el fin de partida no ofrece «Rediseñar» (saldría de la sala).

## Fase 4 · Diseño de misión y sistema solar

Versión propuesta: **0.7.0** (rama `feat/f4-diseno-de-mision`, 2026-11-14; **fusionada en `main`, PR #6**). Decisiones: ADR 0015 (reto NASA y roadmap) y ADR 0016. Guía de juego: `docs/guias/primera-mision.md`. `pnpm validate` 11/11 con 430 tests (257 shared en 11 archivos + 173 client en 6); partida clásica idéntica bit a bit a la fase 3.

### Añadido

#### `@payload/shared`
- Diseño de misión antes de zarpar (`design.ts`): `MissionDesign`, `computeDesignBudgets` (masa, potencia en el peor punto de la ruta, coste, plazo, ranuras, combustible), `reviewDesign` (Go/No-Go con motivo de una línea por problema), `shipFromDesign`, `emptyDesign` y esquema zod del diseño. `createRun({ seed, design })` es aditivo: sin diseño la partida es idéntica a la de `main`.
- Sistema solar como mapa (`solar.ts`): `generateSolarSector`, ruta por zonas Tierra ↔ destino, potencia solar 1/d² (paneles frente a RTG), `bodyPositionAu` y `solarNodePositionsAu`.
- Catálogos `misiones.json` (6 misiones), `modulos.json`, `instrumentos.json`, `lanzadores.json` y `sistema-solar.json` (25 cuerpos con datos de NASA). Mundos `mars-surface`, `ice-moon`, `titan-surface` y `enceladus-surface` con `weight: 0` (solo para el sistema solar).
- Esquema del diseño: `missionDesignSchema`, `parseMissionDesign` y `normalizeDesign` (`createRun` lanza con un diseño mal formado; las funciones de diseño lo normalizan a vacío). `rules.maxShieldAbsorb` limita el blindaje.
- La potencia del Go/No-Go se mide en el **peor punto de la ruta** (`routeWorstSunDistance`, `DesignTotals.worstAu/worstBodyId/solarKwAtWorst/powerAtWorstKw`, mensaje `design.why.power.worst`): Luna y asteroide Ryugu 1,19 UA, Marte Schiaparelli 1,524, cinturón Psique 2,92, Júpiter Galileo 5,203, Saturno Huygens 9,537.
- Júpiter y Saturno no son aterrizables; los mundos `mars-surface`, `ice-moon`, `titan-surface` y `enceladus-surface` tienen `weight: 0` (solo sistema solar; el esquema admite 0 y exige que cada tipo aterrizable tenga algún mundo con peso > 0).
- Fixtures por misión con ≥ 2 diseños válidos y fallos por causas distintas; balance por misión con ruta completa (2·(zonas−1) tramos) y % que llega al objetivo (`pnpm balance 100 3`): Luna 100/100 (ambos diseños), asteroide a Ryugu 100/100 y a Bennu 98/8, Marte 100/100, cinturón 91/100 y 74/97, Europa 8/87 y 5/40, Titán 1/53 y 0/37 (ruta completa / objetivo, en %).

#### `@payload/client`
- Menú → misiones → hangar de diseño (paleta por tipo, medidores, Go/No-Go, «Lanzar» solo con Go, guardado por misión) → partida → «Rediseñar». «Partida libre» conserva el modo clásico.
- Mapa del sistema solar en 3D (escala 10·√UA) en partidas con diseño; HUD con distancia al Sol y potencia de los paneles; glosario opcional de 14 términos (G o «?»); paletas de los mundos nuevos. «Rediseñar» y «Reintentar la misión» en el fin de partida.
- Atajos de desarrollo `?design=1&mission=<id>` y `?play=1&seed=7&mission=<id>`.

### Conocido (pendiente para la fase 5)
- El objetivo de la misión (`missionTarget`) no termina ni puntúa la partida y la ruta se repite; `thermal`, `reliability` y `no-battery` solo avisan y el enlace (`comms-range`) no tiene efecto en vuelo. Europa y Titán casi no completan la vuelta y `ligera-a-bennu` llega al objetivo el 8 %. Detalle en `docs/phases/fase-4.md` § «Pendiente heredado».

### Cambiado
- Roadmap: fase 4 diseño y sistema solar, 5 ciencia y astronauta, 6 cooperativo, 7 pulido (ADR 0015). La regla 6 admite explicaciones opcionales de una línea.
- La nave base del cliente sale del diseño (`baseShipOf`) y la barra de energía usa la potencia real según la distancia al Sol.

## Fase 3 · Economía y progresión

Versión propuesta: **0.6.0** (rama `feat/f3-economia-progresion`, 2026-11-13, sin commitear). Decisiones: ADR 0014.

### Añadido

#### `@payload/shared`
- Economía: `RunState.credits` y `RunState.upgrades`; acciones `sell`, `buy-supply` (combustible, casco, repuestos) y `buy-upgrade`; eventos `sale`, `purchase`, `upgrade` y `reward`; `Run.stationQuote()` (precios, oferta, `powerMarginDeltaKw` y `overloadsAtCruise` por mejora), `effectiveShip()`, `effectiveSurfaceRules()` y `cruisePowerMarginKw`. Módulo `economy.ts`.
- Catálogos `catalog/economia.json` (créditos iniciales 60, contrato de 65 por sector, venta hielo 1 / mena 4 / cristal 14 / muestra 24, suministros combustible 1 / casco 1,2 / repuesto 15, multiplicador por sector +0,2 venta y +0,15 compra, ayuda de emergencia, oferta de 5) y `catalog/mejoras.json` (11 mejoras con niveles y contrapartida). `parseCatalog` los rellena por defecto si faltan.
- `NodeKindDef.shop` (marca las estaciones con terminal); oferta de mejoras determinista por semilla, sector y nodo, con flujo de azar propio.
- Estadísticas opcionales `creditsEarned`, `creditsSpent`, `unitsSold` y `upgradesBought`; `ShipState.cargoKg`; `cargoKg` y `cargoFuelMult` en `estimateJump`.
- Bot de balance con política de economía según el estado de la nave. Tests nuevos `economy.test.ts`; total 181 en 8 archivos.

#### `@payload/client`
- Terminal de estación (`ui/StationTerminal.tsx`): venta | tienda y mejoras, una línea de efecto por mejora y aviso de sobrecarga, con teclado; se abre con E en la esclusa atracado en una estación o desde el mapa, y no pausa el juego.
- `ui/Credits.tsx` (`CreditsBadge` en HUD, mapa y terminal; `UpgradeStrip`), resumen de economía en el fin de partida, «+N % por carga» en el mapa, `game/shop.ts` y `game/effective.ts`, cues `sale`, `purchase`, `upgrade` y `noCredits`.
- Depuración: `?play=1&seed=7&station=1` (`&station=bare`) y `__payload.toStation()`. Tests nuevos `shop.test.ts`; total 119 en 5 archivos.

### Cambiado
- `service` deja de ser el servicio completo gratuito: pasa a **ayuda de emergencia** gratuita, una vez por estación (75 % del depósito, 50 % del casco, 1 repuesto). `NodeKindDef.service` queda obsoleto.
- La masa de la bodega y de las mejoras encarece el combustible de cada salto (× (1 + kg / 1000)).
- Hielo y mena se siguen convirtiendo al guardarse; el sobrante va a la bodega y se vende. La mena deja de ser relleno.
- Los créditos y las mejoras no puntúan; vender no suma ni resta puntos.
- Balance (`pnpm balance 200 3`): tripulación rápida S1 100 % · S2 99 % · S3 90 % (antes 100/100/92); lenta S3 71 % (antes 73); explorador prudente S3 82 % (antes 83) con 3,6 mejoras por partida.
- Documentación: ADR 0014, STATUS, GDD § 6 y § 11, ARCHITECTURE, `docs/phases/fase-3.md`, agentes y skill `add-catalog-item`.

### Corregido (tras la validación independiente)
- Tests de las dos mejoras nuevas, bot que las compra, aviso de sobrecarga en el terminal, rechazo de compra duplicada, cierre del overlay y tope de carga efectivo en `isStranded`.

### Mejora fuera del plan: herramientas de minería y minijuegos (rama `feat/f2-herramientas-e-interacciones`, 2026-11-12)

Decisiones: ADR 0013. Pedido del usuario: menos interacciones repetitivas con E y una minería creíble.

#### `@payload/shared`
- Herramientas desplegables (`surface.tools` en `mundos.json`, `material.tool`): concentrador solar (hielo; se para con tormenta) y taladro láser (mena, cristal, muestra). Acciones `deploy-tool` y `retrieve-tool`; estado `surface.tools` y `crew[].tools`; eventos `tool-*`. Extracción a paso fijo (4/5/5/6 s por unidad); lo que queda fuera al entrar se pierde y se repone al aterrizar. Mochila de 110 kg.
- Filones: lo raro se agrupa en 2-3 vetas a 8-15 m (`rules.lodes`, `Deposit.lodeId`). Completar un filón en la misma salida da ×1,5 a la última veta (`lodes.completeMult`, `lodeProgress`, `CrewMember.lodeVeinsDone`, subtipo `lode`).
- Hielo escaso también en la luna volcánica y el mundo de tormentas.
- Esquiva por habilidad: `evade {grazes}`, aviso con `etaS`, `evadeSeed` y `evadeDifficulty`; reglas en `averias.json` (`hazards.impact.evade`); eventos `impact-evaded` e `impact-hit` con subtipo.
- Bot de balance con herramientas, tiempo quieto por salida y perfiles de minijuegos (`shipSkill`: medio, simple, torpe) con umbral en `balance.test.ts`. Tests: 148 en 7 archivos.

#### `@payload/client`
- Esquiva en el holograma del timón (WASD) de duración fija (3 s, se juega si quedan >= 3,4 s); llegar tarde aplica un resultado tardío con roces, nunca limpio; flecha hacia el timón y pitido repetido con el aviso.
- Averías con interacción propia: extintor apuntado (fuego), pulsos de sincronía (cortocircuito, dos aciertos), mantener y soltar en la zona de presión (fuga); repuesto con R en dos tramos.
- Accesibilidad en tres ajustes: esquiva simple, averías simples y puntería ancha.
- `SurfaceTools`, `ToolIcon`, brújula de herramientas, brújula de oxígeno que cuenta el rodeo (cuatro estados), avisos y sonidos; avance del filón («2/3») en el HUD y marca en la veta que lo completa. Tests: 100 en 4 archivos (`minigames.test.ts` nuevo).

### Cambiado (mejora)
- `collect` ya no se mantiene: recoge lo que la herramienta ha extraído (el campo `seconds` queda opcional e ignorado). Se retira la clave de mensaje `event.collected`.
- Teclas: E usar, abrir, colocar o recoger; Q alternativa (régimen, soltar carga, retirar herramienta); clic o Espacio la habilidad; R reparar con repuesto. Ya no se mantiene E para recoger ni para arreglar averías (la reparación se hace con su minijuego).

## Fase 2 (resto de lo sin publicar)

Versión propuesta: **0.5.0**, fase 2 «Exploración de superficie» (rama `feat/f2-superficie`, 2026-11-12). Decisiones: ADR 0012.

### Añadido

#### `@payload/shared`
- Contrato aditivo de superficie: `RunPhase` `landing` y `surface`, `LossReason` `crew`, `WorldDef`, `MaterialDef`, `SurfaceRules`, `CrewMember`, `SurfaceState`, `Deposit`, `UnstableZone`, `LandingEstimate` y `TakeOffEstimate`; `RunAction` `land`, `set-descent-brake`, `eva-exit`, `eva-enter`, `set-position`, `jetpack`, `fall-impact`, `collect`, `jettison` y `take-off`; `RunEvent.subtype`; `Run.estimateLanding()` y `estimateTakeOff()`; `createRun({ crewSize })`.
- Catálogo `catalog/mundos.json` (zod, opcional): 7 mundos, 4 materiales y reglas de descenso, despegue, traje, jetpack, caídas, terreno inestable y racha.
- `surface.ts`: mundo y superficie deterministas por nodo, física del descenso y perfil de frenado de referencia, combustible de despegue, racha y relleno del traje.
- Partida: descenso con freno, EVA con oxígeno de traje y jetpack, caídas, tormentas pre-sorteadas, terreno inestable, recogida por mantener, bodega con suministros y puntuación de materiales, despegue, derrota por muerte de toda la tripulación y varada en superficie. La nave sigue viva durante la salida.
- Mensajes de superficie en es/en. Tests nuevos `surface.test.ts` (motor); total 127 en 7 archivos.
- Bot de balance con `explore: 'prudent' | 'greedy' | 'thorough'`, resumen por aterrizaje y curva «margen de O₂ → valor y muertes» en `pnpm balance`.

#### `@payload/client`
- Escenas `SurfaceScene` (descenso y EVA) y `SurfaceWorld` (carga diferida, con Rapier), `ShipExterior`, `ShipCargo` (bodega visible) y `ui/SurfaceHud`.
- Terreno determinista (`game/terrain.ts`), movimiento con jetpack (`game/motion.ts`), reglas de superficie (`game/surfaceRules.ts`), ruido y depuración; capa gráfica de superficie (`gfx/surfaceShaders.ts`, `surfaceLook.ts`, `rocks.ts`).
- Esclusa como noveno puesto; timón con descenso y despegue; mapa con mundo y gravedad de cada destino aterrizable.
- Controles: **Espacio** (salto, jetpack y freno de caída) y **C** (bajar con el jetpack). Ajustes de accesibilidad: intensidad de efectos y recoger con una pulsación.
- Depuración: `?play=1&seed=7&surface=1|descent|landed` y `__payload.toSurface()`. Tests nuevos `surface.test.ts`; total 82 en 3 archivos.

#### `@payload/client`
- Capa gráfica procedural `src/gfx/`: texturas de canvas, materiales compartidos, `Builder` (piezas fusionadas en una malla por material), ruido GLSL y shaders de nave, efectos y espacio. Sin assets ni dependencias nuevas.
- El destino del salto se ve acercarse por la proa en el último tramo del viaje.
- Depuración: `__payload.teleport(x, z)` y `?body=<tipo>` para revisar la escena.

#### Herramientas
- Skills genéricas de three.js `threejs-*` (13, de `cloudai-x/threejs-skills`) en `.claude/skills/`, fijadas en `skills-lock.json`. La skill `3d-models` se mantiene y prevalece en assets (meshopt, licencias, ERIZON ND).

### Cambiado

#### Documentación
- ADR 0012; fase 2, GDD § 10-11, arquitectura y estado al día; `docs/CONTRIBUTING.md`: modelos de los agentes corregidos (`client-3d` opus, `validator` sonnet).

#### `@payload/shared`
- `computeScore` suma los puntos de los materiales guardados a bordo. Los perfiles de balance de la fase 1 no cambian.

#### `@payload/client`
- Se pinta la escena según la fase (`sceneFor`): puente, descenso o superficie. Audio ampliado (propulsor, jetpack, viento, tormenta, respiración, pitido de O₂, despegue).
- Rediseño visual de la nave: casco con cuadernas, vigas, conductos, cristales y mirador de proa; los ocho puestos remodelados y mostrando el estado del motor (palancas, medidor de carga, radar, galones de régimen, palas de los motores); reflejos de entorno y sombras de contacto. Distribución, colisiones e interacción sin cambios.
- Efectos de avería nuevos (llamas, pavesas, humo, chispas, arcos, chorro de gas) y luminarias por zona.
- Exterior nuevo: cielo de nebulosas por sector, estrella cercana, planetas procedurales con atmósfera y anillos, luna con cráteres, asteroides instanciados, nebulosa, pecio y portal con vórtice. Menú con el mismo cielo.
- `ShipInterior.tsx` se divide: el casco queda ahí y los puestos pasan a `ShipStations.tsx`; los cuerpos celestes, a `SpaceBodies.tsx`.

## [0.4.0] - 2026-11-10

**Reinicio del juego.** Payload deja de ser un simulador de diseño de misiones y pasa a ser un cooperativo
de supervivencia en una nave exploradora (plan: `docs/plan/plan-tripulacion-de-exploracion.md`; decisión:
ADR 0011). Esta versión es la **fase 1 nueva: viaje interplanetario y nave, en solitario**. La versión
anterior queda en la etiqueta `v0.3.0-simulador` y su documentación en `docs/archivo/v0.3-simulador/`.

### Añadido

#### `@payload/shared`
- Contrato nuevo (`types.ts`): nave, sistemas, régimen de motores, averías, sector, `RunState`, `RunAction`, `RunEvent`.
- Catálogo nuevo en JSON con zod: `naves.json`, `averias.json`, `destinos.json` (estación, planeta, luna, campo de asteroides, nebulosa, nave abandonada, portal) y `sectores.json`.
- `generateSector` / `isSectorSolvable`: mapa de sector determinista con ruta completable garantizada.
- `createRun`: partida en tiempo real con paso fijo de 0,1 s y determinista. Viaje por régimen (económico, crucero, máxima), energía con sobrecarga y apagón, fuego que se propaga, cortocircuitos que se incendian, fugas de oxígeno, impactos con aviso y maniobra evasiva, escudos, repuestos, servicio de estación, contenedores a la deriva, portal y sectores crecientes, permadeath (casco, oxígeno, nave varada) y puntuación.
- Mensajes del motor en es/en, todos de una línea.
- Tripulante simulado para balance (`src/__tests__/bot.ts`) y comando `pnpm balance`.
- 69 tests en 6 archivos.

#### `@payload/client`
- Interior de la nave caminable en 1ª/3ª persona: puente (timón, mapa estelar, navegación), cubierta media (soporte vital, escudos) y sala de máquinas (panel de energía, reactor, motores).
- Interacción por proximidad con E (pulsar o mantener) y Q; mapa estelar; panel de energía (teclas 1-4); HUD mínimo; pantallas de menú, ayuda, pausa y fin de sector/expedición; mejor marca guardada.
- Efectos: fuego, chispas, gas, luces de alarma por zona, estelas del salto, sacudida en impactos, carteles en el mundo y el destino visible por la proa (la estación ERIZON al atracar en una estación).
- Audio procedural adaptado: efectos por evento del motor y música según el peligro.
- 22 tests en 2 archivos.

### Cambiado
- Regla 6 del proyecto: del «¿por qué?» escrito de cada valor a «se juega, no se lee» (mensajes de una línea).
- `PlayerController`: límites de cámara por parámetro, sacudida, y física con paso variable (corrige que el personaje fuera más lento en pantallas de 120/144 Hz).
- Roadmap nuevo en `docs/phases/` (5 fases) y documentación reescrita: README, GDD, ARCHITECTURE, STATUS, CONTRIBUTING, `CLAUDE.md` de cada paquete, agentes y skills.

### Eliminado
- Motor de diseño de misiones (presupuestos, Go/No-Go, simulación orbital, puntuación, informe, asesores, pedagogía, lógica de equipo) y su catálogo (componentes, órbitas, lanzadores, escenarios, glosario, mascota Orbi, Academia).
- Prototipo de la fase 0 (`prototype/`, `pnpm proto`) y `pnpm --filter @payload/shared bench`.
- Cliente anterior (hangar, lanzamiento, órbita, sala, Academia, mascota, vista del instrumento, modo accesible 2D).
- Servidor Colyseus: `apps/game-server` vuelve a ser un marcador hasta la fase 4; se quita `pnpm dev:server`.
- Dependencias: `xstate`, `@xstate/react`, `@colyseus/*`, `@react-three/postprocessing`, `exceljs`.

> Las entradas siguientes describen el simulador anterior (ver `docs/archivo/v0.3-simulador/`); los
> documentos que citan se movieron allí.

## [0.3.0] - 2026-11-09

Fase 3 (multijugador). Contrato: `docs/archivo/v0.3-simulador/MULTIPLAYER.md`. Decisiones: ADR 0009 y 0010.

### Añadido

#### `@payload/shared`
- Lógica de equipo pura y sin reloj (`team.ts`): roles y permisos (`ROLE_PERMISSIONS`, `RESOURCE_OWNER`, `ROLE_SUBSYSTEMS`), `combineRoles`, `checkTeamAction` (solicitudes automáticas y explícitas), `applyApprovedRequest` con **aprobaciones encadenadas**, reparto de presupuesto por subsistema (`defaultAllocation`, `validateAllocation`), votación Go/No-Go con motivo (`validateVote`, `tallyGoNoGo`), alertas de equipo (`EVENT_RESPONSE_ROLES`, `alertForEvent`, `ackAlert`), `scoreCollaboration` y `withCollaboration` (la colaboración va fuera de `MissionResult`), `sanitizePlayerText`.
- `teamWire.ts`: `RoomView`, `RoomStateWire`, `encodeRoomView`/`decodeRoomView` y `teamActionSchema`/`parseTeamAction` (zod).
- Constantes de sala (`TEAM_LIMITS`, `TEAM_TIME_SCALES`, `TEAM_MASCOT_TRIGGERS`, `TEAM_ACTION_PHASES`…) y mensajes `sim:team.*` en es/en.
- `ScenarioDef.team { minPlayers, maxPlayers }` (cambio aditivo del contrato) y disparadores de mascota `team:*` y `role:*`.
- Historial de solicitudes con tope (`TEAM_LIMITS.requestHistory` = 100 cerradas; las abiertas nunca se purgan): `purgeRequests` + `CollaborationInput.purged` (la nota de colaboración no cambia al purgar).
- Límite de solicitudes como cubeta de fichas: `requestBurst` (3) con `requestMinIntervalS` (2) (`takeRequestToken`, `team.reject.requestRateLimited { seconds }`).
- 335 tests en 18 archivos (antes 237 en 16).

#### `@payload/game-server`
- Servidor autoritativo Colyseus 0.18 (sala `mission`, hasta 4 jugadores) que corre el mismo motor: `RoomModel` (modelo puro), `MissionRoom` (adaptador), `schema.ts` (esquema que refleja `RoomStateWire`, escritura incremental), `mascotDirector` (mascota única por sala), `options`, `server` e `index`.
- Sala privada por código (`roomId`) y partida rápida por escenario; bloqueo al salir del lobby; reconexión con gracia de 60 s; reparto de los roles de quien se va solo a jugadores conectados; límites anti-abuso (40 mensajes/s, solicitudes, piezas, chat, ping, `move`).
- Variables `PORT`, `HOST` y `PAYLOAD_ALLOW_SEED`; script raíz `pnpm dev:server` (`ws://localhost:2567`).
- La lista de solicitudes solo se escribe con `setRequests` (purga incremental); cubeta de fichas por jugador (las solicitudes encadenadas al aprobar no gastan fichas).
- 78 tests en 7 archivos: `parity` (la sala da el mismo `MissionResult` que `runMission`), `roomModel`, `mascot`, `schema`, `options`, `network` (servidor real + clientes SDK) y `abuse`.

#### `@payload/client`
- Capa `net/`: interfaz `MissionSession` con `LocalSession` (solitario) y `RoomSession` (sala), `useRoom`, `canDo`, espejo de la simulación (nunca pasa del `simT` del servidor) y SDK de Colyseus en carga diferida (chunk propio). `VITE_GAME_SERVER_URL` o `ws(s)://<hostname>:2567`.
- UI de sala (`room/`, textos `room.*` en es/en): «Jugar en equipo», sala privada y partida rápida, lobby, `TeamBar`, chat (`T`), solicitudes (`R`), reparto de presupuesto, pings (`P`), alertas, votación con motivo del No-Go y colaboración en el informe; reintento tras una caída.
- `ControlRoomScene` (sala de control con avatares), `RoomAvatars` (avatares y pings en el hangar), `NoticeBanner`; atajo de desarrollo `?room=demo`.
- `room.error.locked` (sala llena o ya empezada: Colyseus responde 522 «is locked») distinto de `notFound`; reintento tras una caída (`useRoom.retry`, `retryRoom`, `dismissRetry`, banner con «Reintentar»/«Descartar»); en 3D la pieza vuelve a la mano si el servidor rechaza el montaje; en 2D, enfriamiento de 2 s de los «+» que piden permiso; escenarios de equipo ocultos en la campaña en solitario y destacados en «Jugar en equipo».
- 122 tests en 8 archivos (antes 67 en 5): `net`, `room-ui` y `room-e2e` (app real + 3 clientes SDK contra el servidor real; también 5.º jugador, entrada tras empezar y código inexistente).

#### Contenido del catálogo
- Escenario de equipo `polar-ice-watch-team` (2-4 jugadores; oculto en la campaña en solitario): 7 escenarios en total.
- Glosario 28 -> 38 entradas y mascota Orbi 74 -> 108 diálogos (incluye `team:*` y `role:*`).

#### Documentación
- ADR 0009 (servidor autoritativo con Colyseus) y ADR 0010 (un proceso, sin Redis por ahora); `docs/MULTIPLAYER.md`; `docs/phases/fase-3.md` con casillas marcadas.

#### Dependencias
- `apps/game-server`: `@colyseus/core` 0.18.27, `@colyseus/ws-transport` 0.18.4, `@colyseus/schema` 5.0.45; dev `@colyseus/sdk` 0.18.9, `vitest`, `tsx`, `esbuild`, `typescript`, `@types/node`.
- `apps/client`: `@colyseus/sdk` 0.18.9.
- `pnpm-workspace.yaml`: `allowBuilds.msgpackr-extract: false` (acelerador nativo opcional de msgpackr: se usa la versión JS y no se ejecutan scripts de instalación de terceros).

### Cambiado
- Los escenarios con `team.minPlayers >= 2` no se ofrecen en la campaña en solitario.
- `apps/game-server` deja de ser un marcador.

### Problemas conocidos
Ver `docs/STATUS.md`: hito sin hacer (misión completa con 4 personas reales en equipos distintos); voz WebRTC no implementada (opcional); sin pings en la vista orbital; reloj de sala estimado por el cliente; UI de sala con paneles que tapan la sala por debajo de `lg`; sin Redis (un proceso).

## [0.2.0] - 2026-11-08

Fase 2 (contenido y aprendizaje). Estado, métricas y acciones pendientes: `docs/STATUS.md`. Decisiones: ADR 0008.

### Añadido

#### `@payload/shared`
- Eventos aleatorios ponderados por dificultad (`EVENT_TABLES`, `ScenarioDef.eventTuning`): sobrecalentamiento, falla de componente (fiabilidad x radiación; degradan sin destruir), retraso de lanzamiento y recorte de presupuesto (`rollPreLaunchEvents`, `MissionSimOptions.preLaunch`, tercer argumento de `computeBudgets`). `deriveSeed` para flujos de azar separados.
- Rueda de reacción con star tracker: apuntado de respaldo 1°/2°/5° (`wheelBackupPointingDeg`).
- Fase orbital de Kepler (`orbitPhase`, `meanPhase`, `altitudeKm`; `solveKeplerEquation`, `trueAnomalyFromMeanAnomaly`, `orbitPhaseAt`).
- Contenido pedagógico como datos zod: `glosario.json`, `mascota.json`, `academia.json` (`catalog.glossary/mascot/academy`, opcionales); `adviseByRole`, `pickMascotDialogue`, `evaluateAcademyStep`, `getGlossaryEntry`.
- Catálogo: 5 escenarios de campaña + `academy-cubesat-leo`, 43 componentes (16 nuevos, incl. `payload-surface-rover`), 7 lanzadores (Zorzal, Pampero, Jaguar), 28 entradas de glosario, mascota original Orbi (74 diálogos) y Academia de 21 pasos.
- Fixtures por escenario (`src/__tests__/fixtures/scenarios/`) y `scenarios.test.ts`; 237 tests en 16 archivos.
- ADR 0008.

#### `@payload/client`
- Selector de escenarios, intento persistente por escenario (`state/progress.ts`) y fase `prelaunch` con `PreLaunchScreen`.
- Mascota (`src/mascot`, tecla `H`), Academia (`src/academy`), asesores por rol y glosario (tecla `G`).
- Audio procedural con Web Audio (`src/audio`): música adaptativa de 5 capas, 13 efectos, emisores 3D, buses y volúmenes, silenciar, subtítulos de sonido y flashes visuales.
- Vista del instrumento (tecla `I`, `src/instrument`) y `SurfaceScene` con Aurora G9 en las misiones lunar y Marte.
- 67 tests en 5 archivos (`phase2.test.ts`, `phase2b.test.ts`).

#### `assets/`
- Aurora G9 como `payload-surface-rover`; secciones Aurora fase 2 y Audio en `CREDITS.md`; `.gitattributes` con `*.ogg binary`.

### Cambiado
- Puntuación: penalización por agotamientos de batería (`energyCriterion`; `warn-power-storm` 91,7 -> 63,2 con la semilla por defecto) y criterio de vida lineal 75 % -> 100 % (`lifetimeCriterion`).
- `orbitPhase` pasa a ser la anomalía verdadera / 2π (antes fase uniforme); el tiempo de la simulación sigue en anomalía media, así que los presupuestos no cambian (ADR 0008 §6).
- La semilla de una partida es `defaultSeed + intento`, con el intento persistido por escenario (antes se reiniciaba a 0).
- `OrbitScene` dibuja la órbita de Kepler con arco de eclipse; cotas de `catalog.test` subidas (<= 50 componentes, <= 8 lanzadores).
- Skill `3d-models` portable (sin `stat -c` ni `realpath`) y con sección "Usar un modelo en una escena"; `CREDITS.md` corregido (columna Cambios).

### Corregido
- Incoherencia entre falla de rueda y ADCS; Academia saltable (revisión bloqueada hasta `step-go`); paso de lanzamiento (`step-launch`); "Rediseñar" en la Academia; desenfoque de la vista del instrumento; el rover contaba en `payloadCount`; fugas de listeners del audio; consumo de CPU de la música (se paran capas con volumen 0).

### Problemas conocidos
Ver `docs/STATUS.md`: hito con estudiantes sin hacer; audio sin escuchar; lanzamiento, `PreLaunchScreen` y superficie sin verificar en pantalla; chunk `HangarScene` 2,28 MB; mascota sin modelo 3D; Rise no incluida (requiere autorización de NASA).

## [0.1.0] - 2026-11-07

Fases 0 (preproducción) y 1 (rebanada vertical en solitario). Estado y acciones pendientes: `docs/STATUS.md`.

### Añadido

#### Repositorio y documentación
- Monorepo pnpm + Turborepo (`apps/*`, `packages/*`), TypeScript estricto, `.nvmrc` (Node 24), `engines.node >= 22`.
- `docs/GDD.md`, `docs/phases/` (fases 0-4), ADR 0001-0007, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, `README.md` y `CLAUDE.md` por paquete.
- Agentes del proyecto (`sim-engine`, `client-3d`, `content-designer`, `asset-pipeline`, `validator`, `docs-writer`) y skills (`3d-models`, `validate`, `add-catalog-item`) en `.claude/`.
- Marcadores `apps/game-server` (fase 3) y `apps/api` (fase 4), sin código.

#### `@payload/shared` (motor)
- Contrato de dominio `src/types.ts` (catálogo, diseño, presupuestos, simulación, informe, `MessageRef`).
- Catálogo JSON validado con zod: 27 componentes, 6 órbitas, 4 lanzadores y 1 escenario LEO, en es/en con su "¿por qué?".
- Mecánica orbital: periodo de Kepler, eclipse, contacto con estación (elevación mínima 10°).
- `computeBudgets` (masa, energía, batería, presupuesto, tiempo, datos, comunicaciones, vida) con margen, estado y `why`.
- `reviewGoNoGo` con bloqueadores, avisos e información, incluido el aviso `power-storm`.
- Simulación determinista con paso fijo de 30 s (`createMissionSim`, `runMission`), baterías con desgaste y agotamiento, eventos pre-sorteados (tormenta solar, basura espacial, falla de rueda de reacción) y `createRng(seed)`.
- `scoreMission` (objetivos, ciencia, eficiencia, colaboración) y `buildReport` con cadena de causas.
- i18n del motor (namespace `sim`, es/en), `formatMessage` y anidamiento `$t(catalog.{{id}})`.
- 140 tests en 10 archivos (incluye pureza, determinismo, paridad es/en y balance de diseños) y `bench` de rendimiento.

#### `@payload/client`
- Flujo de misión con máquina XState: menú, briefing, hangar, revisión Go/No-Go, lanzamiento, operación e informe, con "Rediseñar".
- Hangar caminable en 1ª/3ª persona (Rapier, transición de cámara de 0,4 s), montaje de piezas en estantes y nave procedural.
- Panel de recursos (`Tab`), selector de órbita y lanzador, escena de lanzamiento, escena orbital con aceleración temporal 0×-10 000×.
- Informe con puntuación y cadena de causas; ayuda `H`; ajustes (idioma, FOV, balanceo, sensibilidad, sombras); pantalla de créditos.
- Modo accesible 2D equivalente a todo el flujo.
- i18n es/en (namespace `ui`) sin recargar; stores Zustand; carga diferida de escenas y modelos pesados.
- 9 tests en 3 archivos (paridad i18n, flujo de la máquina, integración con el motor).
- Atajos de desarrollo `?phase=briefing|design|launch|operation|report` (solo `pnpm dev`).

#### `assets/`
- 4 modelos GLB de Sketchfab: originales en `models/source/`, optimizados con meshopt en `web/models/` (~11,9 MB servidos); `CREDITS.md` con licencias y aviso CC-BY-NC-ND de ERIZON.

#### `prototype/` (fase 0)
- CLI `pnpm proto` sobre el motor real, hoja de cálculo `payload-prototipo.xlsx` generada desde el catálogo, prototipo en papel y plantilla de registro de pruebas.
- 9 diseños de ejemplo en `prototype/designs/` (válidos, con aviso y que fallan por causas distintas).

### Problemas conocidos
Ver `docs/STATUS.md`: hito de la fase 0 sin probar con personas, `power-storm` demasiado benigno para su efecto real, LEO a 450 km, sin mando/táctil.
