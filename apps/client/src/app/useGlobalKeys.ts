import { useEffect } from 'react';
import { useUi } from '../state/ui';
import { helpTrigger } from '../mascot/mascotLogic';
import { useMascot } from '../mascot/mascotStore';
import type { PhaseName } from './missionMachine';

/** Clave ui de la ayuda de controles de cada fase (respaldo si la mascota no tiene `help:<contexto>`). */
export const HELP_KEY: Record<PhaseName, string> = {
  menu: 'menu', briefing: 'briefing', design: 'hangar', review: 'review', prelaunch: 'review', launch: 'launch', operation: 'operation', report: 'report',
};

/**
 * Pide ayuda contextual: muestra los controles y la mascota dice `help:<contexto>` según la escena
 * (hangar, control-room, orbit, launch, report). Si no hay diálogo, la mascota lee la ayuda de controles.
 */
export function requestHelp(phase: PhaseName): void {
  const ui = useUi.getState();
  ui.toggleHelp();
  if (useUi.getState().help) {
    useMascot.getState().say(helpTrigger(phase), { force: true, fallbackKey: `help.${HELP_KEY[phase]}` });
  }
}
/** Atajos globales: V (cambiar vista), I (vista del instrumento, en operación), Tab (recursos), H (ayuda + mascota), G (glosario). E/Q los gestiona el hangar. */
export function useGlobalKeys(phase: PhaseName, accessible2D: boolean): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.repeat) return;
      const ui = useUi.getState();
      if (e.code === 'KeyH') requestHelp(phase);
      else if (e.code === 'KeyG' && (ui.overlay === null || ui.overlay === 'glossary') && phase !== 'launch') {
        if (ui.overlay === 'glossary') ui.setOverlay(null);
        else ui.openGlossary();
      }
      else if (e.code === 'KeyV' && ui.overlay === null) {
        if (phase === 'launch' || phase === 'operation' || (phase === 'design' && !accessible2D)) ui.toggleView();
      } else if (e.code === 'KeyI' && phase === 'operation' && ui.overlay === null) {
        ui.toggleInstrument();
      } else if (e.code === 'Tab' && phase === 'design') {
        e.preventDefault();
        ui.toggleResources();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, accessible2D]);
}
