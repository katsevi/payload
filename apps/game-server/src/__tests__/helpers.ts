// Utilidades de test del servidor: fixtures de diseños del motor, conducción del modelo puro y espera
// de condiciones (para los tests de red, sin esperas fijas).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  catalog, getScenario, ROLE_SUBSYSTEMS, TEAM_LIMITS, TEAM_ROLES,
  type Catalog, type MascotDialogue, type MissionDesign, type ServerNotice, type TeamAction, type TeamRole,
} from '@payload/shared';
import type { Outgoing, RoomModel } from '../roomModel';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..', '..', '..', '..');
export const SCENARIO_FIXTURES_DIR = join(REPO_ROOT, 'packages', 'shared', 'src', '__tests__', 'fixtures', 'scenarios');
export const PROTOTYPE_DESIGNS_DIR = join(REPO_ROOT, 'prototype', 'designs');

export interface FixtureDesign {
  scenarioId: string;
  name: string;
  design: MissionDesign;
}

interface RawFixtureDesign {
  name: string;
  design?: MissionDesign;
  prototype?: string;
}

export function loadPrototypeDesign(name: string): MissionDesign {
  return JSON.parse(readFileSync(join(PROTOTYPE_DESIGNS_DIR, `${name}.json`), 'utf8')) as MissionDesign;
}

