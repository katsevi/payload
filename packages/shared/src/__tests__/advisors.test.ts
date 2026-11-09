import { describe, expect, it } from 'vitest';
import { adviseByRole, ADVISOR_ROLES, computeBudgets, lookupSimKey, reviewGoNoGo } from '../index';
import type { MissionDesign, RoleAdvice } from '../types';
import { allDesignNames, emptyDesign, loadDesign } from './fixtures';

const advise = (d: MissionDesign): RoleAdvice[] => adviseByRole(d, computeBudgets(d), reviewGoNoGo(d));
const keysOf = (xs: RoleAdvice[], role: RoleAdvice['role']) => xs.filter((x) => x.role === role).map((x) => x.message.key);

describe('adviseByRole', () => {
  it('los cuatro roles hablan siempre, en orden y de más a menos grave', () => {
    const order = { blocker: 0, warning: 1, info: 2 } as const;
    for (const d of [...allDesignNames().map(loadDesign), emptyDesign()]) {
      const out = advise(d);
      for (const role of ADVISOR_ROLES) expect(out.some((x) => x.role === role), role).toBe(true);
      const roleIdx = out.map((x) => ADVISOR_ROLES.indexOf(x.role));
      expect(roleIdx).toEqual([...roleIdx].sort((a, b) => a - b));
      for (const role of ADVISOR_ROLES) {
        const sev = out.filter((x) => x.role === role).map((x) => order[x.severity]);
        expect(sev).toEqual([...sev].sort((a, b) => a - b));
      }
    }
  });

  it('un diseño sano: Go de la directora y "todo bien" en ciencia', () => {
    const out = advise(loadDesign('ok-cubesat-leo'));
    expect(keysOf(out, 'director')).toContain('advisor.director.go');
    expect(keysOf(out, 'science')).toEqual(['advisor.science.ok']);
    expect(out.filter((x) => x.severity === 'blocker')).toEqual([]);
  });

  it('presupuesto excedido → la directora lo bloquea y da el No-Go', () => {
    const out = advise(loadDesign('fail-budget-gold-plated'));
    const budget = out.find((x) => x.message.key === 'advisor.director.over.budget')!;
    expect(budget.severity).toBe('blocker');
    expect(Number(budget.message.params?.overPct)).toBeGreaterThan(0);
    expect(out.find((x) => x.message.key === 'advisor.director.noGo')).toMatchObject({ severity: 'blocker', message: { params: { blockers: 1 } } });
  });

  it('batería que no cubre el eclipse → ingeniería', () => {
    const out = advise(loadDesign('fail-battery-eclipse'));
    expect(out.find((x) => x.message.key === 'advisor.engineering.over.battery')?.severity).toBe('blocker');
  });

  it('riesgo de tormenta y energía justa → avisos de ingeniería', () => {
    const keys = keysOf(advise(loadDesign('warn-power-storm')), 'engineering');
    expect(keys).toEqual(expect.arrayContaining(['advisor.engineering.stormRisk', 'advisor.engineering.tight.power']));
  });

  it('margen térmico justo (7 %) → aviso de ingeniería aunque no se exceda', () => {
    expect(keysOf(advise(loadDesign('ok-microsat-leo-thermal')), 'engineering')).toContain('advisor.engineering.thermalTight');
  });

  it('datos que no se pueden bajar → operaciones (aviso, no bloqueo)', () => {
    const out = advise(loadDesign('fail-data-uhf'));
    const ops = out.filter((x) => x.role === 'operations');
    expect(ops.map((x) => x.message.key)).toEqual(expect.arrayContaining(['advisor.operations.over.comms', 'advisor.operations.downlink']));
    expect(ops.every((x) => x.severity === 'warning')).toBe(true);
  });

  it('resolución insuficiente → ciencia', () => {
    expect(keysOf(advise(loadDesign('warn-sso-low-resolution')), 'science')).toContain('advisor.science.resolution');
  });

  it('diseño vacío: faltan subsistemas e instrumentos', () => {
    const out = advise(emptyDesign());
    expect(out.find((x) => x.message.key === 'advisor.engineering.missing')?.message.params?.count).toBe(5);
    expect(keysOf(out, 'science')).toContain('advisor.science.noPayload');
  });

  it('todas las claves existen en es y en', () => {
    for (const d of [...allDesignNames().map(loadDesign), emptyDesign()]) {
      for (const x of advise(d)) {
        expect(lookupSimKey(x.message.key, 'es'), x.message.key).toBeDefined();
        expect(lookupSimKey(x.message.key, 'en'), x.message.key).toBeDefined();
      }
    }
  });
});
