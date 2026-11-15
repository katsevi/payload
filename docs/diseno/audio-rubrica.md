# Audio de Payload: estudio de referencia y rúbrica de validación

Estado: propuesta v1 (2026-11-15). Alcance: sonido 100 % sintetizado con Web Audio API (osciladores, ruido filtrado, envolventes). Validación pensada para un render offline del motor de audio, sin archivos de audio.

## 1. Resumen del estudio

- La música adaptativa en capas verticales (stems que entran y salen sobre una línea temporal común) encaja mejor con un juego que cambia de estado en tiempo real que la reordenación horizontal de secciones, que obliga a cortes en límites de compás. Un híbrido es lo habitual en juegos de exploración.
- Referencias de estilo: Outer Wilds mezcla paisajes electrónicos con piezas acústicas pequeñas, y usa motivos de piano como señal funcional ("vas por buen camino"). Subnautica y el audio ambiental: el sonido de fondo es deliberadamente discreto y el aislamiento se transmite con vacío sonoro. Barotrauma usa el audio para anunciar el peligro antes que la imagen.
- Lethal Company muestra que el silencio seguido de una pista sonora reconocible crea tensión. Un tema de caja de música que se detiene es la señal de peligro (referencia de estilo, no de melodía).
- Recomendación de género: silencio o casi silencio como estado base, música solo como respuesta a eventos, y pulso (latido) reservado a la tensión.
- Evidencia sobre alarmas (Haas y Casali, 1993-1995): menor intervalo entre pulsos y mayor nivel aumentan la urgencia percibida y reducen el tiempo de detección. Los pulsos secuenciales son los menos urgentes. El modulado en frecuencia y los pulsos simultáneos rinden de forma parecida. Son estudios antiguos, con ruido de banda ancha y muestras pequeñas: usarlos como punto de partida, no como verdad absoluta.
- Advertencia cockpit (paper en Springer): tono fundamental de alarmas entre 700 y 1700 Hz como referencia. Un bloque de referencia cruzado con la evidencia anterior.
- Sonido de UI: duraciones de 5 a 180 ms según fuentes, con datos contradictorios entre sí. Se usan como rangos iniciales a validar por prueba, no como norma.
- Fatiga auditiva: el sonido continuo y denso cansa; los ticks de hover y de desplazamiento son la fuente más citada. Se recomienda cooldown por sonido y evitar el ruido de banda completa a nivel alto.
- Loudness: Meta Quest pide -16 LUFS (standalone) y -18 LUFS (Rift) según su documentación; PlayStation fija -24 LUFS para consola y -18 LUFS para portátil con pico -1 dBTP. Para navegador no hay norma oficial: se toma -16 LUFS integrado como objetivo y -1 dBTP como techo.
- Headroom: O'Reilly (Web Audio API) recomienda dejar margen en el mix final y bajar la ganancia maestra si hay clipping. El DynamicsCompressorNode no garantiza un limitador brickwall; se usa solo como red de seguridad cerca del destino.
- Psicoacústica: la distinguibilidad de un sonido depende más de la separación de bandas de frecuencia y de la modulación temporal que del volumen. Usar bandas distintas para UI, alarmas y música evita enmascaramiento.
- Evidencia débil y no citada: rangos de LUFS por categoría (diálogo -16 a -20, música -18 a -22, ambiente -22 a -28) procedentes de un sitio de referencia de baja calidad. Se usan solo como orientación.
- Recomendación de volumen relativo: música por debajo de los efectos de alarma y de UI, con alarmas al menos +6 dB sobre el lecho ambiental.
- Consistencia de paleta: pocas familias tímbricas por fase (3 a 4) y una raíz tonal común evitan la sensación de ruido aleatorio.
- Limitación del estudio: no hay un estudio empírico que compare música y silencio en juegos de supervivencia. Las conclusiones de estilo son inferencias de la práctica de la industria y de las fuentes citadas.

Fuentes:
- https://www.gamedeveloper.com/game-platforms/hybrid-horizontal-vertical-structure-for-game-music-composers-from-spyder-to-sackboy-gdc-2021-
- https://splice.com/blog/adaptive-music-video-games/
- https://primagames.com/feature/developing-music-outer-wilds-interview-composer-andrew-prahlow
- https://www.pressreader.com/usa/pc-gamer-us/20190129/281698320887380
- https://gamegeeker.com/games/barotrauma/review?market=US
- https://www.wayline.io/blog/sound-of-silence-video-game-immersion
- https://publications.scss.tcd.ie/theses/diss/2020/TCD-SCSS-DISSERTATION-2020-009.pdf
- https://link.springer.com/article/10.1007/s40869-018-0071-x
- https://vtechworks.lib.vt.edu/handle/10919/39522
- https://developers.meta.com/horizon/documentation/unreal/audio-loudness-meter-overview/
- https://audiokinetic.com/en/mastering-a-game-with-wwise-part1
- https://www.gamedeveloper.com/audio/standardizing-loudness-in-virtual-reality
- https://www.oreilly.com/library/view/web-audio-api/9781449332679/ch03.html
- https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode
- https://sfxengine.com/blog/best-practices-for-game-ui-sounds
- https://creatorsoundspro.com/the-role-of-psychoacoustics-in-game-ui-ux-sound-design
- https://mcvuk.com/development-news/audio-loudness-for-gaming-the-battle-against-ear-fatigue

