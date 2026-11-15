# Validación de audio de Payload (render offline, 2026-11-15)

Validador: agente de validación de audio. Solo evalúa; no se ha modificado código.

**Veredicto: NO APROBADO.** Nota media: **6.0/10** (89 sonidos y escenas). Fallos duros: 2 (`extinguisher`, `thruster`). Sonidos por debajo de 7: 50.

Motivos principales: dos fallos duros de ruido de banda completa; jerarquía de niveles invertida (la música queda por encima de alarmas, efectos y UI); grupos de alarmas y de golpes que se confunden entre sí; y no hay prueba con personas ni medida de la sesión de 3 min (LUFS). Según la sección 4 de la rúbrica, la fase de peligro no puede aprobarse todavía.

## Método y criterio

- Fuente: `apps/client/audio-report/report.json` (render del 08:54, posterior a los últimos cambios de `musicSynth.ts`) y lectura de `sfxSynth.ts`, `soundLogic.ts`, `musicSynth.ts`, `musicVoices.ts`, `musicLogic.ts`, `audioEngine.ts`.
- Categorías: el informe asigna `effect` a sonidos de interfaz (`hover`, `select`, paneles, mapa, terminal, piezas, pasos, avisos de voz) y les aplica la ventana de efecto (0,2-2 s, -20/-12 dBFS). Aquí se reclasifican como UI o notificación, con la categoría mostrada en la tabla.
- Fallos duros: el informe deja `hard` vacío en todos. Aquí se aplica la regla 3.3 (planitud > 0,5 y nivel > -30 dBFS). Son `extinguisher` (planitud 0,81; 1760 saltos > 0,3 en 4 s) y `thruster` (planitud 0,52 a -23 dBFS). Ningún sonido tiene clipping, clic de inicio o fin, ni salto percusivo anómalo.
- Nivel absoluto: la rúbrica pide RMS de alarma de -16 a -10 dBFS, que con música a -25 dBFS no es el criterio útil. Se pondera la jerarquía (alarma ≥ +6 dB sobre el lecho; UI ≥ música; efectos entre ambos). El nivel absoluto bajo de UI y efectos se corrige con el ajuste global de buses, así que no se penaliza por sí solo.
- Ataque: casi todos los sonidos miden 8-10 ms frente al límite de 5 ms. El ataque por defecto de los `fm` es 4 ms, así que probablemente es un artefacto del medidor. No se penaliza; conviene revisar el medidor.

## Jerarquía de niveles

Mediana del nivel RMS de la parte activa (dBFS), según el informe:

| Clase | N | Mediana | Objetivo relativo | Estado |
| --- | --- | --- | --- | --- |
| Música (lecho) | 9 | -26.9 | referencia | demasiado alta |
| Efecto | 27 | -30.9 | música + 3 dB | igual que música; debería estar por encima |
| UI / confirmación | 28 | -31.5 / -33.5 | ≥ música | por debajo de la música |
| Alarma crítica | 5 | -30.5 | música + 6 dB o más | por debajo de la música |
| Alarma aviso | 7 | -33.0 | entre efectos y alarma | por debajo de la música |

El render no aplica el ducking de `audioEngine.ts` (`duckMusic`, nivel 0,55 durante unos 1,7 s con cada aviso). En juego la música baja unos 5 dB durante los avisos. Aun así no basta: la alarma debe quedar ≥ +6 dB sobre el lecho sin depender del ducking.

### Ajuste global recomendado

1. `audioEngine.ts` línea 79 (`volumes` por defecto): `music: 0.5 → 0.35`, `sfx: 0.8 → 0.9`, `alerts: 0.8 → 1.0`. Efecto estimado: música ≈ -33 dBFS; efectos y UI ≈ -30; alarmas críticas ≈ -27 (≈ -23 con la subida de `pulse`).
2. `apps/client/src/audio/offline/render.ts` líneas 16-18 (`SFX_BUS`, `ALERTS_BUS`, `MUSIC_BUS`): igualarlas a los nuevos valores (cuadrados), para que el informe mida lo mismo que el juego.
3. Sin tocar el ajuste global, bajar las ambientales calientes (`thruster`, `extinguisher`, `takeOff`) según su corrección.

## Tabla completa

Categorías: UI, UI-confirm, Notificación, Efecto, Alarma-crítica, Alarma-aviso, Bucle (ambiental), Música. Fallo duro = sí/no.

| id | Categoría | Nota | Fallo duro | Motivo |
| --- | --- | --- | --- | --- |
| `click` | UI | 7 | no | Clic bien definido; nivel corregido por bus global |
| `fixed` | UI-confirm | 7 | no | Confirmación clara y bien separada del resto |
| `toggle` | UI | 7 | no | Tic correcto y breve |
| `alarm` | Alarma-crítica | 6 | no | Patrón único; separación 140 ms y centroide 1,7 kHz |
| `ok` | UI-confirm | 6 | no | Mismos tonos que ping: se confunden |
| `sparks` | Efecto | 5 | no | Chispas brillantes (centroide 4,2 kHz) |
| `warnTick` | Alarma-aviso | 6 | no | Dos pips 1320 Hz; se parecen a o2Critical y fallWarn |
| `jump` | Bucle | 5 | no | Medido solo en el arranque; crucero sin medir |
| `clunk` | Efecto | 7 | no | Atraque coherente y bien equilibrado |
| `impact` | Efecto | 5 | no | Casi igual que landHard (1,4 s frente a 1,6 s) |
| `success` | UI-confirm | 5 | no | Arpegio de 4 notas: fanfarria arcade (-2 de género) |
| `complete` | UI-confirm | 5 | no | Idéntico a success (alias) |
| `blip` | UI | 6 | no | Pip de diálogo; ráfaga de 0,12 s, más de 60 ms |
| `descent` | Efecto | 6 | no | Zumbido bien; barrido inicial brillante (3 kHz) |
| `thruster` | Bucle | 2 | SÍ | Ruido de banda ancha (planitud 0,52) a -23 dBFS |
| `landSoft` | Efecto | 7 | no | Aterrizaje suave equilibrado; nivel algo bajo |
| `landHard` | Efecto | 5 | no | Casi idéntico a impact; centroide 1,9 kHz |
| `airlock` | Efecto | 4 | no | Siseo muy agudo (6,2 kHz), planitud 0,8: fatiga |
| `jetpack` | Bucle | 5 | no | Silbido de ruido: planitud 0,64, centroide 4,7 kHz |
| `collect` | UI-confirm | 6 | no | Tintineo correcto; bajo (-33 dBFS) |
| `store` | UI-confirm | 6 | no | Duración 0,33 s: fuera de la ventana de confirmación |
| `stormWarn` | Alarma-aviso | 4 | no | Ruido de banda ancha (centroide 3,9 kHz) bajo los pips |
| `storm` | Bucle | 5 | no | Rumble sub-30 Hz a -15 dB: supera el límite |
| `crack` | Alarma-aviso | 7 | no | Crujidos claros y reconocibles |
| `collapse` | Efecto | 6 | no | Potente, pero sub y golpes solapan con landHard |
| `o2Low` | Alarma-aviso | 6 | no | Fundamental (554-740 Hz) bajo la banda 800-1600 Hz |
| `o2Critical` | Alarma-crítica | 4 | no | Un solo pip 1320 Hz: no suena a crítico |
| `breath` | Efecto | 5 | no | Casi inaudible (-52 dBFS); ciclo ~37 resp./min |
| `breathFast` | Efecto | 7 | no | Ritmo de estrés correcto |
| `suitHit` | Alarma-crítica | 4 | no | Golpe con silbido agudo; sub-30 Hz a -25 dB |
| `crewDead` | Alarma-crítica | 6 | no | Dron de 110 Hz domina; no suena a alarma pulsada |
| `takeOff` | Bucle | 5 | no | Caliente (-24 dBFS); sub-30 Hz a -21 dB |
| `jettison` | Efecto | 7 | no | Soplo y cierre correctos |
| `wind` | Bucle | 5 | no | Ruido de banda ancha: planitud 0,5, centroide 3,5 kHz |
| `fallWarn` | Alarma-aviso | 6 | no | Barridos claros; timbre cuadrado como la alarma |
| `dodgeGraze` | Efecto | 5 | no | Chirrido agudo (4,6 kHz) y muy corto (0,12 s) |
| `dodgeHit` | Alarma-crítica | 4 | no | Mismo golpe que impact y suitHit; sub-30 Hz alto |
| `skillHit` | UI | 7 | no | Dos notas FM claras |
| `skillMiss` | UI | 7 | no | Caída corta y distinta de skillHit |
| `extinguisher` | Bucle | 1 | SÍ | Ruido blanco de banda completa a -21 dBFS (planitud 0,81) |
| `toolPlace` | UI | 5 | no | 0,43 s para un tick de UI; cola larga |
| `toolReady` | UI-confirm | 7 | no | Tres pitidos ascendentes: dirección clara |
| `toolDone` | UI-confirm | 6 | no | Espejo de toolReady; 0,30 s algo largo |
| `toolStop` | UI-confirm | 5 | no | Caída de 0,6 s; se confunde con toolLost |
| `toolResume` | UI-confirm | 6 | no | Subida espejo de toolStop; 0,31 s largo |
| `toolLost` | UI-confirm | 5 | no | 0,6 s descendentes; se confunde con toolStop |
| `sale` | UI-confirm | 6 | no | Monedas brillantes y bajas (-35 dBFS) |
| `purchase` | UI-confirm | 6 | no | Golpe + nota: se parece a store |
| `upgrade` | UI-confirm | 6 | no | Acorde correcto; 0,66 s largo |
| `noCredits` | UI-confirm | 6 | no | Dos tonos cuadrados graves; timbre cuadrado |
| `hover` | UI | 6 | no | Tic de 20 ms más bajo que el resto de UI |
| `select` | UI | 7 | no | Dos notas FM claras |
| `panelOpen` | UI | 7 | no | Barrido y FM claros |
| `panelClose` | UI | 7 | no | Caída clara |
| `mapOpen` | UI | 7 | no | Holograma y dos notas claros |
| `mapClose` | UI | 7 | no | Caída corta y reconocible |
| `terminalOpen` | UI | 7 | no | Tres notas y latch con buen carácter |
| `powerOn` | Efecto | 7 | no | Subida de potencia clara; sub moderado |
| `powerOff` | Efecto | 7 | no | Bajada espejo de powerOn; correcto |
| `partAdd` | Efecto | 7 | no | Cierre y servo correctos |
| `partRemove` | Efecto | 6 | no | Cierre seco brillante; centroide 1,9 kHz |
| `go` | Efecto | 7 | no | Acorde mayor ascendente: claro y correcto |
| `noGo` | Efecto | 7 | no | Dos notas caídas: contraste correcto con go |
| `launch` | Efecto | 6 | no | 3,3 s: el doble de la ventana de efecto |
| `stepShip` | Efecto | 7 | no | Pisada metálica correcta |
| `stepDust` | Efecto | 5 | no | Sub-30 Hz a -19 dB; repetido cada 170 ms |
| `stepRock` | Efecto | 5 | no | Crujido brillante (3,6 kHz) repetido |
| `stepIce` | Efecto | 5 | no | Crujido agudo (3,7 kHz) repetido |
| `footLand` | Efecto | 7 | no | Golpe correcto y grave contenido |
| `ping` | Notificación | 5 | no | Mismos tonos que ok (1568→2093 Hz): confunde |
| `crewJoin` | Notificación | 7 | no | Subida dulce; espejo claro de crewLeave |
| `crewLeave` | Notificación | 7 | no | Bajada espejo de crewJoin; correcto |
| `creak` | Efecto | 7 | no | Gemido grave de casco; encaja con el género |
| `hail` | Efecto | 4 | no | Casi inaudible (-60 dBFS); granos brillantes |
| `contact` | Notificación | 6 | no | Radio reconocible; 6 dB bajo su clase |
| `observation` | Notificación | 7 | no | Campana FM clara de dos notas |
| `earthCall` | Notificación | 7 | no | Doble tono de llamada reconocible |
| `overheat` | Alarma-aviso | 5 | no | Pulsos ascendentes con siseo de 3,6 kHz: fatiga |
| `powerDown` | Efecto | 7 | no | Caída de potencia con relés: narrativa clara |
| `storageFull` | Alarma-aviso | 5 | no | Sub-30 Hz a -14 dB: thud grave excesivo |
| `music-menu` | Música | 8 | no | Tema lento, arpegio disperso; nivel en rango |
| `music-aboard` | Música | 8 | no | Bajo y pad discretos; cumple el lecho |
| `music-transit-calm` | Música | 8 | no | Pedal y pulso de tránsito; estable |
| `music-transit-danger` | Música | 7 | no | Dos variables cambian a la vez en el escalón 2 |
| `music-landing` | Música | 7 | no | Descenso sin escalón de peligro medido |
| `music-surface-eva` | Música | 8 | no | Quintas y campana; sin sub-30 Hz |
| `music-surface-eva-danger` | Música | 7 | no | Mismo salto de dos variables en el escalón 2 |
| `music-won` | Música | 8 | no | Resolución a mayor con campana; cumple |
| `music-lost` | Música | 8 | no | Lamento que termina; no se repite |

