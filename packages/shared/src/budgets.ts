/**
 * Presupuestos de ingeniería encadenados (panel de recursos del hangar).
 *
 * | Recurso   | used                                   | available                                  |
 * | --------- | -------------------------------------- | ------------------------------------------ |
 * | mass      | masa total (kg)                        | min(capacidad lanzador en la órbita, masa máx. de la estructura) |
 * | power     | consumo medio (W)                      | generación × fracción de sol (media orbital) |
 * | battery   | energía del eclipse = consumo × t_sombra (Wh) | Σ capacidad × DoD (Wh útiles)        |
 * | budget    | componentes + lanzador + operación (MUSD) | presupuesto del escenario                |
 * | data      | datos generados en 1 día (Mbit)        | almacenamiento a bordo (Mbit)              |
 * | comms     | datos generados (Mbit/día)             | contacto/día × estaciones × tasa de bajada |
 * | time      | desarrollo + espera del lanzador (meses) | maxDevMonths                             |
 * | lifetime  | vida exigida (años)                    | min(arrastre, fiabilidad/radiación) (años) |
 *
 * margin = (available − used) / available. Estado:
 *   over  si margin < 0                (excedido)
 *   tight si 0 ≤ margin < 15 %         (TIGHT_MARGIN: margen recomendado típico en diseño de naves)
 *   ok    si margin ≥ 15 %
 * `unit` es un código estable (kg, W, Wh, MUSD, Mbit, Mbit/d, months, years) con traducción en
 * los locales bajo `sim:unit.<código>`.
 * Si un recurso no se puede evaluar aún (p. ej. sin órbita y sin consumo) queda ok con margen 0
 * y no cuenta para `limiting`.
 *
 * Función pura y barata: se llama en cada cambio del hangar.
 */
import { analyzeDesign, round, type DesignAnalysis } from './analysis';
import { catalog } from './catalog';
import type { BudgetReport, Catalog, MessageRef, MissionDesign, PreLaunchOutcome, ResourceBudget, ResourceId } from './types';

/** Margen por debajo del cual un recurso se considera justo. */
export const TIGHT_MARGIN = 0.15;

export const RESOURCE_IDS: readonly ResourceId[] = ['mass', 'power', 'battery', 'budget', 'data', 'comms', 'time', 'lifetime'];

interface Draft {
  budget: ResourceBudget;
  determinate: boolean;
}

function makeBudget(id: ResourceId, used: number, available: number, unit: string, why: MessageRef): Draft {
  let margin: number;
  let determinate = true;
  if (available > 0) margin = (available - used) / available;
  else if (used > 0) margin = -1;
  else {
    margin = 0;
    determinate = false;
  }
  const status = !determinate ? 'ok' : margin < 0 ? 'over' : margin < TIGHT_MARGIN ? 'tight' : 'ok';
  return { budget: { id, used, available, unit, margin, status, why }, determinate };
}

function massBudget(a: DesignAnalysis): Draft {
  const massKg = round(a.massKg, 2);
  if (a.launcherCapacityKg === 0 && a.launcher && a.orbit) {
    return makeBudget('mass', a.massKg, 0, 'kg', {
      key: 'budget.mass.unreachable',
      params: { massKg, launcher: a.launcher.id, orbit: a.orbit.id },
    });
  }
  const limits: number[] = [];
  if (a.launcherCapacityKg !== null) limits.push(a.launcherCapacityKg);
  if (a.structureMaxMassKg !== null) limits.push(a.structureMaxMassKg);
  if (limits.length === 0) {
    return makeBudget('mass', a.massKg, 0, 'kg', { key: 'budget.mass.missing', params: { massKg } });
  }
  const available = Math.min(...limits);
  const byLauncher = a.launcherCapacityKg !== null && a.launcherCapacityKg === available && a.launcher && a.orbit;
  const why: MessageRef = byLauncher
    ? { key: 'budget.mass.launcher', params: { massKg, capacityKg: available, launcher: a.launcher!.id, orbit: a.orbit!.id } }
    : { key: 'budget.mass.structure', params: { massKg, capacityKg: available, structure: a.structure?.id ?? '' } };
  return makeBudget('mass', a.massKg, available, 'kg', why);
}

