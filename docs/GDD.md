# Payload — documento de diseño (GDD v2)

Diseño del juego vigente desde el 2026-11-09. Plan de partida: `docs/plan/plan-tripulacion-de-exploracion.md`.
Por qué se rehízo el juego: `docs/adr/0011-reinicio-tripulacion-de-exploracion.md`. El GDD del simulador
anterior está en `docs/archivo/v0.3-simulador/GDD.md`.

Leyenda: **[F1]** existe desde la fase 1 · **[F2]** existe desde la fase 2 (superficie) · **[F3]** existe desde la fase 3 (economía) · **[F4]** en curso (cooperativo; ver `docs/MULTIPLAYER.md`) · **[F5]** diseño previsto.

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
| Aterrizar y explorar | Descenso frenando a mano, salir con jetpack y oxígeno limitado, recoger materiales y volver | F2 |
| Regresar y mejorar | Vender, reparar y comprar mejoras en estaciones | F3 (existe) |

En la fase 1 el ciclo era planificar → viajar → llegar (estación o contenedor a la deriva) hasta alcanzar
el **portal de salto** del sector; cruzarlo lleva a un sector más largo y peligroso con la misma nave.

## 4. La nave [F1]

Interior caminable en 1ª o 3ª persona. La proa mira a −Z. Distribución en `apps/client/src/game/layout.ts`.

| Zona | Puestos |
| --- | --- |
| Puente | **Timón** (régimen de motores, maniobra evasiva) · **Mapa estelar** (ruta, terminal de estación) · **Navegación** (sensores) |
| Cubierta media | **Soporte vital** · **Escudos** |
| Sala de máquinas | **Panel de energía** · **Reactor** · **Motores** |

Del timón al reactor hay unos 4 s corriendo. El aviso de un impacto a crucero llega con 8 s: da para ir
al timón, pero no para ir, volver y además apagar un fuego. Un test (`game.test.ts`) vigila esa relación.

### Recursos

| Recurso | Baja por | Sube por | A cero |
| --- | --- | --- | --- |
| Casco | Impactos, fuego | Terminal de estación (casco de pago) y ayuda de emergencia | Nave destruida |
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

| Avería | Efecto | Arreglo (junto al sistema; cada una con su habilidad) |
| --- | --- | --- |
| **Fuego** | −2,5 %/s al sistema, −0,35/s al casco, −0,5 %/s de O₂; a los 35 s salta a otro sistema | Extintor: mantener clic o Espacio con la mira sobre el foco; 3,5 s de trabajo |
| **Cortocircuito** | El sistema se apaga; a los 28 s se convierte en fuego | Pulsos de sincronía: clic cuando la marca pasa por la zona (dos aciertos bastan); 2,5 s de trabajo |
| **Fuga de O₂** | −1,4 %/s de oxígeno | Mantener para subir la presión y soltar en la zona; 3 s de trabajo |
| **Impacto** | 8-18 de casco. Con escudos, el 35 %. Sin escudos, además daña un sistema y puede abrir una fuga | Evadir en el timón: pilotar 3 s entre rocas en el holograma (3 de combustible; si llegas con menos de 3,4 s, resultado con roces, nunca limpio; una flecha y un pitido te guían al timón); cada roce deja entrar el 20 % del daño y chocar de lleno el 90 % |

El aviso de un impacto da tiempo para llegar al timón y jugar la esquiva (3 s) solo según el régimen: unos 8,9 s de margen en económico, 4,6 s en crucero y 1,6 s en máxima (un test fija que cruzar la nave cuesta como mucho 3,9 s).

Los **sistemas dañados** se reparan con un kit de repuestos (R junto al sistema: mantener y soltar en la marca, en dos tramos; 4 s, +50 % de salud). Tres ajustes de accesibilidad sustituyen los minijuegos por mantener una tecla (esquiva simple, averías simples) o ensanchan el área del extintor (puntería ancha).

