# Registros de decisiones de arquitectura (ADR)

Un ADR es una nota corta que registra **una decisión técnica importante**, por qué se tomó y qué consecuencias tiene, para que quien llegue después (persona o sesión de Claude) no tenga que adivinarlo ni reabrirlo sin saber el contexto.

Reglas:

- Un archivo por decisión: `NNNN-titulo-en-kebab-case.md`, numeración correlativa.
- Una decisión aceptada no se edita: si cambia, se escribe un ADR nuevo que la **sustituye** y se actualiza el estado del anterior.
- Todo cambio que rompa el contrato `packages/shared/src/types.ts` exige un ADR.
- Cortos: contexto, decisión, consecuencias.

## Plantilla

```markdown
# NNNN · Título

- Estado: propuesta | aceptada | sustituida por NNNN
- Fecha: AAAA-MM-DD

## Contexto
Qué problema o fuerza motiva la decisión.

## Decisión
Qué se decide, en una o dos frases claras.

## Consecuencias
Qué se gana, qué se pierde y qué obliga a hacer después.
```

## Índice

| ADR | Título | Estado |
| --- | --- | --- |
| [0001](0001-monorepo-pnpm-turborepo.md) | Monorepo pnpm + Turborepo | Aceptada |
| [0002](0002-react-three-fiber.md) | React Three Fiber en vez de Babylon.js | Aceptada |
| [0003](0003-motor-ts-puro-determinista.md) | Motor TypeScript puro, compartido y determinista | Aceptada |
| [0004](0004-contenido-json-zod.md) | Contenido en JSON validado con zod | Aceptada |
| [0005](0005-i18n-es-en.md) | i18n es/en desde el día 1 (`ui` y `sim`) | Aceptada |
| [0006](0006-pipeline-de-assets.md) | Pipeline de assets y registro de licencias | Aceptada |
| [0007](0007-fase-1-en-solitario.md) | Fase 1 en solitario antes que el multijugador | Sustituida por 0011 |
| [0008](0008-eventos-y-dificultad-fase-2.md) | Eventos por dificultad, penalización de agotamientos y fase de Kepler | Sustituida por 0011 |
| [0009](0009-servidor-autoritativo-colyseus.md) | Servidor autoritativo con Colyseus que corre el mismo motor | Aceptada · detalle de implementación sustituido por 0017 |
| [0010](0010-presencia-y-escalado.md) | Presencia y escalado del servidor de juego: un proceso, sin Redis (por ahora) | Aceptada |
| [0011](0011-reinicio-tripulacion-de-exploracion.md) | Reinicio del concepto: de simulador de diseño a tripulación de exploración | Aceptada |
| [0012](0012-superficie-autoridad-dividida.md) | Superficie: autoridad dividida, oxígeno como único recurso que no vuelve y recompensa sin economía | Aceptada |
| [0013](0013-minijuegos-y-herramientas.md) | Minijuegos en el cliente y minería con herramientas desplegables | Aceptada |
| [0014](0014-economia-y-mejoras.md) | Economía y mejoras: créditos, terminal de estación de pago y nave efectiva | Aceptada |
| [0015](0015-reto-nasa-y-roadmap.md) | Reto NASA Space Apps 2026 y nuevo roadmap: diseñar la misión y luego operarla | Aceptada |
| [0016](0016-diseno-de-mision-y-sistema-solar.md) | Diseño de misión antes de zarpar y sistema solar como mapa | Aceptada |
| [0017](0017-cooperativo-estado-por-mensajes-y-espejo.md) | Cooperativo: estado entero por mensajes, espejo hidratado en el cliente y roles como ventajas pasivas | Aceptada |
