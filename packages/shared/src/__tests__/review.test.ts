import { describe, expect, it } from 'vitest';
import { reviewGoNoGo } from '../index';
import type { MissionDesign } from '../types';
import { emptyDesign, loadDesign } from './fixtures';

const codes = (d: MissionDesign, severity?: string) =>
  reviewGoNoGo(d).issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);

describe('reviewGoNoGo', () => {
  it('diseño vacío: No-Go con todos los subsistemas imprescindibles, órbita y lanzador', () => {
    const r = reviewGoNoGo(emptyDesign());
    expect(r.go).toBe(false);
    expect(codes(emptyDesign(), 'blocker')).toEqual(
      expect.arrayContaining(['no-structure', 'no-power', 'no-battery', 'no-comms', 'no-obc', 'no-payload', 'no-orbit', 'no-launcher']),
    );
  });

  it('diseño sano: Go con aviso informativo', () => {
    const r = reviewGoNoGo(loadDesign('ok-cubesat-leo'));
    expect(r.go).toBe(true);
    expect(r.issues).toEqual([{ severity: 'info', code: 'all-clear', message: { key: 'review.allClear' } }]);
  });

  const base = loadDesign('ok-cubesat-leo');
  const cases: [string, MissionDesign, string][] = [
    ['órbita no permitida', { ...base, orbitId: 'GEO', launcherId: 'launcher-condor' }, 'orbit-not-allowed'],
    ['lanzador que no llega', { ...base, orbitId: 'GEO', launcherId: 'launcher-albatros' }, 'launcher-cannot-reach'],
    ['masa vs lanzador', loadDesign('fail-mass-rideshare'), 'mass-launcher'],
    ['masa vs estructura', { ...base, componentIds: ['structure-cubesat-6u', 'payload-hires-camera'] }, 'mass-structure'],
    ['más piezas que puntos de montaje', { ...base, componentIds: [...base.componentIds, 'payload-ais-receiver', 'battery-small'] }, 'mount-slots'],
    ['dos estructuras', { ...base, componentIds: [...base.componentIds, 'structure-microsat'] }, 'multiple-structures'],
    ['presupuesto', loadDesign('fail-budget-gold-plated'), 'budget'],
    ['energía negativa', { ...base, componentIds: base.componentIds.filter((c) => c !== 'power-deployable') }, 'power'],
    ['batería no cubre el eclipse', loadDesign('fail-battery-eclipse'), 'battery'],
    ['calendario', { ...base, componentIds: [...base.componentIds.filter((c) => c !== 'payload-multispectral-basic'), 'payload-hyperspectral'] }, 'time'],
    ['pieza desconocida', { ...base, componentIds: [...base.componentIds, 'nope'] }, 'unknown-component'],
  ];
  it.each(cases)('blocker: %s', (_n, d, code) => {
    expect(reviewGoNoGo(d).go).toBe(false);
    expect(codes(d, 'blocker')).toContain(code);
  });

  const warnCases: [string, MissionDesign, string][] = [
    ['resolución insuficiente', loadDesign('warn-sso-low-resolution'), 'req-resolution'],
    ['datos que no se alcanzan a bajar', loadDesign('fail-data-uhf'), 'req-downlink'],
    ['más datos que capacidad de bajada', loadDesign('fail-data-uhf'), 'comms-capacity'],
    ['margen justo', loadDesign('ok-microsat-sso-hires'), 'tight-budget'],
    ['apuntado insuficiente', { ...loadDesign('ok-microsat-sso-hires'), componentIds: loadDesign('ok-microsat-sso-hires').componentIds.map((c) => (c === 'adcs-star-tracker' ? 'adcs-reaction-wheels' : c)) }, 'pointing'],
    ['calor sin disipar', { ...loadDesign('ok-microsat-leo-thermal'), componentIds: loadDesign('ok-microsat-leo-thermal').componentIds.map((c) => (c === 'thermal-radiator' ? 'thermal-passive' : c)) }, 'thermal'],
    ['ciencia insuficiente', { ...base, componentIds: base.componentIds.map((c) => (c === 'payload-multispectral-basic' ? 'payload-ais-receiver' : c)) }, 'req-science'],
  ];
  it.each(warnCases)('warning: %s', (_n, d, code) => {
    expect(codes(d, 'warning')).toContain(code);
  });

  it('avisa cuando una tormenta solar vaciaría la batería aunque el balance nominal sea positivo', () => {
    // Microsat LEO con cámara térmica y energía casi al límite (margen ~6 %): el eclipse está
    // cubierto, pero 8 h de tormenta (−40 % de sol) dejan un déficit que la batería no aguanta.
    const thermal = loadDesign('ok-microsat-leo-thermal');
    const d: MissionDesign = {
      ...thermal,
      componentIds: [...thermal.componentIds.filter((c) => c !== 'power-high-efficiency'), 'power-high-efficiency', 'power-deployable'],
    };
    const r = reviewGoNoGo(d);
    expect(r.go).toBe(true);
    expect(codes(d, 'warning')).toContain('power-storm');
    expect(codes(loadDesign('ok-microsat-leo-thermal'))).not.toContain('power-storm');
  });

  it('go=false si y solo si hay algún blocker', () => {
    for (const [, d] of [...cases, ...warnCases]) {
      const r = reviewGoNoGo(d);
      expect(r.go).toBe(!r.issues.some((i) => i.severity === 'blocker'));
    }
  });
});
