# 0020 · Diseño compartido en sala y voto Go/No-Go (fase 6)

- Estado: propuesta
- Fecha: 2026-11-14
- Contexto previo: ADR 0017 (cooperativo: estado por mensajes y espejo), ADR 0016 (diseño de misión), ADR 0018 (ciencia)

## Contexto

La sala del cooperativo arrancaba siempre una partida libre: diseñar una misión (fase 4) y operarla con ciencia
(fase 5) solo existía en solitario. El hito de la fase 6 pide que la tripulación **diseñe una misión entre todas y
decida junta el Go/No-Go**. La ficha descarta la edición libre tipo documento: las ediciones son acciones discretas que
valida el motor.

## Decisiones

### 1. Quién elige y quién edita

- El **anfitrión** elige la misión en el lobby (`set-mission`; `null` = partida libre, como antes). Arranca con
  `missionStartDesign` (vacío con el destino si solo hay uno; la misión guiada, con su nave fija).
- **Cualquiera** edita el diseño (sin bloqueo por rol, como los puestos de la nave). Los roles por disciplina
  (dirección, ingeniería, ciencia, operaciones) quedan para después.

### 2. Ediciones discretas, no copias

`edit-design { edit }` con `DesignEdit`: añadir o quitar un módulo o instrumento, destino, lanzador, nivel o vaciar. El
motor (`applyDesignEdit`, puro) valida ids, destinos de la misión, la nave fija de la guiada, los instrumentos CubeSat y
un tope de 40 piezas, y nunca lanza. El cliente sigue usando el hangar de siempre: tras cada cambio calcula las
ediciones con `designEditsBetween(antes, después)` y las envía en orden. Así **dos personas que editan a la vez no se
pisan** (cada una manda su pieza, no el diseño entero). El servidor difunde el diseño en el `lobby` y el hangar pinta
siempre el del servidor.

### 3. Voto

- `vote { go: true | false | null }`. Cada cambio del diseño **borra los votos** (`designRev` sube): se vota lo que hay.
- Zarpa el anfitrión cuando (a) la revisión del motor da Go y (b) vota Go la **mayoría estricta** de los conectados
  (`voteTally`). **El empate es No-Go**; quien no ha votado cuenta como no Go. Una persona sola se vota a sí misma.
- El motivo cabe en una línea: «El diseño aún es No-Go», «hace falta mayoría de Go», «empate: no se zarpa».
- Sin diseño (partida libre) sigue la regla de antes: todos los demás, listos.

### 4. Partida y vuelta

La sala crea `createRun({ seed, crewSize, roles, design })`; los espejos ya admitían estados con diseño (ADR 0017). Al
perder **o al terminar la misión** (`science.over`) el anfitrión devuelve la sala al lobby, que conserva el diseño
(sin votos) para reintentar o retocarlo.

## Consecuencias

- `net.ts` (aditivo): `LobbyAction` `set-mission`, `edit-design`, `vote`; `LobbyView.design`/`designRev`;
  `CoopPlayer.vote`. Nuevo `sharedDesign.ts` (puro): `DesignEdit`, `applyDesignEdit`, `designEditsBetween`,
  `missionStartDesign`, `parseDesignEdit`, `voteTally`, `MAX_DESIGN_PARTS`.
- `RoomModel`: diseño, revisión, votos, `canStart()`. La paridad sala-motor se mantiene con diseño (test).
- Cliente: el hangar tiene un modo compartido (`runStore.sharedDesign`): no guarda en `localStorage`, envía ediciones y
  sustituye «Lanzar» por el voto (`SharedVote`, también en el lobby).
- El diseño viaja en cada `lobby` (≈ 1 kB): el lobby solo cambia cuando alguien edita o vota.

## Alternativas descartadas

- **Enviar el diseño entero en cada cambio:** con dos editores a la vez, el último borra lo del otro.
- **Unanimidad:** con cuatro personas, una sola bloquea la partida. **Mayoría simple con empate a favor:** dejaba zarpar
  con media tripulación en contra.
- **Bloquear partes del diseño por rol:** frustra si falta un rol o alguien se desconecta (como en los puestos).
