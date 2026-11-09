import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import {
  catalog, componentsForScenario, computeBudgets, reviewGoNoGo, type MissionDesign, type OrbitId, type SubsystemId,
} from '@payload/shared';
import { missionMachine } from '../app/missionMachine';
import { useDesign } from '../state/design';
import { useSim } from '../state/sim';
import { campaignScenarios } from '../ui/catalogViews';

/** ¿Está implementado el motor? (mientras sean stubs, los tests de integración se omiten) */
function engineReady(): boolean {
  try {
    const sc = catalog.scenarios[0];
    if (!sc) return false;
    computeBudgets({ scenarioId: sc.id, componentIds: [], orbitId: null, launcherId: null }, catalog);
    return true;
  } catch {
    return false;
  }
}

const ready = engineReady();

/** Busca un diseño Go combinando un componente por subsistema (suficiente para comprobar la integración). */
function findGoDesign(): MissionDesign | null {
  const sc = campaignScenarios()[0]!;
  const comps = componentsForScenario(sc.id, catalog);
  const by = (s: SubsystemId) => comps.filter((c) => c.subsystem === s);
  const subs: SubsystemId[] = ['power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'];
  for (const st of by('structure')) {
    for (const orbitId of sc.allowedOrbits as OrbitId[]) {
      for (const launcherId of sc.allowedLaunchers) {
        for (const pl of by('payload')) {
          const ids = [st.id, ...subs.filter((s) => s !== 'payload').map((s) => by(s)[0]?.id).filter((x): x is string => !!x), pl.id];
          const d: MissionDesign = { scenarioId: sc.id, componentIds: ids, orbitId, launcherId };
          if (reviewGoNoGo(d, catalog).go) return d;
        }
      }
    }
  }
  return null;
}

describe('flujo de fases (máquina XState)', () => {
  it('menú → briefing → diseño sin motor', () => {
    const a = createActor(missionMachine).start();
    expect(a.getSnapshot().value).toBe('menu');
    a.send({ type: 'PLAY' });
    expect(a.getSnapshot().value).toBe('briefing');
    a.send({ type: 'START_DESIGN' });
    expect(a.getSnapshot().value).toBe('design');
    a.send({ type: 'MENU' });
    expect(a.getSnapshot().value).toBe('menu');
  });
});

describe.skipIf(!ready)('integración con el motor real', () => {
  it('No-Go con diseño vacío vuelve al hangar con los motivos', () => {
    const a = createActor(missionMachine).start();
    a.send({ type: 'PLAY' });
    a.send({ type: 'START_DESIGN' });
    a.send({ type: 'REQUEST_REVIEW' });
    expect(a.getSnapshot().value).toBe('review');
    a.send({ type: 'LAUNCH' }); // bloqueado por el guard
    expect(a.getSnapshot().value).toBe('review');
    a.send({ type: 'BACK_TO_DESIGN' });
    expect(a.getSnapshot().value).toBe('design');
    expect(useDesign.getState().lastIssues.length).toBeGreaterThan(0);
  });

  it('diseño → Go → lanzamiento → operación → informe con el catálogo real', () => {
    const design = findGoDesign();
    expect(design, 'el catálogo debe permitir al menos un diseño Go').not.toBeNull();
    const a = createActor(missionMachine).start();
    a.send({ type: 'PLAY' });
    a.send({ type: 'START_DESIGN' });
    const d = useDesign.getState();
    d.startScenario(design!.scenarioId);
    design!.componentIds.forEach((id) => d.add(id));
    d.setOrbit(design!.orbitId);
    d.setLauncher(design!.launcherId);
    a.send({ type: 'REQUEST_REVIEW' });
    a.send({ type: 'LAUNCH' });
    // Tras el Go se sortean los eventos pre-lanzamiento: si hay alguno se muestra la fase prelaunch.
    const pre = useSim.getState().preLaunch;
    expect(pre).not.toBeNull();
    if (pre!.events.length > 0) {
      expect(a.getSnapshot().value).toBe('prelaunch');
      a.send({ type: 'CONFIRM_LAUNCH' });
    }
    expect(a.getSnapshot().value).toBe('launch');
    expect(useSim.getState().preLaunch).toEqual(pre);
    expect(useSim.getState().snapshot).not.toBeNull();
    a.send({ type: 'LAUNCH_DONE' });
    if (useSim.getState().launchOk) {
      expect(a.getSnapshot().value).toBe('operation');
      for (let i = 0; i < 50; i++) useSim.getState().tick(0.1 * 1000);
      a.send({ type: 'FINISH' });
    }
    expect(a.getSnapshot().value).toBe('report');
    const r = useSim.getState().result;
    expect(r).not.toBeNull();
    expect(r!.score.total).toBeGreaterThanOrEqual(0);
    expect(r!.report.length).toBeGreaterThan(0);
    a.send({ type: 'REDESIGN' });
    expect(a.getSnapshot().value).toBe('design');
    expect(useDesign.getState().componentIds.length).toBe(design!.componentIds.length); // conserva el diseño
  });
});
