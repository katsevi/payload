# Fase 5 · Ciencia, datos y astronauta articulado

Decisión: `docs/adr/0015-reto-nasa-y-roadmap.md`. Cierra el ciclo que pide el reto: la misión **produce ciencia**, los
datos tienen que **llegar a la Tierra** y el jugador entiende **por qué** salió bien o mal.

No iniciada. Depende de la fase 4 (diseño con instrumentos, nave generada y sistema solar).

**Hito:** una persona juega una misión completa (diseño, operación, entrega de datos) y, al terminar, el informe le
muestra la cadena de causas del resultado (p. ej. poca potencia, antena en reserva, datos sin bajar) que puede
verificar sobre lo que vivió.

## Punto de partida

- Fase 4: el diseño define instrumentos, antena y potencia; la distancia al Sol limita la energía.
- Fases 2 y 3: recolección, puntuación y economía. La ciencia se suma a la puntuación, no la sustituye por completo.
- Los segmentos de la misión del webinar NASA (lanzamiento, espacio, tierra, usuarios) guían qué se modela: aquí el segmento tierra es la ventana de contacto.

## Alcance previsto

### Motor (`packages/shared`)

- [ ] Instrumentos que generan datos (volumen según instrumento, objetivo y lugar) y almacenamiento de a bordo con límite.
- [ ] Bajada a la Tierra en ventanas de contacto; tasa según antena, potencia y distancia.
- [ ] Puntuación por ciencia entregada (los datos que no llegan no puntúan).
- [ ] Informe post-misión con cadena de causas, un `MessageRef` de una línea por eslabón.
- [ ] Niveles de dificultad (cifras en catálogo) y misión guiada de CubeSat (diseño fijo, objetivos pequeños).
- [ ] Tests: determinismo, datos conservados entre ventanas y cadena de causas coherente con el estado.

### Cliente (`apps/client`)

- [ ] Panel de datos y comunicaciones (almacenamiento, próxima ventana, tasa) legible de un vistazo.
- [ ] Informe final con la cadena de causas (explicación opcional, nunca bloquea el juego).
- [ ] Selector de dificultad y misión guiada de CubeSat.
- [ ] Astronauta articulado con animación procedural y dos niveles de detalle (alto para el jugador, bajo a distancia; base de los remotos de la fase 6).

### Contenido (`packages/shared/catalog`)

- [ ] Antenas, tasas, ventanas de contacto y volumen de datos por instrumento; reglas de dificultad.
- [ ] Modelo del astronauta: reutilizar el existente si la licencia lo permite; todo asset nuevo en `assets/CREDITS.md`.

## Fuera de alcance

- Cooperativo y astronautas remotos (fase 6); aquí solo se prepara el nivel de detalle bajo.
- Presupuestos de enlace reales (dB, modulación): modelo simplificado de tasa.
- Captura de movimiento: animación procedural.

## Riesgos

- Que datos y comunicaciones sean burocracia sin diversión: la espera de la ventana debe crear decisiones, no tiempo muerto.
- El informe como muro de texto: una línea por eslabón y un máximo de eslabones.
- Rendimiento del astronauta articulado: dos niveles de detalle y medir antes de añadir más.
