# Cordura de la tripulación · Diseño detallado (fase 8)

> **Documento de planeación.** Nada de esto está implementado. Es la especificación para una integración futura.
> Ficha: `docs/phases/fase-8.md`. Decisión: `docs/adr/0019-cordura-de-la-tripulacion.md` (propuesta).
> Base científica y límites: `docs/diseno/cordura-fuentes-nasa.md`.
> Todas las cifras son **ficción de juego a calibrar** con `pnpm balance`. Las rutas y líneas de código citadas
> son las del 2026-11-14 y hay que revisarlas al implementar.

## 0. Resumen en una frase

Cuanto más dura el viaje y más dura es la exploración, más se desgasta cada tripulante. Un tripulante
desgastado trabaja peor y comete pequeños errores. Para recuperarlo hay que **gastar lo mismo que ya escasea**
(créditos, masa, potencia, tiempo y manos), así que cuidar a la tripulación es otra decisión de ingeniería.

## 1. Objetivos y no objetivos

**Objetivos**
- El desgaste por tiempo se nota en el juego, no en un texto (regla 6). Se nota en el trabajo más lento, la esquiva peor, el O₂ que dura menos y los lapsus.
- Cada contramedida se ata a un sistema que ya existe: energía, economía, diseño de misión, roles, cooperativo y superficie.
- El modelo sigue los peligros RIDGE y los riesgos de la NASA (ver las fuentes).
- Motor puro y determinista. Con `enabled: false` el juego es idéntico al actual.

**No objetivos**
- La cordura **nunca mata ni hace perder la partida**: no hay `LossReason` nuevo ni llamadas a `killCrew` o `lose`.
- Sin diálogos, personajes con historia, «terapia» jugable ni diarios que leer.
- Sin una segunda barra de fatiga o estrés: el sueño es un contador interno.

## 2. Glosario

| Término | Significado |
| --- | --- |
| Cordura (`sanityPct`) | Salud psicológica de un tripulante, de 0 a 100. En la interfaz se llama «tensión» o «ánimo» (decisión abierta) |
| Banda | Tramo de cordura que fija los debuffs: estable, tensa, crítica o quiebre |
| Cohesión (`cohesionPct`) | Salud del equipo, de 0 a 100. Solo existe con 2 o más tripulantes vivos |
| Lapsus | Error pequeño y determinista de un tripulante en banda crítica o de quiebre |
| Novedad | Llegar a un nodo no visitado, aterrizar o cambiar de sector. Reinicia la monotonía |
| Contramedida | Acción, compra o diseño que frena el drenaje o recupera cordura |

## 3. Modelo de estado

El estado vive entero en `RunState`. Los campos son aditivos y opcionales (regla 2). Así viaja gratis por
`snapshot()`, `hydrate()` y `NET.state` del cooperativo, y no hay contadores escondidos en cierres.

### 3.1 Por tripulante (`CrewMember`, `packages/shared/src/types.ts:648`)

| Campo | Tipo | Inicial | Uso |
| --- | --- | --- | --- |
| `sanityPct?` | `number` | `startPct` (100) | Cordura |
| `sanityBand?` | `SanityBand` | `'stable'` | Banda actual. Va en el estado para que `hydrate` conserve la histéresis |
| `awakeS?` | `number` | 0 | Segundos sin descanso eficaz (sueño y ritmo circadiano) |
| `restUntilS?` | `number` | 0 | Hasta qué `stats.timeS` el tripulante sigue en la litera |
| `callProgressS?` | `number` | 0 | Progreso de la llamada en curso |
| `callCooldownUntilS?` | `number` | 0 | Fin del enfriamiento de la llamada |
| `lapseCooldownUntilS?` | `number` | 0 | Fin del enfriamiento entre lapsus |

`newCrewMember(id)` (`run.ts:99`) no cambia. `createRun` rellena estos campos solo si `cat.psych?.enabled`.

### 3.2 De la partida (`RunState.psych?: PsychState`)

```ts
type SanityBand = 'stable' | 'tense' | 'critical' | 'breakdown';

interface PsychState {
  steps: number;               // pasos fijos contados; semilla de los lapsus sin rng con estado
  sinceNoveltyS: number;       // monotonía
  cohesionPct?: number;        // solo con ≥2 vivos
  cohesionBand?: 'ok' | 'low';
  stationRecoveredPct: number; // recuperado en el atraque actual (tope)
  provisions: number;          // unidades de provisiones frescas a bordo
  provisionsS: number;         // segundos consumidos de la unidad en curso
  callUntilS: number;          // ventana en que la llamada suma demanda eléctrica
  saleBonusUsed: boolean;      // bonificación por venta: una por atraque
  missionDays: number;         // timeS × daysPerS; solo para mostrar
}
```

`missionDays` con `daysPerS: 0.5` hace que un sector de unos 4 minutos equivalga a unos 120 días de misión.
Es solo narrativo, para el HUD y el informe; ninguna regla depende de él.

## 4. Bandas

Solo hay una barra visible por tripulante. La histéresis es de 5 puntos: se baja de banda al cruzar el umbral y
se sube al superarlo en 5.

| Banda | Se entra al bajar de | Se sale al subir a | Tono del evento |
| --- | --- | --- | --- |
| Estable | — | — | — |
| Tensa | 65 | 70 | `warn` |
| Crítica | 35 | 40 | `bad` |
| Quiebre | 12 | 17 | `bad` |

La función pura `sanityBandFor(pct, prev, rules)` decide la banda. Al cambiar, emite `crew-sanity` con el subtipo
`tense`, `critical`, `breakdown` o `recovered`, y el `crewId`.

## 5. Drenaje (cuánto se pierde por paso)

Se calcula en cada `fixedStep` (0,1 s) para cada tripulante vivo:

```
drain %/s = base[contexto] × D × (1 + I) × S × R × C × M  +  H
```

### 5.1 Base por contexto (aislamiento y confinamiento)

