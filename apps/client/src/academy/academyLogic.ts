/**
 * Lógica pura de la Academia (sin React). Los pasos y el escenario vienen de `catalog.academy`
 * (catalog/academia.json); cada objetivo se comprueba con `evaluateAcademyStep` del motor.
 *
 * Dónde se juega cada paso, según `step.resource`:
 *   'operation' → en la fase de operación · 'report' → en el informe ·
 *   'launch' con objetivo manual → en el lanzamiento (HUD de lanzamiento) ·
 *   el resto → en el hangar (diseño/revisión; el paso 'go' incluido).
 * Integridad: solo cuentan los pasos cumplidos DE VERDAD (`completed`, los registra el panel al avanzar).
 * La revisión Go/No-Go está bloqueada en la Academia hasta llegar al paso 'go' (`academyAllowsReview`)
 * y la Academia solo se da por completada si se cumplieron todos los pasos no manuales (`academyComplete`).
 * Estado de un paso para la fase actual:
 *   todo    objetivo pendiente (hangar)
 *   met     objetivo cumplido: se avanza solo (tras una pausa breve para leer)
 *   manual  objetivo `manual` en su fase: avanza el jugador con «Siguiente»
 *   waiting su fase aún no llegó (p. ej. el paso de operación mientras se diseña)
 *   passed  su fase ya pasó (p. ej. pasos del hangar durante el lanzamiento): se salta sin pausa
 */
import { catalog, evaluateAcademyStep, type AcademyDef, type AcademyStep, type Catalog, type MissionDesign, type ResourceId, RESOURCE_IDS } from '@payload/shared';
import type { PhaseName } from '../app/missionMachine';

/** Id del escenario de la Academia (el único id de escenario que el cliente conoce por nombre). */
export const ACADEMY_SCENARIO_FALLBACK = 'academy-cubesat-leo';

export function academyDef(cat: Catalog = catalog): AcademyDef | null {
  return cat.academy ?? null;
}

export function academyScenarioId(cat: Catalog = catalog): string {
  return cat.academy?.scenarioId ?? ACADEMY_SCENARIO_FALLBACK;
}

export type StepPlace = 'hangar' | 'launch' | 'operation' | 'report';
export type StepState = 'todo' | 'met' | 'manual' | 'waiting' | 'passed';

export function stepPlace(step: AcademyStep): StepPlace {
  if (step.resource === 'operation') return 'operation';
  if (step.resource === 'report') return 'report';
  if (step.resource === 'launch' && step.goal.type === 'manual') return 'launch';
  return 'hangar';
}

const ORDER: Record<PhaseName, number> = { menu: 0, briefing: 1, design: 2, review: 2, prelaunch: 3, launch: 4, operation: 5, report: 6 };
const PLACE_ORDER: Record<StepPlace, number> = { hangar: 2, launch: 4, operation: 5, report: 6 };

export function academyStepState(step: AcademyStep, design: MissionDesign, phase: PhaseName, cat: Catalog = catalog): StepState {
  const place = stepPlace(step);
  const manual = step.goal.type === 'manual';
  // Los pasos manuales del hangar (bienvenida) ya se pueden leer en el briefing.
  const here = phase === 'briefing' && place === 'hangar' && manual ? ORDER.design : ORDER[phase];
  const at = PLACE_ORDER[place];
  if (here < at) return 'waiting';
  if (here > at) return 'passed';
  if (manual) return 'manual';
  return evaluateAcademyStep(step, design, cat) ? 'met' : 'todo';
}

/** Recurso a resaltar en el panel de recursos para el paso (null si el paso no es de un recurso). */
export function stepHighlight(step: AcademyStep | undefined): ResourceId | null {
  if (!step) return null;
  const goalRes = step.goal.type === 'resource-ok' ? step.goal.value : undefined;
  const id = goalRes ?? step.resource;
  return (RESOURCE_IDS as readonly string[]).includes(id) ? (id as ResourceId) : null;
}

/** Salta los pasos cuya fase ya pasó (sin pausa). Devuelve el nuevo índice. */
export function skipPassed(steps: readonly AcademyStep[], index: number, design: MissionDesign, phase: PhaseName, cat: Catalog = catalog): number {
  let i = index;
  while (i < steps.length && academyStepState(steps[i]!, design, phase, cat) === 'passed') i++;
  return i;
}

/** Índice del paso del Go/No-Go (o del primer paso fuera del hangar si no hay paso 'go'). */
export function goStepIndex(steps: readonly AcademyStep[]): number {
  const go = steps.findIndex((s) => s.goal.type === 'go');
  if (go >= 0) return go;
  const out = steps.findIndex((s) => stepPlace(s) !== 'hangar');
  return out >= 0 ? out : steps.length;
}

/** En la Academia solo se puede pedir la revisión al llegar al paso del Go (o después). */
export function academyAllowsReview(steps: readonly AcademyStep[], index: number): boolean {
  return index >= goStepIndex(steps);
}

/** ¿Se cumplieron de verdad todos los pasos no manuales? (requisito para marcar la Academia como completada) */
export function academyComplete(steps: readonly AcademyStep[], completed: ReadonlySet<string>): boolean {
  return steps.every((s) => s.goal.type === 'manual' || completed.has(s.id));
}

/**
 * Paso al que volver tras «Rediseñar» en la Academia: el primer paso no manual del hangar cuyo objetivo
 * no cumple el diseño actual; si todos se cumplen, el paso del Go (para volver a lanzar).
 */
export function redesignIndex(steps: readonly AcademyStep[], design: MissionDesign, cat: Catalog = catalog): number {
  const go = goStepIndex(steps);
  for (let i = 0; i < go; i++) {
    const s = steps[i]!;
    if (stepPlace(s) === 'hangar' && s.goal.type !== 'manual' && !evaluateAcademyStep(s, design, cat)) return i;
  }
  return Math.min(go, steps.length);
}