/** Diseños `valid` de TODOS los fixtures por escenario (formato en packages/shared/src/__tests__/fixtures.ts). */
export function validFixtureDesigns(): FixtureDesign[] {
  if (!existsSync(SCENARIO_FIXTURES_DIR)) return [];
  const out: FixtureDesign[] = [];
  for (const file of readdirSync(SCENARIO_FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const raw = JSON.parse(readFileSync(join(SCENARIO_FIXTURES_DIR, file), 'utf8')) as { scenarioId: string; valid?: RawFixtureDesign[] };
    for (const d of raw.valid ?? []) {
      const design = d.design ?? (d.prototype ? loadPrototypeDesign(d.prototype) : undefined);
      if (design) out.push({ scenarioId: raw.scenarioId, name: d.name, design });
    }
  }
  return out;
}

/** Catálogo con diálogos de prueba para TODOS los disparadores `team:*` y `role:*` (la mascota real puede no tenerlos aún). */
export function catalogWithTeamDialogues(triggers: readonly string[], base: Catalog = catalog): Catalog {
  const mascot = base.mascot!;
  const extra: MascotDialogue[] = triggers.map((trigger, i) => ({
    id: `test-${i}`,
    trigger,
    expression: mascot.expressions[0]!,
    text: { es: trigger, en: trigger },
  }));
  return { ...base, mascot: { ...mascot, dialogues: [...mascot.dialogues, ...extra] } };
}

/** Reloj de sala para los tests del modelo (segundos, sin derivas de coma flotante). */
export class TestClock {
  private ms = 0;
  get now(): number {
    return this.ms / 1000;
  }
  advance(seconds: number): number {
    this.ms += Math.round(seconds * 1000);
    return this.now;
  }
}

export const rejections = (out: readonly Outgoing[]) =>
  out.filter((o): o is Outgoing & { notice: Extract<ServerNotice, { kind: 'rejected' }> } => o.notice.kind === 'rejected');

/** Aplica una acción y exige que no se rechace. */
export function ok(model: RoomModel, playerId: string, action: TeamAction, nowS: number): Outgoing[] {
  const out = model.apply(playerId, action, nowS);
  expect(rejections(out).map((r) => r.notice.reason), `${playerId} ${action.type}`).toEqual([]);
  return out;
}

/** Aplica una acción y devuelve la clave del rechazo (falla si no se rechaza). */
export function rejectKey(model: RoomModel, playerId: string, action: unknown, nowS: number): string {
  const r = rejections(model.apply(playerId, action, nowS));
  expect(r.length, `se esperaba un rechazo de ${JSON.stringify(action)}`).toBe(1);
  return r[0]!.notice.reason.key;
}

/** Jugador que tiene el rol. */
export function holder(model: RoomModel, role: TeamRole): string {
  const p = model.view.players.find((x) => x.roles.includes(role));
  if (!p) throw new Error(`nadie tiene el rol ${role}`);
  return p.id;
}

/** Rol que monta las piezas de un componente. */
export function roleForComponent(componentId: string, cat: Catalog = catalog): TeamRole {
  const c = cat.components.find((x) => x.id === componentId);
  if (!c) throw new Error(`pieza desconocida ${componentId}`);
  return TEAM_ROLES.find((r) => ROLE_SUBSYSTEMS[r].includes(c.subsystem))!;
}

/** Aprueba todas las solicitudes abiertas (cada una la resuelve quien tiene su rol), incluidas las encadenadas. */
export function approveAll(model: RoomModel, clock: TestClock): number {
  let approved = 0;
  for (let guard = 0; guard < 50; guard++) {
    const open = model.view.requests.find((r) => r.status === 'open');
    if (!open) return approved;
    ok(model, holder(model, open.toRole), { type: 'resolve-request', requestId: open.id, approve: true }, clock.advance(1));
    approved++;
  }
  throw new Error('demasiadas solicitudes encadenadas');
}

/**
 * Construye `design` en la sala con la acción de cada rol (Dirección elige órbita y lanzador; cada pieza
 * la monta su rol) y aprueba las solicitudes que salgan. Exige que el diseño final sea el pedido.
 */
export function buildDesign(model: RoomModel, design: MissionDesign, clock: TestClock): number {
  let approved = 0;
  const steps: TeamAction[] = [
    { type: 'select-orbit', orbitId: design.orbitId },
    { type: 'select-launcher', launcherId: design.launcherId },
    ...design.componentIds.map((componentId): TeamAction => ({ type: 'add-component', componentId })),
  ];
  for (const action of steps) {
    const role: TeamRole = action.type === 'add-component' ? roleForComponent(action.componentId, model.catalog) : 'director';
    ok(model, holder(model, role), action, clock.advance(TEAM_LIMITS.requestMinIntervalS)); // espaciado: se repone una ficha de solicitud por paso
    approved += approveAll(model, clock);
  }
  expect(model.view.design).toEqual({ scenarioId: design.scenarioId, componentIds: design.componentIds, orbitId: design.orbitId, launcherId: design.launcherId });
  return approved;
}

/** Jugadores mínimos para empezar en un escenario (los de equipo, `team.minPlayers`, exigen ≥ 2). */
export function minPlayersFor(scenarioId: string): number {
  return getScenario(scenarioId).team?.minPlayers ?? 1;
}

/** Sala con `n` jugadores (p1..pn) y roles repartidos por el anfitrión, ya en `design`. */
export function roomInDesign(model: RoomModel, n: number, clock: TestClock): string[] {
  const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  ids.forEach((id, i) => expect(model.join(id, `Jugador ${i + 1}`, clock.advance(1))).toEqual({ ok: true }));
  ok(model, 'p1', { type: 'auto-assign-roles' }, clock.advance(1));
  ok(model, 'p1', { type: 'start-mission' }, clock.advance(1));
  ok(model, holder(model, 'director'), { type: 'start-design' }, clock.advance(1));
  expect(model.view.phase).toBe('design');
  return ids;
}

/** Desde `design` con un diseño válido: revisión, 4 votos Go, confirmación y fin de la pantalla de lanzamiento. */
export function launch(model: RoomModel, clock: TestClock): void {
  ok(model, model.view.players[0]!.id, { type: 'request-review' }, clock.advance(1));
  expect(model.view.phase).toBe('review');
  for (const role of TEAM_ROLES) ok(model, holder(model, role), { type: 'vote', role, value: 'go' }, clock.advance(1));
  if (model.view.phase === 'prelaunch') ok(model, holder(model, 'director'), { type: 'confirm-launch' }, clock.advance(1));
  expect(model.view.phase).toBe('launch');
  for (const p of model.view.players.filter((x) => x.connected)) ok(model, p.id, { type: 'launch-done' }, clock.advance(0.5));
  expect(['operation', 'report']).toContain(model.view.phase);
}

/**
 * Avanza la operación con ticks de 1 s a la aceleración dada hasta el informe. Las alertas se responden
 * (todos sus roles) o se dejan vencer según `answerAlerts`.
 */
export function runOperation(model: RoomModel, clock: TestClock, opts: { accel?: number; answerAlerts?: boolean; maxTicks?: number } = {}): void {
  if (model.view.phase !== 'operation') return;
  ok(model, holder(model, 'director'), { type: 'set-time-scale', accel: opts.accel ?? 10000 }, clock.advance(0.1));
  for (let i = 0; i < (opts.maxTicks ?? 100_000) && model.view.phase === 'operation'; i++) {
    const open = model.view.alerts.find((a) => a.closedAtS === null);
    if (open) {
      if (opts.answerAlerts) {
        for (const role of open.requiredRoles) ok(model, holder(model, role), { type: 'ack-alert', alertId: open.id, role }, clock.advance(1));
      } else {
        model.tick(0.1, clock.advance(46));
      }
      continue;
    }
    model.tick(1, clock.advance(1));
  }
  expect(model.view.phase).toBe('report');
}

/** Espera (sondeando) a que se cumpla una condición, con timeout. */
export async function waitFor(cond: () => boolean, what: string, timeoutMs = 10_000, everyMs = 10): Promise<void> {
  const start = Date.now();
  for (;;) {
    let last: unknown = null;
    try {
      if (cond()) return;
    } catch (e) {
      last = e;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando: ${what}${last ? ` (${String(last)})` : ''}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
