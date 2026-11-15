/** Fase 8: funciones puras de la cordura (`sanity.ts`). */
import { describe, expect, it } from 'vitest';
import {
  bandIndex, callRecoveryPct, catalog, cohesionDeltaPctPerS, commsDelayMin, contactWindowOpen, createRun, effectivePsychRules, getPsychRules, psychRoll, sanityBandFor,
  sanityDebuffs, sanityDrainPctPerS, type CrewMember, type DrainContext, type PsychRules,
} from '../index';
import { psychCatalog, psychOffCatalog } from './psychHelpers';

const R: PsychRules = { ...catalog.psych!, enabled: true };
const ctx = (patch: Partial<DrainContext> = {}): DrainContext => ({
  context: 'transit', sectorIndex: 1, radiation: false, sinceNoveltyS: 0, awakeS: 0, mitigation: 1, activeIncidents: 0, lowShipO2: false, stormEva: false, suitCritical: false, ...patch,
});
const crew = (id: number, sanityPct: number, patch: Partial<CrewMember> = {}): CrewMember =>
  ({ id, alive: true, location: 'ship', x: 0, z: 0, sanityPct, sanityBand: 'stable', ...patch }) as CrewMember;

describe('getPsychRules', () => {
  it('con la cordura apagada o sin `psych`, no hay reglas', () => {
    expect(getPsychRules(psychOffCatalog())).toBeNull();
    const raw = JSON.parse(JSON.stringify(catalog));
    delete raw.psych;
    expect(getPsychRules(raw)).toBeNull();
    expect(getPsychRules(psychCatalog())).not.toBeNull();
  });
});

describe('bandas con histéresis', () => {
  it('64.9 → tensa; 69.9 sigue tensa; 70 → estable', () => {
    expect(sanityBandFor(64.9, 'stable', R)).toBe('tense');
    expect(sanityBandFor(69.9, 'tense', R)).toBe('tense');
    expect(sanityBandFor(70, 'tense', R)).toBe('stable');
    expect(sanityBandFor(66, 'stable', R)).toBe('stable');
  });
  it('baja de golpe varias bandas y sube de una en una al superar cada umbral + 5', () => {
    expect(sanityBandFor(5, 'stable', R)).toBe('breakdown');
    expect(sanityBandFor(16.9, 'breakdown', R)).toBe('breakdown');
    expect(sanityBandFor(17, 'breakdown', R)).toBe('critical');
    expect(sanityBandFor(39.9, 'critical', R)).toBe('critical');
    expect(sanityBandFor(40, 'critical', R)).toBe('tense');
    expect(sanityBandFor(100, 'breakdown', R)).toBe('stable');
  });
  it('bandIndex ordena las bandas', () => {
    expect(['stable', 'tense', 'critical', 'breakdown'].map((b) => bandIndex(b as never))).toEqual([0, 1, 2, 3]);
  });
});

