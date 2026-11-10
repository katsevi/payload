import { useState } from 'react';
import { BookOpen, CheckCircle2, GraduationCap, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { catalog, computeBudgets, reviewGoNoGo, type Locale, type SimEvent, type ValidationIssue } from '@payload/shared';
import { CREDITS } from '../data/credits';
import { currentLocale, lt, setLocale, tr, tu } from '../i18n';
import { useDesign } from '../state/design';
import { useSettings } from '../state/settings';
import { useProgress } from '../state/progress';
import { useSim } from '../state/sim';
import { useUi } from '../state/ui';
import { MascotHint } from '../mascot/MascotHint';
import { campaignScenarios } from './catalogViews';
import { AdvisorsPanel } from './LearningPanels';
import { Modal, Panel, fmt, useScenario } from './common';
import { TONE_BORDER, TONE_TEXT, eventTone } from './eventTone';
import { RoomEntryScreen } from '../room/RoomEntryScreen';
import { CollaborationSection } from '../room/RoomReview';
import { selectInRoom, useRoom } from '../net/roomStore';
import { useStableCanDo } from '../room/hooks';

export function LanguageSelect() {
  const { t } = useTranslation();
  const cur = currentLocale();
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('menu.language')}>
      {(['es', 'en'] as Locale[]).map((l) => (
        <button key={l} className={`btn ${cur === l ? 'btn-primary' : ''}`} onClick={() => setLocale(l)} aria-pressed={cur === l}>
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}

export function MenuScreen({ onPlay, onAcademy }: { onPlay: (scenarioId: string) => void; onAcademy: () => void }) {
  const { t } = useTranslation();
  const setOverlay = useUi((s) => s.setOverlay);
  const academyDone = useProgress((s) => s.academyDone);
  const [choosing, setChoosing] = useState(false);
  const [team, setTeam] = useState(false);
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-8 overflow-auto p-4">
      <div className="absolute right-4 top-4">
        <LanguageSelect />
      </div>
      {team ? (
        <RoomEntryScreen onBack={() => setTeam(false)} />
      ) : choosing ? (
        <ScenarioSelect onPlay={onPlay} onBack={() => setChoosing(false)} />
      ) : (
        <>
          <div className="rounded-xl bg-black/45 px-8 py-6 text-center backdrop-blur-[2px]">
            <h1 className="num text-6xl font-bold tracking-[0.35em] text-accent drop-shadow-[0_0_18px_rgba(56,225,192,.5)] sm:text-8xl">{t('app.title')}</h1>
            <p className="mt-3 text-slate-300">{t('app.subtitle')}</p>
            <p className="num mt-1 text-xs uppercase tracking-widest text-slate-500">{t('menu.tagline')}</p>
          </div>
          <nav className="flex w-64 flex-col gap-3">
            <button className="btn btn-primary !py-3" onClick={() => setChoosing(true)}>
              {t('menu.play')}
            </button>
            <button className="btn flex items-center justify-center gap-2" onClick={() => setTeam(true)}>
              <Users size={16} />
              {t('room.entry.open')}
            </button>
            <button className="btn flex items-center justify-center gap-2" onClick={onAcademy}>
              <GraduationCap size={16} />
              {t('menu.academy')}
              {academyDone && <CheckCircle2 size={14} className="text-ok" aria-label={t('menu.academyDone')} />}
            </button>
            <button className="btn flex items-center justify-center gap-2" onClick={() => useUi.getState().openGlossary()}>
              <BookOpen size={16} />
              {t('menu.glossary')}
            </button>
            <button className="btn" onClick={() => setOverlay('settings')}>
              {t('menu.settings')}
            </button>
            <button className="btn" onClick={() => setOverlay('credits')}>
              {t('menu.credits')}
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

/** Selección de escenario de campaña (todos los del catálogo salvo la Academia). */
export function ScenarioSelect({ onPlay, onBack }: { onPlay: (scenarioId: string) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const scenarios = campaignScenarios();
  const attempts = useProgress((s) => s.attempts);
  return (
    <div className="w-full max-w-5xl">
      <Panel title={t('scenarios.title')}>
        <p className="mb-4 text-sm text-slate-300">{t('scenarios.intro')}</p>
        {scenarios.length === 0 ? (
          <p className="text-sm text-slate-400">{t('scenarios.empty')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scenarios.map((sc) => (
              <li key={sc.id} className="flex flex-col rounded border border-line bg-[#0a1424] p-3">
                <h3 className="font-bold text-accent">{lt(sc.name)}</h3>
                <dl className="num mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                  <dt className="text-slate-400">{t('scenarios.type')}</dt>
                  <dd>{t(`missionType.${sc.missionType}`)}</dd>
                  <dt className="text-slate-400">{t('briefing.difficulty')}</dt>
                  <dd className={sc.difficulty === 'advanced' ? 'text-bad' : sc.difficulty === 'intermediate' ? 'text-warn' : 'text-ok'}>{t(`difficulty.${sc.difficulty}`)}</dd>
                  <dt className="text-slate-400">{t('briefing.budget')}</dt>
                  <dd>{fmt(sc.budgetMUSD)} {t('unit.musd')}</dd>
                  <dt className="text-slate-400">{t('scenarios.attempts')}</dt>
                  <dd>{attempts[sc.id] ?? 0}</dd>
                </dl>
                {sc.why && <p className="mt-2 flex-1 text-xs text-slate-300">{lt(sc.why)}</p>}
                <button className="btn btn-primary mt-3" onClick={() => onPlay(sc.id)} aria-label={`${t('scenarios.play')}: ${lt(sc.name)}`}>
                  {t('scenarios.play')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <button className="btn" onClick={onBack}>{t('common.back')}</button>
        </div>
      </Panel>
    </div>
  );
}

export function SettingsPanel() {
  const { t } = useTranslation();
  const s = useSettings();
  const close = () => useUi.getState().setOverlay(null);
  const row = 'flex items-center justify-between gap-4 py-2 text-sm';
  return (
    <Modal onClose={close}>
      <Panel title={t('settings.title')}>
        <div className={row}>
          <span>{t('settings.language')}</span>
          <LanguageSelect />
        </div>
        <label className={row}>
          <span>
            {t('settings.fov')} <span className="num text-accent">{s.fov}°</span>
          </span>
          <input type="range" min={50} max={110} step={1} value={s.fov} onChange={(e) => s.set({ fov: Number(e.target.value) })} />
        </label>
        <label className={row}>
          <span>
            {t('settings.sensitivity')} <span className="num text-accent">{s.sensitivity.toFixed(2)}</span>
          </span>
          <input type="range" min={0.2} max={3} step={0.05} value={s.sensitivity} onChange={(e) => s.set({ sensitivity: Number(e.target.value) })} />
        </label>
        <label className={row}>
          <span>{t('settings.headBob')}</span>
          <input type="checkbox" checked={s.headBob} onChange={(e) => s.set({ headBob: e.target.checked })} />
        </label>
        <label className={row}>
          <span>
            {t('settings.accessible2D')}
            <small className="block text-xs text-slate-400">{t('settings.accessible2DHint')}</small>
          </span>
          <input type="checkbox" checked={s.accessible2D} onChange={(e) => s.set({ accessible2D: e.target.checked })} />
        </label>
        <label className={row}>
          <span>{t('settings.shadows')}</span>
          <input type="checkbox" checked={s.shadows} onChange={(e) => s.set({ shadows: e.target.checked })} />
        </label>
        <label className={row}>
          <span>
            {t('settings.mascot')}
            <small className="block text-xs text-slate-400">{t('settings.mascotHint')}</small>
          </span>
          <input type="checkbox" checked={s.mascot} onChange={(e) => s.set({ mascot: e.target.checked })} />
        </label>
        <h3 className="num mt-3 border-t border-line pt-3 text-xs uppercase tracking-widest text-accent">{t('settings.audio')}</h3>
        <label className={row}>
          <span>{t('settings.muteAll')}</span>
          <input type="checkbox" checked={s.muteAll} onChange={(e) => s.set({ muteAll: e.target.checked })} />
        </label>
        {([['volMusic', 'settings.volMusic'], ['volSfx', 'settings.volSfx'], ['volAlerts', 'settings.volAlerts']] as const).map(([key, label]) => (
          <label key={key} className={row}>
            <span>
              {t(label)} <span className="num text-accent">{Math.round(s[key] * 100)} %</span>
            </span>
            <input type="range" min={0} max={1} step={0.05} value={s[key]} disabled={s.muteAll} onChange={(e) => s.set({ [key]: Number(e.target.value) })} />
          </label>
        ))}
        <label className={row}>
          <span>
            {t('settings.soundCaptions')}
            <small className="block text-xs text-slate-400">{t('settings.soundCaptionsHint')}</small>
          </span>
          <input type="checkbox" checked={s.soundCaptions} onChange={(e) => s.set({ soundCaptions: e.target.checked })} />
        </label>
        <div className="mt-4 text-right">
          <button className="btn btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </div>
      </Panel>
    </Modal>
  );
}

export function CreditsScreen() {
  const { t } = useTranslation();
  const close = () => useUi.getState().setOverlay(null);
  return (
    <Modal onClose={close}>
      <Panel title={t('credits.title')}>
        <p className="mb-4 text-sm text-slate-300">{t('credits.intro')}</p>
        <ul className="space-y-3">
          {CREDITS.map((c) => (
            <li key={c.id} className="rounded border border-line p-3 text-sm">
              <div className="font-bold">
                <a className="underline" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{c.title}</a>
              </div>
              <div className="text-slate-300">
                {t('credits.by')}{' '}
                <a className="underline" href={c.authorUrl} target="_blank" rel="noopener noreferrer">{c.author}</a> · {t('credits.source')}
              </div>
              <div className="num text-xs text-accent">
                {t('credits.license')}:{' '}
                <a className="underline" href={c.licenseUrl} target="_blank" rel="noopener noreferrer">{c.license}</a>
              </div>
              <div className="text-xs text-slate-300">{t(c.modifiedKey)}</div>
              {!c.commercialOk && <div className="mt-1 text-xs text-warn">{t('credits.ncnd')}</div>}
              <div className="text-xs text-slate-400">
                {t('credits.usedFor')}: {t(`credits.${c.id}`)}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-right">
          <button className="btn btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </div>
      </Panel>
    </Modal>
  );
}

const START_DESIGN = { type: 'start-design' } as const;

export function BriefingScreen({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const sc = useScenario();
  // En sala: sin «Volver» (se sale desde la barra de equipo) y solo la Dirección empieza el diseño.
  const inRoom = useRoom(selectInRoom);
  const startCheck = useStableCanDo(START_DESIGN);
  const startBlocked = inRoom && startCheck?.kind === 'reject';
  if (!sc) return null;
  const r = sc.requirements;
  const reqs: [string, string][] = [];
  if (r.maxGroundResolutionM != null) reqs.push(['maxGroundResolutionM', `≤ ${fmt(r.maxGroundResolutionM)} ${t('unit.m')}`]);
  if (r.minDownlinkMbitPerDay != null) reqs.push(['minDownlinkMbitPerDay', `≥ ${fmt(r.minDownlinkMbitPerDay)} ${t('unit.mbitDay')}`]);
  reqs.push(['minLifetimeYears', `≥ ${fmt(r.minLifetimeYears)} ${t('unit.years')}`]);
  if (r.maxRevisitDays != null) reqs.push(['maxRevisitDays', `≤ ${fmt(r.maxRevisitDays)} ${t('unit.days')}`]);
  if (r.minScienceValue != null) reqs.push(['minScienceValue', `≥ ${fmt(r.minScienceValue)}`]);
  const orbitNames = catalog.orbits.filter((o) => sc.allowedOrbits.includes(o.id)).map((o) => lt(o.name));
  const launcherNames = catalog.launchers.filter((l) => sc.allowedLaunchers.includes(l.id)).map((l) => lt(l.name));
  return (
    <div className={`absolute inset-0 z-10 flex justify-center overflow-auto p-4 ${inRoom ? 'items-start pt-16' : 'items-center'}`}>
      {/* En sala, una franja central queda libre para ver la sala de control y los avatares. */}
      <div className={`grid w-full gap-4 ${inRoom ? 'max-w-7xl lg:grid-cols-[minmax(0,26rem)_1fr_minmax(0,22rem)]' : 'max-w-5xl md:grid-cols-[1.4fr_1fr]'}`}>
        <Panel title={`${t('briefing.title')} · ${lt(sc.name)}`}>
          <p className="whitespace-pre-line leading-relaxed">{lt(sc.briefing)}</p>
          <p className="num mt-4 text-xs uppercase text-slate-400">
            {t('briefing.difficulty')}: {t(`difficulty.${sc.difficulty}`)}
          </p>
          <MascotHint missionType={sc.missionType} />
        </Panel>
        <div className={`space-y-4 ${inRoom ? 'lg:col-start-3' : ''}`}>
          <Panel title={t('briefing.requirements')}>
            <ul className="space-y-1 text-sm">
              {reqs.map(([k, v]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span>{t(`req.${k}`)}</span>
                  <span className="num text-accent">{v}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={t('briefing.constraints')}>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>{t('briefing.budget')}</span><span className="num text-accent">{fmt(sc.budgetMUSD)} {t('unit.musd')}</span></li>
              <li className="flex justify-between"><span>{t('briefing.devMonths')}</span><span className="num text-accent">{sc.maxDevMonths} {t('briefing.months')}</span></li>
              <li className="flex justify-between"><span>{t('briefing.groundStations')}</span><span className="num text-accent">{sc.groundStations}</span></li>
              <li className="flex justify-between"><span>{t('briefing.operationDays')}</span><span className="num text-accent">{sc.operationDays}</span></li>
              <li><span className="text-slate-400">{t('briefing.orbits')}:</span> {orbitNames.join(', ')}</li>
              <li><span className="text-slate-400">{t('briefing.launchers')}:</span> {launcherNames.join(', ')}</li>
            </ul>
          </Panel>
          <div className="flex gap-3">
            {!inRoom && <button className="btn" onClick={onBack}>{t('common.back')}</button>}
            <button className="btn btn-primary flex-1" onClick={onStart} disabled={startBlocked} title={startCheck?.kind === 'reject' ? tr(startCheck.reason) : undefined}>{t('briefing.start')}</button>
          </div>
          {startBlocked && startCheck?.kind === 'reject' && <p className="text-xs text-warn" role="status">{tr(startCheck.reason)}</p>}
        </div>
      </div>
    </div>
  );
}

const SEV_ORDER = { blocker: 0, warning: 1, info: 2 } as const;
const SEV_COLOR = { blocker: 'text-bad border-bad', warning: 'text-warn border-warn', info: 'text-accent border-accent' } as const;

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  const { t } = useTranslation();
  if (!issues.length) return <p className="text-sm text-slate-400">{t('review.noIssues')}</p>;
  return (
    <ul className="space-y-2">
      {[...issues].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]).map((i, k) => (
        <li key={k} className={`rounded border-l-4 bg-[#0a1424] p-2 text-sm ${SEV_COLOR[i.severity]}`}>
          <span className="num mr-2 text-[10px] uppercase">{t(`review.severity.${i.severity}`)}</span>
          <span className="text-slate-200">{tr(i.message)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReviewScreen({ onBack, onLaunch }: { onBack: () => void; onLaunch: () => void }) {
  const { t } = useTranslation();
  const design = useDesign.getState().design();
  let result = { go: false, issues: [] as ValidationIssue[] };
  try {
    result = reviewGoNoGo(design, catalog);
  } catch {
    /* motor no disponible */
  }
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <Panel title={t('review.title')} className="max-h-full w-full max-w-3xl overflow-auto">
        <div className={`num mb-1 text-4xl font-bold ${result.go ? 'text-ok' : 'text-bad'}`}>{result.go ? t('review.go') : t('review.nogo')}</div>
        <p className="mb-4 text-sm text-slate-300">{result.go ? t('review.goText') : t('review.nogoText')}</p>
        <IssueList issues={result.issues} />
        <AdvisorsPanel className="mt-4 !p-3" />
        <div className="mt-5 flex justify-end gap-3">
          <button className={`btn ${result.go ? '' : 'btn-primary'}`} onClick={onBack}>{t('review.backToHangar')}</button>
          <button className="btn btn-primary" onClick={onLaunch} disabled={!result.go}>{t('review.launch')}</button>
        </div>
      </Panel>
    </div>
  );
}

/**
 * Pantalla de pre-lanzamiento (tras el Go): retraso y/o recorte sorteados con `rollPreLaunchEvents`,
 * y cómo quedan calendario y presupuesto (`computeBudgets(design, cat, preLaunch)`).
 */
const CONFIRM_LAUNCH = { type: 'confirm-launch' } as const;

export function PreLaunchScreen({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();
  const pre = useSim((s) => s.preLaunch);
  // En sala solo la Dirección confirma; los demás esperan (el motivo sale de `canDo`).
  const inRoom = useRoom(selectInRoom);
  const confirm = useStableCanDo(CONFIRM_LAUNCH);
  const waiting = inRoom && confirm?.kind === 'reject';
  if (!pre) return null;
  const design = useDesign.getState().design();
  let rows: { id: string; used: number; available: number; status: string; unit: string }[] = [];
  try {
    const b = computeBudgets(design, catalog, pre);
    rows = b.resources.filter((r) => r.id === 'time' || r.id === 'budget');
  } catch {
    /* motor no disponible */
  }
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <Panel title={t('prelaunch.title')} className="max-h-full w-full max-w-2xl overflow-auto">
        <p className="mb-3 text-sm text-slate-300">{t('prelaunch.intro')}</p>
        <ul className="space-y-2" aria-live="polite">
          {pre.events.map((e, i) => (
            <li key={i} className={`rounded border-l-4 bg-[#0a1424] p-2 text-sm ${TONE_BORDER[eventTone(e.type)]}`}>
              <span className={`num mr-2 text-[10px] uppercase ${TONE_TEXT[eventTone(e.type)]}`}>{t(`event.${e.type}`)}</span>
              {tr(e.message)}
            </li>
          ))}
        </ul>
        <dl className="num mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-400">{t('prelaunch.delay')}</dt>
          <dd className={pre.delayMonths > 0 ? 'text-warn' : ''}>+{fmt(pre.delayMonths)} {t('briefing.months')}</dd>
          <dt className="text-slate-400">{t('prelaunch.cut')}</dt>
          <dd className={pre.budgetCutPct > 0 ? 'text-warn' : ''}>−{fmt(pre.budgetCutPct, 0)}% ({fmt(pre.budgetCutMUSD)} {t('unit.musd')})</dd>
          {rows.map((r) => (
            <PreLaunchRow key={r.id} {...r} />
          ))}
        </dl>
        {pre.overruns.length > 0 && <p className="mt-3 text-sm text-warn">{t('prelaunch.overrun', { list: pre.overruns.map((id) => t(`resources.${id}`)).join(', ') })}</p>}
        <div className="mt-5 flex justify-end">
          {waiting && <span className="mr-4 self-center text-sm text-warn" role="status">{t('room.prelaunch.waiting', { role: t('room.role.director') })}</span>}
          <button className="btn btn-primary" onClick={onContinue} autoFocus disabled={waiting}>{t('prelaunch.continue')}</button>
        </div>
      </Panel>
    </div>
  );
}

function PreLaunchRow({ id, used, available, status, unit }: { id: string; used: number; available: number; status: string; unit: string }) {
  const { t } = useTranslation();
  return (
    <>
      <dt className="text-slate-400">{t(`resources.${id}`)}</dt>
      <dd className={status === 'over' ? 'text-bad' : status === 'tight' ? 'text-warn' : 'text-ok'}>
        {fmt(used)} / {fmt(available)} {tu(unit)}
      </dd>
    </>
  );
}

/** Eventos relevantes de la misión en orden cronológico (sin eclipses ni contactos). */
const NOISY_REPORT = new Set(['eclipse-enter', 'eclipse-exit', 'contact-start', 'contact-end']);
export function reportEvents(events: readonly SimEvent[], max = 40): SimEvent[] {
  return events.filter((e) => !NOISY_REPORT.has(e.type)).slice(0, max);
}

const bar = (v: number) => Math.max(0, Math.min(100, v));

const REDESIGN = { type: 'redesign' } as const;

export function ReportScreen({ onRedesign, onMenu }: { onRedesign: () => void; onMenu: () => void }) {
  const { t } = useTranslation();
  const result = useSim((s) => s.result);
  const inRoom = useRoom(selectInRoom);
  const redesign = useStableCanDo(REDESIGN);
  const redesignBlocked = inRoom && redesign?.kind === 'reject';
  // En sala, el número grande y las barras son la puntuación de EQUIPO (con la colaboración real).
  const teamScore = useRoom((s) => s.view?.teamScore ?? null);
  const score = inRoom && teamScore ? teamScore : result?.score;
  const w = score?.weights;
  const wsum = w ? w.objectives + w.science + w.efficiency + w.collaboration : 1;
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center overflow-auto p-4">
      <div className="w-full max-w-5xl space-y-4 py-6">
        <h1 className="num text-2xl uppercase tracking-widest text-accent">{t('report.title')}</h1>
        {!result ? (
          <Panel><p>{t('report.noSim')}</p></Panel>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
              <Panel title={inRoom && teamScore ? t('room.report.teamScore') : t('report.total')}>
                <div className="num text-7xl font-bold text-accent">{fmt(score!.total, 0)}<span className="text-2xl text-slate-400"> / 100</span></div>
                {inRoom && teamScore && <p className="num text-xs text-slate-400">{t('room.report.missionScore')}: {fmt(result.score.total, 0)}</p>}
                <ul className="mt-4 space-y-3">
                  {(['objectives', 'science', 'efficiency', 'collaboration'] as const).map((k) => (
                    <li key={k}>
                      <div className="flex justify-between text-xs">
                        <span>{t(`report.${k}`)} <span className="text-slate-500">({t('report.weight')} {fmt((score!.weights[k] / (wsum || 1)) * 100, 0)}%)</span></span>
                        <span className="num">{fmt(score![k], 0)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded bg-[#0a1424]"><div className="h-full rounded bg-accent" style={{ width: `${bar(score![k])}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title={t('report.dataSummary')}>
                <dl className="num grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-slate-400">{t('report.launchResult')}</dt>
                  <dd className={result.launchSuccess ? 'text-ok' : 'text-bad'}>{result.launchSuccess ? t('report.launchOk') : t('report.launchFail')}</dd>
                  <dt className="text-slate-400">{t('operation.seed')}</dt>
                  <dd>{result.seed}</dd>
                  <dt className="text-slate-400">{t('report.status')}</dt>
                  <dd>{t(`operation.status.${result.status}`)}</dd>
                  <dt className="text-slate-400">{t('report.daysOperated')}</dt>
                  <dd>{fmt(result.daysOperated)}</dd>
                  <dt className="text-slate-400">{t('operation.dataDownlinked')}</dt>
                  <dd>{fmt(result.dataDownlinkedMbit, 0)} {t('operation.mbit')}</dd>
                  <dt className="text-slate-400">{t('operation.dataLost')}</dt>
                  <dd className={result.dataLostMbit > 0 ? 'text-warn' : ''}>{fmt(result.dataLostMbit, 0)} {t('operation.mbit')}</dd>
                  <dt className="text-slate-400">{t('report.minBattery')}</dt>
                  <dd>{fmt(result.minBatteryPct, 0)}%</dd>
                </dl>
              </Panel>
            </div>
            {inRoom && <CollaborationSection />}
            <Panel title={t('report.events')}>
              {result.preLaunch && (result.preLaunch.delayMonths > 0 || result.preLaunch.budgetCutPct > 0) && (
                <p className="num mb-2 text-xs text-warn">
                  {t('report.preLaunchSummary', { months: fmt(result.preLaunch.delayMonths), pct: fmt(result.preLaunch.budgetCutPct, 0) })}
                </p>
              )}
              {reportEvents(result.events).length === 0 ? (
                <p className="text-sm text-slate-400">{t('operation.noEvents')}</p>
              ) : (
                <ul className="num max-h-56 space-y-1 overflow-auto text-xs">
                  {reportEvents(result.events).map((e, i) => (
                    <li key={i} className={TONE_TEXT[eventTone(e.type)]}>
                      <span className="text-slate-500">{t('operation.dayShort')}{fmt(e.tSeconds / 86400, 2)}</span> {tr(e.message)}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={t('report.chain')}>
              <ul className="space-y-3">
                {result.report.map((e, i) => (
                  <li key={i} className={`rounded border-l-4 bg-[#0a1424] p-3 text-sm ${e.severity === 'failure' ? 'border-bad' : e.severity === 'warning' ? 'border-warn' : e.severity === 'success' ? 'border-ok' : 'border-accent'}`}>
                    <div className="font-bold"><span className="num mr-2 text-[10px] uppercase text-slate-400">{t(`report.sev.${e.severity}`)}</span>{tr(e.message)}</div>
                    {e.causes.length > 0 && (
                      <ol className="mt-1 list-none space-y-0.5 pl-3 text-slate-300">
                        {e.causes.map((c, j) => (
                          <li key={j}>↳ <span className="text-slate-500">{t('report.because')}</span> {tr(c)}</li>
                        ))}
                      </ol>
                    )}
                    {e.suggestion && <p className="mt-1 text-accent">{t('report.suggestion')}: {tr(e.suggestion)}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        )}
        <div className="flex justify-end gap-3">
          <button className="btn" onClick={onMenu}>{inRoom ? t('room.leave') : t('report.menu')}</button>
          <button className="btn btn-primary" onClick={onRedesign} disabled={redesignBlocked} title={redesignBlocked ? t('room.report.onlyDirector') : undefined}>{t('report.redesign')}</button>
        </div>
      </div>
    </div>
  );
}
