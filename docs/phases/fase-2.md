# Fase 2 · Contenido y aprendizaje

**Objetivo:** convertir la rebanada vertical en un juego con contenido y ayuda pedagógica.

**Hito de salida:** *pruebas de juego con estudiantes* (observar si entienden los compromisos y si el "¿por qué?" ayuda).

**Prerrequisito:** fase 1 validada.

## Alcance previsto

- **Contenido (datos, sin tocar código):** cinco escenarios (observación de la Tierra, telecomunicaciones, telescopio espacial, exploración lunar, exploración de Marte), las seis órbitas (LEO, SSO, MEO, GEO, HEO, TLI), más lanzadores, más componentes (niveles básico/avanzado) y niveles de dificultad.
- **Eventos aleatorios** ponderados por dificultad: falla de rueda de reacción, tormenta solar, basura espacial, retraso de lanzamiento, recorte de presupuesto. Siempre vía `createRng(seed)`.
- **Academia** (tutorial): mini-misión de CubeSat en LEO que enseña cada recurso.
- **Mascota guía:** Rise **solo con autorización escrita de NASA**; si no, mascota propia (plan B del GDD). Sistema de mascota intercambiable por datos (modelo, expresiones, animaciones, diálogos JSON, versión 2D). Tecla `H` de ayuda contextual.
- **Asesores por rol** controlados por el juego en solitario.
- **Glosario y fichas** (altitud orbital, carga útil, tasa de datos, enlace).
- **Audio:** música adaptativa por capas, voces/avisos, efectos 3D, subtítulos y señales visuales.
- **Vista del instrumento** en operación (primera persona).
- Aurora G9 como vehículo de exploración en las misiones lunar/Marte (opcional).

## Entregables previstos

- [ ] 5 escenarios en `escenarios.json` con briefing, requisitos y pesos propios, en es/en.
- [ ] 6 órbitas y lanzadores con capacidad por órbita.
- [ ] Sistema de eventos con tests de determinismo.
- [ ] Academia jugable de principio a fin.
- [ ] Mascota (Rise autorizada o propia) con diálogos disparados por eventos del motor.
- [ ] Glosario bilingüe.
- [ ] Música adaptativa y efectos, con licencias registradas.
- [ ] Informe de pruebas con estudiantes y ajustes de balance resultantes.

## Criterios de aceptación previstos

- [ ] `pnpm validate` en verde con el catálogo ampliado.
- [ ] Cada escenario admite ≥ 2 soluciones válidas y fallos por causas distintas (tests).
- [ ] Una prueba con ≥ 5 estudiantes sin ayuda del equipo: la mayoría completa la Academia y una misión de campaña.
- [ ] Sin autorización documentada de NASA, el repositorio no contiene a Rise.