describe('drenaje: cada factor aislado', () => {
  const base = sanityDrainPctPerS(ctx(), R);
  it('base por contexto', () => {
    expect(base).toBeCloseTo(R.base.transit, 10);
    expect(sanityDrainPctPerS(ctx({ context: 'eva' }), R)).toBeCloseTo(R.base.eva, 10);
    expect(sanityDrainPctPerS(ctx({ context: 'docked' }), R)).toBeCloseTo(R.base.docked, 10);
  });
  it('distancia: por sector (clásica) o por UA (con diseño)', () => {
    expect(sanityDrainPctPerS(ctx({ sectorIndex: 3 }), R)).toBeCloseTo(base * (1 + 2 * R.distPerSector), 10);
    expect(sanityDrainPctPerS(ctx({ sunDistanceAu: 5.2 }), R)).toBeCloseTo(base * (1 + 4.2 * R.distPerAu), 10);
    expect(sanityDrainPctPerS(ctx({ sunDistanceAu: 0.5 }), R)).toBeCloseTo(base, 10);
  });
  it('monotonía, sueño, radiación y mitigación', () => {
    expect(sanityDrainPctPerS(ctx({ sinceNoveltyS: R.monotonyRampS }), R)).toBeCloseTo(base * (1 + R.monotonyMax), 10);
    expect(sanityDrainPctPerS(ctx({ sinceNoveltyS: 1e9 }), R)).toBeCloseTo(base * (1 + R.monotonyMax), 10);
    expect(sanityDrainPctPerS(ctx({ awakeS: R.awakeGraceS }), R)).toBeCloseTo(base, 10);
    expect(sanityDrainPctPerS(ctx({ awakeS: R.awakeGraceS + R.awakeRampS }), R)).toBeCloseTo(base * (1 + R.sleepPenalty), 10);
    expect(sanityDrainPctPerS(ctx({ radiation: true }), R)).toBeCloseTo(base * R.radiationMult, 10);
    expect(sanityDrainPctPerS(ctx({ mitigation: 0.5 }), R)).toBeCloseTo(base * 0.5, 10);
  });
  it('cohesión baja (< 50) la acelera; alta no cambia nada', () => {
    expect(sanityDrainPctPerS(ctx({ cohesionPct: 80 }), R)).toBeCloseTo(base, 10);
    expect(sanityDrainPctPerS(ctx({ cohesionPct: 0 }), R)).toBeCloseTo(base * (1 + R.cohesion.drainMax), 10);
  });
  it('sumandos del entorno hostil (con tope de averías)', () => {
    const s = R.stressors;
    expect(sanityDrainPctPerS(ctx({ activeIncidents: 2 }), R)).toBeCloseTo(base + 2 * s.perIncident, 10);
    expect(sanityDrainPctPerS(ctx({ activeIncidents: 9 }), R)).toBeCloseTo(base + s.maxIncidents * s.perIncident, 10);
    expect(sanityDrainPctPerS(ctx({ lowShipO2: true }), R)).toBeCloseTo(base + s.lowShipO2, 10);
    expect(sanityDrainPctPerS(ctx({ stormEva: true }), R)).toBeCloseTo(base + s.stormEva, 10);
    expect(sanityDrainPctPerS(ctx({ suitCritical: true }), R)).toBeCloseTo(base + s.suitCritical, 10);
  });
});

describe('llamada a la Tierra', () => {
  it('el retraso es 8.32 min por UA y la recuperación baja con la distancia', () => {
    expect(commsDelayMin(1)).toBeCloseTo(8.32, 10);
    expect(commsDelayMin(0)).toBe(0);
    const near = callRecoveryPct(R, 1, false, 1);
    const far = callRecoveryPct(R, 9.5, false, 1);
    expect(near).toBeCloseTo(12 / (1 + 8.32 / 20), 8);
    expect(far).toBeLessThan(near / 2);
  });
  it('en solitario (queda uno vivo) rinde ×1.5 y el gestor lo multiplica', () => {
    expect(callRecoveryPct(R, 1, true, 1)).toBeCloseTo(callRecoveryPct(R, 1, false, 1) * 1.5, 10);
    expect(callRecoveryPct(R, 1, false, 1.25)).toBeCloseTo(callRecoveryPct(R, 1, false, 1) * 1.25, 10);
  });
});

describe('debuffs por banda', () => {
  it('todo 1 y sin lapsus si no hay reglas o tripulante', () => {
    expect(sanityDebuffs(null, R)).toEqual({ work: 1, evadeDamage: 1, suitO2: 1, jetpack: 1, carry: 1, lapsePerS: 0 });
    expect(sanityDebuffs(crew(1, 5, { sanityBand: 'breakdown' }), null).work).toBe(1);
  });
  it('cada banda aplica su columna', () => {
    const d = (b: CrewMember['sanityBand']) => sanityDebuffs(crew(1, 50, { sanityBand: b }), R);
    expect(d('stable')).toEqual({ work: 1, evadeDamage: 1, suitO2: 1, jetpack: 1, carry: 1, lapsePerS: 0 });
    expect(d('tense').work).toBe(0.9);
    const col = (i: number) => ({ work: R.debuffs.work[i], evadeDamage: R.debuffs.evadeDamage[i], suitO2: R.debuffs.suitO2[i], jetpack: R.debuffs.jetpack[i], carry: R.debuffs.carry[i] });
    expect(d('critical')).toMatchObject(col(2));
    expect(d('breakdown')).toMatchObject(col(3));
    expect(d('breakdown').lapsePerS).toBeGreaterThan(d('critical').lapsePerS);
  });
});

