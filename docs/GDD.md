# Payload — documento de diseño (GDD v2)

Diseño del juego vigente desde el 2026-11-09. Plan de partida: `docs/plan/plan-tripulacion-de-exploracion.md`.
Por qué se rehízo el juego: `docs/adr/0011-reinicio-tripulacion-de-exploracion.md`. El GDD del simulador
anterior está en `docs/archivo/v0.3-simulador/GDD.md`.

Leyenda: **[F1]** existe hoy (fase 1) · **[F2] [F3] [F4] [F5]** diseño previsto para esa fase.

## 1. Concepto

Cooperativo de supervivencia y gestión de recursos espaciales para 1-4 jugadores. Sois la tripulación de
una nave exploradora: viajáis de destino en destino, bajáis a superficies peligrosas a recoger materiales,
los vendéis y mejoráis la nave. Todo ocurre en tiempo real y con **permadeath**: si la nave se destruye o
la tripulación muere, la expedición se acaba y se empieza de cero.

Tono: party game tenso, no simulador. Se entiende en un minuto y se pierde por decisiones propias.

## 2. Pilares

1. **Los compromisos se sienten, no se leen.** Cada decisión de ingeniería (régimen de motores, reparto
   de energía, ruta, repuestos) cambia lo que pasa en los 30 segundos siguientes. No hay pantallas de
   lectura obligatoria; los mensajes caben en una línea.
2. **El espacio físico manda.** Los sistemas son lugares de la nave. Arreglar algo exige ir hasta allí, y
   no se llega a todo: de ahí nace la cooperación.
3. **Riesgo contra recompensa.** Lo más valioso está donde es más fácil morir.
4. **Partidas cortas, mucha rejugabilidad.** Un sector dura unos 4 minutos; cada partida tiene su semilla.

## 3. Ciclo de juego

| Paso | Qué hace el jugador | Fase |
| --- | --- | --- |
| Planificar | Mapa estelar: destino, régimen de motores, repostar | F1 |
| Viajar | Mantener viva la nave en el salto: impactos, fuego, cortos, fugas | F1 |
| Aterrizar y explorar | Bajar a la superficie con jetpack y oxígeno limitado, recoger materiales | F2 |
| Regresar y mejorar | Vender, reparar y comprar mejoras en estaciones | F3 |

En la fase 1 el ciclo es planificar → viajar → llegar (estación o contenedor a la deriva) hasta alcanzar
el **portal de salto** del sector; cruzarlo lleva a un sector más largo y peligroso con la misma nave.

## 4. La nave [F1]

Interior caminable en 1ª o 3ª persona. La proa mira a −Z. Distribución en `apps/client/src/game/layout.ts`.

| Zona | Puestos |
| --- | --- |
| Puente | **Timón** (régimen de motores, maniobra evasiva) · **Mapa estelar** (ruta, servicio de estación) · **Navegación** (sensores) |
| Cubierta media | **Soporte vital** · **Escudos** |
| Sala de máquinas | **Panel de energía** · **Reactor** · **Motores** |

Del timón al reactor hay unos 4 s corriendo. El aviso de un impacto a crucero llega con 8 s: da para ir
al timón, pero no para ir, volver y además apagar un fuego. Un test (`game.test.ts`) vigila esa relación.

### Recursos

| Recurso | Baja por | Sube por | A cero |
| --- | --- | --- | --- |
| Casco | Impactos, fuego | Servicio de estación | Nave destruida |
| Oxígeno | Tripulación, fugas, fuego | Soporte vital en línea | Tripulación muerta |
| Combustible | Saltos, maniobras evasivas | Estaciones, contenedores | Nave varada |
| Energía | (demanda de los sistemas encendidos) | Salud del reactor | Apagón: nada funciona |
| Repuestos | Reparar sistemas | Estaciones, contenedores | Los daños ya no se arreglan |

### Sistemas

Cinco sistemas con salud 0-100 %: reactor, motores, soporte vital, escudos y navegación. Todos menos el
reactor se pueden apagar en el panel de energía.

- **Reactor (110 kW):** su potencia cae con su salud. Si la demanda supera a la potencia hay
  **sobrecarga** y el reactor se daña 1 %/s hasta que alguien apague algo. Un corto en el reactor es un apagón.