| Contexto | Cómo se detecta | `base` %/s |
| --- | --- | --- |
| `transit` | `phase === 'transit'` | 0.035 |
| `docked` (nodo sin estación) | `phase === 'docked'` y sin tienda | 0.02 |
| `surfaceAboard` | `phase === 'surface'` y `location === 'ship'` | 0.015 |
| `eva` | `location === 'eva'` | 0.025 |
| `stationDocked` | `docked` en estación (`atShop()`) | **recupera**, ver § 7.3 |

En `landing` se aplica la base de `transit`. En `won` y `lost` el tiempo no corre.

### 5.2 Factores multiplicativos

| Factor | Peligro RIDGE | Fórmula | Parámetros |
| --- | --- | --- | --- |
| `D` | Distancia a la Tierra | Clásica: `1 + distPerSector × (sector.index − 1)`. Con diseño: `1 + distPerAu × max(0, sunDistanceAu − 1)` | `distPerSector 0.35`, `distPerAu 0.25` |
| `I` | Aislamiento y monotonía | `monotonyMax × min(1, sinceNoveltyS / monotonyRampS)` | `monotonyMax 0.6`, `monotonyRampS 180` |
| `S` | Sueño y ritmo circadiano | `1 + sleepPenalty × clamp((awakeS − awakeGraceS) / awakeRampS, 0, 1)` | `sleepPenalty 0.5`, `awakeGraceS 300`, `awakeRampS 300` |
| `R` | Radiación | `radiationMult` si la zona actual tiene `radiation`, si no 1 | `radiationMult 1.3` |
| `C` | Equipo (cohesión) | Con ≥2 vivos y cohesión < 50: `1 + cohesionDrainMax × (50 − c) / 50` | `cohesionDrainMax 0.5` |
| `M` | Mitigación | Producto de: provisiones activas ×0.7, `crew.sanityDrainMult` de mejoras y módulos, y aura del gestor ×0.85 (§ 7.8) | — |

`sinceNoveltyS` vuelve a 0 al llegar a un nodo no visitado, al aterrizar y al cambiar de sector.

### 5.3 Entorno hostil y cerrado (sumandos `H`)

| Situación | Suma %/s |
| --- | --- |
| Cada avería activa (máximo 3) | +0.02 |
| Alerta de O₂ bajo de la nave activa | +0.06 |
| En EVA con tormenta activa | +0.05 |
| O₂ del traje en nivel crítico | +0.08 |

### 5.4 Golpes instantáneos

| Suceso | Efecto |
| --- | --- |
| Impacto recibido | −3 a todos los que van a bordo |
| Aterrizaje duro | −4 a todos los que van a bordo |
| Muerte de un compañero | −20 a cada superviviente y −15 de cohesión |

### 5.5 Calibración objetivo (sin contramedidas, sector de unos 4 min)

| Sector | Cordura al terminar | Banda | Sensación |
| --- | --- | --- | --- |
| 1 | ≈ 90 | Estable | Casi neutro: se aprende sin castigo |
| 2 | ≈ 80 | Estable | Aparece el medidor |
| 3 | ≈ 64 | Tensa | Primer debuff: hay que decidir si se cuida |
| 4 | ≈ 48 | Tensa | Hay que actuar |
| 5 | < 35 | Crítica | Lapsus y trabajo muy lento |

Un explorador codicioso en superficie (tormentas, traje crítico, caídas) va una o dos bandas por debajo.
Con todas las contramedidas, el sector 4 debería terminar en banda estable o en tensa alta. Estas cifras incluyen
la recompensa de +8 por superar el sector (§ 7.9). Son un **objetivo de diseño, no un resultado**: una estimación a
mano con los parámetros de § 8.3 da ≈97/86/66/40 en los sectores 1-4, del mismo orden. Las cifras definitivas se
ajustan con `pnpm balance`.

### 5.6 Misiones diseñadas

Solo en partidas con `design` (la clásica no cambia). Un único punto, `missionPsychMult(design, cat)` en `sanity.ts`, se multiplica en `drainMult` dentro de `effectivePsychRules`: `durMult × dificultad × misión`. `durMult = clamp(1 + durationK × (deadlineMonths − durationRefMonths) / durationSpanMonths, durationMin, durationMax)` con `psych.mission` en `cordura.json` (Luna y asteroide ×1, Marte ×1,1, cinturón ×1,2, Europa ×1,4, Titán ×1,5). `psychDrainMult` opcional por nivel de dificultad (0,7 / 1 / 1,3) y por misión en `misiones.json`; con 0 la cordura queda en pausa (ni drenaje, ni golpes, ni lapsus, medidor en 100). El CubeSat guiado usa 0,5: desgaste suave, para que se aprenda sin castigo pero se vea. El aviso Go/No-Go pasa a `design.review.crew-wellbeing-high` (param `severity: 'high'`) con plazo ≥ 84 meses sin hábitat ni huerto.

## 6. Debuffs (lo que se siente)

| Multiplicador | Estable | Tensa | Crítica | Quiebre | Dónde se aplica |
| --- | --- | --- | --- | --- | --- |
| Velocidad de trabajo | 1 | 0.9 | 0.75 | 0.6 | `workMult()` (`run.ts:977`), multiplicado por `repairSpeedMult` del rol |
| Daño al esquivar | 1 | 1.1 | 1.25 | 1.4 | Rama `evade` de `act()`, junto a `evadeDamageMult` |
| Gasto de O₂ del traje | 1 | 1.05 | 1.1 | 1.15 | `stepSurface` (`run.ts:845`), sobre `suit.o2DrainPctPerS` (la tormenta no se multiplica) |
| Gasto del jetpack | 1 | 1 | 1.15 | 1.25 | `crewJetpackDrainPctPerS` (`roles.ts`) |
| Capacidad de carga | 1 | 1 | 0.9 | 0.8 | `crewCarryCapacityKg` (`roles.ts`) |
| Probabilidad de lapsus (por s) | 0 | 0 | 1/150 | 1/60 | `psychRoll` (§ 6.2) |

### 6.1 Solitario

Hoy `workMult(undefined)` devuelve 1. Con la cordura activa y sin `crewId`, debe usar el **primer tripulante
vivo**, como hace `findMember`. Si no, el debuff de trabajo no existiría en solitario.