describe('psychRoll', () => {
  it('es estable, está en [0, 1) y depende de semilla, paso y tripulante', () => {
    expect(psychRoll(7, 100, 1)).toBe(psychRoll(7, 100, 1));
    const rolls = new Set<number>();
    for (let step = 0; step < 50; step++) {
      const r = psychRoll(7, step, 1);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      rolls.add(r);
    }
    expect(rolls.size).toBe(50);
    expect(psychRoll(7, 5, 1)).not.toBe(psychRoll(7, 5, 2));
    expect(psychRoll(7, 5, 1)).not.toBe(psychRoll(8, 5, 1));
  });
});

describe('cohesión', () => {
  it('no hay deriva con menos de 2 vivos', () => {
    expect(cohesionDeltaPctPerS([crew(1, 10)], R)).toBe(0);
    expect(cohesionDeltaPctPerS([crew(1, 10), crew(2, 10, { alive: false })], R)).toBe(0);
  });
  it('deriva por desgaste medio y por cada tripulante crítico; dos en EVA cerca suman', () => {
    expect(cohesionDeltaPctPerS([crew(1, 100), crew(2, 100)], R)).toBeCloseTo(0, 10);
    expect(cohesionDeltaPctPerS([crew(1, 50), crew(2, 50)], R)).toBeCloseTo(-0.01, 10);
    expect(cohesionDeltaPctPerS([crew(1, 50), crew(2, 20, { sanityBand: 'critical' })], R)).toBeCloseTo(-0.02 * 0.65 - 0.03, 10);
    const near = [crew(1, 100, { location: 'eva', x: 0 }), crew(2, 100, { location: 'eva', x: 10 })];
    const far = [crew(1, 100, { location: 'eva', x: 0 }), crew(2, 100, { location: 'eva', x: 40 })];
    expect(cohesionDeltaPctPerS(near, R)).toBeCloseTo(R.cohesion.evaNearPctPerS, 10);
    expect(cohesionDeltaPctPerS(far, R)).toBeCloseTo(0, 10);
  });
});

describe('reglas efectivas (mejoras `crew` y módulos)', () => {
  const cat = psychCatalog();
  it('sin mejoras ni diseño devuelve las mismas cifras y no muta la base', () => {
    const before = JSON.stringify(R);
    const e = effectivePsychRules(R, {}, cat);
    expect(e.rest.recoverPctPerS).toBe(R.rest.recoverPctPerS);
    expect(e.drainMult).toBe(1);
    expect(JSON.stringify(R)).toBe(before);
  });
  it('las mejoras se acumulan por nivel', () => {
    expect(effectivePsychRules(R, { 'crew-quarters': 1 }, cat).rest.recoverPctPerS).toBeCloseTo(0.5 * 1.3, 8);
    expect(effectivePsychRules(R, { 'crew-quarters': 2 }, cat).rest.recoverPctPerS).toBeCloseTo(0.5 * 1.6, 8);
    expect(effectivePsychRules(R, { 'leisure-kit': 2 }, cat).monotonyMax).toBeCloseTo(0.6 * 0.25, 8);
    expect(effectivePsychRules(R, { 'circadian-lighting': 2 }, cat).sleepPenalty).toBeCloseTo(0.5 * 0.2, 8);
    const relay = effectivePsychRules(R, { 'comm-relay': 1 }, cat);
    expect(relay.call.cooldownS).toBe(60);
    expect(relay.call.recoverPct).toBeCloseTo(12 * 1.3, 8);
  });
  it('los módulos del diseño (hábitat, huerto) bajan el drenaje', () => {
    const design = { missionId: 'mission-mars-habitability', destinationId: null, moduleIds: ['habitat-cabin', 'greenhouse-pod'], instrumentIds: [], launcherId: null };
    const e = effectivePsychRules(R, {}, cat, design);
    expect(e.drainMult).toBeCloseTo(0.8 * 0.9 * 1.1, 8);
    expect(e.rest.recoverPctPerS).toBeCloseTo(0.5 * 1.2, 8);
  });
});

describe('ventana de contacto', () => {
  it('sin ciencia (partida clásica) siempre está abierta', () => {
    const run = createRun({ seed: 1, catalog: psychCatalog() });
    expect(contactWindowOpen(run.state)).toBe(true);
  });
});
