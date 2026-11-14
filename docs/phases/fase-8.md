# Fase 8 · Cordura de la tripulación

Decisión: `docs/adr/0019-cordura-de-la-tripulacion.md` (propuesta). Diseño detallado: `docs/diseno/cordura-tripulacion.md`.
Fuentes NASA y sus límites: `docs/diseno/cordura-fuentes-nasa.md`.

Cada tripulante tiene una **cordura** que se desgasta con el tiempo de viaje y de exploración. Sigue los peligros
RIDGE de la NASA: radiación, aislamiento, distancia, gravedad y entorno hostil. Un tripulante desgastado trabaja
peor y comete pequeños errores, pero **nunca muere ni hace perder la partida** por ello. Recuperarlo cuesta lo
mismo que ya escasea: créditos, masa, potencia, tiempo y manos. Esa es la sinergia con las fases 1 a 6.

No iniciada · planeación documentada (2026-11-14). Depende de la fase 6 (cohesión y rol gestor en cooperativo).
Deja un gancho para las ventanas de contacto de la fase 5 (`contactWindowOpen`), pero no la necesita.

**Hito:** dos personas juegan 4 sectores en cooperativo. Si ignoran a la tripulación, terminan en banda crítica,
con reparaciones lentas y algún lapsus. Si descansan, llaman a casa y compran provisiones, llegan al sector 4 en
banda estable o tensa. Al acabar, ambas saben explicar por qué sin haber leído ningún texto.

## Punto de partida

- Hoy no existe ningún estado psicológico ni fisiológico por tripulante. `CrewMember` (`types.ts:648`) solo tiene `suitO2Pct`, `jetpackPct`, `alive` y `deathCause`. No hay rastro de cordura, moral o sueño en el código ni en el catálogo.
- El tiempo corre en `fixedStep` (`run.ts:528`, paso de 0,1 s) y solo se cuenta en segundos reales (`stats.timeS`). No hay reloj de días.
- Ganchos de rendimiento ya existentes:
  - `workMult` (`run.ts:977`), velocidad de reparación;
  - la rama `evade`;
  - `stepSurface` (`run.ts:845`), O₂ del traje;
  - `crewJetpackDrainPctPerS` y `crewCarryCapacityKg` (`roles.ts`).
- Sistemas con los que hará sinergia:
  - energía (margen de unos 10 kW a crucero);
  - economía (`actShop`, `StationQuote`);
  - mejoras (`UPGRADE_FIELDS`);
  - diseño de misión (`MODULE_KINDS`, `reviewDesign`);
  - roles (`manager` sin ventajas);
  - cooperativo (`CREW_ACTIONS`, `WORK_ACTIONS`).

## Decisiones que debe tomar la fase 8

Hay que resolverlas en el ADR 0019 (pasarlo a «aceptada») antes de escribir código. Todas son aditivas en `types.ts`.

1. **Nombre visible:** «Cordura» o «Ánimo»/«Tensión». Se recomienda «Ánimo» en la interfaz.
2. **Umbrales y calibración inicial** (65/35/12 con histéresis de 5; drenaje base de 0,035 %/s en tránsito). Se confirman con `pnpm balance`.
3. **Evento ficticio del «tercer trimestre»:** si entra o no. La NASA no lo respalda. Por defecto, desactivado.
4. **Cohesión** solo en el motor (`Incident.workers` y posiciones de EVA; recomendado) o también por cercanía a partir de las poses del servidor.
5. **Integración con la fase 5:** si la llamada a la Tierra compite con la bajada de datos dentro de la misma ventana de contacto.
6. **Persistencia entre sectores:** la cordura se arrastra entera (propuesta) o se recupera en parte con `next-sector`.
7. **Orden en el roadmap:** depende de la fase 6 (cohesión y roles); puede ir antes o después de la 7.

## Alcance previsto

### Motor (`packages/shared`)

- [ ] `sanity.ts` puro, con estas funciones:
  - bandas con histéresis;
  - drenaje RIDGE `base × D × (1+I) × S × R × C × M + H`;
  - debuffs por banda;
  - recuperación de la llamada según el retraso;
  - lapsus deterministas sin rng con estado;
  - cohesión.
- [ ] Estado aditivo:
  - `CrewMember.sanityPct?`, `sanityBand?`, `awakeS?` y los enfriamientos;
  - `RunState.psych?`;
  - `RunStats` de cordura.
- [ ] `stepPsych(dt)` en `fixedStep`, tras `refreshWarnings` y antes del permadeath. Además:
  - golpes en impactos, aterrizajes duros y muertes;
  - recompensas por trabajo significativo.