- **Motores (40 kW a crucero):** dañados van más lentos y gastan más. Sin motores la nave no avanza.
- **Soporte vital (20 kW):** regenera 0,7 % de O₂ por segundo; la tripulación gasta 0,25.
- **Escudos (30 kW):** absorben el 65 % de cada impacto y evitan daños internos; cada golpe los desgasta.
- **Navegación (10 kW):** sin sensores no hay aviso de impactos ni datos de riesgo en el mapa.

### Régimen de motores

| Régimen | Velocidad | Combustible | Consumo de motores | Desgaste |
| --- | --- | --- | --- | --- |
| Económico | ×0,65 | ×0,7 | 24 kW | ×0,5 |
| Crucero | ×1 | ×1 | 40 kW | ×1 |
| Máxima | ×1,6 | ×1,6 | 64 kW | ×2,2 |

Con todo encendido, crucero pide 100 kW (cabe) y máxima 124 kW (no cabe: hay que apagar escudos o
sensores). Ir rápido además acorta el aviso de los impactos, porque los sensores avisan por distancia.

## 5. Averías y peligros [F1]

| Avería | Efecto | Arreglo (mantener E junto al sistema) |
| --- | --- | --- |
| **Fuego** | −2,5 %/s al sistema, −0,35/s al casco, −0,5 %/s de O₂; a los 35 s salta a otro sistema | 3,5 s |
| **Cortocircuito** | El sistema se apaga; a los 28 s se convierte en fuego | 2,5 s |
| **Fuga de O₂** | −1,4 %/s de oxígeno | 3 s |
| **Impacto** | 8-18 de casco. Con escudos, el 35 %. Sin escudos, además daña un sistema y puede abrir una fuga | Evadir en el timón (0,7 s, 3 de combustible) |

Los **sistemas dañados** se reparan con un kit de repuestos (4 s, +50 % de salud).

Los peligros de cada salto se sortean al iniciarlo según el destino (un campo de asteroides trae impactos;
una nebulosa, cortos y fuegos) y el sector. Además hay averías por **desgaste**, más frecuentes a máxima.

## 6. El sector [F1]

Mapa generado por semilla: estación de salida, 4-7 columnas de 2-3 destinos y el portal. Solo se puede
saltar entre destinos enlazados. Siempre hay una estación intermedia y el generador garantiza que existe
una ruta completable a régimen económico.

| Destino | Peligro al acercarse | Qué ofrece |
| --- | --- | --- |
| Estación | Bajo | Servicio una vez: depósito lleno, +40 de casco, +2 repuestos |
| Planeta / Luna | Medio | A veces un contenedor. Superficie explorable [F2] |
| Campo de asteroides | Impactos (alto) | Contenedor casi seguro y grande. Superficie explorable [F2] |
| Nebulosa | Cortos y fuegos | Contenedor con mucho combustible |
| Nave abandonada | Fugas e impactos | Contenedor seguro con repuestos |
| Portal de salto | Medio | Fin del sector |

Cada sector suma un 40 % de peligro y, cada dos, una columna más.

## 7. Compromisos de ingeniería (lo que pide el reto)

| Decisión | Se gana | Se paga |
| --- | --- | --- |
| Régimen máximo | Menos tiempo expuesto | Combustible, energía, desgaste, menos margen de reacción |
| Apagar escudos | 30 kW libres | Cada impacto duele casi el triple y rompe cosas |
| Apagar sensores | 10 kW libres | Impactos sin aviso, mapa a ciegas |
| Ruta corta por asteroides | Combustible y botín | Casco |
| Ruta por estaciones | Reparación y depósito lleno | Distancia y tiempo |
| Gastar un repuesto ahora | Sistema recuperado | Puede faltar cuando falle el reactor |
| Evadir | El casco | 3 de combustible y dejar lo que estabas haciendo |
| **[F3]** Carga a bordo | Dinero | Masa: más combustible por salto |
| **[F3]** Motores mejores | Alcance | Consumo eléctrico y precio |

## 8. Roles de la tripulación