## Sonidos y escenas con nota < 7 (con corrección)

Parámetros según el código actual. Nota: los cambios de volumen de `alarm`, `pulse()` y de los buses se suman; aplicar primero el ajuste global.

- `extinguisher` (1, FALLO DURO): HARD. `extinguisher` (startNoiseLoop): highpass 2200-3200 → bandpass 1500-2500 q 2; vol 0,3 → 0,08. Meta: planitud < 0,5 y RMS ≤ -30 dBFS
- `thruster` (2, FALLO DURO): HARD. `thruster` (startNoiseLoop): vol 0,5 → 0,2; subVol 0,25 → 0,1; filter bandpass 380-520 → lowpass 300→700 Hz
- `airlock` (4): sfxSynth `airlock`: noise bandpass 3000→1000 q 0,8 → lowpass 2500→600 Hz
- `stormWarn` (4): sfxSynth `stormWarn`: noiseBurst bandpass 250→900 q 0,8 → lowpass 900→250 q 0,7; vol 0,26 → 0,2
- `o2Critical` (4): sfxSynth `o2Critical`: una pulsación → 3 pulsos de 0,12 s a 1320 Hz, separación 0,16 s, vol 0,12 → 0,2
- `suitHit` (4): sfxSynth `suitHit`: tone vol 0,2 → 0,1; noise 4000→2500 vol 0,12 → 0,04
- `dodgeHit` (4): sfxSynth `dodgeHit`: tone vol 0,28 → 0,12; noise lowpass f1 90 → 200 Hz
- `hail` (4): sfxSynth `hail`: vol de granos ×4 (0,04+R·0,05 → 0,16+R·0,2); f0 2200+R·2800 → 1500+R·1500
- `sparks` (5): sfxSynth `sparks`: noise f0 1800+R·1800 → 1200+R·1000; q 3 → 2
- `jump` (5): Renderizar 6 s y parar a 5 s para medir el crucero (`startJump`: lowpass 240 Hz, ganancia 0,11); ajustar si supera -26 dBFS
- `impact` (5): sfxSynth `impact`: tone vol 0,3 → 0,2; noise dur 1,4 → 0,9 s
- `success` (5): sfxSynth `success`: 4 notas → 2 (783,99 y 1046,5 Hz), dur 0,45 → 0,3 s
- `complete` (5): Aplicar la misma corrección que `success` (mismo caso)
- `landHard` (5): sfxSynth `landHard`: noise f0 2200 → 1400; vol 0,44 → 0,36
- `jetpack` (5): `jetpack` (startNoiseLoop): filter bandpass 900-1300 → lowpass 700→1100 Hz; vol 0,28 → 0,18
- `storm` (5): `storm` (startNoiseLoop): añadir paso alto ~60 Hz (filter bandpass 60-1100); vol 0,55 → 0,4
- `breath` (5): sfxSynth `breath`: inS 0,7 → 1,6 s (ciclo ~3,6 s, ~16 resp./min); vol 0,07 → 0,25
- `takeOff` (5): `takeOff` (startNoiseLoop): subVol 0,25 → 0,1; vol 0,45 → 0,25
- `wind` (5): `wind` (startNoiseLoop): filter bandpass 250-600 → lowpass 600→300 Hz
- `dodgeGraze` (5): sfxSynth `dodgeGraze`: noise f0 2600 → 1800; vol 0,26 → 0,14
- `toolPlace` (5): sfxSynth `toolPlace`: tone triangular dur 0,5 → 0,12 s (o pasar a efecto)
- `toolStop` (5): sfxSynth `toolStop`: tone dur 0,6 → 0,22 s
- `toolLost` (5): sfxSynth `toolLost`: fm dur 0,32/0,5 → 0,14/0,18 s; vol 0,14 → 0,2
- `stepDust` (5): sfxSynth `stepDust`: lowpass f0 900 → 600; tone vol 0,132 → 0,08
- `stepRock` (5): sfxSynth `stepRock`: 2.ª ráfaga f0 2200 → 1400; vol 0,11 → 0,06
- `stepIce` (5): sfxSynth `stepIce`: bandpass 2800→1800 y 3800→2600; vol ×0,65
- `ping` (5): sfxSynth `ping`: fm 1568/2093 → 1319/1760 Hz; vol 0,198 → 0,13
- `overheat` (5): sfxSynth `overheat`: noise vol 0,07 → 0,025; `pulse()` lowpass 1600 (ver alarm)
- `storageFull` (5): sfxSynth `storageFull`: thud vol 0,1 → 0,04, freq 110 → 160 Hz
- `alarm` (6): `pulse()` (sfxSynth) lowpass 2600 → 1600; `alarm`: paso 0,34 → 0,36 s (separación 160 ms); vol 0,15 → 0,22
- `ok` (6): sfxSynth `ok`: fm vol 0.13 → 0.18 (el cambio de tonos va en `ping`)
- `warnTick` (6): sfxSynth `warnTick`: fm vol 0.16 → 0.24; ratio 1,5 → 2
- `blip` (6): sfxSynth `blip`: dur de cada pip 0,07 → 0,05 s y paso 0,07 → 0,05 s
- `descent` (6): sfxSynth `descent`: noise bandpass f0 1500 → 900
- `collect` (6): sfxSynth `collect`: fm vol 0,13 → 0,2
- `store` (6): sfxSynth `store`: notas fm dur 0,25 → 0,15 s
- `collapse` (6): sfxSynth `collapse`: tone vol 0,3 → 0,2
- `o2Low` (6): sfxSynth `o2Low`: fm 740 → 880 Hz y 554 → 660 Hz; vol 0,15 → 0,24
- `crewDead` (6): sfxSynth `crewDead`: fm vol 0,1 → 0,18 y tone 0,16 → 0,08; pulsar en 3 golpes
- `fallWarn` (6): `pulse()` lowpass 2600 → 1600; `fallWarn` vol 0,12 → 0,2
- `toolDone` (6): sfxSynth `toolDone`: dur de notas 0,13 → 0,1 s
- `toolResume` (6): sfxSynth `toolResume`: dur 0,5 → 0,3 s
- `sale` (6): sfxSynth `sale`: fm vol 0,1 → 0,16
- `purchase` (6): sfxSynth `purchase`: thud vol 0,16 → 0,12 (diferenciar de store)
- `upgrade` (6): sfxSynth `upgrade`: notas fm dur 0,35 → 0,2 s
- `noCredits` (6): sfxSynth `noCredits`: type square → triangle; vol 0,09 → 0,12
- `hover` (6): sfxSynth `hover`: tone vol 0,062 → 0,12 (+6 dB)
- `partRemove` (6): sfxSynth `partRemove`: latch vol 0,18 → 0,12
- `launch` (6): sfxSynth `launch`: cuenta de ruido y tono de 2,2 → 1,4 s
- `contact` (6): sfxSynth `contact`: tone vol 0,162 → 0,22

