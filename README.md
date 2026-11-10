# Payload

Simulador 3D web de **diseño de misiones espaciales** para 1-4 jugadores. Caminas por un hangar en
primera o tercera persona, montas una nave pieza a pieza, eliges órbita y lanzador, pasas la revisión
Go/No-Go, lanzas, operas la misión y lees un informe que explica *por qué* salió bien o mal. El
objetivo educativo es entender los compromisos del diseño de misiones: cada decisión mueve masa,
energía, presupuesto, datos, comunicaciones y vida útil.

Stack: TypeScript, React 19, React Three Fiber v9, Drei, Rapier, Zustand, XState, i18next, Vite,
Tailwind 4, Vitest, pnpm + Turborepo. Interfaz en español (por defecto) e inglés.

## Estado

| Fase | Estado |
| --- | --- |
| 0 · Preproducción | Entregables hechos. El hito (los compromisos son divertidos en papel) sigue **pendiente de una prueba con personas reales**. |
| 1 · Rebanada vertical en solitario | Hecha y validada con observaciones: una misión completa (menú, briefing, hangar, Go/No-Go, lanzamiento, operación, informe). |
| 2 · Contenido y aprendizaje | Hecha y validada con observaciones: 5 escenarios de campaña y Academia, eventos por dificultad, mascota Orbi, glosario, audio procedural y vista del instrumento. El hito (pruebas con >= 5 estudiantes) está **pendiente**. |
| 3 · Multijugador | Hecha y validada con observaciones: servidor autoritativo Colyseus que corre el mismo motor, roles, solicitudes de recursos, Go/No-Go compartido, sala de control con avatares, chat y pings. El hito (cuatro personas reales en equipos distintos) está **pendiente**; la voz WebRTC (opcional) no está implementada. |
| 4 · Pulido y lanzamiento | Pendiente (`apps/api` es un marcador) |

Detalle, métricas y acciones pendientes: [`docs/STATUS.md`](docs/STATUS.md).

## Requisitos

- Node.js >= 22 (`.nvmrc` fija 24: `nvm use`)
- pnpm 11 (`packageManager: pnpm@11.25.0`; con Corepack: `corepack enable`)
- Un navegador con WebGL2 y una laptop de gama media o mejor

## Instalación y comandos

```bash
pnpm install
pnpm dev          # cliente en http://localhost:5173
pnpm dev:server   # servidor de juego en ws://localhost:2567 (solo para jugar en equipo)
pnpm test         # tests de todos los paquetes (Vitest)
pnpm typecheck    # tsc --noEmit en todos los paquetes
pnpm build        # build de producción (Turborepo)
pnpm validate     # typecheck + test + build: debe pasar antes de entregar
```

Otros comandos útiles:

```bash
pnpm proto                                  # prototipo de compromisos en terminal (fase 0)
pnpm proto --brief                          # resumen de los 9 diseños de ejemplo
pnpm proto --design ok-cubesat-leo --seed 7 --events --lang en
pnpm --filter @payload/shared test:watch    # TDD del motor
pnpm --filter @payload/shared bench         # rendimiento del motor (fuera de los tests)
pnpm --filter @payload/client preview       # sirve el build de producción
```

## Cómo se juega

Flujo: **menú → briefing → hangar → revisión Go/No-Go → [pre-lanzamiento] → lanzamiento → operación → informe** (y desde
el informe, "Rediseñar" vuelve al hangar con el diseño anterior y un nuevo intento).

| Control | Acción |
| --- | --- |
| `W` `A` `S` `D` | Moverse por el hangar |
| Ratón (con *pointer lock*) | Mirar. Se activa al hacer clic en la escena |
| `Esc` | Soltar el ratón / cerrar paneles |
| `V` | Alternar primera / tercera persona (hangar, lanzamiento, operación) |
| `E` | Interactuar: tomar una pieza del estante, montarla o desmontarla de la nave, abrir la consola |
| `Q` | Devolver la pieza que llevas |
| `Tab` | Panel de recursos (barras de margen con estado en color y texto, y "¿por qué?") |
| `H` | Ayuda contextual de la fase (la mascota Orbi la explica; desactivable en Ajustes) |
| `G` | Glosario y fichas de conceptos (altitud orbital, carga útil, tasa de datos, enlace...) |
| `I` | Vista del instrumento (en operación); en las misiones lunar y Marte permite ver la superficie con el rover Aurora G9 |

En operación, la **aceleración temporal** va en pasos de 0×, 1×, 10×, 100×, 1000× y 10 000× (0× es pausa).

