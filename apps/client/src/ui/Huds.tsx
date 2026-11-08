import { useMemo } from 'react';
import { Crosshair, HelpCircle, Settings as SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { catalog } from '@payload/shared';
import { lt, tr } from '../i18n';
import { useDesign } from '../state/design';
import { useLaunch } from '../state/launch';
import { TIME_SCALES, useSim, type LoggedEvent, type TimeScale } from '../state/sim';
import { useUi } from '../state/ui';
import { IssueList } from './Screens';
import { LimitingSummary, MissionSelectors } from './DesignPanel';
import { Modal, Panel, fmt, useScenario, usePointerLocked } from './common';
import { ResourcePanel } from './ResourcePanel';
import type { PhaseName } from '../app/missionMachine';

export function TopBar({ phase }: { phase: PhaseName }) {
  const { t } = useTranslation();
  const setOverlay = useUi((s) => s.setOverlay);
  const toggleHelp = useUi((s) => s.toggleHelp);
  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
      <span className="num hidden text-xs uppercase tracking-widest text-slate-400 sm:inline">{t(`phase.${phase}`)}</span>
      <button className="btn !p-2" onClick={toggleHelp} aria-label={t('common.help')} title={`${t('common.help')} (H)`}>
        <HelpCircle size={16} />
      </button>
      <button className="btn !p-2" onClick={() => setOverlay('settings')} aria-label={t('common.settings')} title={t('common.settings')}>
        <SettingsIcon size={16} />
      </button>
    </div>
  );
}

const HELP_KEY: Record<PhaseName, string> = {
  menu: 'menu', briefing: 'briefing', design: 'hangar', review: 'review', launch: 'launch', operation: 'operation', report: 'report',
};

export function HelpOverlay({ phase }: { phase: PhaseName }) {
  const { t } = useTranslation();
  const help = useUi((s) => s.help);
  return (
    <>
      {help && (
        <div className="absolute bottom-14 left-3 z-30 max-w-lg">
          <Panel title={t('help.title')}>
            <p className="text-sm leading-relaxed">{t(`help.${HELP_KEY[phase]}`)}</p>
          </Panel>
        </div>
      )}
      <div className="num pointer-events-none absolute bottom-3 left-3 z-20 text-xs text-slate-400">
        <span className="kbd">H</span> {t('common.help')}
      </div>
    </>
  );
}

export function HangarHud({ onReview }: { onReview: () => void }) {
  const { t } = useTranslation();
  const locked = usePointerLocked();
  const overlay = useUi((s) => s.overlay);
  const prompt = useUi((s) => s.prompt);
  const resourcesOpen = useUi((s) => s.resourcesOpen);
  const view = useUi((s) => s.view);
  const heldId = useDesign((s) => s.heldId);
  const issues = useDesign((s) => s.lastIssues);
  const held = heldId ? catalog.components.find((c) => c.id === heldId) : undefined;
  const setOverlay = useUi((s) => s.setOverlay);
  return (
    <>
      {view === 'first' && locked && <Crosshair className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-white/70" size={20} />}
      {!locked && overlay === null && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-10 -translate-x-1/2 rounded border border-line bg-panel/85 px-4 py-2 text-sm">{t('hangar.capture')}</div>
      )}
      <div className="pointer-events-none absolute left-3 top-3 z-10 space-y-2">
        <div className="console-panel num px-3 py-1.5 text-xs uppercase tracking-widest text-accent">{t('hangar.title')}</div>
        <div className="console-panel px-3 py-1.5 text-xs">
          <span className="text-slate-400">{held ? t('hangar.holding') : t('hangar.empty')}</span>
          {held && <span className="ml-2 text-accent">{lt(held.name)}</span>}
        </div>
        {issues.length > 0 && (
          <Panel title={t('hangar.noGoReasons')} className="max-w-sm !p-3">
            <IssueList issues={issues} />
          </Panel>
        )}
      </div>
      {prompt && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded border border-accent bg-panel/90 px-4 py-2 text-sm">
          <span className="kbd mr-2">E</span>
          {t(prompt.key)}
          {prompt.name && <span className="ml-2 text-accent">{prompt.name}</span>}
        </div>
      )}
      {resourcesOpen && (
        <div className="pointer-events-none absolute right-3 top-14 z-10 max-h-[80vh] w-80 overflow-hidden">
          <ResourcePanel />
        </div>
      )}
      <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
        <div className="num text-[11px] text-slate-400">
          <span className="kbd">WASD</span> {t('keys.move')} · <span className="kbd">V</span> {t('keys.view')} · <span className="kbd">E</span> {t('keys.interact')} · <span className="kbd">Tab</span> {t('keys.resources')}
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setOverlay('console')}>{t('hangar.console')}</button>
          <button className="btn btn-primary" onClick={onReview}>{t('hangar.requestReview')}</button>
        </div>
      </div>
    </>
  );
}