Los peligros de cada salto se sortean al iniciarlo según el destino (un campo de asteroides trae impactos;
una nebulosa, cortos y fuegos) y el sector. Además hay averías por **desgaste**, más frecuentes a máxima.

## 6. El sector [F1]

Mapa generado por semilla: estación de salida, 4-7 columnas de 2-3 destinos y el portal. Solo se puede
saltar entre destinos enlazados. Siempre hay una estación intermedia y el generador garantiza que existe
una ruta completable a régimen económico.

| Destino | Peligro al acercarse | Qué ofrece |
| --- | --- | --- |
| Estación | Bajo | Terminal de pago [F3]: vender carga, comprar suministros y mejoras; ayuda de emergencia gratuita una vez (75 % del depósito, 50 % del casco, 1 repuesto) |
| Planeta / Luna | Medio | A veces un contenedor. Superficie explorable [F2] (una vez por destino) |
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
| **[F2]** Una veta más | Más puntos (crecen con la distancia, el peligro y la racha de lo que llevas) | Oxígeno del traje: no se recupera fuera de la nave |
| **[F2]** Recoger materiales comunes | Combustible y repuestos al guardarlos | Peso (menos margen al despegar) y tiempo fuera |
| **[F2]** Salir | Botín | Oxígeno de la nave para rellenar el traje; la nave sigue averiándose |
| **[F2]** Frenar tarde en el descenso | Combustible | Casco, sistemas y posibles fugas o cortos al tocar |
| Carga a bordo [F3] | Dinero | Masa: más combustible por salto |
| Mejoras de nave [F3] | Alcance, escudos, margen | Consumo eléctrico, masa y precio |

## 8. Roles de la tripulación

| Rol | Puesto | En la fase 1 (solitario) | En cooperativo [F4] |
| --- | --- | --- | --- |
| Piloto | Timón | Régimen, maniobra evasiva, descenso y despegue [F2] | Igual |
| Ingeniero | Toda la nave | Apagar fuegos, rearmar cortos, sellar fugas, reparar | Igual, a tiempo completo |
| Gestor de recursos | Panel de energía, mapa | Reparto de energía, ruta, combustible | Igual; decide qué se sacrifica |
| Explorador / científico | Superficie [F2] | Sale y recoge | Lidera las salidas |

En solitario una persona hace los cuatro papeles y no llega a todo: esa escasez es la que el cooperativo
resuelve repartiendo puestos. Con 2-3 jugadores los roles se agrupan.

## 9. Permadeath y puntuación [F1, F2]

Se pierde por casco a cero, oxígeno a cero, muerte de toda la tripulación en la superficie [F2] o nave varada (sin combustible para ningún salto, o sin
motores/reactor ni repuestos). La partida se reinicia entera; solo se guarda la mejor marca.

Puntuación: 1000 por sector + 50 por salto + 20 por avería resuelta + 30 por impacto esquivado + años luz + los puntos de los materiales guardados a bordo [F2].

Balance con tripulante simulado (`pnpm balance`, 200 partidas): atendiendo las averías se supera el
sector 1 casi siempre y el 4 entre el 35 % y el 75 % según lo rápido que se llegue a los puestos; sin
atender nada se supera el sector 1 un 6 % de las veces.

## 10. Controles e interfaz [F1, F2]

