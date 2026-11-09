import { useEffect } from 'react';
import { catalog, computeBudgets, reviewGoNoGo } from '@payload/shared';
import type { PhaseName } from '../app/missionMachine';
import { useDesign } from '../state/design';
import { useSim } from '../state/sim';
import { FREQUENT_EVENTS, eventTrigger, newBudgetTriggers, phaseTrigger, reportTrigger, reviewTrigger } from './mascotLogic';
import { useMascot } from './mascotStore';

/**
 * Conecta la mascota con el juego (se monta una vez en App):
 *  - cambio de fase → `phase:<fase>`; revisión → `review:go|no-go`; informe → `report:success|failure`;
 *  - pre-lanzamiento → `event:launch-delay` / `event:budget-cut`;
 *  - eventos del motor durante la operación → `event:<tipo>` (vía `mascotTriggerForEvent`);
 *  - recursos que ENTRAN en rojo/ámbar en el hangar → `resource-over|tight:<id>` (solo al cambiar).
 * Toda la lógica de "qué decir" está en mascotLogic.ts; los textos en catalog.mascot.
 */
const LAUNCH_RESULT_EVENTS: ReadonlySet<string> = new Set(['launch-success', 'launch-failure']);

export function useMascotDirector(phase: PhaseName): void {
  // Fase
  useEffect(() => {
    const m = useMascot.getState();
    if (phase === 'menu') {
      m.clear();
      return;
    }
    // Lo pendiente de la fase anterior ya no viene a cuento.
    useMascot.setState({ queue: [] });
    const pt = phaseTrigger(phase);
    if (pt) m.say(pt);
    if (phase === 'review') {
      try {
        m.say(reviewTrigger(reviewGoNoGo(useDesign.getState().design(), catalog).go));
      } catch {
        /* motor no disponible */
      }
    }
    if (phase === 'prelaunch') {
      for (const e of useSim.getState().preLaunch?.events ?? []) {
        const tg = eventTrigger(e, true);
        if (tg) m.say(tg);
      }
    }
  }, [phase]);

  // Informe: desenlace
  useEffect(() => {
    if (phase !== 'report') return;
    const say = (r: ReturnType<typeof useSim.getState>['result']) => r && useMascot.getState().say(reportTrigger(r));
    const r = useSim.getState().result;
    if (r) {
      say(r);
      return;
    }
    return useSim.subscribe((s, p) => {
      if (s.result && !p.result) say(s.result);
    });
  }, [phase]);

  // Eventos del motor (lanzamiento y operación)
  useEffect(() => {
    if (phase !== 'launch' && phase !== 'operation') return;
    let lastId = -1;
    // Eclipses y contactos se repiten cada órbita: solo se comentan la primera vez.
    const frequentSaid = new Set<string>();
    const process = (events: ReturnType<typeof useSim.getState>['events']) => {
      for (const e of events) {
        if (e.id <= lastId) continue;
        lastId = e.id;
        if (FREQUENT_EVENTS.has(e.type)) {
          if (frequentSaid.has(e.type)) continue;
          frequentSaid.add(e.type);
        }
        // El resultado del lanzamiento lo comenta la mascota en el HUD (ZeroGMascot) cuando ocurre en pantalla.
        if (LAUNCH_RESULT_EVENTS.has(e.type)) continue;
        const tg = eventTrigger(e);
        if (tg) useMascot.getState().say(tg);
      }
    };
    process(useSim.getState().events);
    return useSim.subscribe((s, p) => {
      if (s.events === p.events) return;
      if (s.events.length < p.events.length) lastId = -1;
      process(s.events);
    });
  }, [phase]);

  // Recursos en rojo/ámbar en el hangar (solo los que cambian)
  useEffect(() => {
    if (phase !== 'design') return;
    const budgetsOf = () => {
      const d = useDesign.getState().design();
      try {
        return d.scenarioId ? computeBudgets(d, catalog) : null;
      } catch {
        return null;
      }
    };
    // Línea base al entrar: no se comenta lo que ya estaba así.
    let prev = newBudgetTriggers([], budgetsOf()).all;
    return useDesign.subscribe((s, p) => {
      if (s.componentIds === p.componentIds && s.orbitId === p.orbitId && s.launcherId === p.launcherId) return;
      const { all, fresh } = newBudgetTriggers(prev, budgetsOf());
      prev = all;
      const first = fresh[0];
      if (first) useMascot.getState().say(first);
    });
  }, [phase]);
}
