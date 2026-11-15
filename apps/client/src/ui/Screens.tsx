import { countermeasures } from '../game/sanityFx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ChevronRight, CircleCheck, CircleX, CloudLightning, Drill, Flame, Mountain, Navigation, Wind, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { catalog as defaultCatalog, currentObjective, getPsychRules, missionReport, type Locale, type MissionReport } from '@payload/shared';
import { CREDITS } from '../data/credits';
import { getRun, useGame } from '../game/runStore';
import { currentLocale, setLocale, tr } from '../i18n';
import { sendLobby } from '../net/coopSession';
import { mePlayer, useCoop } from '../net/coopStore';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { Modal, Panel, fmt } from './common';
import { distanceText } from './names';
import { Button, KeyHint, SectionLabel, StatRow } from './kit';

export function LanguageSelect() {
  const { t } = useTranslation();
  const cur = currentLocale();
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('menu.language')}>
      {(['es', 'en'] as Locale[]).map((l) => (
        <button
          key={l}
          className="seg-option chip num px-2.5 py-1 text-xs font-semibold tracking-widest"
          onClick={() => setLocale(l)}
          aria-pressed={cur === l}
          aria-label={t(`lang.${l}`)}
          title={t(`lang.${l}`)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

type MenuEntry = { id: 'mission' | 'free' | 'coop' | 'help' | 'settings' | 'credits'; label: string; run: () => void; primary?: boolean };

/**
 * Menú principal: fondo 3D vivo (`MenuScene`), logotipo tipográfico, navegación lateral con índice y una ficha con
 * la descripción de la entrada señalada. Ratón y teclado (↑↓ + Intro); la entrada señalada es la que tiene el foco.
 */
export function MenuScreen() {
  const { t } = useTranslation();
  const setOverlay = useUi((s) => s.setOverlay);
  const best = useGame((s) => s.best);
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const items: MenuEntry[] = [
    { id: 'mission', label: t('menu.mission'), run: () => useGame.getState().openMissions(), primary: true },
    { id: 'free', label: t('menu.free'), run: () => useGame.getState().startRun() },
    { id: 'coop', label: t('menu.coopPlay'), run: () => setOverlay('coop') },
    { id: 'help', label: t('help.title'), run: () => setOverlay('help') },
    { id: 'settings', label: t('menu.settings'), run: () => setOverlay('settings') },
    { id: 'credits', label: t('menu.credits'), run: () => setOverlay('credits') },
  ];
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    refs.current[next]?.focus();
  };
  const cur = items[active] ?? items[0]!;
  const code = (i: number) => String(i + 1).padStart(2, '0');
  return (
    <div className="absolute inset-0 z-10 overflow-hidden">
      <div className="menu-veil pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="menu-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="ui-enter relative flex h-full flex-col overflow-auto px-5 py-5 sm:px-[6vw] sm:py-[4.5vh]">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 bg-accent" aria-hidden="true" />
            <span className="label-code !text-slate-300">{t('app.subtitle')}</span>
            <span className="ticks hidden w-24 sm:block" aria-hidden="true" />
            <span className="panel-code hidden sm:inline" aria-hidden="true">PL-00 // EXP</span>
          </div>
          <LanguageSelect />
        </header>

        <main className="grid flex-1 items-center gap-8 py-6 lg:grid-cols-[minmax(20rem,27rem)_1fr] lg:items-end">
          <div className="flex flex-col gap-8 lg:self-center">
            <div>
              <p className="label-code !text-accent">{t('menu.tagline')}</p>
              <h1 className="logo mt-2 text-[clamp(3.2rem,7vw,6.6rem)]">{t('app.title')}</h1>
              <div className="mt-3 flex items-center gap-3" aria-hidden="true">
                <span className="h-px w-12 bg-accent" />
                <span className="h-1 w-1 bg-accent" />
                <span className="ticks w-40" />
              </div>
            </div>
            <nav aria-label={t('menu.navLabel')} onKeyDown={onKey}>
              <ul className="ui-stagger flex flex-col border-l border-line">
                {items.map((it, i) => (
                  <li key={it.id}>
                    <button
                      ref={(el) => {
                        refs.current[i] = el;
                      }}
                      className={`menu-item ${i === active ? 'is-active' : ''} ${it.primary ? 'is-primary' : ''}`}
                      onClick={it.run}
                      onFocus={() => setActive(i)}
                      onPointerEnter={() => setActive(i)}
                      aria-describedby="menu-desc"
                    >
                      <span className="menu-index" aria-hidden="true">{code(i)}</span>
                      <span className="menu-label">{it.label}</span>
                      <ChevronRight size={18} className="menu-chev" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          {/* Ficha de la entrada señalada: qué es, en una línea. */}
          <aside className="console-panel w-full max-w-md p-4 lg:ml-auto" aria-live="polite">
            <div className="flex items-center gap-2">
              <span className="panel-code" aria-hidden="true">SEL-{code(active)} // MNU</span>
              <span className="ticks flex-1" aria-hidden="true" />
            </div>
            <p className="display mt-2 text-lg font-semibold text-slate-50">{cur.label}</p>
            <p id="menu-desc" className="mt-1 text-sm text-slate-300">{t(`menu.desc.${cur.id}`)}</p>
            <div className="rule my-3" aria-hidden="true" />
            <p className="text-xs text-slate-400">{t('menu.goal')}</p>
            {best.score > 0 && <p className="num mt-2 text-xs text-accent">{t('menu.best', { sectors: best.sectors, score: fmt(best.score, 0) })}</p>}
          </aside>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <span className="label-code">{t('menu.build', { version: __APP_VERSION__ })}</span>
          <span className="flex items-center gap-4">
            <KeyHint k="↑↓">{t('menu.hintMove')}</KeyHint>
            <KeyHint k={t('menu.keyEnter')}>{t('menu.hintSelect')}</KeyHint>
          </span>
        </footer>
      </div>
    </div>
  );
}

/** Al cerrar Ajustes/Créditos desde la pausa se vuelve a la pausa, no a la partida. */
function closeToPrevious(): void {
  useUi.getState().setOverlay(useGame.getState().screen === 'game' ? 'pause' : null);
}

export function SettingsPanel() {
  const { t } = useTranslation();
  const s = useSettings();
  const row = 'flex items-center justify-between gap-4 border-b border-line/50 py-2 text-sm last:border-b-0';
  return (
    <Modal onClose={closeToPrevious}>
      <Panel title={t('settings.title')} code="CFG-01">
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
            {t('settings.effects')} <span className="num text-accent">{Math.round(s.effects * 100)} %</span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={s.effects} onChange={(e) => s.set({ effects: Number(e.target.value) })} />
        </label>
        {(['simpleDodge', 'simpleRepairs', 'wideAim', 'reduceStress', 'objectiveGuide'] as const).map((key) => (
          <label key={key} className={row}>
            <span>{t(`settings.${key}`)}</span>
            <input type="checkbox" checked={s[key]} onChange={(e) => s.set({ [key]: e.target.checked })} />
          </label>
        ))}
        <SectionLabel code="CFG-02" className="mt-4 mb-1">{t('settings.audio')}</SectionLabel>
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
          <button className="btn btn-primary" onClick={closeToPrevious}>
            {t('common.close')}
          </button>
        </div>
      </Panel>
    </Modal>
  );
}

export function CreditsScreen() {
  const { t } = useTranslation();
  return (
    <Modal onClose={closeToPrevious}>
      <Panel title={t('credits.title')} code="INF-03">
        <p className="mb-4 text-sm text-slate-300">{t('credits.intro')}</p>
        <ul className="space-y-3">
          {CREDITS.map((c) => (
            <li key={c.id} className="chamfer p-3 text-sm">
              <div className="font-bold">
                <a className="underline" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{c.title}</a>
              </div>
              <div className="text-slate-300">
                {t('credits.by')}{' '}
                <a className="underline" href={c.authorUrl} target="_blank" rel="noopener noreferrer">{c.author}</a> · {t(c.sourceKey ?? 'credits.source')}
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
          <button className="btn btn-primary" onClick={closeToPrevious}>
            {t('common.close')}
          </button>
        </div>
      </Panel>
    </Modal>
  );
}

const HELP_KEYS = ['move', 'run', 'look', 'interact', 'click', 'repair', 'alt', 'jump', 'down', 'view', 'objective', 'ping', 'pause'] as const;
const HELP_TIPS: { id: 'fire' | 'leak' | 'short' | 'impact' | 'power' | 'landing' | 'o2' | 'terrain' | 'storm' | 'tools'; icon: ReactNode }[] = [
  { id: 'fire', icon: <Flame size={16} className="text-bad" /> },
  { id: 'leak', icon: <Wind size={16} className="text-bad" /> },
  { id: 'short', icon: <Zap size={16} className="text-warn" /> },
  { id: 'impact', icon: <Navigation size={16} className="text-warn" /> },
  { id: 'power', icon: <Zap size={16} className="text-accent" /> },
  { id: 'landing', icon: <ArrowDownToLine size={16} className="text-accent" /> },
  { id: 'o2', icon: <Wind size={16} className="text-warn" /> },
  { id: 'terrain', icon: <Mountain size={16} className="text-warn" /> },
  { id: 'storm', icon: <CloudLightning size={16} className="text-warn" /> },
  { id: 'tools', icon: <Drill size={16} className="text-accent" /> },
];

/** Toda la explicación del juego cabe en una pantalla: controles y cinco reglas. */
export function HelpOverlay() {
  const { t } = useTranslation();
  const close = () => useUi.getState().setOverlay(null);
  const psych = !!getPsychRules(getRun()?.catalog ?? defaultCatalog);
  return (
    <Modal onClose={close}>
      <Panel title={t('help.title')} code="OPS-00">
        <p className="mb-3 text-sm text-slate-200">{t('help.goal')}</p>
        <dl className="mb-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
          {HELP_KEYS.map((k) => (
            <div key={k} className="contents">
              <dt>
                <span className="kbd">{t(`keys.${k}`)}</span>
              </dt>
              <dd className="text-slate-300">{t(`help.${k}`)}</dd>
            </div>
          ))}
        </dl>
        <ul className="flex flex-col gap-1.5 text-sm text-slate-300">
          {HELP_TIPS.map((tip) => (
            <li key={tip.id} className="flex items-center gap-2">
              {tip.icon}
              {t(`help.tips.${tip.id}`)}
            </li>
          ))}
          {psych && (
            <li className="flex items-center gap-2">
              <Activity size={16} className="text-accent" />
              {t('help.tips.morale')}
            </li>
          )}
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

export function PauseScreen() {
  const { t } = useTranslation();
  const setOverlay = useUi((s) => s.setOverlay);
  const hasDesign = useGame((g) => g.runDesign !== null);
  return (
    <Modal onClose={() => setOverlay(null)}>
      <Panel title={t('pause.title')} code="SYS-PA" className="mx-auto max-w-xs">
        <nav className="ui-stagger flex flex-col gap-2">
          <Button variant="primary" size="lg" onClick={() => setOverlay(null)} autoFocus>
            {t('pause.resume')}
          </Button>
          <Button size="lg" onClick={() => setOverlay('settings')}>
            {t('common.settings')}
          </Button>
          {hasDesign && (
            <Button size="lg" onClick={() => useGame.getState().redesign()}>
              {t('end.redesign')}
            </Button>
          )}
          <Button size="lg" variant="danger" onClick={() => useGame.getState().toMenu()}>
            {t('pause.quit')}
          </Button>
        </nav>
      </Panel>
    </Modal>
  );
}

function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Informe post-misión (fase 5): resultado y como mucho seis eslabones de una línea, en orden causal. El primero que
 * falló (causa raíz) va resaltado. Es opcional: no tapa los botones.
 */
function MissionReportView({ report }: { report: MissionReport }) {
  const { t } = useTranslation();
  return (
    <section className="mt-3 rounded-sm border border-line bg-black/30 p-2 text-left" aria-label={t('end.reportTitle')}>
      <p className={`num text-xs font-bold ${report.outcome === 'success' ? 'text-ok' : report.outcome === 'lost' ? 'text-bad' : 'text-warn'}`}>{tr(report.headline)}</p>
      <ol className="mt-1 flex flex-col gap-0.5 text-xs">
        {report.links.map((l) => (
          <li key={l.id} className={`flex items-center gap-1.5 ${l.ok ? 'text-slate-300' : l.id === report.rootCause ? 'font-bold text-bad' : 'text-warn'}`}>
            {l.ok ? <CircleCheck size={12} className="shrink-0 text-ok" aria-hidden="true" /> : <CircleX size={12} className="shrink-0" aria-hidden="true" />}
            <span>{tr(l.message)}</span>
            {l.id === report.rootCause && <span className="num ml-auto text-[10px] uppercase">{t('end.rootCause')}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Fin de sector (se sigue con la misma nave) o fin de la expedición (permadeath: se empieza de cero). */
export function EndScreen() {
  const { t } = useTranslation();
  const s = useGame((g) => g.hud);
  const newBest = useGame((g) => g.newBest);
  // Cooperativo: la partida la reinicia el anfitrión (vuelve toda la sala al lobby).
  const inRoom = useCoop((c) => c.lobby !== null);
  const isHost = useCoop((c) => mePlayer(c)?.host === true);
  if (!s || (s.phase !== 'lost' && s.phase !== 'won')) return null;
  const lost = s.phase === 'lost';
  // Fase 5: con diseño, el informe de la misión (resultado y cadena de causas); la misión termina al volver a casa.
  const report = missionReport(s);
  const missionOver = !!s.science?.over;
  const objective = !lost && !missionOver ? currentObjective(s, getRun()?.catalog) : null;
  // Solo en misión: en la partida libre el paso es «llegar a la salida», justo lo que se acaba de hacer.
  const nextStep = objective?.mode === 'mission' && objective.awaitingNextSector && objective.current >= 0 ? objective.steps[objective.current] : undefined;
  const stats: [string, string][] = [
    [t('end.sectors'), String(s.stats.sectorsCleared)],
    [t('end.jumps'), String(s.stats.jumps)],
    [t('end.distance'), distanceText(s.stats.distanceLy, !!s.missionDesign)],
    [t('end.fixed'), String(s.stats.incidentsFixed)],
    [t('end.evaded'), String(s.stats.impactsEvaded)],
    [t('end.hits'), String(s.stats.impactsTaken)],
    [t('end.landings'), String(s.stats.landings)],
    [t('end.materials'), String(s.stats.materialsStored)],
    [t('end.time'), formatTime(s.stats.timeS)],
  ];
  // Economía (fase 3): una fila corta por dato, solo si hubo comercio.
  const earned = s.stats.creditsEarned ?? 0;
  const spent = s.stats.creditsSpent ?? 0;
  const bought = s.stats.upgradesBought ?? 0;
  if (earned > 0 || spent > 0) stats.push([t('end.creditsEarned'), `+${fmt(earned, 0)}`], [t('end.creditsSpent'), `−${fmt(spent, 0)}`]);
  if (bought > 0) stats.push([t('end.upgrades'), String(bought)]);
  // Fase 8: cordura (ocultas si valen 0, y con la cordura apagada no existen).
  const critS = s.stats.sanityCriticalS ?? 0;
  const counter = countermeasures(s.stats);
  if (critS > 0) stats.push([t('end.sanityCritical'), formatTime(critS)]);
  if (counter > 0) stats.push([t('end.countermeasures'), String(counter)]);
  return (
    <div className="modal-backdrop absolute inset-0 z-40 flex items-center justify-center overflow-auto p-4" role="dialog" aria-modal="true">
      <Panel className="ui-enter w-full max-w-lg">
        {/* Informe: franja de resultado, motivo, cadena de causas y ficha de cifras. */}
        <header className={`-mx-4 -mt-4 mb-3 border-b px-4 pb-3 pt-4 ${lost ? 'border-bad/50 bg-bad/10' : 'border-line bg-accent/5'}`}>
          <p className="panel-code" aria-hidden="true">RPT-{String(s.sector.index).padStart(2, '0')}</p>
          <h2 className={`display mt-1 text-2xl font-bold !tracking-[0.2em] ${lost ? 'text-bad' : missionOver && !s.science?.objectiveMet ? 'text-warn' : 'text-accent'}`}>
            {lost ? t('end.lostTitle') : missionOver ? (s.science?.objectiveMet ? t('end.missionSuccessTitle') : t('end.missionPartialTitle')) : t('end.wonTitle', { sector: s.sector.index })}
          </h2>
          {lost && s.lossReason && <p className="mt-1 text-slate-200">{tr({ key: `loss.${s.lossReason}` })}</p>}
        </header>
        {report && (lost || missionOver) && <MissionReportView report={report} />}
        {newBest && <p className="num mt-2 animate-pulse text-sm text-warn">{t('end.newBest')}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-[1fr_auto_1fr_auto]">
          {stats.map(([label, value]) => (
            <StatRow key={label} label={label} value={value} />
          ))}
        </dl>
        <dl className="mt-3 grid grid-cols-[1fr_auto] items-baseline border-t border-line pt-2">
          <StatRow label={t('end.score')} value={fmt(s.score, 0)} tone="accent" strong />
        </dl>
        <div className="mt-5 flex flex-col gap-2">
          {lost && inRoom ? (
            isHost ? (
              <button className="btn btn-primary !py-3" onClick={() => sendLobby({ type: 'restart' })} autoFocus>
                {t('coop.backToLobby')}
              </button>
            ) : (
              <p className="num text-xs text-slate-400">{t('coop.waitingHost')}</p>
            )
          ) : lost ? (
            <button className="btn btn-primary !py-3" onClick={() => useGame.getState().startRun(undefined, s.missionDesign ?? null)} autoFocus>
              {s.missionDesign ? t('end.retryMission') : t('end.retry')}
            </button>
          ) : missionOver ? (
            inRoom ? (
              isHost ? (
                <button className="btn btn-primary !py-3" onClick={() => sendLobby({ type: 'restart' })} autoFocus>
                  {t('coop.backToLobby')}
                </button>
              ) : (
                <p className="num text-xs text-slate-400">{t('coop.waitingHost')}</p>
              )
            ) : (
              <button className="btn btn-primary !py-3" onClick={() => useGame.getState().startRun(undefined, s.missionDesign ?? null)} autoFocus>
                {t('end.retryMission')}
              </button>
            )
          ) : (
            <>
              {/* Guía del objetivo: lo que queda por hacer después de este tramo/sector (una línea). */}
              {nextStep && <p className="num text-xs text-accent">{t('end.objectiveNext', { step: tr(nextStep.text) })}</p>}
              <button className="btn btn-primary !py-3" onClick={() => useGame.getState().act({ type: 'next-sector' })} autoFocus>
                {t('end.next', { sector: s.sector.index + 1 })}
              </button>
              <p className="text-xs text-slate-400">{t('end.nextHint')}</p>
            </>
          )}
          {/* Partida con diseño: volver al hangar con el mismo diseño cargado (en sala no: saldría de ella). */}
          {s.missionDesign && !inRoom && (
            <button className="btn" onClick={() => useGame.getState().redesign()}>
              {t('end.redesign')}
            </button>
          )}
          <button className="btn" onClick={() => useGame.getState().toMenu()}>
            {t('common.menu')}
          </button>
        </div>
      </Panel>
    </div>
  );
}
