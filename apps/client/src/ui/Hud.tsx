import { Activity, AlertTriangle, BatteryMedium, FlaskConical, Flame, Fuel, HardDrive, Heart, Navigation, SatelliteDish, Shield, Sun, Telescope, Thermometer, Wind, Wrench, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { catalog as defaultCatalog, findBody, getMissions, getNode, getPsychRules, type IncidentKind, type RunState } from '@payload/shared';
import { effectiveShipOf, maxPowerKwOf } from '../game/effective';
import { getRun, TOAST_MS, useGame } from '../game/runStore';
import { lt, tr } from '../i18n';
import { useUi } from '../state/ui';
import { fmt, usePointerLocked } from './common';
import { nodeName } from './names';
import { CreditsBadge, UpgradeStrip } from './Credits';
import { HelmPointer, ObjectivePointer } from './HelmPointer';
import { ObjectiveTracker } from './ObjectiveTracker';
import { SkillHud } from './SkillHud';
import { ToolIcon } from './ToolIcon';
import { DescentHud, FallAlert, ToolCompass, O2Vignette, ShipCompass, SuitVitals, WorldBadge } from './SurfaceHud';
import { myCrew } from '../game/me';
import { moraleView } from '../game/sanityFx';
import { SanityVignette } from './SanityVignette';
import { SegBar, Toast, type Tone } from './kit';

/** Cabecera mínima de un bloque del HUD: código decorativo y regla con marcas (no comunica nada). */
export function HudHead({ code }: { code: string }) {
  return (
    <div className="-mt-1 mb-0.5 flex items-center gap-2" aria-hidden="true">
      <span className="panel-code !text-[9px] opacity-80">{code}</span>
      <span className="ticks flex-1 opacity-60" />
    </div>
  );
}

/** Mira: punto y cuatro marcas finas (no tapa lo que se apunta). */
function Crosshair() {
  return (
    <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
      <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 bg-white/85" />
      <span className="absolute left-1/2 top-0 h-1.5 w-px -translate-x-1/2 bg-white/50" />
      <span className="absolute bottom-0 left-1/2 h-1.5 w-px -translate-x-1/2 bg-white/50" />
      <span className="absolute left-0 top-1/2 h-px w-1.5 -translate-y-1/2 bg-white/50" />
      <span className="absolute right-0 top-1/2 h-px w-1.5 -translate-y-1/2 bg-white/50" />
    </div>
  );
}

const INCIDENT_ICON: Record<IncidentKind, ReactNode> = { fire: <Flame size={14} />, short: <Zap size={14} />, leak: <Wind size={14} /> };

export type Level = 'ok' | 'warn' | 'bad';
const LEVEL_TONE: Record<Level, Tone> = { ok: 'accent', warn: 'warn', bad: 'bad' };
const LEVEL_TEXT: Record<Level, string> = { ok: 'text-slate-100', warn: 'text-warn', bad: 'text-bad' };
export const levelOf = (pct: number, warn: number, bad: number): Level => (pct <= bad ? 'bad' : pct <= warn ? 'warn' : 'ok');

export function Gauge({ icon, label, pct, text, level, marker }: { icon: ReactNode; label: string; pct: number; text: string; level: Level; marker?: number }) {
  return (
    <div className="flex items-center gap-2" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className={`${LEVEL_TEXT[level]} ${level === 'bad' ? 'animate-pulse' : ''}`} title={label}>
        {icon}
      </span>
      <SegBar pct={pct} tone={LEVEL_TONE[level]} marker={marker} seg={5} className="h-2 w-36" />
      <span className={`num w-24 text-xs ${LEVEL_TEXT[level]}`}>
        <span className="sr-only">{label} </span>
        {text}
      </span>
    </div>
  );
}

/** Fase 8: ánimo propio («Ánimo»). Aparece al bajar de estable o del 85 %; con la cordura apagada no existe. */
export function MoraleGauge({ s, compact = false }: { s: RunState; compact?: boolean }) {
  const { t } = useTranslation();
  const v = moraleView(myCrew(s), getPsychRules(getRun()?.catalog ?? defaultCatalog));
  if (!v) return null;
  if (compact) {
    return (
      <div className={`num flex items-center gap-2 text-xs ${v.level === 'bad' ? 'animate-pulse text-bad' : v.level === 'warn' ? 'text-warn' : 'text-slate-100'}`} role="meter" aria-label={t('hud.morale')} aria-valuenow={Math.round(v.pct)} aria-valuemin={0} aria-valuemax={100}>
        <Activity size={14} aria-hidden="true" />
        <span>{t('hud.morale')} {Math.ceil(v.pct)} %</span>
      </div>
    );
  }
  return <Gauge icon={<Activity size={16} />} label={t('hud.morale')} pct={v.pct} text={`${Math.ceil(v.pct)} %`} level={v.level} marker={v.markerPct} />;
}

/** Recursos vitales: los cuatro números que deciden si la nave llega. */
function Vitals({ s }: { s: RunState }) {
  const { t } = useTranslation();
  // Máximos de la nave EFECTIVA: un depósito o un casco mejorados se ven con su nuevo tope.
  const cat = getRun()?.catalog;
  const ship = effectiveShipOf(s, cat);
  const hullPct = (s.ship.hull / ship.hullMax) * 100;
  const fuelPct = (s.ship.fuel / ship.fuelCapacity) * 100;
  // 100 % de la barra de energía = la nave sana a esta distancia del Sol (nuclear + paneles); sin diseño, el reactor.
  const maxKw = maxPowerKwOf(s, cat);
  const supplyPct = (s.ship.powerSupplyKw / maxKw) * 100;
  const demandPct = (s.ship.powerDemandKw / maxKw) * 100;
  const blackout = s.ship.powerSupplyKw <= 0;
  return (
    <div className="hud-frame absolute left-3 top-3 flex flex-col gap-1.5 p-3">
      <HudHead code="SHP-01" />
      <Gauge icon={<Shield size={16} />} label={t('hud.hull')} pct={hullPct} text={`${Math.ceil(s.ship.hull)}`} level={levelOf(hullPct, 50, 30)} />
      <Gauge icon={<Heart size={16} />} label={t('hud.oxygen')} pct={s.ship.oxygenPct} text={`${Math.ceil(s.ship.oxygenPct)} %`} level={levelOf(s.ship.oxygenPct, 55, 35)} />
      <Gauge icon={<Fuel size={16} />} label={t('hud.fuel')} pct={fuelPct} text={`${Math.floor(s.ship.fuel)}`} level={levelOf(fuelPct, 35, 20)} />
      <Gauge
        icon={<Zap size={16} />}
        label={t('hud.power')}
        pct={Math.min(100, demandPct)}
        marker={supplyPct}
        text={blackout ? t('hud.blackout') : s.ship.overloaded ? t('hud.overload') : `${Math.round(s.ship.powerDemandKw)}/${Math.round(s.ship.powerSupplyKw)} kW`}
        level={blackout || s.ship.overloaded ? 'bad' : demandPct > supplyPct * 0.92 ? 'warn' : 'ok'}
      />
      {/* Con diseño (fase 4): distancia al Sol y lo que dan ahora los paneles, junto a la energía. */}
      {s.sunDistanceAu !== undefined && (
        <div className="num flex items-center gap-2 pl-6 text-[11px] text-slate-300" title={t('hud.solar', { kw: fmt(s.ship.solarSupplyKw ?? 0, 0) })}>
          <Sun size={13} className="text-warn" aria-hidden="true" />
          <span>{t('hud.sunAu', { au: fmt(s.sunDistanceAu, 2) })}</span>
          <span className="text-warn">{t('hud.solar', { kw: fmt(s.ship.solarSupplyKw ?? 0, 0) })}</span>
        </div>
      )}
      {/* Fase 5: batería (cubre la sobrecarga mientras dura) y calor por encima de los radiadores. */}
      {(s.ship.batteryMaxKwh ?? 0) > 0 && (
        <Gauge
          icon={<BatteryMedium size={16} />}
          label={t('hud.battery')}
          pct={((s.ship.batteryKwh ?? 0) / s.ship.batteryMaxKwh!) * 100}
          text={`${fmt(s.ship.batteryKwh ?? 0, 0)} kWh`}
          level={levelOf(((s.ship.batteryKwh ?? 0) / s.ship.batteryMaxKwh!) * 100, 35, 10)}
        />
      )}
      {s.ship.overheated && (
        <div className="num flex animate-pulse items-center gap-2 pl-6 text-[11px] text-bad" title={t('hud.overheatTitle')}>
          <Thermometer size={13} aria-hidden="true" />
          <span>{t('hud.overheat', { demandKw: fmt(s.ship.powerDemandKw, 0), heatKw: fmt(s.ship.heatRejectKw ?? 0, 0) })}</span>
        </div>
      )}
      <MoraleGauge s={s} />
      {s.science && <ScienceGauges s={s} />}
      <div className="flex items-center justify-between gap-2 text-xs text-slate-200">
        <span className="flex items-center gap-2" title={t('hud.spares')}>
          <Wrench size={16} />
          <span className="num">
            <span className="sr-only">{t('hud.spares')} </span>× {s.ship.spares}
          </span>
        </span>
        <CreditsBadge credits={s.credits} />
      </div>
      <UpgradeStrip upgrades={s.upgrades} />
    </div>
  );
}

/**
 * Fase 5 (ADR 0018): datos a bordo, ciencia entregada y enlace con la Tierra, de un vistazo. Solo con diseño.
 * Lo de a bordo no está a salvo hasta bajarlo: por eso la barra de datos y la de ciencia van juntas.
 */
function ScienceGauges({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const sci = s.science!;
  const storedPct = sci.capacityMb > 0 ? (sci.storedMb / sci.capacityMb) * 100 : 100;
  const sciencePct = sci.requiredScience > 0 ? (sci.deliveredScience / sci.requiredScience) * 100 : 100;
  const link = sci.contact
    ? { cls: 'text-ok', text: t('hud.link.down', { rate: fmt(sci.downlinkMbPerS, 1) }) }
    : !sci.inRange
      ? { cls: 'text-bad', text: t('hud.link.noRange') }
      : sci.inWindow
        ? { cls: 'text-warn', text: t('hud.link.blocked') }
        : { cls: 'text-slate-300', text: t('hud.link.next', { seconds: Math.ceil(sci.windowChangeInS) }) };
  return (
    <>
      <Gauge
        icon={<HardDrive size={16} />}
        label={t('hud.data')}
        pct={storedPct}
        text={t('hud.dataMb', { mb: fmt(sci.storedMb, 0), cap: fmt(sci.capacityMb, 0) })}
        level={storedPct >= 99.5 ? 'bad' : storedPct >= 80 ? 'warn' : 'ok'}
      />
      <Gauge
        icon={<FlaskConical size={16} />}
        label={t('hud.science')}
        pct={Math.min(100, sciencePct)}
        text={`${fmt(sci.deliveredScience, 0)}/${sci.requiredScience}`}
        level={sci.objectiveMet ? 'ok' : 'warn'}
      />
      <div className="num flex items-center gap-2 pl-6 text-[11px]" title={t('hud.linkTitle')}>
        <SatelliteDish size={13} className={link.cls} aria-hidden="true" />
        <span className={`${link.cls} ${sci.contact ? 'animate-pulse' : ''}`}>{link.text}</span>
        {sci.observing && (
          <span className="flex items-center gap-1 text-accent" title={t('hud.observingTitle')}>
            <Telescope size={13} aria-hidden="true" />
            {t('hud.observing', { body: t(`catalog.${sci.observing}`, { ns: 'sim' }) })}
          </span>
        )}
      </div>
    </>
  );
}

/** Misión de la partida con diseño y su destino (una línea). */
function MissionLine({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const d = s.missionDesign;
  if (!d) return null;
  const mission = getMissions(getRun()?.catalog).find((m) => m.id === d.missionId);
  const dest = d.destinationId && findBody(d.destinationId, getRun()?.catalog) ? t(`catalog.${d.destinationId}`, { ns: 'sim' }) : '—';
  return <div className="num text-[11px] text-warn">{t('hud.mission', { mission: mission ? lt(mission.name) : d.missionId, dest })}</div>;
}

/** Dónde está la nave: atracada o en pleno salto, con el avance y el régimen. */
function Voyage({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const target = s.transit ? getNode(s.sector, s.transit.toId) : getNode(s.sector, s.locationId);
  const pct = s.transit ? (s.transit.traveledLy / s.transit.distanceLy) * 100 : 0;
  const eta = s.transit && s.ship.speedLyPerS > 0 ? Math.ceil((s.transit.distanceLy - s.transit.traveledLy) / s.ship.speedLyPerS) : null;
  return (
    <div className="hud-frame absolute left-1/2 top-3 flex min-w-72 -translate-x-1/2 flex-col items-center gap-1 px-5 py-2 text-center">
      <div className="label-code">
        {t('hud.sector', { sector: s.sector.index })} · {t('hud.score', { score: s.score })}
      </div>
      {s.missionDesign && <MissionLine s={s} />}
      {s.surface ? (
        <WorldBadge s={s} />
      ) : (
        <div className="display text-sm font-semibold !tracking-[0.1em] text-slate-50">{s.transit ? t('hud.transit', { node: nodeName(target) }) : t('hud.docked', { node: nodeName(target) })}</div>
      )}
      {s.transit && (
        <>
          <SegBar pct={pct} seg={4} className="h-1.5 w-60" />
          <div className={`num text-xs ${eta === null ? 'animate-pulse text-bad' : 'text-slate-300'}`}>
            {t(`throttle.${s.ship.throttle}`, { ns: 'sim' })} · {eta === null ? t('hud.stopped') : t('hud.eta', { seconds: eta })}
          </div>
        </>
      )}
    </div>
  );
}

/** Lo urgente: impactos que vienen y averías abiertas. */
function Alerts({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const warning = s.warnings.find((w) => !w.evaded);
  const evaded = !warning && s.warnings.some((w) => w.evaded);
  return (
    <>
      {(warning || evaded) && (
        <div
          className={`banner display absolute left-1/2 top-24 flex -translate-x-1/2 items-center gap-2 text-lg font-bold ${warning ? 'animate-pulse bg-warn/20 text-warn' : 'bg-ok/15 text-ok'}`}
          role="alert"
        >
          {warning ? <AlertTriangle size={22} /> : <Navigation size={20} />}
          {warning ? t('hud.impactIn', { seconds: warning.etaS >= 0 ? Math.ceil(warning.etaS) : '—' }) : t('hud.impactEvaded')}
        </div>
      )}
      {s.incidents.length > 0 && (
        <ul className="absolute left-3 top-44 flex flex-col gap-1" aria-live="assertive">
          {s.incidents.map((inc) => (
            <li key={inc.id} className={`toast num ui-enter flex items-center gap-1.5 !py-1 text-xs ${inc.kind === 'short' ? 'text-warn' : 'text-bad'}`}>
              {INCIDENT_ICON[inc.kind]}
              {t(`incident.${inc.kind}`, { ns: 'sim' })} · {t(`systemName.${inc.systemId}`, { ns: 'sim' })}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  // La interfaz se refresca ~10 veces por segundo con la partida, así que basta con filtrar por edad.
  const now = performance.now();
  const visible = toasts.filter((x) => now - x.atMs < TOAST_MS);
  return (
    <ul className="absolute right-3 top-14 flex w-80 flex-col items-end gap-1" role="log" aria-live="polite">
      {visible.map((x) => (
        <Toast key={x.id} tone={x.tone} className="text-right">
          {tr(x.message)}
        </Toast>
      ))}
    </ul>
  );
}

/** Qué hace la tecla E (y Q) junto al puesto más cercano. */
function PromptBar() {
  const { t } = useTranslation();
  const prompt = useUi((s) => s.prompt);
  if (!prompt) return null;
  const params = { ...prompt.params };
  const system = typeof params.system === 'string' ? t(`systemName.${params.system}`, { ns: 'sim' }) : null;
  // Mundo y material llegan como id: se muestran con su nombre del catálogo.
  if (typeof params.world === 'string') params.world = t(`catalog.${params.world}`, { ns: 'sim' });
  if (typeof params.material === 'string') params.material = t(`catalog.${params.material}`, { ns: 'sim' });
  if (typeof params.tool === 'string') params.tool = t(`catalog.${params.tool}`, { ns: 'sim' });
  const altParams = prompt.altParams ?? {};
  const throttle = typeof altParams.throttle === 'string' ? t(`throttle.${altParams.throttle}`, { ns: 'sim' }) : null;
  return (
    <div className="absolute bottom-20 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <div className={`hud-frame flex items-center gap-2 px-4 py-2 text-sm ${prompt.blocked ? 'text-slate-400' : prompt.warn ? 'text-warn' : 'text-slate-100'}`}>
        {!prompt.blocked && (
          <>
            <span className="kbd">{t(prompt.inputKey ?? 'keys.interact')}</span>
            {!prompt.noVerb && <span className="label-code">{prompt.hold ? t('prompt.hold') : t('prompt.press')}</span>}
          </>
        )}
        {prompt.icon && (
          <span className="text-accent">
            <ToolIcon toolId={prompt.icon} />
          </span>
        )}
        <span>
          {t(prompt.key, params)}
          {system && ` · ${system}`}
        </span>
        {prompt.badges?.map((b) => (
          <span key={b.key} className={`tag !text-[11px] !tracking-normal !normal-case ${b.tone === 'warn' ? 'text-warn' : 'text-accent'}`}>
            {t(b.key, b.params ?? {})}
          </span>
        ))}
      </div>
      {(prompt.hold || prompt.progressBar) && !prompt.blocked && (
        <SegBar pct={prompt.progress * 100} seg={4} solid={prompt.hold} className="h-1.5 w-60" />
      )}
      {prompt.altKey && (
        <div className="hud-frame flex items-center gap-2 px-3 py-1 text-xs text-slate-200">
          <span className="kbd">{t('keys.alt')}</span>
          {t(prompt.altKey)}
          {throttle && <span className="num text-accent">{throttle}</span>}
        </div>
      )}
    </div>
  );
}

/** Interfaz de la partida: poca letra, mucho estado. Todo lo que se lee de un vistazo. */
export function Hud() {
  const { t } = useTranslation();
  const s = useGame((g) => g.hud);
  const overlay = useUi((u) => u.overlay);
  const locked = usePointerLocked();
  const descentView = useUi((u) => u.descentView);
  if (!s) return null;
  const me = myCrew(s);
  const eva = me?.location === 'eva';
  const landing = s.phase === 'landing';
  const playing = (s.phase === 'docked' || s.phase === 'transit' || s.phase === 'surface') && !(descentView && !eva);
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <O2Vignette s={s} />
      <SanityVignette s={s} />
      {eva ? <SuitVitals s={s} /> : <Vitals s={s} />}
      <Voyage s={s} />
      <Alerts s={s} />
      {landing && <DescentHud s={s} />}
      {eva && me?.alive && s.phase === 'surface' && (
        <>
          <ShipCompass />
          <ToolCompass />
          <FallAlert />
        </>
      )}
      <Toasts />
      <ObjectiveTracker />
      <div className="hud-frame num absolute right-3 top-3 px-2 py-1 text-xs text-slate-300">{t('hud.helpHint')}</div>
      {playing && overlay === null && (
        <>
          <Crosshair />
          {!eva && <SkillHud />}
          {!eva && <HelmPointer />}
          {!eva && <ObjectivePointer />}
          <PromptBar />
          {!locked && <div className="hud-frame label-code absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 !text-slate-200">{t('hud.clickToPlay')}</div>}
        </>
      )}
    </div>
  );
}
