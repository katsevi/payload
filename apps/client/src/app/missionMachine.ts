import { setup } from 'xstate';
import { reviewGoNoGo, catalog } from '@payload/shared';
import { useDesign } from '../state/design';
import { useSim } from '../state/sim';
import { useUi } from '../state/ui';
import { campaignScenarios } from '../ui/catalogViews';
import { academyAllowsReview, academyDef, redesignIndex } from '../academy/academyLogic';
import { useAcademy } from '../academy/academyStore';
import { useMascot } from '../mascot/mascotStore';

export type MissionEvent =
  | { type: 'PLAY'; scenarioId?: string }
  | { type: 'START_DESIGN' }
  | { type: 'REQUEST_REVIEW' }
  | { type: 'BACK_TO_DESIGN' }
  | { type: 'LAUNCH' }
  | { type: 'CONFIRM_LAUNCH' }
  | { type: 'LAUNCH_DONE' }
  | { type: 'FINISH' }
  | { type: 'REDESIGN' }
  | { type: 'MENU' };

/**
 * Flujo de fases de la misión: menú → briefing → diseño → revisión → [pre-lanzamiento] → lanzamiento →
 * operación → informe. Tras el Go se sortean los eventos pre-lanzamiento (`rollPreLaunchEvents`): si hay
 * retraso o recorte se muestra la fase `prelaunch`; si no, se pasa directo al lanzamiento.
 * `MENU` vuelve al menú desde cualquier fase (salir de la Academia).
 * Los datos viven en los stores de Zustand; la máquina solo decide qué fase está activa.
 */
export const missionMachine = setup({
  types: { events: {} as MissionEvent },
  guards: {
    /** En la Academia, la revisión se bloquea hasta llegar al paso del Go (para no saltarse pasos). */
    reviewAllowed: () => {
      const a = useAcademy.getState();
      const steps = academyDef()?.steps;
      return !a.active || !steps || academyAllowsReview(steps, a.index);
    },
    isGo: () => reviewGoNoGo(useDesign.getState().design(), catalog).go,
    launchSucceeded: () => useSim.getState().launchOk !== false,
    noPreLaunchEvents: () => (useSim.getState().preLaunch?.events.length ?? 0) === 0,
  },
  actions: {
    newMission: ({ event }) => {
      const requested = event.type === 'PLAY' ? event.scenarioId : undefined;
      useDesign.getState().startScenario(requested ?? campaignScenarios()[0]?.id);
      useSim.getState().clear();
    },
    rollPreLaunch: () => {
      const d = useDesign.getState();
      useSim.getState().rollPreLaunch(d.design(), d.attempt);
    },
    enterHangar: () => {
      useDesign.getState().hold(null);
      useSim.getState().clear();
      useUi.getState().setView('first');
    },
    nextAttempt: () => useDesign.getState().nextAttempt(),
    warnReviewLocked: () => {
      useAcademy.setState({ notice: 'academy.reviewLocked' });
      useMascot.getState().say('academy:review-locked', { force: true, fallbackKey: 'academy.reviewLocked', fallbackExpression: 'worried' });
    },
    /** Lanzar exige Go: si la Academia está en el paso del Go, queda cumplido (aunque no diera tiempo al avance automático). */
    academyGoPassed: () => {
      const a = useAcademy.getState();
      const step = academyDef()?.steps[a.index];
      if (a.active && step?.goal.type === 'go') a.complete(step);
    },
    /** «Rediseñar» en la Academia: volver al primer paso del hangar pendiente (o al Go). */
    academyRedesign: () => {
      const a = useAcademy.getState();
      const steps = academyDef()?.steps;
      if (!a.active || !steps) return;
      a.setIndex(redesignIndex(steps, useDesign.getState().design()));
    },
    markNoGo: () => {
      const r = reviewGoNoGo(useDesign.getState().design(), catalog);
      useDesign.getState().setLastIssues(r.go ? [] : r.issues.filter((i) => i.severity === 'blocker'));
    },
    clearNoGo: () => useDesign.getState().setLastIssues([]),
    startLaunch: () => {
      useSim.getState().start(useDesign.getState().design(), useDesign.getState().attempt);
      useUi.getState().setView('third');
    },
    startOperation: () => useUi.getState().setView('third'),
    closeReport: () => {
      if (!useSim.getState().result) useSim.getState().finish();
    },
  },
}).createMachine({
  id: 'mission',
  initial: 'menu',
  on: { MENU: { target: '.menu' } },
  states: {
    menu: { on: { PLAY: { target: 'briefing', actions: 'newMission' } } },
    briefing: { on: { START_DESIGN: 'design', MENU: 'menu' } },
    design: {
      entry: 'enterHangar',
      on: {
        REQUEST_REVIEW: [{ guard: 'reviewAllowed', target: 'review' }, { actions: 'warnReviewLocked' }],
        MENU: 'menu',
      },
    },
    review: {
      // Un No-Go devuelve al hangar con los motivos (la pantalla de revisión los muestra y permite volver).
      on: {
        BACK_TO_DESIGN: { target: 'design', actions: 'markNoGo' },
        LAUNCH: { guard: 'isGo', target: 'prelaunch', actions: ['clearNoGo', 'academyGoPassed'] },
      },
    },
    prelaunch: {
      entry: 'rollPreLaunch',
      always: { guard: 'noPreLaunchEvents', target: 'launch' },
      on: { CONFIRM_LAUNCH: 'launch' },
    },
    launch: {
      entry: 'startLaunch',
      on: {
        LAUNCH_DONE: [
          { guard: 'launchSucceeded', target: 'operation' },
          { target: 'report' },
        ],
      },
    },
    operation: { entry: 'startOperation', on: { FINISH: 'report' } },
    report: {
      entry: 'closeReport',
      on: { REDESIGN: { target: 'design', actions: ['nextAttempt', 'academyRedesign'] }, MENU: 'menu' },
    },
  },
});

export type PhaseName = 'menu' | 'briefing' | 'design' | 'review' | 'prelaunch' | 'launch' | 'operation' | 'report';
