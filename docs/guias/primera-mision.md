# Guía: diseña tu primera misión

Paso a paso para pasar la revisión Go/No-Go de **«Hielo en los polos lunares»** (`mission-lunar-ice`), la misión más fácil, y
zarpar con la nave que has diseñado. Dura unos 5 minutos. Sobre cómo funciona por dentro: `docs/phases/fase-4.md` y ADR 0016.

La misión pide: ciencia >= 60 con un instrumento de **hielo**, fiabilidad >= 80 %, presupuesto **600 M$** y plazo **36 meses**.
El destino es la Luna (único posible, ya viene elegido).

## Cómo abrirla

1. `pnpm dev` y abre `http://localhost:5173`.
2. Menú → **Diseñar una misión** → tarjeta **Hielo en los polos lunares** («Diseñar»).
   Atajo de desarrollo: `http://localhost:5173/?design=1&mission=mission-lunar-ice`.

Estás en el **hangar**: arriba, destino y lanzador; a la izquierda, la paleta de piezas en grupos; a la derecha, los medidores
y la revisión; abajo, las piezas montadas.

## Paso a paso

1. **Lanzador:** elige **Cóndor** (65 M$, espera 4 meses, lleva 15 t a la Luna). Es el más barato que llega.
2. **Estructura** (grupo *Estructura*): **Casco estándar** (14 ranuras, aguanta 19 t). Solo cabe una estructura; si eliges otra, sustituye a la anterior.
3. **Propulsión** (grupo *Propulsión*): **Motor químico**. Solo cabe un sistema de propulsión; también sustituye al anterior.
4. **Energía** (grupo *Energía*): **Alas solares de alta eficiencia** y **Alas solares**.
5. **Comunicaciones:** **Antena omnidireccional**. **Computadora:** **Computadora de vuelo**.
6. **Baterías:** **Banco de baterías**. **Blindaje:** **Generador de escudos**.
7. **Tanques:** **Tanque de combustible**, añadido **dos veces** (Intro dos veces, o «+» en la tarjeta).
8. **Térmico:** **Radiadores**.
9. **Instrumentos** (grupo *Instrumentos*): **Espectrómetro de neutrones** y **Radar de penetración**. Los dos son de hielo y suman ciencia 65 (pide 60).
10. Cuando el botón **Lanzar** deje de decir «corrige lo rojo» y la revisión muestre **Go**, púlsalo.

## Medidores esperados

Con ese diseño (`alas-solares-y-radar`, el primer diseño válido del fixture `mission-lunar-ice.json`):

| Medidor | Valor | Estado |
| --- | --- | --- |
| Masa | 10 640 / 15 000 kg | Bien |
| Potencia | 110 / 113 kW | **Justo** (aviso «al límite», no bloquea) |
| Coste | 443 / 600 M$ | Bien |
| Calendario (plazo) | 25 / 36 meses | Bien |
| Ranuras | 12 / 14 | **Justo** (aviso, no bloquea) |
| Combustible | 22 / 68 | Bien |

La potencia se mide en el **peor punto de la ruta** (para la Luna, el asteroide Ryugu a 1,19 UA, no la Luna a 1 UA): ahí los paneles dan
menos que en la Tierra. Por eso 113 kW y no 160. El Go es válido aunque haya avisos amarillos.

## Si un medidor sale en rojo

Pulsa **H** para ver el motivo de una línea de cada medidor. Qué hacer:

| Medidor / causa | Qué significa | Qué hacer |
| --- | --- | --- |
| **Masa** (`mass-launcher`) | Pesa más de lo que el lanzador lleva a esa zona | Quita piezas pesadas (tanques, una estructura más grande) o elige un lanzador mayor (más caro y con más espera) |
| **Masa** (`mass-structure`) | Más de lo que aguanta la estructura | Quita masa o cambia a una estructura más resistente (más cara) |
| **Potencia** (`power`) | Los paneles no cubren el consumo en el peor punto de la ruta | Añade paneles (**Alas solares**) o una fuente nuclear (RTG: constante, pero 120 M$ y 26 meses); o quita consumo (motor iónico, escudos) |
| **Coste** | Se pasa de 600 M$ (el lanzador cuenta) | Quita piezas caras o cambia a un lanzador más barato; el motor iónico y el RTG son caros |
| **Calendario** | Desarrollo + espera del lanzador pasan de 36 meses | Quita piezas de desarrollo largo (RTG 26 meses, motor iónico 20) o un lanzador con menos espera |
| **Ranuras** | Más piezas que ranuras de la estructura | Quita piezas o elige una estructura con más ranuras |
| **Combustible** (`range`) | El tramo más largo pide más del que hay (con reserva) | Añade **Tanque de combustible** (+40 cada uno) o cambia a propulsión iónica (la mitad de combustible por distancia) |
| **Ciencia** (`science`, `missing-science-kind`) | Falta un instrumento de hielo o no se llega a 60 | Monta el **Espectrómetro de neutrones** y el **Radar de penetración** |
| Sin estructura, motor, energía, antena o computadora | Falta una pieza obligatoria | Añade una de cada; el motivo lo dice la revisión |
| **Fiabilidad** | Solo avisa (no bloquea) | Es informativo en la fase 4; no cambia la partida |

Los avisos amarillos (al límite, térmico, sin baterías, sin blindaje, radiación) no bloquean. Hoy `thermal`, `reliability` y
`no-battery` no tienen efecto en la partida, pero el hangar los muestra.

## Teclas

| Tecla | Acción |
| --- | --- |
| **↑ ↓** | Moverse por las piezas del grupo |
| **← →** | Cambiar de grupo |
| **Intro** (o **+**) | Añadir la pieza señalada |
| **Supr**, **Retroceso** o **−** | Quitar una unidad de la pieza señalada |
| **Clic** en una pieza montada (abajo) | Quitar esa pieza |
| **H** | Mostrar u ocultar el «¿por qué?» de cada medidor |
| **G** o **?** | Glosario de 14 términos (UA, RTG, Go/No-Go, ranura...) |
| **Esc** | Volver a la lista de misiones |

El diseño se guarda solo por misión (`payload.design.mission-lunar-ice` en el navegador). **Vaciar** empieza de cero.

## Segundo diseño válido: propulsión iónica

Variante `ionica-estandar` (misma misión, más cara y con más potencia):

- **Lanzador:** Cóndor. **Estructura:** Casco estándar. **Propulsión:** **Propulsión iónica**.
- **Energía:** **Alas solares de alta eficiencia** ×2 y **Alas solares** ×1.
- **Comunicaciones:** Antena omnidireccional. **Computadora:** Computadora de vuelo. **Baterías:** Banco de baterías. **Blindaje:** Generador de escudos.
- **Tanques:** **Tanque de combustible** ×1 (basta: el motor iónico gasta la mitad). Sin radiadores.
- **Instrumentos:** Espectrómetro de neutrones y Radar de penetración.

Medidores: masa 9 290 / 15 000 kg, potencia 155 / 184 kW, coste 590 / 600 M$ (al límite), calendario 30 / 36 meses, ranuras 11 / 14,
combustible 9 / 34. Sale **Go** con un aviso térmico (la nave genera 155 kW de calor y disipa 100). El motor iónico va más lento
(velocidad de crucero ×0,65), pero ahorra combustible.

## Después de lanzar

La partida es la de siempre (nave, averías, aterrizajes, estaciones) sobre el **mapa del sistema solar** 3D: la distancia al Sol cambia la
potencia de los paneles y el HUD la muestra en UA. Al terminar, **Rediseñar** vuelve al hangar con tu diseño y **Reintentar la misión**
repite con el mismo diseño y otra semilla. Atajo para zarpar directo con el diseño de referencia:
`http://localhost:5173/?play=1&seed=7&mission=mission-lunar-ice`.

> Hoy el objetivo de la misión no termina la partida (pendiente de la fase 5): llegar a la Luna no cierra la misión ni puntúa aparte.
