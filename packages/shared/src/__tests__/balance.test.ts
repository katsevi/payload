/**
 * Balance: el juego tiene que poder ganarse jugando bien y perderse si nadie hace nada.
 * Los umbrales son holgados a propósito (protegen contra regresiones groseras al tocar el
 * catálogo); el informe fino es `pnpm --filter @payload/shared balance`.
 */
import { describe, expect, it } from 'vitest';
import { playRun, type BotOptions, type ExploreStyle } from './bot';

const SEEDS = 60;

function summary(options: BotOptions) {
  let cleared = 0;
  let timeS = 0;
  const reasons = new Set<string>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { state } = playRun(seed, options);
    if (state.stats.sectorsCleared >= (options.sectors ?? 1)) cleared++;
    else if (state.lossReason) reasons.add(state.lossReason);
    timeS += state.stats.timeS;
  }
  return { clearedPct: (cleared / SEEDS) * 100, meanTimeS: timeS / SEEDS, reasons };
}

describe('balance con tripulante simulado', () => {
  it('una tripulación atenta supera casi siempre el primer sector (sirve de aprendizaje)', () => {
    expect(summary({ skill: 'crew', walkS: 7, sectors: 1 }).clearedPct).toBeGreaterThanOrEqual(90);
  });

  it('si nadie atiende las averías, la nave casi nunca llega al portal', () => {
    const idle = summary({ skill: 'idle', sectors: 1 });
    expect(idle.clearedPct).toBeLessThanOrEqual(35);
    expect(idle.reasons.size).toBeGreaterThanOrEqual(1);
  });

  it('la dificultad sube con los sectores: llegar al cuarto no está garantizado', () => {
    const slow = summary({ skill: 'crew', walkS: 7, sectors: 4 });
    expect(slow.clearedPct).toBeGreaterThanOrEqual(10);
    expect(slow.clearedPct).toBeLessThanOrEqual(75);
    // Se puede perder por más de una causa (casco, oxígeno, varada).
    expect(slow.reasons.size).toBeGreaterThanOrEqual(2);
  });

  it('el bot sin exploración nunca aterriza (estos umbrales son de la fase 1)', () => {
    for (let seed = 1; seed <= 10; seed++) expect(playRun(seed, { skill: 'crew', sectors: 2 }).state.stats.landings).toBe(0);
  });

  it('un sector dura unos minutos (partidas cortas e intensas)', () => {
    const one = summary({ skill: 'crew', walkS: 5, sectors: 1 });
    expect(one.meanTimeS).toBeGreaterThan(120);
    expect(one.meanTimeS).toBeLessThan(600);
  });
});

/** Fase 2: salidas a la superficie con el explorador simulado. */
function surfaceSummary(explore: ExploreStyle, returnMarginPct?: number) {
  const seeds = 60;
  let evas = 0;
  let returned = 0;
  let durationS = 0;
  let durationAllS = 0;
  let evaValue = 0;
  let crewLost = 0;
  let landings = 0;
  let hard = 0;
  let score = 0;
  let landed = 0;
  let landValue = 0;
  let takeOffs = 0;
  let o2AtTakeOff = 0;
  let surfaceS = 0;
  let incidents = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = playRun(seed, { skill: 'crew', explore, sectors: 2, walkS: 3.5, returnMarginPct });
    if (r.state.lossReason === 'crew') crewLost++;
    landings += r.state.stats.landings;
    hard += r.state.stats.hardLandings;
    score += r.state.score;
    for (const l of r.landings) {
      landed++;
      landValue += l.value;
      incidents += l.incidents;
      if (l.shipO2AtTakeOffPct === null) continue;
      takeOffs++;
      o2AtTakeOff += l.shipO2AtTakeOffPct;
      surfaceS += l.surfaceS ?? 0;
    }
    for (const e of r.evas) {
      evas++;
      // Sin sesgo de superviviente: la duración media cuenta también las salidas que acaban en muerte.
      durationAllS += e.durationS;
      evaValue += e.value;
      if (!e.returned) continue;
      returned++;
      durationS += e.durationS;
    }
  }
  return {
    evas,
    returnedPct: (returned / evas) * 100,
    meanEvaS: durationS / returned,
    meanEvaAllS: durationAllS / evas,
    valuePerEva: evaValue / evas,
    crewLostPct: (crewLost / seeds) * 100,
    hardPct: (hard / landings) * 100,
    meanScore: score / seeds,
    valuePerLanding: landValue / landed,
    shipO2AtTakeOffPct: o2AtTakeOff / takeOffs,
    surfaceS: surfaceS / takeOffs,
    incidentsPerLanding: incidents / landed,
  };
}

describe('balance de superficie (hito de la fase 2)', () => {
  const prudent = surfaceSummary('prudent');
  const greedy = surfaceSummary('greedy');

  it('el explorador prudente vuelve casi siempre', () => {
    expect(prudent.evas).toBeGreaterThan(200);
    expect(prudent.returnedPct).toBeGreaterThanOrEqual(95);
    expect(prudent.crewLostPct).toBeLessThanOrEqual(10);
    expect(prudent.hardPct).toBeLessThanOrEqual(5);
  });

  it('el codicioso muere en la superficie una fracción apreciable de las partidas, no casi siempre', () => {
    expect(greedy.crewLostPct).toBeGreaterThanOrEqual(20);
    expect(greedy.crewLostPct).toBeLessThanOrEqual(50);
    expect(greedy.returnedPct).toBeLessThan(prudent.returnedPct);
  });

  it('una salida dura 2-3 minutos de media, contando también las que acaban en muerte', () => {
    for (const r of [prudent, greedy]) {
      expect(r.meanEvaAllS).toBeGreaterThanOrEqual(110);
      expect(r.meanEvaAllS).toBeLessThanOrEqual(180);
    }
  });

  it('explorar con cabeza puntúa más que no explorar (sin desplazar el objetivo de avanzar)', () => {
    let crewScore = 0;
    for (let seed = 1; seed <= 60; seed++) crewScore += playRun(seed, { skill: 'crew', sectors: 2, walkS: 3.5 }).state.score;
    crewScore /= 60;
    expect(prudent.meanScore).toBeGreaterThan(crewScore * 1.2);
    expect(prudent.meanScore).toBeLessThan(crewScore * 1.8);
  });

  const safe = surfaceSummary('prudent', 25);
  const risky = surfaceSummary('prudent', 3);

  it('«una veta más»: volver con menos margen de O₂ da más valor por salida a cambio de muertes apreciables', () => {
    expect(risky.valuePerEva).toBeGreaterThan(safe.valuePerEva * 1.15);
    expect(risky.crewLostPct).toBeGreaterThanOrEqual(10);
    expect(safe.crewLostPct).toBeLessThanOrEqual(2);
    expect(risky.returnedPct).toBeLessThan(safe.returnedPct);
  });

  it('«hasta vaciar» con margen amplio no rinde mucho más por aterrizaje que pocas salidas apuradas, y lo paga', () => {
    const thorough = surfaceSummary('thorough');
    expect(thorough.valuePerLanding).toBeLessThanOrEqual(risky.valuePerLanding * 1.3);
    // Coste visible: despega con mucho menos O₂, pasa mucho más tiempo en tierra y sufre más averías.
    expect(thorough.shipO2AtTakeOffPct).toBeLessThan(risky.shipO2AtTakeOffPct - 15);
    expect(thorough.surfaceS).toBeGreaterThan(risky.surfaceS * 1.5);
    expect(thorough.incidentsPerLanding).toBeGreaterThan(risky.incidentsPerLanding);
  });
});