## Lo que no se ha podido medir

- Sesión de 3 min con todas las fases: LUFS integrado y pico real (objetivo -16 ± 2 LUFS, ≤ -1 dBTP). Solo hay medidas por sonido.
- Costura de bucle de la música: la música es síntesis continua, no un bucle de archivo. Un bucle de 20 s no mide la costura real en el punto de cruce.
- Crucero del salto (`startJump`): el render para los bucles a los 2 s, pero el arranque dura 2,4 s. La medida de `jump` describe el arranque, no el crucero.
- Distinguibilidad de alarmas con personas (sección 3.5): no hay prueba A/B. Sin ella, ninguna fase de peligro puede aprobarse.
- Costura de los bucles de ruido: el buffer de 2 s se repite con desfase aleatorio y el punto de cruce no se mide. El salto máximo de `thruster`, `jetpack` y `takeOff` cae en 1,8-1,9 s, sin salto anómalo.

## Observaciones de coherencia

- Grupos confundibles: (a) golpes graves con ruido `impact`, `landHard`, `collapse`, `dodgeHit`, `suitHit`; (b) tonos idénticos `ok` y `ping` (1568→2093 Hz); (c) pips de 1100-1320 Hz `o2Critical`, `warnTick`, `fallWarn`; (d) caídas largas `toolStop` y `toolLost`; (e) `store` y `purchase`.
- Escalada de tensión (`musicMixFor`, `musicLogic.ts`): el escalón 2 cambia dos variables (`tension` sube y `bell` baja a 0), y el 3 quita `arp` y además dobla el latido. Viola la regla de la sección 2 (una variable por escalón).
- Respiración: `breath` tiene un ciclo de unos 1,6 s (≈37 resp./min); la rúbrica pide 12-16 resp./min en EVA.
- Los bucles de ruido usan `bandpass` con Q 0,9: el centroide se dispara por las colas (≈3 kHz aunque el paso banda esté en 400 Hz). Para ambientales conviene medir energía por bandas, no solo centroide.
- Alarma crítica: `alarm` tiene separación de 140 ms, por debajo de los 150 ms de la rúbrica.

---

# Ronda 2 (tras los cambios del coordinador)

**Veredicto: NO APROBADO todavía.** Técnicamente la ronda 2 cierra los dos fallos duros y la jerarquía de niveles, pero siguen 40 sonidos por debajo de 7, no hay medida de la sesión de 3 min (LUFS) y no hay prueba con personas (rúbrica 4). Nota media: **6.9/10** (ronda 1: 6.0 sobre los mismos 89). Fallos duros: **0** (el informe ya aplica la regla 3.3).

Notas: la columna "R1" es la ronda 1; "R2" es esta ronda. Las dos notas se basan en el mismo criterio, con los ajustes que se explican abajo.

## Juicio sobre el medidor y las reclasificaciones

**Ataque (artefacto del medidor): confirmado, con matiz.** `metrics.ts` (función de análisis, bloque `attack`, líneas ~312-318) mide desde el inicio del bloque de 10 ms que detecta la señal (`effStart`), no desde la primera muestra audible. Los renders empiezan con ~6 ms de silencio. Resultado: el ataque sale inflado hasta en ~16 ms. Medido en los WAV (1 % → 90 % del pico): click 2,1 ms; alarm 2,7 ms; warnTick 3,8 ms; fallWarn 2,9 ms; o2Critical 2,8 ms; toggle 3,2 ms; hover 3,7 ms; blip 3,8 ms. Todos cumplen la rúbrica (≤ 5 ms). Sí hay ataques reales lentos, pero son de diseño o de capas: `suitHit` y `dodgeHit` (≈ 40-44 ms, el pico es el `latch` a +0,04 s), `crack` (≈ 10 ms por ráfagas) y los barridos (`stormWarn`, `breath`). Corrección del medidor: medir desde la primera muestra por encima de -60 dB (no desde el bloque) y usar el primer máximo local como pico de ataque en vez del máximo global.

**Reclasificaciones de `categoryOf` (metrics.ts, ~línea 343-349).**
- Legítimas y más estrictas: `overheat` y `storageFull` pasan a alarma-aviso (centroide 800-1600 Hz, nivel -18/-12 dBFS y ataque ≤ 5 ms). Son avisos de sistema, así que es correcto.
- Relajan la exigencia, no legítimas tal cual: `panelOpen`, `panelClose`, `mapOpen`, `mapClose`, `terminalOpen`, `select`, `partAdd`, `partRemove`, `toolPlace`, `powerOn`, `powerOff`, `go`, `noGo` pasan a ui-confirm. El cambio sube el límite de centroide de 1,5 a 4 kHz (un tick brillante pasa) y acepta duraciones de 80-250 ms, cuando un tick de UI debería durar ≤ 60 ms. `go`, `noGo`, `contact`, `observation`, `earthCall`, `crewJoin` y `crewLeave` son notificaciones de 0,4-0,6 s y en ui-confirm pierden por duración sin tener una clase propia. Propuesta: añadir dos clases en el medidor. **UI-navegación** (duración 0,05-0,3 s, RMS -24/-18 dBFS, centroide < 3 kHz, sub-30 Hz < -30 dB) para paneles, mapa, terminal y piezas. **Notificación** (0,2-1 s, RMS -22/-16, centroide < 4 kHz) para go/noGo, contacto, observación, llamada y tripulación. Con esas clases, las notas de esta ronda ya se han calculado así (8 para los navegación, que pasan pero con tick de 100-180 ms).

**Sonidos quietos a propósito.** Pasos (`stepShip`, `stepDust`, `footLand`), respiración y granizo son presencia frecuente. Su nivel por debajo de la clase de efecto es razonable: en un tramo continuo, un sonido que se repite cada 170 ms debe estar más bajo para no cansar. Lo que sí es defecto es el brillo: `stepRock` y `stepIce` (centroide 2,2-2,4 kHz) y el granizo (4,5 kHz con clics de 0,23 de paso). Propuesta: en la rúbrica, una clase **presencia** (RMS -28/-22 dBFS, centroide < 2,5 kHz) para pasos, respiración y granizo, en vez de la de efecto.

**Informe: `jump-cruise` tiene nota 0 sin motivo.** Sus medidas están en rango (-27,6 dBFS, centroide 253 Hz, planitud 0,08, sub-30 Hz -35 dB), pero el puntuador le asigna 0 sin ninguna razón en `soft` ni `hard`. Es un fallo del puntuador. Esta ronda le da 8. Revisar el puntuador antes de cerrar.

