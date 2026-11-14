# @payload/game-server — marcador de la fase 6

**Hoy no tiene código** (los scripts `typecheck`/`test`/`build` solo hacen `echo`). El servidor Colyseus
de la versión 0.3.0 se retiró con el reinicio del juego (ADR 0011): sincronizaba el diseño por turnos de
un satélite, no una nave en tiempo real. No lo rellenes hasta que toque la fase 6 (`docs/phases/fase-6.md`).

## Qué irá aquí

Servidor autoritativo para 1-4 jugadores que corre **el mismo motor** que el cliente:

- Una sala crea `createRun({ seed })`, llama a `run.step(dt)` con su reloj y aplica con `run.apply` las
  `RunAction` que envía cada cliente. Los clientes no simulan por su cuenta: reflejan el estado.
- Estado sincronizado: `RunState` más la posición y el puesto de cada tripulante.
- Roles (piloto, ingeniero, gestor de recursos, explorador) y agrupación con menos de 4 jugadores.

## Decisiones que siguen vigentes

- ADR 0009: servidor autoritativo con Colyseus. ADR 0010: un proceso, sin Redis, hasta que haya varias instancias.
- Test obligatorio de paridad: la sala produce el mismo `RunState` que el motor con las mismas acciones
  en los mismos instantes.
- No se duplican tipos ni fórmulas: todo se importa de `@payload/shared`. Cambios en `types.ts`: solo aditivos o ADR.
- Mensajes al jugador como `MessageRef`; sin texto en el código.

## Referencia de la versión anterior

Sirve para reconexión con gracia, límites anti-abuso, esquema incremental y pruebas con clientes reales:

```bash
git show v0.3.0-simulador:apps/game-server/src/MissionRoom.ts
git show v0.3.0-simulador:apps/game-server/src/roomModel.ts
```

Contrato antiguo: `docs/archivo/v0.3-simulador/MULTIPLAYER.md`. Antes de implementar, escribe el contrato
nuevo en `docs/MULTIPLAYER.md`.