### 6.2 Lapsus deterministas

- La tirada no tiene estado:
  `createRng(deriveSeed(deriveSeed(deriveSeed(seed, PSYCH_SALT = 0x5a71), psych.steps), crew.id)).next()`.
  No toca `wearRng` (las partidas existentes no cambian). Tampoco depende de cómo se trocee `step()` ni de `hydrate`.
- Tras un lapsus hay un enfriamiento de 60 s por tripulante.
- **A bordo**, subtipo `switch`: apaga `shields` o `nav` si están encendidos. Se arregla con un clic en el panel de energía. **Nunca** toca `lifeSupport`, `engines` ni `reactor`, y nunca ocurre en `landing`.
- **En EVA**, subtipo `drop`: suelta la unidad de menos valor que lleva encima, que se pierde.
- Con eso un lapsus cuesta tiempo y atención, nunca una vida. Es la versión jugable de los errores de rendimiento que describe la NASA.

### 6.3 Alucinaciones (solo cliente)

- Son puramente cosméticas: parpadeo de `StatusLamp`, susurros lejanos, sombras periféricas y un crujido falso. Se siembran en el cliente con `crewId` y el tiempo.
- **Nunca** hay incidentes ni toasts falsos, y no cambian `RunState`. En cooperativo cada cliente ve las suyas, pero la verdad compartida (incidentes y paneles) no miente.
- Solo aparecen en la banda de quiebre y se apagan con el ajuste de reducir efectos.

## 7. Contramedidas y sinergias

Cada contramedida responde a un riesgo que la NASA documenta y **cuesta un recurso que ya existe**.

### 7.1 Tabla de sinergias

| Contramedida | Coste | Sistema con el que hace sinergia | Fuente NASA |
| --- | --- | --- | --- |
| Litera (`rest`) | Un tripulante fuera de servicio | Averías y reparación (menos manos) | Sueño y horarios |
| Llamada a la Tierra (`call-earth`) | 15 kW durante 6 s; enfriamiento | Energía (régimen, escudos) y distancia o ventanas de la fase 5 | Comunicación con la familia; retraso de 20 min |
| Atraque en estación | Tiempo de sector | Estaciones y economía | Contacto y fin del aislamiento |
| Provisiones frescas | Créditos | Economía (frente a casco, combustible y repuestos) | Alimentación y plantas frescas |
| Mejoras `crew` | Créditos, kg y kW | Masa → combustible; potencia → sobrecarga | RV, LED, privacidad, comunicación |
| Módulos `habitat`/`greenhouse` | M$, kg, meses, fiabilidad | Diseño de misión y Go/No-Go | Hábitat, privacidad, huerto |
| Rol gestor | Un tripulante en ese rol | Roles del cooperativo | Apoyo psicológico |
| Trabajo significativo | — (premia jugar bien) | Reparar, vender, explorar | Trabajo con sentido, aprender |
| Cohesión | Coordinarse | Cooperativo | Trabajo en equipo |

### 7.2 Litera y descanso: `rest`

- **Acción:** `{ type: 'rest'; seconds: number; crewId?: number }`. Es trabajo mantenido, recortado a `MAX_WORK_SECONDS` (0,5).
- **Efecto:**
  - recupera `seconds × restRecoverPctPerS (0.5) × crewMult`;
  - con fuego o fuga activos rinde ×0.4, porque las alarmas no dejan dormir;
  - `awakeS -= seconds × 4`, con suelo en 0;
  - `restUntilS = timeS + 0.6`.
- **Coste:**
  - mientras `restUntilS > timeS`, ese tripulante no puede trabajar ni esquivar (`reject.crewResting`);
  - la primera acción de trabajo lo despierta y borra `restUntilS`.
- **Rechazos:**

| Clave | Cuándo |
| --- | --- |
| `reject.restEva` | El tripulante está fuera de la nave |
| `reject.restDescent` | Durante `landing` |
| `reject.restNotNeeded` | `sanityPct ≥ 99` y `awakeS < awakeGraceS` |

- **Evento:** `crew-rest` (`event.rest.start`, `event.rest.done` cuando `awakeS` llega a 0).

### 7.3 Atraque en estación (pasivo)

- Mientras dure `docked && atShop()`, todos recuperan +0.3 %/s y la cohesión sube +0.2 %/s.
- Al llegar se ganan +5 al instante.
- El tope es `stationRecoverCapPct` (25) por atraque, y `stationRecoveredPct` vuelve a 0 en `arrive()`. El tope evita quedarse atracado para siempre, porque atracado no hay desgaste.

### 7.4 Llamada a la Tierra: `call-earth`

- **Acción:** `{ type: 'call-earth'; seconds: number; crewId?: number }`. Es trabajo mantenido; se completa a los `callS` (6) s acumulados.
- **Requisitos:**
  - fase `transit` o `docked`;
  - `nav` en línea;
  - fuera del enfriamiento;
  - margen eléctrico `powerSupplyKw − powerDemandKw ≥ callDrawKw (15)`.
- **Sinergia eléctrica:**
  - mientras dura, `psych.callUntilS = timeS + 0.6` y `refresh()` suma `callDrawKw` a la demanda;
  - a crucero sobran unos 10 kW (reactor de 110 frente a ~100 pedidos), así que **hay que bajar a régimen económico o apagar escudos para llamar**.
- **Recuperación al completar:**

  ```
  recover = callRecoverPct (12) × crewMult × soloMult × 1 / (1 + delayMin / delayHalfMin (20))
  delayMin = au × 8.32        // minutos-luz por UA
  au = sunDistanceAu (con diseño) | 1 + 0.75 × (sector.index − 1) (clásica)
  soloMult = 1.5 si solo queda 1 tripulante vivo (la llamada sustituye a la compañía)
  ```

- **Enfriamiento:** `callCooldownS` (90).
- **Gancho para la fase 5:** `contactWindowOpen(state): boolean`. Hoy siempre devuelve `true`. Cuando existan las ventanas de contacto, la llamada solo será posible dentro de una ventana y competirá con la bajada de datos.
- **Rechazos:**

