# 0019 · Cordura de la tripulación: desgaste por tiempo con debuffs y contramedidas atadas a recursos

- Estado: propuesta
- Fecha: 2026-11-14
- Nota: el 0018 sigue reservado para la fase 5. Este ADR acompaña a la fase 8 (`docs/phases/fase-8.md`).

## Contexto

Hoy viajar y explorar solo desgasta la nave. La tripulación no siente el paso del tiempo: un tripulante rinde
igual en el primer sector que en el quinto. Las fuentes de la NASA (`docs/diseno/cordura-fuentes-nasa.md`)
documentan lo contrario. El aislamiento, la distancia, el entorno cerrado, la falta de sueño y los conflictos de
equipo degradan la conducta y el rendimiento, y hay contramedidas conocidas: descanso, contacto con casa,
privacidad, huerto, ocio y trabajo en equipo. Queremos que eso **se juegue** (regla 6) y que se enganche con los
sistemas existentes (energía, economía, diseño de misión, roles y cooperativo) en lugar de ser un minijuego aparte.
El diseño completo está en `docs/diseno/cordura-tripulacion.md`.

## Decisión

1. **Una barra individual, `sanityPct`, y una cohesión de equipo** que solo existe con 2 o más tripulantes vivos. El sueño es un contador interno (`awakeS`), no otra barra.
2. **El drenaje sigue los peligros RIDGE:** `base[contexto] × D × (1+I) × S × R × C × M + H`. La gravedad queda fuera porque las fuentes no la ligan a la mente.
3. **Solo debuffs, por bandas con histéresis:** estable, tensa, crítica y quiebre (65/35/12, histéresis de 5).
   - Bajan la velocidad de trabajo y la esquiva, y suben el gasto de O₂ del traje y del jetpack.
   - Reducen la carga.
   - Provocan lapsus deterministas leves.
   - **Nunca matan ni hacen perder**: no hay `LossReason` nuevo ni llamadas a `killCrew` o `lose`.
4. **Cada contramedida cuesta un recurso que ya existe:**
   - descanso: un tripulante fuera de servicio;
   - llamada a la Tierra: 15 kW y peor rendimiento con la distancia;
   - provisiones: créditos;
   - mejoras con target `crew`: créditos, kg y kW;
   - módulos `habitat` y `greenhouse`: M$, masa, plazo y fiabilidad;
   - rol gestor: una persona;
   - trabajo bien hecho y cooperación: se recompensan.
5. **El estado vive entero en `RunState`**, con campos aditivos y opcionales. Los lapsus usan una tirada sin estado, con `deriveSeed` anidado: `deriveSeed(deriveSeed(deriveSeed(seed, PSYCH_SALT), steps), crewId)`. No tocan `wearRng`. Todo viaja por `snapshot`, `hydrate` y el estado del cooperativo.
6. **Las alucinaciones son solo cosméticas en el cliente.** El motor nunca crea incidentes ni avisos falsos.
7. **Provisiones como acción propia** (`buy-provisions` + `StationQuote.provisions?`), sin ampliar `SUPPLY_IDS`.
8. **Despliegue en dos pasos:** primero el catálogo con `"enabled": false` (el juego queda idéntico y `pnpm balance` también), después se activa y se calibra.

## Consecuencias

- Hay cambios aditivos en `types.ts`:
  - `CrewMember` y `RunState.psych?`;
  - tres `RunAction` nuevas;
  - cinco tipos de evento;
  - target `crew` y dos `MODULE_KINDS`;
  - ventajas de rol;
  - `Incident.workers?` y `StationQuote.provisions?`.
- Ninguno rompe el contrato.
- Hay un catálogo nuevo (`cordura.json`) con esquema zod. Todas las cifras están en datos.
- Tests nuevos:
  - `sanity.test.ts`;
  - un barrido de locales;
  - determinismo con `hydrate`;
  - umbrales de balance con `psychPolicy` en el bot;
  - tests del servidor para las acciones nuevas.
- El rol `manager` recibe por fin ventajas propias.
- El diseño de misión gana el aviso `crew-wellbeing` para misiones largas.
- Hay más superficie de interfaz (medidor, puestos de litera y comunicaciones, efectos y ajuste de accesibilidad), un trabajo de tono para no trivializar la salud mental, y una calibración que exige `pnpm balance` en cada ajuste.
- La fase 5 tendrá que decidir si la llamada compite con la bajada de datos en las ventanas de contacto (gancho `contactWindowOpen`).

## Alternativas descartadas

- **Varias barras (fatiga, estrés, moral):** más interfaz y más balance sin decisiones nuevas.
- **Muerte o derrota por cordura:** choca con el tono de party game y con el mensaje de la NASA de cuidar a la tripulación.
- **Ampliar `SUPPLY_IDS` con «comfort»:** rompe el esquema estricto de precios, `StationQuote`, la tienda del cliente y la del bot.
- **Cohesión por cercanía con las poses del cliente:** las poses no entran al motor (ADR 0017). Inyectarlas desde el servidor añade complejidad. Queda como opción si los datos del motor no bastan.
- **Falsas alarmas en el motor:** romperían la regla de que lo que se ve es verdad, y en cooperativo harían actuar a cada cliente con datos distintos.
- **Reloj de días como regla:** el tiempo del juego son segundos reales. `missionDays` es solo narrativo.