function powerBudget(a: DesignAnalysis): Draft {
  if (!a.orbitParams || a.sunFraction === null) {
    return makeBudget('power', a.powerW, a.solarGenerationW, 'W', {
      key: 'budget.power.noOrbit',
      params: { consumptionW: round(a.powerW), generationW: round(a.solarGenerationW) },
    });
  }
  return makeBudget('power', a.powerW, a.avgGenerationW, 'W', {
    key: 'budget.power.balance',
    params: {
      consumptionW: round(a.powerW),
      generationW: round(a.solarGenerationW),
      sunPct: round(a.sunFraction * 100, 0),
      avgGenerationW: round(a.avgGenerationW),
    },
  });
}

function batteryBudget(a: DesignAnalysis): Draft {
  if (!a.orbitParams) {
    return makeBudget('battery', 0, a.batteryUsableWh, 'Wh', {
      key: 'budget.battery.noOrbit',
      params: { capacityWh: round(a.batteryCapacityWh), usableWh: round(a.batteryUsableWh) },
    });
  }
  return makeBudget('battery', a.eclipseEnergyWh, a.batteryUsableWh, 'Wh', {
    key: 'budget.battery.eclipse',
    params: {
      consumptionW: round(a.powerW),
      eclipseMin: round(a.orbitParams.eclipseMin, 0),
      needWh: round(a.eclipseEnergyWh),
      capacityWh: round(a.batteryCapacityWh),
      usableWh: round(a.batteryUsableWh),
    },
  });
}

function costBudget(a: DesignAnalysis): Draft {
  const base = {
    componentsMUSD: round(a.componentsCostMUSD, 2),
    launcherMUSD: round(a.launcherCostMUSD, 2),
    opsMUSD: round(a.opsCostMUSD, 2),
    totalMUSD: round(a.totalCostMUSD, 2),
    budgetMUSD: round(a.budgetAvailableMUSD, 2),
  };
  const why: MessageRef =
    a.budgetCutMUSD > 0
      ? { key: 'budget.budget.cut', params: { ...base, cutMUSD: round(a.budgetCutMUSD, 2), originalMUSD: a.scenario.budgetMUSD } }
      : { key: 'budget.budget.total', params: base };
  return makeBudget('budget', a.totalCostMUSD, a.budgetAvailableMUSD, 'MUSD', why);
}

function dataBudget(a: DesignAnalysis): Draft {
  return makeBudget('data', a.dataGeneratedMbitPerDay, a.storageMbit, 'Mbit', {
    key: 'budget.data.storage',
    params: { generatedMbitPerDay: round(a.dataGeneratedMbitPerDay, 0), storageMbit: round(a.storageMbit, 0) },
  });
}

function commsBudget(a: DesignAnalysis): Draft {
  const generatedMbitPerDay = round(a.dataGeneratedMbitPerDay, 0);
  let why: MessageRef;
  if (!a.orbitParams) why = { key: 'budget.comms.noOrbit', params: { generatedMbitPerDay } };
  else if (!a.radio) why = { key: 'budget.comms.noRadio', params: { generatedMbitPerDay } };
  else {
    why = {
      key: 'budget.comms.downlink',
      params: {
        generatedMbitPerDay,
        capacityMbitPerDay: round(a.downlinkCapacityMbitPerDay, 0),
        contactMin: round(a.totalContactMinPerDay, 0),
        stations: a.scenario.groundStations,
        downlinkMbps: a.downlinkMbps,
      },
    };
  }
  return makeBudget('comms', a.dataGeneratedMbitPerDay, a.downlinkCapacityMbitPerDay, 'Mbit/d', why);
}

function timeBudget(a: DesignAnalysis): Draft {
  const why: MessageRef = a.delayMonths > 0
    ? {
        key: 'budget.time.delayed',
        params: {
          devMonths: round(a.componentDevMonths),
          leadMonths: round(a.leadMonths),
          delayMonths: round(a.delayMonths),
          totalMonths: round(a.scheduleMonths),
          maxMonths: a.scenario.maxDevMonths,
        },
      }
    : a.slowestComponent
    ? {
        key: 'budget.time.schedule',
        params: {
          devMonths: round(a.componentDevMonths),
          leadMonths: round(a.leadMonths),
          totalMonths: round(a.scheduleMonths),
          maxMonths: a.scenario.maxDevMonths,
          component: a.slowestComponent.id,
        },
      }
    : {
        key: 'budget.time.empty',
        params: { leadMonths: round(a.leadMonths), maxMonths: a.scenario.maxDevMonths },
      };
  return makeBudget('time', a.scheduleMonths, a.scenario.maxDevMonths, 'months', why);
}

