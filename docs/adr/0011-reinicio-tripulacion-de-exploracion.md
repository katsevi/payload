# 0011 · Reinicio del concepto: de simulador de diseño a tripulación de exploración

- Estado: aceptada
- Fecha: 2026-11-09
- Sustituye a: 0007 y 0008. Deja en suspenso 0009 y 0010 hasta la fase 4.

## Contexto

Las fases 0-3 (versión 0.3.0) construyeron un simulador de diseño de misiones: elegir piezas de un
satélite, pasar una revisión Go/No-Go y ver la operación acelerada, en solitario y en sala de 4. Al
jugarlo, el equipo concluyó que se sentía como un simulador académico: demasiado texto (briefing,
asesores, glosario, Academia, informe con cadena de causas) y poca acción. El reto para el que se hace el
juego pide que los compromisos de ingeniería se entiendan **jugando**.

El plan nuevo (`docs/plan/plan-tripulacion-de-exploracion.md`) es un cooperativo de supervivencia en
tiempo real: una tripulación viaja de destino en destino, baja a superficies peligrosas, vende lo que
recoge y mejora la nave, con permadeath.

## Decisión

1. **Se reinicia el juego sobre el mismo repositorio.** El contrato `packages/shared/src/types.ts` se
   reescribe entero (este ADR es el que exige la regla 2 del proyecto) y se retiran el motor de diseño de
   misiones, su catálogo, el prototipo de la fase 0, el cliente antiguo y el servidor de sala.
2. **La versión anterior queda en el historial**, etiquetada como `v0.3.0-simulador` (commit `76ae5ab`),
   y su documentación en `docs/archivo/v0.3-simulador/`. No se mantiene código muerto en `main`.
3. **Se conservan las decisiones de fondo** (ADR 0001-0006): monorepo, React Three Fiber, motor TS puro y
   determinista compartido, contenido en JSON con zod, i18n es/en con `MessageRef`, pipeline de assets.
4. **Se reutiliza** lo que no depende del diseño anterior: `rng.ts`, la infraestructura de mensajes e
   i18n, el patrón de catálogo con zod, el controlador del jugador en 1ª/3ª persona con Rapier, la carga
   de modelos GLB (astronauta, consola, galaxia, estación ERIZON; el mecha Aurora queda para la fase 2), el
   motor de audio procedural con sus equivalentes visuales, los ajustes y la pantalla de créditos.
5. **Texto mínimo como regla.** El "¿por qué?" escrito de cada valor (antigua regla 6) se sustituye por
   "los compromisos se sienten en la mecánica": mensajes de una línea (hay tests que limitan su longitud)
   y nada de pantallas de lectura obligatoria.
6. **Nuevo roadmap** (`docs/phases/`): 1 viaje y nave en solitario · 2 superficie · 3 economía y mejoras ·
   4 cooperativo 1-4 con roles · 5 pulido y lanzamiento.

## Consecuencias

- Se pierden como código vivo 535 tests y el multijugador de la 0.3.0. El servidor autoritativo (ADR
  0009) y la presencia sin Redis (ADR 0010) siguen siendo el punto de partida de la fase 4, pero hay que
  volver a escribir la sala para la partida nueva; `apps/game-server` vuelve a ser un marcador.
- El motor nuevo (`createRun`) ya nace para correr en el servidor: paso fijo, sin reloj ni azar global, y
  todas las decisiones del jugador entran como `RunAction`.
- Los hitos con personas de las fases antiguas (prueba en papel, estudiantes, 4 jugadores) dejan de
  aplicarse; cada fase nueva define el suyo.
- No hay mascota ni Academia. Si vuelve una mascota, sigue vigente que Rise requiere autorización de NASA.
- Quien tenga ramas abiertas sobre la 0.3.0 no podrá fusionarlas sin rehacerlas.
