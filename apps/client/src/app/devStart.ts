import { catalog, componentsForScenario } from '@payload/shared';
import { useDesign } from '../state/design';
import { useSim } from '../state/sim';
import { useUi } from '../state/ui';
import { missionMachine } from './missionMachine';

/**
 * Solo desarrollo: `?phase=launch|operation|report` arranca directamente en esa fase con un diseño de
 * ejemplo (útil para capturas y depuración). Devuelve el snapshot inicial de la máquina o undefined.
 */
export function devInitialSnapshot() {
  if (!import.meta.env.DEV) return undefined;
  const phase = new URLSearchParams(location.search).get('phase');
  if (phase !== 'launch' && phase !== 'operation' && phase !== 'report') return undefined;
  try {
    const sc = catalog.scenarios[0]!;
    const comps = componentsForScenario(sc.id, catalog);
    const first = (s: string) => comps.find((c) => c.subsystem === s)?.id;
    const d = useDesign.getState();
    d.startScenario(sc.id);
    ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'].forEach((s) => {
      const id = first(s);
      if (id) d.add(id);
    });
    d.setOrbit(sc.allowedOrbits[0] ?? null);
    d.setLauncher(sc.allowedLaunchers[0] ?? null);
    useSim.getState().start(d.design(), d.attempt);
    if (phase === 'report') useSim.getState().finish();
    useUi.getState().setView('third');
    return missionMachine.resolveState({ value: phase });
  } catch (e) {
    console.warn('[dev] no se pudo preparar la fase', e);
    return undefined;
  }
}