| Clave | Cuándo |
| --- | --- |
| `reject.callPhase` | Fuera de `transit` y `docked` |
| `reject.callNoNav` | `nav` fuera de línea |
| `reject.callCooldown` | Durante el enfriamiento |
| `reject.callPower` | Margen eléctrico insuficiente |
| `reject.callNoWindow` | Fuera de ventana (reservado para la fase 5) |

- **Evento:** `earth-call` con `{ pct, delayMin }`. Si `delayMin > 20`, el mensaje dice que ayuda poco por el retraso.

### 7.5 Provisiones frescas: `buy-provisions`

- **Acción:** `{ type: 'buy-provisions'; amount?: number }`, sin tripulante, igual que `buy-supply`.
- **Precio:** `unitPrice (6)` × multiplicador de compra del sector. Máximo `maxUnits` (6) a bordo.
- **Efecto:**
  - con existencias, el drenaje es ×0.7;
  - cada unidad dura `secondsPerUnit` (60) de **tránsito**.
- **Por qué no es un `SUPPLY_ID`:** ampliar `SUPPLY_IDS` rompe el `strictObject` de `supplyPrices`, el tipo `StationQuote.supplies`, `supplyMissing`/`actShop`, `apps/client/src/game/shop.ts`, `i18n.test.ts` y la tienda del bot. En su lugar se añade el campo aditivo `StationQuote.provisions?: { unitPrice; missing; affordable }`.
- **Rechazos:** `reject.notAtStation`, `reject.provisionsFull`, `reject.notEnoughCredits` (los de la tienda).

### 7.6 Mejoras de estación (target nuevo `crew`)

Se crea el target `crew` en `UPGRADE_TARGETS`, con
`UPGRADE_FIELDS.crew = ['sanityDrainMult', 'restRecoverPctPerS', 'callRecoverPct', 'callCooldownS', 'sleepPenalty', 'monotonyMax', 'stationRecoverCapPct']`.
Así `ShipDef` queda intacto y se aplica con `effectivePsychRules(...)`, igual que `effectiveSurfaceRules`.

| id | Nombre es / en | Niveles (precio cr) | Masa | kW | Efecto |
| --- | --- | --- | --- | --- | --- |
| `crew-quarters` | Camarotes privados / Private quarters | 140 · 220 | 40 kg | 0 | Descanso ×1.3 / ×1.6 |
| `leisure-kit` | Kit de ocio y RV / Leisure & VR kit | 85 · 150 | 15 kg | 4 | `monotonyMax` ×0.5 / ×0.25 |
| `circadian-lighting` | Iluminación circadiana / Circadian lighting | 95 · 170 | 10 kg | 6 | `sleepPenalty` ×0.5 / ×0.2 |
| `comm-relay` | Enlace con casa / Home uplink | 70 | 5 kg | 3 | Llamada ×1.3; `callCooldownS` 60 |

Los kW se suman a `systemDrawKw.lifeSupport` (efecto `ship`): la mejora cuesta margen eléctrico de verdad. La
masa entra en `cargoFuelMult` y en el combustible. Hoy las mejoras cuestan de 80 a 230 cr, pesan de 0 a 45 kg y
gastan de 8 a 30 kW. `comm-relay` (70 cr, 3 kW) y `leisure-kit` (4 kW) quedan **por debajo a propósito**: son
contramedidas baratas para empezar. Los kW se **acumulan por nivel**, como en `life-support-boost`. Con todas compradas
(unos 13-17 kW), el margen de ~10 kW a crucero desaparece y llamar a casa obliga siempre a bajar de régimen o apagar
escudos. Ese compromiso es intencionado.

### 7.7 Módulos de diseño (fase 4)

Se añaden `'habitat'` y `'greenhouse'` a `MODULE_KINDS` (`types.ts:1080`) y `shipEffectSchema` pasa a aceptar
`ship | crew`.

| id | Nombre es | Masa | Coste | Desarrollo | Fiabilidad | Slots | Efectos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `habitat-cabin` | Hábitat con cabinas y ventanas | 900 kg | 30 M$ | 6 meses | 0.99 | 2 | `crew.sanityDrainMult` ×0.8; `crew.restRecoverPctPerS` ×1.2; +5 kW de soporte vital |
| `greenhouse-pod` | Huerto hidropónico | 1200 kg | 45 M$ | 10 meses | 0.97 | 2 | `crew.sanityDrainMult` ×0.9; `ship.o2RegenPctPerS` ×1.15; +12 kW de soporte vital |

**Aviso de Go/No-Go `crew-wellbeing`** (`reviewDesign`, `design.ts:422`). Es un `warning`, nunca un `blocker`.

| Condición | Severidad | Misiones afectadas hoy |
| --- | --- | --- |
| `deadlineMonths ≥ 48` sin `habitat` | Normal | Marte (48), cinturón (60), Europa (84), Titán (96) |
| `deadlineMonths ≥ 84` sin `habitat` ni `greenhouse` | `severity: high` | Europa, Titán |

- Parámetros: `{ months, hasHabitat }`.
- Hay que añadir un fixture de diseño que cubra `crew-wellbeing` (en `packages/shared/src/__tests__/fixtures/missions/`).
- `design.test.ts` exige una etiqueta `design.moduleKind.<kind>` para cada módulo del catálogo. Por eso hay que añadir
  `design.moduleKind.habitat` y `design.moduleKind.greenhouse` en `packages/shared/locales/{es,en}.json`. Los nombres
  de los módulos y las mejoras nuevas (`catalog.<id>`) salen del `LocalizedText` del catálogo y no van al locale.

### 7.8 Rol gestor

`manager` es hoy el único rol sin ventajas (`perks: {}`). Con esta fase pasa a ser el cuidador del equipo.

| Ventaja nueva (`RolePerks`) | Valor | Efecto |
| --- | --- | --- |
| `sanityAuraMult` | 0.85 | Drenaje ×0.85 para el resto de tripulantes mientras el gestor esté vivo y a bordo |
| `sanityRecoverMult` | 1.25 | Su propia recuperación por descanso y llamada ×1.25 |

