# @payload/api — marcador de la fase 4

**Hoy no tiene código** (`src/` vacío; los scripts `typecheck`/`test`/`build` solo hacen `echo`).
No lo rellenes hasta que la fase 3 esté validada (`docs/phases/fase-4.md`).

## Qué irá aquí (según el plan)

- API con **NestJS + Prisma + PostgreSQL**: cuentas (invitado + OAuth Google/GitHub), diseños guardados
  (guardar, compartir por enlace, comparar), rankings por escenario e informes.
- Despliegue en AWS (ECS Fargate, RDS) y observabilidad con Sentry.

## Contrato que debe respetar

- Reutiliza los tipos de `@payload/shared` (`MissionDesign`, `MissionResult`, `ScoreBreakdown`); no los redefine.
- Los rankings se calculan a partir de resultados producidos por el **servidor de juego autoritativo**
  (que corre el mismo motor), no de puntuaciones enviadas por el cliente.
- Un diseño guardado se valida con `parseCatalog`/`computeBudgets` del motor antes de aceptarse.
- Cambios en `packages/shared/src/types.ts`: solo aditivos, o ADR.

Arquitectura de conjunto: `docs/ARCHITECTURE.md`.
