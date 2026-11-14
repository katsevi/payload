# Fase 7 · Pulido y lanzamiento

Antes fase 5 (renumerada por `docs/adr/0015-reto-nasa-y-roadmap.md`). Depende de la fase 6 (cooperativo).

No iniciada: `apps/api` es un marcador.

**Hito:** el juego está publicado en una URL, aguanta una sesión de 4 jugadores y tiene un ranking fiable.

## Alcance previsto

- [ ] Rankings por semilla y globales. Solo son fiables si el servidor recalcula la partida con el motor.
- [ ] `apps/api` (NestJS + Prisma + PostgreSQL): cuentas de invitado, marcas, partidas guardadas.
- [ ] Mando y táctil; giro por pasos (anti-mareo); revisión de accesibilidad.
- [ ] Mezcla de audio escuchada y ajustada; música propia si se decide.
- [ ] Tutorial jugable de un minuto si las pruebas de la fase 1 lo piden.
- [ ] E2E con Playwright, CI, Sentry y despliegue (cliente estático + servidor de juego).
- [ ] Decidir el modelo de estación: sustituir ERIZON (CC-BY-NC-ND) antes de cualquier uso comercial.
- [ ] Rendimiento: 60 FPS en una laptop de gama media; reducir el chunk de la escena de la nave.
