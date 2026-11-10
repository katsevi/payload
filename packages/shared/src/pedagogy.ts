/**
 * Contenido pedagógico de la fase 2: mascota guía, Academia y glosario. Funciones puras sobre los
 * datos de catalog/{mascota,academia,glosario}.json (validados en catalog.ts).
 *
 * Disparadores de la mascota (`MascotDialogue.trigger`), forma `<tipo>:<valor>`:
 *   event:<SimEventType>          p. ej. event:battery-low, event:solar-storm, event:launch-delay
 *   resource-over:<ResourceId>    recurso en rojo en el panel (p. ej. resource-over:mass)
 *   resource-tight:<ResourceId>   recurso en ámbar
 *   phase:<MissionPhase>          briefing, design, review, launch, operation, report
 *   academy:<id de paso>          paso de la Academia (p. ej. academy:step-power)
 *   help:<contexto>               ayuda contextual con la tecla H (hangar, control-room, ...)
 *   review:go | review:no-go      resultado del Go/No-Go
 *   report:success | report:failure  desenlace en el informe
 *   team:<valor>                  fase 3, sala multijugador: valor de TEAM_MASCOT_TRIGGERS (constants.ts),
 *                                 p. ej. team:vote-no-go, team:request-open, team:alert
 *   role:<TeamRole>               fase 3: presentación del rol (role:director, role:science, ...)
 */
import { budgetsFromAnalysis } from './budgets';
import { analyzeDesign } from './analysis';
import { catalog } from './catalog';
import { reviewFromAnalysis } from './review';
import type {
  AcademyStep, BudgetReport, Catalog, GlossaryEntry, MascotDef, MascotDialogue, MissionDesign, ResourceId, SimEvent, SubsystemId,
} from './types';

export const MASCOT_TRIGGER_KINDS = [
  'event', 'resource-over', 'resource-tight', 'phase', 'academy', 'help', 'review', 'report', 'team', 'role',
] as const;
export type MascotTriggerKind = (typeof MASCOT_TRIGGER_KINDS)[number];

/**
 * Diálogo de la mascota para un disparador. Determinista: si varios diálogos comparten disparador,
 * devuelve el `variant`-ésimo (módulo el número de coincidencias; el cliente puede pasar un contador
 * o una tirada de createRng). null si la mascota no tiene nada que decir.
 */
export function pickMascotDialogue(trigger: string, mascot: MascotDef, variant = 0): MascotDialogue | null {
  const matches = mascot.dialogues.filter((d) => d.trigger === trigger);
  if (matches.length === 0) return null;
  const i = ((Math.trunc(variant) % matches.length) + matches.length) % matches.length;
  return matches[i]!;
}

/** Disparador de la mascota para un evento del motor: `event:<tipo>`. */
export function mascotTriggerForEvent(event: Pick<SimEvent, 'type'>): string {
  return `event:${event.type}`;
}

/** Disparadores `resource-over:<id>` y `resource-tight:<id>` del panel de recursos (excedidos primero). */
export function mascotTriggersFromBudgets(budgets: BudgetReport): string[] {
  const over = budgets.resources.filter((r) => r.status === 'over').map((r) => `resource-over:${r.id}`);
  const tight = budgets.resources.filter((r) => r.status === 'tight').map((r) => `resource-tight:${r.id}`);
  return [...over, ...tight];
}

// ─── Academia ───────────────────────────────────────────────────────────────

const SUBSYSTEM_IDS: readonly SubsystemId[] = ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'];
const RESOURCE_ID_SET: ReadonlySet<string> = new Set<ResourceId>(['mass', 'power', 'battery', 'budget', 'data', 'comms', 'time', 'lifetime']);

/**
 * ¿Cumple el diseño el objetivo del paso? Función pura y barata (se puede llamar en cada cambio).
 *  - add-component: hay al menos una pieza con ese id, o de ese subsistema si `value` es un
 *    SubsystemId (sin value: cualquier pieza).
 *  - select-orbit / select-launcher: la órbita/lanzador elegido es `value` (sin value: hay alguno).
 *  - resource-ok: el recurso (`value` o, si falta, `step.resource`) no está excedido y es evaluable
 *    (disponible > 0), así un panel vacío no cuenta como "en verde".
 *  - go: el Go/No-Go da Go.
 *  - manual: siempre true; el cliente avanza cuando el jugador pulsa "Siguiente".
 */
export function evaluateAcademyStep(step: AcademyStep, design: MissionDesign, cat: Catalog = catalog): boolean {
  const { type, value } = step.goal;
  switch (type) {
    case 'manual':
      return true;
    case 'add-component': {
      if (value === undefined) return design.componentIds.length > 0;
      if ((SUBSYSTEM_IDS as readonly string[]).includes(value)) {
        const ids = new Set(cat.components.filter((c) => c.subsystem === value).map((c) => c.id));
        return design.componentIds.some((id) => ids.has(id));
      }
      return design.componentIds.includes(value);
    }
    case 'select-orbit':
      return value === undefined ? design.orbitId !== null : design.orbitId === value;
    case 'select-launcher':
      return value === undefined ? design.launcherId !== null : design.launcherId === value;
    case 'resource-ok': {
      const id = value ?? step.resource;
      if (!RESOURCE_ID_SET.has(id)) return false;
      const r = budgetsFromAnalysis(analyzeDesign(design, cat)).resources.find((x) => x.id === id);
      return r !== undefined && r.available > 0 && r.status !== 'over';
    }
    case 'go': {
      const a = analyzeDesign(design, cat);
      return reviewFromAnalysis(a, budgetsFromAnalysis(a)).go;
    }
    default:
      return false;
  }
}

// ─── Glosario ───────────────────────────────────────────────────────────────

/** Entrada del glosario por id, o null si no existe (o el catálogo no trae glosario). */
export function getGlossaryEntry(id: string, cat: Catalog = catalog): GlossaryEntry | null {
  return cat.glossary?.find((g) => g.id === id) ?? null;
}
