/**
 * Simulación determinista de la fase de lanzamiento + operación.
 *
 * Determinismo:
 *  - Toda aleatoriedad sale de createRng(seed): primero la tirada del lanzamiento y después el
 *    calendario de eventos del entorno (pre-generado al crear la simulación, un sorteo por día).
 *    Los eventos de salud de la nave usan un flujo derivado (deriveSeed) y también se pre-sortean
 *    (ver events.ts), así que no alteran las tiradas de la fase 1.
 *  - La física avanza con un PASO FIJO interno (30 s por defecto). `step(dt)` solo acumula tiempo
 *    pedido y ejecuta tantos pasos fijos como quepan, así que trocear las llamadas de cualquier
 *    forma da exactamente el mismo estado para el mismo tiempo simulado total.
 *
 * Modelo (simplificado, ver comentarios de cada constante):
 *  - Tiempo orbital uniforme (anomalía media); el eclipse se centra en la fase media 0.5 (peor caso
 *    β = 0). `orbitPhase` del snapshot es la anomalía verdadera (2.ª ley de Kepler, ver orbital.ts).
 *  - Batería: carga con la generación solar en sol, descarga con el consumo. Coherente con la
 *    revisión (que exige que el eclipse quepa en capacidad × DoD):
 *      · por debajo del suelo de descarga segura (1 − DoD) se emite `battery-low` y la batería se
 *        DESGASTA: pierde DEEP_DISCHARGE_WEAR_PER_H de su capacidad nominal por hora;
 *      · si se agota: apagón (todo apagado hasta recuperar el 5 %), luego modo seguro
 *        (instrumentos apagados hasta el 80 %) y −10 % de capacidad;
 *      · falla si su capacidad cae por debajo del 60 % de la nominal o tras 5 agotamientos.
 *    Si en un apagón no se recupera energía durante una órbita entera, la nave se pierde.
 *  - Datos: los instrumentos llenan el almacenamiento; se bajan durante los contactos, repartidos
 *    de forma regular a lo largo del día (pasadas de igual duración y separación); si el
 *    almacenamiento se llena, lo que sobra se pierde.
 *  - Eventos (solo si eventsEnabled; sorteo en events.ts, tabla por dificultad en constants.ts):
 *      · entorno: tormenta solar (−40 % de generación durante 8 h), falla de rueda de reacción (el
 *        apuntado pasa al de respaldo y los instrumentos exigentes generan la mitad; respaldo = 1° con
 *        star tracker + magnetopares, 2° con star tracker solo, 5° sin star tracker, ver
 *        wheelBackupPointingDeg en events.ts) y maniobra por basura espacial (instrumentos apagados 2 h);
 *      · salud: sobrecalentamiento (modo seguro térmico: instrumentos apagados 3 h) y falla de
 *        componente: instrumento → se pierde; radio/computadora/ADCS → si hay otra unidad se usa
 *        esa, si no se degrada (antena de baja ganancia 25 %, medio almacenamiento, apuntado de
 *        respaldo; perder la unidad de ruedas equivale a la falla de ruedas y el apuntado nunca
 *        mejora); paneles/batería/térmico → la protección de fallos aísla la pieza y la nave
 *        pasa 6 h en modo seguro (no es fatal: la redundancia del bus lo cubre).
 *  - Pre-operación (opcional, `opts.preLaunch` de rollPreLaunchEvents): sus eventos van primero en
 *    `events` y el retraso/recorte se aplican a presupuestos, puntuación e informe.
 *  - `mission-complete` al cumplir `operationDays`.
 */
import { analyzeDesign, round, type DesignAnalysis } from './analysis';
import { adjustmentsFrom, budgetsFromAnalysis } from './budgets';
import { catalog } from './catalog';
import {
  DEFAULT_FIXED_STEP_S, SECONDS_PER_DAY, STORM_GENERATION_FACTOR, STORM_DURATION_H, DEBRIS_PAYLOAD_OFF_H, BACKUP_POINTING_DEG,
  POINTING_DATA_FACTOR, DEPLETION_CAPACITY_FACTOR, MAX_DEPLETIONS, BROWNOUT_EXIT_SOC, SAFE_MODE_EXIT_SOC,
  DEEP_DISCHARGE_WEAR_PER_H, BATTERY_DEAD_FRACTION, BATTERY_LOW_REARM_MARGIN,
  OVERHEAT_SAFE_MODE_H, FAULT_SAFE_MODE_H, WHEEL_ADCS_MAX_ACCURACY_DEG, STAR_TRACKER_MAX_ACCURACY_DEG, COMMS_BACKUP_FACTOR, OBC_BACKUP_FACTOR,
} from './constants';
import { wheelBackupPointingDeg, resolveEventTable, scheduleEnvironmentEvents, scheduleHealthEvents, type ScheduledEvent } from './events';
import { altitudeAtTrueAnomaly, orbitEccentricity, orbitPhaseAt, passDurationMin } from './orbital';
import { buildReport } from './report';
import { createRng } from './rng';
import { scoreMission } from './scoring';
import type {
  Catalog, ComponentDef, MessageRef, MissionDesign, MissionResult, MissionSim, MissionSimOptions,
  SimEvent, SimEventType, SimSnapshot, SimStatus,
} from './types';

