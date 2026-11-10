import { describe, expect, it } from 'vitest';
import es from '../../locales/es.json';
import en from '../../locales/en.json';
import {
  catalog, createRun, flattenKeys, formatMessage, HAZARD_KINDS, INCIDENT_KINDS, lookupSimKey, simLocales, SYSTEM_IDS, THROTTLE_IDS,
  type MessageRef, type RunAction,
} from '../index';
import { playRun } from './bot';

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

  it('texto mínimo: ningún mensaje del motor pasa de 90 caracteres', () => {
    for (const locale of ['es', 'en'] as const) {
      for (const key of flattenKeys(es)) expect(lookupSimKey(key, locale)!.length, `${key} (${locale})`).toBeLessThanOrEqual(90);
    }
  });

  it('hay etiquetas para cada sistema, régimen, avería, peligro y nombre del catálogo', () => {
    for (const locale of ['es', 'en'] as const) {
      for (const s of SYSTEM_IDS) {
        expect(lookupSimKey(`system.${s}`, locale), s).toBeDefined();
        expect(lookupSimKey(`systemName.${s}`, locale), s).toBeDefined();
      }
      for (const t of THROTTLE_IDS) expect(lookupSimKey(`throttle.${t}`, locale), t).toBeDefined();
      for (const k of INCIDENT_KINDS) expect(lookupSimKey(`incident.${k}`, locale), k).toBeDefined();
      for (const k of HAZARD_KINDS) expect(lookupSimKey(`hazard.${k}`, locale), k).toBeDefined();
      for (const e of [...catalog.ships, ...catalog.nodeKinds]) expect(lookupSimKey(`catalog.${e.id}`, locale)).toBe(e.name[locale]);
    }
  });

  it('toda MessageRef emitida existe en ambos idiomas, trae sus params y se resuelve del todo', () => {
    const refs: MessageRef[] = [];
    for (let seed = 1; seed <= 80; seed++) {
      refs.push(...playRun(seed, { skill: 'crew', sectors: 4, walkS: seed % 2 ? 3.5 : 7 }).events.map((e) => e.message));
      refs.push(...playRun(seed, { skill: 'idle', sectors: 1 }).events.map((e) => e.message));
    }
    // Rechazos: se prueban acciones fuera de lugar en cada fase.
    const actions: RunAction[] = [
      { type: 'jump', toId: 'nope' }, { type: 'evade' }, { type: 'service' }, { type: 'next-sector' },
      { type: 'toggle-system', systemId: 'reactor', enabled: false }, { type: 'work-incident', incidentId: 999, seconds: 1 },
      { type: 'repair-system', systemId: 'nav', seconds: 1 }, { type: 'set-throttle', throttle: 'warp' as never },
      { type: 'toggle-system', systemId: 'toaster' as never, enabled: true }, { type: 'dance' } as never,
    ];
    const run = createRun({ seed: 3 });
    const tryAll = () => {
      for (const a of actions) {
        const r = run.apply(a);
        if (!r.ok) refs.push(r.reason);
      }
    };
    tryAll();
    run.apply({ type: 'toggle-system', systemId: 'engines', enabled: false });
    tryAll();
    const first = run.state.sector.nodes.find((n) => n.id === run.state.locationId)!.links[0]!;
    let r = run.apply({ type: 'jump', toId: first });
    if (!r.ok) refs.push(r.reason);
    run.apply({ type: 'toggle-system', systemId: 'engines', enabled: true });
    run.apply({ type: 'jump', toId: first });
    tryAll();
    r = run.apply({ type: 'jump', toId: first });
    if (!r.ok) refs.push(r.reason);

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
        expect(text, `${ref.key} (${locale}): ${text}`).not.toMatch(/\{\{|\$t\(|\b(system|systemName|catalog|throttle)\.[A-Za-z]/);
      }
    }
    // El barrido cubre todos los eventos y pérdidas declarados.
    const declared = flattenKeys(es).filter((k) => /^(event|loss)\./.test(k));
    for (const key of declared) expect(keys.has(key), `nunca se emitió ${key}`).toBe(true);
    for (const key of ['reject.noRoute', 'reject.notInTransit', 'reject.notAtGate', 'reject.reactorAlwaysOn', 'reject.noIncident', 'reject.noDamage', 'reject.invalid', 'reject.enginesOff', 'reject.inTransit', 'reject.noWarning']) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});