Nota sobre fuentes: los datos de norma (LUFS) y de alarmas proceden de resúmenes de búsqueda; no se abrieron las páginas completas. Verificar antes de citarlas fuera del equipo.

## 2. Dirección de estilo por fase

Convención: tonalidad y modo comunes para todo el juego (p. ej. Re menor/dórico como raíz, con 1 nota de color por fase). Todo sintetizado: osciladores senoidales y triangulares para lecho, ruido filtrado (paso banda) para viento y respiración, envolventes ADSR lentas en pads, pulsos con filtro paso bajo para latidos.

| Fase | Tonalidad / modo | Pulso | Timbres (Web Audio) | Densidad | Tensión |
| --- | --- | --- | --- | --- | --- |
| Menú | Raíz + quinta, sin tercera | Ninguno | Pad senoidal, 2 osciladores desafinados ±5 cents | Muy baja | Nula |
| A bordo en calma | Dórico (Re), pedal en la tónica | Ninguno | Pad triangular filtrado, ruido de ventilación muy bajo | Baja: un evento cada 8-15 s | Nula |
| Tránsito (salto) | Pedal tónico, sin resolución | Ninguno | Barrido de ruido filtrado lento (LFO 0,05-0,1 Hz), drone | Media, sin eventos | Baja |
| Descenso / aterrizaje | Pedal que sube a segunda menor | Latido opcional 50-60 BPM | Filtro paso bajo que se abre, pulso de sine con envolvente corta | Media | Creciente |
| Superficie EVA | Sin melodía; intervalos de quinta | Respiración (ruido filtrado) a 12-16 respiraciones/min | Ruido paso banda 300-900 Hz, sin contenido < 30 Hz | Baja, con pausas largas | Moderada, constante |
| Peligro creciente | Añade una nota disonante (tritono) en capas | Latido 60 → 120 BPM | Capas verticales que entran por umbral de peligro | Alta en el último tramo | Escalonada |
| Alarma | No tonal, fundamental 800-1600 Hz | Pulsos 150-300 ms con separación 150-300 ms (crítica) | Onda cuadrada filtrada o seno con FM de 2-5 Hz | Discontinua | Máxima |
| Victoria | Resolución a la tónica mayor | Ninguno | Campanas (seno con envolvente larga), pad mayor | Media | Se libera |
| Derrota | Descenso sin resolver | Latido que se detiene | Drones que se apagan, sin tónica final | Decreciente | Se libera |

Reglas de crecimiento de la tensión: subir solo una variable por vez (pulso, o capa, o volumen de alarma). Nunca subir las tres a la vez; la fatiga llega antes de la tensión.

## 3. Rúbrica de validación

Cada sonido o bucle se renderiza offline (48 kHz, 24 bits) y se mide. Ver las fórmulas en la sección 3.4.

### 3.1 Criterios objetivos (fallo duro = puntuación 0 para ese sonido)

| Criterio | Umbral | Tipo |
| --- | --- | --- |
| Muestra con |x| ≥ 1,0 (clipping) | Ninguna | Fallo duro |
| Pico de muestra | ≤ -1 dBFS | Fallo duro si > -0,5 dBFS |
| Salto entre muestras consecutivas | max |x[n] − x[n−1]| ≤ 0,3 (normalizado) fuera de ataques percusivos | Fallo duro (clic) |
| Inicio y final | |x[0]| ≤ 0,01 y |x[N]| ≤ 0,01, o fundido ≥ 5 ms | Fallo duro (clic) |
| Costura de bucle | |x[última] − x[primera]| ≤ 0,01 | Fallo duro (clic en bucle) |
| Ataque (no percusivo) | ≥ 2 ms | Blando |
| Ataque (UI, alarma) | ≤ 5 ms | Blando |

### 3.2 Medidas objetivas por categoría

