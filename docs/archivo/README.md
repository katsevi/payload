# Archivo

Documentación de versiones del juego que ya no están vigentes. **No describe el código actual**; se
conserva como historia y como referencia.

## `v0.3-simulador/` — el simulador de diseño de misiones (fases 0-3, versión 0.3.0)

Hasta el 2026-11-09 Payload era un simulador en el que se diseñaba un satélite pieza a pieza, se pasaba
una revisión Go/No-Go y se operaba la misión, en solitario o en sala de 4. Se sustituyó por el juego de
tripulación actual; el motivo está en `docs/adr/0011-reinicio-tripulacion-de-exploracion.md`.

| Archivo | Qué era |
| --- | --- |
| `plan-original/` | Plan original del simulador (con sus diagramas) |
| `GDD.md` | Documento de diseño del simulador |
| `MULTIPLAYER.md` | Contrato del multijugador con Colyseus (referencia útil para la fase 4 nueva) |
| `phases/` | Fichas de las fases 0-4 antiguas |

El **código** de esa versión no está en `main`. Está en el historial de git, en la etiqueta
`v0.3.0-simulador` (commit `76ae5ab`):

```bash
git show v0.3.0-simulador:apps/game-server/src/MissionRoom.ts   # ver un archivo
git worktree add ../payload-simulador v0.3.0-simulador          # tener esa versión en otra carpeta
```

La etiqueta es local hasta que alguien la suba (`git push origin v0.3.0-simulador`).
