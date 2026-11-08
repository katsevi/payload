import { describe, expect, it } from 'vitest';
import es from '../../locales/es.json';
import en from '../../locales/en.json';
import {
  catalog, computeBudgets, createRng, formatMessage, lookupSimKey, RESOURCE_IDS, reviewGoNoGo, runMission, simLocales,
} from '../index';
import { flattenKeys } from '../messages';
import type { MessageRef, MissionDesign, OrbitId } from '../types';
import { allDesignNames, emptyDesign, loadDesign, SCENARIO_ID } from './fixtures';

/** Diseños aleatorios (incluye órbitas y lanzadores no permitidos) para barrer todas las ramas. */
function randomDesigns(n: number, seed: number): MissionDesign[] {
  const rng = createRng(seed);
  const orbits: (OrbitId | null)[] = [null, 'LEO', 'SSO', 'MEO', 'GEO', 'HEO', 'TLI'];
  const launchers = [null, ...catalog.launchers.map((l) => l.id)];
  const out: MissionDesign[] = [];
  for (let i = 0; i < n; i++) {
    const count = rng.int(0, 14);
    const componentIds = Array.from({ length: count }, () => catalog.components[rng.int(0, catalog.components.length - 1)]!.id);
    if (rng.chance(0.05)) componentIds.push('pieza-inexistente');
    out.push({ scenarioId: SCENARIO_ID, componentIds, orbitId: orbits[rng.int(0, orbits.length - 1)]!, launcherId: launchers[rng.int(0, launchers.length - 1)]! });
  }
  return out;
}

function collectRefs(designs: MissionDesign[], seeds: number[]): MessageRef[] {
  const refs: MessageRef[] = [];
  for (const d of designs) {
    const b = computeBudgets(d);
    refs.push(...b.resources.map((r) => r.why));
    refs.push(...reviewGoNoGo(d).issues.map((i) => i.message));
    for (const seed of seeds) {
      const m = runMission(d, catalog, { seed });
      refs.push(...m.events.map((e) => e.message));
      for (const e of m.report) {
        refs.push(e.message, ...e.causes);
        if (e.suggestion) refs.push(e.suggestion);
      }
    }
  }
  return refs;
}

describe('locales del motor (namespace sim)', () => {
  it('es y en tienen exactamente las mismas claves', () => {
    expect(flattenKeys(es).sort()).toEqual(flattenKeys(en).sort());
    expect(flattenKeys(simLocales.es).sort()).toEqual(flattenKeys(simLocales.en).sort());
  });

  it('cada clave usa los mismos {{params}} en ambos idiomas y ningún texto está vacío', () => {
    const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const key of flattenKeys(es)) {
      const a = lookupSimKey(key, 'es')!;
      const b = lookupSimKey(key, 'en')!;
      expect(a.length, key).toBeGreaterThan(0);
      expect(b.length, key).toBeGreaterThan(0);
      expect(params(a), key).toEqual(params(b));
    }
  });

  it('simLocales incluye el nombre localizado de cada id del catálogo (catalog.<id>)', () => {
    for (const e of [...catalog.components, ...catalog.orbits, ...catalog.launchers]) {
      expect(lookupSimKey(`catalog.${e.id}`, 'es')).toBe(e.name.es);
      expect(lookupSimKey(`catalog.${e.id}`, 'en')).toBe(e.name.en);
    }
  });

  it('hay textos para cada recurso, estado y unidad del panel', () => {
    for (const r of RESOURCE_IDS) expect(lookupSimKey(`resource.${r}`, 'es')).toBeDefined();
    for (const s of ['ok', 'tight', 'over']) expect(lookupSimKey(`status.${s}`, 'en')).toBeDefined();
    const units = new Set(computeBudgets(loadDesign('ok-cubesat-leo')).resources.map((r) => r.unit));
    for (const u of units) expect(lookupSimKey(`unit.${u}`, 'es'), u).toBeDefined();
  });

  it('toda MessageRef emitida existe en ambos idiomas y trae todos sus params', () => {
    const designs = [
      ...allDesignNames().map(loadDesign),
      emptyDesign(),
      { ...emptyDesign(), orbitId: 'LEO' as const },
      { ...emptyDesign(), launcherId: 'launcher-colibri' },
      { ...emptyDesign(), componentIds: ['structure-cubesat-6u', 'payload-hires-camera'] },
      { ...emptyDesign(), componentIds: ['payload-multispectral-basic'], orbitId: 'GEO' as const, launcherId: 'launcher-albatros' },
      ...randomDesigns(150, 99),
    ];
    const refs = collectRefs(designs.slice(0, 40), [1, 2, 3]).concat(collectRefs(designs.slice(40), [7]));
    const keys = new Set<string>();
    for (const ref of refs) {
      keys.add(ref.key);
      for (const locale of ['es', 'en'] as const) {
        const template = lookupSimKey(ref.key, locale);
        expect(template, `${ref.key} (${locale})`).toBeDefined();
        for (const [, p] of template!.matchAll(/\{\{(\w+)\}\}/g)) {
          expect(ref.params && p! in ref.params, `${ref.key}: falta el param "${p}"`).toBe(true);
        }
        const text = formatMessage(ref, locale);
        expect(text, `${ref.key}: quedó un {{param}} o un id sin traducir`).not.toMatch(/\{\{|\$t\(|catalog\.[A-Za-z0-9]/);
      }
    }
    // El barrido debe cubrir buena parte de las claves de mensajes del motor.
    expect(keys.size).toBeGreaterThan(80);
  });
});
