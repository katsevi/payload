# Estado del proyecto — traspaso entre sesiones

Última actualización: **2026-11-10** · Versión: 0.4.0 (ver `CHANGELOG.md`)

> Léelo antes de empezar y actualízalo al terminar una tarea relevante. Las casillas de
> `docs/phases/fase-*.md` las marca quien valida la fase, no quien implementa: aquí solo se resume.

## Lo más importante

**El juego se ha rehecho.** Payload ya no es un simulador de diseño de misiones: es un cooperativo de
supervivencia en una nave (plan en `docs/plan/plan-tripulacion-de-exploracion.md`, decisión en ADR 0011).

- El trabajo está en la rama **`feat/f1-viaje-y-nave`**, **sin commitear** (nadie ha pedido aún el commit).
- La versión anterior (0.3.0) está intacta en `main` y marcada con la etiqueta local `v0.3.0-simulador`.
- Su documentación se movió a `docs/archivo/v0.3-simulador/`.

## Estado por fase

| Fase | Estado |
| --- | --- |
| 1 · Viaje y nave (en solitario) | **Implementada.** `pnpm validate` en verde y recorrido manual en Chrome. **Falta:** validación independiente (agente `validator`) y el hito con jugadores. |
| 2 · Exploración de superficie | No iniciada. Punto de partida en `docs/phases/fase-2.md`. |
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

## Métricas verificadas (2026-11-10)

| Métrica | Valor |
| --- | --- |
| `pnpm validate --concurrency=1` | Verde: 11/11 tareas (typecheck + test + build). Total **91 tests** |
| Tests `@payload/shared` | **69** en 6 archivos (`galaxy`, `run`, `locales`, `balance`, `purity`, `rng`) |
| Tests `@payload/client` | **22** en 2 archivos (`game`, `i18n`) |
| Prueba manual (Chrome, 144 Hz) | Menú, interior de la nave, mapa estelar, salto con estelas, aviso de impacto con alarma y cartel, fuga sellada manteniendo E, panel de energía, pantalla de derrota. Sin errores en consola. **Anterior al rediseño gráfico** |
| Rediseño gráfico: pasada visual (Chrome, canvas 1920×1080) | Recorridos los ocho puestos en 1ª persona y una vista en 3ª; fuego, cortocircuito y fuga provocados sobre los sistemas; alarma por zona y apagón; los siete tipos de destino con `?body=`; un salto completo (estelas, aviso de impacto en el holograma del timón, llegada del destino); menú. Sin errores en consola. Los 22 shaders compilan y enlazan en WebGL2 |
| Rediseño gráfico: qué queda sin comprobar | Solo una semilla (7) y un aspecto por tipo de destino; un único tipo de planeta visto en el juego (los otros cuatro y la luna, en un arnés aparte). FPS: una sola medida válida, ~72 fps (≈14 ms por frame, ~3,3 ms de CPU) atracada frente a un campo de asteroides en esta máquina; nada medido en un portátil de gama media ni con ratón capturado |
| `pnpm balance 200 4` · tripulación rápida (3,5 s entre puestos) | Supera S1 100 % · S2 100 % · S3 92 % · S4 76 % |
| `pnpm balance 200 4` · tripulación lenta (7 s entre puestos) | Supera S1 100 % · S2 94 % · S3 73 % · S4 40 % |
| `pnpm balance 200 4` · nadie atiende las averías | Supera S1 5 % · S2 0 % |
| Duración de un sector (tripulante simulado) | ~4-4,5 min |
| Motor | ~10 ms por partida simulada de 4 sectores |
| Chunk `ShipScene` | ~2,38 MB (~0,89 MB gzip); `Models` 1,0 MB; inicio 0,45 MB |
| Modelos servidos (`assets/web/models/`) | ~13 MB (5 GLB; el mecha no se usa aún) |

## Acciones humanas pendientes

Ningún agente puede hacerlas.

