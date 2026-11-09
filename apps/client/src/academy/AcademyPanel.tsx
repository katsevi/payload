import { useEffect, useRef } from 'react';
import { CheckCircle2, GraduationCap, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { catalog, type AcademyStep, type SubsystemId } from '@payload/shared';
import type { PhaseName } from '../app/missionMachine';
import { lt } from '../i18n';
import { MascotAvatar } from '../mascot/MascotAvatar';
import { mascotDef } from '../mascot/mascotLogic';
import { useMascot } from '../mascot/mascotStore';
import { useDesign } from '../state/design';
import { useProgress } from '../state/progress';
import { useSettings } from '../state/settings';
import { useSim } from '../state/sim';
import { useUi } from '../state/ui';
import { academyComplete, academyDef, academyStepState, skipPassed, stepHighlight, stepPlace } from './academyLogic';
import { useAcademy } from './academyStore';

/** Pausa antes de avanzar solo: breve si el jugador acaba de cumplir el objetivo, más larga si ya venía cumplido. */
export const AUTO_ADVANCE_MS = 1_600;
export const AUTO_ADVANCE_PRESET_MS = 5_000;
/** La operación de la Academia es breve: arranca acelerada. */
const ACADEMY_OPERATION_ACCEL = 1000;

const SUBSYSTEMS: readonly string[] = ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'];

function useGoalText(step: AcademyStep): string {
  const { t } = useTranslation();
  const { type, value } = step.goal;
  switch (type) {
    case 'add-component': {
      if (!value) return t('academy.goal.addAny');
      if (SUBSYSTEMS.includes(value)) return t('academy.goal.addSubsystem', { name: t(`subsystem.${value as SubsystemId}`) });
      const c = catalog.components.find((x) => x.id === value);
      return t('academy.goal.addComponent', { name: c ? lt(c.name) : value });
    }
    case 'select-orbit': {
      const o = catalog.orbits.find((x) => x.id === value);
      return value ? t('academy.goal.selectOrbit', { name: o ? lt(o.name) : value }) : t('academy.goal.selectAnyOrbit');
    }
    case 'select-launcher': {
      const l = catalog.launchers.find((x) => x.id === value);
      return value ? t('academy.goal.selectLauncher', { name: l ? lt(l.name) : value }) : t('academy.goal.selectAnyLauncher');
    }
    case 'resource-ok':
      return t('academy.goal.resourceOk', { name: t(`resources.${value ?? step.resource}`) });
    case 'go':
      return t('academy.goal.go');
    default:
      return t('academy.goal.manual');
  }
}

function GoalLine({ step }: { step: AcademyStep }) {
  const { t } = useTranslation();
  const text = useGoalText(step);
  return (
    <p className="mt-2 text-xs text-slate-300">
      <span className="num uppercase tracking-wider text-accent">{t('academy.objective')}</span> {text}
    </p>
  );
}

/**
 * Panel de la Academia: narra el paso actual (con la mascota si está activa), comprueba su objetivo
 * con `evaluateAcademyStep`, avanza solo al cumplirse (o con «Siguiente» en los pasos `manual`),
 * resalta el recurso implicado en el panel de recursos y permite salir en cualquier momento.
 */
export function AcademyPanel({ phase, onExit }: { phase: PhaseName; onExit: () => void }) {
  const { t } = useTranslation();
  const active = useAcademy((s) => s.active);
  const index = useAcademy((s) => s.index);
  const scenarioId = useDesign((s) => s.scenarioId);
  const componentIds = useDesign((s) => s.componentIds);
  const orbitId = useDesign((s) => s.orbitId);
  const launcherId = useDesign((s) => s.launcherId);
  const mascotOn = useSettings((s) => s.mascot);
  const completed = useAcademy((s) => s.completed);
  const notice = useAcademy((s) => s.notice);
  const def = academyDef();
  const steps = def?.steps ?? [];
  const step = steps[index];
  const design = { scenarioId, componentIds, orbitId, launcherId };
  const state = step ? academyStepState(step, design, phase) : null;
  const done = active && index >= steps.length;
  // Solo cuenta como completada si se cumplieron de verdad todos los pasos no manuales.
  const allDone = done && academyComplete(steps, completed);

  // Estado del paso al llegar a él (para decidir la pausa de avance automático).
  const arrival = useRef<{ index: number; state: typeof state }>({ index: -1, state: null });
  if (arrival.current.index !== index) arrival.current = { index, state };

  // Pasos cuya fase ya pasó: saltar sin pausa.
  useEffect(() => {
    if (!active || state !== 'passed') return;
    useAcademy.getState().setIndex(skipPassed(steps, index, design, phase));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state, index, phase]);

  // Objetivo cumplido: avanzar solo tras una pausa.
  useEffect(() => {
    if (!active || state !== 'met') return;
    const wait = arrival.current.state === 'met' ? AUTO_ADVANCE_PRESET_MS : AUTO_ADVANCE_MS;
    const id = window.setTimeout(() => {
      if (step && useAcademy.getState().index === index) useAcademy.getState().complete(step);
    }, wait);
    return () => window.clearTimeout(id);
  }, [active, state, index, step]);

  // La mascota comenta el paso (si tiene diálogo `academy:<id>`), y se resalta su recurso.
  useEffect(() => {
    if (!active) return;
    if (step) useMascot.getState().say(`academy:${step.id}`);
    useUi.getState().setHighlight(step && stepPlace(step) === 'hangar' ? stepHighlight(step) : null);
  }, [active, step]);

  useEffect(() => {
    if (!active) return;
    if (phase === 'design') useUi.setState({ resourcesOpen: true });
    if (phase === 'operation') useSim.getState().setAccel(ACADEMY_OPERATION_ACCEL);
  }, [active, phase]);

  useEffect(() => {
    if (allDone) useProgress.getState().setAcademyDone(true);
  }, [allDone]);

  useEffect(() => () => useUi.getState().setHighlight(null), []);

  if (!active || !def || phase === 'menu') return null;
  // En el lanzamiento el centro superior es de la cuenta atrás: el panel va arriba a la derecha.
  const position = phase === 'launch' ? 'right-3 top-14 w-[min(24rem,calc(100vw-1.5rem))]' : 'left-1/2 top-3 w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2';
  const mascot = mascotOn ? mascotDef() : null;
  const exitBtn = (
    <button className="btn !px-2 !py-1 text-xs" onClick={onExit}>
      <LogOut size={12} className="mr-1 inline" />
      {t('academy.exit')}
    </button>
  );

  return (
    <div className={`absolute z-30 ${position}`} data-testid="academy-panel">
      <section className="console-panel p-3" aria-label={lt(def.title)}>
        <header className="mb-2 flex items-center gap-2 border-b border-line pb-2">
          <GraduationCap size={16} className="text-accent" />
          <h2 className="num flex-1 truncate text-xs uppercase tracking-widest text-accent">{lt(def.title)}</h2>
          {!done && <span className="num text-[11px] text-slate-400">{t('academy.stepOf', { n: Math.min(index + 1, steps.length), total: steps.length })}</span>}
          {exitBtn}
        </header>
        <div className="h-1 overflow-hidden rounded bg-[#0a1424]" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={Math.min(index, steps.length)}>
          <div className="h-full bg-accent transition-all" style={{ width: `${(Math.min(index, steps.length) / Math.max(1, steps.length)) * 100}%` }} />
        </div>
        {done ? (
          <div className="mt-3 flex items-start gap-3" role="status" aria-live="polite">
            {mascot && <MascotAvatar mascot={mascot} expression={allDone ? 'celebrating' : 'worried'} size={52} label={lt(mascot.name)} />}
            <div className="flex-1">
              <h3 className={`font-bold ${allDone ? 'text-ok' : 'text-warn'}`}>{allDone ? t('academy.completed') : t('academy.incomplete')}</h3>
              <p className="text-sm text-slate-300">{allDone ? t('academy.completedText') : t('academy.incompleteText')}</p>
              <button className="btn btn-primary mt-2" onClick={onExit}>{t('academy.backToMenu')}</button>
            </div>
          </div>
        ) : step ? (
          <div className="mt-3 flex items-start gap-3">
            {mascot && (
              <MascotAvatar
                mascot={mascot}
                expression={state === 'met' ? 'celebrating' : state === 'todo' ? 'thinking' : 'happy'}
                size={52}
                label={lt(mascot.name)}
              />
            )}
            <div className="min-w-0 flex-1">
              <div role="status" aria-live="polite" aria-atomic="true">
                <h3 className="font-bold">{lt(step.title)}</h3>
                <p className="text-sm leading-snug text-slate-200">{lt(step.body)}</p>
              </div>
              {state === 'waiting' ? (
                <p className="mt-2 text-xs text-warn">{t(`academy.wait.${stepPlace(step)}`)}</p>
              ) : (
                step.goal.type !== 'manual' && <GoalLine step={step} />
              )}
              {notice && (
                <p className="mt-2 rounded border-l-4 border-warn bg-[#0a1424] p-1.5 text-xs text-warn" role="alert">{t(notice)}</p>
              )}
              <div className="mt-2 flex items-center justify-end gap-2">
                {state === 'met' && (
                  <span className="mr-auto flex items-center gap-1 text-xs text-ok" aria-live="polite">
                    <CheckCircle2 size={14} /> {t('academy.met')}
                  </span>
                )}
                {(state === 'manual' || state === 'met') && (
                  <button className="btn btn-primary !py-1 text-sm" onClick={() => useAcademy.getState().complete(step)}>
                    {index === steps.length - 1 ? t('academy.finish') : t('academy.next')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
