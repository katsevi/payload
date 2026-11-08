import { describe, expect, it } from 'vitest';
import componentsJson from '../../catalog/componentes.json';
import orbitsJson from '../../catalog/orbitas.json';
import launchersJson from '../../catalog/lanzadores.json';
import scenariosJson from '../../catalog/escenarios.json';
import { catalog, componentsForScenario, getComponent, getLauncher, getOrbit, getScenario, parseCatalog } from '../index';
import type { SubsystemId } from '../types';

const raw = () => structuredClone({ components: componentsJson, orbits: orbitsJson, launchers: launchersJson, scenarios: scenariosJson });

describe('catálogo', () => {
  it('se valida al importar y tiene el contenido mínimo de la fase 0', () => {
    expect(catalog.components.length).toBeGreaterThanOrEqual(24);
    expect(catalog.components.length).toBeLessThanOrEqual(30);
    const subsystems: SubsystemId[] = ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'];
    for (const s of subsystems) expect(catalog.components.some((c) => c.subsystem === s)).toBe(true);
    expect(catalog.components.some((c) => c.level === 'basic')).toBe(true);
    expect(catalog.components.some((c) => c.level === 'advanced')).toBe(true);
    expect(catalog.components.filter((c) => c.subsystem === 'payload').length).toBeGreaterThanOrEqual(4);
    expect(catalog.orbits.map((o) => o.id).sort()).toEqual(['GEO', 'HEO', 'LEO', 'MEO', 'SSO', 'TLI']);
    expect(catalog.launchers.length).toBeGreaterThanOrEqual(3);
    expect(catalog.launchers.length).toBeLessThanOrEqual(4);
  });

  it('las estructuras declaran masa máxima y puntos de montaje; la cámara térmica consume ~60 W', () => {
    for (const s of catalog.components.filter((c) => c.subsystem === 'structure')) {
      expect(s.maxSupportedMassKg).toBeGreaterThan(s.massKg);
      expect(s.mountSlots).toBeGreaterThan(0);
    }
    expect(getComponent('payload-thermal-camera').powerW).toBe(60);
  });

  it('todo texto es bilingüe y cada entrada tiene su "¿por qué?"', () => {
    for (const c of [...catalog.components, ...catalog.orbits]) {
      for (const t of [c.name, c.description, c.why]) {
        expect(t.es.length).toBeGreaterThan(0);
        expect(t.en.length).toBeGreaterThan(0);
      }
    }
    for (const s of catalog.scenarios) {
      expect(s.briefing.es.length).toBeGreaterThan(50);
      expect(s.briefing.en.length).toBeGreaterThan(50);
    }
  });

  it('los lanzadores tienen nombres ficticios', () => {
    const real = /falcon|electron|soyuz|ariane|atlas|vega|delta|antares|pegasus|starship|glenn|long march|pslv|gslv|h-?ii|neutron|vulcan|proton|angara|kuaizhou|minotaur|firefly|alpha|zenit|titan/i;
    for (const l of catalog.launchers) {
      expect(real.test(l.name.es)).toBe(false);
      expect(real.test(l.name.en)).toBe(false);
    }
  });

  it('el escenario de la fase 1 es observación de la Tierra en órbita baja', () => {
    const s = getScenario('leo-earth-observation');
    expect(s.missionType).toBe('earth-observation');
    expect(s.allowedOrbits.sort()).toEqual(['LEO', 'SSO']);
    expect(s.eventsEnabled).toBe(true);
    expect(s.operationDays).toBeGreaterThanOrEqual(20);
    expect(s.operationDays).toBeLessThanOrEqual(40);
    for (const l of s.allowedLaunchers) expect(() => getLauncher(l)).not.toThrow();
  });

  it('búsquedas: lanzan con id desconocido y componentsForScenario respeta allowedComponents', () => {
    expect(() => getComponent('nope')).toThrow(/nope/);
    expect(() => getScenario('nope')).toThrow(/nope/);
    expect(getOrbit('LEO').perigeeKm).toBeGreaterThan(0);
    expect(componentsForScenario('leo-earth-observation')).toHaveLength(catalog.components.length);
    const custom = parseCatalog({ ...raw(), scenarios: [{ ...scenariosJson[0], allowedComponents: ['obc-basic', 'comms-uhf'] }] });
    expect(componentsForScenario('leo-earth-observation', custom).map((c) => c.id)).toEqual(['comms-uhf', 'obc-basic']);
  });

  it('ids únicos en cada colección', () => {
    for (const list of [catalog.components, catalog.orbits, catalog.launchers, catalog.scenarios]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  describe('parseCatalog da errores legibles', () => {
    it('campo con tipo incorrecto: indica ruta e id', () => {
      const r = raw();
      (r.components[3] as Record<string, unknown>).massKg = -1;
      expect(() => parseCatalog(r)).toThrow(/components\[3\] \(id "structure-smallsat"\)\.massKg/);
    });
    it('atributo obligatorio por subsistema', () => {
      const r = raw();
      delete (r.components.find((c) => c.id === 'battery-small') as Record<string, unknown>).batteryCapacityWh;
      expect(() => parseCatalog(r)).toThrow(/batteryCapacityWh/);
    });
    it('campo desconocido (errata)', () => {
      const r = raw();
      (r.orbits[0] as Record<string, unknown>).perigeKm = 1;
      expect(() => parseCatalog(r)).toThrow(/perigeKm/);
    });
    it('id duplicado', () => {
      const r = raw();
      r.components.push(structuredClone(r.components[0]!));
      expect(() => parseCatalog(r)).toThrow(/duplicado "structure-cubesat-6u"/);
    });
    it('referencia cruzada rota en un escenario', () => {
      const r = raw();
      r.scenarios[0]!.allowedLaunchers = ['launcher-fantasma'];
      expect(() => parseCatalog(r)).toThrow(/launcher-fantasma/);
    });
    it('texto sin traducción', () => {
      const r = raw();
      (r.launchers[0]!.name as Record<string, string>).en = '';
      expect(() => parseCatalog(r)).toThrow(/launchers\[0\].*name\.en/);
    });
  });
});