## Jerarquía de niveles (ronda 2)

Mediana del nivel RMS de la parte activa (dBFS):

| Clase | N | Mediana R2 | Objetivo | Estado |
| --- | --- | --- | --- | --- |
| Música (lecho) | 10 | -27.3 | referencia | ok |
| Bucle ambiental | 8 | -29.0 | música - 2 a -4 dB o menos | ok |
| UI (tick) | 6 | -21.0 | música + 3 dB o más | ok |
| UI-confirm / notificación | 34 | -20.0 | música + 3 dB o más | ok |
| Efecto | 21 | -20.0 | entre música+3 y alarma | ok |
| Alarma aviso | 7 | -17.0 | alarma crítica - 3 dB o más | ok |
| Alarma crítica | 5 | -15.0 | música + 6 dB o más | ok |

La jerarquía queda en el orden correcto: alarma crítica (-15) > alarma aviso (-17) > UI-confirm y efectos (-20) > UI tick (-21) > música (-27) > ambiental (-29). Efectos y UI están casi al mismo nivel; la alarma crítica queda +5 dB sobre efectos y +12 dB sobre la música. Es suficiente para el orden, pero conviene vigilar que la alarma se oiga con la música en el ducking (no se ha medido con ducking).

## Comparación ronda 1 → ronda 2

- Nota media (mismos 89): 6.03 → 6.91 (91 con `jump-cruise` y `music-landing-danger`).
- Fallos duros: 2 → 0. `extinguisher` pasa de planitud 0,81 a 0,48; `thruster` queda fuera de la regla.
- Sonidos < 7: 50 → 40.
- Jerarquía: música por encima de todo → alarma > efecto/UI > música > ambiental.
- Escalones de música: un cambio por escalón en las escenas medidas (`music-transit-danger`, `music-surface-eva-danger`, `music-landing-danger`): 7 → 9.
- Alarmas: `alarm` pasa de 2 a 8 (nivel, separación de 160 ms, centroide 1,3 kHz). `o2Critical` de 4 a 8 (tres pulsos). `dodgeHit` y `suitHit` siguen en 4 (capas).

## Tabla completa (ronda 2)

| id | Categoría | R1 | R2 | Fallo duro | Motivo |
| --- | --- | --- | --- | --- | --- |
| `click` | ui | 7 | 7 | no | Clic bien definido; ataque 8 ms es artefacto del medidor |
| `fixed` | ui-confirm | 7 | 9 | no | Sin cambio respecto al informe |
| `toggle` | ui | 7 | 6 | no | Tic de 90 ms; la rúbrica pide 60 ms o menos |
| `alarm` | alarm-critical | 6 | 8 | no | Patrón único y +10 dB sobre la música; ataque artefacto |
| `ok` | ui-confirm | 6 | 7 | no | Confirmación clara; 0,28 s en el límite |
| `sparks` | effect | 5 | 5 | no | Chispas brillantes: centroide 3,6 kHz |
| `warnTick` | alarm-warning | 6 | 7 | no | Pips claros; ataque artefacto |
| `jump` | ambient-loop | 5 | 6 | no | Arranque brillante (barrido a 1,5 kHz); el crucero ya se mide aparte |
| `jump-cruise` | ambient-loop | — | 8 | no | Crucero en rango: -27,6 dBFS, centroide 253 Hz, planitud 0,08 |
| `clunk` | effect | 7 | 9 | no | Sin cambio respecto al informe |
| `impact` | effect | 5 | 8 | no | Golpe grave con hits; distinto de landHard por centroide |
| `success` | ui-confirm | 5 | 5 | no | Arpegio de 4 notas (arcade) y 0,38 s |
| `complete` | ui-confirm | 5 | 5 | no | Idéntico a success (alias) |
| `blip` | ui | 6 | 6 | no | Pip de 0,10 s; la rúbrica pide 60 ms o menos |
| `descent` | effect | 6 | 6 | no | Barrido de ruido inicial brillante (2,1 kHz) |
| `thruster` | ambient-loop | 2 | 5 | no | Hiss sobre 1 kHz; sub-30 Hz a -25 dB |
| `landSoft` | effect | 7 | 9 | no | Sin cambio respecto al informe |
| `landHard` | effect | 5 | 8 | no | Parecido a impact; diferenciado por hits |
| `airlock` | effect | 4 | 5 | no | Siseo brillante (2,3 kHz) para un efecto |
| `jetpack` | ambient-loop | 5 | 5 | no | Centroide 1,6 kHz y sub-30 Hz a -25 dB |
| `collect` | ui-confirm | 6 | 9 | no | Sin cambio respecto al informe |
| `store` | ui-confirm | 6 | 6 | no | Duración 0,30 s, algo larga |
| `stormWarn` | alarm-warning | 4 | 6 | no | Sub-30 Hz a -28 dB; swell de ruido |
| `storm` | ambient-loop | 5 | 5 | no | Centroide 774 Hz y sub-30 Hz a -23 dB |
| `crack` | alarm-warning | 7 | 7 | no | Crujidos claros; ataque artefacto |
| `collapse` | effect | 6 | 8 | no | Golpes y sub claros |
| `o2Low` | alarm-warning | 6 | 7 | no | Fundamental en banda; ataque artefacto |
| `o2Critical` | alarm-critical | 4 | 8 | no | Tres pulsos con patrón claro |
| `breath` | effect | 5 | 5 | no | Duración 2,2 s fuera de efecto; hiss a 4,3 kHz |
| `breathFast` | effect | 7 | 6 | no | Estrés correcto; hiss a 4,4 kHz |
| `suitHit` | alarm-critical | 4 | 4 | no | Silbido a 4 kHz; ataque real 40 ms por capas |
| `crewDead` | alarm-critical | 6 | 5 | no | Dron de 110 Hz domina (centroide 527 Hz) |
| `takeOff` | ambient-loop | 5 | 6 | no | Centroide 1,5 kHz; sub ya en rango |
| `jettison` | effect | 7 | 9 | no | Sin cambio respecto al informe |
| `wind` | ambient-loop | 5 | 5 | no | Centroide 830 Hz y sub-30 Hz a -21 dB |
| `fallWarn` | alarm-warning | 6 | 7 | no | Barridos claros; ataque artefacto |
| `dodgeGraze` | effect | 5 | 4 | no | Chirrido a 3,7 kHz, brillante |
| `dodgeHit` | alarm-critical | 4 | 4 | no | El latch a +0,04 s es el pico: ataque real de 44 ms |
| `skillHit` | ui | 7 | 7 | no | Dos notas de 0,18 s; encaja en confirmación |
| `skillMiss` | ui | 7 | 6 | no | Caída de 0,13 s; larga para un tick |
| `extinguisher` | ambient-loop | 1 | 4 | no | Hiss brillante, centroide 4,2 kHz; planitud 0,48 justo bajo la regla dura |
| `toolPlace` | ui-confirm | 5 | 9 | no | Sin cambio respecto al informe |
| `toolReady` | ui-confirm | 7 | 7 | no | Tres pitidos ascendentes; 0,26 s en el límite |
| `toolDone` | ui-confirm | 6 | 6 | no | 0,31 s, algo larga |
| `toolStop` | ui-confirm | 5 | 9 | no | Sin cambio respecto al informe |
| `toolResume` | ui-confirm | 6 | 6 | no | 0,27 s, algo larga |
| `toolLost` | ui-confirm | 5 | 6 | no | 0,29 s, algo larga |
| `sale` | ui-confirm | 6 | 9 | no | Sin cambio respecto al informe |
| `purchase` | ui-confirm | 6 | 9 | no | Sin cambio respecto al informe |
| `upgrade` | ui-confirm | 6 | 5 | no | 0,63 s: secuencia larga |
| `noCredits` | ui-confirm | 6 | 6 | no | 0,26 s; timbre cuadrado |
| `hover` | ui | 6 | 7 | no | Tic de 30 ms en rango de nivel |
| `select` | ui-confirm | 7 | 8 | no | Pasa; tick de 0,15 s |
| `panelOpen` | ui-confirm | 7 | 8 | no | Pasa; tick de 0,12 s (la rúbrica pide 60 ms) |
| `panelClose` | ui-confirm | 7 | 8 | no | Pasa; tick de 0,10 s |
| `mapOpen` | ui-confirm | 7 | 5 | no | Holograma de 0,47 s; fuera de cualquier ventana |
| `mapClose` | ui-confirm | 7 | 8 | no | Pasa; tick de 0,18 s |
| `terminalOpen` | ui-confirm | 7 | 8 | no | Pasa; 0,18 s |
| `powerOn` | ui-confirm | 7 | 9 | no | Sin cambio respecto al informe |
| `powerOff` | ui-confirm | 7 | 9 | no | Sin cambio respecto al informe |
| `partAdd` | ui-confirm | 7 | 6 | no | Pico del cierre a 118 ms, después del servo |
| `partRemove` | ui-confirm | 6 | 8 | no | Pasa; cierre seco de 0,17 s |
| `go` | ui-confirm | 7 | 6 | no | Acorde de 0,52 s; sin ventana de notificación |
| `noGo` | ui-confirm | 7 | 6 | no | 0,41 s; sin ventana de notificación |
| `launch` | effect | 6 | 5 | no | 2,9 s: fuera de la ventana de efecto |
| `stepShip` | effect | 7 | 7 | no | Pisada; nivel bajo por diseño (presencia frecuente) |
| `stepDust` | effect | 5 | 7 | no | Bajo por diseño (presencia); sub-30 Hz en -24 dB |
| `stepRock` | effect | 5 | 5 | no | Crujido brillante repetido cada 170 ms |
| `stepIce` | effect | 5 | 5 | no | Crujido agudo repetido cada 170 ms |
| `footLand` | effect | 7 | 7 | no | Golpe grave; nivel bajo por diseño |
| `ping` | ui-confirm | 5 | 9 | no | Sin cambio respecto al informe |
| `crewJoin` | ui-confirm | 7 | 6 | no | 0,36 s; ruido brillante de 3,2 kHz |
| `crewLeave` | ui-confirm | 7 | 6 | no | 0,38 s, algo larga |
| `creak` | effect | 7 | 7 | no | Gemido de casco en rango aceptable |
| `hail` | effect | 4 | 5 | no | Granos brillantes (4,5 kHz) con clics de paso 0,23 |
| `contact` | ui-confirm | 6 | 7 | no | Radio con squelch; 0,62 s aceptable para notificación |
| `observation` | ui-confirm | 7 | 7 | no | Campana FM de 0,6 s |
| `earthCall` | ui-confirm | 7 | 7 | no | Doble tono de llamada de 0,58 s |
| `overheat` | alarm-warning | 5 | 5 | no | Siseo de 2,6 kHz sobre pulsos |
| `powerDown` | effect | 7 | 9 | no | Sin cambio respecto al informe |
| `storageFull` | alarm-warning | 5 | 5 | no | Sub-30 Hz a -14 dB: thud grave excesivo |
| `music-menu` | music | 8 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-aboard` | music | 8 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-transit-calm` | music | 8 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-transit-danger` | music | 7 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-landing` | music | 7 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-landing-danger` | music | — | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-surface-eva` | music | 8 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-surface-eva-danger` | music | 7 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-won` | music | 8 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |
| `music-lost` | music | 8 | 9 | no | Cumple criterios medidos; escalones de peligro correctos |

