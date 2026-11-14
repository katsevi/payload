/**
 * Fase 6 (ADR 0020): diseño compartido en sala y voto Go/No-Go. Ediciones discretas validadas, diferencias entre dos
 * diseños (las calcula el cliente) y recuento del voto (mayoría estricta; empate = No-Go).
 */
import { describe, expect, it } from 'vitest';
import {
  applyDesignEdit, designEditsBetween, MAX_DESIGN_PARTS, missionStartDesign, parseDesignEdit, parseLobbyAction, reviewDesign, voteTally,
  type DesignEdit, type MissionDesign,
} from '../index';
import { referenceDesign } from './missionFixtures';

const mars = referenceDesign('mission-mars-habitability');

/** Aplica una lista de ediciones (ignorando las que no cambian nada). */
const applyAll = (d: MissionDesign, edits: DesignEdit[]): MissionDesign => edits.reduce((acc, e) => applyDesignEdit(acc, e) ?? acc, d);

describe('diseño de partida de la sala', () => {
  it('vacío con el destino si solo hay uno; la guiada trae su nave; misión desconocida = null', () => {
    expect(missionStartDesign('mission-mars-habitability')).toMatchObject({ destinationId: 'mars', moduleIds: [], instrumentIds: [] });
    expect(missionStartDesign('mission-cubesat-guided')!.moduleIds.length).toBeGreaterThan(5);
    expect(missionStartDesign('nope')).toBeNull();
  });
});

describe('ediciones discretas', () => {
  const start = missionStartDesign('mission-mars-habitability')!;

  it('añadir y quitar piezas; estructura y propulsión se sustituyen', () => {
    let d = applyDesignEdit(start, { op: 'add-module', id: 'frame-light' })!;
    d = applyDesignEdit(d, { op: 'add-module', id: 'frame-standard' })!;
    expect(d.moduleIds).toEqual(['frame-standard']);
    d = applyDesignEdit(d, { op: 'add-instrument', id: 'inst-drill' })!;
    expect(applyDesignEdit(d, { op: 'remove-instrument', id: 'inst-drill' })!.instrumentIds).toEqual([]);
    expect(applyDesignEdit(d, { op: 'remove-instrument', id: 'inst-radar' })).toBeNull();
  });

  it('rechaza ids desconocidos, destinos de otra misión, instrumentos CubeSat y pasar del tope', () => {
    expect(applyDesignEdit(start, { op: 'add-module', id: 'warp-drive' })).toBeNull();
    expect(applyDesignEdit(start, { op: 'set-destination', id: 'europa' })).toBeNull();
    expect(applyDesignEdit(start, { op: 'add-instrument', id: 'inst-cubesat-camera' })).toBeNull();
    expect(applyDesignEdit(start, { op: 'set-difficulty', id: 'imposible' })).toBeNull();
    let d = start;
    for (let i = 0; i < MAX_DESIGN_PARTS + 5; i++) d = applyDesignEdit(d, { op: 'add-module', id: 'fuel-tank-module' }) ?? d;
    expect(d.moduleIds.length).toBe(MAX_DESIGN_PARTS);
  });

  it('en la misión guiada la nave no se toca y la carga es la suya', () => {
    const g = missionStartDesign('mission-cubesat-guided')!;
    expect(applyDesignEdit(g, { op: 'remove-module', id: g.moduleIds[0]! })).toBeNull();
    expect(applyDesignEdit(g, { op: 'set-launcher', id: null })).toBeNull();
    expect(applyDesignEdit(g, { op: 'add-instrument', id: 'inst-radar' })).toBeNull();
    const with1 = applyDesignEdit(g, { op: 'add-instrument', id: 'inst-cubesat-magnetometer' })!;
    expect(with1.instrumentIds).toEqual(['inst-cubesat-magnetometer']);
    expect(applyDesignEdit(with1, { op: 'clear' })!.moduleIds).toEqual(g.moduleIds);
  });

  it('nunca lanza con un diseño de una misión desconocida', () => {
    expect(applyDesignEdit({ ...start, missionId: 'nope' }, { op: 'clear' })).toBeNull();
  });
});

describe('de un diseño a otro', () => {
  it('las ediciones calculadas llevan exactamente al diseño de referencia (y a uno vacío)', () => {
    const start = missionStartDesign('mission-mars-habitability')!;
    const edits = designEditsBetween(start, mars);
    const built = applyAll(start, edits);
    expect([...built.moduleIds].sort()).toEqual([...mars.moduleIds].sort());
    expect([...built.instrumentIds].sort()).toEqual([...mars.instrumentIds].sort());
    expect(built.launcherId).toBe(mars.launcherId);
    expect(reviewDesign(built).go).toBe(true);
    expect(designEditsBetween(mars, { ...mars, moduleIds: [], instrumentIds: [] })).toEqual([{ op: 'clear' }]);
    expect(designEditsBetween(mars, mars)).toEqual([]);
  });

  it('dos personas que editan a la vez no se pisan: las dos piezas acaban en el diseño', () => {
    const base = missionStartDesign('mission-mars-habitability')!;
    const a = designEditsBetween(base, { ...base, instrumentIds: ['inst-drill'] });
    const b = designEditsBetween(base, { ...base, moduleIds: ['frame-standard'] });
    const merged = applyAll(base, [...a, ...b]);
    expect(merged.instrumentIds).toEqual(['inst-drill']);
    expect(merged.moduleIds).toEqual(['frame-standard']);
  });
});

describe('mensajes y voto', () => {
  it('valida las ediciones y las acciones de lobby nuevas', () => {
    expect(parseDesignEdit({ op: 'add-module', id: 'frame-light' })).toEqual({ op: 'add-module', id: 'frame-light' });
    expect(parseDesignEdit({ op: 'set-destination', id: null })).toEqual({ op: 'set-destination', id: null });
    expect(parseDesignEdit({ op: 'hack' })).toBeNull();
    expect(parseDesignEdit({ op: 'add-module', id: 7 })).toBeNull();
    expect(parseLobbyAction({ type: 'set-mission', missionId: 'mission-lunar-ice' })).toEqual({ type: 'set-mission', missionId: 'mission-lunar-ice' });
    expect(parseLobbyAction({ type: 'set-mission', missionId: null })).toEqual({ type: 'set-mission', missionId: null });
    expect(parseLobbyAction({ type: 'vote', go: 'yes' })).toBeNull();
    expect(parseLobbyAction({ type: 'edit-design', edit: { op: 'clear' } })).toEqual({ type: 'edit-design', edit: { op: 'clear' } });
  });

  it('mayoría estricta de Go entre los conectados; el empate es No-Go', () => {
    expect(voteTally([true]).passed).toBe(true);
    expect(voteTally([true, false]).passed).toBe(false);
    expect(voteTally([true, true, null]).passed).toBe(true);
    expect(voteTally([true, null, null, false]).passed).toBe(false);
    expect(voteTally([]).passed).toBe(false);
    expect(voteTally([true, false, null])).toEqual({ go: 1, noGo: 1, pending: 1, voters: 3, passed: false });
  });
});