### 7.9 Trabajo significativo

Las recompensas son instantáneas y van a quien actúa (por `crewId`, o al primer tripulante vivo).

| Suceso | Recompensa |
| --- | --- |
| Avería apagada (`incident-fixed`) | +2 |
| Sistema reparado con repuesto | +1.5 |
| Carga guardada en la bodega | +1 por cada 100 de valor (máximo +4) |
| Venta en estación | +3 (una vez por atraque, `saleBonusUsed`) |
| Sector superado | +8 a todos |

### 7.10 Cohesión de equipo (con 2 o más vivos)

- **Deriva:** `−0.01 × media((100 − sanity)/100) × 2` %/s, y −0.03 %/s por cada tripulante en banda crítica o de quiebre.
- **Reparar en grupo:**
  - un campo aditivo `Incident.workers?: number[]` registra los `crewId` que trabajan en la avería;
  - si al apagarla hay 2 o más, da +5 de cohesión y +1 de cordura a cada uno.
- **EVA en pareja:** dos tripulantes en EVA a menos de 15 m (con `x` y `z` de `CrewMember`) suman +0.05 %/s de cohesión.
- **Efecto positivo:** con cohesión ≥ 80, quienes trabajan juntos tienen `workMult ×1.1`.
- **Efecto negativo:** con cohesión < 50 se aplica el factor `C` (§ 5.2).
- **Solitario:** no hay cohesión. La compensan el `soloMult` de la llamada y el descanso.
- **Por qué en el motor y no con poses:** las `CrewPose` del cliente no entran en el motor (ADR 0017). Los `workers` y las posiciones de EVA ya son estado del motor, así que la cohesión no se puede falsificar y sigue siendo determinista.

### 7.11 Evento ficticio opcional: «tercer trimestre» (decisión abierta)

- Si se aprueba, en el 75 % del plazo de la misión con diseño (`missionDays` frente a `deadlineMonths`) se aplica una sola vez un golpe de −10.
- Se marca **en el catálogo** como `fictional: true` y no se presenta como dato de la NASA (ver fuentes).
- Por defecto está **desactivado**.

## 8. Contrato y catálogo

### 8.1 `packages/shared/src/types.ts` (solo aditivo)

- Tipos nuevos: `SanityBand`, `PsychState`, `PsychRules`.
- `CrewMember`: los campos de § 3.1.
- `RunState.psych?`.
- `RunAction`, tres variantes nuevas:
  - `{ type: 'rest'; seconds: number; crewId?: number }`;
  - `{ type: 'call-earth'; seconds: number; crewId?: number }`;
  - `{ type: 'buy-provisions'; amount?: number }`.
- `RunEventType`: `crew-sanity`, `crew-rest`, `earth-call`, `crew-lapse` y `cohesion`.
- `RunEventSubtype`: `tense`, `breakdown`, `recovered`, `switch` y `drop`. `critical` y `low` ya existen.
- `RolePerks`: `sanityAuraMult?` y `sanityRecoverMult?`.
- `UPGRADE_TARGETS` incorpora `'crew'`, y se añade `UPGRADE_FIELDS.crew`.
- `MODULE_KINDS` incorpora `'habitat'` y `'greenhouse'`.
- Otros campos aditivos: `Incident.workers?`, `StationQuote.provisions?` y `Catalog.psych?`.
- `RunStats`: `sanityCriticalS?`, `restS?`, `callsMade?`, `provisionsUsed?` y `lapses?`, para el informe y el `EndScreen`.

### 8.2 `packages/shared/src/catalog.ts`

- `psychSchema` (`strictObject`) con un `.refine` que exige `breakdown < critical < tense` y arreglos de debuffs de longitud 4.
- `psych: psychSchema.optional()` en `catalogSchema` y el import de `catalog/cordura.json`.
- `shipEffectSchema` acepta `target: 'ship' | 'crew'`.
- `roleSchema`: los perks nuevos, opcionales.
- Validación cruzada de ids: los nuevos (mejoras y módulos) entran en el conjunto de `superRefine`.

### 8.3 `packages/shared/catalog/cordura.json` (propuesta completa)

```json
{
  "psych": {
    "enabled": false,
    "startPct": 100,
    "daysPerS": 0.5,
    "bands": { "tense": 65, "critical": 35, "breakdown": 12, "hysteresisPct": 5 },
    "base": { "transit": 0.035, "docked": 0.02, "surfaceAboard": 0.015, "eva": 0.025 },
    "distPerSector": 0.35,
    "distPerAu": 0.25,
    "monotonyMax": 0.6,
    "monotonyRampS": 180,
    "awakeGraceS": 300,
    "awakeRampS": 300,
    "sleepPenalty": 0.5,
    "radiationMult": 1.3,
    "stressors": { "perIncident": 0.02, "maxIncidents": 3, "lowShipO2": 0.06, "stormEva": 0.05, "suitCritical": 0.08 },
    "shocks": { "impact": 3, "hardLanding": 4, "crewDeath": 20, "crewDeathCohesion": 15 },
    "rewards": { "incidentFixed": 2, "systemRepaired": 1.5, "storedPer100": 1, "storedMax": 4, "sale": 3, "sectorCleared": 8 },
    "debuffs": {
      "work":        [1, 0.9, 0.75, 0.6],
      "evadeDamage": [1, 1.1, 1.25, 1.4],
      "suitO2":      [1, 1.05, 1.1, 1.15],
      "jetpack":     [1, 1, 1.15, 1.25],
      "carry":       [1, 1, 0.9, 0.8],
      "lapsePerS":   [0, 0, 0.0067, 0.0167]
    },
    "lapse": { "cooldownS": 60, "systems": ["shields", "nav"] },
    "rest": { "recoverPctPerS": 0.5, "alarmMult": 0.4, "awakeRecoverMult": 4 },
    "call": { "seconds": 6, "drawKw": 15, "recoverPct": 12, "delayHalfMin": 20, "soloMult": 1.5, "cooldownS": 90 },
    "station": { "recoverPctPerS": 0.3, "arrivalPct": 5, "capPct": 25, "cohesionPctPerS": 0.2 },
    "provisions": { "unitPrice": 6, "maxUnits": 6, "secondsPerUnit": 60, "drainMult": 0.7 },
    "cohesion": { "start": 80, "lowPct": 50, "drainMax": 0.5, "groupRepairPct": 5, "groupRepairSanity": 1, "evaNearM": 15, "evaNearPctPerS": 0.05, "teamworkMult": 1.1, "teamworkMinPct": 80 },
    "thirdQuarter": { "enabled": false, "fictional": true, "atFrac": 0.75, "shockPct": 10 }
  }
}
```

