/**
 * Objetivo actual (`currentObjective`): guía en vuelo derivada solo del `RunState`, igual en solitario y en
 * cooperativo. Misión diseñada (genérica y guiada con `flightSteps`) y partida libre (sector 1 y siguientes).
 */
import { describe, expect, it } from 'vitest';
import es from '../../locales/es.json';
import {
  catalog, createRun, currentObjective, FIXED_STEP_S, flattenKeys, formatMessage, getMissions, getNode, getScienceRules, guidedProgress, lookupSimKey,
  MISSION_STEP_IDS, parseCatalog, simLocales,
  type Catalog, type MessageRef, type ObjectiveView, type Run, type RunState,
} from '../index';
import { referenceDesign } from './missionFixtures';
import { advance, calmScienceCatalog, lunar, targetId, travelTo } from './scienceHelpers';

const LOCALES = ['es', 'en'] as const;
const cubesat = referenceDesign('mission-cubesat-guided');

/** Todas las MessageRef de una vista (título, textos y ayudas). */
function refsOf(view: ObjectiveView): MessageRef[] {
  return [view.title, ...view.steps.flatMap((s) => (s.hint ? [s.text, s.hint] : [s.text]))];
}

const cur = (view: ObjectiveView) => (view.current >= 0 ? view.steps[view.current] : undefined);
const curId = (view: ObjectiveView) => cur(view)?.id;
const clone = (state: RunState): RunState => JSON.parse(JSON.stringify(state)) as RunState;

/** Se recogen aquí todas las vistas de los guiones para el barrido de textos del final. */
const seen: ObjectiveView[] = [];
function obj(state: RunState, cat: Catalog = catalog): ObjectiveView {
  const view = currentObjective(state, cat);
  seen.push(view);
  return view;
}

/** Salta nodo a nodo (sin tocar la terminal) hasta `toId`. */
function hopTo(run: Run, toId: string, onStep?: () => void): void {
  for (let guard = 0; guard < 20 && run.state.locationId !== toId; guard++) {
    const here = getNode(run.state.sector, run.state.locationId)!;
    const to = getNode(run.state.sector, toId)!;
    const next = here.links.map((id) => getNode(run.state.sector, id)!).filter((n) => n.column > here.column && n.column <= to.column)
      .sort((a, b) => (a.id === toId ? -1 : b.id === toId ? 1 : Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y)))[0]
      ?? getNode(run.state.sector, here.links.includes(toId) ? toId : here.links[0]!)!;
    run.apply({ type: 'service' });
    expect(run.apply({ type: 'jump', toId: next.id })).toEqual({ ok: true });
    for (let t = 0; t < 900 && run.state.phase === 'transit'; t += FIXED_STEP_S) {
      run.step(FIXED_STEP_S);
      onStep?.();
    }
  }
}

