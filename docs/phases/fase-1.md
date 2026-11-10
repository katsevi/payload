# Fase 1 · Viaje interplanetario y nave (en solitario)

Pilar del plan: *viaje interplanetario y gestión de ruta* + *mantenimiento de la nave*.
Diseño: `docs/GDD.md` § 3-10. Rama: `feat/f1-viaje-y-nave`.

**Hito:** una persona que no conoce el juego supera el primer sector en sus tres primeros intentos sin
que nadie le explique nada, y quiere jugar otra vez. (Prueba con >= 3 personas; pendiente.)

## Alcance

### Motor (`packages/shared`)

- [ ] Contrato nuevo `types.ts` (ADR 0011) y catálogo en JSON validado con zod: nave, averías, destinos, sector.
- [ ] `generateSector`: mapa determinista por semilla, enlaces coherentes, estación intermedia y ruta completable garantizada.
- [ ] `createRun`: tiempo real con paso fijo (0,1 s), determinista sin importar cómo se trocee `step()`.
- [ ] Viaje: combustible y tiempo por régimen (económico, crucero, máxima); motores dañados más lentos y caros.
- [ ] Energía: reactor, consumo por sistema, sobrecarga que daña el reactor, apagón.
- [ ] Averías: fuego (se propaga), cortocircuito (acaba en fuego), fuga de oxígeno; arreglo por tiempo de trabajo.
- [ ] Impactos: aviso por sensores, maniobra evasiva, escudos, daños internos y fugas sin escudos.
- [ ] Repuestos para reparar sistemas; servicio de estación y contenedores a la deriva.
- [ ] Permadeath: casco, oxígeno o nave varada. Portal de salto y sectores cada vez más difíciles.
- [ ] Mensajes como `MessageRef` en es/en, todos de una línea.
- [ ] Balance con tripulante simulado: se gana jugando bien, se pierde sin atender averías.

### Cliente (`apps/client`)

- [ ] Menú, ajustes, créditos y ayuda en una pantalla.
- [ ] Interior de la nave caminable en 1ª/3ª persona con tres zonas y ocho puestos.
- [ ] Interacción por proximidad: E (pulsar o mantener) y Q; avance visible.
- [ ] Mapa estelar: destinos, enlaces, riesgo, combustible y tiempo por régimen, servicio de estación.
- [ ] Panel de energía con interruptores (también teclas 1-4).
- [ ] HUD mínimo: cuatro barras, repuestos, viaje, cuenta atrás de impactos, averías abiertas, avisos.
- [ ] Efectos: fuego, chispas, gas, luces de alarma por zona, estelas del salto, sacudida en impactos.
- [ ] Carteles en el mundo visibles a través de los mamparos.
- [ ] Fin de partida y de sector con estadísticas; mejor marca guardada.
- [ ] Audio procedural adaptado (música por peligro, efectos por evento) con equivalentes visuales.
- [ ] Todo en es/en, sin texto en el código.

## Cómo se comprueba

```bash
pnpm validate                 # typecheck + tests + build
pnpm balance                  # informe de balance (200 partidas simuladas)
pnpm dev                      # http://localhost:5173  (?play=1&seed=7 entra directo a la partida)
```

- Tests del motor: `galaxy`, `run`, `locales`, `balance`, `purity`, `rng`.
- Tests del cliente: `game` (distribución, interacciones, almacén de la partida, panel de energía, audio) e `i18n`.
- Recorrido manual: saltar, esquivar un impacto, sellar una fuga, provocar una sobrecarga a máxima, perder.

## Fuera de alcance

Aterrizar y bajar a la superficie (fase 2), dinero y mejoras (fase 3), más de un jugador (fase 4).
Los destinos explorables ya se marcan en el mapa como «superficie explorable (fase 2)».