Los textos visibles del contenido nuevo van como `LocalizedText` (`{ es, en }`) en `mejoras.json` y en
`modulos.json` (regla 5).

### 8.4 `packages/shared/src/sanity.ts` (nuevo, puro, exportado en `index.ts`)

```ts
export function getPsychRules(cat: Catalog): PsychRules | null;
export function effectivePsychRules(base: PsychRules, upgrades: Record<string, number>, cat: Catalog, design?: MissionDesign, roles?: RoleId[]): PsychRules;
export function sanityBandFor(pct: number, prev: SanityBand, r: PsychRules): SanityBand;
export function bandIndex(b: SanityBand): 0 | 1 | 2 | 3;
export function sanityDebuffs(m: CrewMember | null | undefined, r: PsychRules | null): {
  work: number; evadeDamage: number; suitO2: number; jetpack: number; carry: number; lapsePerS: number;
};
export interface DrainContext {
  context: 'transit' | 'docked' | 'surfaceAboard' | 'eva';
  sectorIndex: number; sunDistanceAu?: number; radiation: boolean;
  sinceNoveltyS: number; awakeS: number; cohesionPct?: number; mitigation: number;
  activeIncidents: number; lowShipO2: boolean; stormEva: boolean; suitCritical: boolean;
}
export function sanityDrainPctPerS(ctx: DrainContext, r: PsychRules): number;
export function commsDelayMin(au: number): number;           // au × 8.32
export function callRecoveryPct(r: PsychRules, au: number, solo: boolean, crewMult: number): number;
export function psychRoll(seed: number, step: number, crewId: number): number;
export function cohesionDeltaPctPerS(crew: CrewMember[], r: PsychRules): number;
export function contactWindowOpen(state: RunState): boolean; // true hasta la fase 5
```

### 8.5 Integración en `run.ts`

1. `stepPsych(dt)` corre dentro de `fixedStep`, **después de `refreshWarnings` y antes de la comprobación de permadeath**. Hace esto:
   - suma `psych.steps` y `missionDays`;
   - acumula `sinceNoveltyS` y `awakeS`;
   - aplica el drenaje y los sumandos;
   - gasta provisiones en tránsito;
   - resuelve bandas y eventos;
   - tira los lapsus;
   - aplica la deriva de cohesión;
   - recupera en estación.
2. Los ganchos de golpes y recompensas van en `triggerHazard`, la rama `land` de `actSurface`, `killCrew`, `work-incident`, `repair-system`, `storeCarried`, `sell` y `next-sector`.
3. Los multiplicadores de debuff van en `workMult`, `evade`, `stepSurface`, `crewJetpackDrainPctPerS(m, ..., psych?)` y `crewCarryCapacityKg(m, ..., psych?)`. El cliente pinta lo mismo que cobra el motor.
4. `refresh()` suma `callDrawKw` a la demanda mientras `callUntilS > timeS`.
5. `hydrate` recalcula `psychRules = effectivePsychRules(...)`, como ya hace con `srules`.
6. `estimateJump` puede devolver la cordura estimada al llegar, como explicación opcional de una línea.

## 9. Cliente (`apps/client`)

### 9.1 HUD

- **Medidor propio:**
  - es un `Gauge` en `Vitals` (`ui/Hud.tsx:45`) que lee `myCrew` (`game/me.ts`);
  - el nivel sale de `levelOf`, con el umbral 35 como marcador;
  - **se oculta** en banda estable con más del 85 %.
- **Icono:** sobrio (pulso o silueta). Nada de cerebros ni rayos.
- **Superficie:** el mismo icono pequeño en `SuitVitals` (`ui/SurfaceHud.tsx:114`).
- **Días de misión** opcionales en `Voyage`.

### 9.2 Compañeros (cooperativo)

- Un anillo bajo el avatar en `scenes/CrewAvatars.tsx`:
  - verde sólido en estable (oculto si el compañero está bien);
  - ámbar punteado en tensa;
  - rojo con pulso lento en crítica o quiebre.
- Sin cifras, y distinguible por **forma**, no solo por color (daltonismo).

### 9.3 Efectos por banda

| Banda | Visual | Audio |
| --- | --- | --- |
| Tensa | Viñeta muy suave en un color neutro distinto del rojo del O₂, con el patrón de `O2Vignette` (`SurfaceHud.tsx:333`) | — |
| Crítica | Desaturación parcial | Respiración audible y filtro paso bajo leve en la música |
| Quiebre | Viñeta con pulso y oscilación de cámara de 0,15° o menos, lenta | Latido grave y alucinaciones ambientales (§ 6.3) |

- **Ajuste nuevo:** «Reducir efectos de estrés» en `SettingsPanel`. Quita la oscilación, la desaturación, los pulsos y las alucinaciones, y conserva el medidor y el anillo.
- Archivos nuevos: `ui/SanityVignette.tsx` y `game/sanityFx.ts`, con la lógica pura de bandas visuales y alucinaciones sembradas.

### 9.4 Puestos nuevos en la nave (`game/layout.ts`)

| Puesto | Zona | Posición aprox. | Uso |
| --- | --- | --- | --- |
| `bunk` (litera) | Cubierta media, babor, a popa del mamparo −5 | x −4.2, z −3.2 (`useX` −3.1, giro π/2) | **Mantener** E (`holdAction` → `rest`). Se cancela al soltar o moverse; cámara baja |
| `comms` (comunicaciones) | Puente, estribor, entre `nav` y el mamparo | x 4.1, z −5.9 (`useX` 3.1, giro −π/2) | **Cargar** E (`chargedAction` → `call-earth`). Evita llamadas accidentales |