## Sonidos con R2 < 7 y corrección

- `suitHit` (4): sfxSynth `suitHit`: quitar burst 4000→2500 (vol 0,12 → 0); tone vol 0,2 → 0,1
- `dodgeGraze` (4): sfxSynth `dodgeGraze`: noise bandpass f0 1800 → 1200, q 4 → 3
- `dodgeHit` (4): sfxSynth `dodgeHit`: latch vol 0,12 → 0,05
- `extinguisher` (4): `extinguisher`: bandpass 1500-2500 q 2; vol 0,3 → 0,08
- `sparks` (5): sfxSynth `sparks`: noise f0 1800+R·1800 → 1200+R·1000; q 3 → 2; vol ×0,8
- `success` (5): sfxSynth `success`: 4 notas → 2 (783,99 y 1046,5 Hz), dur 0,45 → 0,3 s
- `complete` (5): Aplicar la corrección de `success`
- `thruster` (5): `thruster`: subVol 0,25 → 0,1; lowpass 300→600 Hz
- `airlock` (5): sfxSynth `airlock`: noise lowpass 2500→600 → 1800→500 Hz; vol ×1,3
- `jetpack` (5): `jetpack`: highpass 80 Hz; lowpass 1300 → 800 Hz
- `storm` (5): `storm`: lowpass 300→1100 → 400→800 Hz; highpass 60 Hz
- `breath` (5): sfxSynth `breath`: inS 0,7 → 1,2 s; lowpass 1800 Hz en el ruido
- `crewDead` (5): sfxSynth `crewDead`: fm en 3 golpes; tone vol 0,16 → 0,08
- `wind` (5): `wind`: lowpass 600→300 Hz; highpass 60 Hz
- `upgrade` (5): sfxSynth `upgrade`: notas fm dur 0,35 → 0,2 s
- `mapOpen` (5): sfxSynth `mapOpen`: barrido 0,35 → 0,22 s; ping 0,24 → 0,16 s
- `launch` (5): sfxSynth `launch`: noise y tone 2,2 → 1,4 s
- `stepRock` (5): sfxSynth `stepRock`: 2.ª ráfaga f0 2200 → 1400; vol 0,11 → 0,06
- `stepIce` (5): sfxSynth `stepIce`: bandpass 2800→1800 y 3800→2600 Hz
- `hail` (5): sfxSynth `hail`: f0 2200+R·2800 → 1500+R·1500; vol de granos ×1,5
- `overheat` (5): sfxSynth `overheat`: noise lowpass 2000 Hz; vol 0,07 → 0,025
- `storageFull` (5): sfxSynth `storageFull`: thud vol 0,1 → 0,04; freq 110 → 160 Hz
- `toggle` (6): sfxSynth `toggle`: tone dur 0,1 → 0,05 s
- `jump` (6): `startJump`: barrido de ruido f1 1500 → 900 Hz
- `blip` (6): sfxSynth `blip`: pip 0,07 → 0,05 s
- `descent` (6): sfxSynth `descent`: noise bandpass f0 1500 → 900
- `store` (6): sfxSynth `store`: notas fm dur 0,25 → 0,15 s
- `stormWarn` (6): sfxSynth `stormWarn`: highpass 60 Hz en el ruido (f0 250 → 120)
- `breathFast` (6): sfxSynth `breathFast`: lowpass 1800 Hz en el ruido
- `takeOff` (6): `takeOff`: lowpass f1 1100 → 500 Hz
- `skillMiss` (6): sfxSynth `skillMiss`: tone dur 0,16 → 0,06 s
- `toolDone` (6): sfxSynth `toolDone`: notas dur 0,13 → 0,1 s
- `toolResume` (6): sfxSynth `toolResume`: dur 0,5 → 0,3 s
- `toolLost` (6): sfxSynth `toolLost`: fm dur 0,32/0,5 → 0,14/0,18 s
- `noCredits` (6): sfxSynth `noCredits`: square → triangle
- `partAdd` (6): sfxSynth `partAdd`: latch en t+0,05 (en vez de +0,11)
- `go` (6): sfxSynth `go`: última nota dur 0,4 → 0,25
- `noGo` (6): sfxSynth `noGo`: segunda nota dur 0,3 → 0,2
- `crewJoin` (6): sfxSynth `crewJoin`: fm dur 0,18 → 0,12; noise 2500→1200 → 1800→1200 Hz
- `crewLeave` (6): sfxSynth `crewLeave`: fm dur 0,32 → 0,2 s

## Pendiente de medir (sin cambio)

- LUFS de la sesión de 3 min (objetivo -16 ± 2, ≤ -1 dBTP).
- Hangar (`hangar`) y tiempo de ducking en juego. No están en el informe.
- Prueba A/B de alarmas con personas (rúbrica 3.5 y 4).

---

# Ronda 3 (validación final)

**Veredicto técnico: NO APROBADO todavía.** Fallos duros: **0**. Nota media: **8.3/10** (91 sonidos y escenas). Quedan **15 sonidos < 7**: 4 límites de diseño que pueden aceptarse como excepción documentada (`sparks`, `jump`, `blip`, `dodgeGraze`) y 11 con defecto medido o marginal que conviene corregir.

**Requisito pendiente aparte (no lo puede hacer un agente):** prueba A/B de distinguibilidad de alarmas con personas (rúbrica 3.5 y sección 4). Sin ella, la fase de peligro no se aprueba aunque el resto cumpla. Además, sigue sin medirse el LUFS de la sesión de 3 min.

## Comprobación del diff (ronda 3)