**Modo accesible 2D:** en Ajustes se activa un panel 2D equivalente que permite completar todo el
flujo sin caminar ni usar controles 3D (el hangar no se monta). Ajustes también permite cambiar el
idioma (es/en, sin recargar), el campo de visión, el balanceo de cabeza, la sensibilidad y las sombras.

**Contenido de la fase 2:**

- **Escenarios:** el menú ofrece 5 misiones de campaña (observación de la Tierra en LEO, telecomunicaciones en GEO, telescopio espacial, exploración lunar polar, expedición a Marte) y la **Academia** (mini-misión de CubeSat de 21 pasos guiada por la mascota). Cada partida usa un intento nuevo (semilla distinta) y "Rediseñar" conserva tu diseño.
- **Eventos aleatorios** por dificultad: tormenta solar, basura espacial, falla de rueda, sobrecalentamiento, falla de componente y, antes del lanzamiento, retrasos y recortes de presupuesto. Siempre deterministas por semilla.
- **Asesores por rol** (director, ingeniería, ciencia, operaciones) y mascota con ayuda contextual.
- **Audio:** música adaptativa y efectos generados en el navegador (sin archivos), con subtítulos de sonido y avisos visuales; volúmenes y silencio en Ajustes.

## Jugar en equipo (fase 3)

Hasta 4 jugadores en la misma misión, cada uno con un rol (Dirección, Ingeniería, Ciencia, Operaciones); con menos de 4, un jugador agrupa roles.

1. Arranca el servidor y el cliente en dos terminales: `pnpm dev:server` y `pnpm dev`. El cliente busca el servidor en `VITE_GAME_SERVER_URL` o, si no existe, en `ws(s)://<hostname>:2567` (para jugar en red local, abre el cliente con la IP del anfitrión y deja el puerto 2567 accesible).
2. En el menú pulsa **Jugar en equipo**, elige escenario y pon tu nombre.
3. **Sala privada:** crea una sala y comparte el código (es el `roomId`); el resto entra con ese código. **Partida rápida:** te une a una sala en el lobby del mismo escenario o crea una.
4. En el lobby el anfitrión (el primero en entrar) reparte los roles y empieza la misión. Después: briefing, diseño en el hangar compartido, **revisión Go/No-Go con voto por rol** (un No-Go exige motivo y devuelve a todos al diseño), lanzamiento, operación (las alertas de equipo pausan la simulación hasta que respondan los roles implicados) e informe con la puntuación de equipo.
5. Cada rol decide sobre sus piezas; si una acción empeora un recurso de otro rol, se convierte en una **solicitud** que ese rol aprueba o rechaza (puede encadenarse a varios roles).

| Tecla (en sala) | Acción |
| --- | --- |
| `T` | Chat |
| `R` | Solicitudes de recursos |
| `P` | Ping (en el hangar: a la pieza apuntada o al punto al que miras) |

El escenario de equipo `polar-ice-watch-team` (2-4 jugadores) solo se ofrece en sala. Si pierdes la conexión, tienes 60 s para volver (el cliente reintenta con su token). La voz WebRTC no está implementada. Contrato completo: [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md); servidor: [`apps/game-server/README.md`](apps/game-server/README.md).

Todavía **no** hay soporte de mando ni táctil, ni giro por pasos (ver `docs/STATUS.md`).

## Estructura del monorepo

```text
payload/
├─ apps/
│  ├─ client/        # React 19 + R3F v9 + Drei + Rapier + Vite (escenas, UI, i18n)
│  ├─ game-server/   # Fase 3: servidor Colyseus autoritativo (salas de hasta 4 jugadores)
│  └─ api/           # Fase 4: NestJS + Prisma (marcador, sin código)
├─ packages/
│  └─ shared/        # contrato de tipos, motor de simulación, mecánica orbital (TS puro)
│     ├─ catalog/    # componentes, orbitas, lanzadores, escenarios + glosario, mascota, academia (.json)
│     └─ locales/    # textos del motor (namespace `sim`) en es/en
├─ assets/
│  ├─ models/source/ # modelos .glb ORIGINALES (nunca se modifican; se versionan en el repo)
│  ├─ web/models/    # optimizados que sirve Vite (publicDir) como /models/<archivo>.glb
│  └─ CREDITS.md     # autor, fuente y licencia de cada asset
├─ prototype/        # Fase 0: CLI, hoja de cálculo (.xlsx) y prototipo en papel
├─ docs/             # GDD, fases, ADRs, arquitectura, estado, guía de contribución
└─ .claude/          # agentes y skills del proyecto para Claude Code
```

