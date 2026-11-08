# Payload — guía para Claude Code

**Payload** es un simulador 3D web (TypeScript + React Three Fiber) donde 1-4 jugadores diseñan,
lanzan y operan una misión espacial, alternando primera y tercera persona. El objetivo educativo es
entender los compromisos del diseño de misiones: cada decisión mueve masa, energía, presupuesto,
datos, comunicaciones y vida útil.

Este repositorio lo usan **varias personas y varias sesiones de Claude**. Antes de cambiar algo,
lee este archivo, el `CLAUDE.md` del paquete que vas a tocar y `docs/STATUS.md` (estado actual).

## Estado del roadmap

| Fase | Contenido | Estado |
| --- | --- | --- |
| 0 · Preproducción | GDD, catálogo JSON, prototipo en hoja de cálculo | Entregables hechos · hito pendiente de prueba en papel (ver `docs/phases/fase-0.md`) |
| 1 · Rebanada vertical en solitario | Hangar 1ª/3ª persona, 1 escenario LEO, panel de recursos, motor con tests, lanzamiento, operación, informe | Hecha · validada con observaciones (ver `docs/STATUS.md`) |
| 2 · Contenido y aprendizaje | 5 escenarios, 6 órbitas, eventos, Academia con Rise, audio | Pendiente |
| 3 · Multijugador | Colyseus, roles, Go/No-Go compartido | Pendiente (`apps/game-server` es un marcador) |
| 4 · Pulido y lanzamiento | Rankings, guardar/comparar, AWS, Sentry, E2E | Pendiente (`apps/api` es un marcador) |

El plan original completo está en `docs/plan-original/plan-juego-misiones-espaciales.md`. Más documentación:
`docs/STATUS.md` (estado y acciones pendientes), `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md` y `CHANGELOG.md`.

## Mapa del monorepo

```text
payload/
├─ apps/
│  ├─ client/        # React 19 + R3F v9 + Drei + Rapier + Vite (escenas, UI, i18n)
│  ├─ game-server/   # Fase 3: Colyseus (marcador)
│  └─ api/           # Fase 4: NestJS + Prisma (marcador)
├─ packages/
│  └─ shared/        # tipos, motor de simulación, mecánica orbital (TS puro, con tests)
│     ├─ catalog/    # componentes.json, orbitas.json, lanzadores.json, escenarios.json
│     └─ locales/    # textos del motor (namespace i18n `sim`) en es/en
├─ assets/
│  ├─ models/source/ # modelos .glb ORIGINALES (nunca se modifican)
│  ├─ web/           # publicDir de Vite: web/models/*.glb optimizados → URL /models/<archivo>.glb
│  └─ CREDITS.md     # autor, fuente y licencia de cada asset
├─ prototype/        # Fase 0: prototipo de compromisos (CLI + hoja de cálculo)
├─ docs/             # GDD, fases, ADRs, ARCHITECTURE, CONTRIBUTING, STATUS
└─ .claude/          # agentes y skills (settings.json compartido opcional: ver docs/CONTRIBUTING.md)
```

## Comandos

```bash
pnpm install          # Node >= 22 (ver .nvmrc), pnpm 11
pnpm dev              # cliente en http://localhost:5173
pnpm test             # tests de todos los paquetes (Vitest)
pnpm typecheck        # tsc --noEmit en todos los paquetes
pnpm build            # build de producción
pnpm validate         # typecheck + test + build (lo que debe pasar antes de entregar)
pnpm proto            # prototipo de compromisos de la fase 0 en terminal
pnpm --filter @payload/shared test:watch   # TDD del motor
pnpm --filter @payload/shared bench        # rendimiento del motor (fuera de los tests)
```

## Reglas del proyecto (no negociables)

1. **El motor es TS puro.** `packages/shared` no importa React, Three.js, DOM ni APIs de Node en `src/`.
   Debe poder correr igual en el navegador (solitario) y en el servidor de juego (fase 3).
2. **El contrato es `packages/shared/src/types.ts`.** Solo cambios aditivos; un cambio que rompa
   exige ADR en `docs/adr/` y actualizar a todos los consumidores en el mismo cambio.
3. **Contenido en datos, no en código.** Componentes, órbitas, lanzadores y escenarios viven en
   `packages/shared/catalog/*.json` y se validan con zod. Añadir contenido no debe requerir tocar código.
4. **Determinismo.** Toda aleatoriedad del motor pasa por `createRng(seed)`. Prohibido `Math.random()`
   y `Date.now()` en `packages/shared/src`.
5. **Bilingüe desde el día 1.** Español por defecto, inglés completo. Nada de texto visible
   hardcodeado: UI en `apps/client/src/locales/{es,en}.json` (namespace `ui`), motor en
   `packages/shared/locales/{es,en}.json` (namespace `sim`), contenido en `LocalizedText` del catálogo.
   Un test comprueba que ambos idiomas tienen las mismas claves.
6. **Educativo:** cada valor tiene su "¿por qué?". El motor devuelve `MessageRef` (clave + parámetros),
   nunca texto final.
7. **Licencias de assets.** Todo asset nuevo se registra en `assets/CREDITS.md` con autor, fuente y
   licencia. Ver la skill `3d-models` antes de tocar modelos. Atención: `programme_erizon.glb` es
   CC-BY-NC-ND (sin uso comercial, sin derivados).
8. **Rise** (mascota de Artemis II) requiere autorización de NASA; no la añadas sin revisar
   `docs/GDD.md` § Mascota. El sistema de mascota debe permitir cambiarla por una propia.
9. **Antes de dar algo por terminado:** `pnpm validate` en verde y `docs/STATUS.md` actualizado.

## Convenciones de código

- TypeScript estricto (`noUncheckedIndexedAccess`). Nada de `any` salvo justificado con comentario.
- Unidades en los nombres (`massKg`, `powerW`, `costMUSD`, `periodMin`).
- Código e identificadores en inglés; textos, docs y comentarios de dominio en español.
- Commits: Conventional Commits (`feat(shared): ...`, `fix(client): ...`, `docs: ...`).
- Ramas: `feat/<fase>-<tema>`, p. ej. `feat/f2-academia-rise`.

## Trabajar en equipo con Claude

- **Agentes del proyecto** (`.claude/agents/`): `sim-engine` (motor), `client-3d` (cliente R3F),
  `content-designer` (catálogo y balance), `asset-pipeline` (modelos 3D), `validator` (revisión
  previa a entregar), `docs-writer` (documentación). Úsalos para delegar en la parte que les toca.
- **Skills del proyecto** (`.claude/skills/`): `3d-models` (inspeccionar/optimizar GLB),
  `validate` (validación completa), `add-catalog-item` (añadir contenido al catálogo).
- `docs/STATUS.md` es el traspaso entre sesiones: qué se hizo, qué falta, decisiones recientes.
  Actualízalo al terminar una tarea relevante.
- Decisiones de arquitectura: un ADR corto en `docs/adr/NNNN-titulo.md`.
- Ajustes personales: `.claude/settings.local.json` y `CLAUDE.local.md` (no se versionan). Permisos
  compartidos opcionales (`.claude/settings.json`, aún no creado): ver `docs/CONTRIBUTING.md`.
- Flujo de ramas, commits, PR y ADR: `docs/CONTRIBUTING.md`. Cambios relevantes: actualiza también `CHANGELOG.md`.