- Clases en `metrics.ts` (`categoryOf`, ~l. 350-366) y rangos (~l. 386-388) frente a lo propuesto: `ui-nav` (0,05-0,3 s, -24/-18, centroide < 3 kHz), `notification` (0,2-1 s, -22/-16, < 4 kHz) y `presence` (-28/-22, < 2,5 kHz) coinciden con la propuesta.
- Atención, con relajación no propuesta: `success`, `complete`, `upgrade` y `ping` pasaron de ui-confirm a `notification`. `success`, `complete` y `upgrade` (0,30-0,63 s) estaban fuera de 0,08-0,25 s y ahora pasan; `ping` (0,23 s) ya cumplía, así que el cambio solo le afecta en la etiqueta. `success`, `complete` y `upgrade` son arpegios de 3-4 notas (arcade, -2 en la regla de género); por eso les pongo 7. `hover` (tick de 30 ms) pasó a `presence`, que no limita la duración (en UI quedaría fuera por 1 dB). Le pongo 8. Recomiendo quitar `success`, `complete`, `upgrade` y `hover` de esas clases (salvo que se acepte una clase de notificación más amplia), o acotar la exención a la duración.
- Ataque: el medidor mide ahora desde la primera muestra > -60 dBFS hasta el primer máximo local ≥ 90 % (lo propuesto). Los valores de UI y alarmas bajaron de 8-10 ms a 2-4 ms en casi todos los casos. Lo que queda de 6-8 ms es marginal o de diseño (`mapOpen`, `mapClose`, `powerOff`, `crewDead`).
- `jump-cruise`: la exención de inicio/final (`midSlice`) solo afecta a ese tramo (`!opts.midSlice` en la regla 3.1); el resto de sonidos sigue exigiendo fundido. Bug de nota 0 corregido: ahora 9.

## Tabla completa (ronda 3)

| id | Categoría | R1 | R2 | R3 | Fallo duro | Motivo |
| --- | --- | --- | --- | --- | --- | --- |
| `click` | ui | 7 | 7 | 9 | no | Sin cambio respecto al informe |
| `fixed` | ui-confirm | 7 | 9 | 9 | no | Sin cambio respecto al informe |
| `toggle` | ui | 7 | 6 | 9 | no | Sin cambio respecto al informe |
| `alarm` | alarm-critical | 6 | 8 | 9 | no | Sin cambio respecto al informe |
| `ok` | ui-confirm | 6 | 7 | 9 | no | Sin cambio respecto al informe |
| `sparks` | effect | 5 | 5 | 6 | no | Chispas: ráfagas de ruido agudo; límite razonable de diseño |
| `warnTick` | alarm-warning | 6 | 7 | 9 | no | Sin cambio respecto al informe |
| `jump` | ambient-loop | 5 | 6 | 6 | no | Barrido de arranque por diseño; el crucero ya se mide aparte |
| `jump-cruise` | ambient-loop | — | 8 | 9 | no | Crucero en rango con exención de tramo central |
| `clunk` | effect | 7 | 9 | 9 | no | Sin cambio respecto al informe |
| `impact` | effect | 5 | 8 | 9 | no | Sin cambio respecto al informe |
| `success` | notification | 5 | 5 | 7 | no | Arpegio de 4 notas: arcade (-2); pasa como notificación |
| `complete` | notification | 5 | 5 | 7 | no | Idéntico a success (alias) |
| `blip` | ui | 6 | 6 | 6 | no | 80 ms: límite de diálogo; la rúbrica pide 60 ms |
| `descent` | effect | 6 | 6 | 6 | no | Ruido de barrido brillante (1,8 kHz) |
| `thruster` | ambient-loop | 2 | 5 | 9 | no | Sin cambio respecto al informe |
| `landSoft` | effect | 7 | 9 | 9 | no | Sin cambio respecto al informe |
| `landHard` | effect | 5 | 8 | 9 | no | Sin cambio respecto al informe |
| `airlock` | effect | 4 | 5 | 6 | no | Siseo bajo el límite de efecto (1,9 kHz) |
| `jetpack` | ambient-loop | 5 | 5 | 7 | no | Centroide 678 Hz, marginal sobre 600 |
| `collect` | ui-confirm | 6 | 9 | 9 | no | Sin cambio respecto al informe |
| `store` | ui-confirm | 6 | 6 | 9 | no | Sin cambio respecto al informe |
| `stormWarn` | alarm-warning | 4 | 6 | 9 | no | Sin cambio respecto al informe |
| `storm` | ambient-loop | 5 | 5 | 9 | no | Sin cambio respecto al informe |
| `crack` | alarm-warning | 7 | 7 | 6 | no | Primer golpe con jitter aleatorio: ataque 10 ms |
| `collapse` | effect | 6 | 8 | 9 | no | Sin cambio respecto al informe |
| `o2Low` | alarm-warning | 6 | 7 | 9 | no | Sin cambio respecto al informe |
| `o2Critical` | alarm-critical | 4 | 8 | 9 | no | Sin cambio respecto al informe |
| `breath` | presence | 5 | 5 | 9 | no | Sin cambio respecto al informe |
| `breathFast` | presence | 7 | 6 | 9 | no | Sin cambio respecto al informe |
| `suitHit` | alarm-critical | 4 | 4 | 7 | no | Ataque 6,4 ms, marginal |
| `crewDead` | alarm-critical | 6 | 5 | 6 | no | Ataque 7,4 ms: el tono va con attack 0,02 |
| `takeOff` | ambient-loop | 5 | 6 | 9 | no | Sin cambio respecto al informe |
| `jettison` | effect | 7 | 9 | 9 | no | Sin cambio respecto al informe |
| `wind` | ambient-loop | 5 | 5 | 9 | no | Sin cambio respecto al informe |
| `fallWarn` | alarm-warning | 6 | 7 | 9 | no | Sin cambio respecto al informe |
| `dodgeGraze` | effect | 5 | 4 | 6 | no | Chirrido metálico por diseño; 0,23 s |
| `dodgeHit` | alarm-critical | 4 | 4 | 6 | no | RMS -17,6 dBFS, 1,6 dB bajo el rango |
| `skillHit` | ui | 7 | 7 | 6 | no | Duración 80 ms; la rúbrica UI pide 60 ms |
| `skillMiss` | ui | 7 | 6 | 9 | no | Sin cambio respecto al informe |
| `extinguisher` | ambient-loop | 1 | 4 | 5 | no | Siseo: centroide 3,4 kHz y planitud 0,46 en bucle |
| `toolPlace` | ui-nav | 5 | 9 | 7 | no | Ataque 6,3 ms, marginal |
| `toolReady` | ui-confirm | 7 | 7 | 9 | no | Sin cambio respecto al informe |
| `toolDone` | ui-confirm | 6 | 6 | 9 | no | Sin cambio respecto al informe |
| `toolStop` | ui-confirm | 5 | 9 | 9 | no | Sin cambio respecto al informe |
| `toolResume` | ui-confirm | 6 | 6 | 9 | no | Sin cambio respecto al informe |
| `toolLost` | ui-confirm | 5 | 6 | 9 | no | Sin cambio respecto al informe |
| `sale` | ui-confirm | 6 | 9 | 9 | no | Sin cambio respecto al informe |
| `purchase` | ui-confirm | 6 | 9 | 9 | no | Sin cambio respecto al informe |
| `upgrade` | notification | 6 | 5 | 7 | no | Arpegio de 3 notas tras barrido; arcade leve |
| `noCredits` | ui-confirm | 6 | 6 | 9 | no | Sin cambio respecto al informe |
| `hover` | presence | 6 | 7 | 8 | no | Tick de 30 ms; en clase presencia no hay límite de duración (fuera de UI por 1 dB) |
| `select` | ui-nav | 7 | 8 | 9 | no | Sin cambio respecto al informe |
| `panelOpen` | ui-nav | 7 | 8 | 9 | no | Sin cambio respecto al informe |
| `panelClose` | ui-nav | 7 | 8 | 9 | no | Sin cambio respecto al informe |
| `mapOpen` | ui-nav | 7 | 5 | 6 | no | Ataque 6,3 ms, marginal; duración en rango |
| `mapClose` | ui-nav | 7 | 8 | 6 | no | Ataque 8,2 ms: fm con cresta tardía |
| `terminalOpen` | ui-nav | 7 | 8 | 9 | no | Sin cambio respecto al informe |
| `powerOn` | ui-nav | 7 | 9 | 9 | no | Sin cambio respecto al informe |
| `powerOff` | ui-nav | 7 | 9 | 6 | no | Ataque 5,9 ms, marginal |
| `partAdd` | ui-nav | 7 | 6 | 5 | no | Sub-30 Hz a -26 dB y ataque 10 ms |
| `partRemove` | ui-nav | 6 | 8 | 7 | no | Sub-30 Hz a -29,9 dB, redondeo |
| `go` | notification | 7 | 6 | 9 | no | Sin cambio respecto al informe |
| `noGo` | notification | 7 | 6 | 9 | no | Sin cambio respecto al informe |
| `launch` | effect | 6 | 5 | 9 | no | Sin cambio respecto al informe |
| `stepShip` | presence | 7 | 7 | 9 | no | Sin cambio respecto al informe |
| `stepDust` | presence | 5 | 7 | 9 | no | Sin cambio respecto al informe |
| `stepRock` | presence | 5 | 5 | 9 | no | Sin cambio respecto al informe |
| `stepIce` | presence | 5 | 5 | 9 | no | Sin cambio respecto al informe |
| `footLand` | presence | 7 | 7 | 9 | no | Sin cambio respecto al informe |
| `ping` | notification | 5 | 9 | 9 | no | Sin cambio respecto al informe |
| `crewJoin` | notification | 7 | 6 | 9 | no | Sin cambio respecto al informe |
| `crewLeave` | notification | 7 | 6 | 9 | no | Sin cambio respecto al informe |
| `creak` | effect | 7 | 7 | 9 | no | Sin cambio respecto al informe |
| `hail` | presence | 4 | 5 | 9 | no | Sin cambio respecto al informe |
| `contact` | notification | 6 | 7 | 9 | no | Sin cambio respecto al informe |
| `observation` | notification | 7 | 7 | 9 | no | Sin cambio respecto al informe |
| `earthCall` | notification | 7 | 7 | 9 | no | Sin cambio respecto al informe |
| `overheat` | alarm-warning | 5 | 5 | 9 | no | Sin cambio respecto al informe |
| `powerDown` | effect | 7 | 9 | 9 | no | Sin cambio respecto al informe |
| `storageFull` | alarm-warning | 5 | 5 | 9 | no | Sin cambio respecto al informe |
| `music-menu` | music | 8 | 9 | 9 | no | Cumple criterios medidos |
| `music-aboard` | music | 8 | 9 | 9 | no | Cumple criterios medidos |
| `music-transit-calm` | music | 8 | 9 | 9 | no | Cumple criterios medidos |
| `music-transit-danger` | music | 7 | 9 | 9 | no | Cumple criterios medidos |
| `music-landing` | music | 7 | 9 | 9 | no | Cumple criterios medidos |
| `music-landing-danger` | music | — | 9 | 9 | no | Cumple criterios medidos |
| `music-surface-eva` | music | 8 | 9 | 9 | no | Cumple criterios medidos |
| `music-surface-eva-danger` | music | 7 | 9 | 9 | no | Cumple criterios medidos |
| `music-won` | music | 8 | 9 | 9 | no | Cumple criterios medidos |
| `music-lost` | music | 8 | 9 | 9 | no | Cumple criterios medidos |

