# Payload

Juego cooperativo 3D web de **supervivencia y gestión de recursos espaciales** para 1-4 jugadores. Sois
la tripulación de una nave exploradora: trazáis la ruta, saltáis de destino en destino y mantenéis viva
la nave —casco, oxígeno, combustible y reactor— mientras todo se rompe a la vez. Con permadeath: si la
nave se destruye o la tripulación se queda sin aire, se empieza de cero.

Los compromisos de ingeniería (potencia, combustible, tiempo, riesgo) no se explican: se juegan.

Stack: TypeScript, React 19, React Three Fiber v9, Drei, Rapier, Zustand, i18next, Vite, Tailwind 4,
Vitest, pnpm + Turborepo. Interfaz en español (por defecto) e inglés.

> **Cambio de rumbo (2026-11-09).** Hasta la versión 0.3.0 Payload era un simulador de diseño de misiones.
> Se rehízo como juego de tripulación (ADR [0011](docs/adr/0011-reinicio-tripulacion-de-exploracion.md)).
> La versión anterior está en la etiqueta `v0.3.0-simulador` y su documentación en
> [`docs/archivo/`](docs/archivo/README.md).

## Estado

| Fase | Estado |
| --- | --- |
| 1 · Viaje y nave (en solitario) | **Implementada**: mapa estelar, saltos, interior caminable, sistemas, averías en tiempo real y permadeath. Pendiente de validación independiente y de prueba con jugadores. |
| 2 · Exploración de superficie | **Implementada** (rama `feat/f2-superficie`): descenso, jetpack, oxígeno personal, recolección, tormentas y despegue. Pendiente de validación independiente final y de prueba con jugadores. |
| 3 · Economía y progresión | **Implementada** (rama `feat/f3-economia-progresion`): créditos, terminal de estación (venta, suministros y 11 mejoras con contrapartida) y la carga pesa. Validada con observaciones; pendiente de prueba con jugadores. |
| 4 · Cooperativo 1-4 | **En curso** (rama `feat/f4-cooperativo`): servidor autoritativo, sala privada con código, roles con ventajas pasivas, avatares y pings. Falta validarla y probarla con cuatro equipos en red local. Contrato: [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md). |
| 5 · Pulido y lanzamiento | Pendiente (`apps/api` es un marcador). |

Detalle, métricas y acciones pendientes: [`docs/STATUS.md`](docs/STATUS.md). Roadmap: [`docs/phases/`](docs/phases/README.md).

## Requisitos

- Node.js >= 22 (`.nvmrc` fija 24: `nvm use`)
- pnpm 11 (`packageManager: pnpm@11.25.0`; con Corepack: `corepack enable`)
- Un navegador con WebGL2

## Instalación y comandos

```bash
pnpm install
pnpm dev          # cliente en http://localhost:5173
pnpm test         # tests de todos los paquetes (Vitest)
pnpm typecheck    # tsc --noEmit en todos los paquetes
pnpm build        # build de producción (Turborepo)
pnpm validate     # typecheck + test + build: debe pasar antes de entregar
pnpm balance      # informe de balance: 200 partidas jugadas por un tripulante simulado
```

Otros comandos útiles:

```bash
pnpm balance 500 5                          # 500 semillas, objetivo 5 sectores
pnpm --filter @payload/shared test:watch    # TDD del motor
pnpm --filter @payload/client preview       # sirve el build de producción
```

En desarrollo, `http://localhost:5173/?play=1&seed=7` entra directo a una partida con esa semilla;
añade `&surface=1` para entrar directo a la superficie (`descent` o `landed` para otros momentos).

## Cómo se juega

Lleva la nave desde la estación de salida hasta el **portal de salto** del sector. En el mapa estelar
eliges destino y régimen de motores; durante el salto, lo que se rompa hay que ir a arreglarlo en persona.
En los planetas, lunas y campos de asteroides puedes bajar (una vez por destino) a recoger materiales con
jetpack y oxígeno limitado, y volver a la nave antes de que se acabe.