describe('misión diseñada: el paso actual sigue al estado de la ciencia', () => {
  it('salir → llegar → observar → bajar → volver, con progreso, destino y puesto', () => {
    const cat = calmScienceCatalog();
    const rules = getScienceRules(cat);
    const run = createRun({ seed: 4, design: lunar, catalog: cat });
    let v = obj(run.state, cat);
    expect(v.mode).toBe('mission');
    expect(v.status).toBe('active');
    expect(v.steps.map((s) => s.id)).toEqual([...MISSION_STEP_IDS]);
    expect(curId(v)).toBe('launch');
    expect(v.station).toBe('map');
    expect(v.target?.nodeId).toBe(targetId(run));
    expect(v.target?.bodyId).toBe('luna');
    expect(v.title).toEqual({ key: 'objective.title.mission', params: { mission: lunar.missionId, body: 'luna' } });
    expect(v.steps.filter((s) => s.active)).toHaveLength(1);

    // En cuanto sale el primer salto, el paso 1 está hecho y toca llegar.
    const first = getNode(run.state.sector, run.state.locationId)!.links[0]!;
    if (first !== targetId(run)) {
      expect(run.apply({ type: 'jump', toId: first })).toEqual({ ok: true });
      v = obj(run.state, cat);
      expect(v.steps[0]!.done).toBe(true);
      expect(curId(v)).toBe('reach-target');
      expect(cur(v)!.progress?.unit).toBe('jumps');
      advance(run, 120);
    }
    travelTo(run, targetId(run));
    v = obj(run.state, cat);
    expect(v.steps[1]!.done).toBe(true);
    expect(curId(v)).toBe('observe');

    advance(run, 10);
    v = obj(run.state, cat);
    expect(curId(v)).toBe('observe');
    expect(cur(v)!.progress).toMatchObject({ max: rules.observeMaxS, unit: 's' });
    expect(cur(v)!.progress!.value).toBeGreaterThan(9.5);
    expect(cur(v)!.progress!.value).toBeLessThan(10.5);

    // Sin navegación no se observa: la ayuda manda al panel de energía.
    run.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
    advance(run, FIXED_STEP_S);
    v = obj(run.state, cat);
    expect(cur(v)!.hint?.key).toBe('objective.hint.navOffline');
    expect(v.station).toBe('power');
    run.apply({ type: 'toggle-system', systemId: 'nav', enabled: true });

    advance(run, rules.observeMaxS);
    v = obj(run.state, cat);
    expect(v.steps[2]!.done).toBe(true);
    expect(v.steps[2]!.progress?.value).toBe(rules.observeMaxS);
    if (!run.state.science!.objectiveMet) {
      expect(curId(v)).toBe('downlink');
      expect(['objective.hint.contact', 'objective.hint.nextWindow']).toContain(cur(v)!.hint?.key);
    }
    // El diseño lunar baja ~65 MB por ventana: hacen falta unos 10 min junto a la Luna.
    for (let i = 0; i < 300 && !run.state.science!.objectiveMet; i++) {
      advance(run, 5);
      const d = obj(run.state, cat);
      if (!run.state.science!.objectiveMet) expect(cur(d)!.progress!.value).toBeLessThan(cur(d)!.progress!.max);
    }
    expect(run.state.science!.objectiveMet).toBe(true);
    v = obj(run.state, cat);
    expect(curId(v)).toBe('return');
    expect(v.target?.nodeId).toBe(run.state.sector.goalId);

    travelTo(run, run.state.sector.goalId);
    v = obj(run.state, cat);
    expect(v.status).toBe('complete');
    expect(v.current).toBe(-1);
    expect(v.steps.every((s) => s.done && !s.active)).toBe(true);
    expect(v.awaitingNextSector).toBe(false);
  });

  it('vuelve atrás: con los datos perdidos y la órbita agotada, toca observar otra vez (aterrizando)', () => {
    const cat = calmScienceCatalog();
    const run = createRun({ seed: 4, design: lunar, catalog: cat });
    travelTo(run, targetId(run));
    run.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
    advance(run, 1);
    run.apply({ type: 'toggle-system', systemId: 'nav', enabled: true });
    advance(run, getScienceRules(cat).observeMaxS + 1);
    const base = clone(run.state);
    Object.assign(base.science!, { deliveredScience: 0, objectiveMet: false, storedMb: 10, storedScience: 65 });
    expect(curId(obj(base, cat))).toBe('downlink');

    // Se pierde lo de a bordo (p. ej. memoria llena): el paso actual retrocede a observar.
    const lost = clone(base);
    Object.assign(lost.science!, { storedMb: 0, storedScience: 0, lostMb: 50, lostScience: 30 });
    let v = obj(lost, cat);
    expect(curId(v)).toBe('observe');
    expect(v.steps[2]!.done).toBe(false);
    expect(cur(v)!.hint?.key).toBe('objective.hint.observeSurface');
    expect(v.station).toBe('helm');

    // Ya aterrizó allí: solo quedan otros cuerpos.
    lost.landedIds.push(targetId(run));
    expect(cur(obj(lost, cat))!.hint?.key).toBe('objective.hint.observeOthers');

    // Memoria llena a mitad de observación: primero bajar datos.
    const full = clone(base);
    Object.assign(full.science!, { storedMb: full.science!.capacityMb, storedScience: 5 });
    full.science!.observedS = {};
    v = obj(full, cat);
    expect(curId(v)).toBe('downlink');
    expect(cur(v)!.hint?.key).toBe('objective.hint.storageFull');
    full.science!.storedMb = 0;
    full.science!.storedScience = 0;
    expect(curId(obj(full, cat))).toBe('observe');

    // El destino está en otro tramo (p. ej. Marte en el primero): cruzar la salida de este.
    const elsewhere = clone(run.state);
    elsewhere.science!.targetVisited = false;
    for (const n of elsewhere.sector.nodes) delete n.missionTarget;
    v = obj(elsewhere, cat);
    expect(curId(v)).toBe('reach-target');
    expect(cur(v)!.hint?.key).toBe('objective.hint.targetNextLeg');
    expect(v.target?.nodeId).toBe(elsewhere.sector.goalId);

    // Lejos del destino con observación pendiente: volver a él.
    const away = clone(full);
    away.locationId = away.sector.startId;
    v = obj(away, cat);
    expect(cur(v)!.hint?.key).toBe('objective.hint.backToTarget');
    expect(v.target?.nodeId).toBe(targetId(run));
  });

  it('bajar datos: ayudas según el enlace (tierra, navegación, alcance, ventana)', () => {
    const cat = calmScienceCatalog();
    const run = createRun({ seed: 4, design: lunar, catalog: cat });
    travelTo(run, targetId(run));
    advance(run, getScienceRules(cat).observeMaxS + 1);
    const s = clone(run.state);
    Object.assign(s.science!, { deliveredScience: 0, objectiveMet: false, storedMb: 10, storedScience: 70 });
    const hint = (patch: (x: RunState) => void) => {
      const x = clone(s);
      patch(x);
      const v = obj(x, cat);
      expect(curId(v)).toBe('downlink');
      return { key: cur(v)!.hint?.key, params: cur(v)!.hint?.params, station: v.station };
    };
    expect(hint((x) => { x.phase = 'surface'; })).toMatchObject({ key: 'objective.hint.noLinkGround', station: 'helm' });
    expect(hint((x) => { x.ship.systems.nav.online = false; })).toMatchObject({ key: 'objective.hint.navOffline', station: 'power' });
    expect(hint((x) => { x.science!.inRange = false; }).key).toBe('objective.hint.outOfRange');
    expect(hint((x) => Object.assign(x.science!, { inRange: true, contact: true })).key).toBe('objective.hint.contact');
    expect(hint((x) => Object.assign(x.science!, { inRange: true, contact: false, inWindow: false, windowChangeInS: 12.3 }))).toMatchObject({
      key: 'objective.hint.nextWindow', params: { seconds: 13 },
    });
  });

  it('portal de un tramo intermedio: falta pasar de tramo; partida perdida = fallida', () => {
    const cat = calmScienceCatalog();
    const run = createRun({ seed: 4, design: lunar, catalog: cat });
    // En la salida sin haber pasado por la Luna: el tramo se supera pero la misión sigue.
    const atGate = clone(run.state);
    atGate.phase = 'won';
    atGate.locationId = atGate.sector.goalId;
    atGate.stats.jumps = 4;
    let v = obj(atGate, cat);
    expect(v.awaitingNextSector).toBe(true);
    expect(curId(v)).toBe('reach-target');
    expect(cur(v)!.hint?.key).toBe('objective.hint.nextLeg');
    expect(v.station).toBeUndefined();

    const lost = clone(atGate);
    lost.phase = 'lost';
    lost.lossReason = 'hull';
    v = obj(lost, cat);
    expect(v.status).toBe('failed');
  });

  it('es determinista y no depende de cómo se trocee step()', () => {
    const cat = calmScienceCatalog();
    const a = createRun({ seed: 9, design: lunar, catalog: cat });
    const b = createRun({ seed: 9, design: lunar, catalog: cat });
    travelTo(a, targetId(a));
    travelTo(b, targetId(b));
    advance(a, 30, FIXED_STEP_S);
    advance(b, 30, 1.5);
    expect(a.state.stats.timeS).toBeCloseTo(b.state.stats.timeS, 6);
    expect(currentObjective(a.state, cat)).toEqual(currentObjective(b.state, cat));
  });
});