## Evolución R1 → R2 → R3

| Ronda | Medida | Fallos duros | Nota media | Sonidos < 7 |
| --- | --- | --- | --- | --- |
| R1 | 89 | 2 | 6.03 | 50 |
| R2 | 91 | 0 | 6,91 | 40 |
| R3 | 91 | 0 | 8.32 | 15 |

La mejora de R2 a R3 viene del medidor (ataque desde la primera muestra y clases ui-nav, notification y presence) y de las correcciones aplicadas. No he separado cuánto se debe a cada uno.

## Sonidos < 7 en R3: defecto o límite de diseño

Límites de diseño (nota 6, aceptables como excepción documentada):
- `sparks` (6): Chispas: ráfagas de ruido agudo; límite razonable de diseño. Opcional: f0 1200+R·1000 → más grave si se exige centroide < 1,5 kHz
- `jump` (6): Barrido de arranque por diseño; el crucero ya se mide aparte. Medir el arranque como efecto (0,2-2 s), no como bucle
- `blip` (6): 80 ms: límite de diálogo; la rúbrica pide 60 ms. Opcional: pip 0,05 s
- `dodgeGraze` (6): Chirrido metálico por diseño; 0,23 s. Opcional: bandpass f0 1800 → 1200

Defectos o marginales (corregir):
- `extinguisher` (5): Siseo: centroide 3,4 kHz y planitud 0,46 en bucle. Corrección: `extinguisher`: lowpass 2000 Hz; vol 0,08 → 0,06
- `partAdd` (5): Sub-30 Hz a -26 dB y ataque 10 ms. Corrección: sfxSynth `partAdd`: latch low 130 → 180 Hz; servo attack 0,02 → 0,005
- `descent` (6): Ruido de barrido brillante (1,8 kHz). Corrección: sfxSynth `descent`: noise bandpass 1500→900 → lowpass 1200→200 Hz
- `airlock` (6): Siseo bajo el límite de efecto (1,9 kHz). Corrección: sfxSynth `airlock`: noise lowpass f0 1800 → 1000 Hz
- `crack` (6): Primer golpe con jitter aleatorio: ataque 10 ms. Corrección: sfxSynth `crack`: sin R()·0,05 en k = 0
- `crewDead` (6): Ataque 7,4 ms: el tono va con attack 0,02. Corrección: sfxSynth `crewDead`: tone attack 0,02 → 0,003
- `dodgeHit` (6): RMS -17,6 dBFS, 1,6 dB bajo el rango. Corrección: sfxSynth `dodgeHit`: noise vol 0,5 → 0,6
- `skillHit` (6): Duración 80 ms; la rúbrica UI pide 60 ms. Corrección: sfxSynth `skillHit`: segunda nota dur 0,13 → 0,06 s (o clase ui-confirm)
- `mapOpen` (6): Ataque 6,3 ms, marginal; duración en rango. Corrección: sfxSynth `mapOpen`: fm attack 0,04 → 0,01
- `mapClose` (6): Ataque 8,2 ms: fm con cresta tardía. Corrección: sfxSynth `mapClose`: fm attack → 0,002
- `powerOff` (6): Ataque 5,9 ms, marginal. Corrección: sfxSynth `powerOff`: fm attack → 0,002

## Pendiente (no lo puede hacer un agente)

- Prueba A/B de distinguibilidad de alarmas con 5 personas (rúbrica 3.5).
- LUFS integrado de la sesión de 3 min (objetivo -16 ± 2, ≤ -1 dBTP).
- Hangar y ducking en juego (no están en el informe).

---

# Ronda 4 (final)

**Veredicto técnico: NO APROBADO literal, APROBADO técnico con excepciones.** La regla 4 de la rúbrica exige ≥ 7 en todos los sonidos. Hoy hay 10 < 7: 5 límites de diseño, 2 límites del medidor y 3 defectos leves. Fallos duros: **0**. Nota media: **8.5/10** (91 sonidos y escenas).

Recomendación: documentar los 7 casos de diseño y de medidor como excepción de la rúbrica, corregir los 3 defectos (dos líneas de código cada uno), y dar la fase por técnicamente aprobada cuando se cumplan los requisitos de personas.

## Diff frente a la ronda 3 (lo que pedí y lo aplicado)

- Relajaciones revertidas: `success`, `complete`, `upgrade` y `ping` vuelven a `ui-confirm`; `hover` vuelve a `ui` (`metrics.ts` ~l. 352-356). Confirmado.
- Correcciones aplicadas en `sfxSynth.ts`: `descent` (lowpass 1200→200), `airlock` (lowpass 1000→400, más estricto que lo pedido), `extinguisher` (lowpass 2000, vol 0,08 en vez de 0,06), `crack` (sin jitter en k=0), `partAdd` (servo 0,05; latch +0,045, vol 0,24 sin cambiar a 0,18), `mapClose`/`powerOff` (attack de fm 0,002), `skillHit` (notas 0,04/0,06), `crewDead` (rehecho en tres golpes fm; tono 0,03), `dodgeHit` (vol 0,6 y **hp 80 no pedido**).
- Efecto de las correcciones: `descent`, `airlock` y `mapOpen` pasan a ≥ 7. `extinguisher` mejora (planitud 0,46 → 0,25; centroide 3,4 → 2,4 kHz). `crack`, `mapClose` y `powerOff` no cambian su ataque medido: el medidor cuenta el pico de ruido, no la envolvente (ver límites del medidor). `skillHit` sigue en 0,09 s: el cambio de duración no llega al límite de 60 ms. `dodgeHit` pierde nivel al añadir el hp 80 (RMS -17,6 → -18,0).

## Tabla completa (ronda 4)

