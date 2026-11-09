/**
 * Eventos aleatorios ponderados por dificultad (fase 2, ADR 0008). Todo sale de createRng(seed) y
 * se PRE-SORTEA al crear la simulación, así que el troceo de step() no influye.
 *
 * Tres familias, cada una con su propio flujo de azar (deriveSeed) para que añadir una no cambie
 * las tiradas de las demás:
 *
 *  1. Entorno (no depende del diseño; mismo flujo y tiradas que en la fase 1):
 *     un sorteo por día con probabilidad `environmentChancePerDay`; si sale, se elige el tipo con
 *     `environmentWeights` (tormenta solar, basura espacial y —solo si hay ruedas— falla de rueda).
 *
 *  2. Salud de la nave (depende del diseño), flujo derivado con HEALTH_RNG_SALT. Cada día:
 *     · sobrecalentamiento con p = overheatingChancePerDay · F,
 *         F = clamp((15 % − margen térmico) / 15 %, 0, 2)    (0 si el margen es sano ≥ 15 %)
 *         margen térmico = (disipación − consumo) / disipación
 *     · falla de componente con p = 1 − R_eff^(A / (5 años · 365 d)),
 *         R_eff = Π r_i^(1 + 2·radiación) sobre las piezas no estructurales aún sanas,
 *         A = componentFailureAcceleration (aceleración de juego por dificultad).
 *       La pieza que falla se elige con peso 1 − r_i^(1 + 2·radiación).
 *
 *  3. Pre-operación (tras el Go, antes del lanzamiento): `rollPreLaunchEvents`, flujo derivado con
 *     PRELAUNCH_RNG_SALT. Retraso con `launchDelayChance` (meses enteros en `launchDelayMonths`) y
 *     recorte con `budgetCutChance` (porcentaje entero en `budgetCutPct`).
 *
 * Los pesos/probabilidades se pueden ajustar por escenario con `ScenarioDef.eventTuning`.
 */
import { analyzeDesign, NOMINAL_LIFE_YEARS, RADIATION_RELIABILITY_K, round, type DesignAnalysis } from './analysis';
import { budgetsFromAnalysis, TIGHT_MARGIN } from './budgets';
import { catalog } from './catalog';
import {
  BACKUP_POINTING_DEG, BACKUP_POINTING_STAR_TRACKER_DEG, BACKUP_POINTING_STAR_TRACKER_MTQ_DEG, STAR_TRACKER_MAX_ACCURACY_DEG,
  EVENT_TABLES, HEALTH_RNG_SALT, OVERHEAT_MAX_FACTOR, PRELAUNCH_RNG_SALT, SECONDS_PER_DAY, WHEEL_ADCS_MAX_ACCURACY_DEG,
} from './constants';
import { createRng, deriveSeed, type Rng } from './rng';
import type {
  Catalog, ComponentDef, EnvironmentEventType, EventTable, MissionDesign, PreLaunchOutcome, ResourceId, ScenarioDef, SimEvent,
} from './types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const DAYS_PER_YEAR = 365;

/** Tabla de eventos efectiva del escenario: la de su dificultad con `eventTuning` encima. */
export function resolveEventTable(scenario: ScenarioDef): EventTable {
  const base = EVENT_TABLES[scenario.difficulty];
  const t = scenario.eventTuning ?? {};
  return {
    environmentChancePerDay: t.environmentChancePerDay ?? base.environmentChancePerDay,
    environmentWeights: { ...base.environmentWeights, ...(t.environmentWeights ?? {}) },
    overheatingChancePerDay: t.overheatingChancePerDay ?? base.overheatingChancePerDay,
    componentFailureAcceleration: t.componentFailureAcceleration ?? base.componentFailureAcceleration,
    launchDelayChance: t.launchDelayChance ?? base.launchDelayChance,
    launchDelayMonths: t.launchDelayMonths ?? base.launchDelayMonths,
    budgetCutChance: t.budgetCutChance ?? base.budgetCutChance,
    budgetCutPct: t.budgetCutPct ?? base.budgetCutPct,
  };
}

// ─── Programación de eventos de operación (uso interno de simulation.ts) ────

export type ScheduledEvent =
  | { tSeconds: number; type: EnvironmentEventType }
  | { tSeconds: number; type: 'overheating' }
  /** `index` = posición en DesignAnalysis.components de la pieza que falla. */
  | { tSeconds: number; type: 'component-failure'; index: number };

export function hasWheels(a: DesignAnalysis): boolean {
  return a.bySubsystem.adcs.some((c) => (c.pointingAccuracyDeg ?? Infinity) <= WHEEL_ADCS_MAX_ACCURACY_DEG);
}

