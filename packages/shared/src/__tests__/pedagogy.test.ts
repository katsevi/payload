import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import glossaryJson from '../../catalog/glosario.json';
import mascotJson from '../../catalog/mascota.json';
import academyJson from '../../catalog/academia.json';
import componentsJson from '../../catalog/componentes.json';
import orbitsJson from '../../catalog/orbitas.json';
import launchersJson from '../../catalog/lanzadores.json';
import scenariosJson from '../../catalog/escenarios.json';
import {
  catalog, computeBudgets, evaluateAcademyStep, getGlossaryEntry, getScenario, mascotTriggerForEvent, mascotTriggersFromBudgets,
  parseCatalog, pickMascotDialogue, reviewGoNoGo, runMission,
} from '../index';
import { SIM_EVENT_TYPES } from '../catalog';
import type { AcademyStep, MascotDef, MissionDesign, SimEventType } from '../types';
import { loadDesign } from './fixtures';

const raw = () =>
  structuredClone({
    components: componentsJson, orbits: orbitsJson, launchers: launchersJson, scenarios: scenariosJson,
    glossary: glossaryJson, mascot: mascotJson, academy: academyJson,
  });

describe('glosario', () => {
  it('trae las 4 entradas iniciales, bilingües', () => {
    expect(catalog.glossary?.map((g) => g.id)).toEqual(expect.arrayContaining(['orbital-altitude', 'payload', 'data-rate', 'link']));
    for (const g of catalog.glossary!) {
      for (const t of [g.term, g.definition, ...(g.why ? [g.why] : [])]) {
        expect(t.es.length).toBeGreaterThan(0);
        expect(t.en.length).toBeGreaterThan(0);
      }
    }
    expect(getGlossaryEntry('link')?.term.es).toBe('Enlace');
    expect(getGlossaryEntry('nope')).toBeNull();
    expect(getGlossaryEntry('link', { ...catalog, glossary: undefined })).toBeNull();
  });

  it('valida referencias related y ids duplicados', () => {
    const r = raw();
    r.glossary[0]!.related = ['no-existe'];
    expect(() => parseCatalog(r)).toThrow(/related: la entrada "no-existe"/);
    const d = raw();
    d.glossary.push(structuredClone(d.glossary[0]!));
    expect(() => parseCatalog(d)).toThrow(/glossary: id duplicado/);
  });
});