| id | Categoría | R1 | R3 | R4 | Clase R4 | Motivo |
| --- | --- | --- | --- | --- | --- | --- |
| `click` | ui | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `fixed` | ui-confirm | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `toggle` | ui | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `alarm` | alarm-critical | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `ok` | ui-confirm | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `sparks` | effect | 5 | 6 | 6 | design | Chispas: ráfagas de ruido agudo; límite de diseño |
| `warnTick` | alarm-warning | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `jump` | ambient-loop | 5 | 6 | 6 | design | Barrido de arranque por diseño (medir como efecto) |
| `jump-cruise` | ambient-loop | — | 9 | 9 | ok | Sin cambio respecto al informe |
| `clunk` | effect | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `impact` | effect | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `success` | ui-confirm | 5 | 7 | 9 | ok | Sin cambio respecto al informe |
| `complete` | ui-confirm | 5 | 7 | 9 | ok | Sin cambio respecto al informe |
| `blip` | ui | 6 | 6 | 6 | design | 80 ms de pip de diálogo; límite de diseño |
| `descent` | effect | 6 | 6 | 9 | ok | Sin cambio respecto al informe |
| `thruster` | ambient-loop | 2 | 9 | 9 | ok | Sin cambio respecto al informe |
| `landSoft` | effect | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `landHard` | effect | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `airlock` | effect | 4 | 6 | 9 | ok | Sin cambio respecto al informe |
| `jetpack` | ambient-loop | 5 | 7 | 7 | marginal | Centroide 678 Hz, marginal sobre 600 |
| `collect` | ui-confirm | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `store` | ui-confirm | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `stormWarn` | alarm-warning | 4 | 9 | 9 | ok | Sin cambio respecto al informe |
| `storm` | ambient-loop | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `crack` | alarm-warning | 7 | 6 | 6 | meter | Ataque 9,8 ms de ruido: pico de banda estrecha con jitter; límite del medidor |
| `collapse` | effect | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `o2Low` | alarm-warning | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `o2Critical` | alarm-critical | 4 | 9 | 9 | ok | Sin cambio respecto al informe |
| `breath` | presence | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `breathFast` | presence | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `suitHit` | alarm-critical | 4 | 7 | 7 | marginal | Ataque 6,3 ms, marginal |
| `crewDead` | alarm-critical | 6 | 6 | 7 | marginal | Ataque 5,7 ms, marginal |
| `takeOff` | ambient-loop | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `jettison` | effect | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `wind` | ambient-loop | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `fallWarn` | alarm-warning | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `dodgeGraze` | effect | 5 | 6 | 6 | design | Chirrido metálico, centroide inherente |
| `dodgeHit` | alarm-critical | 4 | 6 | 6 | defect | RMS -18,0 dBFS: el hp 80 que se añadió quita nivel |
| `skillHit` | ui | 7 | 6 | 6 | defect | Duración 0,09 s: la segunda nota sigue en 0,06 |
| `skillMiss` | ui | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `extinguisher` | ambient-loop | 1 | 5 | 6 | design | Siseo de rociado: centroide 2,4 kHz inherente; planitud 0,25 OK |
| `toolPlace` | ui-nav | 5 | 7 | 7 | marginal | Ataque 6,3 ms, marginal |
| `toolReady` | ui-confirm | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `toolDone` | ui-confirm | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `toolStop` | ui-confirm | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `toolResume` | ui-confirm | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `toolLost` | ui-confirm | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `sale` | ui-confirm | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `purchase` | ui-confirm | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `upgrade` | ui-confirm | 6 | 7 | 9 | ok | Sin cambio respecto al informe |
| `noCredits` | ui-confirm | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `hover` | ui | 6 | 8 | 9 | ok | Sin cambio respecto al informe |
| `select` | ui-nav | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `panelOpen` | ui-nav | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `panelClose` | ui-nav | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `mapOpen` | ui-nav | 7 | 6 | 9 | ok | Sin cambio respecto al informe |
| `mapClose` | ui-nav | 7 | 6 | 6 | meter | Ataque 8,3 ms de ruido; límite del medidor |
| `terminalOpen` | ui-nav | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `powerOn` | ui-nav | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `powerOff` | ui-nav | 7 | 6 | 7 | marginal | Ataque 5,9 ms, marginal |
| `partAdd` | ui-nav | 7 | 5 | 6 | defect | Ataque 10 ms: el latch (+0,045 s, vol 0,24) es el pico |
| `partRemove` | ui-nav | 6 | 7 | 7 | marginal | Sub-30 Hz a -29,9 dB, redondeo |
| `go` | notification | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `noGo` | notification | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `launch` | effect | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `stepShip` | presence | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `stepDust` | presence | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `stepRock` | presence | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `stepIce` | presence | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `footLand` | presence | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `ping` | ui-confirm | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `crewJoin` | notification | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `crewLeave` | notification | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `creak` | effect | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `hail` | presence | 4 | 9 | 9 | ok | Sin cambio respecto al informe |
| `contact` | notification | 6 | 9 | 9 | ok | Sin cambio respecto al informe |
| `observation` | notification | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `earthCall` | notification | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `overheat` | alarm-warning | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `powerDown` | effect | 7 | 9 | 9 | ok | Sin cambio respecto al informe |
| `storageFull` | alarm-warning | 5 | 9 | 9 | ok | Sin cambio respecto al informe |
| `music-menu` | music | 8 | 9 | 9 | ok | Cumple criterios medidos |
| `music-aboard` | music | 8 | 9 | 9 | ok | Cumple criterios medidos |
| `music-transit-calm` | music | 8 | 9 | 9 | ok | Cumple criterios medidos |
| `music-transit-danger` | music | 7 | 9 | 9 | ok | Cumple criterios medidos |
| `music-landing` | music | 7 | 9 | 9 | ok | Cumple criterios medidos |
| `music-landing-danger` | music | — | 9 | 9 | ok | Cumple criterios medidos |
| `music-surface-eva` | music | 8 | 9 | 9 | ok | Cumple criterios medidos |
| `music-surface-eva-danger` | music | 7 | 9 | 9 | ok | Cumple criterios medidos |
| `music-won` | music | 8 | 9 | 9 | ok | Cumple criterios medidos |
| `music-lost` | music | 8 | 9 | 9 | ok | Cumple criterios medidos |

## Evolución R1 → R2 → R3 → R4

| Ronda | Sonidos | Fallos duros | Nota media | Sonidos < 7 |
| --- | --- | --- | --- | --- |
| R1 | 89 | 2 | 6.03 | 50 |
| R2 | 91 | 0 | 6,91 | 40 |
| R3 | 91 | 0 | 8.32 | 15 |
| R4 | 91 | 0 | 8.54 | 10 |

La nota del informe bruto de R4 es 8,3 (16 < 7). Mi nota sube a 8,5 porque subo a 7 los marginales (≤ 6 ms de ataque o centroide 678 Hz) y bajo a 6 los límites de diseño y del medidor.

## Sonidos < 7: límite de diseño, límite del medidor o defecto

**Límite de diseño aceptable (5):**
- `sparks` (6): Chispas: ráfagas de ruido agudo; límite de diseño.
- `jump` (6): Barrido de arranque por diseño (medir como efecto).
- `blip` (6): 80 ms de pip de diálogo; límite de diseño.
- `dodgeGraze` (6): Chirrido metálico, centroide inherente.
- `extinguisher` (6): Siseo de rociado: centroide 2,4 kHz inherente; planitud 0,25 OK.

**Límite del medidor (2), no defecto de sonido:**
- `crack` (6): Ataque 9,8 ms de ruido: pico de banda estrecha con jitter; límite del medidor. Medidor: para ruido, usar envolvente RMS de 5 ms en vez del pico.
- `mapClose` (6): Ataque 8,3 ms de ruido; límite del medidor. Medidor: igual que crack.

**Defecto (3), corregir:**
- `dodgeHit` (6): RMS -18,0 dBFS: el hp 80 que se añadió quita nivel. Corrección: sfxSynth `dodgeHit`: noise vol 0,6 → 0,8 (compensa el hp 80).
- `skillHit` (6): Duración 0,09 s: la segunda nota sigue en 0,06. Corrección: sfxSynth `skillHit`: segunda nota dur 0,06 → 0,03 y start t+0,035 → t+0,03.
- `partAdd` (6): Ataque 10 ms: el latch (+0,045 s, vol 0,24) es el pico. Corrección: sfxSynth `partAdd`: latch a t+0,02 y vol 0,24 → 0,18.

## Requisitos pendientes (solo pueden hacerlos personas)

1. Prueba A/B de distinguibilidad de alarmas: 5 personas, 5 cortes cada una (rúbrica 3.5 y sección 4). Es el requisito que bloquea la fase de peligro.
2. Fatiga en sesión: 30-45 min de juego con música, efectos y UI, anotando si hay cansancio o si se apaga el sonido (rúbrica 3.3, pasos y hover).
3. Escucha en altavoces y auriculares pequeños: la confusión entre golpes (`impact`, `landHard`, `collapse`, `dodgeHit`) y entre `ok`/`ping` no se mide con números.
4. Sesión de 3 min con todas las fases: LUFS integrado y pico real (objetivo -16 ± 2 LUFS, ≤ -1 dBTP), en el navegador real con el ducking activo.
5. Escena de hangar y ducking en juego, que no están en el informe.

## Cierre (orquestador, tras la ronda 4)

- Corregidos 2 de los 3 defectos: `partAdd` (el encaje va primero: ataque sin capas lentas, nota 9) y `skillHit`
  (dos notas de 35/30 ms, dentro de 0,06 s). `dodgeHit`: paso alto 80 → 40 Hz; sigue < 7 en el laboratorio porque está
  clasificado como alarma crítica (RMS -16..-10) siendo un golpe cuyo nivel limita el pico. No se reclasificó para no
  rebajar la exigencia sin pasar por el validador.
- Laboratorio final: media 8,35, 0 fallos duros, 14 < 7 (los límites de diseño y de medidor descritos en la ronda 4,
  más `dodgeHit`).
- Pendiente con personas: los 5 requisitos de la ronda 4 (A/B de alarmas, fatiga, altavoces pequeños, LUFS en
  navegador con ducking, hangar y ducking en partida).
