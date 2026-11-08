import { useEffect } from 'react';
import { useUi } from '../state/ui';
import type { PhaseName } from './missionMachine';

/** Atajos globales: V (cambiar vista), Tab (recursos), H (ayuda). E/Q los gestiona el hangar. */
export function useGlobalKeys(phase: PhaseName, accessible2D: boolean): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.repeat) return;
      const ui = useUi.getState();
      if (e.code === 'KeyH') ui.toggleHelp();
      else if (e.code === 'KeyV' && ui.overlay === null) {
        if (phase === 'launch' || phase === 'operation' || (phase === 'design' && !accessible2D)) ui.toggleView();
      } else if (e.code === 'Tab' && phase === 'design') {
        e.preventDefault();
        ui.toggleResources();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, accessible2D]);
}