| Tecla | Acción |
| --- | --- |
| WASD / flechas, Mayús | Moverse, correr |
| Ratón | Mirar (clic para capturar el ratón) |
| E | Usar el puesto cercano (abrir mapa o panel, tomar el timón y arrancar la esquiva); en el timón, **mantener** para bajar a un mundo o despegar; en superficie, colocar una herramienta de minería o recoger lo extraído [F2] |
| Clic o Espacio | La habilidad de cada avería: apuntar el extintor, marcar el pulso, soltar la presión |
| R | Reparar un sistema con un repuesto (mantener y soltar en la marca, dos tramos) |
| WASD | En la esquiva: pilotar la nave entre las rocas |
| Q | Alternativa: cambiar el régimen (en el timón); en tierra, soltar la carga si pesa demasiado o retirar una herramienta [F2] |
| Espacio | En superficie: salto y jetpack (mantener en el aire); cayendo, frena la caída; en el descenso, frena [F2] |
| C | En superficie: bajar con el jetpack [F2] |
| 1-4 | Encender/apagar sistemas (con el panel de energía abierto) |
| V | 1ª / 3ª persona |
| H | Ayuda |
| Esc | Pausa |

Interfaz: cuatro barras (casco, oxígeno, combustible, energía) y repuestos; estado del viaje; cuenta
atrás del impacto; lista de averías abiertas; carteles en el mundo que se ven a través de los mamparos.
Luces de alarma por zona. Todo aviso sonoro tiene equivalente visual (destello y subtítulo opcional).

## 11. Superficie [F2] y fases siguientes

### Superficie [F2] (existe; cifras en `packages/shared/catalog/mundos.json`)

Desde un destino atracado que sea planeta, luna o campo de asteroides, el piloto baja **una vez por destino**.

- **Descenso.** Minijuego en el timón con vista exterior: la nave cae con la gravedad del mundo (siete mundos,
  de 0,4 a 13 m/s²) y hay que frenar a tiempo (Espacio o E). Cada mundo tiene su propio margen de frenado
  (`referenceMargin`). El freno gasta combustible y exige motores en línea. Tocar por encima de 5 m/s daña casco
  y sistemas y puede abrir una fuga o un corto. Bajar exige combustible para el descenso y el despegue en vacío.
- **Salir.** Cada salida cuesta O₂ **de la nave**: un ciclo de esclusa (3 %) y el relleno del traje (hasta 22 %
  por traje lleno), sin dejarla por debajo del 30 %. En tierra la nave casi no regenera O₂ (5 % del excedente): lo
  gastado en trajes no vuelve hasta despegar. Fuera, el O₂ del traje baja siempre y es el único recurso que no se
  recupera; a cero, muerte.
- **Jetpack.** Se gasta al usarlo y recarga despacio en el suelo. Tiene un techo de altura por mundo para que
  una caída desde lo más alto no mate; en el mundo pesado apenas sube. Las caídas duras cuestan O₂ y desde
  20 m/s matan.
- **Peligros.** Tormentas (avisan antes y drenan más oxígeno; no empiezan en los primeros segundos) y terreno
  inestable que cruje y cede si se pisa (saltar no lo evita: no se puede recoger en el aire). Las vetas de
  una zona inestable no se alcanzan desde suelo firme: hay que pisarla.
- **Materiales.** Hielo y mena son comunes y rinden combustible o repuestos al guardarlos (el hielo solo hay en
  asteroides; bajar a lunas y planetas cuesta combustible neto y es una apuesta de puntos). Cristales y muestras
  son raros: puntúan y quedan en la bodega para venderse en la fase 3. Valen más lejos de la nave y cerca del
  peligro, y **solo lo raro hace racha** (cada raro que llevas encima revaloriza el siguiente, con tope; se pierde
  si mueres). Se extraen con **herramientas desplegables** (ver abajo); la mochila tiene tope de masa (110 kg; lo raro pesa 8-10 kg).
