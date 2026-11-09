import { describe, expect, it } from 'vitest';
import { catalog } from '@payload/shared';
import i18n, { tr, tu } from '../i18n';
import es from '../locales/es.json';
import { flatten } from '../i18n/flatten';
import { missionSeed, type LoggedEvent } from '../state/sim';
import { useDesign } from '../state/design';
import { useProgress } from '../state/progress';
import { importantEvents } from '../ui/Huds';

describe('semilla por intento', () => {
  it('defaultSeed + nº de intento; el intento no se repite entre partidas ni al rediseñar', () => {
    const sc = catalog.scenarios[0]!;
    expect(missionSeed(sc.id, 0)).toBe(sc.defaultSeed);
    expect(missionSeed(sc.id, 3)).toBe(sc.defaultSeed + 3);
    useDesign.getState().startScenario(sc.id);
    const first = useDesign.getState().attempt;
    useDesign.getState().nextAttempt();
    expect(useDesign.getState().attempt).toBe(first + 1);
    // Partida nueva (volver al menú y jugar): sigue el contador persistido, no vuelve a 0.
    useDesign.getState().startScenario(sc.id);
    expect(useDesign.getState().attempt).toBe(first + 2);
    expect(useProgress.getState().attempts[sc.id]).toBe(first + 3);
  });
});

describe('ayuda y textos', () => {
  it('existe la clave de ayuda del hangar (fase design) y menciona Q', () => {
    const k = flatten(es);
    expect(k['help.hangar']).toBeTruthy();
    expect(k['help.hangar']).toContain('Q');
  });
  it('los mensajes del motor resuelven nombres del catálogo y unidades', () => {
    const txt = tr({ key: 'event.launchSuccess', params: { launcher: catalog.launchers[0]!.id, orbit: 'LEO' } });
    expect(txt).not.toMatch(/\{\{|catalog\./);
    expect(tu('Mbit/d')).not.toBe('Mbit/d');
    void i18n;
  });
});

describe('registro de eventos', () => {
  it('omite eclipse/contacto y limita a los últimos N', () => {
    const evs: LoggedEvent[] = Array.from({ length: 2000 }, (_, i) => ({
      id: i, tSeconds: i, type: i % 50 === 0 ? 'battery-low' : 'eclipse-enter', message: { key: 'x' },
    }));
    const out = importantEvents(evs, 30);
    expect(out.length).toBe(30);
    expect(out.every((e) => e.type === 'battery-low')).toBe(true);
    expect(out[0]!.id).toBeGreaterThan(out[1]!.id);
  });
});