| Control | Acción |
| --- | --- |
| `W` `A` `S` `D` / flechas | Moverse por la nave |
| `Mayús` | Correr |
| Ratón | Mirar (clic para capturar el ratón) |
| `E` | Usar el puesto cercano (mapa, panel, timón); **mantener** para bajar a un mundo o despegar; en superficie, colocar una herramienta de minería o recoger lo extraído |
| Clic / `Espacio` | La habilidad de cada avería (apuntar el extintor, marcar el pulso, soltar la presión) |
| `R` | Reparar un sistema con un repuesto (mantener y soltar en la marca) |
| `Q` | Alternativa: cambiar el régimen de motores (en el timón); en tierra, soltar la carga o retirar una herramienta |
| `Espacio` | En superficie: salto y jetpack; cayendo, frena la caída; en el descenso, frena. En averías, como el clic |
| `C` | En superficie: bajar con el jetpack |
| `1`-`4` | Encender o apagar sistemas (con el panel de energía abierto) |
| `V` | 1ª / 3ª persona |
| `H` | Ayuda |
| `Esc` | Pausa |

Para esquivar un impacto, pulsa `E` en el timón y pilota la nave con `WASD` entre las rocas del holograma. En superficie, la minería la hacen herramientas desplegables que extraen solas. Los ajustes de accesibilidad permiten esquiva simple, averías simples (mantener una tecla) y puntería ancha.

Cinco reglas que conviene saber:

1. El **fuego** destroza el sistema y el casco, y se propaga.
2. Una **fuga** vacía el oxígeno en poco más de un minuto.
3. Un **cortocircuito** apaga su sistema; si lo dejas, se incendia.
4. Con **sensores** verás venir los impactos: corre al timón y evade.
5. A **régimen máximo** no hay energía para todo: decide qué apagas, o el reactor se daña.

Diseño completo: [`docs/GDD.md`](docs/GDD.md).

## Estructura

```text
payload/
├─ apps/
│  ├─ client/        # React 19 + R3F + Rapier + Vite: escenas, interfaz, audio, i18n
│  ├─ game-server/   # servidor autoritativo del cooperativo (Colyseus; corre el motor de shared)
│  └─ api/           # marcador: rankings y persistencia (fase 5)
├─ packages/
│  └─ shared/        # motor del juego en TypeScript puro, con tests
│     ├─ catalog/    # naves, averías, destinos, sectores, mundos, economía y mejoras (.json)
│     └─ locales/    # textos del motor (es/en)
├─ assets/           # modelos 3D (originales y optimizados) y CREDITS.md
├─ docs/             # plan, GDD, fases, ADR, arquitectura, estado, archivo
└─ .claude/          # agentes y skills para Claude Code
```

## Documentación

| Documento | Para qué |
| --- | --- |
| [`docs/plan/plan-tripulacion-de-exploracion.md`](docs/plan/plan-tripulacion-de-exploracion.md) | El plan del juego |
| [`docs/GDD.md`](docs/GDD.md) | Diseño: nave, recursos, averías, sector, compromisos, roles |
| [`docs/phases/`](docs/phases/README.md) | Roadmap y alcance de cada fase |
| [`docs/STATUS.md`](docs/STATUS.md) | Estado actual, métricas y pendientes (traspaso entre sesiones) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Cómo encajan motor, cliente y servidor |
| [`docs/adr/`](docs/adr/README.md) | Decisiones de arquitectura |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Ramas, commits, PR y trabajo con Claude |
| [`CHANGELOG.md`](CHANGELOG.md) | Cambios por versión |
| [`assets/CREDITS.md`](assets/CREDITS.md) | Autores y licencias de los modelos |

## Licencias de assets

Los modelos 3D son de Sketchfab con licencia CC-BY 4.0, salvo `programme_erizon.glb` (la estación), que es
**CC-BY-NC-ND**: sin uso comercial y sin obras derivadas. Detalle en [`assets/CREDITS.md`](assets/CREDITS.md).
