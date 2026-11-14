/**
 * Fase 5 (ADR 0018 § 7): niveles de dificultad. Cambian presupuesto, plazo y ciencia mínima de la misión (diseño y
 * objetivo) y, en la partida, desgaste, peligros y ventanas de contacto. Sin nivel, el de por defecto (normal = × 1).
 */
import { describe, expect, it } from 'vitest';
import { createRun, getDifficulties, getDifficulty, getMission, guidedProgress, guidedStartDesign, missionAtDifficulty, normalizeDesign, parseMissionDesign, reviewDesign, type MissionDesign } from '../index';
import { referenceDesign } from './missionFixtures';
import { advance, calmScienceCatalog, targetId, travelTo } from './scienceHelpers';

const lunar = referenceDesign('mission-lunar-ice');
const at = (d: MissionDesign, difficultyId: string): MissionDesign => ({ ...d, difficultyId });

describe('niveles', () => {
  it('hay fácil, normal y difícil; sin nivel o con uno desconocido se usa el normal', () => {
    expect(getDifficulties().map((d) => d.id)).toEqual(['difficulty-easy', 'difficulty-normal', 'difficulty-hard']);
    expect(getDifficulty(undefined).id).toBe('difficulty-normal');
    expect(getDifficulty('nope').id).toBe('difficulty-normal');
  });

  it('el normal no cambia la misión; el difícil la aprieta y el fácil la afloja', () => {
    const m = getMission('mission-lunar-ice');
    expect(missionAtDifficulty(m, getDifficulty('difficulty-normal'))).toBe(m);
    const hard = missionAtDifficulty(m, getDifficulty('difficulty-hard'));
    const easy = missionAtDifficulty(m, getDifficulty('difficulty-easy'));
    expect(hard.budgetMUSD).toBeLessThan(m.budgetMUSD);
    expect(hard.requirements.minScience).toBeGreaterThan(m.requirements.minScience);
    expect(easy.deadlineMonths).toBeGreaterThan(m.deadlineMonths);
  });

  it('el diseño lleva su nivel (opcional) y se valida', () => {
    expect(parseMissionDesign(at(lunar, 'difficulty-hard')).difficultyId).toBe('difficulty-hard');
    expect(normalizeDesign(lunar).difficultyId).toBeUndefined();
    expect(normalizeDesign({ ...lunar, difficultyId: 3 }).difficultyId).toBeUndefined();
  });
});

describe('Go/No-Go con dificultad', () => {
  it('el diseño de referencia lunar es Go en fácil y normal, y en difícil le falta ciencia', () => {
    expect(reviewDesign(at(lunar, 'difficulty-easy')).go).toBe(true);
    expect(reviewDesign(lunar).go).toBe(true);
    const hard = reviewDesign(at(lunar, 'difficulty-hard'));
    expect(hard.go).toBe(false);
    expect(hard.issues.some((i) => i.code === 'science')).toBe(true);
  });
});

describe('partida con dificultad', () => {
  it('sin nivel es idéntica a la de nivel normal', () => {
    const a = createRun({ seed: 6, design: lunar });
    const b = createRun({ seed: 6, design: at(lunar, 'difficulty-normal') });
    advance(a, 60);
    advance(b, 60);
    const strip = (s: ReturnType<typeof a.snapshot>) => ({ ...s, missionDesign: undefined });
    expect(strip(a.snapshot())).toEqual(strip(b.snapshot()));
  });

  it('la ciencia pedida sigue al nivel', () => {
    expect(createRun({ seed: 1, design: at(lunar, 'difficulty-easy') }).state.science!.requiredScience).toBe(48);
    expect(createRun({ seed: 1, design: at(lunar, 'difficulty-hard') }).state.science!.requiredScience).toBe(72);
  });

  it('el difícil espera más peligros por salto que el fácil', () => {
    const risk = (id: string) => {
      const run = createRun({ seed: 2, design: at(lunar, id) });
      const here = run.state.sector.nodes.find((n) => n.id === run.state.locationId)!;
      const e = run.estimateJump(here.links[0]!)!;
      return Object.values(e.expectedHazards).reduce((s, x) => s + x, 0);
    };
    expect(risk('difficulty-hard')).toBeGreaterThan(risk('difficulty-normal'));
    expect(risk('difficulty-normal')).toBeGreaterThan(risk('difficulty-easy'));
  });

  it('las ventanas de contacto duran más en fácil que en difícil', () => {
    const open = (id: string) => {
      const run = createRun({ seed: 2, design: at(lunar, id), catalog: calmScienceCatalog() });
      let n = 0;
      for (let i = 0; i < 900; i++) {
        advance(run, 0.2);
        if (run.state.science!.inWindow) n++;
      }
      return n;
    };
    expect(open('difficulty-easy')).toBeGreaterThan(open('difficulty-hard'));
  });
});

describe('misión guiada de CubeSat (ADR 0018 § 8)', () => {
  const guided = referenceDesign('mission-cubesat-guided');

  it('empieza con la nave, el lanzador y el destino fijos y sin carga', () => {
    const start = guidedStartDesign('mission-cubesat-guided')!;
    expect(start.instrumentIds).toEqual([]);
    expect(start.moduleIds).toEqual(getMission('mission-cubesat-guided').guided!.moduleIds);
    expect(guidedStartDesign('mission-lunar-ice')).toBeNull();
    // Sin carga: le falta ciencia, pero la nave fija no se queja.
    const r = reviewDesign(start);
    expect(r.go).toBe(false);
    expect(r.issues.some((i) => i.code.startsWith('guided-'))).toBe(false);
  });

  it('los pasos se marcan solos según el diseño', () => {
    const start = guidedStartDesign('mission-cubesat-guided')!;
    expect(guidedProgress(start).map((s) => s.done)).toEqual([false, false, false, false]);
    expect(guidedProgress(guided).every((s) => s.done)).toBe(true);
    const onlyCamera = { ...start, instrumentIds: ['inst-cubesat-camera'] };
    expect(guidedProgress(onlyCamera).map((s) => s.done)).toEqual([true, false, false, false]);
    expect(guidedProgress(lunar)).toEqual([]);
  });

  it('con el diseño de referencia la misión guiada se cumple jugando', () => {
    const run = createRun({ seed: 4, design: guided, catalog: calmScienceCatalog() });
    expect(run.state.science!.requiredScience).toBe(18);
    travelTo(run, targetId(run));
    advance(run, 50);
    travelTo(run, run.state.sector.goalId);
    expect(run.state.science!.over).toBe(true);
    expect(run.state.science!.objectiveMet).toBe(true);
  });
});