| Categoría | Duración | Nivel RMS (dBFS) | Centroide espectral | Otros |
| --- | --- | --- | --- | --- |
| UI clic / hover | 5-60 ms | -24 a -18 | < 4 kHz (mejor < 3 kHz) | Cooldown ≥ 150 ms por sonido |
| UI confirmación / error | 80-250 ms | -22 a -16 | < 4 kHz | Error no más agudo que confirmación + 1 octava |
| Efecto (impacto, aterrizaje) | 0,2-2 s | -20 a -12 | < 1,5 kHz | Energía < 30 Hz ≤ -20 dB relativo (excepción) |
| Alarma (crítica) | Pulso 150-300 ms | -16 a -10 | 800-1600 Hz | Separación de pulsos 150-300 ms; ≥ +6 dB sobre el lecho |
| Alarma (aviso) | Pulso 300-600 ms | -18 a -12 | 800-1600 Hz | Separación 400-800 ms |
| Música (lecho) | Bucle ≥ 16 compases | -30 a -22 | < 800 Hz de media | Crest factor ≥ 8 dB |
| Bucle ambiental | Bucle ≥ 20 s | -34 a -26 | < 600 Hz | Sin ruido de banda completa |

Loudness global: renderizar una sesión de 3 min con todas las fases y medir LUFS integrado (BS.1770, K-weighting, mismo método que `ffmpeg -af ebur128`). Objetivo -16 LUFS ± 2 y pico real ≤ -1 dBTP. La medida RMS de 3.2 es una aproximación por sonido; el LUFS de sesión manda.

### 3.3 Criterios de fatiga y ruido

- Energía por debajo de 30 Hz: ≤ -30 dB relativo a la energía total en música, ambiente y UI. Excepción: efectos de impacto (≤ -20 dB).
- Planitud espectral (media geométrica / media aritmética) del bucle entre 100 Hz y 16 kHz: ≤ 0,3 para lecho y ambiente. Por encima de 0,5 se considera ruido blanco y es fallo duro si el nivel supera -30 dBFS.
- Cooldown: el mismo sonido de UI no se repite a menos de 150 ms.
- Densidad de UI: máximo 4 sonidos de UI por segundo en ráfaga.

### 3.4 Fórmulas de medida (para el script de render)

- Centroide espectral: suma(f · |X(f)|) / suma(|X(f)|) sobre la FFT con ventana Hann.
- Energía sub-30 Hz (relativa): suma de |X(f)|² con f < 30 Hz / suma total.
- Planitud espectral: exp(media(ln |X(f)|)) / media(|X(f)|), en 100 Hz-16 kHz.
- Salto de muestra: max |x[n] − x[n−1]| en valores normalizados a [-1, 1].
- Solapamiento de alarma sobre lecho: energía de la alarma en 800-1600 Hz menos energía del lecho en la misma banda, en dB (≥ 6 dB).

### 3.5 Criterios subjetivos (puntuar leyendo los parámetros de síntesis)

Cada uno de 0 a 10. Se puntúa con la lista de parámetros del sonido, no con impresiones.

- Encaje con el género: 10 si el sonido usa silencio, drones y pulso solo en tensión; -2 por cada sonido de tipo "arcade" (arpegio rápido, timbre de 8 bits). Puntuación 7 si hay un solo elemento fuera de estilo.
- Distinguibilidad de alarmas: 10 si, a ciegas, un oyente identifica la fase de peligro en 5 de 5 cortes (prueba A/B de 5 personas o 3 con 5 cortes cada una). Sin prueba, 7 máximo si la separación de bandas y de pulsos cumple 3.2 y 3.4.
- Coherencia de paleta: 10 si la fase usa ≤ 3 familias tímbricas, una raíz común y el resto de sonidos comparte el mismo timbre base. -1 por familia extra.
- Carácter de UI: 10 si el clic dura ≤ 60 ms, tiene ataque ≤ 5 ms y no es agudo (centroide < 3 kHz). Puntuación baja si se repite con demasiada frecuencia.
- Tensión escalonada: 10 si cada salto de fase cambia una sola variable (regla de la sección 2).

Escala general (para cada sonido):
- 10: todos los criterios objetivos en rango con margen (≥ 1 dB o 10 % del rango); subjetivos ≥ 9.
- 7-9: todos los objetivos en rango; como máximo 1 subjetivo bajo 8.
- 4-6: 1 o 2 criterios blandos fuera de rango.
- 0-3: 3 o más criterios blandos fuera de rango, o cualquier fallo duro.

## 4. Umbral de aprobado

- Cada sonido y cada bucle debe puntuar ≥ 7/10.
- Ningún sonido con fallo duro (clipping, clic en inicio/final/costura, o ruido blanco de banda completa a nivel alto).
- La sesión de 3 min cumple -16 LUFS ± 2 y ≤ -1 dBTP.
- Si una alarma no supera la prueba de distinguibilidad con personas, la fase de peligro no se aprueba aunque los objetivos técnicos sí.

Protección en el grafo de Web Audio: ganancia maestra con headroom (-6 dB antes del destino) y, como red de seguridad, un DynamicsCompressorNode cerca del destino (valores de la comunidad, no oficiales: threshold -2 dB, ratio 12, knee 40). No sustituye a la validación de 3.1.