0. **Mirar el rediseño gráfico y opinar** (`pnpm dev`, `?play=1&seed=7&body=<tipo>`): la pasada técnica está
   hecha; falta el criterio de quien juega sobre brillo, color y legibilidad, y probar otras semillas.
1. **Jugar la fase 1** (`pnpm dev`) y decidir si la dirección es la buena: ritmo, dificultad, legibilidad.
2. **Hito de la fase 1:** prueba con >= 3 personas que no conozcan el juego (ver `docs/phases/fase-1.md`).
3. **Decidir el commit y el PR** de `feat/f1-viaje-y-nave` y si se sube la etiqueta `v0.3.0-simulador`.
4. **Escuchar el audio:** nadie lo ha oído con el juego nuevo; la mezcla es provisional.
5. **Probar con ratón capturado** (pointer lock) en una sesión real: la prueba automatizada movió al tripulante con teclado pero no pudo capturar el ratón.
6. **Medir FPS** en una laptop de gama media (meta 60).
7. **ERIZON** (CC-BY-NC-ND): decidir si se sustituye antes de cualquier uso comercial.
8. **Crear `.claude/settings.json` compartido** (contenido propuesto en `docs/CONTRIBUTING.md`).

## Decisiones de diseño abiertas

- **Sector de ida.** Hoy se avanza hasta un portal y se pasa a otro sector; el plan habla de «regresar a estaciones seguras». Con la economía (fase 3) hay que decidir si existe una base a la que volver.
- **Servicio de estación gratuito** (depósito lleno, +40 casco, +2 repuestos, una vez): sustituto provisional de la tienda de la fase 3.
- **Sin tutorial.** Solo ayuda con H y carteles. Decidir tras la prueba con jugadores.
- **El mapa solo se abre en la mesa del puente** (hay que ir andando). Es deliberado, pero puede resultar pesado.
- **Los sistemas apagados por el jugador no se encienden solos** tras una sobrecarga: decidir si es buena fricción.
- **Mascota:** no hay. Si vuelve, Rise sigue necesitando autorización de NASA.

## Deuda técnica conocida

- **La escena 3D no tiene tests** (ni E2E): se validó a mano. Lo que sí está cubierto es la lógica (`layout`, `interaction`, `runStore`).
- **Cámara en 3ª persona:** se limita al casco pero puede atravesar mamparos y puestos.
- **Carteles en el mundo (`Markers`)** ocultan a mano los que quedan detrás de la cámara (drei `Html` no siempre lo hace con la cámara quieta).
- **`ShipScene` pesa 2,38 MB** (three + rapier). `postprocessing` ya no está: el resplandor son halos (`Glow`).
- **Modelos procedurales, no GLB:** casco, puestos y cuerpos celestes se generan en código (`gfx/`). No
  pesan ni tienen licencia, pero no se pueden editar en Blender; si algún día se quieren esculpir, hay que exportarlos.
- **Sin sombras proyectadas:** las de contacto están pintadas en el suelo; la luz de la estrella entra en el interior sin oclusión.
- **Rendimiento del rediseño apenas medido** (ver métricas): 10 luces puntuales y shaders de planeta por píxel. Si faltan FPS,
  lo primero es bajar `dpr` en `ShipScene` y las octavas de `fbm` en `spaceShaders.ts`.
- **Mando y táctil** no implementados. Sin CI ni linter.
- **`fx` y `playerState`** son objetos mutables de módulo (leídos por frame sin pasar por React).

## Próximos pasos

1. Pasada del agente `validator` sobre la fase 1 y prueba con jugadores; ajustar `catalog/*.json` con `pnpm balance`.
2. Fase 2 (superficie): empezar por el motor (`RunPhase` nuevas, mundos, oxígeno y jetpack personales) y un prototipo de movimiento con jetpack.
3. Escribir `docs/MULTIPLAYER.md` nuevo antes de tocar `apps/game-server` (fase 4).
