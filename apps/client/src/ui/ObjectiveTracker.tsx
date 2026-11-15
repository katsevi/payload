/**
 * Objetivo actual en el HUD (abajo a la derecha), en vuelo, en tierra y en la sala: qué toca ahora, cuánto falta, en qué
 * puesto y, desplegado (tecla O), la lista de pasos. Todo sale de `currentObjective` del motor (vale igual con el estado
 * hidratado del cooperativo); aquí solo se decide cómo se ve (`game/objectiveGuide.ts`).
 *
 * - Al zarpar y cada vez que cambia el paso actual: aviso breve «Nuevo objetivo» encima del panel (no bloquea).
 * - Paso cumplido: «Hecho» + `cue('objective')` (sonido, destello y subtítulo).
 * - Escribe `hudView.objStation` (puesto que pide el paso) para el cartel 3D y la flecha de la nave.
 * - Con la misión terminada o perdida no se pinta: manda la pantalla final.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Circle, CircleCheck, CircleDot, Crosshair, MapPin } from 'lucide-react';
import { currentObjective, getMissions, type ObjectiveStep, type ObjectiveView, type RunState } from '@payload/shared';
import { cue } from '../audio/cues';
import { defaultExpanded, guideStation, memoOf, objectiveNotices, progressView, stationLabel, type ObjectiveMemo } from '../game/objectiveGuide';
import { getRun, useGame } from '../game/runStore';
import { tr } from '../i18n';
import { useSettings } from '../state/settings';
import { hudView } from '../state/ui';
import { SegBar } from './kit';

/** Lo que dura el aviso de objetivo nuevo o cumplido. */
const NOTICE_MS = 5000;

interface Notice {
  id: number;
  done: ObjectiveStep | null;
  next: ObjectiveStep | null;
}

const isTyping = (e: KeyboardEvent): boolean => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

function isGuidedRun(s: RunState): boolean {
  const id = s.missionDesign?.missionId;
  return !!id && !!getMissions(getRun()?.catalog).find((m) => m.id === id)?.guided;
}

/** Objetivo de la partida en curso (se recalcula con cada copia del HUD, ~10 Hz; es barato). */
export function useObjective(): ObjectiveView | null {
  const s = useGame((g) => g.hud);
  return useMemo(() => (s ? currentObjective(s, getRun()?.catalog) : null), [s]);
}

/** Avisos de objetivo nuevo / cumplido: compara con la vista anterior de la misma partida. */
function useNotices(view: ObjectiveView | null, runId: number): Notice | null {
  const memo = useRef<{ runId: number; memo: ObjectiveMemo } | null>(null);
  const seq = useRef(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!view) return;
    const prev = memo.current && memo.current.runId === runId ? memo.current.memo : null;
    memo.current = { runId, memo: memoOf(view) };
    const list = objectiveNotices(prev, view);
    if (list.length === 0) return;
    let done: ObjectiveStep | null = null;
    let next: ObjectiveStep | null = null;
    for (const n of list) {
      if (n.kind === 'done') done = n.step;
      else if (n.kind === 'new') next = n.step;
      else next = view.steps[view.current] ?? null;
    }
    if (done) cue('objective');
    setNotice({ id: ++seq.current, done, next });
  }, [view, runId]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);
  return notice;
}

function StationTag({ view, s }: { view: ObjectiveView; s: RunState }) {
  const { t } = useTranslation();
  const station = guideStation(view, s.phase);
  if (!station) return null;
  const label = stationLabel(station, !!s.missionDesign);
  const name = label.ns === 'sim' ? t(label.key, { ns: 'sim' }) : t(label.key);
  return (
    <span className="tag !normal-case !tracking-normal flex items-center gap-1 self-start text-accent">
      <MapPin size={12} aria-hidden="true" />
      {t('objective.goTo', { station: name })}
    </span>
  );
}

function StepProgress({ step }: { step: ObjectiveStep }) {
  const { t } = useTranslation();
  if (!step.progress) return null;
  const p = progressView(step.progress);
  return (
    <div className="flex items-center gap-2">
      <SegBar pct={p.frac * 100} seg={4} className="h-1.5 flex-1" />
      <span className="num shrink-0 text-[11px] text-slate-200">{t(p.key, p.params)}</span>
    </div>
  );
}

