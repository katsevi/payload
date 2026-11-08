# Prototipo en papel de Payload

Prototipo de mesa para comprobar, **sin escribir código**, el hito de la fase 0: *los compromisos de diseño son divertidos*. Se juega en una ronda de ~15 minutos con 1 a 4 personas (en grupo, se discute y se decide en común: simula los roles).

> Los valores de las cartas salen del catálogo real (`packages/shared/catalog/`). No se duplican aquí: imprime las cartas desde la hoja de cálculo (`payload-prototipo.xlsx`, hojas Componentes, Órbitas, Lanzadores y Escenarios) o cópialas a mano. Las cifras de los ejemplos de este documento son **ilustrativas**.

## Materiales

| Material | Cantidad | Notas |
| --- | --- | --- |
| Cartas de componente | 1 por componente del catálogo (2 copias de las baterías, paneles y antenas) | Ver plantilla |
| Cartas de órbita | 1 por órbita (en F1 basta LEO; para la prueba usa 2-3) | Periodo, eclipse, contacto, revisita, radiación |
| Cartas de lanzador | 1 por lanzador | Capacidad por órbita, costo, fiabilidad |
| Carta de escenario | 1 | Briefing, requisitos, presupuesto, plazo |
| Tablero de órbitas | 1 | Ver abajo |
| Hoja de presupuestos | 1 por equipo | Ver abajo |
| Dados | 2 d10 (o 1 d100) y 1 d6 | Lanzamiento y eventos |
| Calculadora y lápiz | | |
| Fichas de colores | verde, ámbar, rojo | Para marcar el margen de cada recurso |

## Plantilla de carta de componente

```text
┌─────────────────────────────┐
│ [Subsistema]  Nivel: básico │
│ NOMBRE DEL COMPONENTE       │
├─────────────────────────────┤
│ Masa      ____ kg           │
│ Consumo   ____ W            │
│ Costo     ____ M USD        │
│ Datos     ____ Mbit/día     │
│ Ciencia   ____ (0-100)      │
│ Fiabilidad ____ %           │
│ Desarrollo ____ meses       │
├─────────────────────────────┤
│ Atributo propio:            │
│ (solar W · batería Wh/DoD · │
│  bajada Mbit/s · soporta kg │
│  apuntado ° · resolución m) │
├─────────────────────────────┤
│ ¿Por qué? (1-2 frases)      │
└─────────────────────────────┘
```

Los campos salen de `ComponentDef`. Pon el color del subsistema en el borde para ordenar rápido.

## Tablero de órbitas

Dibuja la Tierra al centro y anillos concéntricos para cada órbita jugable (LEO, SSO, MEO, GEO, HEO, TLI hacia la Luna). Sobre cada anillo escribe: altitud, periodo, **minutos de eclipse**, **contacto por día y estación**, revisita y radiación. El jugador coloca su ficha de nave en el anillo elegido. Para calcular periodo y eclipse a mano:

- `a = 6371 + h` (km) · `T = 2π·√(a³ / 398 600)` segundos
- eclipse (peor caso) = `T · asin(6371 / a) / π`
- Contacto con una estación (elevación mínima ε = 10°): `λ = acos(6371·cos ε / a) − ε`; minutos/día = `1440 · (1 − cos λ)/2 · 2`.
- Ejemplo ilustrativo: h = 400 km → T ≈ 92.4 min, eclipse ≈ 36 min. Los valores ya calculados de cada órbita están en la hoja Órbitas del `.xlsx`.

## Hoja de presupuestos

Una tabla por equipo, con una fila por recurso y una columna **Usado / Disponible / Margen / Color**:

| Recurso | Usado | Disponible | Margen | Color |
| --- | --- | --- | --- | --- |
| Masa (vs el menor de: capacidad del lanzador y masa máxima de la estructura) | | | | |
| Energía media (consumo vs paneles × (1 − eclipse)) | | | | |
| Batería en eclipse (consumo × min eclipse / 60 vs Wh útiles) | | | | |
| Presupuesto (componentes + lanzador + operación = costo/año × años de vida mínima) | | | | |
| Tiempo (pieza más lenta + 0,25 meses por pieza + espera del lanzador) | | | | |
| Datos por día vs almacenamiento a bordo | | | | |
| Datos por día vs bajada (tasa de la mejor antena × contacto × estaciones) | | | | |
| Requisitos del escenario (resolución, vida, ciencia, revisita) | | | | |

Margen = (disponible − usado) / disponible. Verde ≥ 15 %, ámbar entre 0 y 15 %, rojo < 0. Igual que el motor, **solo estos rojos son No-Go**: masa, energía media, batería en eclipse, presupuesto, tiempo, y faltar un subsistema obligatorio, órbita o lanzador. Los requisitos del escenario (resolución, datos bajados, ciencia, vida, revisita), el almacenamiento, la bajada y el apuntado en rojo son **avisos**: se puede lanzar, pero la misión puede salir mal.

