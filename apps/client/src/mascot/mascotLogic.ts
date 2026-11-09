/**
 * Lógica pura de la mascota (sin React): qué disparador corresponde a cada situación del juego.
 * Los diálogos, el nombre y las expresiones salen SIEMPRE de `catalog.mascot` (catalog/mascota.json):
 * cambiar de mascota = cambiar ese JSON, sin tocar este código.
 */
import {
  catalog, mascotTriggerForEvent, mascotTriggersFromBudgets, pickMascotDialogue,
  type BudgetReport, type Catalog, type MascotDef, type MascotDialogue, type MissionPhase, type MissionType, type MissionResult, type SimEvent,
} from '@payload/shared';
import type { PhaseName } from '../app/missionMachine';

/** Mascota del catálogo (null si el catálogo no trae ninguna: el sistema queda inactivo). */
export function mascotDef(cat: Catalog = catalog): MascotDef | null {
  return cat.mascot ?? null;
}

const MISSION_PHASES: ReadonlySet<string> = new Set<MissionPhase>(['briefing', 'design', 'review', 'launch', 'operation', 'report']);

/** `phase:<fase>` para las fases del motor (el menú y el pre-lanzamiento no tienen disparador propio). */
export function phaseTrigger(phase: PhaseName): string | null {
  return MISSION_PHASES.has(phase) ? `phase:${phase}` : null;
}

/** Contexto de la ayuda `help:<contexto>` (tecla H) según la escena visible. */
export const HELP_CONTEXT: Record<PhaseName, string> = {
  menu: 'control-room',
  briefing: 'control-room',
  design: 'hangar',
  review: 'hangar',
  prelaunch: 'control-room',
  launch: 'launch',
  operation: 'orbit',
  report: 'report',
};

/** Disparador del consejo de la mascota para un tipo de misión (`help:<missionType>`), p. ej. en el briefing. */
export const missionHelpTrigger = (missionType: MissionType): string => `help:${missionType}`;

export const helpTrigger = (phase: PhaseName): string => `help:${HELP_CONTEXT[phase]}`;

/**
 * Disparadores de recursos que son NUEVOS respecto a la lista anterior (la mascota solo habla al
 * cambiar: un recurso que entra en rojo o en ámbar, no en cada recálculo).
 */
export function newBudgetTriggers(prev: readonly string[], budgets: BudgetReport | null): { all: string[]; fresh: string[] } {
  const all = budgets ? mascotTriggersFromBudgets(budgets) : [];
  const seen = new Set(prev);
  return { all, fresh: all.filter((t) => !seen.has(t)) };
}

/**
 * Eventos frecuentes (cada órbita): la mascota solo los comenta la PRIMERA vez de cada misión, si el JSON
 * trae diálogo para ellos. Los pre-lanzamiento se comentan en su pantalla, no desde el registro.
 */
export const FREQUENT_EVENTS: ReadonlySet<string> = new Set(['eclipse-enter', 'eclipse-exit', 'contact-start', 'contact-end']);
const PRELAUNCH_EVENTS: ReadonlySet<string> = new Set(['launch-delay', 'budget-cut']);

export function eventTrigger(e: Pick<SimEvent, 'type'>, includePreLaunch = false): string | null {
  if (!includePreLaunch && PRELAUNCH_EVENTS.has(e.type)) return null;
  return mascotTriggerForEvent(e);
}

export function reviewTrigger(go: boolean): string {
  return go ? 'review:go' : 'review:no-go';
}

export function reportTrigger(result: Pick<MissionResult, 'launchSuccess' | 'status'>): string {
  return result.launchSuccess && result.status !== 'failed' ? 'report:success' : 'report:failure';
}

/** Diálogo para el disparador, o null si la mascota no tiene nada que decir (o no hay mascota). */
export function dialogueFor(trigger: string, mascot: MascotDef | null, variant = 0): MascotDialogue | null {
  return mascot ? pickMascotDialogue(trigger, mascot, variant) : null;
}

/** Prioridad: lo grave se muestra aunque haya otro mensaje en pantalla. */
const URGENT: ReadonlySet<string> = new Set([
  'event:launch-failure', 'event:battery-depleted', 'event:component-failure', 'event:overheating',
]);
export function isUrgent(trigger: string): boolean {
  return URGENT.has(trigger) || trigger.startsWith('resource-over:');
}
