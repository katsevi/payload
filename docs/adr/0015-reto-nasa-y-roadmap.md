# 0015 · Reto NASA Space Apps 2026 y nuevo roadmap: diseñar la misión y luego operarla

- Estado: aceptada
- Fecha: 2026-11-14

## Contexto

El equipo evaluó Payload frente al reto «Space Mission Design Game» del NASA Space Apps Challenge 2026. El reto pide
que la persona **diseñe, gestione y simule** una misión completa: objetivo, requisitos, nave, instrumentos,
lanzador y órbita; masa, energía, presupuesto, datos, comunicaciones y vida útil; **explicar por qué** la misión
sale bien o mal; y modo individual o en equipo de hasta 4 con roles.

Payload hoy (fases 1-3) es un cooperativo de supervivencia en tiempo real: cubre la gestión (energía, masa,
combustible, riesgo) y la economía, pero **no tiene fase de diseño**, ni sistema solar real, ni datos y comunicaciones,
ni explicación del resultado. Recursos del reto revisados: webinar NASA «Design and Develop Science Missions»
(6 etapas: necesidad y metas, concepto, requisitos, diseño, construir y verificar, operar; 4 segmentos: lanzamiento,
espacio, tierra, usuarios), CubeSat 101 (NASA), el juego «Build It Yourself: Satellite!» (Webb), el Mission Design
Lab de Goddard (16 disciplinas), los niveles de madurez de concepto CML (JPL), GMAT y `nasa.github.io/mission-viz`.

## Decisión

**Conservar el juego y reordenar el roadmap** para que la partida de supervivencia sea la *operación* de la misión
que el jugador diseñó (etapas «construir y verificar» y «operar» del webinar):

- **Fase 4 · Diseño de misión y sistema solar:** fase de diseño antes de zarpar (objetivo científico, instrumentos,
  módulos de nave, lanzador; presupuesto, masa, potencia y plazo; revisión Go/No-Go; el diseño genera la nave de la
  partida) y el sistema solar real como mapa (Luna, Marte, Fobos, Ceres/cinturón, Europa, Titán… con datos públicos
  de NASA; la distancia al Sol reduce la potencia solar 1/d²: paneles frente a RTG; el lanzador limita masa y destino).
- **Fase 5 · Ciencia, datos y astronauta articulado:** instrumentos que generan datos, almacenamiento, bajada a la
  Tierra en ventanas de contacto (tasa según antena, potencia y distancia), puntuación por ciencia entregada, informe
  post-misión con cadena de causas, dificultad, misión guiada de CubeSat y astronauta articulado con animación
  procedural y dos niveles de detalle.
- **Fase 6 · Cooperativo 1-4 con roles** (antigua fase 4): servidor autoritativo (ADR 0009 y 0010), roles por
  disciplina como el Mission Design Lab (dirección, ingeniería, ciencia, operaciones), Go/No-Go con voto y
  astronautas remotos visibles en 3D con bajo detalle (interpolados a 10-15 Hz).
- **Fase 7 · Pulido y lanzamiento** (antigua fase 5).

**Revisión de la regla 6 «se juega, no se lee».** Se permiten explicaciones **opcionales de una línea** (ayuda con
tecla, glosario breve, motivo del Go/No-Go, informe final). Siguen prohibidos la lectura obligatoria, los tutoriales
de texto y los paneles explicativos que bloqueen. Motivo: el reto pide explicar el porqué de cada resultado, y eso
exige decirlo en algún sitio; lo que se conserva es que nada obligue a leer para poder jugar.

El resto de reglas no cambia: motor TS puro y determinista, contenido en JSON, bilingüe, contrato aditivo.

## Consecuencias

- Se gana una propuesta que encaja con el reto sin perder lo construido (fases 1-3 siguen siendo la operación).
- El cooperativo se retrasa de la fase 4 a la 6; los ADR 0009 y 0010 siguen en suspenso hasta entonces. Las fichas
  `docs/phases/fase-4.md` a `fase-7.md` se reescriben o renumeran en este cambio.
- El contrato `types.ts` crece de forma aditiva (diseño de misión, módulos, lanzador, sistema solar); el motor genera
  la nave de la partida a partir del diseño, así que `effectiveShip()` pasa a tener otra fuente de cifras.
- Aparecen datos externos (efemérides, masas, distancias): deben ser públicos, con fuente anotada en el catálogo
  y en `assets/CREDITS.md` si incluyen imágenes o texturas.
- El texto explicativo aumenta el volumen de i18n (es/en) y exige mantener cada línea corta (los tests ya limitan longitud).
- Riesgo de alcance: mitigado por fases pequeñas y porque el reto se puede demostrar con las fases 4 y 5.

## Alternativas

- **Volver a la v0.3 «simulador de diseño de misiones»** (`docs/archivo/v0.3-simulador/`). Cubría el diseño pero
  era un simulador sin juego: se descartó en el ADR 0011 por poco atractivo, y retomarlo tiraría las fases 1-3.
- **Adaptar el juego actual (decidido).** Reutiliza motor, interior de nave, superficie y economía; añade el diseño
  antes y la ciencia después, de modo que el jugador vea las consecuencias de sus decisiones en tiempo real.
- **Mantener el roadmap anterior y presentar el juego tal cual:** no responde al núcleo del reto (diseñar y explicar).