describe('mascota', () => {
  const mascot = catalog.mascot!;

  it('es una mascota original (plan B del GDD), no Rise', () => {
    expect(mascot.id).toBe('orbi');
    const text = readFileSync(join(__dirname, '..', '..', 'catalog', 'mascota.json'), 'utf8');
    expect(text).not.toMatch(/\brise\b/i);
    expect(text).not.toMatch(/artemis|nasa/i);
    expect(mascot.expressions.sort()).toEqual(['celebrating', 'happy', 'thinking', 'worried']);
    expect(mascot.dialogues.length).toBeGreaterThanOrEqual(15);
  });

  it('cubre eventos del motor, recursos en rojo, todas las fases y el informe', () => {
    const triggers = new Set(mascot.dialogues.map((d) => d.trigger));
    for (const t of [
      'event:battery-low', 'event:battery-depleted', 'event:solar-storm', 'event:debris-avoidance', 'event:reaction-wheel-failure',
      'event:overheating', 'event:component-failure', 'event:launch-delay', 'event:budget-cut', 'event:mission-complete',
      'resource-over:mass', 'resource-over:power', 'resource-over:battery', 'resource-over:budget',
      'phase:briefing', 'phase:design', 'phase:review', 'phase:launch', 'phase:operation', 'phase:report',
      'report:success', 'report:failure', 'help:hangar',
    ]) {
      expect(triggers.has(t), t).toBe(true);
    }
  });

  it('los disparadores event:<tipo> aceptan exactamente los SimEventType del contrato', () => {
    // Record<SimEventType, true> obliga (en tsc) a listar todos los tipos: si se añade uno a types.ts
    // sin añadirlo a SIM_EVENT_TYPES, este test falla.
    const all: Record<SimEventType, true> = {
      'launch-success': true, 'launch-failure': true, 'eclipse-enter': true, 'eclipse-exit': true, 'contact-start': true,
      'contact-end': true, 'battery-low': true, 'battery-depleted': true, 'storage-full': true, 'solar-storm': true,
      'reaction-wheel-failure': true, 'debris-avoidance': true, 'component-failure': true, 'mission-complete': true,
      overheating: true, 'launch-delay': true, 'budget-cut': true,
    };
    expect([...SIM_EVENT_TYPES].sort()).toEqual(Object.keys(all).sort());
  });

  it('pickMascotDialogue es determinista y rota variantes', () => {
    expect(pickMascotDialogue('event:battery-low', mascot)?.expression).toBe('worried');
    expect(pickMascotDialogue('event:nada', mascot)).toBeNull();
    const two: MascotDef = {
      ...mascot,
      dialogues: [
        { id: 'a', trigger: 'help:hangar', expression: 'happy', text: { es: 'a', en: 'a' } },
        { id: 'b', trigger: 'help:hangar', expression: 'thinking', text: { es: 'b', en: 'b' } },
      ],
    };
    expect(pickMascotDialogue('help:hangar', two)?.id).toBe('a');
    expect(pickMascotDialogue('help:hangar', two, 1)?.id).toBe('b');
    expect(pickMascotDialogue('help:hangar', two, 2)?.id).toBe('a');
    expect(pickMascotDialogue('help:hangar', two, -1)?.id).toBe('b');
    expect(pickMascotDialogue('help:hangar', two, 1)).toEqual(pickMascotDialogue('help:hangar', two, 1));
  });

  it('disparadores desde eventos y presupuestos', () => {
    expect(mascotTriggerForEvent({ type: 'solar-storm' })).toBe('event:solar-storm');
    const triggers = mascotTriggersFromBudgets(computeBudgets(loadDesign('fail-budget-gold-plated')));
    expect(triggers[0]).toBe('resource-over:budget');
    expect(mascotTriggersFromBudgets(computeBudgets(loadDesign('warn-power-storm')))).toContain('resource-tight:power');
    // Los eventos que emite el motor tienen diálogo (salvo los rutinarios de eclipse/contacto).
    const r = runMission(loadDesign('fail-battery-eclipse'));
    for (const e of r.events) {
      if (/^(eclipse|contact|launch-success|storage-full)/.test(e.type)) continue;
      expect(pickMascotDialogue(mascotTriggerForEvent(e), mascot), e.type).not.toBeNull();
    }
  });

  it('valida disparador, expresión y referencias', () => {
    const bad = (mutate: (m: MascotDef) => void, re: RegExp) => {
      const r = raw();
      mutate(r.mascot as MascotDef);
      expect(() => parseCatalog(r)).toThrow(re);
    };
    bad((m) => { m.dialogues[0]!.trigger = 'cuando-sea'; }, /disparador inválido/);
    bad((m) => { m.dialogues[0]!.trigger = 'event:volcan'; }, /tipo de evento "volcan"/);
    bad((m) => { m.dialogues[0]!.trigger = 'resource-over:oro'; }, /recurso "oro"/);
    bad((m) => { m.dialogues[0]!.trigger = 'academy:step-nope'; }, /paso de la Academia "step-nope"/);
    bad((m) => { m.expressions = ['happy']; }, /no está en mascot.expressions/);
    bad((m) => { (m.dialogues[0] as { expression: string }).expression = 'angry'; }, /expression/);
  });
});