## Tests y prototipos

- `pnpm test` ejecuta la suite del motor (`packages/shared`, 335 tests en 18 archivos), la del cliente (122 tests en 8 archivos, incluido un E2E contra el servidor real) y la del servidor (`apps/game-server`, 78 tests en 7 archivos).
  Qué cubre cada una: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#testing).
- **CLI del motor:** `pnpm proto` (ver `prototype/README.md`). Diseños de ejemplo en `prototype/designs/`.
- **Hoja de cálculo:** `pnpm --filter @payload/shared exec tsx ../../prototype/build-sheet.ts` regenera
  `prototype/payload-prototipo.xlsx` desde el catálogo.
- **Prototipo en papel:** `prototype/PROTOTIPO-PAPEL.md`; registra cada sesión con
  `prototype/PLANTILLA-REGISTRO-PRUEBA.md` (copia en `prototype/pruebas/`).

## Atajos de desarrollo

Solo con `pnpm dev` (se ignoran en el build de producción), añadidos a la URL:

| URL | Efecto |
| --- | --- |
| `/?phase=briefing` | Salta al briefing |
| `/?phase=design` | Salta al hangar. Opciones: `&demo=1` monta una pieza de cada subsistema, `&view=third` abre en tercera persona |
| `/?phase=launch`, `?phase=operation`, `?phase=report` | Arranca en esa fase con un diseño de ejemplo ya armado |
| `/?room=demo&phase=lobby\|briefing\|design\|review\|prelaunch\|operation\|report` | Sala de ejemplo sin servidor (3 jugadores; opcional `&role=director\|engineering\|science\|operations`) |

## Créditos de assets 3D

Todos los modelos son de Sketchfab. Detalle, enlaces y cambios en [`assets/CREDITS.md`](assets/CREDITS.md);
también se muestran en la pantalla de créditos del juego.

| Modelo | Autor | Licencia | Uso |
| --- | --- | --- | --- |
| Astronaut by Jungle Jim | Jungle Jim | CC-BY-4.0 | Avatar del jugador en 3ª persona |
| Aurora G9 Expedition Walker Mech | Jungle Jim | CC-BY-4.0 | Exhibición en el hangar |
| Our Milky Way galaxy | aditya299792 | CC-BY-4.0 | Fondo del menú y del espacio |
| Programme ERIZON | nejenabinupa | **CC-BY-NC-ND-4.0** | Estación de fondo en la escena orbital |
| Sci-Fi Computer Desk Console | Inditrion Dradnon | CC-BY-4.0 | Consola de misión del hangar |

Aurora G9 también hace de rover (`payload-surface-rover`) en las misiones lunar y Marte. El audio es procedural y no usa archivos.

> **Aviso:** ERIZON es CC-BY-NC-ND: **no puede usarse comercialmente** ni modificarse (solo lleva
> compresión técnica de geometría). Hay que sustituirlo por un modelo CC0/CC-BY antes de cualquier uso
> comercial. Está aislado en un solo componente (`ErizonStation`) para retirarlo fácilmente.

Los originales están en `assets/models/source/` y **se versionan en el repositorio** (el mayor,
`programme_erizon.glb`, pesa ~31 MB, por debajo del límite de 100 MB de GitHub). La mascota Rise
(Artemis II) requiere autorización de NASA y no está incluida: la mascota actual es Orbi, original del proyecto (ver `docs/GDD.md`, sección Mascota).

## Documentación

| Documento | Contenido |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Guía y reglas del proyecto para Claude Code (y para personas) |
| [`docs/STATUS.md`](docs/STATUS.md) | Estado, métricas, acciones pendientes y traspaso entre sesiones |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura actual y objetivo |
| [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md) | Contrato del multijugador (protocolo, roles, solicitudes, Go/No-Go) |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Flujo de trabajo, agentes, skills y permisos |
| [`CHANGELOG.md`](CHANGELOG.md) | Cambios por versión |
| [`docs/GDD.md`](docs/GDD.md) | Documento de diseño del juego |
| [`docs/phases/`](docs/phases/README.md) | Roadmap y checklist de cada fase |
| [`docs/adr/`](docs/adr/README.md) | Decisiones de arquitectura |
| [`docs/plan-original/`](docs/plan-original/plan-juego-misiones-espaciales.md) | Plan original |
| [`prototype/README.md`](prototype/README.md) | Prototipos de la fase 0 |
| [`assets/README.md`](assets/README.md) | Pipeline de assets |
