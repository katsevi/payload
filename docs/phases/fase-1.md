# Fase 1 · Rebanada vertical en solitario

**Objetivo:** una misión completa jugable de principio a fin, en solitario, con **un** escenario de observación de la Tierra en órbita baja. Es la fase clave: demuestra el valor del juego antes de invertir en contenido y multijugador.

**Hito de salida:** *una misión completa jugable de principio a fin* (briefing → diseño → Go/No-Go → lanzamiento → operación → informe, y vuelta al diseño).

**Fuera de alcance:** multijugador y roles, mascota, Academia, eventos aleatorios complejos, órbitas distintas de LEO, rankings, cuentas, móviles.

## Entregables

### Motor (`packages/shared`)
- [x] Motor en TypeScript puro (sin React, Three.js, DOM ni Node en `src/`).
- [x] Mecánica orbital con Kepler: periodo, eclipse, órbitas por día, contacto con estación.
- [x] `computeBudgets` devuelve el panel de recursos con margen, estado y `why` (`MessageRef`) por recurso.
- [x] `reviewGoNoGo` con bloqueadores, advertencias e información.
- [x] Simulación determinista con semilla (`createRng`), avanzable por pasos y completa (`runMission`).
- [x] Puntuación ponderada e informe con cadena de causas y sugerencia.
- [x] Catálogo JSON validado con zod; un escenario LEO completo.
- [x] Textos del motor en `locales/{es,en}.json` (namespace `sim`).

### Cliente (`apps/client`)
- [x] Hangar caminable en primera persona y tercera persona (`V`), con avatar astronauta.
- [x] Tomar componentes de estantes y montarlos en la nave.
- [x] Aurora G9 expuesta en el hangar como elemento de ambiente.
- [x] Panel de recursos (`Tab`) con barras de margen, color + texto de estado y "¿por qué?". (✔ 2.ª pasada: unidades con `tu()` — ResourcePanel.tsx:31 — y color por estado — :20-21,35)
- [x] Selección de órbita y lanzador, y revisión Go/No-Go con motivos.
- [x] Lanzamiento (cuenta regresiva y cámara de persecución simple).
- [ ] Operación con aceleración (1× a 10 000×) y pausa; nave en órbita en tercera persona con Vía Láctea de fondo y estación ERIZON. (⚠️ parcial: aceleración, pausa y ERIZON diferido OK (OrbitScene.tsx:151); según la proyección de la cámara por defecto, ERIZON (NDC ≈ −0.72, 0.8) queda debajo del panel «Operación de la misión». No se pudo confirmar en una captura)
- [x] Informe post-misión con puntuación y cadena de causas; botón "Rediseñar".
- [x] Panel 2D equivalente para diseñar sin caminar (modo accesible). (✔ 2.ª pasada: motivos del No-Go en 2D — DesignPanel.tsx:124-137)
- [x] Menú con selector de idioma es/en (español por defecto) y fondo de la Vía Láctea.
- [x] Pantalla de créditos con los tres modelos CC-BY (y ERIZON con su licencia). (✔ 2.ª pasada: enlaces a obra, autor y licencia + indicación de modificación — Screens.tsx:111-125, credits.ts)

### Assets
- [x] Modelos optimizados en `assets/web/models/` (meshopt) con originales intactos en `assets/models/source/`.
- [x] `assets/CREDITS.md` al día. (✔ 2.ª pasada: ERIZON solo con `gltf-transform meshopt`; GLB web con 82 nodos y 51 mallas, igual que el original y sin instancing)

## Criterios de aceptación

**Calidad automática**
- [x] `pnpm validate` (typecheck + test + build) pasa en verde. (✔ 2.ª pasada: `--force` en verde 11/11 y shared en verde 3 de 3 ejecuciones; la medida fina pasa a `pnpm --filter @payload/shared bench`)
- [x] `pnpm test` incluye tests del motor: periodo de LEO a 400 km ≈ 92.6 min (con tolerancia), eclipse, presupuestos, Go/No-Go, puntuación e informe.
- [x] Test de determinismo: misma semilla y diseño → mismo `MissionResult`; el resultado no depende de cómo se trocea `step()`.
- [x] Test de catálogo: hay ≥ 2 diseños válidos y diseños que fallan por ≥ 4 causas distintas.
- [x] Test de paridad es/en: ambos idiomas tienen las mismas claves (`ui` y `sim`).
- [x] No hay `Math.random()` ni `Date.now()` en `packages/shared/src`.

**Jugabilidad (comprobación manual)**
- [ ] Un jugador nuevo completa una misión desde el briefing hasta el informe sin ayuda externa. (❌ acción humana pendiente: prueba manual; la ayuda H del hangar ya está corregida — Huds.tsx:33-35)
- [x] Un diseño con exceso de masa da No-Go y el panel nombra el recurso limitante.
- [x] Un diseño sin batería suficiente falla en operación y el informe explica la cadena de causas (consumo + minutos de eclipse). (✔ 2.ª pasada, verificado con el motor y la semilla que usa el cliente: `warn-power-storm` es Go y en el 2.º intento (defaultSeed+1) falla por desgaste de batería, con cadena consumo 60 W + 36 min de eclipse + tormenta)
- [x] Desde el informe se vuelve al hangar con el diseño anterior cargado y se simula otra vez.
- [x] Cambiar el idioma cambia toda la interfaz y los textos del motor sin recargar. (✔ 2.ª pasada por código: unidades con `tu()` y `fmt` con el idioma del juego — common.tsx:6-7)
- [x] Todo el flujo se puede completar con el panel 2D. (✔ 2.ª pasada)
- [ ] La escena orbital muestra la Vía Láctea y ERIZON; el menú muestra la Vía Láctea. (⚠️ parcial: ERIZON probablemente oculto bajo el panel HUD de arriba a la izquierda en el encuadre inicial (sin confirmar en captura); la Vía Láctea del menú se ve bien)

**Rendimiento y assets**
- [ ] ≥ 50 FPS sostenidos en el hangar en una laptop de gama media (meta 60). (❌ acción humana pendiente: medir en hardware real)
- [ ] Peso total de modelos servidos documentado en `assets/CREDITS.md` o en `docs/STATUS.md`; los modelos grandes (ERIZON, Aurora G9) se cargan de forma diferida. (⚠️ parcial: carga diferida OK (ERIZON solo en órbita con retardo; red: el menú no pide `programme_erizon.glb`), pero el peso servido (~12.2 MB) no está documentado y `docs/STATUS.md` no existe)
- [x] `programme_erizon.glb` está aislado en un solo componente fácil de retirar y su licencia se muestra en créditos. (✔ 2.ª pasada: solo `ErizonStation` en OrbitScene.tsx:151 + urls/credits)
