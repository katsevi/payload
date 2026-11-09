import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Crosshair, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { catalog, computeBudgets } from '@payload/shared';
import { lt } from '../i18n';
import { useDesign } from '../state/design';
import { getLiveSnapshot, useSim } from '../state/sim';
import { useUi } from '../state/ui';
import { Panel, fmt, useScenario } from '../ui/common';
import { createBuffers, renderFrame } from './instrumentRender';
import { instrumentState, instrumentTarget, mainInstrument, payloadCountOf, surfaceKind, type InstrumentCondition } from './instrumentLogic';

const SurfaceScene = lazy(() => import('../scenes/SurfaceScene').then((m) => ({ default: m.SurfaceScene })));

const TONE: Record<InstrumentCondition, string> = {
  nominal: 'text-ok border-ok',
  eclipse: 'text-warn border-warn',
  degraded: 'text-warn border-warn',
  lost: 'text-bad border-bad',
  noInstrument: 'text-slate-400 border-line',
};

/**
 * Vista a través del instrumento principal (primera persona, tecla I). Pinta en un Canvas 2D lo que
 * vería el sensor y refleja el estado del motor: eclipse = imagen oscura; apuntado degradado (rueda de
 * reacción o ADCS averiados) = desenfoque y temblor; instrumento perdido = sin señal. Todo con texto.
 */
export function InstrumentView() {
  const { t } = useTranslation();
  const snap = useSim((s) => s.snapshot);
  const events = useSim((s) => s.events);
  const pre = useSim((s) => s.preLaunch);
  const surfaceOpen = useUi((s) => s.surface);
  const ids = useDesign((s) => s.componentIds);
  const scenarioId = useDesign((s) => s.scenarioId);
  const orbitId = useDesign((s) => s.orbitId);
  const launcherId = useDesign((s) => s.launcherId);
  const sc = useScenario();

  const target = instrumentTarget(sc?.missionType);
  const main = useMemo(() => mainInstrument(ids), [ids]);
  const surface = surfaceKind(sc?.missionType, ids);
  const resolutionM = useMemo(() => {
    try {
      return computeBudgets({ scenarioId, componentIds: ids, orbitId, launcherId }, catalog, pre ?? undefined).totals.groundResolutionM;
    } catch {
      return null;
    }
  }, [scenarioId, ids, orbitId, launcherId, pre]);

  const state = instrumentState({
    payloadCount: payloadCountOf(ids),
    requiredPointingDeg: main?.requiredPointingDeg,
    inEclipse: snap?.inEclipse ?? false,
    status: snap?.status ?? 'nominal',
    events,
  });

  // Dibujo a ~20 fps leyendo el snapshot vivo; el estado visual (oscuro/borroso) lo pone CSS.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lostRef = useRef(state.lost);
  lostRef.current = state.lost;
  useEffect(() => {
    const canvas = canvasRef.current;
    const buf = createBuffers();
    const g = canvas?.getContext('2d');
    if (!canvas || !g || !buf) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 48 || document.hidden) return;
      last = now;
      const live = getLiveSnapshot();
      renderFrame(g, canvas.width, canvas.height, buf, target, live?.orbitPhase ?? 0, now / 1000, lostRef.current);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const filter = state.dark ? 'brightness(0.1) saturate(0.6)' : state.degraded ? 'blur(3px) saturate(0.85)' : undefined;
  const exit = () => useUi.getState().setInstrument(false);

  return (
    <div className="absolute inset-0 z-[12] bg-black" role="region" aria-label={t('instrument.title')}>
      <canvas
        ref={canvasRef}
        width={960}
        height={540}
        aria-hidden="true"
        className={`h-full w-full object-cover transition-[filter] duration-500 ${state.degraded ? 'instrument-shake' : ''}`}
        style={{ filter }}
      />
      {/* Retículo y marco del visor */}
      <div className="pointer-events-none absolute inset-6 border border-accent/50">
        <Crosshair className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent/80" size={56} strokeWidth={1.2} />
        <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/30" />
        <div className="num absolute left-2 top-2 text-xs text-accent">{t('instrument.viewfinder')}</div>
        {resolutionM != null && state.condition !== 'lost' && (
          <div className="num absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-accent">
            {t('instrument.scale', { res: fmt(resolutionM, 1) })}
          </div>
        )}
      </div>
      {state.lost && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="num rounded border border-bad bg-black/70 px-6 py-3 text-lg uppercase tracking-widest text-bad">
            {t(state.lostReason === 'mission' ? 'instrument.lost.mission' : 'instrument.lost.payload')}
          </div>
        </div>
      )}
      {state.dark && (
        <div className="num pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded border border-warn bg-black/70 px-4 py-1 text-sm uppercase tracking-widest text-warn">
          {t('instrument.eclipseBanner')}
        </div>
      )}

      {/* Panel de lecturas */}
      <div className="absolute right-3 top-16 z-20 w-72">
        <Panel title={t('instrument.title')} className="!p-3">
          <dl className="space-y-1.5 text-xs">
            <Row label={t('instrument.instrument')} value={main ? lt(main.name) : t('common.none')} />
            <Row label={t('instrument.looking')} value={t(`instrument.target.${target}`)} />
            <Row
              label={t('instrument.groundRes')}
              value={resolutionM != null ? `${fmt(resolutionM, 1)} ${t('unit.m')}` : t('instrument.noResolution')}
            />
          </dl>
          <div className={`num mt-3 inline-block rounded border px-2 py-0.5 text-[11px] uppercase ${TONE[state.condition]}`}>
            {t(`instrument.condition.${state.condition}`)}
          </div>
          <p className="mt-2 text-xs leading-snug text-slate-300" aria-live="polite">
            {t(`instrument.hint.${state.condition}`)}
          </p>
          {snap && (
            <dl className="mt-3 space-y-1.5 border-t border-line pt-2 text-xs">
              <Row label={t('operation.dataStored')} value={`${fmt(snap.dataStoredMbit, 0)} ${t('operation.mbit')}`} />
              <Row label={t('operation.dataDownlinked')} value={`${fmt(snap.dataDownlinkedMbit, 0)} ${t('operation.mbit')}`} tone="text-ok" />
              <Row label={t('operation.dataLost')} value={`${fmt(snap.dataLostMbit, 0)} ${t('operation.mbit')}`} tone={snap.dataLostMbit > 0 ? 'text-bad' : undefined} />
            </dl>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {surface && (
              <button className="btn btn-primary !px-3 !py-1.5" onClick={() => useUi.getState().setSurface(true)}>
                {t('instrument.openSurface')}
              </button>
            )}
            <button className="btn !px-3 !py-1.5" onClick={exit}>
              <span className="kbd mr-1">I</span>
              {t('instrument.exit')}
            </button>
          </div>
        </Panel>
      </div>

      {surface && surfaceOpen && (
        <div className="absolute inset-0 z-[14] bg-black">
          <Suspense fallback={<div className="num p-6 text-sm text-slate-400">{t('common.loading')}</div>}>
            <SurfaceScene kind={surface} />
          </Suspense>
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 text-center">
            <div className="num text-sm uppercase tracking-widest text-accent">{t(`surface.title.${surface}`)}</div>
            <p className="mt-1 max-w-md text-xs text-slate-300">{t('surface.description')}</p>
          </div>
          <button className="btn absolute right-3 top-3 z-10 !p-2" onClick={() => useUi.getState().setSurface(false)} aria-label={t('surface.close')} title={t('surface.close')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`num text-right ${tone ?? 'text-accent'}`}>{value}</dd>
    </div>
  );
}
