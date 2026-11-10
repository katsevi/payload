# Fase 2 · Exploración de superficie

Pilar del plan: *exploración de superficie (riesgo vs. recompensa)*. Diseño previsto: `docs/GDD.md` § 11.
No iniciada.

**Hito:** una salida a la superficie de 2-3 minutos en la que el jugador duda de verdad entre recoger un
mineral más o volver a la nave, y alguna vez no vuelve.

## Punto de partida (lo que deja la fase 1)

- `NodeKindDef.landable` ya marca qué destinos tienen superficie (planeta, luna, campo de asteroides).
- La partida tiene fases `docked | transit | won | lost`; falta `landing` y `surface` (cambio aditivo en `RunPhase`).
- `PlayerController` es un controlador cinemático con gravedad fija: hay que parametrizar gravedad y añadir el impulso del jetpack.
- El modelo Aurora G9 (`MODEL_URLS.walker`) está optimizado y sin usar.

## Alcance previsto

### Motor

- [ ] Descenso y aterrizaje: maniobra del piloto con velocidad de contacto; un aterrizaje brusco daña casco y sistemas y puede abrir fugas o cortos.
- [ ] Mundos por datos (`catalog/mundos.json`): gravedad, tormentas, terreno inestable, tabla de materiales.
- [ ] Tripulante: oxígeno personal, combustible de jetpack, capacidad de carga; muerte por asfixia o caída.
- [ ] Materiales: valor creciente con la distancia a la nave y con el peligro; muestras científicas.
- [ ] Despegue: consume combustible según gravedad y carga.
- [ ] Derrota si muere toda la tripulación en la superficie.

### Cliente

- [ ] Escena de superficie generada por semilla (terreno, abismos, vetas de mineral).
- [ ] Jetpack con inercia y gravedad baja; indicadores de oxígeno y combustible personales.
- [ ] Esclusa en la nave para salir y volver; carga visible a bordo.
- [ ] Minijuego de aterrizaje en el timón.

## Riesgos

- La superficie debe ser un sitio distinto, no «la nave con otro fondo»: el movimiento con jetpack es la clave.
- El oxígeno personal no debe convertirse en un cronómetro que se ignora: tiene que verse y oírse.
