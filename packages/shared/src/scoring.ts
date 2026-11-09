/**
 * Puntuación: S = w1·objetivos + w2·ciencia + w3·eficiencia + w4·colaboración
 * (cada término 0-100; los pesos del escenario se normalizan para que el total quede en 0-100).
 *
 *  - objetivos: criterios que exige el escenario, cada uno 0-1:
 *      operación completada (días operados / días previstos), datos bajados (media diaria sobre
 *      los días previstos / mínimo exigido), resolución (exigida / lograda), vida útil
 *      (curva dura, ver lifetimeCriterion), ciencia (valor / mínimo), revisita (máxima / real) y viabilidad
 *      (0 si algún recurso duro —masa, energía, batería, presupuesto, tiempo— está excedido: ese
 *      diseño no habría pasado el Go/No-Go).
 *      Fase 2 (ADR 0008):
 *        · vida útil más dura (revisión de balance): lineal desde 0 al 75 % de la vida exigida
 *          (ver lifetimeCriterion), en vez de estimada/exigida.
 *        · energía (solo misiones completadas con agotamientos o desgaste): la batería terminó sana.
 *            energía = clamp(1 − 0.15 · agotamientos) · clamp((capacidad final % − 60) / 40)
 *          (60 % es el umbral en que la batería queda inservible). Terminar al borde de la muerte
 *          ya no puntúa como una misión limpia, aunque el aviso power-storm siga siendo un aviso.
 *        · sobrecostes por eventos pre-operación (retraso, recorte): un recurso duro excedido SOLO
 *          por esos eventos no anula la viabilidad (el diseño pasó el Go); en su lugar añade el
 *          criterio overrun-<recurso> = disponible / usado.
 *      objetivos = 100 · media(criterios) · √min(criterios): quedarse un poco corto en algo
 *      resta poco, pero fallar del todo un objetivo (p. ej. no bajar datos) hunde la nota.
 *      0 si el lanzamiento falla.
 *  - ciencia: valor científico de los instrumentos (tope 100) × fracción de la operación
 *      completada × fracción de los datos generados que llegó a tierra.
 *  - eficiencia: media sobre los 8 recursos de una curva que premia márgenes sanos:
 *      margen < 0 → 0 · 0-15 % → 40-100 (al límite) · 15-50 % → 100 · 50-100 % → 100-40 (sobrado),
 *      multiplicada por (1 − 0.25 · nº de recursos excedidos): pasarse de un recurso cuesta caro.
 *  - colaboración: 100 en solitario salvo que se indique otro valor (fase 3: multijugador).
 */
import { DEPLETION_SCORE_PENALTY, BATTERY_DEAD_FRACTION, LIFETIME_CRITERION_FLOOR } from './constants';
import type { BudgetReport, ResourceId, ScenarioDef, ScoreBreakdown } from './types';

export interface ScoreInput {
  scenario: ScenarioDef;
  budgets: BudgetReport;
  launchSuccess: boolean;
  daysOperated: number;
  dataDownlinkedMbit: number;
  collaboration?: number;
  /** Revisita de la órbita elegida (días), para el criterio de revisita. Opcional. */
  revisitDays?: number;
  /** Agotamientos de batería durante la operación (criterio de energía). Opcional. */
  batteryDepletions?: number;
  /** Capacidad final de la batería en % de la nominal (criterio de energía). Opcional. */
  finalBatteryCapacityPct?: number;
  /** Recursos excedidos solo por eventos pre-operación (PreLaunchOutcome.overruns). Opcional. */
  eventOverruns?: ResourceId[];
}

/**
 * Criterio de vida útil 0-1: lineal desde 0 al 75 % de la vida exigida hasta 1 al 100 %,
 *   vida = clamp((estimada/exigida − 0,75) / 0,25).
 * Quedarse corto de vida es incumplir la misión: 3,6 de 4 años (90 %) vale 0,6, no 0,9.
 */
export function lifetimeCriterion(lifetimeYears: number, requiredYears: number): number {
  if (requiredYears <= 0) return 1;
  return clamp((lifetimeYears / requiredYears - LIFETIME_CRITERION_FLOOR) / (1 - LIFETIME_CRITERION_FLOOR));
}

/**
 * Criterio de energía 0-1: clamp(1 − 0.15·agotamientos) · clamp((cap − 60) / 40).
 * null si la batería terminó intacta (sin agotamientos y al 100 %): no añade criterio.
 */
export function energyCriterion(depletions: number | undefined, finalCapacityPct: number | undefined): number | null {
  const dep = Math.max(0, depletions ?? 0);
  const cap = finalCapacityPct ?? 100;
  if (dep === 0 && cap >= 100 - 1e-9) return null;
  const deadPct = BATTERY_DEAD_FRACTION * 100;
  return clamp(1 - DEPLETION_SCORE_PENALTY * dep) * clamp((cap - deadPct) / (100 - deadPct));
}

