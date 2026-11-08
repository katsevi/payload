import { setup } from 'xstate';
import { reviewGoNoGo, catalog } from '@payload/shared';
import { useDesign } from '../state/design';
import { useSim } from '../state/sim';
import { useUi } from '../state/ui';

export type MissionEvent =
  | { type: 'PLAY' }
  | { type: 'START_DESIGN' }
  | { type: 'REQUEST_REVIEW' }
  | { type: 'BACK_TO_DESIGN' }
  | { type: 'LAUNCH' }
  | { type: 'LAUNCH_DONE' }
  | { type: 'FINISH' }
  | { type: 'REDESIGN' }
  | { type: 'MENU' };

/**
 * Flujo de fases de la misión: menú → briefing → diseño → revisión → lanzamiento → operación → informe.
 * Los datos viven en los stores de Zustand; la máquina solo decide qué fase está activa.
 */
export const missionMachine = setup({
  types: { events: {} as MissionEvent },
  guards: {
    isGo: () => reviewGoNoGo(useDesign.getState().design(), catalog).go,
    launchSucceeded: () => useSim.getState().launchOk !== false,
  },
  actions: {
    newMission: () => {
      useDesign.getState().startScenario();
      useSim.getState().clear();
    },
    enterHangar: () => {
      useDesign.getState().hold(null);
      useSim.getState().clear();
      useUi.getState().setView('first');
    },
    nextAttempt: () => useDesign.getState().nextAttempt(),
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
  states: {
    menu: { on: { PLAY: { target: 'briefing', actions: 'newMission' } } },
    briefing: { on: { START_DESIGN: 'design', MENU: 'menu' } },
    design: {
      entry: 'enterHangar',
      on: { REQUEST_REVIEW: 'review', MENU: 'menu' },
    },
    review: {
      // Un No-Go devuelve al hangar con los motivos (la pantalla de revisión los muestra y permite volver).
      on: {
        BACK_TO_DESIGN: { target: 'design', actions: 'markNoGo' },
        LAUNCH: { guard: 'isGo', target: 'launch', actions: 'clearNoGo' },
      },
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
      on: { REDESIGN: { target: 'design', actions: 'nextAttempt' }, MENU: 'menu' },
    },
  },
});

export type PhaseName = 'menu' | 'briefing' | 'design' | 'review' | 'launch' | 'operation' | 'report';
