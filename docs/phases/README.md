# Roadmap por fases

Cinco fases, cada una cerrada por un hito comprobable. La fase 1 es la clave: prueba que los compromisos de diseño son divertidos antes de invertir en multijugador. Las fases no tienen fechas porque aún no hay fecha de entrega (ver preguntas abiertas en `docs/GDD.md`).

```mermaid
flowchart TD
    F0["<b>Fase 0 · Preproducción</b><br/>Documento de diseño del juego y catálogo inicial de componentes en JSON<br/>Prototipo en papel o en hoja de cálculo para probar los compromisos"]
    F1["<b>Fase 1 · Rebanada vertical en solitario</b><br/>Hangar en 1ª y 3ª persona, un escenario en órbita baja, panel de recursos<br/>Motor de simulación con tests, lanzamiento, operación e informe post-misión"]
    F2["<b>Fase 2 · Contenido y aprendizaje</b><br/>Cinco escenarios, seis órbitas, lanzadores, eventos aleatorios, dificultad<br/>Academia con mascota guía (Orbi; Rise solo con autorización), explicaciones “¿por qué?”, música adaptativa y efectos"]
    F3["<b>Fase 3 · Multijugador</b><br/>Colyseus con salas de 4, roles, solicitudes de recursos y Go/No-Go<br/>Sala de control compartida con avatares, chat y voz opcional"]
    F4["<b>Fase 4 · Pulido y lanzamiento</b><br/>Rendimiento y accesibilidad, rankings, guardar y comparar, sandbox y competitivo<br/>Despliegue en AWS, monitoreo con Sentry y pruebas E2E"]
    F0 -- "Hito: los compromisos son divertidos en papel" --> F1
    F1 -- "Hito: una misión completa jugable de principio a fin" --> F2
    F2 -- "Hito: pruebas de juego con estudiantes" --> F3
    F3 -- "Hito: cuatro jugadores estables en una misión" --> F4
    style F1 fill:#e3eefb,stroke:#2f7bd8,stroke-width:2px
```

| Fase | Documento | Hito de salida |
| --- | --- | --- |
| 0 · Preproducción | [fase-0.md](fase-0.md) | Los compromisos son divertidos en papel |
| 1 · Rebanada vertical en solitario | [fase-1.md](fase-1.md) | Una misión completa jugable de principio a fin |
| 2 · Contenido y aprendizaje | [fase-2.md](fase-2.md) | Pruebas de juego con estudiantes |
| 3 · Multijugador | [fase-3.md](fase-3.md) | Cuatro jugadores estables en una misión |
| 4 · Pulido y lanzamiento | [fase-4.md](fase-4.md) | Lanzamiento |

Estado actual de cada fase: ver la tabla de `CLAUDE.md` y `docs/STATUS.md`. Las casillas `- [ ]` de cada fase las marca quien valida la fase, no quien implementa.

Si el objetivo es un hackatón, la entrega mínima es la fase 1 más una sala cooperativa básica de la fase 3.
