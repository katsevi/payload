# Fase 4 · Diseño de misión y sistema solar

Decisión: `docs/adr/0015-reto-nasa-y-roadmap.md`. Responde al reto «Space Mission Design Game» (NASA Space Apps 2026):
antes de zarpar el jugador **diseña la misión** y la partida de supervivencia de las fases 1-3 pasa a ser su *operación*.
Referencias: webinar NASA «Design and Develop Science Missions» (necesidad y metas, concepto, requisitos, diseño,
construir y verificar, operar), CubeSat 101, «Build It Yourself: Satellite!» (Webb), Mission Design Lab de Goddard y
niveles de madurez CML (JPL).

**Estado:** Implementada · validada con observaciones · fusionada (PR #6, commit `750255a`). Hito pendiente de prueba con personas. Decisiones técnicas: `docs/adr/0016-diseno-de-mision-y-sistema-solar.md`. Cómo se juega: `docs/guias/primera-mision.md`.

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

- [x] Tipos del diseño de misión: objetivo científico, instrumentos, módulos de nave, lanzador y destino (aditivos): `MissionDesign`, `missionDesignSchema`/`parseMissionDesign`/`normalizeDesign` (`createRun` lanza con un diseño mal formado; las funciones de diseño lo normalizan a vacío).
- [x] Balance de diseño: presupuesto, masa, potencia y plazo, con funciones puras (`computeDesignBudgets`, `emptyDesign`). La potencia se mide en el **peor punto de la ruta** (`routeWorstSunDistance`).
- [x] Revisión Go/No-Go (`reviewDesign`): resultado y motivo como `MessageRef` de una línea por problema.
- [x] El diseño genera la nave de la partida (`shipFromDesign`, que alimenta `effectiveShip()`); el lanzador limita masa y destino por zona; `rules.maxShieldAbsorb`.
- [x] Modelo de potencia solar con la distancia al Sol (1/d²): paneles frente a RTG (`solarPowerFactor`, `solarKw`, `shipPowerKw`).
- [x] Sistema solar real como mapa: cuerpos y distancias con datos públicos de NASA (`generateSolarSector`, ruta por zonas de ida y vuelta, `bodyPositionAu`, `solarNodePositionsAu`). Júpiter y Saturno no son aterrizables.
- [x] Tests: determinismo, casos límite de presupuesto, masa y potencia, y la caída de potencia con la distancia. 257 tests en 11 archivos (shared); partida clásica idéntica bit a bit a la fase 3 (28 partidas del validador, mismo hash).

### Cliente (`apps/client`)

- [x] Pantalla de diseño previa a la partida (hangar: paleta en grupos, instrumentos, módulos, lanzador y destino) con medidores vivos de masa, potencia, coste, calendario, ranuras y combustible. Guardado por misión en `payload.design.<misión>`.
- [x] Revisión Go/No-Go con el motivo en una línea; «Lanzar» solo con Go; se puede volver a diseñar («Rediseñar» y «Reintentar la misión» en el fin de partida).
- [x] Mapa del sistema solar (Luna, Marte, Fobos, Ceres/cinturón, Europa, Titán…) en 3D (escala 10·√UA) en lugar del mapa estelar en el modo misión; el `StarMap` SVG queda para la partida libre.
- [x] Ayuda opcional con tecla (H «¿por qué?») y glosario breve de 14 términos (G o «?»; regla 6 revisada: nunca lectura obligatoria).

### Contenido (`packages/shared/catalog`)

- [x] Objetivos, instrumentos, módulos y lanzadores en JSON con zod y textos es/en: `misiones.json` (6), `modulos.json` (22), `instrumentos.json` (13), `lanzadores.json` (4: Cóndor, Ariete, Cóndor Pesado, Coloso).
- [x] Cuerpos del sistema solar con fuente pública anotada (`sistema-solar.json`: 25 cuerpos con fuente NASA y 7 estaciones ficticias). Sin texturas ni imágenes nuevas. Mundos `mars-surface`, `ice-moon`, `titan-surface` y `enceladus-surface` con `weight: 0` (solo sistema solar).
- [x] `pnpm balance` ampliado al diseño: hay diseños viables y diseños que fallan por motivos distintos (balance por misión, ver más abajo).

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

## Resultado y verificación

- `pnpm validate` 11/11 con **430 tests** (257 shared en 11 archivos + 173 client en 6 archivos).
- Perfiles clásicos de `pnpm balance` idénticos a la línea base de la fase 3.
- Validación independiente: «cumple con observaciones» (ver «Pendiente heredado»).

### Balance por misión (`pnpm balance 100 3`, tripulación 3,5 s)

Ruta completa = 2·(zonas−1) tramos. Columnas: % que acaba la ruta / % que llega al objetivo.

| Misión | Diseño | Ruta / objetivo |
| --- | --- | --- |
| Luna | `alas-solares-y-radar` | 100 / 100 |
| Luna | `ionica-estandar` | 100 / 100 |
| Asteroide | `taladro-camara-e-infrarrojo-a-ryugu` | 100 / 100 |
| Asteroide | `ligera-a-bennu` | 98 / 8 |
| Marte | `tres-alas-solares` | 100 / 100 |
| Marte | `hibrida-rtg` | 100 / 100 |
| Cinturón | `fision-doble-rtg-blindada` | 91 / 100 |
| Cinturón | `fision-rtg-justa-de-potencia` | 74 / 97 |
| Europa | `coloso-nuclear-completa` | 8 / 87 |
| Europa | `ligera-sin-escudos-a-ganimedes` | 5 / 40 |
| Titán | `quimica-con-fision-y-rtg` | 1 / 53 |
| Titán | `ionica-con-dos-reactores` | 0 / 37 |

Los No-Go representativos se pierden en vuelo (paneles en Júpiter: 90 pérdidas por casco; solo RTG en Titán: 100; sin combustible de vuelta en Marte: 100 % varadas). En Europa y Titán casi todas las partidas se pierden en la **vuelta** (varada o casco).

## Pendiente heredado

Lo que dejaron abierto la validación y el balance; la fase 5 decide qué entra (ver `fase-5.md`).

- **El objetivo no termina la partida.** `missionTarget` (nodo del destino) solo lo usa el bot de balance: llegar no puntúa ni cierra la misión, y la ruta ida y vuelta se repite como los sectores.
- **Avisos sin efecto en la partida:** `thermal`, `reliability` y `no-battery` solo avisan en el Go/No-Go; `heatRejectKw` no se usa en `run.ts`. El enlace (`comms-range`) no tiene efecto en vuelo: el No-Go `antena-corta` del cinturón juega igual que un Go. Tampoco hay fallo de lanzamiento.
- **Europa y Titán casi no completan la vuelta** (8 % y 1 % la ruta completa): combustible o casco; ajustar `lanzadores.json`/`sistema-solar.json` o la reserva de combustible.
- **`ligera-a-bennu`** llega al objetivo el 8 %: casi nunca llega a Bennu.
- **Gravedades escaladas** a la jugabilidad: Encélado 0,5 (real 0,11), Ceres 0,6 (0,28), Ío 2,4 (1,8), cuerpos pequeños 0,4.
- Los paneles escalan con la salud del reactor.
- Dos `<Canvas>` con el mapa solar abierto (nave y mapa): coste de rendimiento sin medir.
- La **misión guiada de CubeSat** necesita otra escala de módulos (hoy la estructura más ligera pesa 1 500 kg y el lanzador más pequeño lleva 15 t a la Luna).
- **Sin verificar por personas:** diseñar una misión en < 10 min (hito), FPS con el mapa solar, tramos con Júpiter y Saturno, mundos nuevos en superficie.
