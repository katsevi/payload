# Fase 4 · Pulido y lanzamiento

**Objetivo:** dejar el juego listo para el público: rendimiento, accesibilidad, persistencia y operación en producción.

**Hito de salida:** lanzamiento (el plan original no fija un hito posterior).

**Prerrequisito:** fase 3 validada. `apps/api` es hoy solo un marcador.

## Alcance previsto

- **Rendimiento:** meta de 60 FPS en laptop de gama media, calidad automática, LOD, texturas KTX2; WebGPU opcional si se justifica.
- **Accesibilidad:** auditoría completa, mando (Gamepad API) y soporte táctil, revisión de contraste y de alternativas 2D.
- **Modos:** competitivo (2+ equipos) y sandbox (sin límites).
- **API** (NestJS + Prisma + PostgreSQL): cuentas (invitado + OAuth Google/GitHub), diseños guardados, rankings por escenario, informes.
- **Guardar, compartir por enlace y comparar** diseños lado a lado.
- **Despliegue en AWS:** S3 + CloudFront (cliente y assets), ECS Fargate (Colyseus y API), RDS PostgreSQL, ElastiCache Redis (o Colyseus Cloud).
- **Observabilidad:** Sentry (errores de WebGL/WebGPU, rendimiento por dispositivo).
- **Pruebas E2E** con Playwright del flujo completo.
- **Licencias antes de publicar:** decisión sobre `programme_erizon.glb` (CC-BY-NC-ND: sustituir si el juego es comercial), autorización de NASA para Rise o mascota propia, pantalla de créditos completa.

## Entregables previstos

- [ ] Informe de rendimiento por dispositivo y ajustes aplicados.
- [ ] Auditoría de accesibilidad y correcciones.
- [ ] `apps/api` con cuentas, diseños y rankings.
- [ ] Modos competitivo y sandbox.
- [ ] Guardar/compartir/comparar diseños.
- [ ] Infraestructura como código y pipeline de despliegue.
- [ ] Sentry integrado.
- [ ] Suite E2E en CI.
- [ ] Revisión legal de licencias de assets y audio documentada.

## Criterios de aceptación previstos

- [ ] E2E del flujo completo en verde en CI.
- [ ] Despliegue reproducible en AWS con el cliente servido desde CDN.
- [ ] Un diseño guardado se puede abrir desde un enlace y compararse con otro.
- [ ] Ningún asset publicado incumple su licencia (revisión contra `assets/CREDITS.md`).
