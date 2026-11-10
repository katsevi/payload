import { beforeEach, describe, expect, it } from 'vitest';
import {
  catalog, computeBudgets, evaluateAcademyStep, orbitEccentricity, trueAnomalyFromMeanAnomaly,
  type MissionDesign, type SimEventType,
} from '@payload/shared';
import type { PhaseName } from '../app/missionMachine';
import { createActor } from 'xstate';
import { missionMachine } from '../app/missionMachine';
import {
  academyAllowsReview, academyComplete, academyDef, academyScenarioId, academyStepState, goStepIndex, redesignIndex, skipPassed, stepHighlight, stepPlace,
} from '../academy/academyLogic';
import { useAcademy } from '../academy/academyStore';
import { useDesign } from '../state/design';
import { useSim } from '../state/sim';
import { FREQUENT_EVENTS, dialogueFor, eventTrigger, helpTrigger, mascotDef, newBudgetTriggers, reportTrigger } from '../mascot/mascotLogic';
import { resetMascotMemory, useMascot } from '../mascot/mascotStore';
import { useSettings } from '../state/settings';
import { campaignScenarios, filterGlossary, normalizeSearch } from '../ui/catalogViews';
import { eclipseArc } from '../scenes/orbitMath';

// Diseños de referencia del motor (los mantiene content-designer; uno por escenario).
const fixtures = import.meta.glob('../../../../packages/shared/src/__tests__/fixtures/scenarios/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { scenarioId: string; valid: { name: string; design: MissionDesign }[] }
>;
const academyFixture = Object.values(fixtures).find((f) => f.scenarioId === academyScenarioId());

describe('selector de escenarios', () => {
  it('lista todos los escenarios del catálogo menos la Academia y los de equipo, en orden', () => {
    const ids = campaignScenarios().map((s) => s.id);
    const expected = catalog.scenarios.filter((s) => s.id !== academyScenarioId() && !s.team).map((s) => s.id);
    expect(ids).toEqual(expected);
    expect(ids).not.toContain(academyScenarioId());
    expect(ids.length).toBeGreaterThan(0);
  });
  it('el escenario de la Academia existe en el catálogo', () => {
    expect(catalog.scenarios.some((s) => s.id === academyScenarioId())).toBe(true);
  });
});

describe.skipIf(!academyDef() || !academyFixture)('Academia jugable de principio a fin', () => {
  it('se completa con una secuencia de diseños (el jugador monta lo que falta en cada paso)', () => {
    const steps = academyDef()!.steps;
    const target = academyFixture!.valid[0]!.design;
    // Movimientos posibles del jugador, en orden: piezas del diseño válido, órbita y lanzador.
    const moves: ((d: MissionDesign) => MissionDesign)[] = [
      ...target.componentIds.map((id) => (d: MissionDesign) => ({ ...d, componentIds: [...d.componentIds, id] })),
      (d) => ({ ...d, orbitId: target.orbitId }),
      (d) => ({ ...d, launcherId: target.launcherId }),
    ];
    let design: MissionDesign = { scenarioId: academyScenarioId(), componentIds: [], orbitId: null, launcherId: null };
    const designs: MissionDesign[] = [design];
    let phase: PhaseName = 'briefing';
    let index = 0;
    let moveIdx = 0;
    const visited = new Set<string>();
    const completed = new Set<string>();
    for (let guard = 0; guard < 500 && index < steps.length; guard++) {
      const step = steps[index]!;
      visited.add(step.id);
      const st = academyStepState(step, design, phase);
      if (st === 'met' || st === 'manual') {
        completed.add(step.id);
        index++;
      }
      else if (st === 'passed') index = skipPassed(steps, index, design, phase);
      else if (st === 'todo') {
        const move = moves[moveIdx++];
        expect(move, `sin movimientos para cumplir ${step.id}`).toBeDefined();
        design = move!(design);
        designs.push(design);
      } else {
        // waiting: avanzar la fase de la misión (hangar → revisión → lanzamiento → operación → informe)
        const next: Record<PhaseName, PhaseName> = {
          menu: 'briefing', lobby: 'briefing', briefing: 'design', design: 'review', review: 'prelaunch', prelaunch: 'launch', launch: 'operation', operation: 'report', report: 'report',
        };
        if (phase === 'design') {
          expect(academyAllowsReview(steps, index)).toBe(true);
          // Para lanzar hace falta el Go: el paso 'go' ya debe estar cumplido con el diseño actual.
          expect(evaluateAcademyStep({ id: 'go', resource: 'launch', title: { es: '', en: '' }, body: { es: '', en: '' }, goal: { type: 'go' } }, design)).toBe(true);
        }
        expect(next[phase], `bloqueado en ${step.id} (${phase})`).not.toBe(phase);
        phase = next[phase];
      }
    }
    expect(index).toBe(steps.length);
    expect(phase).toBe('report');
    expect(visited.size).toBe(steps.length);
    expect(academyComplete(steps, completed)).toBe(true);
    expect(designs.length).toBeGreaterThan(3);
  });

  it('cada paso de recurso resalta su recurso; el intro no resalta nada', () => {
    const steps = academyDef()!.steps;
    for (const s of steps) {
      const h = stepHighlight(s);
      if (s.goal.type === 'resource-ok') expect(h).toBe(s.goal.value ?? s.resource);
      if (s.resource === 'intro' || s.resource === 'operation' || s.resource === 'report') expect(h).toBeNull();
    }
  });
});

describe.skipIf(!academyDef() || !academyFixture)('Academia: integridad (no se completa sin hacer los pasos)', () => {
  const steps = () => academyDef()!.steps;
  const loadDesign = (d: MissionDesign) => {
    const s = useDesign.getState();
    s.startScenario(d.scenarioId);
    d.componentIds.forEach((id) => s.add(id));
    s.setOrbit(d.orbitId);
    s.setLauncher(d.launcherId);
  };
  const enterAcademyHangar = () => {
    const a = createActor(missionMachine).start();
    useAcademy.getState().start();
    a.send({ type: 'PLAY', scenarioId: academyScenarioId() });
    a.send({ type: 'START_DESIGN' });
    return a;
  };

  it('la revisión está bloqueada hasta el paso del Go, aunque el diseño sea Go', () => {
    const a = enterAcademyHangar();
    loadDesign(academyFixture!.valid[0]!.design);
    useAcademy.getState().setIndex(1); // un paso del hangar sin cumplir "de verdad"
    expect(academyAllowsReview(steps(), 1)).toBe(false);
    a.send({ type: 'REQUEST_REVIEW' });
    expect(a.getSnapshot().value).toBe('design');
    expect(useAcademy.getState().notice).toBe('academy.reviewLocked');
    // En el paso del Go ya se puede.
    useAcademy.getState().setIndex(goStepIndex(steps()));
    a.send({ type: 'REQUEST_REVIEW' });
    expect(a.getSnapshot().value).toBe('review');
    useAcademy.getState().exit();
  });

  it('saltar pasos (fase ya pasada) no los cuenta: la Academia no queda completada', () => {
    const st = steps();
    const design = academyFixture!.valid[0]!.design;
    // Llegar al informe sin haber cumplido nada: todos los pasos anteriores pasan a 'passed' y se saltan.
    const idx = skipPassed(st, 0, design, 'report');
    expect(idx).toBeGreaterThan(0);
    expect(academyComplete(st, new Set())).toBe(false);
    // Solo los manuales no bastan.
    expect(academyComplete(st, new Set(st.filter((s) => s.goal.type === 'manual').map((s) => s.id)))).toBe(false);
    expect(academyComplete(st, new Set(st.map((s) => s.id)))).toBe(true);
  });

  it('el paso manual de lanzamiento se juega en el lanzamiento, no en el hangar', () => {
    const launchStep = steps().find((s) => s.resource === 'launch' && s.goal.type === 'manual');
    if (!launchStep) return;
    const d = academyFixture!.valid[0]!.design;
    expect(stepPlace(launchStep)).toBe('launch');
    expect(academyStepState(launchStep, d, 'design')).toBe('waiting');
    expect(academyStepState(launchStep, d, 'prelaunch')).toBe('waiting');
    expect(academyStepState(launchStep, d, 'launch')).toBe('manual');
    expect(academyStepState(launchStep, d, 'operation')).toBe('passed');
  });

  it('«Rediseñar» vuelve al primer paso del hangar pendiente (o al Go si el diseño cumple todo)', () => {
    const st = steps();
    const valid = academyFixture!.valid[0]!.design;
    expect(redesignIndex(st, valid)).toBe(goStepIndex(st));
    // Sin la órbita, el primer pendiente es un paso del hangar anterior al Go.
    const noOrbit = { ...valid, orbitId: null };
    const i = redesignIndex(st, noOrbit);
    expect(i).toBeLessThan(goStepIndex(st));
    expect(stepPlace(st[i]!)).toBe('hangar');
    expect(academyStepState(st[i]!, noOrbit, 'design')).toBe('todo');

    // Con la máquina: informe → REDESIGN en la Academia mueve el panel a ese paso.
    const a = enterAcademyHangar();
    loadDesign(noOrbit);
    useAcademy.getState().setIndex(goStepIndex(st));
    useDesign.getState().setOrbit(valid.orbitId);
    a.send({ type: 'REQUEST_REVIEW' });
    a.send({ type: 'LAUNCH' });
    if (a.getSnapshot().value === 'prelaunch') a.send({ type: 'CONFIRM_LAUNCH' });
    expect(useAcademy.getState().completed.has(st[goStepIndex(st)]!.id)).toBe(true); // el Go cuenta al lanzar
    a.send({ type: 'LAUNCH_DONE' });
    if (a.getSnapshot().value === 'operation') a.send({ type: 'FINISH' });
    expect(a.getSnapshot().value).toBe('report');
    useAcademy.getState().setIndex(st.length - 1); // panel en el paso del informe
    useDesign.getState().setOrbit(null); // el jugador rediseña quitando la órbita
    a.send({ type: 'REDESIGN' });
    expect(a.getSnapshot().value).toBe('design');
    expect(useAcademy.getState().index).toBe(redesignIndex(st, useDesign.getState().design()));
    expect(useAcademy.getState().index).toBeLessThan(goStepIndex(st));
    useAcademy.getState().exit();
    useSim.getState().clear();
  });
});

describe('mascota (datos de catalog.mascot)', () => {
  beforeEach(() => {
    resetMascotMemory();
    useSettings.setState({ mascot: true });
  });

  it('elige diálogo para cada evento del motor que exista en el JSON', () => {
    const m = mascotDef();
    expect(m).not.toBeNull();
    const eventTriggers = m!.dialogues.filter((d) => d.trigger.startsWith('event:'));
    expect(eventTriggers.length).toBeGreaterThan(0);
    for (const d of eventTriggers) {
      const type = d.trigger.slice('event:'.length) as SimEventType;
      const tg = eventTrigger({ type }, true);
      expect(tg).toBe(d.trigger);
      const picked = dialogueFor(tg!, m);
      expect(picked, d.trigger).not.toBeNull();
      expect(m!.expressions).toContain(picked!.expression);
      expect(picked!.text.es.trim()).not.toBe('');
      expect(picked!.text.en.trim()).not.toBe('');
      // El store también lo dice (subtítulo = texto del JSON).
      resetMascotMemory();
      expect(useMascot.getState().say(tg!)).toBe(true);
      expect(useMascot.getState().current?.text).toEqual(picked!.text);
    }
  });

  it('eclipses y contactos son frecuentes (solo la 1.ª vez); los pre-lanzamiento solo si se piden', () => {
    expect(FREQUENT_EVENTS.has('eclipse-enter')).toBe(true);
    expect(FREQUENT_EVENTS.has('contact-start')).toBe(true);
    expect(FREQUENT_EVENTS.has('battery-low')).toBe(false);
    expect(eventTrigger({ type: 'launch-delay' })).toBeNull();
    expect(eventTrigger({ type: 'launch-delay' }, true)).toBe('event:launch-delay');
  });

  it('desactivada en Ajustes no dice nada; con H usa la ayuda de controles si no hay diálogo', () => {
    useSettings.setState({ mascot: false });
    expect(useMascot.getState().say('phase:design')).toBe(false);
    useSettings.setState({ mascot: true });
    expect(useMascot.getState().say('help:__nada__', { force: true, fallbackKey: 'help.report' })).toBe(true);
    expect(useMascot.getState().current?.fallbackKey).toBe('help.report');
    expect(helpTrigger('operation')).toBe('help:orbit');
    expect(helpTrigger('design')).toBe('help:hangar');
  });

  it('no repite el mismo disparador durante el enfriamiento', () => {
    const tg = mascotDef()!.dialogues[0]!.trigger;
    expect(useMascot.getState().say(tg)).toBe(true);
    expect(useMascot.getState().say(tg)).toBe(false);
  });

  it('recursos: solo dispara los que cambian a rojo/ámbar', () => {
    const d: MissionDesign = { scenarioId: catalog.scenarios[0]!.id, componentIds: [], orbitId: null, launcherId: null };
    const b = computeBudgets(d, catalog);
    const first = newBudgetTriggers([], b);
    expect(first.fresh).toEqual(first.all);
    const again = newBudgetTriggers(first.all, b);
    expect(again.fresh).toEqual([]);
  });

  it('informe: éxito o fallo', () => {
    expect(reportTrigger({ launchSuccess: true, status: 'complete' })).toBe('report:success');
    expect(reportTrigger({ launchSuccess: false, status: 'failed' })).toBe('report:failure');
  });
});

describe('glosario', () => {
  it('busca sin tildes ni mayúsculas en término y definición', () => {
    expect(normalizeSearch('  Órbita ')).toBe('orbita');
    const all = filterGlossary('', 'es');
    expect(all.length).toBe(catalog.glossary?.length ?? 0);
    const first = catalog.glossary?.[0];
    if (first) {
      const q = normalizeSearch(first.term.es).slice(0, 5).toUpperCase();
      expect(filterGlossary(q, 'es').map((g) => g.id)).toContain(first.id);
    }
    expect(filterGlossary('zzzz-no-existe', 'es')).toEqual([]);
  });
  it('los relacionados apuntan a entradas existentes', () => {
    const ids = new Set((catalog.glossary ?? []).map((g) => g.id));
    for (const g of catalog.glossary ?? []) for (const r of g.related ?? []) expect(ids.has(r), `${g.id} → ${r}`).toBe(true);
  });
});

describe('órbita de Kepler (escena)', () => {
  it('circular: el eclipse ocupa π ± π·f; elíptica: más estrecho en anomalía verdadera', () => {
    const [a, b] = eclipseArc(0.4, 0, trueAnomalyFromMeanAnomaly);
    expect(a).toBeCloseTo(Math.PI * 0.6, 6);
    expect(b).toBeCloseTo(Math.PI * 1.4, 6);
    const heo = catalog.orbits.find((o) => o.id === 'HEO');
    if (heo) {
      const [c, d] = eclipseArc(0.1, orbitEccentricity(heo), trueAnomalyFromMeanAnomaly);
      expect(c).toBeLessThan(Math.PI);
      expect(d).toBeGreaterThan(Math.PI);
      expect(d - c).toBeLessThan(Math.PI * 0.2); // cerca del apogeo la nave avanza poco ángulo
    }
  });
});
