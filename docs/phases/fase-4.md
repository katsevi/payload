# Fase 4 · Diseño de misión y sistema solar

Decisión: `docs/adr/0015-reto-nasa-y-roadmap.md`. Responde al reto «Space Mission Design Game» (NASA Space Apps 2026):
antes de zarpar el jugador **diseña la misión** y la partida de supervivencia de las fases 1-3 pasa a ser su *operación*.
Referencias: webinar NASA «Design and Develop Science Missions» (necesidad y metas, concepto, requisitos, diseño,
construir y verificar, operar), CubeSat 101, «Build It Yourself: Satellite!» (Webb), Mission Design Lab de Goddard y
niveles de madurez CML (JPL).

**En curso** en la rama `feat/f4-diseno-de-mision`.

**Hito:** una persona nueva diseña una misión en menos de 10 minutos (objetivo, instrumentos, módulos, lanzador),
pasa o no la revisión Go/No-Go entendiendo el motivo por una línea, y la nave que sale de ese diseño es la que juega
en un sistema solar real, donde la distancia al Sol cambia de verdad lo que le conviene llevar.

## Punto de partida

- La fase 3 está fusionada: `RunState`, `effectiveShip()`, `effectiveSurfaceRules()`, catálogo de naves, destinos,
  mundos, economía y mejoras. Hoy hay una sola nave (Colibrí) y un sector generado por semilla.
- El motor ya es determinista y por `RunAction`; el diseño debe entrar igual (datos de entrada de `createRun`), sin azar nuevo.
- Contrato `types.ts`: solo cambios aditivos (regla 2).

## Alcance previsto

### Motor (`packages/shared`)

- [ ] Tipos del diseño de misión: objetivo científico, instrumentos, módulos de nave, lanzador y destino (aditivos).
- [ ] Balance de diseño: presupuesto, masa, potencia y plazo, con una función pura que valida el diseño y lista los motivos de fallo.
- [ ] Revisión Go/No-Go: resultado y motivo como `MessageRef` de una línea.
- [ ] El diseño genera la nave de la partida (vía `effectiveShip()` o equivalente) y el lanzador limita masa y destino.
- [ ] Modelo de potencia solar con la distancia al Sol (1/d²): paneles frente a RTG.
- [ ] Sistema solar real como mapa: cuerpos y distancias con datos públicos de NASA.
- [ ] Tests: determinismo, casos límite de presupuesto, masa y potencia, y la caída de potencia con la distancia.

### Cliente (`apps/client`)

- [ ] Pantalla de diseño previa a la partida (objetivo, instrumentos, módulos, lanzador) con indicadores vivos de presupuesto, masa, potencia y plazo.
- [ ] Revisión Go/No-Go con el motivo en una línea; se puede volver a diseñar.
- [ ] Mapa del sistema solar (Luna, Marte, Fobos, Ceres/cinturón, Europa, Titán…) en lugar del mapa estelar en el modo misión.
- [ ] Ayuda opcional con tecla y glosario breve (regla 6 revisada: nunca lectura obligatoria).

### Contenido (`packages/shared/catalog`)

- [ ] Objetivos, instrumentos, módulos y lanzadores en JSON con zod y textos es/en.
- [ ] Cuerpos del sistema solar con fuente pública anotada (datos NASA); si hay texturas o imágenes, en `assets/CREDITS.md`.
- [ ] `pnpm balance` ampliado al diseño: hay diseños viables y diseños que fallan por motivos distintos.

## Fuera de alcance

- Instrumentos que generan datos, almacenamiento y bajada a la Tierra: fase 5.
- Informe post-misión y misión guiada de CubeSat: fase 5.
- Cooperativo y diseño compartido: fase 6.
- Mecánica orbital completa (trayectorias tipo GMAT): se usan distancias y ventanas simplificadas.

## Riesgos

- Que el diseño se convierta en una pantalla de lectura: mantenerlo visual, con números vivos y explicaciones opcionales.
- Alcance del contenido (instrumentos, módulos, lanzadores): empezar con un conjunto pequeño y balanceado.
- Cifras reales frente a jugabilidad: simplificar con transparencia y anotar la fuente de cada dato.
- Romper el balance de las fases 1-3 al cambiar el origen de la nave: conservar un diseño por defecto equivalente a Colibrí.
