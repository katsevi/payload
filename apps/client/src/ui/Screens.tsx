import type { ReactNode } from 'react';
import { ArrowDownToLine, CloudLightning, Drill, Flame, Mountain, Navigation, Wind, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@payload/shared';
import { CREDITS } from '../data/credits';
import { useGame } from '../game/runStore';
import { currentLocale, setLocale, tr } from '../i18n';
import { sendLobby } from '../net/coopSession';
import { mePlayer, useCoop } from '../net/coopStore';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { Modal, Panel, fmt } from './common';

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

export function MenuScreen() {
  const { t } = useTranslation();
  const setOverlay = useUi((s) => s.setOverlay);
  const best = useGame((s) => s.best);
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-8 overflow-auto p-4">
      <div className="absolute right-4 top-4">
        <LanguageSelect />
      </div>
      <div className="rounded-xl bg-black/45 px-8 py-6 text-center backdrop-blur-[2px]">
        <h1 className="num text-6xl font-bold tracking-[0.35em] text-accent drop-shadow-[0_0_18px_rgba(56,225,192,.5)] sm:text-8xl">{t('app.title')}</h1>
        <p className="mt-3 text-slate-300">{t('app.subtitle')}</p>
        <p className="num mt-1 text-xs uppercase tracking-widest text-slate-500">{t('menu.tagline')}</p>
      </div>
      <nav className="flex w-64 flex-col gap-3">
        <button className="btn btn-primary !py-3" onClick={() => useGame.getState().startRun()}>
          {t('menu.play')}
        </button>
        <button className="btn" onClick={() => setOverlay('coop')}>
          {t('menu.coopPlay')}
        </button>
        <button className="btn" onClick={() => setOverlay('help')}>
          {t('help.title')}
        </button>
        <button className="btn" onClick={() => setOverlay('settings')}>
          {t('menu.settings')}
        </button>
        <button className="btn" onClick={() => setOverlay('credits')}>
          {t('menu.credits')}
        </button>
      </nav>
      <div className="max-w-md text-center text-sm text-slate-300">
        <p>{t('menu.goal')}</p>
        {best.score > 0 && <p className="num mt-2 text-xs text-accent">{t('menu.best', { sectors: best.sectors, score: fmt(best.score, 0) })}</p>}
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
  const row = 'flex items-center justify-between gap-4 py-2 text-sm';
  return (
    <Modal onClose={closeToPrevious}>
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
            {t('settings.effects')} <span className="num text-accent">{Math.round(s.effects * 100)} %</span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={s.effects} onChange={(e) => s.set({ effects: Number(e.target.value) })} />
        </label>
        {(['simpleDodge', 'simpleRepairs', 'wideAim'] as const).map((key) => (
          <label key={key} className={row}>
            <span>{t(`settings.${key}`)}</span>
            <input type="checkbox" checked={s[key]} onChange={(e) => s.set({ [key]: e.target.checked })} />
          </label>
        ))}
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
          <button className="btn btn-primary" onClick={closeToPrevious}>
            {t('common.close')}
          </button>
        </div>
      </Panel>
    </Modal>
  );
}

const HELP_KEYS = ['move', 'run', 'look', 'interact', 'click', 'repair', 'alt', 'jump', 'down', 'view', 'ping', 'pause'] as const;
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
  return (
    <Modal onClose={close}>
      <Panel title={t('help.title')}>
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
  return (
    <Modal onClose={() => setOverlay(null)}>
      <Panel title={t('pause.title')} className="mx-auto max-w-xs">
        <nav className="flex flex-col gap-3">
          <button className="btn btn-primary !py-3" onClick={() => setOverlay(null)} autoFocus>
            {t('pause.resume')}
          </button>
          <button className="btn" onClick={() => setOverlay('settings')}>
            {t('common.settings')}
          </button>
          <button className="btn" onClick={() => useGame.getState().toMenu()}>
            {t('pause.quit')}
          </button>
        </nav>
      </Panel>
    </Modal>
  );
}

function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
  const stats: [string, string][] = [
    [t('end.sectors'), String(s.stats.sectorsCleared)],
    [t('end.jumps'), String(s.stats.jumps)],
    [t('end.distance'), t('map.ly', { value: fmt(s.stats.distanceLy, 0) })],
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
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true">
      <Panel className="w-full max-w-md text-center">
        <h2 className={`num text-2xl font-bold uppercase tracking-widest ${lost ? 'text-bad' : 'text-accent'}`}>{lost ? t('end.lostTitle') : t('end.wonTitle', { sector: s.sector.index })}</h2>
        {lost && s.lossReason && <p className="mt-2 text-slate-200">{tr({ key: `loss.${s.lossReason}` })}</p>}
        {newBest && <p className="num mt-2 animate-pulse text-sm text-warn">{t('end.newBest')}</p>}
        <dl className="mx-auto mt-4 grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-left text-sm">
          {stats.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-400">{label}</dt>
              <dd className="num text-right text-slate-100">{value}</dd>
            </div>
          ))}
          <dt className="mt-2 border-t border-line pt-2 font-bold text-slate-200">{t('end.score')}</dt>
          <dd className="num mt-2 border-t border-line pt-2 text-right text-lg font-bold text-accent">{fmt(s.score, 0)}</dd>
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
            <button className="btn btn-primary !py-3" onClick={() => useGame.getState().startRun()} autoFocus>
              {t('end.retry')}
            </button>
          ) : (
            <>
              <button className="btn btn-primary !py-3" onClick={() => useGame.getState().act({ type: 'next-sector' })} autoFocus>
                {t('end.next', { sector: s.sector.index + 1 })}
              </button>
              <p className="text-xs text-slate-400">{t('end.nextHint')}</p>
            </>
          )}
          <button className="btn" onClick={() => useGame.getState().toMenu()}>
            {t('common.menu')}
          </button>
        </div>
      </Panel>
    </div>
  );
}
