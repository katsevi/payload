import { describe, expect, it } from 'vitest';
import { catalog, createRun, type Catalog, type RunState } from '@payload/shared';
import { holdAction, interactionAt, promptFor } from '../game/interaction';
import { BULKHEADS_Z, HULL, STATIONS, USE_RADIUS, distanceToStation, nearestStation, stationIdsFor, zoneAt } from '../game/layout';
import { countermeasures, moraleView, sanityVignette } from '../game/sanityFx';
import { sfxForRunEvent } from '../audio/soundLogic';

const psychCat = (on: boolean): Catalog => ({ ...catalog, psych: { ...catalog.psych!, enabled: on } });

describe('fase 8 · puestos de cordura', () => {
  it('litera y comunicaciones están dentro del casco, lejos de los mamparos y se resuelven en su punto de uso', () => {
    for (const id of ['bunk', 'comms'] as const) {
      const s = STATIONS[id];
      expect(Math.abs(s.x)).toBeLessThan(HULL.halfWidth);
      expect(zoneAt(s.z)).toBe(zoneAt(s.useZ));
      for (const bz of BULKHEADS_Z) expect(Math.abs(s.useZ - bz)).toBeGreaterThan(0.8);
      expect(nearestStation(s.useX, s.useZ, USE_RADIUS, stationIdsFor(true))).toBe(id);
      // Sin cordura no existen: el puesto no se encuentra.
      expect(nearestStation(s.useX, s.useZ)).not.toBe(id);
    }
  });

  it('no estorba a los puestos de siempre', () => {
    for (const id of stationIdsFor(false)) expect(nearestStation(STATIONS[id].useX, STATIONS[id].useZ, USE_RADIUS, stationIdsFor(true)), id).toBe(id);
    expect(distanceToStation('lifeSupport', STATIONS.bunk.useX, STATIONS.bunk.useZ)).toBeGreaterThan(USE_RADIUS);
  });

  it('con la cordura activa la litera y las comunicaciones dan acciones mantenidas; apagada, nada', () => {
    const state: RunState = createRun({ seed: 7, catalog: psychCat(true) }).state;
    const bunk = interactionAt('bunk', state, {}, psychCat(true));
    expect(bunk?.kind).toBe('bunk');
    expect(holdAction(bunk, 0.4)).toMatchObject({ type: 'rest', seconds: 0.4 });
    expect(holdAction(interactionAt('comms', state, {}, psychCat(true)), 0.4)).toMatchObject({ type: 'call-earth' });
    expect(promptFor(bunk, state)?.hold).toBe(true);
    expect(interactionAt('bunk', state, {}, psychCat(false))).toBeNull();
  });
});

describe('fase 8 · efectos visuales', () => {
  const rules = psychCat(true).psych!;
  it('el medidor se ve siempre con la cordura activa (también estable y alta)', () => {
    expect(moraleView({ sanityPct: 90, sanityBand: 'stable' }, rules)).not.toBeNull();
    expect(moraleView({ sanityPct: 80, sanityBand: 'stable' }, rules)?.level).toBe('ok');
    expect(moraleView({ sanityPct: 60, sanityBand: 'tense' }, rules)?.level).toBe('warn');
    expect(moraleView({ sanityPct: 20, sanityBand: 'critical' }, rules)?.level).toBe('bad');
    expect(moraleView({ sanityPct: 20, sanityBand: 'critical' }, null)).toBeNull();
    expect(moraleView({ sanityBand: 'stable' } as never, rules)).toBeNull();
  });
  it('la viñeta crece por banda y «reducir efectos» la apaga', () => {
    const a = (b: 'stable' | 'tense' | 'critical' | 'breakdown') => sanityVignette(b, 1, false).alpha;
    expect(a('stable')).toBe(0);
    expect(a('tense')).toBeGreaterThan(0);
    expect(a('critical')).toBeGreaterThan(a('tense'));
    expect(a('breakdown')).toBeGreaterThan(a('critical'));
    expect(sanityVignette('breakdown', 1, true)).toEqual({ alpha: 0, pulse: false, desaturate: 0 });
    expect(sanityVignette('critical', 0, false).alpha).toBe(0);
  });
  it('contramedidas: 0 se oculta; y los eventos suenan con audio existente', () => {
    expect(countermeasures({})).toBe(0);
    expect(countermeasures({ callsMade: 2, provisionsUsed: 1, restS: 30 })).toBe(4);
    expect(sfxForRunEvent({ type: 'crew-sanity', subtype: 'critical' } as never)).toBe('o2Low');
    expect(sfxForRunEvent({ type: 'earth-call' })).toBe('earthCall');
  });
});