function lifetimeBudget(a: DesignAnalysis): Draft {
  const requiredYears = a.scenario.requirements.minLifetimeYears;
  if (a.components.length === 0) {
    return makeBudget('lifetime', requiredYears, 0, 'years', { key: 'budget.lifetime.empty', params: { requiredYears } });
  }
  const dragLimits = a.dragLifetimeYears !== null && a.dragLifetimeYears <= a.reliabilityLifetimeYears;
  const params = {
    lifetimeYears: round(a.lifetimeYears),
    reliabilityYears: round(a.reliabilityLifetimeYears),
    reliabilityPct: round(a.systemReliability * 100, 0),
    requiredYears,
  };
  const why: MessageRef = dragLimits
    ? { key: 'budget.lifetime.drag', params: { ...params, dragYears: a.dragLifetimeYears ?? 0, orbit: a.orbit?.id ?? '' } }
    : { key: 'budget.lifetime.reliability', params };
  return makeBudget('lifetime', requiredYears, a.lifetimeYears, 'years', why);
}

/** Construye el informe de presupuestos desde un análisis ya hecho (uso interno). */
export function budgetsFromAnalysis(a: DesignAnalysis): BudgetReport {
  const drafts = [
    massBudget(a),
    powerBudget(a),
    batteryBudget(a),
    costBudget(a),
    dataBudget(a),
    commsBudget(a),
    timeBudget(a),
    lifetimeBudget(a),
  ];
  const empty = a.components.length === 0 && !a.orbit && !a.launcher;
  let limiting: ResourceId | null = null;
  if (!empty) {
    let best = Infinity;
    for (const d of drafts) {
      if (d.determinate && d.budget.margin < best) {
        best = d.budget.margin;
        limiting = d.budget.id;
      }
    }
  }
  return {
    resources: drafts.map((d) => d.budget),
    limiting,
    orbit: a.orbitParams,
    totals: {
      massKg: a.massKg,
      powerW: a.powerW,
      solarGenerationW: a.solarGenerationW,
      batteryCapacityWh: a.batteryCapacityWh,
      costMUSD: a.totalCostMUSD,
      devMonths: a.scheduleMonths,
      dataGeneratedMbitPerDay: a.dataGeneratedMbitPerDay,
      downlinkCapacityMbitPerDay: a.downlinkCapacityMbitPerDay,
      scienceValue: a.scienceValue,
      groundResolutionM: a.groundResolutionM,
      lifetimeYears: a.lifetimeYears,
    },
  };
}

/**
 * Presupuestos encadenados: masa, energía, batería, presupuesto, datos, comunicaciones, tiempo, vida útil.
 * Función pura y barata (se llama en cada cambio del hangar). Con `preLaunch` (fase 2) aplica el
 * retraso de lanzamiento al calendario y el recorte al presupuesto disponible.
 */
export function computeBudgets(design: MissionDesign, cat: Catalog = catalog, preLaunch?: PreLaunchOutcome): BudgetReport {
  return budgetsFromAnalysis(analyzeDesign(design, cat, adjustmentsFrom(preLaunch)));
}

/** Convierte un resultado pre-operación en ajustes del análisis (uso interno). */
export function adjustmentsFrom(preLaunch?: PreLaunchOutcome): { delayMonths: number; budgetCutMUSD: number } {
  return { delayMonths: preLaunch?.delayMonths ?? 0, budgetCutMUSD: preLaunch?.budgetCutMUSD ?? 0 };
}

/** Busca un recurso por id en un informe. */
export function getResource(report: BudgetReport, id: ResourceId): ResourceBudget {
  const r = report.resources.find((x) => x.id === id);
  if (!r) throw new Error(`Recurso ausente: ${id}`);
  return r;
}
