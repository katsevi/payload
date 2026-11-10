# @payload/api — marcador de la fase 5

**Hoy no tiene código** (los scripts `typecheck`/`test`/`build` solo hacen `echo`).
No lo rellenes hasta que el cooperativo (fase 4) esté validado (`docs/phases/fase-5.md`).

## Qué irá aquí

- API con **NestJS + Prisma + PostgreSQL**: cuentas de invitado, mejores marcas y rankings por semilla.
- Despliegue y observabilidad (Sentry).

## Contrato que debe respetar

- Reutiliza los tipos de `@payload/shared` (`RunState`, `RunStats`, `RunAction`); no los redefine.
- Un ranking solo es fiable si el servidor **recalcula la partida con el motor** (semilla + acciones), no
  si acepta la puntuación que envía el cliente. La puntuación sale de `computeScore`.
- Cambios en `packages/shared/src/types.ts`: solo aditivos, o ADR.

Arquitectura de conjunto: `docs/ARCHITECTURE.md`.