- **Minería con herramientas.** Junto a una veta se coloca con una pulsación de E el **concentrador solar** (hielo:
  su calor lo sublima; se para con tormenta y sigue después) o el **taladro láser** (mena, cristales, muestras). Extraen
  solos mientras haces otra cosa; vuelves, pulsas E para recoger lo listo (Q retira la herramienta). Se tienen
  pocas y se reponen en cada aterrizaje; **lo que queda fuera al volver a la nave se pierde** (con lo extraído
  dentro). Lo raro se agrupa en **filones** de 2-3 vetas a 8-15 m, para que una herramienta y un paseo corto rindan; **completar un filón** en la misma salida da ×1,5 a su última veta (el HUD muestra «2/3»); extraen en 4-6 s por unidad. La brújula de oxígeno cuenta el rodeo por las herramientas colocadas («ve a por ellas» o «déjalas y vuelve»). El hielo también aparece, escaso y lejos, en la luna volcánica y el mundo de tormentas.
- **Volver y despegar.** Con todos a bordo; el combustible del despegue crece con la gravedad y la carga que
  se guardó en ese mundo. Si no hay para despegar ni vaciando la bodega, la nave queda varada.
- **La nave sigue viva** durante la salida (desgaste reducido por mundo): averías y oxígeno siguen.
- **Derrota.** Si muere toda la tripulación en la superficie, o la nave se pierde, se acaba la partida.
- **Mecha Aurora G9.** El diseño original lo preveía como vehículo; queda aplazado y no se usa en esta fase.

### Fases siguientes (diseño previsto)

- **[F3] Economía (existe; cifras en `packages/shared/catalog/economia.json` y `mejoras.json`, decisiones en ADR 0014).**
  Créditos iniciales y un contrato por sector superado. En una estación con terminal se vende la bodega a precio fijo
  (hielo y mena valen poco, cristales y muestras más; sube con el sector), se compran suministros (combustible, casco,
  repuestos) y se eligen mejoras de una oferta de 5 por estación, distinta según la semilla (depósito, escudos,
  reactor, motor de salto, casco, traje, jetpack, mochila, soporte vital, estabilizadores, tanque de O₂). Cada mejora
  tiene contrapartida (precio, masa, consumo eléctrico u O₂) y el terminal avisa si hará sobrecargar el reactor. La
  carga y las mejoras pesan: cada salto gasta más combustible. El servicio gratuito de la fase 1 se reduce a una ayuda
  de emergencia, una vez por estación. Los créditos no puntúan. Sin mercado dinámico, sin cambio visual de la nave y
  sin progreso entre partidas.
- **[F4] Cooperativo 1-4 (en curso; ADR 0015, `docs/MULTIPLAYER.md`).** Existe: sala privada con código, un tripulante por
  jugador, roles como ventajas pasivas (piloto, ingeniero, explorador; el gestor aún sin ventaja), avatares y ping. Sin voz
  integrada ni dificultad escalada (descartado en `docs/phases/fase-4.md`). Diseño original: servidor autoritativo que corre el mismo motor (ADR 0009), roles, voz o
  pings, y dificultad escalada con el número de jugadores.
- **[F5] Pulido.** Rankings, mando y táctil, despliegue, pruebas E2E.

## 12. Assets y licencias

Modelos en uso: astronauta (tripulante), consola (timón), galaxia (menú y holograma del mapa) y estación
ERIZON (se ve al atracar en una estación; CC-BY-NC-ND: sin uso comercial ni derivados). El mecha Aurora
G9 está en el repositorio pero sin uso (aplazado). El audio es procedural. Detalle en `assets/CREDITS.md`.

Mascota: el juego nuevo no tiene. Si se añade una, **Rise** (Artemis II) sigue necesitando autorización
escrita de NASA y el sistema debe permitir cambiarla por una propia.

## 13. Preguntas abiertas

1. ¿El portal de salto encaja con "regresar a estaciones seguras" del plan, o el sector debe ser de ida y
   vuelta a una base? (Hoy: de ida; cada sector empieza en una estación.)
2. ¿Cuánta ayuda en la primera partida? Hoy hay una pantalla de ayuda (H) y carteles; no hay tutorial.
3. ¿Dificultad en solitario frente a 4 jugadores? Pendiente de la fase 4.
4. ¿Se sustituye ERIZON antes de cualquier uso comercial?