function StepList({ view }: { view: ObjectiveView }) {
  const { t } = useTranslation();
  return (
    <ol className="mt-1 flex flex-col gap-1 border-t border-line pt-1.5 text-xs" aria-label={t('objective.steps')}>
      {view.steps.map((st) => (
        <li key={st.id} className={`flex items-start gap-1.5 ${st.active ? 'font-semibold text-accent' : st.done ? 'text-ok' : 'text-slate-400'}`}>
          <span className="mt-px shrink-0" aria-hidden="true">
            {st.done ? <CircleCheck size={13} /> : st.active ? <CircleDot size={13} /> : <Circle size={13} />}
          </span>
          <span className="min-w-0">
            {tr(st.text)}
            {st.optional && <span className="ml-1 font-normal text-slate-400">· {t('objective.optional')}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ObjectiveTracker() {
  const { t } = useTranslation();
  const s = useGame((g) => g.hud);
  const runId = useGame((g) => g.runId);
  const showGuide = useSettings((x) => x.objectiveGuide);
  const view = useObjective();
  const notice = useNotices(view, runId);
  const [manual, setManual] = useState<boolean | null>(null);
  useEffect(() => setManual(null), [runId]);
  const auto = !!view && !!s && defaultExpanded(view, isGuidedRun(s), showGuide, s.sector.index);
  const expanded = manual ?? auto;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // Tecla O: lista completa / solo el paso actual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyO' || e.repeat || isTyping(e)) return;
      setManual(!expandedRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Puesto del paso actual para la escena (cartel 3D y flecha); se escribe solo al cambiar la vista.
  const station = view && s ? guideStation(view, s.phase) : null;
  useEffect(() => {
    hudView.objStation = station;
  }, [station]);
  useEffect(
    () => () => {
      hudView.objStation = null;
      hudView.objOn = false;
    },
    [],
  );

  if (!s || !view || view.status !== 'active') return null;
  const step = view.current >= 0 ? view.steps[view.current] : undefined;
  return (
    <div className="absolute bottom-3 right-3 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col items-stretch gap-1.5">
      {notice && (
        <div key={notice.id} className="toast ui-enter flex flex-col gap-0.5 text-accent" role="status" aria-live="polite">
          {notice.done && (
            <span className="flex items-center gap-1.5 text-xs text-ok">
              <Check size={13} aria-hidden="true" />
              <span className="label-code !text-ok">{t('objective.done')}</span>
              <span className="truncate text-slate-200">{tr(notice.done.text)}</span>
            </span>
          )}
          {notice.next && (
            <span className="flex flex-col">
              <span className="label-code !text-accent">{t('objective.new')}</span>
              <span className="text-sm text-slate-50">{tr(notice.next.text)}</span>
            </span>
          )}
        </div>
      )}
      <section className="hud-frame flex flex-col gap-1 p-3" aria-label={t('objective.label')}>
        <div className="-mt-1 flex items-center gap-2">
          <Crosshair size={12} className="text-accent" aria-hidden="true" />
          <span className="label-code !text-[10px] !text-accent">{t('objective.label')}</span>
          <span className="ticks flex-1 opacity-60" aria-hidden="true" />
          <span className="inline-flex items-center gap-1">
            <span className="kbd !text-[10px]">{t('keys.objective')}</span>
            <span className="label-code !text-[10px]">{t('objective.steps')}</span>
          </span>
        </div>
        <p className="truncate text-[11px] text-slate-300" title={tr(view.title)}>
          {tr(view.title)}
        </p>
        {step && (
          <>
            <p className="text-sm font-semibold leading-snug text-slate-50">{tr(step.text)}</p>
            <StepProgress step={step} />
            {(showGuide || view.awaitingNextSector) && step.hint && <p className="text-xs leading-snug text-slate-300">{tr(step.hint)}</p>}
            <StationTag view={view} s={s} />
          </>
        )}
        {expanded && <StepList view={view} />}
      </section>
    </div>
  );
}
