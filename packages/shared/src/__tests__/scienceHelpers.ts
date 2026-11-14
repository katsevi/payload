/**
 * Guiones de la fase 5 (ciencia) para `science.test.ts` y el barrido de `locales.test.ts`.
 */
import { expect } from 'vitest';
import {
  catalog, createRun, FIXED_STEP_S, getNode, getScienceRules, missionReport, parseCatalog,
  type Catalog, type MessageRef, type Run, type RunEvent, type RunState,
} from '../index';
import { referenceDesign } from './missionFixtures';

export const lunar = referenceDesign('mission-lunar-ice');
export const mars = referenceDesign('mission-mars-habitability');

/** Sin peligros ni desgaste: aísla la mecánica de la ciencia. */
export function calmScienceCatalog(patch?: (raw: Catalog) => void): Catalog {
  const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
  for (const k of raw.nodeKinds) {
    k.hazardPerLy = { impact: 0, short: 0, fire: 0, leak: 0 };
    delete k.cache;
  }
  raw.hazards.wear.chancePerS = 0;
  patch?.(raw);
  return parseCatalog(raw);
}

export function advance(run: Run, seconds: number, chunk = FIXED_STEP_S): RunEvent[] {
  run.takeEvents();
  for (let t = 0; t < seconds - 1e-9; t += chunk) run.step(chunk);
  return run.takeEvents();
}

/** Camino (ids) desde la posición actual hasta `toId` por enlaces hacia delante o del mismo sector (BFS). */
export function pathTo(state: RunState, toId: string): string[] {
  const prev = new Map<string, string>();
  const queue = [state.locationId];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === toId) break;
    for (const next of getNode(state.sector, id)!.links) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, id);
      queue.push(next);
    }
  }
  const path: string[] = [];
  for (let id: string | undefined = toId; id && id !== state.locationId; id = prev.get(id)) path.unshift(id);
  return path;
}

/** Viaja hasta `toId` (salto a salto, esperando a llegar). Devuelve los eventos. */
export function travelTo(run: Run, toId: string): RunEvent[] {
  const events: RunEvent[] = [];
  for (const hop of pathTo(run.state, toId)) {
    // En las estaciones repone combustible (ayuda de emergencia y compra), como haría la tripulación.
    run.apply({ type: 'service' });
    run.apply({ type: 'buy-supply', supply: 'fuel' });
    const r = run.apply({ type: 'jump', toId: hop });
    expect(r, `salto a ${hop}: ${JSON.stringify(r)} ${JSON.stringify({ fuel: run.state.ship.fuel, phase: run.state.phase })}`).toEqual({ ok: true });
    for (let t = 0; t < 900 && run.state.phase === 'transit'; t += FIXED_STEP_S) run.step(FIXED_STEP_S);
    events.push(...run.takeEvents());
  }
  return events;
}

export const targetId = (run: Run) => run.state.sector.nodes.find((n) => n.missionTarget)!.id;

/** Avanza tramo a tramo hasta el que contiene el destino y viaja hasta él. */
export function toTarget(run: Run): RunEvent[] {
  const events: RunEvent[] = [];
  for (let i = 0; i < 8 && !run.state.sector.nodes.some((n) => n.missionTarget); i++) {
    events.push(...travelTo(run, run.state.sector.goalId));
    expect(run.apply({ type: 'next-sector' })).toEqual({ ok: true });
  }
  events.push(...travelTo(run, targetId(run)));
  return events;
}

/** Guion completo de la misión lunar: ir a la Luna, observar, volver a la estación de la Tierra. */
export function lunarMission(cat: Catalog, opts: { observeS?: number; navOff?: boolean } = {}): { run: Run; events: RunEvent[] } {
  const run = createRun({ seed: 4, design: lunar, catalog: cat });
  const events = travelTo(run, targetId(run));
  if (opts.navOff) run.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
  events.push(...advance(run, opts.observeS ?? getScienceRules(cat).observeMaxS + 1));
  if (opts.navOff) run.apply({ type: 'toggle-system', systemId: 'nav', enabled: true });
  events.push(...travelTo(run, run.state.sector.goalId));
  return { run, events };
}

/** Para el barrido de `locales.test.ts`: mensajes de la ciencia (eventos, rechazo e informe) de los guiones de arriba. */
export function scienceScript(): MessageRef[] {
  const refs: MessageRef[] = [];
  const full = calmScienceCatalog((raw) => {
    raw.science!.storageMbPerGb = 2;
    raw.science!.downlinkMbPerMbps = 0.01;
  });
  for (const { run, events } of [lunarMission(calmScienceCatalog()), lunarMission(calmScienceCatalog(), { observeS: 10 }), lunarMission(full)]) {
    refs.push(...events.map((e) => e.message));
    const r = run.apply({ type: 'next-sector' });
    if (!r.ok) refs.push(r.reason);
    const report = missionReport(run.state)!;
    refs.push(report.headline, ...report.links.map((l) => l.message));
  }
  return refs;
}

/** Fase 5 § 6: partida con el diseño lunar y el reactor casi muerto (sobrecarga que cubre la batería hasta agotarla). */
export function overloadedRun(cat: Catalog = calmScienceCatalog(), seed = 4): Run {
  const run = createRun({ seed, design: lunar, catalog: cat });
  run.state.ship.systems.reactor.healthPct = 15;
  return run;
}

/** Catálogo cuyos radiadores no disipan casi nada (sobrecalentamiento seguro). */
export function hotCatalog(): Catalog {
  return calmScienceCatalog((raw) => {
    for (const m of raw.modules ?? []) if (m.heatRejectKw !== undefined) m.heatRejectKw = 1;
  });
}

/** Para el barrido de `locales.test.ts`: sobrecalentamiento y batería agotada. */
export function operationsScript(): MessageRef[] {
  const refs: MessageRef[] = [];
  const a = overloadedRun();
  refs.push(...advance(a, 240).map((e) => e.message));
  const b = createRun({ seed: 4, design: lunar, catalog: hotCatalog() });
  refs.push(...[...b.takeEvents(), ...advance(b, 5)].map((e) => e.message));
  return refs;
}
