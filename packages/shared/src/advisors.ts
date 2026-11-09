/**
 * Asesores por rol en solitario (fase 2). En solitario el juego "interpreta" a los cuatro roles del
 * equipo; cada uno comenta lo que le toca del diseño a partir de los presupuestos y del Go/No-Go:
 *
 *   director     presupuesto y calendario + resumen del Go/No-Go (siempre habla)
 *   engineering  masa, energía, batería, riesgo de tormenta, térmico, montaje, subsistemas
 *   science      instrumentos, resolución, valor científico, revisita, apuntado
 *   operations   datos a bordo, enlace con tierra, vida útil, datos bajados exigidos
 *
 * Severidad: `blocker` si el problema impide el Go (recurso duro excedido o blocker de la
 * revisión), `warning` si es un riesgo (margen justo, aviso de la revisión), `info` si todo va bien.
 * Cada rol devuelve al menos un consejo; dentro de cada rol se ordenan de más a menos grave.
 * Mensajes en `sim:advisor.<rol>.*` (MessageRef, nunca texto final).
 */
import { analyzeDesign, round } from './analysis';
import { TIGHT_MARGIN } from './budgets';
import { catalog } from './catalog';
import { HARD_RESOURCES } from './scoring';
import type {
  AdvisorRole, Catalog, MissionDesign, BudgetReport, GoNoGoResult, IssueSeverity, MessageRef, ResourceBudget, ResourceId, RoleAdvice, ValidationIssue,
} from './types';

export const ADVISOR_ROLES: readonly AdvisorRole[] = ['director', 'engineering', 'science', 'operations'];

/** Recursos de los que habla cada rol. */
export const ROLE_RESOURCES: Record<AdvisorRole, readonly ResourceId[]> = {
  director: ['budget', 'time'],
  engineering: ['mass', 'power', 'battery'],
  science: [],
  operations: ['data', 'comms', 'lifetime'],
};

const SEVERITY_ORDER: Record<IssueSeverity, number> = { blocker: 0, warning: 1, info: 2 };
const MISSING_CODES = new Set(['no-structure', 'no-power', 'no-battery', 'no-comms', 'no-obc']);

const ref = (key: string, params?: MessageRef['params']): MessageRef => (params ? { key, params } : { key });
const num = (issue: ValidationIssue | undefined, name: string): number => {
  const v = issue?.message.params?.[name];
  return typeof v === 'number' ? v : 0;
};
const str = (issue: ValidationIssue | undefined, name: string): string => {
  const v = issue?.message.params?.[name];
  return v === undefined ? '' : String(v);
};

function resourceAdvice(role: AdvisorRole, r: ResourceBudget): RoleAdvice | null {
  if (r.status === 'over') {
    const hard = (HARD_RESOURCES as readonly string[]).includes(r.id);
    return {
      role,
      severity: hard ? 'blocker' : 'warning',
      message: ref(`advisor.${role}.over.${r.id}`, { overPct: round(Math.max(0, -r.margin) * 100, 0) }),
    };
  }
  if (r.status === 'tight') {
    return { role, severity: 'warning', message: ref(`advisor.${role}.tight.${r.id}`, { marginPct: round(r.margin * 100, 0) }) };
  }
  return null;
}

/**
 * Consejos de los cuatro asesores para el diseño actual. Función pura: `budgets` y `review` son los
 * de `computeBudgets(design)` y `reviewGoNoGo(design)` (el cliente ya los tiene calculados).
 * `design` y `cat` se usan para lo que no está en los presupuestos (margen térmico).
 */