| Rol | Puesto | En la fase 1 (solitario) | En cooperativo [F4] |
| --- | --- | --- | --- |
| Piloto | Timón | Régimen y maniobra evasiva | Además aterrizaje y despegue [F2] |
| Ingeniero | Toda la nave | Apagar fuegos, rearmar cortos, sellar fugas, reparar | Igual, a tiempo completo |
| Gestor de recursos | Panel de energía, mapa | Reparto de energía, ruta, combustible | Igual; decide qué se sacrifica |
| Explorador / científico | Superficie | — | Lidera las salidas [F2] |

En solitario una persona hace los cuatro papeles y no llega a todo: esa escasez es la que el cooperativo
resuelve repartiendo puestos. Con 2-3 jugadores los roles se agrupan.

## 9. Permadeath y puntuación [F1]

Se pierde por casco a cero, oxígeno a cero o nave varada (sin combustible para ningún salto, o sin
motores/reactor ni repuestos). La partida se reinicia entera; solo se guarda la mejor marca.

Puntuación: 1000 por sector + 50 por salto + 20 por avería resuelta + 30 por impacto esquivado + años luz.

Balance con tripulante simulado (`pnpm balance`, 200 partidas): atendiendo las averías se supera el
sector 1 casi siempre y el 4 entre el 35 % y el 75 % según lo rápido que se llegue a los puestos; sin
atender nada se supera el sector 1 un 6 % de las veces.

## 10. Controles e interfaz [F1]

| Tecla | Acción |
| --- | --- |
| WASD / flechas, Mayús | Moverse, correr |
| Ratón | Mirar (clic para capturar el ratón) |
| E | Usar el puesto cercano; **mantener** para arreglar, reparar o evadir |
| Q | Cambiar el régimen (en el timón) |
| 1-4 | Encender/apagar sistemas (con el panel de energía abierto) |
| V | 1ª / 3ª persona |
| H | Ayuda |
| Esc | Pausa |

Interfaz: cuatro barras (casco, oxígeno, combustible, energía) y repuestos; estado del viaje; cuenta
atrás del impacto; lista de averías abiertas; carteles en el mundo que se ven a través de los mamparos.
Luces de alarma por zona. Todo aviso sonoro tiene equivalente visual (destello y subtítulo opcional).

## 11. Fases siguientes (diseño previsto)

- **[F2] Superficie.** Desde un destino explorable se desciende; el aterrizaje lo ejecuta el piloto y un
  aterrizaje brusco daña casco y sistemas. En tierra: gravedad propia de cada mundo, jetpack con
  combustible, oxígeno personal, materiales de distinto valor cada vez más lejos de la nave, tormentas y
  terreno inestable. Si muere toda la tripulación en la superficie, se pierde la partida. Se reutiliza el
  mecha Aurora G9 como vehículo.
- **[F3] Economía.** Las estaciones compran minerales y muestras y venden combustible, reparaciones y
  mejoras (depósitos, escudos, motores de salto, trajes, tanques de O₂, jetpacks). El servicio gratuito
  de estación de la fase 1 desaparece. La carga pesa.
- **[F4] Cooperativo 1-4.** Servidor autoritativo que corre el mismo motor (ADR 0009), roles, voz o
  pings, y dificultad escalada con el número de jugadores.
- **[F5] Pulido.** Rankings, mando y táctil, despliegue, pruebas E2E.

## 12. Assets y licencias

Modelos en uso: astronauta (tripulante), consola (timón), galaxia (menú y holograma del mapa) y estación
ERIZON (se ve al atracar en una estación; CC-BY-NC-ND: sin uso comercial ni derivados). El mecha Aurora
G9 está reservado para la fase 2. El audio es procedural. Detalle en `assets/CREDITS.md`.

Mascota: el juego nuevo no tiene. Si se añade una, **Rise** (Artemis II) sigue necesitando autorización
escrita de NASA y el sistema debe permitir cambiarla por una propia.

## 13. Preguntas abiertas

1. ¿El portal de salto encaja con "regresar a estaciones seguras" del plan, o el sector debe ser de ida y
   vuelta a una base? (Hoy: de ida; cada sector empieza en una estación.)
2. ¿Cuánta ayuda en la primera partida? Hoy hay una pantalla de ayuda (H) y carteles; no hay tutorial.
3. ¿Dificultad en solitario frente a 4 jugadores? Pendiente de la fase 4.
4. ¿Se sustituye ERIZON antes de cualquier uso comercial?