describe('misión guiada (CubeSat): textos propios en vuelo', () => {
  it('usa flightSteps del catálogo en su orden, con sus claves y sus ayudas', () => {
    const run = createRun({ seed: 4, design: cubesat });
    const v = obj(run.state);
    const flight = getMissions().find((m) => m.id === 'mission-cubesat-guided')!.guided!.flightSteps!;
    expect(v.steps.map((s) => s.id)).toEqual(flight.map((f) => f.check));
    for (const s of v.steps) expect(s.text.key).toBe(`guided.mission-cubesat-guided.${s.id}.text`);
    // Sin ayuda de situación, la del catálogo.
    expect(cur(v)!.hint?.key).toBe('guided.mission-cubesat-guided.launch.hint');
    const observe = v.steps.find((s) => s.id === 'observe')!;
    const cap = getScienceRules().observeMaxS;
    for (const locale of LOCALES) {
      expect(formatMessage(observe.text, locale)).toContain(String(cap));
      expect(formatMessage(v.steps[0]!.text, locale)).toBe(flight[0]!.text[locale]);
    }
  });

  it('la ayuda de situación manda sobre la del catálogo (navegación apagada en la Luna)', () => {
    const run = createRun({ seed: 4, design: cubesat, catalog: calmScienceCatalog() });
    travelTo(run, targetId(run));
    run.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
    const v = obj(run.state);
    expect(curId(v)).toBe('observe');
    expect(cur(v)!.text.key).toBe('guided.mission-cubesat-guided.observe.text');
    expect(cur(v)!.hint?.key).toBe('objective.hint.navOffline');
  });

  it('se puede completar con el diseño de referencia (la Luna en el primer tramo)', () => {
    const cat = calmScienceCatalog();
    const run = createRun({ seed: 4, design: cubesat, catalog: cat });
    expect(run.state.sector.nodes.some((n) => n.missionTarget)).toBe(true);
    travelTo(run, targetId(run));
    advance(run, getScienceRules(cat).observeMaxS + 1);
    for (let i = 0; i < 40 && !run.state.science!.objectiveMet; i++) advance(run, 5);
    expect(run.state.science!.objectiveMet).toBe(true);
    expect(curId(obj(run.state, cat))).toBe('return');
    travelTo(run, run.state.sector.goalId);
    expect(obj(run.state, cat).status).toBe('complete');
  });

  it('es la primera misión de la lista y de la menor dificultad; sus pasos del hangar traen ayuda', () => {
    const missions = getMissions();
    expect(missions[0]!.id).toBe('mission-cubesat-guided');
    expect(missions[0]!.difficulty).toBe(Math.min(...missions.map((m) => m.difficulty)));
    const steps = guidedProgress(cubesat);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.hint?.es && s.hint.en).toBeTruthy();
  });

  it('el catálogo exige que flightSteps cubra cada paso una vez', () => {
    const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
    const g = raw.missions!.find((m) => m.id === 'mission-cubesat-guided')!.guided!;
    g.flightSteps = g.flightSteps!.slice(1);
    expect(() => parseCatalog(raw)).toThrow(/flightSteps/);
    g.flightSteps = [...g.flightSteps, g.flightSteps[0]!];
    expect(() => parseCatalog(raw)).toThrow(/flightSteps/);
  });
});

