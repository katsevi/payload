# Guía de contribución

Para personas y para sesiones de Claude Code. Reglas no negociables del proyecto: `CLAUDE.md` (raíz).

## Antes de empezar

1. Lee `CLAUDE.md`, el `CLAUDE.md` del paquete que vas a tocar (`packages/shared`, `apps/client`) y `docs/STATUS.md`.
2. `pnpm install` (Node >= 22, `.nvmrc` fija 24; pnpm 11) y comprueba que `pnpm validate` está en verde.

## Flujo de trabajo

1. **Rama** desde `main`: `feat/<fase>-<tema>` (por ejemplo `feat/f2-academia-rise`); para arreglos y docs, `fix/<tema>` o `docs/<tema>`.
2. **Commits** con [Conventional Commits](https://www.conventionalcommits.org/es/): `feat(shared): ...`, `fix(client): ...`, `docs: ...`, `chore: ...`. Alcances habituales: `shared`, `client`, `catalog`, `assets`, `proto`, `docs`.
3. **Antes de abrir el PR:** `pnpm validate` (typecheck + test + build) en verde. Si tocaste el motor, añade o ajusta tests en `packages/shared/src/__tests__/`; si tocaste textos, claves en **es y en**.
4. **Documentación:** actualiza `docs/STATUS.md` (qué hiciste, qué falta, decisiones) y `CHANGELOG.md` (sección "Sin publicar") en cualquier cambio relevante. Si cambia un comando, una regla o un mapa de carpetas, actualiza también el `CLAUDE.md` correspondiente.
5. **PR:** descripción con qué cambia, por qué y cómo se probó. Un cambio que rompa `packages/shared/src/types.ts` exige ADR y actualizar a todos los consumidores en el mismo PR.

Las casillas de `docs/phases/fase-*.md` las marca quien **valida** la fase (agente `validator` o una persona), no quien implementa.

## Cuándo escribir un ADR

Escribe un ADR corto (`docs/adr/NNNN-titulo.md`, plantilla en `docs/adr/README.md`) cuando:

- cambies el contrato `types.ts` de forma incompatible;
- elijas o cambies una tecnología o un patrón estructural (motor, estado, red, despliegue);
- tomes una decisión de diseño que otros podrían querer reabrir (por ejemplo, subir `power-storm` a bloqueador).

Un ADR aceptado no se edita: se escribe uno nuevo que lo sustituye.

## Agentes del proyecto (`.claude/agents/`)

| Agente | Modelo | Úsalo para |
| --- | --- | --- |
| `sim-engine` | opus | Lógica del juego y fórmulas en `packages/shared` (TDD, determinismo) |
| `client-3d` | sonnet | Escenas, cámaras, paneles, HUD y flujo de fases en `apps/client` |
| `content-designer` | sonnet | Catálogo JSON, textos es/en y balance (no toca el motor) |
| `asset-pipeline` | haiku | Inspeccionar/optimizar GLB y registrar licencias |
| `validator` | opus | Revisión independiente previa a entregar (solo lee y reporta) |
| `docs-writer` | sonnet | README, STATUS, CHANGELOG, ARCHITECTURE, CLAUDE.md, ADR |

Pautas: delega en el agente de cada zona; no dejes que un agente toque código fuera de su zona; pide
al `validator` una pasada antes de cerrar una fase y dale el código, no tu conclusión.

## Skills (`.claude/skills/`)

| Skill | Cuándo |
| --- | --- |
| `3d-models` | Añadir, optimizar o auditar modelos GLB y sus licencias (`scripts/inspect.sh`, `scripts/optimize.sh`) |
| `validate` | Validación completa antes de un commit/PR (`pnpm validate` + reglas estáticas + créditos) |
| `add-catalog-item` | Añadir componentes, órbitas, lanzadores o escenarios al catálogo |

## Ajustes personales

Lo personal **no se versiona** (ya está en `.gitignore`): `.claude/settings.local.json` (permisos y
preferencias propias) y `CLAUDE.local.md` (instrucciones propias para Claude).

## Permisos compartidos sugeridos

Hoy **no existe** `.claude/settings.json` (no se pudo crear automáticamente). Si el equipo lo quiere,
créalo a mano con este contenido propuesto:

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm install)",
      "Bash(pnpm test:*)",
      "Bash(pnpm typecheck:*)",
      "Bash(pnpm build:*)",
      "Bash(pnpm validate:*)",
      "Bash(pnpm proto:*)",
      "Bash(pnpm --filter:*)",
      "Bash(pnpm exec gltf-transform:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)"
    ]
  }
}
```

Con esto Claude puede instalar, probar y construir sin pedir confirmación, y no lee archivos `.env*`.
No incluye `pnpm add` ni `git commit/push` a propósito.

## Reglas rápidas

- Motor TS puro; sin `Math.random()` ni `Date.now()` en `packages/shared/src`.
- Sin texto hardcodeado: UI en `apps/client/src/locales/{es,en}.json`, motor en `packages/shared/locales/{es,en}.json`, contenido como `LocalizedText`.
- Todo asset nuevo se registra en `assets/CREDITS.md` (y en `apps/client/src/data/credits.ts`). ERIZON es CC-BY-NC-ND: no se modifica ni se usa comercialmente.
- Rise (mascota de NASA) no se añade sin autorización documentada.