/**
 * Apuntado de respaldo (°) tras fallar las ruedas de reacción, según los ADCS sanos que queden:
 *   · con star tracker (≤ 0,1°) y magnetopares (ADCS > 1°, sin ruedas) → 1°: la actitud se conoce con
 *     precisión y los magnetopares, aunque débiles, la corrigen;
 *   · con star tracker sin magnetopares → 2°: solo queda el control residual del propio ADCS;
 *   · sin star tracker → 5°: magnetopares con sensores gruesos (Sol, magnetómetro).
 * Nunca mejora el apuntado que ya se tenía.
 */
export function wheelBackupPointingDeg(adcs: Pick<ComponentDef, 'pointingAccuracyDeg'>[]): number {
  const acc = adcs.map((c) => c.pointingAccuracyDeg ?? Infinity);
  const starTracker = acc.some((x) => x <= STAR_TRACKER_MAX_ACCURACY_DEG);
  const magnetorquers = acc.some((x) => x > WHEEL_ADCS_MAX_ACCURACY_DEG && Number.isFinite(x));
  if (starTracker && magnetorquers) return BACKUP_POINTING_STAR_TRACKER_MTQ_DEG;
  if (starTracker) return BACKUP_POINTING_STAR_TRACKER_DEG;
  return BACKUP_POINTING_DEG;
}

/** Probabilidad 0-1 de no fallar en la vida nominal, degradada por la radiación de la órbita. */
export function effectiveReliability(c: ComponentDef, radiationFactor: number): number {
  return c.reliability ** (1 + RADIATION_RELIABILITY_K * radiationFactor);
}

/** Factor térmico F (0-2) que multiplica la probabilidad diaria de sobrecalentamiento. */
export function overheatingFactor(thermalMargin: number | null): number {
  if (thermalMargin === null || thermalMargin >= TIGHT_MARGIN) return 0;
  if (!Number.isFinite(thermalMargin)) return OVERHEAT_MAX_FACTOR;
  return clamp((TIGHT_MARGIN - thermalMargin) / TIGHT_MARGIN, 0, OVERHEAT_MAX_FACTOR);
}

/** Probabilidad diaria de que falle alguna pieza: 1 − R_eff^(A / (5 · 365)). */
export function dailyComponentFailureChance(effectiveReliabilities: number[], acceleration: number): number {
  if (acceleration <= 0 || effectiveReliabilities.length === 0) return 0;
  const rSys = effectiveReliabilities.reduce((p, r) => p * r, 1);
  if (rSys <= 0) return 1;
  return 1 - rSys ** (acceleration / (NOMINAL_LIFE_YEARS * DAYS_PER_YEAR));
}

/** Eventos del entorno: idéntico flujo de tiradas que la fase 1 (las semillas documentadas no cambian). */
export function scheduleEnvironmentEvents(a: DesignAnalysis, table: EventTable, rng: Rng): ScheduledEvent[] {
  const s = a.scenario;
  if (!s.eventsEnabled) return [];
  const weights: [EnvironmentEventType, number][] = [
    ['solar-storm', table.environmentWeights['solar-storm']],
    ['debris-avoidance', table.environmentWeights['debris-avoidance']],
  ];
  if (hasWheels(a)) weights.push(['reaction-wheel-failure', table.environmentWeights['reaction-wheel-failure']]);
  const total = weights.reduce((acc, [, w]) => acc + Math.max(0, w), 0);
  const out: ScheduledEvent[] = [];
  if (total <= 0) return out;
  const days = Math.ceil(s.operationDays);
  for (let d = 0; d < days; d++) {
    if (!rng.chance(table.environmentChancePerDay)) continue;
    let pick = rng.next() * total;
    let type: EnvironmentEventType = weights[0]![0];
    for (const [t, w] of weights) {
      if (pick < Math.max(0, w)) {
        type = t;
        break;
      }
      pick -= Math.max(0, w);
    }
    const tSeconds = d * SECONDS_PER_DAY + Math.floor(rng.next() * SECONDS_PER_DAY);
    if (tSeconds < s.operationDays * SECONDS_PER_DAY) out.push({ tSeconds, type });
  }
  return out;
}

