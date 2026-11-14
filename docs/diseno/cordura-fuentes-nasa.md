# Cordura de la tripulación · Fuentes NASA

Base documental de la fase 8 (`docs/phases/fase-8.md`, ADR `docs/adr/0019-cordura-de-la-tripulacion.md`,
diseño en `docs/diseno/cordura-tripulacion.md`). Aquí se separa **lo que dice la NASA** de **lo que inventa el
juego**: la NASA describe riesgos y contramedidas de forma cualitativa; ninguna fuente da curvas numéricas de
deterioro por día. Todas las cifras del juego son **ficción de juego calibrada** con `pnpm balance`.

Investigación hecha el 2026-11-14 con lectura directa de las páginas (agente ligero de búsqueda web). Las citas
son extractos breves; antes de usarlas en material público, contrastarlas con el texto original.

## Fuentes

| # | Fuente | URL | Lectura |
| --- | --- | --- | --- |
| 1 | ¿Qué le pasa al cuerpo humano en el espacio? (NASA Ciencia, act. 2025-05-15) | https://ciencia.nasa.gov/sistema-solar/el-cuerpo-humano-en-el-espacio/ | Completa |
| 2 | Risk of Behavioral Changes and Psychiatric Disorders (NASA HRP) | https://www.nasa.gov/reference/risk-of-behavioral-changes-and-psychiatric-disorders/ | Completa |
| 3 | 5 Hazards of Human Spaceflight (NASA HRP) | https://www.nasa.gov/hrp/hazards/ | Completa |
| 4 | Risk of Inadequate Teamwork (NASA HRP) | https://www.nasa.gov/reference/risk-of-inadequate-teamwork/ | Completa |
| 5 | Risk from Inadequate Sleep and Irregular Schedules (NASA HRP) | https://www.nasa.gov/reference/risk-from-inadequate-sleep-and-irregular-schedules/ | Completa |
| 6 | NASA's Twins Study Results Published in Science Journal (2019-04-11) | https://www.nasa.gov/humans-in-space/nasas-twins-study-results-published-in-science-journal/ | Completa |
| 7 | Human Research Roadmap: riesgo de equipo | https://humanresearchroadmap.nasa.gov/risks/risk.aspx?i=101 | Solo resumen de búsqueda |
| 8 | Human Research Roadmap: riesgo de sueño | https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=100 | Solo resumen de búsqueda |
| 9 | HERA, Human Exploration Research Analog (paquete de información) | https://www.nasa.gov/wp-content/uploads/2015/08/hrp-hera-experiment-information-package.pdf | Solo resumen de búsqueda |

Las fuentes 1 y 2 son las que propuso el equipo. Las 3 a 6 las completan con el resto de riesgos de la NASA que
tocan la conducta. Las 7 a 9 solo sirven de contexto y no respaldan ninguna cifra del juego.

## Lo que dicen las fuentes

**Fuente 1 (NASA Ciencia)**
- Asocia el riesgo de trastornos de conducta a lo restringido del espacio y al poco contacto con personas ajenas al entorno.
- El sueño se altera por los ciclos de luz y oscuridad, por un espacio pequeño y ruidoso y por el estrés. La iluminación LED ayuda al sueño y a la alerta.
- Contramedidas que cita:
  - actigrafía;
  - diario personal, «como un lugar seguro para desahogar sus frustraciones»;
  - realidad virtual con entornos relajantes;
  - aprender idiomas o destrezas médicas;
  - huerto espacial.
- Cifras:
  - misiones de 6 a 12 meses en la ISS;
  - retraso de comunicación con Marte de hasta 20 min en una dirección;
  - unos 6 meses por trayecto a Marte;
  - el día marciano dura 37 min más.

**Fuente 2 (riesgo de conducta)**
- Riesgo de «adverse cognitive or behavioral changes and psychiatric disorders».
- Factores:
  - aislamiento y confinamiento prolongados;
  - retraso de comunicaciones en misiones de varios años;
  - falta de privacidad, en un hábitat «roughly the size of a studio apartment» (dato sin verificar en el original);
  - monotonía.
- Efectos: ansiedad, depresión, y cambios en el sueño, la moral y la toma de decisiones.
- Contramedidas:
  - diario;
  - plantas frescas;
  - comunicación virtual con la familia y el personal médico;
  - análogos terrestres (HERA);
  - máxima privacidad.

**Fuente 3 (los cinco peligros, RIDGE)**
- Radiación: «considered one of the most hazardous aspects of spaceflight».
- Aislamiento y confinamiento: «isolated and confined in a small space over a long period of time».
- Distancia a la Tierra: el apoyo desde casa es «increasingly challenging to receive from Earth».
- Gravedad: «must adjust to the new gravities».
- Entorno hostil y cerrado: «Maintaining a safe ecosystem inside a spacecraft presents unique challenges».

**Fuente 4 (trabajo en equipo)**
- Riesgo de «performance and behavioral health decrements» por cooperación, coordinación, comunicación y adaptación psicosocial insuficientes.
- El retraso de comunicaciones y un hábitat más pequeño que la ISS ponen a prueba la cohesión.
- No hay reabastecimiento.
- Contramedidas: selección de equipos que «will work well together», entrenamiento previo en trabajo en equipo y apoyo médico.

**Fuente 5 (sueño y horarios)**
- Riesgo por «sleep loss, circadian desynchronization, and work overload».
- En la ISS hay 16 amaneceres al día.
- Contramedidas: iluminación LED de día y noche, estudios sobre luz y cafeína, y tiempos designados de relajación y autocuidado.