describe('partida libre', () => {
  it('sector 1: saltar, reparar si hace falta, la estación y la salida', () => {
    const cat = calmScienceCatalog();
    const run = createRun({ seed: 7, catalog: cat });
    let v = obj(run.state, cat);
    expect(v.mode).toBe('free');
    expect(v.title).toEqual({ key: 'objective.title.free', params: { sector: 1 } });
    expect(v.steps.map((s) => s.id)).toEqual(['jump', 'repair', 'station', 'exit']);
    expect(v.steps[1]!.optional).toBe(true);
    expect(curId(v)).toBe('jump');
    expect(v.station).toBe('map');

    // Una avería o una sobrecarga pasan delante.
    const broken = clone(run.state);
    broken.incidents.push({ id: 1, kind: 'fire', systemId: 'engines', ageS: 0, progress: 0 });
    v = obj(broken, cat);
    expect(curId(v)).toBe('repair');
    expect(cur(v)!.text).toEqual({ key: 'objective.step.repairNow', params: { system: 'engines' } });
    expect(v.station).toBe('engines');
    const over = clone(run.state);
    over.ship.overloaded = true;
    v = obj(over, cat);
    expect(curId(v)).toBe('repair');
    expect(cur(v)!.text.key).toBe('objective.step.overload');
    expect(v.station).toBe('power');
    const fixed = clone(run.state);
    fixed.stats.incidentsFixed = 1;
    expect(obj(fixed, cat).steps[1]!.done).toBe(true);

    // Primer salto: hecho; toca la estación de más adelante.
    const first = getNode(run.state.sector, run.state.locationId)!.links[0]!;
    expect(run.apply({ type: 'jump', toId: first })).toEqual({ ok: true });
    expect(obj(run.state, cat).steps[0]!.done).toBe(true);
    advance(run, 200);
    v = obj(run.state, cat);
    expect(curId(v)).toBe('station');
    expect(cur(v)!.hint?.key).toBe('objective.hint.stationAhead');
    const stationId = v.target!.nodeId;
    expect(getNode(run.state.sector, stationId)!.kind).toBe('station');
    hopTo(run, stationId);
    v = obj(run.state, cat);
    expect(curId(v)).toBe('station');
    expect(v.station).toBe('airlock');
    expect(cur(v)!.hint?.key).toBe('objective.hint.station');
    const bought = run.apply({ type: 'buy-supply', supply: 'fuel' });
    if (!bought.ok) run.apply({ type: 'service' });
    v = obj(run.state, cat);
    expect(v.steps[2]!.done).toBe(true);
    expect(curId(v)).toBe('exit');
    expect(v.target?.nodeId).toBe(run.state.sector.goalId);
    expect(cur(v)!.progress?.unit).toBe('jumps');
    expect(cur(v)!.progress!.max).toBe(getNode(run.state.sector, run.state.sector.goalId)!.column);

    hopTo(run, run.state.sector.goalId);
    v = obj(run.state, cat);
    expect(run.state.phase).toBe('won');
    expect(v.awaitingNextSector).toBe(true);
    expect(curId(v)).toBe('exit');
    expect(cur(v)!.done).toBe(true);
    expect(cur(v)!.hint?.key).toBe('objective.hint.nextSector');
    expect(v.status).toBe('active');

    // Sector 2: basta la salida, con su número y su progreso.
    expect(run.apply({ type: 'next-sector' })).toEqual({ ok: true });
    v = obj(run.state, cat);
    expect(v.steps.map((s) => s.id)).toEqual(['exit']);
    expect(v.current).toBe(0);
    expect(cur(v)!.text).toEqual({ key: 'objective.step.exit', params: { sector: 2 } });
    expect(v.title.params).toEqual({ sector: 2 });
    expect(cur(v)!.progress).toMatchObject({ value: 0, unit: 'jumps' });
    expect(v.target?.nodeId).toBe(run.state.sector.goalId);
  });

  it('sin estación por delante, de la primera salto a la salida', () => {
    const run = createRun({ seed: 7 });
    const s = clone(run.state);
    s.stats.jumps = 1;
    for (const n of s.sector.nodes) if (n.kind === 'station' && n.id !== s.sector.startId) n.kind = 'asteroid';
    s.locationId = s.sector.nodes.find((n) => n.column === 1)!.id;
    expect(curId(obj(s))).toBe('exit');
  });
});