/** Eventos de salud de la nave (sobrecalentamiento y falla de componente), flujo derivado de la semilla. */
export function scheduleHealthEvents(a: DesignAnalysis, table: EventTable, seed: number): ScheduledEvent[] {
  const s = a.scenario;
  if (!s.eventsEnabled) return [];
  const rng = createRng(deriveSeed(seed, HEALTH_RNG_SALT));
  const pOverheat = clamp(table.overheatingChancePerDay * overheatingFactor(a.thermalMargin), 0, 1);
  // Piezas que pueden fallar: todas menos la estructura.
  const alive = a.components.map((c, index) => ({ index, rEff: effectiveReliability(c, a.radiationFactor) }))
    .filter((x) => a.components[x.index]!.subsystem !== 'structure');
  const out: ScheduledEvent[] = [];
  const endS = s.operationDays * SECONDS_PER_DAY;
  const days = Math.ceil(s.operationDays);
  for (let d = 0; d < days; d++) {
    // Se consumen SIEMPRE 5 números por día, salga o no el evento: la secuencia es estable.
    const overheat = rng.chance(pOverheat);
    const tOverheat = d * SECONDS_PER_DAY + Math.floor(rng.next() * SECONDS_PER_DAY);
    const pFail = dailyComponentFailureChance(alive.map((x) => x.rEff), table.componentFailureAcceleration);
    const fails = rng.chance(pFail);
    const pickRoll = rng.next();
    const tFail = d * SECONDS_PER_DAY + Math.floor(rng.next() * SECONDS_PER_DAY);
    if (overheat && tOverheat < endS) out.push({ tSeconds: tOverheat, type: 'overheating' });
    if (fails && alive.length > 0 && tFail < endS) {
      const total = alive.reduce((acc, x) => acc + (1 - x.rEff), 0);
      let pick = pickRoll * total;
      let chosen = alive.length - 1;
      for (let i = 0; i < alive.length; i++) {
        const w = 1 - alive[i]!.rEff;
        if (pick < w) {
          chosen = i;
          break;
        }
        pick -= w;
      }
      out.push({ tSeconds: tFail, type: 'component-failure', index: alive[chosen]!.index });
      alive.splice(chosen, 1); // cada pieza falla como mucho una vez
    }
  }
  return out;
}

// ─── Pre-operación ──────────────────────────────────────────────────────────

/** Recursos que pasan a excedidos solo por los ajustes pre-operación. */
function overrunsOf(nominal: DesignAnalysis, adjusted: DesignAnalysis): ResourceId[] {
  const before = budgetsFromAnalysis(nominal).resources;
  const after = budgetsFromAnalysis(adjusted).resources;
  const out: ResourceId[] = [];
  for (const id of ['time', 'budget'] as const) {
    const b = before.find((r) => r.id === id);
    const x = after.find((r) => r.id === id);
    if (x?.status === 'over' && b?.status !== 'over') out.push(id);
  }
  return out;
}

/**
 * Sortea los eventos PRE-OPERACIÓN (retraso de lanzamiento y recorte de presupuesto). Función pura
 * y determinista: el cliente la llama tras el Go y antes del lanzamiento y pasa el resultado a
 * `createMissionSim`/`runMission` (opción `preLaunch`) y a `computeBudgets` (3.er argumento).
 * Sin `eventsEnabled` devuelve un resultado vacío. `seed` por defecto: la del escenario.
 */
export function rollPreLaunchEvents(design: MissionDesign, cat: Catalog = catalog, seed?: number): PreLaunchOutcome {
  const nominal = analyzeDesign(design, cat);
  const s = nominal.scenario;
  const usedSeed = seed ?? s.defaultSeed;
  const table = resolveEventTable(s);
  const rng = createRng(deriveSeed(usedSeed, PRELAUNCH_RNG_SALT));
  // Siempre 4 tiradas, en este orden, para que la secuencia no dependa de lo que salga.
  const delayHit = rng.chance(table.launchDelayChance);
  const delayRoll = rng.int(table.launchDelayMonths.min, table.launchDelayMonths.max);
  const cutHit = rng.chance(table.budgetCutChance);
  const cutRoll = rng.int(table.budgetCutPct.min, table.budgetCutPct.max);

  const delayMonths = s.eventsEnabled && delayHit ? Math.max(0, delayRoll) : 0;
  const budgetCutPct = s.eventsEnabled && cutHit ? clamp(cutRoll, 0, 100) : 0;
  const budgetCutMUSD = round((s.budgetMUSD * budgetCutPct) / 100, 2);
  const adjusted = analyzeDesign(design, cat, { delayMonths, budgetCutMUSD });

  const events: SimEvent[] = [];
  if (delayMonths > 0) {
    events.push({
      type: 'launch-delay',
      tSeconds: 0,
      message: {
        key: 'event.launchDelay',
        params: { months: delayMonths, totalMonths: round(adjusted.scheduleMonths), maxMonths: s.maxDevMonths },
      },
    });
  }
  if (budgetCutPct > 0) {
    events.push({
      type: 'budget-cut',
      tSeconds: 0,
      message: {
        key: 'event.budgetCut',
        params: {
          pct: budgetCutPct,
          cutMUSD: budgetCutMUSD,
          budgetMUSD: round(adjusted.budgetAvailableMUSD, 2),
          totalMUSD: round(adjusted.totalCostMUSD, 2),
        },
      },
    });
  }
  return { seed: usedSeed, delayMonths, budgetCutPct, budgetCutMUSD, events, overruns: overrunsOf(nominal, adjusted) };
}
