# Payload — guía para Claude Code

**Payload** es un juego cooperativo 3D web (TypeScript + React Three Fiber) de supervivencia y gestión de
recursos espaciales para 1-4 jugadores. La tripulación de una nave exploradora viaja de destino en
destino, mantiene viva la nave en tiempo real (casco, oxígeno, combustible, energía), baja a superficies
peligrosas, vende lo que recoge y mejora la nave. Con permadeath. Los compromisos de ingeniería (potencia,
combustible, masa, motores, riesgo) se entienden jugando, no leyendo.

> El juego se rehízo el 2026-11-09 (ADR 0011). Antes era un simulador de diseño de misiones; esa versión
> está en la etiqueta `v0.3.0-simulador` y su documentación en `docs/archivo/`. No la tomes como referencia
> del código actual.

Este repositorio lo usan **varias personas y varias sesiones de Claude**. Antes de cambiar algo, lee este
archivo, el `CLAUDE.md` del paquete que vas a tocar y `docs/STATUS.md` (estado actual).

## Estado del roadmap

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 · Viaje y nave (en solitario) | Mapa estelar, saltos, combustible, interior caminable 1ª/3ª persona, sistemas, averías en tiempo real, permadeath | Implementada · pendiente de validación independiente y de prueba con jugadores (ver `docs/phases/fase-1.md`) |
| 2 · Exploración de superficie | Descenso y aterrizaje, jetpack, oxígeno personal, recolección | Implementada (rama `feat/f2-superficie`) · pendiente de validación independiente final y de prueba con jugadores (ver `docs/phases/fase-2.md`) |
| 3 · Economía y progresión | Créditos, venta en estaciones, suministros y 11 mejoras de nave y equipo | Implementada (rama `feat/f3-economia-progresion`) · validada con observaciones · hito pendiente de prueba con jugadores (ver `docs/phases/fase-3.md`) |
| 4 · Diseño de misión y sistema solar | Diseño antes de zarpar (objetivo, instrumentos, módulos, lanzador; presupuesto, masa, potencia, plazo; Go/No-Go) y sistema solar real como mapa | Hecha · fusionada (PR #6) · validada con observaciones · hito pendiente de prueba con personas (ver `docs/phases/fase-4.md`) |
| 5 · Ciencia, datos y astronauta articulado | Instrumentos que generan datos, bajada a la Tierra en ventanas de contacto, puntuación por ciencia, informe post-misión, misión guiada de CubeSat | En curso (rama `feat/f5-ciencia-y-datos`): núcleo de datos, ventanas de contacto, fin de misión, puntuación e informe (ADR 0018); fiabilidad, calor y batería; dificultad; misión guiada de CubeSat; astronauta articulado · pendiente de validación y prueba con personas (ver `docs/phases/fase-5.md`) |
| 6 · Cooperativo 1-4 con roles | Servidor autoritativo, sala con código, roles (piloto, ingeniero, gestor de recursos, explorador; después por disciplina), Go/No-Go con voto | Implementada (Harry) · integrada en main (PR #9) · diseño compartido y voto Go/No-Go en la rama `feat/f6-diseno-cooperativo` (ADR 0020) · pendiente de roles por disciplina, validación y prueba con 4 personas (ver `docs/phases/fase-6.md` y `docs/MULTIPLAYER.md`) |
| 7 · Pulido y lanzamiento | Rankings, mando/táctil, E2E, despliegue | Pendiente (`apps/api` es un marcador) |
| 8 · Cordura de la tripulación | Salud psicológica por tripulante (peligros RIDGE y riesgos HRP de la NASA), solo debuffs, contramedidas con sinergia con energía, economía, diseño, roles y cooperativo | No iniciada · planeación documentada (2026-11-14) (ver `docs/phases/fase-8.md` y `docs/diseno/cordura-tripulacion.md`) |

Plan: `docs/plan/plan-tripulacion-de-exploracion.md`. Reto NASA y roadmap: `docs/adr/0015-reto-nasa-y-roadmap.md`. Diseño: `docs/GDD.md`. Más documentación:
`docs/STATUS.md` (estado y pendientes), `docs/MULTIPLAYER.md` (contrato de red del cooperativo), `docs/despliegue-aws.md` (publicar en AWS Amplify), `docs/ARCHITECTURE.md`, `docs/phases/`, `docs/guias/primera-mision.md` (cómo probar el diseño de misión), `docs/diseno/` (diseño detallado de sistemas futuros, p. ej. la cordura), `docs/CONTRIBUTING.md` y `CHANGELOG.md`.

## Mapa del monorepo

```text
payload/
├─ apps/
│  ├─ client/        # React 19 + R3F v9 + Drei + Rapier + Vite (escenas, interfaz, audio, i18n)
│  ├─ game-server/   # servidor autoritativo del cooperativo (fase 6; Colyseus, corre el motor de shared)
│  └─ api/           # marcador: rankings y persistencia (fase 7)
├─ packages/
│  └─ shared/        # motor del juego: tipos, generador de sectores, partida (TS puro, con tests)
│     ├─ catalog/    # naves, averias, destinos, sectores, mundos, economia, mejoras, misiones, modulos, instrumentos, lanzadores, sistema-solar, roles, ciencia (.json)
│     └─ locales/    # textos del motor (namespace i18n `sim`) en es/en
├─ assets/
│  ├─ models/source/ # modelos .glb ORIGINALES (nunca se modifican)
│  ├─ web/           # publicDir de Vite: web/models/*.glb optimizados → URL /models/<archivo>.glb
│  └─ CREDITS.md     # autor, fuente y licencia de cada asset
├─ docs/             # plan, GDD, fases, ADR, diseno/, ARCHITECTURE, CONTRIBUTING, STATUS, archivo/
└─ .claude/          # agentes y skills (settings.json compartido opcional: ver docs/CONTRIBUTING.md)
```

## Comandos

```bash
pnpm install          # Node >= 22 (ver .nvmrc), pnpm 11
pnpm dev              # cliente en http://localhost:5173  (?play=1&seed=7 entra directo a la partida; &surface=1 a la superficie)
                      # ?design=1&mission=<id> abre el hangar de esa misión (p. ej. mission-cubesat-guided, la guiada); ?play=1&seed=7&mission=<id> zarpa con su diseño de referencia
pnpm dev:server       # servidor del cooperativo en ws://localhost:2567 (contrato: docs/MULTIPLAYER.md)
pnpm dev:lan          # cliente abierto a la red local (para jugar desde otros equipos)
pnpm test             # tests de todos los paquetes (Vitest)
pnpm typecheck        # tsc --noEmit en todos los paquetes
pnpm build            # build de producción
pnpm validate         # typecheck + test + build (lo que debe pasar antes de entregar)
pnpm balance          # informe de balance con tripulante simulado (200 partidas; admite `pnpm balance 500 5`)
pnpm --filter @payload/shared test:watch   # TDD del motor
```

## Reglas del proyecto (no negociables)

1. **El motor es TS puro.** `packages/shared` no importa React, Three.js, DOM ni APIs de Node en `src/`.
   Debe poder correr igual en el navegador (solitario) y en el servidor de juego (fase 6).
2. **El contrato es `packages/shared/src/types.ts`.** Solo cambios aditivos; un cambio que rompa
   exige ADR en `docs/adr/` y actualizar a todos los consumidores en el mismo cambio.
3. **Contenido en datos, no en código.** Naves, averías, destinos y reglas de sector viven en
   `packages/shared/catalog/*.json` y se validan con zod. Ajustar el balance no debe requerir tocar código.
4. **Determinismo.** Toda aleatoriedad del motor pasa por `createRng(seed)`. Prohibido `Math.random()`
   y `Date.now()` en `packages/shared/src`. El tiempo avanza en pasos fijos; toda decisión del jugador
   entra como `RunAction`.
5. **Bilingüe desde el día 1.** Español por defecto, inglés completo. Nada de texto visible
   hardcodeado: UI en `apps/client/src/locales/{es,en}.json` (namespace `ui`), motor en
   `packages/shared/locales/{es,en}.json` (namespace `sim`), contenido en `LocalizedText` del catálogo.
   Hay tests de paridad de claves en ambos paquetes.
6. **Se juega, no se lee.** Los compromisos se sienten en la mecánica. El motor devuelve `MessageRef`
   (clave + parámetros), nunca texto final, y cada mensaje cabe en una línea (los tests limitan su
   longitud). Nada de pantallas de lectura obligatoria, tutoriales de texto ni paneles explicativos. Revisada por el
   ADR 0015: se permiten explicaciones **opcionales** de una línea (ayuda con tecla, glosario breve, motivo del
   Go/No-Go, informe final).
7. **Licencias de assets.** Todo asset nuevo se registra en `assets/CREDITS.md` con autor, fuente y
   licencia. Ver la skill `3d-models` antes de tocar modelos. Atención: `programme_erizon.glb` es
   CC-BY-NC-ND (sin uso comercial, sin derivados).
8. **Rise** (mascota de Artemis II) requiere autorización de NASA; no la añadas. Hoy el juego no tiene
   mascota; si se añade una, debe poder cambiarse por una propia (`docs/GDD.md` § 12).
9. **Antes de dar algo por terminado:** `pnpm validate` en verde y `docs/STATUS.md` actualizado.

## Convenciones de código

- TypeScript estricto (`noUncheckedIndexedAccess`). Nada de `any` salvo justificado con comentario.
- Unidades en los nombres (`distanceLy`, `powerSupplyKw`, `oxygenPct`, `repairS`).
- Código e identificadores en inglés; textos, docs y comentarios de dominio en español.
- Commits: Conventional Commits (`feat(shared): ...`, `fix(client): ...`, `docs: ...`).
- Ramas: `feat/<fase>-<tema>`, p. ej. `feat/f2-superficie`.

## Trabajar en equipo con Claude

- **Agentes del proyecto** (`.claude/agents/`): `sim-engine` (motor), `client-3d` (cliente R3F),
  `content-designer` (catálogo y balance), `asset-pipeline` (modelos 3D), `validator` (revisión
  previa a entregar), `docs-writer` (documentación), `game-server` (servidor del cooperativo, fase 6).
  Úsalos para delegar en la parte que les toca.
- **Skills del proyecto** (`.claude/skills/`): `3d-models` (inspeccionar/optimizar GLB),
  `validate` (validación completa), `add-catalog-item` (añadir o ajustar contenido del catálogo).
  Además, las skills genéricas `threejs-*` (de `cloudai-x/threejs-skills`, en `skills-lock.json`) son
  la referencia técnica de three.js/R3F. Si chocan con este archivo o con `3d-models`, mandan las reglas del proyecto.
  Actualízalas con `npx skills update -p`.
- `docs/STATUS.md` es el traspaso entre sesiones: qué se hizo, qué falta, decisiones recientes.
  Actualízalo al terminar una tarea relevante.
- Decisiones de arquitectura: un ADR corto en `docs/adr/NNNN-titulo.md`.
- Ajustes personales: `.claude/settings.local.json` y `CLAUDE.local.md` (no se versionan). Permisos
  compartidos opcionales (`.claude/settings.json`, aún no creado): ver `docs/CONTRIBUTING.md`.
- Flujo de ramas, commits, PR y ADR: `docs/CONTRIBUTING.md`. Cambios relevantes: actualiza también `CHANGELOG.md`.