- Se amplía `StationId` con `'bunk' | 'comms'` y `STATION_IDS`.
- `StationGroup` en `scenes/ShipStations.tsx`: litera con luz tenue y pantalla con `StatusLamp`.
- En `game/interaction.ts` hay que añadir una rama en `interactionAt` y las variantes de `Interaction`.
- Claves `ui`: `prompt.rest`, `prompt.callEarth`, `station.bunk` y `station.comms`, que van a la lista `dynamic` de `i18n.test.ts`.

### 9.5 Minijuegos (`game/repairGames.ts`)

- Parámetro opcional `strain` (0-1, derivado de la banda). En crítica la ventana de acierto se estrecha un 10-25 % y `*_RATE_ON` baja un poco. `*_RATE_OFF` y `SIMPLE_RATE` no cambian: nunca se bloquea el juego.
- **La parte autoritativa es el motor** (`workMult`). El cliente solo puede enviar **menos** segundos, nunca más, así que la validación del servidor (`WORK_BUDGET_SLACK`) no cambia.
- Con «interacciones simples» activadas, el debuff se aplica solo en el motor.

### 9.6 Otras pantallas

- **`ui/StationTerminal.tsx`:**
  - fila «Provisiones frescas» (6/6, precio);
  - mejoras `crew` con su texto de efecto (`useEffectText`).
- **`ui/MissionScreens.tsx`:**
  - módulos `habitat` y `greenhouse` en `Palette`;
  - aviso `crew-wellbeing` en `ReviewPanel`, en una línea ámbar.
- **`ui/Screens.tsx` (`EndScreen`):**
  - filas «Tiempo en banda crítica» (mm:ss) y «Contramedidas usadas»;
  - se ocultan si valen 0.
- **`HelpOverlay`:** una línea opcional, «Descansa en la litera cuando suba la tensión».

### 9.7 Audio

- **`SfxId` nuevos** en `audio/soundLogic.ts`, con `SFX_META` y `captionKey`:

  | Sonido | Uso |
  | --- | --- |
  | `breathLoop` | Respiración audible |
  | `heartbeat` | Latido |
  | `restStart` / `restEnd` | Inicio y fin del descanso |
  | `callEarth` | Llamada |
  | `callFail` | Llamada fallida |
  | `whisperAmbient` | Susurros |

- `sfxForRunEvent` mapea `crew-sanity`, `crew-rest`, `earth-call` y `crew-lapse`.
- **`audio/musicLogic.ts`:**
  - la cordura **no suma a `dangerLevel`**, porque falsearía la señal de amenaza real;
  - va como **capa propia** en `musicMixFor`: filtro y reverberación que crecen con la banda.
- `cues.ts` reproduce un aviso solo al entrar en crítica.

### 9.8 Privacidad de los toasts (`game/runStore.ts`)

- `crew-rest`, `earth-call`, `crew-lapse` y `crew-sanity` entran en `PERSONAL_EVENTS`. Solo los ve su dueño; los demás ven el anillo.
- `cohesion` es de equipo, así que lo ven todos.

## 10. Servidor del cooperativo (`apps/game-server`)

- En `roomModel.ts`:
  - `rest` y `call-earth` entran en `CREW_ACTIONS` (el servidor impone el `crewId`) y en `WORK_ACTIONS` (presupuesto de trabajo real);
  - `buy-provisions` va como `buy-supply`.
- `net.ts` (`parseActionMessage`) valida la forma de las tres acciones.
- `Incident.workers` se rellena con el `crewId` que impone el servidor.
- Tests nuevos en `roomModel.test.ts`:
  - imposición del `crewId`;
  - presupuesto que limita `rest`;
  - `sanityPct` y `psych` que viajan por snapshot e hydrate.

## 11. Textos (ejemplos; los mensajes del motor no pasan de 90 caracteres, regla 6)

| Clave (`sim`) | es | en |
| --- | --- | --- |
| `event.sanity.tense` | {{name}} está tenso: trabaja más lento. | {{name}} is strained: working slower. |
| `event.sanity.critical` | {{name}} está al límite. Que descanse. | {{name}} is at the limit. Get some rest. |
| `event.sanity.breakdown` | {{name}} se derrumba: comete errores. | {{name}} is breaking down: making mistakes. |
| `event.sanity.recovered` | {{name}} se recompone. | {{name}} is pulling it together. |
| `event.rest.start` | {{name}} descansa. El tiempo corre. | {{name}} is resting. The clock ticks. |
| `event.rest.done` | {{name}} vuelve descansado. | {{name}} is back, rested. |
| `event.earthCall` | Llamada a casa: +{{pct}} de ánimo ({{delayMin}} min de retraso). | Call home: +{{pct}} morale ({{delayMin}} min delay). |
| `event.lapse.switch` | Descuido: {{system}} apagado. | Slip: {{system}} switched off. |
| `event.lapse.drop` | Descuido: se cae {{material}}. | Slip: dropped {{material}}. |
| `event.cohesion.low` | El equipo se resiente. | The crew is fraying. |
| `event.cohesion.recovered` | El equipo vuelve a empujar junto. | The crew pulls together again. |
| `reject.crewResting` | Está descansando. | Resting. |
| `reject.callPower` | Sin margen eléctrico para llamar. | Not enough spare power to call. |
| `reject.callCooldown` | Línea ocupada: espera un poco. | Line busy: wait a bit. |
| `reject.provisionsFull` | Despensa llena. | Pantry full. |
| `design.review.crew-wellbeing` | Misión de {{months}} meses sin hábitat: la tripulación se agotará. | {{months}}-month mission without a habitat: the crew will wear down. |

El motor devuelve `MessageRef` (clave y parámetros), nunca texto final. `{{name}}` sale del `crewId` en el cliente.

## 12. Pruebas