- [ ] Debuffs en `workMult` (en solitario, sin `crewId`, usa el primer vivo), `evade`, O₂ del traje, jetpack y carga.
- [ ] Acciones nuevas:
  - `rest`, mantenida;
  - `call-earth`, mantenida, con 15 kW de demanda y gancho `contactWindowOpen`;
  - `buy-provisions`, como campo aditivo `StationQuote.provisions?`, sin ampliar `SUPPLY_IDS`.
- [ ] Recuperación pasiva en estación, con tope por atraque.
- [ ] Target de mejora `crew` (`UPGRADE_FIELDS.crew`) y `effectivePsychRules`. Módulos `habitat` y `greenhouse` en `MODULE_KINDS`.
- [ ] Ventajas del gestor (`sanityAuraMult`, `sanityRecoverMult`) y aviso de Go/No-Go `crew-wellbeing` (nunca bloquea).
- [ ] Garantía: ningún código de cordura llama a `killCrew` ni a `lose`, y `LossReason` no cambia.
- [ ] Tests:
  - con `enabled: false` el `snapshot` queda idéntico;
  - drenaje extremo sin muertes;
  - determinismo con `step(0.1)` frente a `step(7.3)` y con `hydrate`;
  - barrido `psychScript` en `locales.test.ts`;
  - bot con `psychPolicy` y umbrales nuevos de balance.

### Servidor (`apps/game-server`)

- [ ] `rest` y `call-earth` en `CREW_ACTIONS` y `WORK_ACTIONS`. `buy-provisions` como `buy-supply`. Validación en `parseActionMessage`.
- [ ] Tests:
  - imposición del `crewId`;
  - presupuesto de trabajo que limita el descanso;
  - la cordura viaja en el estado.

### Cliente (`apps/client`)

- [ ] Medidor propio en `Vitals`, oculto si está estable y alta. Icono en `SuitVitals`. Anillo de banda sobre el avatar de cada compañero, sin cifra y distinguible por forma.
- [ ] Efectos por banda:
  - viñeta neutra;
  - desaturación;
  - respiración y latido;
  - oscilación de cámara de 0,15° o menos;
  - alucinaciones solo cosméticas en quiebre.
  
  Se acompaña de un ajuste nuevo, **Reducir efectos de estrés**.
- [ ] Puestos nuevos: litera (`bunk`, se mantiene E) y comunicaciones (`comms`, se carga E) en `layout.ts`, `ShipStations.tsx` e `interaction.ts`.
- [ ] Parámetro `strain` en los minijuegos. La autoridad la tiene el motor.
- [ ] Terminal de estación (provisiones y mejoras), hangar (módulos y aviso), `EndScreen` (tiempo en crítica y contramedidas usadas) y una línea opcional en `HelpOverlay`.
- [ ] Audio: sonidos nuevos y una capa musical propia (no suma a `dangerLevel`). Eventos personales en `PERSONAL_EVENTS`.

### Contenido (`packages/shared/catalog`)

- [ ] `cordura.json` con `"enabled": false` en el primer PR y todas las cifras en datos (regla 3).
- [ ] Mejoras `crew-quarters`, `leisure-kit`, `circadian-lighting` y `comm-relay`, y módulos `habitat-cabin` y `greenhouse-pod`, con nombres es/en.
- [ ] Ventajas del gestor en `roles.json`. Textos `sim` y `ui` en es/en, con mensajes del motor de 90 caracteres como máximo.
- [ ] Calibración con `pnpm balance` antes y después: el sector 1 casi neutro, el efecto notable en los sectores 3 y 4, y ninguna contramedida dominante.

## Fuera de alcance

- Muerte, derrota o pérdida de control del tripulante por cordura.
- Diálogos, personajes con historia, diarios que leer y «terapia» jugable (regla 6).
- Una segunda barra de fatiga o estrés: el sueño es un contador interno.
- Efectos de la gravedad en la mente: las fuentes de la NASA no los respaldan.
- Falsas alarmas en el motor: las alucinaciones son solo cosméticas en el cliente.

## Riesgos

- **Romper el balance actual:** se entrega primero con `enabled: false` (`pnpm balance` idéntico), y se activa y calibra en un segundo PR.
- **Demasiadas barras en el HUD:** el medidor se oculta en banda estable; en los compañeros solo se ve un anillo.
- **Trivializar la salud mental:** se usan «tensión» y «agotamiento», nunca «locura», con alucinaciones solo ambientales y el ajuste de reducir efectos. El mensaje es el de la NASA: descanso, contacto, privacidad y equipo.
- **Abusar del descanso:** el tripulante queda fuera de servicio, el descanso rinde poco con alarmas, entra en `WORK_ACTIONS` y la estación tiene tope por atraque.
- **Muro de texto:** los efectos se sienten en la mecánica; los mensajes son de una línea y la ayuda es opcional.