export * from './constants';

/** Datos útiles por segundo según la precisión de apuntado disponible. */
function dataRateMbitPerS(payload: ComponentDef[], pointingDeg: number | null): number {
  let perDay = 0;
  for (const inst of payload) {
    const ok = inst.requiredPointingDeg === undefined || (pointingDeg !== null && pointingDeg <= inst.requiredPointingDeg);
    perDay += inst.dataMbitPerDay * (ok ? 1 : POINTING_DATA_FACTOR);
  }
  return perDay / SECONDS_PER_DAY;
}

/** Crea la simulación paso a paso (incluye la tirada de lanzamiento con la semilla). */
export function createMissionSim(design: MissionDesign, cat: Catalog = catalog, opts: MissionSimOptions = {}): MissionSim {
  const preLaunch = opts.preLaunch;
  const a: DesignAnalysis = analyzeDesign(design, cat, adjustmentsFrom(preLaunch));
  const s = a.scenario;
  const seed = opts.seed ?? s.defaultSeed;
  const dt = opts.fixedStepSeconds && opts.fixedStepSeconds > 0 ? opts.fixedStepSeconds : DEFAULT_FIXED_STEP_S;
  const rng = createRng(seed);

  // Los eventos pre-operación (si los hay) encabezan el registro.
  const events: SimEvent[] = preLaunch ? preLaunch.events.map((e) => ({ ...e, tSeconds: 0 })) : [];
  let eventCursor = 0;
  const emit = (type: SimEventType, tSeconds: number, key: string, params?: MessageRef['params']) => {
    events.push({ type, tSeconds, message: params ? { key, params } : { key } });
  };

  // ── Lanzamiento (primera tirada del RNG, siempre se consume para que la secuencia sea estable)
  const launchRoll = rng.next();
  let launchSuccess = false;
  if (!a.launcher || !a.orbit) {
    emit('launch-failure', 0, 'event.launchScrubbed');
  } else if (a.launcherCapacityKg === 0) {
    emit('launch-failure', 0, 'event.launchScrubbedUnreachable', { launcher: a.launcher.id, orbit: a.orbit.id });
  } else if (a.launcherCapacityKg !== null && a.massKg > a.launcherCapacityKg) {
    emit('launch-failure', 0, 'event.launchScrubbedMass', {
      massKg: round(a.massKg, 2), capacityKg: a.launcherCapacityKg, launcher: a.launcher.id,
    });
  } else if (launchRoll >= a.launcher.reliability) {
    emit('launch-failure', 0, 'event.launchFailure', {
      launcher: a.launcher.id, reliabilityPct: round(a.launcher.reliability * 100, 1),
    });
  } else {
    launchSuccess = true;
    emit('launch-success', 0, 'event.launchSuccess', { launcher: a.launcher.id, orbit: a.orbit.id });
  }
  const table = resolveEventTable(s);
  const scheduled: ScheduledEvent[] = [...scheduleEnvironmentEvents(a, table, rng), ...scheduleHealthEvents(a, table, seed)]
    .map((ev, order) => ({ ev, order }))
    .sort((x, y) => x.ev.tSeconds - y.ev.tSeconds || x.order - y.order)
    .map((x) => x.ev);
  let nextScheduled = 0;

  // ── Constantes de la órbita
  const endS = s.operationDays * SECONDS_PER_DAY;
  const maxTicks = Math.ceil(endS / dt);
  const periodS = (a.orbitParams?.periodMin ?? 90) * 60;
  const ecc = a.orbit ? orbitEccentricity(a.orbit) : 0;
  const halfEclipse = (a.orbitParams?.eclipseFraction ?? 0) / 2;
  const contactSecPerDay = a.totalContactMinPerDay * 60;
  const alwaysContact = contactSecPerDay >= SECONDS_PER_DAY;
  let passSpacingS = SECONDS_PER_DAY;
  let passDurationS = 0;
  if (a.orbit && !alwaysContact && contactSecPerDay > 0) {
    const perStationMin = a.orbitParams!.contactMinPerDayPerStation;
    const passesPerStation = Math.max(1, Math.round(perStationMin / passDurationMin(a.orbit)));
    const passes = passesPerStation * Math.max(1, s.groundStations);
    passSpacingS = SECONDS_PER_DAY / passes;
    passDurationS = contactSecPerDay / passes;
  }
  const radioOn = a.radio !== null && contactSecPerDay > 0;
  // Primera pasada a mitad del primer intervalo (offset determinista).
  const contactAt = (t: number): boolean => {
    if (!radioOn) return false;
    if (alwaysContact) return true;
    const local = (t + passSpacingS / 2) % passSpacingS;
    return local < passDurationS;
  };
  /** Segundos de contacto dentro de [t, t + dt): solape exacto con las ventanas de pasada. */
  const contactSecondsIn = (t: number): number => {
    if (!radioOn) return 0;
    if (alwaysContact) return dt;
    let total = 0;
    let local = (t + passSpacingS / 2) % passSpacingS;
    let remaining = dt;
    while (remaining > 0) {
      const chunk = Math.min(remaining, passSpacingS - local);
      total += Math.max(0, Math.min(local + chunk, passDurationS) - local);
      remaining -= chunk;
      local = 0;
    }
    return total;
  };

  // ── Estado
  const nominalCapacityWh = a.batteryCapacityWh;
  // Suelo de descarga segura (fracción de SoC): 1 − DoD efectiva del conjunto de baterías.
  const dodFloor = nominalCapacityWh > 0 ? 1 - a.batteryUsableWh / nominalCapacityWh : 0;
  let capacityWh = nominalCapacityWh;
  let batteryWh = capacityWh;
  let minBatteryPct = nominalCapacityWh > 0 ? 100 : 0;
  let brownout = false;
  let brownoutS = 0;
  let safeMode = false;
  let depletions = 0;
  let lowArmed = true;
  let storageArmed = true;
  let stormUntil = -1;
  let debrisUntil = -1;
  /** Fin del modo seguro por sobrecalentamiento o por aislar una falla (instrumentos apagados). */
  let faultSafeUntil = -1;
  let wheelFailed = false;
  let componentDegraded = false;
  // Cantidades que pueden degradarse por fallas de componente.
  let pointingDeg = a.bestPointingDeg;
  let downlinkMbps = a.downlinkMbps;
  let storageMbit = a.storageMbit;
  const payload = [...a.bySubsystem.payload];
  let payloadPowerW = a.payloadPowerW;
  const failed = new Set<number>();
  let dataRate = dataRateMbitPerS(payload, pointingDeg);
  let stored = 0;
  let downlinked = 0;
  let lost = 0;
  let inEclipse = false;
  let inContact = false;
  let tick = 0;
  let status: SimStatus = launchSuccess ? 'nominal' : 'failed';
  let finished = !launchSuccess;
  let endTimeS = launchSuccess ? endS : 0;
  let requestedS = 0;

  const fail = (t: number, type: SimEventType, key: string, params?: MessageRef['params']) => {
    emit(type, t, key, params);
    status = 'failed';
    finished = true;
    endTimeS = t;
  };

  /** Unidades sanas de un subsistema (las ya falladas no cuentan). */
  const aliveOf = (subsystem: ComponentDef['subsystem']) =>
    a.components.filter((c, i) => c.subsystem === subsystem && !failed.has(i));

  const failComponent = (t: number, index: number) => {
    const c = a.components[index];
    if (!c || failed.has(index)) return;
    failed.add(index);
    const component = c.id;
    switch (c.subsystem) {
      case 'payload': {
        const k = payload.indexOf(c);
        if (k >= 0) payload.splice(k, 1);
        payloadPowerW = payload.reduce((acc, x) => acc + x.powerW, 0);
        dataRate = dataRateMbitPerS(payload, pointingDeg);
        componentDegraded = true;
        emit('component-failure', t, 'event.componentFailure.payload', { component, remaining: payload.length });
        break;
      }
      case 'comms': {
        const rest = aliveOf('comms');
        downlinkMbps = rest.length > 0
          ? Math.max(...rest.map((x) => x.downlinkMbps ?? 0))
          : (c.downlinkMbps ?? 0) * COMMS_BACKUP_FACTOR;
        componentDegraded = true;
        emit('component-failure', t, rest.length > 0 ? 'event.componentFailure.commsBackup' : 'event.componentFailure.comms', {
          component, downlinkMbps: round(downlinkMbps, 4),
        });
        break;
      }
      case 'obc': {
        const rest = aliveOf('obc');
        storageMbit = rest.length > 0
          ? rest.reduce((acc, x) => acc + (x.storageMbit ?? 0), 0)
          : (c.storageMbit ?? 0) * OBC_BACKUP_FACTOR;
        componentDegraded = true;
        emit('component-failure', t, 'event.componentFailure.obc', { component, storageMbit: round(storageMbit, 0) });
        break;
      }
      case 'adcs': {
        // Modelo: los ADCS ≤ 1° controlan con ruedas de reacción (el star tracker, ≤ 0,1°, es la versión
        // con determinación fina). Perder la unidad de ruedas, o el star tracker sin otra unidad con
        // ruedas, equivale a la falla de ruedas: respaldo de wheelBackupPointingDeg con lo que quede.
        // Perder solo el star tracker con ruedas sanas: se apunta con la mejor unidad restante.
        // El apuntado NUNCA mejora al fallar una pieza.
        const rest = aliveOf('adcs');
        const acc = c.pointingAccuracyDeg ?? Infinity;
        const isWheelUnit = acc <= WHEEL_ADCS_MAX_ACCURACY_DEG;
        const isStarTracker = acc <= STAR_TRACKER_MAX_ACCURACY_DEG;
        const otherWheels = rest.some((x) => (x.pointingAccuracyDeg ?? Infinity) <= WHEEL_ADCS_MAX_ACCURACY_DEG);
        if (isWheelUnit && (!isStarTracker || !otherWheels)) wheelFailed = true;
        const restBest = rest.length > 0 ? Math.min(...rest.map((x) => x.pointingAccuracyDeg ?? Infinity)) : BACKUP_POINTING_DEG;
        const next = wheelFailed ? wheelBackupPointingDeg(rest) : restBest;
        pointingDeg = Math.max(pointingDeg ?? 0, next);
        dataRate = dataRateMbitPerS(payload, pointingDeg);
        componentDegraded = true;
        // accuracyDeg = apuntado resultante tras la falla (°).
        emit('component-failure', t, 'event.componentFailure.adcs', { component, accuracyDeg: round(pointingDeg, 2) });
        break;
      }
      default: {
        // Paneles, batería o térmico: la protección de fallos aísla la pieza (redundancia del bus).
        faultSafeUntil = Math.max(faultSafeUntil, t + FAULT_SAFE_MODE_H * 3600);
        emit('component-failure', t, 'event.componentFailure.isolated', { component, hours: FAULT_SAFE_MODE_H });
      }
    }
  };

  const applyScheduled = (ev: ScheduledEvent) => {
    switch (ev.type) {
      case 'solar-storm':
        stormUntil = ev.tSeconds + STORM_DURATION_H * 3600;
        emit('solar-storm', ev.tSeconds, 'event.solarStorm', {
          hours: STORM_DURATION_H, pct: round((1 - STORM_GENERATION_FACTOR) * 100, 0),
        });
        break;
      case 'debris-avoidance':
        debrisUntil = ev.tSeconds + DEBRIS_PAYLOAD_OFF_H * 3600;
        emit('debris-avoidance', ev.tSeconds, 'event.debrisAvoidance', { hours: DEBRIS_PAYLOAD_OFF_H });
        break;
      case 'reaction-wheel-failure':
        // Solo si quedan unidades con ruedas SANAS (una rueda ya fallada no puede volver a fallar).
        if (wheelFailed || !aliveOf('adcs').some((x) => (x.pointingAccuracyDeg ?? Infinity) <= WHEEL_ADCS_MAX_ACCURACY_DEG)) break;
        wheelFailed = true;
        {
          const backupDeg = wheelBackupPointingDeg(aliveOf('adcs'));
          pointingDeg = Math.max(pointingDeg ?? 0, backupDeg);
          dataRate = dataRateMbitPerS(payload, pointingDeg);
          emit('reaction-wheel-failure', ev.tSeconds, 'event.reactionWheelFailure', { backupDeg });
        }
        break;
      case 'overheating':
        faultSafeUntil = Math.max(faultSafeUntil, ev.tSeconds + OVERHEAT_SAFE_MODE_H * 3600);
        emit('overheating', ev.tSeconds, 'event.overheating', {
          hours: OVERHEAT_SAFE_MODE_H, powerW: round(a.powerW), dissipationW: round(a.thermalDissipationW),
        });
        break;
      case 'component-failure':
        failComponent(ev.tSeconds, ev.index);
        break;
    }
  };

  const runTick = () => {
    const t = tick * dt;
    while (nextScheduled < scheduled.length && scheduled[nextScheduled]!.tSeconds < t + dt) {
      applyScheduled(scheduled[nextScheduled]!);
      nextScheduled++;
    }

    const phase = (t % periodS) / periodS; // fase media (uniforme en el tiempo)
    const ecl = Math.abs(phase - 0.5) < halfEclipse;
    if (ecl !== inEclipse) {
      inEclipse = ecl;
      if (ecl) emit('eclipse-enter', t, 'event.eclipseEnter', { eclipseMin: round(a.orbitParams?.eclipseMin ?? 0, 0) });
      else emit('eclipse-exit', t, 'event.eclipseExit');
    }
    const contact = contactAt(t);
    if (contact !== inContact) {
      inContact = contact;
      if (contact) emit('contact-start', t, 'event.contactStart', { downlinkMbps });
      else emit('contact-end', t, 'event.contactEnd', { downlinkedMbit: round(downlinked, 0) });
    }

    // ── Energía
    const gen = inEclipse ? 0 : a.solarGenerationW * (t < stormUntil ? STORM_GENERATION_FACTOR : 1);
    const payloadActive = !brownout && !safeMode && t >= debrisUntil && t >= faultSafeUntil;
    const load = brownout ? 0 : a.busPowerW + (payloadActive ? payloadPowerW : 0);
    const netWh = ((gen - load) * dt) / 3600;
    let next = batteryWh + netWh;
    if (!brownout && netWh < 0 && next <= 0) {
      next = 0;
      brownout = true;
      brownoutS = 0;
      depletions++;
      capacityWh *= DEPLETION_CAPACITY_FACTOR;
      emit('battery-depleted', t, 'event.batteryDepleted', {
        count: depletions,
        capacityPct: nominalCapacityWh > 0 ? round((capacityWh / nominalCapacityWh) * 100, 0) : 0,
      });
      if (depletions >= MAX_DEPLETIONS) {
        fail(t, 'component-failure', 'event.batteryFailed', { count: depletions });
      }
    }
    batteryWh = Math.min(capacityWh, Math.max(0, next));

    // Desgaste por descarga profunda (por debajo de la DoD), proporcional al tiempo.
    if (!finished && nominalCapacityWh > 0 && batteryWh < dodFloor * capacityWh) {
      capacityWh -= (DEEP_DISCHARGE_WEAR_PER_H * nominalCapacityWh * dt) / 3600;
      batteryWh = Math.min(batteryWh, capacityWh);
      if (capacityWh < BATTERY_DEAD_FRACTION * nominalCapacityWh) {
        fail(t, 'component-failure', 'event.batteryWornOut', { capacityPct: round((capacityWh / nominalCapacityWh) * 100, 0) });
      }
    }

    if (!finished && brownout) {
      brownoutS += dt;
      if (batteryWh >= BROWNOUT_EXIT_SOC * capacityWh && gen > 0) {
        brownout = false;
        safeMode = true;
      } else if (brownoutS > periodS) {
        fail(t, 'component-failure', 'event.powerLost', { hours: round(brownoutS / 3600, 1) });
      }
    }
    if (!brownout && safeMode && capacityWh > 0 && batteryWh >= SAFE_MODE_EXIT_SOC * capacityWh) safeMode = false;

    const soc = capacityWh > 0 ? batteryWh / capacityWh : 0;
    if (lowArmed && nominalCapacityWh > 0 && soc < dodFloor && !brownout && !finished) {
      lowArmed = false;
      emit('battery-low', t, 'event.batteryLow', { pct: round(soc * 100, 0), floorPct: round(dodFloor * 100, 0) });
    } else if (!lowArmed && soc >= Math.min(1, dodFloor + BATTERY_LOW_REARM_MARGIN)) {
      lowArmed = true;
    }
    const pct = nominalCapacityWh > 0 ? (batteryWh / nominalCapacityWh) * 100 : 0;
    if (pct < minBatteryPct) minBatteryPct = pct;

    // ── Datos
    if (payloadActive && !finished) stored += dataRate * dt;
    const contactS = brownout ? 0 : contactSecondsIn(t);
    if (contactS > 0) {
      const d = Math.min(stored, downlinkMbps * contactS);
      stored -= d;
      downlinked += d;
    }
    if (stored > storageMbit) {
      lost += stored - storageMbit;
      stored = storageMbit;
      if (storageArmed) {
        storageArmed = false;
        emit('storage-full', t, 'event.storageFull', { storageMbit: round(storageMbit, 0) });
      }
    } else if (!storageArmed && stored < 0.9 * storageMbit) {
      storageArmed = true;
    }

    tick++;
    if (finished) return;
    if (tick >= maxTicks) {
      emit('mission-complete', endS, 'event.missionComplete', { days: s.operationDays });
      status = 'complete';
      finished = true;
      endTimeS = endS;
      return;
    }
    const inFaultSafe = tick * dt < faultSafeUntil;
    status = brownout || safeMode || wheelFailed || componentDegraded || inFaultSafe ? 'degraded' : 'nominal';
  };

  const currentTime = () => (finished ? endTimeS : Math.min(requestedS, endS));

  const snapshot = (): SimSnapshot => {
    const t = currentTime();
    const newEvents = events.slice(eventCursor);
    eventCursor = events.length;
    const meanPhase = launchSuccess ? (t % periodS) / periodS : 0;
    const orbitPhase = launchSuccess ? orbitPhaseAt(t, periodS, ecc) : 0;
    return {
      tSeconds: t,
      day: Math.min(Math.ceil(s.operationDays), Math.floor(t / SECONDS_PER_DAY) + 1),
      orbitPhase,
      meanPhase,
      altitudeKm: a.orbit ? round(altitudeAtTrueAnomaly(a.orbit, orbitPhase * 2 * Math.PI), 1) : 0,
      inEclipse,
      inContact,
      batteryWh,
      batteryPct: nominalCapacityWh > 0 ? (batteryWh / nominalCapacityWh) * 100 : 0,
      dataStoredMbit: stored,
      dataDownlinkedMbit: downlinked,
      dataLostMbit: lost,
      status,
      newEvents,
    };
  };

  const advanceTo = (targetTicks: number) => {
    while (!finished && tick < targetTicks) runTick();
  };

  let result: MissionResult | null = null;

  return {
    step(dtSeconds: number): SimSnapshot {
      if (Number.isFinite(dtSeconds) && dtSeconds > 0 && !finished) {
        requestedS = Math.min(endS, requestedS + dtSeconds);
        // El épsilon absorbe errores de redondeo al sumar trozos (p. ej. 0.1 × 300).
        const target = requestedS >= endS ? maxTicks : Math.floor(requestedS / dt + 1e-6);
        advanceTo(target);
      }
      return snapshot();
    },
    snapshot,
    isFinished: () => finished,
    finish(): MissionResult {
      if (result) return result;
      advanceTo(maxTicks);
      requestedS = endS;
      const budgets = budgetsFromAnalysis(a);
      const daysOperated = round(endTimeS / SECONDS_PER_DAY, 3);
      const finalCapacityPct = nominalCapacityWh > 0 ? (capacityWh / nominalCapacityWh) * 100 : undefined;
      const partial: Omit<MissionResult, 'report'> = {
        design,
        seed,
        launchSuccess,
        status,
        daysOperated,
        dataDownlinkedMbit: downlinked,
        dataLostMbit: lost,
        minBatteryPct,
        finalBatteryCapacityPct: finalCapacityPct !== undefined ? round(finalCapacityPct, 1) : 0,
        batteryDepletions: depletions,
        ...(preLaunch ? { preLaunch } : {}),
        events: [...events],
        budgets,
        score: scoreMission({
          scenario: s,
          budgets,
          launchSuccess,
          daysOperated,
          dataDownlinkedMbit: downlinked,
          revisitDays: a.orbit?.revisitDays,
          batteryDepletions: depletions,
          finalBatteryCapacityPct: finalCapacityPct,
          eventOverruns: preLaunch?.overruns,
        }),
      };
      result = { ...partial, report: buildReport(partial, cat) };
      return result;
    },
  };
}

/** Simula la misión completa de golpe (para tests, prototipo y servidor). */
export function runMission(design: MissionDesign, cat: Catalog = catalog, opts: MissionSimOptions = {}): MissionResult {
  return createMissionSim(design, cat, opts).finish();
}