describe('Academia', () => {
  const academy = catalog.academy!;
  const scenario = getScenario(academy.scenarioId);
  const goodDesign: MissionDesign = {
    scenarioId: 'academy-cubesat-leo',
    componentIds: ['structure-cubesat-12u', 'payload-multispectral-basic', 'obc-basic', 'comms-s-band', 'adcs-magnetorquers', 'thermal-passive', 'battery-medium', 'power-deployable', 'power-body-mounted'],
    orbitId: 'LEO',
    launcherId: 'launcher-albatros',
  };

  it('usa el escenario academy-cubesat-leo: básico, sin eventos y holgado', () => {
    expect(scenario.id).toBe('academy-cubesat-leo');
    expect(scenario.difficulty).toBe('basic');
    expect(scenario.eventsEnabled).toBe(false);
    expect(academy.mascotId).toBe(catalog.mascot?.id);
    expect(academy.steps[0]!.resource).toBe('intro');
    expect(academy.steps.at(-1)!.resource).toBe('report');
    for (const r of ['mass', 'power', 'battery', 'budget', 'data', 'comms', 'time', 'lifetime']) {
      expect(academy.steps.some((s) => s.resource === r), r).toBe(true);
    }
  });

  it('tiene solución: un diseño cumple todos los pasos, obtiene Go y completa la misión', () => {
    for (const step of academy.steps) expect(evaluateAcademyStep(step, goodDesign), step.id).toBe(true);
    expect(reviewGoNoGo(goodDesign).go).toBe(true);
    const r = runMission(goodDesign);
    if (r.launchSuccess) {
      expect(r.status).toBe('complete');
      expect(r.score.objectives).toBeGreaterThanOrEqual(90);
    }
  });

  it('se puede recorrer paso a paso: cada paso se cumple con las piezas montadas hasta entonces', () => {
    // Orden de montaje que sigue los textos de la Academia.
    let d: MissionDesign = { scenarioId: 'academy-cubesat-leo', componentIds: [], orbitId: null, launcherId: null };
    const actions: Record<string, (x: MissionDesign) => MissionDesign> = {
      'step-structure': (x) => ({ ...x, componentIds: [...x.componentIds, 'structure-cubesat-12u'] }),
      'step-payload': (x) => ({ ...x, componentIds: [...x.componentIds, 'payload-multispectral-basic'] }),
      'step-orbit': (x) => ({ ...x, orbitId: 'LEO' }),
      'step-power': (x) => ({ ...x, componentIds: [...x.componentIds, 'power-deployable', 'power-body-mounted'] }),
      'step-battery': (x) => ({ ...x, componentIds: [...x.componentIds, 'battery-medium'] }),
      'step-comms': (x) => ({ ...x, componentIds: [...x.componentIds, 'comms-s-band'] }),
      'step-obc': (x) => ({ ...x, componentIds: [...x.componentIds, 'obc-basic'] }),
      'step-adcs': (x) => ({ ...x, componentIds: [...x.componentIds, 'adcs-magnetorquers'] }),
      'step-thermal': (x) => ({ ...x, componentIds: [...x.componentIds, 'thermal-passive'] }),
      'step-launcher': (x) => ({ ...x, launcherId: 'launcher-albatros' }),
    };
    for (const step of academy.steps) {
      const before = step.goal.type === 'manual' ? true : evaluateAcademyStep(step, d);
      d = actions[step.id]?.(d) ?? d;
      expect(evaluateAcademyStep(step, d), step.id).toBe(true);
      // Los pasos de montaje/selección no se cumplen antes de hacer la acción.
      if (actions[step.id] && step.goal.type !== 'resource-ok') expect(before, `${step.id} ya cumplido`).toBe(false);
    }
  });

  it('evaluateAcademyStep: cada tipo de objetivo', () => {
    const empty: MissionDesign = { scenarioId: 'academy-cubesat-leo', componentIds: [], orbitId: null, launcherId: null };
    const step = (goal: AcademyStep['goal'], resource: AcademyStep['resource'] = 'intro'): AcademyStep => ({
      id: 'x', resource, title: { es: 'x', en: 'x' }, body: { es: 'x', en: 'x' }, goal,
    });
    expect(evaluateAcademyStep(step({ type: 'manual' }), empty)).toBe(true);
    expect(evaluateAcademyStep(step({ type: 'add-component' }), empty)).toBe(false);
    expect(evaluateAcademyStep(step({ type: 'add-component', value: 'battery' }), goodDesign)).toBe(true);
    expect(evaluateAcademyStep(step({ type: 'add-component', value: 'battery-large' }), goodDesign)).toBe(false);
    expect(evaluateAcademyStep(step({ type: 'select-orbit' }), empty)).toBe(false);
    expect(evaluateAcademyStep(step({ type: 'select-orbit', value: 'SSO' }), goodDesign)).toBe(false);
    expect(evaluateAcademyStep(step({ type: 'select-launcher', value: 'launcher-albatros' }), goodDesign)).toBe(true);
    // resource-ok: un recurso sin evaluar (memoria 0 y sin datos) no cuenta como "en verde".
    expect(evaluateAcademyStep(step({ type: 'resource-ok', value: 'data' }), empty)).toBe(false);
    expect(evaluateAcademyStep(step({ type: 'resource-ok' }, 'power'), goodDesign)).toBe(true);
    expect(evaluateAcademyStep(step({ type: 'resource-ok' }, 'intro'), goodDesign)).toBe(false);
    const heavy = { ...goodDesign, componentIds: [...goodDesign.componentIds, 'payload-hires-camera', 'structure-microsat'] };
    expect(evaluateAcademyStep(step({ type: 'go' }), goodDesign)).toBe(true);
    expect(evaluateAcademyStep(step({ type: 'go' }), heavy)).toBe(false);
  });

  it('valida escenario, ids de objetivos y mascota', () => {
    const bad = (mutate: (a: typeof academyJson) => void, re: RegExp) => {
      const r = raw();
      mutate(r.academy);
      expect(() => parseCatalog(r)).toThrow(re);
    };
    bad((a) => { a.scenarioId = 'nope'; }, /academy.scenarioId/);
    bad((a) => { a.steps[1]!.goal = { type: 'add-component', value: 'pieza-x' }; }, /no es un componente ni un subsistema/);
    bad((a) => { a.steps[3]!.goal = { type: 'select-orbit', value: 'LUNA' }; }, /órbita "LUNA"/);
    bad((a) => { a.steps[0]!.goal = { type: 'manual', value: 'x' } as never; }, /no admite value/);
    bad((a) => { a.mascotId = 'rise'; }, /academy.mascotId/);
    bad((a) => { a.steps.push(structuredClone(a.steps[0]!)); }, /academy.steps: id duplicado/);
  });

  it('un catálogo sin glosario, mascota ni Academia sigue siendo válido (campos opcionales)', () => {
    const { glossary: _g, mascot: _m, academy: _a, ...phase1 } = raw();
    expect(() => parseCatalog(phase1)).not.toThrow();
  });
});
