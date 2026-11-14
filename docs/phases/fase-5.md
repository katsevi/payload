# Fase 5 · Ciencia, datos y astronauta articulado

Decisión: `docs/adr/0015-reto-nasa-y-roadmap.md`. Cierra el ciclo que pide el reto: la misión **produce ciencia**, los
datos tienen que **llegar a la Tierra** y el jugador entiende **por qué** salió bien o mal.

No iniciada. Depende de la fase 4 (fusionada, PR #6): diseño con instrumentos, nave generada y sistema solar. Lo que la fase 4 dejó abierto está en `fase-4.md` § «Pendiente heredado».

**Hito:** una persona juega una misión completa (diseño, operación, entrega de datos) y, al terminar, el informe le
muestra la cadena de causas del resultado (p. ej. poca potencia, antena en reserva, datos sin bajar) que puede
verificar sobre lo que vivió.

## Punto de partida

- Fase 4 (ADR 0016 § 4): el diseño define instrumentos, antena y potencia; la distancia al Sol limita la energía. Ya existen, pero **solo cuentan para el Go/No-Go** (nada se genera ni se baja en la partida):
  - Instrumentos (`instrumentos.json`, 13): `scienceKind` (geología, hielo, atmósfera, campos, interior, vida), `scienceValue` y `dataRateMbps`, además de masa, potencia y coste.
  - Comunicaciones (`modulos.json`, `kind: comms`): `dataRateMbps` y `commsRangeAu` (omnidireccional 0,5 Mbps y 2 UA; alta ganancia 8 Mbps y 12 UA). El aviso `comms-range` bloquea el diseño si el peor punto de la ruta queda fuera de alcance, pero no hay efecto en vuelo.
  - Computadoras (`kind: computer`): `storageGb` (64 y 256) y `radiationHardened`; solo el aviso `radiation` lo usa.
  - Nodos: `missionTarget` marca el nodo del destino (`solar.ts`); hoy solo lo lee el bot de balance. Llegar no termina ni puntúa la misión y la ruta se repite.
  - `computeScore` sigue siendo el de las fases 1-3 (sectores superados, saltos, averías reparadas, impactos evitados, distancia y valor de materiales); no conoce el diseño.
  - Avisos sin efecto en la partida: `thermal`, `reliability`, `no-battery`; tampoco hay fallo de lanzamiento (`reliability` del lanzador).
- Fases 2 y 3: recolección, puntuación y economía. La ciencia se suma a la puntuación, no la sustituye por completo.
- Los segmentos de la misión del webinar NASA (lanzamiento, espacio, tierra, usuarios) guían qué se modela: aquí el segmento tierra es la ventana de contacto.

## Decisiones que debe tomar la fase 5

Resolverlas (ADR nuevo, 0017) antes de escribir código; cada una afecta al contrato de `types.ts` (solo aditivo).

1. **Condición de éxito de la misión** y qué pasa con la ruta: ¿atracar en `missionTarget`, aterrizar en el cuerpo, o además volver a la Tierra? ¿La partida termina al cumplirla (fase `won`/informe) o se puede seguir? Hoy la ruta se repite como un sector.
2. **Modelo de datos y almacenamiento:** unidades (Mbit o GB), qué genera cada instrumento (`dataRateMbps` × tiempo en qué fase: crucero, órbita, superficie), tope de `storageGb` y qué se pierde al llenarse.
3. **Ventanas de contacto deterministas:** cuándo hay línea con la Tierra (geometría simplificada con `bodyPositionAu`, sin azar nuevo), cuánto duran y cómo limita la tasa `commsRangeAu` según la distancia.
4. **Puntuación por ciencia entregada** frente a `computeScore`: sumar, sustituir o ponderar; solo puntúan los datos que llegan.
5. **Informe con cadena de causas:** qué eslabones existen (potencia, enlace, almacenamiento, fiabilidad, ruta), cómo se derivan del estado y de los eventos sin inventar causas, y su máximo (una línea por eslabón).
6. **Efecto de `thermal`, `reliability` y batería** en la partida (hoy solo avisan; `heatRejectKw` no se usa en `run.ts`) y del **fallo de lanzamiento**: qué los hace reales sin romper el balance clásico.
7. **Dificultad:** qué cifras entran en catálogo (presupuesto, plazos, reserva de combustible, frecuencia de averías) y cómo se elige.
8. **Escala de la misión guiada de CubeSat:** otra escala de módulos (hoy la estructura más ligera pesa 1 500 kg y el lanzador más pequeño lleva 15 t a la Luna): catálogo propio o módulos nuevos.
9. **Astronauta articulado:** licencia del modelo (el GLB actual y `assets/CREDITS.md`; ERIZON es CC-BY-NC-ND) y presupuesto de rendimiento (dos niveles de detalle, medir antes de añadir).
10. **Ajustes de balance heredados:** combustible de la vuelta en Europa y Titán (8 % y 1 % completan la ruta) y alcance a Bennu (`ligera-a-bennu` llega 8 %); `pnpm balance 100 3` es la línea base.

## Alcance previsto

### Motor (`packages/shared`)

- [ ] Instrumentos que generan datos (volumen según instrumento, objetivo y lugar) y almacenamiento de a bordo con límite.
- [ ] Bajada a la Tierra en ventanas de contacto; tasa según antena, potencia y distancia.
- [ ] Puntuación por ciencia entregada (los datos que no llegan no puntúan).
- [ ] Informe post-misión con cadena de causas, un `MessageRef` de una línea por eslabón.
- [ ] Niveles de dificultad (cifras en catálogo) y misión guiada de CubeSat (diseño fijo, objetivos pequeños).
- [ ] Tests: determinismo, datos conservados entre ventanas y cadena de causas coherente con el estado.

### Cliente (`apps/client`)

- [ ] Panel de datos y comunicaciones (almacenamiento, próxima ventana, tasa) legible de un vistazo.
- [ ] Informe final con la cadena de causas (explicación opcional, nunca bloquea el juego).
- [ ] Selector de dificultad y misión guiada de CubeSat.
- [ ] Astronauta articulado con animación procedural y dos niveles de detalle (alto para el jugador, bajo a distancia; base de los remotos de la fase 6).

### Contenido (`packages/shared/catalog`)

- [ ] Antenas, tasas, ventanas de contacto y volumen de datos por instrumento; reglas de dificultad.
- [ ] Modelo del astronauta: reutilizar el existente si la licencia lo permite; todo asset nuevo en `assets/CREDITS.md`.

## Fuera de alcance

- Cooperativo y astronautas remotos (fase 6); aquí solo se prepara el nivel de detalle bajo.
- Presupuestos de enlace reales (dB, modulación): modelo simplificado de tasa.
- Captura de movimiento: animación procedural.

## Riesgos

- Que datos y comunicaciones sean burocracia sin diversión: la espera de la ventana debe crear decisiones, no tiempo muerto.
- El informe como muro de texto: una línea por eslabón y un máximo de eslabones.
- Rendimiento del astronauta articulado: dos niveles de detalle y medir antes de añadir más.
