/**
 * Balance: el juego tiene que poder ganarse jugando bien y perderse si nadie hace nada.
 * Los umbrales son holgados a propósito (protegen contra regresiones groseras al tocar el
 * catálogo); el informe fino es `pnpm --filter @payload/shared balance`.
 */
import { describe, expect, it } from 'vitest';
import { playRun, type BotOptions } from './bot';

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

  it('un sector dura unos minutos (partidas cortas e intensas)', () => {
    const one = summary({ skill: 'crew', walkS: 5, sectors: 1 });
    expect(one.meanTimeS).toBeGreaterThan(120);
    expect(one.meanTimeS).toBeLessThan(600);
  });
});
