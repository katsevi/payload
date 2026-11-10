// Opciones de creación de la sala: escenario válido (no la Academia), intento y semilla solo en desarrollo/tests.
import { describe, expect, it } from 'vitest';
import { catalog } from '@payload/shared';
import { academyScenarioId, CreateOptionsError, MAX_SEED, parseCreateOptions, seedOptionAllowed } from '../options';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CreateOptionsError);
    return (e as CreateOptionsError).code;
  }
  throw new Error('se esperaba un error');
};

describe('parseCreateOptions', () => {
  it('escenario obligatorio, del catálogo y nunca la Academia', () => {
    expect(code(() => parseCreateOptions(undefined, false))).toBe('invalid-scenario');
    expect(code(() => parseCreateOptions({ scenarioId: 42 }, false))).toBe('invalid-scenario');
    expect(code(() => parseCreateOptions({ scenarioId: 'no-existe' }, false))).toBe('invalid-scenario');
    expect(academyScenarioId()).toBe(catalog.academy?.scenarioId ?? 'academy-cubesat-leo');
    expect(code(() => parseCreateOptions({ scenarioId: academyScenarioId() }, false))).toBe('academy-scenario');
    expect(parseCreateOptions({ scenarioId: 'leo-earth-observation' }, false)).toEqual({
      scenarioId: 'leo-earth-observation', private: false, attempt: 0, seed: null,
    });
  });

  it('intento entero ≥ 0 SOLO con permiso de desarrollo (elegir el intento es elegir la semilla); privada solo con true', () => {
    expect(parseCreateOptions({ scenarioId: 'leo-earth-observation', attempt: 4, private: true }, true)).toMatchObject({ attempt: 4, private: true });
    // En producción el intento se ignora (0), aunque venga mal formado.
    expect(parseCreateOptions({ scenarioId: 'leo-earth-observation', attempt: 4, private: true }, false)).toMatchObject({ attempt: 0, private: true });
    expect(parseCreateOptions({ scenarioId: 'leo-earth-observation', attempt: -1 }, false).attempt).toBe(0);
    expect(parseCreateOptions({ scenarioId: 'leo-earth-observation', private: 'sí' }, false).private).toBe(false);
    for (const attempt of [-1, 1.5, '2', Number.NaN]) {
      expect(code(() => parseCreateOptions({ scenarioId: 'leo-earth-observation', attempt }, true))).toBe('invalid-attempt');
    }
  });

  it('la semilla solo se acepta con permiso (PAYLOAD_ALLOW_SEED=1 o NODE_ENV=test); sin él se ignora', () => {
    expect(parseCreateOptions({ scenarioId: 'leo-earth-observation', seed: 7 }, false).seed).toBeNull();
    expect(parseCreateOptions({ scenarioId: 'leo-earth-observation', seed: 7 }, true).seed).toBe(7);
    expect(code(() => parseCreateOptions({ scenarioId: 'leo-earth-observation', seed: MAX_SEED + 1 }, true))).toBe('invalid-seed');
    expect(code(() => parseCreateOptions({ scenarioId: 'leo-earth-observation', seed: 1.5 }, true))).toBe('invalid-seed');
    expect(seedOptionAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(seedOptionAllowed({ NODE_ENV: 'production', PAYLOAD_ALLOW_SEED: '1' })).toBe(true);
    expect(seedOptionAllowed({ NODE_ENV: 'test' })).toBe(true);
    expect(seedOptionAllowed({})).toBe(false);
  });
});