## Cómo jugar una ronda en 15 minutos

| Min | Paso | Qué se hace |
| --- | --- | --- |
| 0-2 | Briefing | Se lee la carta de escenario en voz alta: objetivo, presupuesto, plazo y requisitos |
| 2-5 | Elegir órbita y lanzador | Se coloca la ficha en una órbita permitida y se elige lanzador; se anotan capacidad y costo |
| 5-10 | Diseñar la nave | Se eligen cartas de componente (estructura, paneles, batería, comunicaciones, computadora, instrumentos...) y se llena la hoja de presupuestos. Se puede cambiar la órbita, el lanzador o los componentes |
| 10-11 | Go/No-Go | Revisión de la hoja: ¿algún bloqueante en rojo? Si hay, se vuelve al paso anterior (máximo 2 vueltas). Los avisos se anotan pero no impiden lanzar |
| 11-12 | Lanzamiento | Tirar d100: si sale ≤ fiabilidad del lanzador (%), éxito; si no, la misión se pierde |
| 12-14 | Operación | Tirar 1d6 por "semana" de operación del escenario (o usar 3 tiradas): evento según la tabla; se comprueba si los márgenes lo resisten |
| 14-15 | Informe | Se puntúa y se explica la **cadena de causas** de lo que falló o salió bien |

### Tabla de eventos (d6, ilustrativa; afinar tras la prueba)

| d6 | Evento | Efecto |
| --- | --- | --- |
| 1 | Sin novedad | Nada |
| 2 | Tormenta solar | Los paneles rinden 20 % menos esta semana: recalcular energía; si el margen de batería queda < 0, se pierde un componente al azar |
| 3 | Falla de rueda de reacción | Si no hay actitud redundante, los instrumentos pierden la mitad de los datos de la semana |
| 4 | Basura espacial | Tirar d6: con 1-2 hay que gastar 1 mes de presupuesto en evasión (costo extra) |
| 5 | Ventana de comunicaciones extra | +50 % de contacto esta semana |
| 6 | Sin novedad | Nada |

### Puntuación simple

`Total = 40 % objetivos + 30 % ciencia + 30 % eficiencia`, cada uno de 0 a 10.

- Objetivos: cuántos requisitos del escenario se cumplieron / total.
- Ciencia: valor científico logrado / 100.
- Eficiencia: 10 si todos los márgenes están entre 15 % y 50 % (como la curva del motor); resta 2 por cada recurso con exceso de margen (> 50 %, derroche) o en ámbar.

### Variantes para otra ronda

- Cambiar de escenario o de lanzador.
- **Reto de masa:** quitar 20 kg a la capacidad del lanzador.
- **Reto de energía:** pasar de LEO a una órbita con más eclipse.
- Competitivo: dos equipos con el mismo escenario y gana la mejor puntuación.

## Preguntas a observar en la prueba con jugadores

Haz la prueba con **al menos 3 personas** (idealmente estudiantes) y no ayudes salvo que se atasquen. Anota:

**Compromisos (el hito)**
1. ¿Hubo al menos un momento de "si subo X, se rompe Y"? ¿Lo dijeron en voz alta?
2. ¿Encontraron más de una solución válida? ¿Discutieron cuál era mejor?
3. ¿Quisieron repetir con otro diseño sin que se lo pidieras? (señal principal del hito)
4. ¿Qué recurso fue el que más limitó? ¿Es siempre el mismo (señal de balance pobre)?

**Claridad**
5. ¿Entendieron la hoja de presupuestos sin explicación? ¿Qué fila les confundió?
6. ¿Leyeron el "¿por qué?" de las cartas? ¿Les ayudó a decidir?
7. ¿Comprendieron por qué el eclipse importa para la batería?

**Ritmo y diversión**
8. ¿Cuánto tardó el diseño? ¿Se aburrieron (muchas cuentas) o se perdieron (pocas opciones)?
9. ¿El Go/No-Go se sintió como una barrera útil o frustrante?
10. ¿El informe con la cadena de causas les hizo entender el fallo?
11. ¿Los eventos aleatorios se sintieron justos o arbitrarios?

**Registro:** usa la plantilla `prototype/PLANTILLA-REGISTRO-PRUEBA.md` (una por sesión). Resumen:

| Jugador | Nivel previo | Min en diseño | ¿Repitió? | Recurso limitante | Comentario clave |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

**Criterio del hito:** la mayoría quiso repetir con otro diseño y entendió al menos una cadena de causas. Si no, ajustar el catálogo (valores, número de opciones) o las reglas antes de pasar a la fase 1, y anotarlo en `docs/STATUS.md`.
