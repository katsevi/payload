/**
 * Guía del objetivo (lógica pura de `game/objectiveGuide.ts`) sobre partidas reales del motor: avisos de objetivo
 * nuevo/cumplido, puesto que señalar y su nombre, progreso, salto sugerido y misión recomendada para empezar.
 * Ningún id fijo: la misión guiada se busca por su marca en el catálogo y los diseños salen de los fixtures del motor.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalog, createRun, currentObjective, getMissions, SYSTEM_IDS, type MissionDef, type MissionDesign, type ObjectiveView, type SectorMap } from '@payload/shared';
import {
  defaultExpanded, defaultMissionId, guideStation, memoOf, nextHopToward, objectiveKey, objectiveNotices, progressView, recommendedMissionId, stationLabel,
} from '../game/objectiveGuide';
import { STATIONS } from '../game/layout';
import es from '../locales/es.json';
import { flatten } from '../i18n/flatten';

const FIXTURES_DIR = join(__dirname, '../../../../packages/shared/src/__tests__/fixtures/missions');
const fixtures = readdirSync(FIXTURES_DIR).map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as { missionId: string; valid: { design: MissionDesign }[] });
const missions = getMissions(catalog);
const guided = missions.find((m) => m.guided)!;
const refOf = (missionId: string): MissionDesign => fixtures.find((f) => f.missionId === missionId)!.valid[0]!.design;
const esFlat = flatten(es);

/** Copia de una vista con el paso actual retocado (para simular cambios de ayuda o de progreso). */
function withCurrent(view: ObjectiveView, patch: Partial<ObjectiveView['steps'][number]>): ObjectiveView {
  return { ...view, steps: view.steps.map((s, i) => (i === view.current ? { ...s, ...patch } : s)) };
}

describe('avisos del objetivo', () => {
  it('al zarpar en partida libre: aviso del paso actual (saltar) y puesto = mapa', () => {
    const run = createRun({ seed: 7 });
    const view = currentObjective(run.state, run.catalog);
    expect(view.mode).toBe('free');
    const notices = objectiveNotices(null, view);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'new', step: { id: 'jump' } });
    expect(guideStation(view, run.state.phase)).toBe('map');
  });

  it('al saltar: «hecho» del paso cumplido y aviso del nuevo; en tránsito no se manda al mapa', () => {
    const run = createRun({ seed: 7 });
    const before = currentObjective(run.state, run.catalog);
    const here = run.state.sector.nodes.find((n) => n.id === run.state.locationId)!;
    expect(run.apply({ type: 'jump', toId: here.links[0]! }).ok).toBe(true);
    const after = currentObjective(run.state, run.catalog);
    const notices = objectiveNotices(memoOf(before), after);
    expect(notices[0]).toMatchObject({ kind: 'done', step: { id: 'jump' } });
    expect(notices.some((n) => n.kind === 'new')).toBe(true);
    if (after.station === 'map') expect(guideStation(after, run.state.phase)).toBeNull();
  });

  it('un cambio de ayuda o de progreso (p. ej. la cuenta atrás de la ventana) no es un objetivo nuevo', () => {
    const run = createRun({ seed: 7, design: refOf(guided.id) });
    const view = currentObjective(run.state, run.catalog);
    const memo = memoOf(view);
    expect(objectiveNotices(memo, withCurrent(view, { hint: { key: 'objective.hint.nextWindow', params: { seconds: 12 } } }))).toEqual([]);
    expect(objectiveNotices(memo, withCurrent(view, { progress: { value: 3, max: 10, unit: 's' } }))).toEqual([]);
    // En cambio, otro texto (otra avería, otro paso) sí lo es.
    expect(objectiveNotices(memo, withCurrent(view, { text: { key: 'objective.step.repairNow', params: { system: 'reactor' } } }))[0]).toMatchObject({ kind: 'new' });
  });

  it('con la misión terminada o perdida no se avisa nada (manda la pantalla final)', () => {
    const run = createRun({ seed: 7 });
    const view = currentObjective(run.state, run.catalog);
    expect(objectiveNotices(memoOf(view), { ...view, status: 'failed', current: -1 })).toEqual([]);
    expect(objectiveNotices(null, { ...view, status: 'complete', current: -1 })).toEqual([]);
    expect(guideStation({ ...view, status: 'complete' }, 'docked')).toBeNull();
  });

  it('portal alcanzado: aviso de pasar al siguiente tramo, una sola vez', () => {
    const run = createRun({ seed: 7 });
    const view = currentObjective(run.state, run.catalog);
    const won: ObjectiveView = { ...view, awaitingNextSector: true };
    expect(objectiveNotices(memoOf(view), won)).toContainEqual({ kind: 'next-sector' });
    expect(objectiveNotices(memoOf(won), won)).toEqual([]);
  });

  it('la clave del objetivo cambia con el sector aunque el paso sea el mismo', () => {
    const run = createRun({ seed: 7 });
    const view = currentObjective(run.state, run.catalog);
    expect(objectiveKey({ ...view, title: { key: view.title.key, params: { sector: 2 } } })).not.toBe(objectiveKey(view));
  });
});

