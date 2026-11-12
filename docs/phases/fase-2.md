# Fase 2 · Exploración de superficie

Pilar del plan: *exploración de superficie (riesgo vs. recompensa)*. Diseño: `docs/GDD.md` § 11.
Rama: `feat/f2-superficie`. Decisiones: ADR 0012.
Estado: **implementada, pendiente de validación independiente final y de prueba con jugadores** (las casillas
las marca quien valida).

**Hito:** una salida a la superficie de 2-3 minutos en la que el jugador duda de verdad entre recoger un
mineral más o volver a la nave, y alguna vez no vuelve.

## Punto de partida (lo que dejó la fase 1)

- `NodeKindDef.landable` ya marca qué destinos tienen superficie (planeta, luna, campo de asteroides).
- La partida tiene fases `docked | transit | won | lost`; falta `landing` y `surface` (cambio aditivo en `RunPhase`).
- `PlayerController` es un controlador cinemático con gravedad fija: hay que parametrizar gravedad y añadir el impulso del jetpack.
- El modelo Aurora G9 (`MODEL_URLS.walker`) está optimizado y sin usar; **sigue sin usarse** (aplazado, ADR 0012).

## Alcance

### Motor

- [ ] Descenso y aterrizaje: maniobra del piloto con velocidad de contacto; un aterrizaje brusco daña casco y sistemas y puede abrir fugas o cortos.
- [ ] Mundos por datos (`catalog/mundos.json`, 7 mundos y 4 materiales): gravedad, tormentas, terreno inestable, tabla de materiales.
- [ ] Tripulante: oxígeno personal, combustible de jetpack, capacidad de carga; muerte por asfixia o caída.
- [ ] Materiales: valor creciente con la distancia a la nave y con el peligro; muestras científicas.
- [ ] Despegue: consume combustible según gravedad y carga. Un aterrizaje por nodo.
- [ ] Derrota si muere toda la tripulación en la superficie.

### Cliente

- [ ] Escena de superficie generada por semilla (terreno, abismos, vetas de mineral).
- [ ] Jetpack con inercia y gravedad baja; indicadores de oxígeno y combustible personales.
- [ ] Esclusa en la nave para salir y volver; carga visible a bordo.
- [ ] Minijuego de aterrizaje: descenso con vista exterior, freno con Espacio o E.

## Riesgos

- La superficie debe ser un sitio distinto, no «la nave con otro fondo»: el movimiento con jetpack es la clave.
- El oxígeno personal no debe convertirse en un cronómetro que se ignora: tiene que verse y oírse.

## Cómo se comprueba

```bash
pnpm validate                 # typecheck + tests + build
pnpm balance                  # incluye explorador prudente y codicioso, y la curva del margen de O₂
pnpm dev                      # http://localhost:5173  (?play=1&seed=7&surface=1 entra directo a la EVA)
```

- Tests (2026-11-12): motor 127 en 7 archivos, cliente 82 en 3; `pnpm validate` 11/11.
- Tests del motor: `surface` (aterrizaje, EVA, oxígeno, jetpack, tormentas, terreno, carga, despegue, determinismo), `balance` (umbrales de superficie) y `locales` (mensajes de superficie).
- Tests del cliente: `surface` (terreno, movimiento, reglas de superficie, escena según la fase).
- Atajos: `?surface=1|descent|landed` y `__payload.toSurface()` (`apps/client/CLAUDE.md`).
- Recorrido manual: aterrizar (bien y de golpe), salir, recoger hielo y un cristal, pisar terreno inestable, aguantar una tormenta, volver con poco oxígeno, despegar con mucha carga, morir en superficie.

## Fuera de alcance

Vender lo recogido y mejorar el traje, el jetpack o la nave (fase 3), más de un jugador en superficie (fase 4)
y el mecha Aurora G9 como vehículo (aplazado). Sin mando, táctil ni remapeo de teclas (fase 5). Los cristales y las muestras solo suman puntuación y ocupan bodega.

## Revisión de diseño

Crítico independiente en tres pasadas: 6/10 → 7/10 → 8/10; cumple el hito sobre el papel con la salida media en el borde
bajo de 2-3 min. La última corrección (ventanas de frenado, vetas de zona recogibles desde fuera y caída residual en el
mundo pesado) no se ha recalificado. Abiertos para la prueba con jugadores: ver `docs/STATUS.md` («Decisiones de diseño abiertas»).