**Fuente 6 (estudio de los gemelos)**
- La cognición de Scott Kelly «remained largely unchanged» en órbita.
- Al volver se observó «a more pronounced decrease in speed and accuracy», que duró unos seis meses.
- Para el juego, esto respalda que el rendimiento cognitivo es medible y que puede caer tras un cambio de entorno.

## RIDGE → modelo del juego

| Peligro NASA | Efecto mental según las fuentes | Cómo entra en el juego | Variable del motor (diseño) |
| --- | --- | --- | --- |
| **R**adiación | Ninguno psicológico directo en las fuentes | Multiplicador leve del drenaje en zonas con radiación. Es ficción de juego: la ansiedad por la exposición es una inferencia | `R` = ×1.3 si la zona tiene `radiation` |
| **I**slamiento y confinamiento | Monotonía, falta de privacidad, ánimo bajo (1, 2) | Base del drenaje más el factor de monotonía, que se reinicia con un destino nuevo | `base[contexto]`, `I` (`sinceNoveltyS`) |
| **D**istancia a la Tierra | Retraso de comunicaciones, impotencia, menos apoyo (1, 2, 4) | Multiplicador por distancia y llamadas que rinden menos con el retraso | `D` (`sector` o `sunDistanceAu`), `commsDelayMin` |
| **G**ravedad | Ninguno psicológico en las fuentes | **Queda fuera del modelo de cordura.** Se dice así a propósito para no inventar | — |
| **E**ntorno hostil y cerrado | Ruido, alarmas, estrés y ritmo circadiano alterado (1, 5) | Sumandos por averías activas, O₂ bajo, tormentas y traje crítico. Golpes por impactos y muertes | `H`, golpes instantáneos |

## Factor de riesgo → fuente → mecánica

| Factor | Fuente | Mecánica |
| --- | --- | --- |
| Aislamiento y confinamiento prolongados | 1, 2, 3 | Drenaje base en tránsito |
| Retraso de comunicaciones (hasta 20 min) | 1, 2, 4 | `call-earth` rinde `1 / (1 + retraso/20 min)` |
| Monotonía | 2 | Factor `I`; un nodo nuevo, un aterrizaje o un sector nuevo lo reinician |
| Falta de privacidad | 2 | Mejora `crew-quarters` y módulo `habitat-cabin` |
| Sueño, ritmo circadiano y sobrecarga | 5, 1 | `awakeS` multiplica el drenaje (factor `S`); `rest`; `circadian-lighting` |
| Conflicto y cohesión de equipo | 4 | `cohesionPct` con ≥2 tripulantes; reparar en grupo la sube |
| Duración de la misión | 1, 2 | `D` crece por sector; aviso `crew-wellbeing` con `deadlineMonths ≥ 48` |
| Entorno pequeño, ruidoso y estresante | 1 | Sumando `H` por averías y alarmas |
| Pérdida de un compañero | Inferencia de diseño | Golpe de −20 a cada superviviente |

## Contramedida NASA → mecánica

| Contramedida citada | Fuente | Mecánica de la fase 8 |
| --- | --- | --- |
| Tiempos designados de descanso y autocuidado | 5 | Litera y acción `rest` |
| Comunicación con la familia y el personal médico | 2 | `call-earth`; mejora `comm-relay` |
| Iluminación LED de día y noche | 1, 5 | Mejora `circadian-lighting` (reduce la penalización por sueño) |
| Realidad virtual y ocio | 1 | Mejora `leisure-kit` (reduce la monotonía) |
| Huerto y plantas frescas | 1, 2 | Módulo `greenhouse-pod`; consumible «provisiones frescas» |
| Máxima privacidad | 2 | `crew-quarters`, `habitat-cabin` |
| Entrenamiento y selección de equipo | 4 | Cohesión; aviso `crew-wellbeing` en el diseño |
| Apoyo médico y psicológico | 2, 4 | Ventajas del rol gestor (`sanityAuraMult`, `sanityRecoverMult`) |
| Aprender destrezas y trabajo significativo | 1 | Recompensas por reparar, vender, recolectar y superar sectores |
| Diario personal | 1, 2 | **Fuera de alcance**: sería texto que leer (regla 6). Lo representa el descanso |

## Advertencias

- **Las cifras del juego no son de la NASA.** Drenajes, umbrales, recuperaciones y multiplicadores son ficción de juego. La NASA aporta qué factores existen y qué contramedidas hay, no cuánto pesa cada uno.
- **Sin verificar:** las «unas 6 h de sueño por noche» en la ISS y el «studio apartment» salieron de resúmenes de búsqueda. No los uses como cita sin abrir el original.
- **Fenómeno del tercer trimestre:** no hay estudio de la NASA que lo respalde. Su origen está en anécdotas polares (Bechtel y Berning, 1991), y revisiones posteriores (Kanas et al., 2021) no hallan una evidencia estadística sólida. Si entra en el juego, será un **evento ficticio opcional** marcado como tal.
- **HERA y Mars-500:** sus hallazgos son preliminares y salen de muestras pequeñas; HERA aparece solo como contexto. Mars-500 no se verificó y no se cita.
- **Gravedad:** las fuentes no la relacionan con la salud mental, y el juego no inventa esa relación.

## Tono y respeto

La salud mental es un tema serio. La fase 8 lo trata como un **recurso de equipo que se cuida**, no como un
espectáculo de terror:

- **Nombres en la interfaz:** «tensión» y «agotamiento». Nunca «locura».
- **Sin imágenes ni voces que asocien la enfermedad mental con el peligro o la violencia.** Las «alucinaciones» son solo ambientales: luces que parpadean y ruidos lejanos.
- **Ajuste para reducir los efectos de estrés**, por accesibilidad.
- **El mensaje de juego** es el que da la NASA: el descanso, el contacto con casa, la privacidad, el trabajo con sentido y el equipo protegen a la tripulación.
