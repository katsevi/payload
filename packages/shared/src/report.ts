/**
 * Informe post-misión: cadena de causas con MessageRef concretas y sugerencias de rediseño.
 *
 * Ejemplo de cadena (batería):
 *   failure  report.battery.depleted  "La batería se agotó en el eclipse porque Cámara térmica
 *                                       consume 60 W y la órbita pasa 36 min en sombra."
 *     ← cause.eclipse           (órbita, minutos de sombra, periodo)
 *     ← cause.consumer          (pieza que más consume)
 *     ← cause.eclipseEnergy     (energía necesaria en la sombra)
 *     ← cause.batteryUsable     (energía útil de la batería respetando la DoD)
 *     → suggest.biggerBattery
 *
 * Orden de las entradas: lanzamiento, desenlace, energía, datos, resolución, vida útil, ciencia,
 * eventos, márgenes y puntuación.
 */
import { analyzeDesign, round } from './analysis';
import { catalog } from './catalog';
import { DEEP_DISCHARGE_WEAR_PER_H } from './constants';
import type { Catalog, MessageRef, MissionResult, ReportEntry, SimEvent } from './types';

const ref = (key: string, params?: MessageRef['params']): MessageRef => (params ? { key, params } : { key });

/** Cadena de causas para el informe post-misión. */
export function buildReport(result: Omit<MissionResult, 'report'>, cat: Catalog = catalog): ReportEntry[] {
  const a = analyzeDesign(result.design, cat);
  const s = a.scenario;
  const req = s.requirements;
  const entries: ReportEntry[] = [];
  const ofType = (type: SimEvent['type']) => result.events.filter((e) => e.type === type);
  const scoreEntry: ReportEntry = {
    severity: 'info',
    message: ref('report.score', {
      total: result.score.total,
      objectives: result.score.objectives,
      science: result.score.science,
      efficiency: result.score.efficiency,
    }),
    causes: [],
  };

  // ── Lanzamiento
  const launchEvent = result.events.find((e) => e.type === 'launch-success' || e.type === 'launch-failure');
  if (!result.launchSuccess) {
    const key = launchEvent?.message.key ?? 'event.launchScrubbed';
    const params = launchEvent?.message.params;
    if (key === 'event.launchFailure' && a.launcher) {
      entries.push({
        severity: 'failure',
        message: ref('report.launch.failure', { launcher: a.launcher.id }),
        causes: [ref('cause.launcherReliability', {
          launcher: a.launcher.id,
          reliabilityPct: round(a.launcher.reliability * 100, 1),
          failPct: round((1 - a.launcher.reliability) * 100, 1),
        })],
        suggestion: ref('suggest.reliableLauncher'),
      });
    } else if (key === 'event.launchScrubbedMass' && a.launcher) {
      const heaviest = a.components.reduce((best, c) => (c.massKg > best.massKg ? c : best), a.components[0]!);
      entries.push({
        severity: 'failure',
        message: ref('report.launch.scrubbedMass', params),
        causes: heaviest ? [ref('cause.heaviest', { component: heaviest.id, massKg: heaviest.massKg })] : [],
        suggestion: ref('suggest.reduceMass', { launcher: a.launcher.id }),
      });
    } else if (key === 'event.launchScrubbedUnreachable') {
      entries.push({
        severity: 'failure',
        message: ref('report.launch.scrubbedUnreachable', params),
        causes: [],
        suggestion: ref('suggest.launcherForOrbit'),
      });
    } else {
      entries.push({ severity: 'failure', message: ref('report.launch.scrubbed'), causes: [], suggestion: ref('suggest.pickOrbitLauncher') });
    }
    entries.push(scoreEntry);
    return entries;
  }
  entries.push({
    severity: 'success',
    message: ref('report.launch.success', { launcher: a.launcher?.id ?? '', orbit: a.orbit?.id ?? '' }),
    causes: [],
  });

  // ── Desenlace
  const days = round(result.daysOperated, 1);
  if (result.status === 'complete') {
    entries.push({ severity: 'success', message: ref('report.mission.complete', { days }), causes: [] });
  } else {
    const fatal = ofType('component-failure').at(-1);
    entries.push({
      severity: 'failure',
      message: ref('report.mission.failed', { days, plannedDays: s.operationDays }),
      causes: fatal ? [fatal.message] : [],
    });
  }

  // ── Energía
  const depletions = ofType('battery-depleted');
  const storms = ofType('solar-storm');
  const param = (e: SimEvent | undefined, name: string, fallback: number): number => {
    const v = e?.message.params?.[name];
    return typeof v === 'number' ? v : fallback;
  };
  const stormPct = param(storms[0], 'pct', 40);
  const powerLost = ofType('component-failure').find((e) => e.message.key === 'event.powerLost');
  const wornOut = ofType('component-failure').find((e) => e.message.key === 'event.batteryWornOut');
  const deepDischarges = ofType('battery-low');
  const eclipseMin = round(a.orbitParams?.eclipseMin ?? 0, 0);
  const energyCauses = (): MessageRef[] => {
    const causes: MessageRef[] = [];
    if (a.orbit && a.orbitParams) {
      causes.push(ref('cause.eclipse', { orbit: a.orbit.id, eclipseMin, periodMin: round(a.orbitParams.periodMin, 0) }));
    }
    if (a.biggestConsumer) causes.push(ref('cause.consumer', { component: a.biggestConsumer.id, powerW: a.biggestConsumer.powerW }));
    causes.push(ref('cause.eclipseEnergy', { consumptionW: round(a.powerW), eclipseMin, needWh: round(a.eclipseEnergyWh) }));
    causes.push(ref('cause.batteryUsable', { capacityWh: round(a.batteryCapacityWh), usableWh: round(a.batteryUsableWh) }));
    if (a.avgGenerationW < a.powerW * 1.15) {
      causes.push(ref('cause.powerBalance', { consumptionW: round(a.powerW), avgGenerationW: round(a.avgGenerationW) }));
    }
    if (deepDischarges.length > 0) causes.push(ref('cause.deepDischarge', { wearPct: round(DEEP_DISCHARGE_WEAR_PER_H * 100, 0) }));
    const firstDepletion = Math.min(depletions[0]?.tSeconds ?? Infinity, deepDischarges[0]?.tSeconds ?? Infinity);
    if (storms.some((e) => e.tSeconds <= firstDepletion)) causes.push(ref('cause.solarStorm', { pct: stormPct }));
    return causes;
  };
  const energySuggestion = (): MessageRef =>
    a.eclipseEnergyWh > a.batteryUsableWh
      ? ref('suggest.biggerBattery', {
          needWh: round(a.eclipseEnergyWh),
          usableWh: round(a.batteryUsableWh),
          component: a.biggestConsumer?.id ?? '',
        })
      : ref('suggest.powerMargin');

  if (powerLost) {
    entries.push({
      severity: 'failure',
      message: ref('report.power.lost'),
      causes: [ref('cause.powerBalance', { consumptionW: round(a.powerW), avgGenerationW: round(a.avgGenerationW) })],
      suggestion: ref('suggest.morePanels'),
    });
  } else if (wornOut) {
    entries.push({
      severity: 'failure',
      message: ref('report.battery.wornOut', {
        capacityPct: param(wornOut, 'capacityPct', 60),
        component: a.biggestConsumer?.id ?? '',
        powerW: a.biggestConsumer?.powerW ?? 0,
        eclipseMin,
      }),
      causes: energyCauses(),
      suggestion: energySuggestion(),
    });
  } else if (depletions.length > 0) {
    const failed = result.status === 'failed';
    entries.push({
      severity: failed ? 'failure' : 'warning',
      message: ref(failed ? 'report.battery.depleted' : 'report.battery.depletedSurvived', {
        component: a.biggestConsumer?.id ?? '',
        powerW: a.biggestConsumer?.powerW ?? 0,
        eclipseMin,
        count: depletions.length,
      }),
      causes: energyCauses(),
      suggestion: energySuggestion(),
    });
  } else if (deepDischarges.length > 0) {
    entries.push({
      severity: 'warning',
      message: ref('report.battery.deepDischarge', { count: deepDischarges.length, capacityPct: round(result.finalBatteryCapacityPct ?? 100, 0) }),
      causes: energyCauses(),
      suggestion: energySuggestion(),
    });
  } else {
    entries.push({ severity: 'success', message: ref('report.battery.ok', { minPct: round(result.minBatteryPct, 0) }), causes: [] });
  }

  // ── Datos
  // Media diaria sobre los días PREVISTOS (igual que la puntuación): si la misión acaba antes,
  // los días que faltan cuentan como días sin datos.
  const achieved = result.dataDownlinkedMbit / s.operationDays;
  const endedEarly = result.status === 'failed';
  const capacityCause = (): MessageRef =>
    a.radio
      ? ref('cause.downlinkCapacity', {
          component: a.radio.id,
          downlinkMbps: a.downlinkMbps,
          contactMin: round(a.totalContactMinPerDay, 0),
          stations: s.groundStations,
          capacityMbitPerDay: round(a.downlinkCapacityMbitPerDay, 0),
        })
      : ref('cause.noRadio');
  const lostPct = result.dataLostMbit > 0
    ? round((100 * result.dataLostMbit) / (result.dataLostMbit + result.dataDownlinkedMbit + 1e-9), 0)
    : 0;
  if (req.minDownlinkMbitPerDay !== undefined) {
    if (achieved >= req.minDownlinkMbitPerDay) {
      entries.push({
        severity: 'success',
        message: ref('report.data.met', { achievedMbitPerDay: round(achieved, 0), requiredMbitPerDay: req.minDownlinkMbitPerDay }),
        causes: [],
      });
    } else {
      const causes: MessageRef[] = [];
      const generatedShort = a.dataGeneratedMbitPerDay < req.minDownlinkMbitPerDay;
      const capacityShort = a.downlinkCapacityMbitPerDay < Math.min(a.dataGeneratedMbitPerDay, req.minDownlinkMbitPerDay);
      if (generatedShort) causes.push(ref('cause.dataGenerated', { generatedMbitPerDay: round(a.dataGeneratedMbitPerDay, 0) }));
      if (capacityShort || !a.radio) causes.push(capacityCause());
      if (result.dataLostMbit > 0) {
        causes.push(ref('cause.storageFull', { storageMbit: round(a.storageMbit, 0), lostMbit: round(result.dataLostMbit, 0) }));
      }
      if (endedEarly) causes.push(ref('cause.missionEndedEarly', { days }));
      const entry: ReportEntry = {
        severity: 'failure',
        message: ref('report.data.below', { achievedMbitPerDay: round(achieved, 0), requiredMbitPerDay: req.minDownlinkMbitPerDay }),
        causes,
      };
      if (capacityShort || !a.radio) entry.suggestion = ref('suggest.betterRadio');
      else if (generatedShort) entry.suggestion = ref('suggest.moreData');
      else if (endedEarly) entry.suggestion = ref('suggest.fixFailureFirst');
      else entry.suggestion = ref('suggest.powerMargin');
      entries.push(entry);
    }
  }
  if (result.dataLostMbit > 0 && (req.minDownlinkMbitPerDay === undefined || achieved >= req.minDownlinkMbitPerDay)) {
    entries.push({
      severity: 'warning',
      message: ref('report.data.lost', { lostMbit: round(result.dataLostMbit, 0), pct: lostPct }),
      causes: [capacityCause(), ref('cause.storageFull', { storageMbit: round(a.storageMbit, 0), lostMbit: round(result.dataLostMbit, 0) })],
      suggestion: ref('suggest.betterRadio'),
    });
  }

  // ── Resolución
  if (req.maxGroundResolutionM !== undefined) {
    const r = a.groundResolutionM;
    if (r === null || !a.bestImager) {
      entries.push({
        severity: 'failure',
        message: ref('report.resolution.none', { requiredM: req.maxGroundResolutionM }),
        causes: [],
        suggestion: ref('suggest.addImager'),
      });
    } else {
      const cause = ref('cause.resolutionAltitude', {
        component: a.bestImager.id,
        res500M: a.bestImager.groundResolutionAt500KmM ?? 0,
        altitudeKm: a.altitudeKm ?? 500,
        resolutionM: round(r),
      });
      if (r <= req.maxGroundResolutionM) {
        entries.push({ severity: 'success', message: ref('report.resolution.met', { resolutionM: round(r), requiredM: req.maxGroundResolutionM }), causes: [cause] });
      } else {
        entries.push({
          severity: 'failure',
          message: ref('report.resolution.below', { resolutionM: round(r), requiredM: req.maxGroundResolutionM }),
          causes: [cause],
          suggestion: ref('suggest.lowerOrbitOrCamera'),
        });
      }
    }
  }

  // ── Vida útil
  if (req.minLifetimeYears > 0) {
    const life = round(a.lifetimeYears);
    const dragLimits = a.dragLifetimeYears !== null && a.dragLifetimeYears <= a.reliabilityLifetimeYears;
    const cause = dragLimits
      ? ref('cause.dragLifetime', { orbit: a.orbit?.id ?? '', dragYears: a.dragLifetimeYears ?? 0 })
      : ref('cause.reliabilityLifetime', {
          reliabilityYears: round(a.reliabilityLifetimeYears),
          reliabilityPct: round(a.systemReliability * 100, 0),
          radiationPct: round(a.radiationFactor * 100, 0),
        });
    if (a.lifetimeYears >= req.minLifetimeYears) {
      entries.push({ severity: 'success', message: ref('report.lifetime.met', { lifetimeYears: life, requiredYears: req.minLifetimeYears }), causes: [cause] });
    } else {
      entries.push({
        severity: 'failure',
        message: ref('report.lifetime.below', { lifetimeYears: life, requiredYears: req.minLifetimeYears }),
        causes: [cause],
        suggestion: dragLimits ? ref('suggest.higherOrbit') : ref('suggest.moreReliable'),
      });
    }
  }

  // ── Ciencia
  if (req.minScienceValue !== undefined) {
    const params = { science: a.scienceValue, required: req.minScienceValue };
    if (a.scienceValue >= req.minScienceValue) {
      entries.push({ severity: 'success', message: ref('report.science.met', params), causes: [] });
    } else {
      entries.push({ severity: 'warning', message: ref('report.science.below', params), causes: [], suggestion: ref('suggest.addInstrument') });
    }
  }

  // ── Eventos aleatorios
  if (storms.length > 0) {
    entries.push({ severity: 'info', message: ref('report.event.solarStorm', { count: storms.length }), causes: [ref('cause.solarStorm', { pct: stormPct })] });
  }
  const wheel = ofType('reaction-wheel-failure')[0];
  if (wheel) {
    entries.push({
      severity: 'warning',
      message: ref('report.event.reactionWheel'),
      causes: [ref('cause.wheelPointing', { backupDeg: param(wheel, 'backupDeg', 5) })],
      suggestion: ref('suggest.redundancy'),
    });
  }
  const debris = ofType('debris-avoidance');
  if (debris.length > 0) {
    entries.push({ severity: 'info', message: ref('report.event.debris', { count: debris.length, hours: param(debris[0], 'hours', 2) }), causes: [] });
  }

  // ── Márgenes (lo que el panel de recursos marcaba en ámbar o rojo)
  for (const r of result.budgets.resources) {
    if (r.status === 'ok') continue;
    entries.push({
      severity: r.status === 'over' ? 'failure' : 'warning',
      message: ref(`report.margin.${r.status}.${r.id}`, { marginPct: round(r.margin * 100, 0) }),
      causes: [r.why],
    });
  }

  entries.push(scoreEntry);
  return entries;
}