/** Consola de misión (E junto al terminal): órbita, lanzador y revisión. */
export function ConsoleModal({ onReview }: { onReview: () => void }) {
  const { t } = useTranslation();
  const close = () => useUi.getState().setOverlay(null);
  return (
    <Modal onClose={close}>
      <Panel title={t('hangar.console')}>
        <MissionSelectors />
        <div className="mt-3">
          <LimitingSummary />
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button className="btn" onClick={close}>{t('hangar.backToConsole')}</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              close();
              onReview();
            }}
          >
            {t('hangar.requestReview')}
          </button>
        </div>
      </Panel>
    </Modal>
  );
}

export function LaunchHud({ onSkip }: { onSkip: () => void }) {
  const { t } = useTranslation();
  const { phase, count } = useLaunch();
  const view = useUi((s) => s.view);
  const ok = useSim((s) => s.launchOk);
  const label =
    phase === 'countdown' ? `${t('launch.countdown')}${count}`
    : phase === 'ascent' ? t('launch.liftoff')
    : phase === 'separation' ? t('launch.stageSep')
    : phase === 'failure' ? t('launch.failure')
    : t('launch.success');
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-10 z-10 text-center">
        <div className={`num text-6xl font-bold ${phase === 'failure' ? 'text-bad' : 'text-accent'} drop-shadow-lg`}>{label}</div>
        <div className="num mt-2 text-xs uppercase tracking-widest text-slate-300">{t('launch.title')} · {view === 'third' ? t('launch.chase') : t('launch.tower')}</div>
        {phase === 'countdown' && ok === false && <span className="sr-only">{t('launch.standby')}</span>}
      </div>
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-3">
        <span className="num text-[11px] text-slate-400"><span className="kbd">V</span> {t('keys.view')}</span>
        <button className="btn" onClick={onSkip}>{t('launch.skip')}</button>
      </div>
    </>
  );
}

/** Eclipse y contacto ocurren cientos de veces: ya los muestra el HUD, así que el registro solo lista el resto (últimos 30, el más reciente primero). */
const NOISY = new Set(['eclipse-enter', 'eclipse-exit', 'contact-start', 'contact-end']);
export function importantEvents(events: LoggedEvent[], max = 30): LoggedEvent[] {
  const out: LoggedEvent[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < max; i--) {
    const e = events[i]!;
    if (!NOISY.has(e.type)) out.push(e);
  }
  return out;
}

function Meter({ label, value, unit, pct, tone = 'text-accent' }: { label: string; value: string; unit?: string; pct?: number; tone?: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-slate-400">{label}</span><span className={`num ${tone}`}>{value} {unit}</span></div>
      {pct != null && <div className="mt-1 h-1.5 rounded bg-[#0a1424]"><div className="h-full rounded bg-accent" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>}
    </div>
  );
}

const SCALE_LABEL: Record<TimeScale, string> = { 0: '❚❚', 1: '1×', 10: '10×', 100: '100×', 1000: '1000×', 10000: '10 000×' };