| Archivo | Qué comprueba |
| --- | --- |
| `sanity.test.ts` (nuevo) | Histéresis (64.9 → tensa; 69.9 sigue tensa; 70 → estable); cada factor RIDGE aislado; `commsDelayMin`; recuperación de la llamada según la distancia; debuffs por banda; que `psychRoll` sea estable |
| `run.test.ts` | Con `enabled: false`, `snapshot()` idéntico al actual (`toEqual`). Drenaje ×100 durante 30 min sin muertes ni `lossReason`. Rechazos de `rest`, `call-earth` y `buy-provisions`. La llamada sube `powerDemandKw`. El descanso bloquea el trabajo. Tope de recuperación en estación. Lapsus que nunca tocan `lifeSupport`, `engines` ni `reactor` |
| Determinismo | La misma partida con `step(0.1)` y con `step(7.3)`. `hydrate(snapshot())` a mitad de partida, con lapsus activos |
| `coop.test.ts` | Cohesión al reparar dos a la vez; `sanityPct` viaja por snapshot |
| `locales.test.ts` | Barrido nuevo `psychScript` (catálogo con `startPct: 20`) que emite todos los `event.*` y `reject.*` nuevos. Mensajes de 90 caracteres o menos; paridad es/en |
| `economy.test.ts` | `buy-provisions` y las mejoras `crew` |
| `design.test.ts` y fixtures | Un fixture produce `crew-wellbeing`; existen las etiquetas `design.moduleKind.habitat` y `design.moduleKind.greenhouse` |
| Cliente | `i18n.test.ts` (lista `dynamic`), `minigames.test.ts` (`strain`), `game.test.ts` (puestos dentro del casco y `nearestStation`) |
| Servidor | `roomModel.test.ts` (§ 10) |
| Pureza | `purity.test.ts` ya prohíbe `Math.random` y `Date.now` en `sanity.ts`. No hace falta tocarlo |

## 13. Balance

- **Bot** (`packages/shared/src/__tests__/bot.ts`): opción `psychPolicy?: 'ignore' | 'rest' | 'buy'`, con `undefined` equivalente a `'ignore'`.

  | Política | Qué hace |
  | --- | --- |
  | `rest` | Descansa en tránsito por debajo de 70, sin avisos ni averías. Llama si hay margen eléctrico |
  | `buy` | Lo mismo que `rest`, más provisiones desde el sector 3, mejoras `crew` en la tienda y `habitat-cabin` en misiones de 48 meses o más |

- **Informe de `pnpm balance`** (`packages/shared/scripts/balance.ts`):
  - cordura media y percentil 10 por sector;
  - porcentaje de tripulantes por banda;
  - segundos en cada banda;
  - créditos gastados en cordura;
  - llamadas, descansos y lapsus;
  - penalización media de reparación.
- **Umbrales nuevos** (`balance.test.ts`, en su propio `describe` con un catálogo `enabled: true`):

  | Comprobación | Umbral |
  | --- | --- |
  | Sector 1 con `ignore` | Sigue estable y pasa igual que hoy (diferencia de 1 punto o menos en `clearedPct`) |
  | Cordura media en el sector 4 | `rest` ≥ `ignore` + 15; `buy` ≥ `ignore` + 20 |
  | `buy` | Sin dominancia: pierde combustible o casco frente a `rest` en algún perfil |
  | Muertes y derrotas | Ninguna por cordura en ningún perfil (`reasons` no cambia) |

- **Despliegue en dos PR:**

  | PR | Contenido | Condición |
  | --- | --- | --- |
  | A | Todo con `"enabled": false` | `pnpm balance 200` da cifras **idénticas** antes y después |
  | B | Activa y calibra | Primero ajustar `distPerSector` y `durationMult` en pasos de 0.05 |

- **Riesgo principal:** el debuff de O₂ del traje podría sacar de su rango (20-50 %) el `crewLostPct` del explorador codicioso. Si pasa, `suitO2` baja a `[1, 1, 1.05, 1.1]`.

## 14. Orden de trabajo por agente

| Paso | Agente | Entregable | Depende de |
| --- | --- | --- | --- |
| 1 | `docs-writer` | ADR 0019 pasa de propuesta a aceptada, con las decisiones abiertas resueltas | Equipo |
| 2 | `sim-engine` | `sanity.ts`, tipos, esquema, `stepPsych`, ganchos y tests (PR A, desactivado) | 1 |
| 3 | `content-designer` | `cordura.json`, mejoras, módulos, ventajas, textos es/en, `psychPolicy` y calibración (PR B) | 2 |
| 4 | `game-server` | Acciones en la sala y tests | 2 |
| 5 | `client-3d` | HUD, puestos, efectos, audio, terminal, hangar, `EndScreen` y ajustes | 2 (puede empezar con datos falsos) |
| 6 | `validator` | `pnpm validate`, reglas del CLAUDE.md y revisión del código (no de conclusiones) | 3, 4, 5 |
| 7 | Equipo | Hito con personas (ver la ficha) | 6 |

## 15. Decisiones abiertas

Es la misma lista que la de `docs/phases/fase-8.md`. Hay que resolverlas todas antes de aceptar el ADR 0019.

1. **Nombre visible:** «Cordura» o «Ánimo»/«Tensión». Se recomienda «Ánimo» en la interfaz y «cordura» en el código y la documentación.
2. **Umbrales y calibración inicial** (65/35/12, histéresis de 5, base de 0,035 %/s): confirmarlos con `pnpm balance`.
3. **Evento ficticio del «tercer trimestre»** (§ 7.11): si entra o no, y cómo se marca.
4. **Cohesión:** solo en el motor (recomendado) o también por cercanía con las poses que inyecta el servidor.
5. **Integración con las ventanas de contacto de la fase 5:** ¿la llamada compite con la bajada de datos dentro de la misma ventana?
6. **Persistencia entre sectores:** la cordura se arrastra entera (propuesta) o se recupera en parte con `next-sector`.
7. **Orden en el roadmap:** depende de la fase 6 para la cohesión y los roles; puede ir antes o después de la 7.