describe('misión guiada en vuelo', () => {
  it('usa los textos guiados del motor, apunta al destino y la lista sale desplegada por defecto', () => {
    const run = createRun({ seed: 7, design: refOf(guided.id) });
    const view = currentObjective(run.state, run.catalog);
    expect(view.mode).toBe('mission');
    expect(view.steps.every((s) => s.text.key.startsWith(`guided.${guided.id}.`))).toBe(true);
    expect(defaultExpanded(view, true, true, run.state.sector.index)).toBe(true);
    // Con la guía detallada oculta en los ajustes, solo el objetivo compacto.
    expect(defaultExpanded(view, true, false, run.state.sector.index)).toBe(false);
    // Hay un camino hasta el destino y el primer salto es un enlace de donde está la nave.
    const target = view.target!.nodeId;
    const hop = nextHopToward(run.state.sector, run.state.locationId, target);
    const here = run.state.sector.nodes.find((n) => n.id === run.state.locationId)!;
    expect(here.links).toContain(hop);
  });

  it('una misión no guiada sale compacta; la partida libre, desplegada solo en el sector 1', () => {
    const other = missions.find((m) => !m.guided)!;
    const run = createRun({ seed: 7, design: refOf(other.id) });
    expect(defaultExpanded(currentObjective(run.state, run.catalog), false, true, 1)).toBe(false);
    const free = createRun({ seed: 7 });
    const fv = currentObjective(free.state, free.catalog);
    expect(defaultExpanded(fv, false, true, 1)).toBe(true);
    expect(defaultExpanded(fv, false, true, 2)).toBe(false);
  });
});

describe('puesto y progreso', () => {
  it('cada puesto que puede pedir el objetivo existe en la nave y tiene nombre', () => {
    for (const id of ['helm', 'map', 'power', 'airlock', ...SYSTEM_IDS] as const) {
      expect(STATIONS[id], id).toBeDefined();
      const label = stationLabel(id, false);
      if (label.ns === 'ui') expect(label.key in esFlat, label.key).toBe(true);
      else expect(label.key).toBe(`systemName.${id}`);
    }
    expect(stationLabel('map', true).key).toBe('station.solarMap');
    expect(stationLabel('map', false).key).toBe('station.map');
  });

  it('progreso: fracción acotada y texto por unidad', () => {
    expect(progressView({ value: 7.9, max: 20, unit: 's' })).toEqual({ key: 'objective.progress.s', params: { value: 7, max: 20 }, frac: 7.9 / 20 });
    expect(progressView({ value: 30, max: 20, unit: 'science' }).frac).toBe(1);
    expect(progressView({ value: 2, max: 0, unit: 'jumps' }).frac).toBe(0);
  });
});

describe('salto sugerido', () => {
  const node = (id: string, links: string[]) => ({ id, name: id, kind: 'planet', x: 0, y: 0, column: 0, links, cache: null });
  const sector = { index: 1, hazardMult: 1, startId: 'a', goalId: 'e', nodes: [node('a', ['b', 'c']), node('b', ['a', 'd']), node('c', ['a', 'e']), node('d', ['b', 'e']), node('e', ['c', 'd'])] } as unknown as SectorMap;

  it('primer salto del camino más corto (en saltos)', () => {
    expect(nextHopToward(sector, 'a', 'e')).toBe('c');
    expect(nextHopToward(sector, 'a', 'd')).toBe('b');
    expect(nextHopToward(sector, 'a', 'b')).toBe('b');
  });

  it('sin camino, nodo desconocido o ya allí: null', () => {
    expect(nextHopToward(sector, 'a', 'a')).toBeNull();
    expect(nextHopToward(sector, 'a', 'zz')).toBeNull();
    const island = { ...sector, nodes: [...sector.nodes, node('z', [])] } as unknown as SectorMap;
    expect(nextHopToward(island, 'a', 'z')).toBeNull();
  });
});

describe('misión recomendada para empezar', () => {
  it('es la guiada (por su marca en el catálogo, no por id) y la señalada si no hay elección previa', () => {
    expect(recommendedMissionId(missions)).toBe(guided.id);
    expect(defaultMissionId(missions, null)).toBe(guided.id);
    expect(defaultMissionId(missions, 'no-existe')).toBe(guided.id);
    const other = missions.find((m) => !m.guided)!;
    expect(defaultMissionId(missions, other.id)).toBe(other.id);
  });

  it('sin guiadas, la más fácil; sin misiones, ninguna', () => {
    const plain = missions.filter((m) => !m.guided).map((m, i): MissionDef => ({ ...m, difficulty: i === 2 ? 0 : m.difficulty }));
    expect(recommendedMissionId(plain)).toBe(plain[2]!.id);
    expect(recommendedMissionId([])).toBeNull();
  });
});