export function OperationHud({ onFinish }: { onFinish: () => void }) {
  const { t } = useTranslation();
  const snap = useSim((s) => s.snapshot);
  const events = useSim((s) => s.events);
  const accel = useSim((s) => s.accel);
  const finished = useSim((s) => s.finished);
  const seed = useSim((s) => s.seed);
  const setAccel = useSim((s) => s.setAccel);
  const view = useUi((s) => s.view);
  const sc = useScenario();
  const logEvents = useMemo(() => importantEvents(events), [events]);
  const hasPayload = useDesign((s) => s.componentIds.some((id) => catalog.components.find((c) => c.id === id)?.subsystem === 'payload'));
  if (!snap) return null;
  const capturing = view === 'first' && hasPayload && !snap.inEclipse;
  return (
    <>
      {view === 'first' && (
        <div className="pointer-events-none absolute inset-8 z-10 border border-accent/60">
          <div className="num absolute left-2 top-2 text-xs text-accent">{t('operation.viewfinder')}</div>
          <div className={`num absolute right-2 top-2 text-xs ${capturing ? 'text-ok' : 'text-slate-400'}`}>● {capturing ? t('operation.capturing') : t('operation.idle')}</div>
          <Crosshair className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent/70" size={48} />
        </div>
      )}
      <div className="absolute left-3 top-3 z-20 w-72 space-y-3">
        <Panel title={t('operation.title')} className="!p-3">
          <div className="num mb-1 flex justify-between text-[11px] text-slate-400">
            <span>{t('operation.seed')}</span>
            <span>{seed}</span>
          </div>
          <div className="num flex justify-between text-sm">
            <span>{t('operation.day')}</span>
            <span className="text-accent">{fmt(snap.day, 1)}{sc ? ` ${t('operation.of')} ${sc.operationDays}` : ''}</span>
          </div>
          <div className="mt-2 space-y-2">
            <Meter label={t('operation.battery')} value={fmt(snap.batteryPct, 0)} unit="%" pct={snap.batteryPct} tone={snap.batteryPct < 25 ? 'text-bad' : 'text-accent'} />
            <Meter label={t('operation.dataStored')} value={fmt(snap.dataStoredMbit, 0)} unit={t('operation.mbit')} />
            <Meter label={t('operation.dataDownlinked')} value={fmt(snap.dataDownlinkedMbit, 0)} unit={t('operation.mbit')} tone="text-ok" />
            <Meter label={t('operation.dataLost')} value={fmt(snap.dataLostMbit, 0)} unit={t('operation.mbit')} tone={snap.dataLostMbit > 0 ? 'text-bad' : 'text-slate-300'} />
          </div>
          <div className="num mt-3 flex gap-2 text-[11px] uppercase">
            <span className={`rounded border px-2 py-0.5 ${snap.inContact ? 'border-ok text-ok' : 'border-line text-slate-500'}`}>{snap.inContact ? t('operation.contact') : t('operation.noContact')}</span>
            <span className={`rounded border px-2 py-0.5 ${snap.inEclipse ? 'border-warn text-warn' : 'border-line text-accent'}`}>{snap.inEclipse ? t('operation.eclipse') : t('operation.sunlight')}</span>
            <span className="rounded border border-line px-2 py-0.5 text-slate-300">{t(`operation.status.${snap.status}`)}</span>
          </div>
        </Panel>
      </div>
      <div className="absolute bottom-14 left-3 z-20 w-80">
        <Panel title={t('operation.log')} className="!p-3">
          <ul className="num max-h-40 space-y-1 overflow-auto text-[11px]" aria-live="polite">
            {logEvents.length === 0 && <li className="text-slate-500">{t('operation.noEvents')}</li>}
            {logEvents.map((e) => (
              <li key={e.id}>
                <span className="text-slate-500">{t('operation.dayShort')}{fmt(e.tSeconds / 86400, 2)}</span> {tr(e.message)}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
        {finished && <div className="console-panel px-3 py-2 text-sm text-accent">{t('operation.ended')}</div>}
        <div className="flex flex-wrap justify-end gap-1" role="group" aria-label={t('operation.time')}>
          {TIME_SCALES.map((s) => (
            <button key={s} className={`btn !px-2.5 ${accel === s ? 'btn-primary' : ''}`} onClick={() => setAccel(s)} disabled={finished} aria-pressed={accel === s} aria-label={s === 0 ? t('operation.pause') : undefined}>
              {SCALE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-[11px] text-slate-400"><span className="kbd">V</span> {view === 'third' ? t('operation.view.third') : t('operation.view.first')}</span>
          <button className="btn btn-primary" onClick={onFinish}>{t('operation.finish')}</button>
        </div>
      </div>
    </>
  );
}