export const HEALTHY_MARGIN_MIN = 0.15;
/** Recursos cuyo exceso es un blocker del Go/No-Go. */
export const HARD_RESOURCES = ['mass', 'power', 'battery', 'budget', 'time'] as const;
/** Penalización de eficiencia por cada recurso excedido. */
export const OVER_EFFICIENCY_PENALTY = 0.25;
export const HEALTHY_MARGIN_MAX = 0.5;

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Puntuación 0-100 de un margen: ni al límite ni sobrado. */
export function marginEfficiency(margin: number): number {
  if (margin < 0) return 0;
  if (margin < HEALTHY_MARGIN_MIN) return 40 + (margin / HEALTHY_MARGIN_MIN) * 60;
  if (margin <= HEALTHY_MARGIN_MAX) return 100;
  return Math.max(40, 100 - ((margin - HEALTHY_MARGIN_MAX) / (1 - HEALTHY_MARGIN_MAX)) * 60);
}

/** Criterios de objetivos (0-1) que exige el escenario. Exportado para el informe. */
export function objectiveCriteria(input: ScoreInput): Record<string, number> {
  const { scenario, budgets, daysOperated, dataDownlinkedMbit } = input;
  const req = scenario.requirements;
  const t = budgets.totals;
  const eventOverruns = new Set<string>(input.eventOverruns ?? []);
  const isHard = (id: string) => (HARD_RESOURCES as readonly string[]).includes(id);
  const hardOver = budgets.resources.some((r) => r.status === 'over' && isHard(r.id) && !eventOverruns.has(r.id));
  const criteria: Record<string, number> = {
    completion: clamp(daysOperated / scenario.operationDays),
    feasibility: hardOver ? 0 : 1,
  };
  for (const r of budgets.resources) {
    if (r.status === 'over' && isHard(r.id) && eventOverruns.has(r.id)) {
      criteria[`overrun-${r.id}`] = r.used > 0 ? clamp(r.available / r.used) : 0;
    }
  }
  // Solo en misiones completadas: si la nave se perdió, ya lo mide `completion`.
  const energy = criteria.completion! >= 1 ? energyCriterion(input.batteryDepletions, input.finalBatteryCapacityPct) : null;
  if (energy !== null) criteria.energy = energy;
  if (req.minDownlinkMbitPerDay !== undefined) {
    criteria.data = clamp(dataDownlinkedMbit / scenario.operationDays / req.minDownlinkMbitPerDay);
  }
  if (req.maxGroundResolutionM !== undefined) {
    const r = t.groundResolutionM;
    criteria.resolution = r === null ? 0 : clamp(req.maxGroundResolutionM / r);
  }
  if (req.minLifetimeYears > 0) criteria.lifetime = lifetimeCriterion(t.lifetimeYears, req.minLifetimeYears);
  if (req.minScienceValue !== undefined && req.minScienceValue > 0) {
    criteria.science = clamp(t.scienceValue / req.minScienceValue);
  }
  if (req.maxRevisitDays !== undefined && input.revisitDays !== undefined) {
    criteria.revisit = input.revisitDays <= req.maxRevisitDays ? 1 : clamp(req.maxRevisitDays / input.revisitDays);
  }
  return criteria;
}

/** S = w1·objetivos + w2·ciencia + w3·eficiencia + w4·colaboración (cada término 0-100). */
export function scoreMission(input: ScoreInput): ScoreBreakdown {
  const { scenario, budgets, launchSuccess, daysOperated, dataDownlinkedMbit } = input;
  const weights = scenario.weights;

  let objectives = 0;
  let science = 0;
  if (launchSuccess) {
    const values = Object.values(objectiveCriteria(input));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    objectives = 100 * mean * Math.sqrt(Math.min(...values));

    const completion = clamp(daysOperated / scenario.operationDays);
    const expected = budgets.totals.dataGeneratedMbitPerDay * scenario.operationDays;
    const returned = expected > 0 ? clamp(dataDownlinkedMbit / expected) : 0;
    science = Math.min(100, budgets.totals.scienceValue) * completion * returned;
  }

  const overCount = budgets.resources.filter((r) => r.status === 'over').length;
  const efficiency =
    budgets.resources.length > 0
      ? (budgets.resources.reduce((acc, r) => acc + marginEfficiency(r.margin), 0) / budgets.resources.length) *
        Math.max(0, 1 - OVER_EFFICIENCY_PENALTY * overCount)
      : 0;
  const collaboration = clamp(input.collaboration ?? 100, 0, 100);

  const wSum = weights.objectives + weights.science + weights.efficiency + weights.collaboration;
  const total =
    wSum > 0
      ? (weights.objectives * objectives + weights.science * science + weights.efficiency * efficiency +
          weights.collaboration * collaboration) / wSum
      : 0;

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    objectives: r1(objectives),
    science: r1(science),
    efficiency: r1(efficiency),
    collaboration: r1(collaboration),
    total: r1(total),
    weights,
  };
}