describe('cooperativo: el espejo del cliente ve el mismo objetivo que el servidor', () => {
  it('hydrate(snapshot) da la misma vista (con diseño y sin él)', () => {
    for (const design of [lunar, cubesat, undefined]) {
      const server = createRun({ seed: 5, crewSize: 3, roles: ['pilot', 'engineer', 'explorer'], ...(design ? { design } : {}) });
      const first = getNode(server.state.sector, server.state.locationId)!.links[0]!;
      server.apply({ type: 'jump', toId: first });
      advance(server, 20);
      const mirror = createRun({ seed: 5, crewSize: 3, roles: ['pilot', 'engineer', 'explorer'], ...(design ? { design } : {}) });
      mirror.hydrate(server.snapshot());
      expect(currentObjective(mirror.state)).toEqual(currentObjective(server.state));
      // Lo que viaja por red es JSON: la vista sale igual de un estado serializado.
      expect(currentObjective(JSON.parse(JSON.stringify(server.state)) as RunState)).toEqual(currentObjective(server.state));
    }
  });

  it('no añade campos al RunState', () => {
    const run = createRun({ seed: 5, design: lunar });
    const before = JSON.stringify(run.state);
    currentObjective(run.state);
    expect(JSON.stringify(run.state)).toBe(before);
  });
});

describe('textos del objetivo (namespace sim)', () => {
  it('toda MessageRef de los guiones existe en es y en, se resuelve del todo y cabe en una línea', () => {
    expect(seen.length).toBeGreaterThan(20);
    for (const ref of seen.flatMap(refsOf)) {
      for (const locale of LOCALES) {
        expect(lookupSimKey(ref.key, locale), `${ref.key} (${locale})`).toBeDefined();
        const text = formatMessage(ref, locale);
        expect(text, ref.key).not.toMatch(/\{\{|\$t\(|catalog\.|undefined/);
        expect(text.length, `${ref.key} (${locale}): ${text}`).toBeLessThanOrEqual(90);
      }
    }
  });

  it('cada clave objective.* sale en algún guion', () => {
    const used = new Set(seen.flatMap(refsOf).map((r) => r.key));
    const keys = flattenKeys((es as Record<string, unknown>).objective, 'objective');
    expect(keys.length).toBeGreaterThan(30);
    expect(keys.filter((k) => !used.has(k))).toEqual([]);
  });

  it('los textos en vuelo de las misiones guiadas tienen paridad y caben en una línea', () => {
    const esKeys = flattenKeys(simLocales.es.guided, 'guided').sort();
    expect(esKeys).toEqual(flattenKeys(simLocales.en.guided, 'guided').sort());
    expect(esKeys.length).toBeGreaterThanOrEqual(MISSION_STEP_IDS.length);
    for (const key of esKeys) for (const locale of LOCALES) expect(lookupSimKey(key, locale)!.length, key).toBeLessThanOrEqual(90);
  });
});
