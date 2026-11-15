import { describe, expect, it } from 'vitest';
import { DPR_LEVELS, dprBounds, MAX_DPR, nextDprLevel } from '../gfx/dprLevels';

describe('resolución adaptativa', () => {
  it('solo baja, a escalones, y se queda en el último', () => {
    expect(DPR_LEVELS[0]).toBe(MAX_DPR);
    for (let i = 1; i < DPR_LEVELS.length; i++) expect(DPR_LEVELS[i]!).toBeLessThan(DPR_LEVELS[i - 1]!);
    expect(DPR_LEVELS.at(-1)).toBe(1);
    expect(nextDprLevel(0)).toBe(1);
    expect(nextDprLevel(DPR_LEVELS.length - 1)).toBe(DPR_LEVELS.length - 1);
  });

  it('a 60 Hz baja por debajo de 50 FPS (antes de 40: se quedaba a 40-55 con tirones)', () => {
    const [low, high] = dprBounds(60);
    expect(low).toBe(50);
    expect(high).toBeLessThanOrEqual(60);
    const [low144] = dprBounds(144);
    expect(low144).toBeGreaterThan(90);
  });
});