export function adviseByRole(design: MissionDesign, budgets: BudgetReport, review: GoNoGoResult, cat: Catalog = catalog): RoleAdvice[] {
  const out: RoleAdvice[] = [];
  const issue = (code: string) => review.issues.find((i) => i.code === code);
  const byRole = (role: AdvisorRole) => {
    for (const id of ROLE_RESOURCES[role]) {
      const r = budgets.resources.find((x) => x.id === id);
      const advice = r ? resourceAdvice(role, r) : null;
      if (advice) out.push(advice);
    }
  };

  // ── Dirección: presupuesto, calendario y resumen del Go/No-Go
  byRole('director');
  const blockers = review.issues.filter((i) => i.severity === 'blocker').length;
  out.push(review.go
    ? { role: 'director', severity: 'info', message: ref('advisor.director.go') }
    : { role: 'director', severity: 'blocker', message: ref('advisor.director.noGo', { blockers }) });

  // ── Ingeniería
  const engStart = out.length;
  const missing = review.issues.filter((i) => MISSING_CODES.has(i.code)).length;
  if (missing > 0) out.push({ role: 'engineering', severity: 'blocker', message: ref('advisor.engineering.missing', { count: missing }) });
  const slots = issue('mount-slots');
  if (slots) {
    out.push({ role: 'engineering', severity: 'blocker', message: ref('advisor.engineering.mountSlots', { used: num(slots, 'used'), slots: num(slots, 'slots') }) });
  }
  byRole('engineering');
  const storm = issue('power-storm');
  if (storm) {
    out.push({
      role: 'engineering', severity: 'warning',
      message: ref('advisor.engineering.stormRisk', { deficitWh: num(storm, 'deficitWh'), usableWh: num(storm, 'usableWh') }),
    });
  }
  const thermal = issue('thermal');
  if (thermal) {
    out.push({
      role: 'engineering', severity: 'warning',
      message: ref('advisor.engineering.thermal', { powerW: num(thermal, 'powerW'), dissipationW: num(thermal, 'dissipationW') }),
    });
  } else {
    const tm = analyzeDesign(design, cat).thermalMargin;
    if (tm !== null && Number.isFinite(tm) && tm >= 0 && tm < TIGHT_MARGIN) {
      out.push({ role: 'engineering', severity: 'warning', message: ref('advisor.engineering.thermalTight', { marginPct: round(tm * 100, 0) }) });
    }
  }
  if (out.length === engStart) out.push({ role: 'engineering', severity: 'info', message: ref('advisor.engineering.ok') });

  // ── Ciencia
  const sciStart = out.length;
  if (issue('no-payload')) out.push({ role: 'science', severity: 'blocker', message: ref('advisor.science.noPayload') });
  const res = issue('req-resolution');
  if (res) out.push({ role: 'science', severity: 'warning', message: ref('advisor.science.resolution', { requiredM: num(res, 'requiredM') }) });
  const sci = issue('req-science');
  if (sci) {
    out.push({ role: 'science', severity: 'warning', message: ref('advisor.science.science', { science: num(sci, 'science'), required: num(sci, 'required') }) });
  }
  const rev = issue('req-revisit');
  if (rev) {
    out.push({ role: 'science', severity: 'warning', message: ref('advisor.science.revisit', { revisitDays: num(rev, 'revisitDays'), maxDays: num(rev, 'maxDays') }) });
  }
  for (const p of review.issues.filter((i) => i.code === 'pointing')) {
    out.push({
      role: 'science', severity: 'warning',
      message: ref('advisor.science.pointing', { component: str(p, 'component'), requiredDeg: num(p, 'requiredDeg') }),
    });
  }
  if (out.length === sciStart) {
    out.push({ role: 'science', severity: 'info', message: ref('advisor.science.ok', { science: round(budgets.totals.scienceValue, 0) }) });
  }

  // ── Operaciones
  const opsStart = out.length;
  byRole('operations');
  const dl = issue('req-downlink');
  if (dl) {
    out.push({
      role: 'operations', severity: 'warning',
      message: ref('advisor.operations.downlink', {
        achievedMbitPerDay: num(dl, 'achievedMbitPerDay'), requiredMbitPerDay: num(dl, 'requiredMbitPerDay'),
      }),
    });
  }
  if (out.length === opsStart) out.push({ role: 'operations', severity: 'info', message: ref('advisor.operations.ok') });

  // Orden estable: por rol y, dentro de cada rol, de más a menos grave.
  return out
    .map((x, i) => ({ x, i }))
    .sort((p, q) =>
      ADVISOR_ROLES.indexOf(p.x.role) - ADVISOR_ROLES.indexOf(q.x.role) ||
      SEVERITY_ORDER[p.x.severity] - SEVERITY_ORDER[q.x.severity] ||
      p.i - q.i)
    .map((p) => p.x);
}
