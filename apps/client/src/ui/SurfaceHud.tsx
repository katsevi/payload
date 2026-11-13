import { useEffect, useRef, type RefObject } from 'react';
import { AlertTriangle, ArrowUp, CloudLightning, Drill, Fuel, Gem, Package, PackageCheck, PackageX, Rocket, Shield, Sparkles, Wind } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSurfaceCatalog, getWorld, type RunState } from '@payload/shared';
import { effectiveRulesOf, effectiveShipOf } from '../game/effective';
import { getRun } from '../game/runStore';
import { bearingTo, brakeThresholdMps, currentLode, shipBearing, stormLevel } from '../game/surfaceRules';
import { ToolIcon } from './ToolIcon';
import { useSettings } from '../state/settings';
import { hudView } from '../state/ui';
import { fmt } from './common';
import { Gauge, levelOf } from './Hud';

/** Reglas de traje y jetpack EFECTIVAS (con las mejoras): la mochila ampliada se ve con su nuevo tope. */
const rules = (s: RunState) => effectiveRulesOf(s, getRun()?.catalog);

/**
 * Activa unas clases en un elemento mientras `flag()` sea cierto, comprobándolo en cada frame sin pasar
 * por React (lo escribe la escena en `hudView`).
 */
function useFrameFlag(ref: RefObject<HTMLElement | null>, flag: () => boolean, classes: readonly string[], offClasses: readonly string[] = []) {
  useEffect(() => {
    let raf = 0;
    let on = false;
    const loop = () => {
      const now = flag();
      if (now !== on && ref.current) {
        for (const c of classes) ref.current.classList.toggle(c, now);
        for (const c of offClasses) ref.current.classList.toggle(c, !now);
        on = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const FALL_ROW = ['animate-pulse', 'rounded', 'ring-2', 'ring-bad'] as const;
const FALL_FRAME = ['block', 'animate-pulse'] as const;
const O2_SHORT = ['animate-pulse', 'border-bad'] as const;
const O2_SHORT_ARROW = ['text-bad'] as const;
const O2_TOOLS = ['border-warn'] as const;

/** Nombre y gravedad del mundo (y la tormenta, si la hay): sustituye a «atracada en…» mientras se está en tierra. */
export function WorldBadge({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const surface = s.surface;
  if (!surface) return null;
  const world = getWorld(surface.worldId);
  const storm = surface.storm;
  const level = stormLevel(storm, world.storms?.warnS ?? 0);
  return (
    <>
      <div className="text-sm text-slate-100">
        {t(`catalog.${surface.worldId}`, { ns: 'sim' })} · <span className="num">{t('hud.gravity', { g: fmt(surface.gravityMps2, 1) })}</span>
      </div>
      {(storm.active || storm.warned) && (
        <div className={`num flex items-center gap-1.5 text-xs ${storm.active ? 'animate-pulse text-bad' : 'text-warn'}`} role="status">
          <CloudLightning size={14} />
          {storm.active ? t('hud.stormActive', { pct: Math.round(level.active * 100) }) : t('hud.stormIn', { seconds: Math.max(0, Math.ceil(storm.nextInS ?? 0)) })}
        </div>
      )}
    </>
  );
}

/**
 * Minijuego del descenso: altitud, velocidad con la zona segura y la marca de «frena aquí» (perfil de
 * referencia del motor), combustible y la tecla. Todo de un vistazo, sin texto que leer.
 */
export function DescentHud({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const d = s.surface?.descent;
  if (!s.surface || !d) return null;
  const world = getWorld(s.surface.worldId);
  const safe = rules(s).descent.safeSpeedMps;
  const threshold = brakeThresholdMps(world, d.altitudeM);
  const maxV = Math.max(world.descent.speedMps * 2.2, 26);
  const pct = (v: number) => `${Math.min(100, (v / maxV) * 100)}%`;
  const tooFast = d.speedMps > threshold;
  const ship = effectiveShipOf(s, getRun()?.catalog);
  const fuelPct = (s.ship.fuel / ship.fuelCapacity) * 100;
  const engines = s.ship.systems.engines.online && s.ship.fuel > 0;
  return (
    <div className="console-panel absolute bottom-24 left-1/2 flex w-[22rem] -translate-x-1/2 flex-col gap-2 p-3" role="group" aria-label={t('descent.title')}>
      <div className="flex items-baseline justify-between">
        <span className="num text-2xl font-bold text-slate-100">{t('descent.altitude', { m: Math.max(0, Math.ceil(d.altitudeM)) })}</span>
        <span className={`num text-lg font-bold ${d.speedMps <= safe ? 'text-ok' : tooFast ? 'text-bad' : 'text-warn'}`}>{t('descent.speed', { v: fmt(d.speedMps, 1) })}</span>
      </div>
      {/* Velocidad: zona segura en verde, marca blanca = por encima de aquí, frena. */}
      <div className="relative h-4 overflow-hidden rounded-sm bg-black/60 ring-1 ring-line" role="meter" aria-label={t('descent.speedLabel')} aria-valuenow={Math.round(d.speedMps)} aria-valuemin={0} aria-valuemax={Math.round(maxV)}>
        <div className="absolute inset-y-0 left-0 bg-ok/35" style={{ width: pct(safe) }} />
        <div className={`absolute inset-y-0 left-0 ${d.speedMps <= safe ? 'bg-ok' : tooFast ? 'bg-bad' : 'bg-warn'} opacity-80`} style={{ width: pct(d.speedMps) }} />
        <div className="absolute inset-y-0 w-1 bg-white" style={{ left: pct(threshold) }} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Gauge icon={<Fuel size={16} />} label={t('hud.fuel')} pct={fuelPct} text={`${Math.floor(s.ship.fuel)}`} level={levelOf(fuelPct, 35, 20)} />
        <div className={`num rounded border px-2 py-0.5 text-sm font-bold uppercase tracking-wider ${tooFast ? 'animate-pulse border-bad text-bad' : 'border-line text-slate-500'}`} aria-live="polite">
          {tooFast ? t('descent.brakeNow') : t('descent.coast')}
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-slate-300">
        <span className="kbd">{t('keys.jump')}</span>
        <span>{engines ? (d.brake ? t('descent.braking') : t('descent.hold')) : t('descent.noEngines')}</span>
      </div>
    </div>
  );
}

/** El traje: oxígeno, jetpack y carga; y una línea de la nave por si allí pasa algo. */
export function SuitVitals({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const me = s.crew[0];
  if (!me) return null;
  const r = rules(s);
  const ship = effectiveShipOf(s, getRun()?.catalog);
  const hullPct = (s.ship.hull / ship.hullMax) * 100;
  const shipAlert = s.incidents.length > 0 || hullPct <= 30 || s.ship.oxygenPct <= 35;
  const o2Level = levelOf(me.suitO2Pct, r.suit.lowO2Pct, r.suit.criticalO2Pct);
  const critical = me.alive && me.suitO2Pct < r.suit.criticalO2Pct;
  return (
    <div className="console-panel absolute left-3 top-3 flex flex-col gap-1.5 p-3">
      {/* O₂ crítico: no depende de la viñeta (que se puede atenuar): marco rojo y triángulo junto a la barra. */}
      <div className={`flex items-center gap-1 ${critical ? 'animate-pulse rounded ring-2 ring-bad' : ''}`} role={critical ? 'alert' : undefined}>
        <Gauge icon={<Wind size={16} />} label={t('hud.suitO2')} pct={me.suitO2Pct} text={`${Math.ceil(me.suitO2Pct)} %`} level={o2Level} marker={r.suit.lowO2Pct} />
        {critical && <AlertTriangle size={14} className="text-bad" aria-hidden="true" />}
      </div>
      <JetpackRow pct={me.jetpackPct} label={t('hud.jetpack')} />
      <div className="flex items-center gap-1">
        <Gauge
          icon={<Package size={16} />}
          label={t('hud.carry')}
          pct={(me.carriedKg / r.suit.carryCapacityKg) * 100}
          text={t('hud.kg', { kg: Math.round(me.carriedKg), max: r.suit.carryCapacityKg })}
          level={me.carriedKg >= r.suit.carryCapacityKg ? 'warn' : 'ok'}
        />
        <StreakBadge mult={streakMultOf(me)} />
        <LodeBadge s={s} />
      </div>
      <ToolsRow s={s} tools={me.tools} />
      <div className={`num flex items-center gap-2 text-xs ${shipAlert ? 'animate-pulse text-bad' : 'text-slate-400'}`}>
        {shipAlert ? <AlertTriangle size={14} /> : <Shield size={14} />}
        {shipAlert ? t('hud.shipAlert') : t('hud.shipOk', { hull: Math.ceil(s.ship.hull) })}
      </div>
    </div>
  );
}

/** Jetpack: barra con sus teclas (subir/frenar y bajar); parpadea en rojo si la caída va a doler. */
function JetpackRow({ pct, label }: { pct: number; label: string }) {
  const { t } = useTranslation();
  const row = useRef<HTMLDivElement>(null);
  useFrameFlag(row, () => hudView.fallDanger, FALL_ROW);
  return (
    <div ref={row} className="flex items-center gap-1">
      <Gauge icon={<Rocket size={16} />} label={label} pct={pct} text={`${Math.floor(pct)} %`} level={levelOf(pct, 25, 8)} />
      <span className="kbd text-[10px]">{t('keys.jump')}</span>
      <span className="kbd text-[10px]">{t('keys.down')}</span>
    </div>
  );
}

/**
 * Multiplicador de racha que recibirá la próxima unidad (`streakMult` del motor). Tolerante: si falta
 * o vale ×1, no se pinta nada.
 */
function streakMultOf(me: RunState['crew'][number]): number | null {
  const m: unknown = me.streakMult;
  return typeof m === 'number' && Number.isFinite(m) ? m : null;
}

function StreakBadge({ mult }: { mult: number | null }) {
  const { t } = useTranslation();
  if (mult === null || mult <= 1.0001) return null;
  return <span className="num rounded border border-accent px-1 text-xs text-accent">{t('hud.streak', { mult: fmt(mult, 1) })}</span>;
}

/**
 * Herramientas: las que quedan en la mochila (icono + número por tipo) y, si alguna colocada tiene piezas
 * listas, cuántas (con un paquete marcado). Sin frases.
 */
function ToolsRow({ s, tools }: { s: RunState; tools: Record<string, number> }) {
  const { t } = useTranslation();
  const ids = getSurfaceCatalog(getRun()?.catalog).tools.map((x) => x.id);
  const placed = s.surface?.tools ?? [];
  const ready = placed.reduce((n, x) => n + x.ready, 0);
  return (
    <div className="num flex items-center gap-3 text-xs text-slate-200">
      <span className="flex items-center gap-2" role="group" aria-label={t('hud.tools')}>
        {ids.map((id) => (
          <span key={id} className={`flex items-center gap-0.5 ${(tools[id] ?? 0) > 0 ? '' : 'opacity-40'}`}>
            <ToolIcon toolId={id} size={14} />×{tools[id] ?? 0}
          </span>
        ))}
      </span>
      {ready > 0 && (
        <span className="flex animate-pulse items-center gap-1 rounded border border-ok px-1 text-ok" role="status" aria-label={t('hud.toolsReady')}>
          <PackageCheck size={14} />
          {ready}
        </span>
      )}
    </div>
  );
}

/**
 * Flecha hacia la herramienta con piezas listas más cercana (debajo de la de la nave), sin pasar por React
 * en cada frame: lee `hudView`, que escribe la escena.
 */
export function ToolCompass() {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const dist = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      if (box.current) box.current.style.display = hudView.toolOn ? '' : 'none';
      if (hudView.toolOn) {
        const b = bearingTo(hudView.x, hudView.z, hudView.yaw, hudView.toolX, hudView.toolZ);
        if (arrow.current) arrow.current.style.transform = `rotate(${b.angle}rad)`;
        const text = `${Math.round(b.distanceM)} m`;
        if (dist.current && text !== last) {
          dist.current.textContent = text;
          last = text;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  // Si toca ir ya a por las herramientas, la flecha apunta a la más cercana (tenga o no piezas) en ámbar.
  useFrameFlag(box, () => hudView.o2Route === 'fetch', ['text-warn', 'animate-pulse'], ['text-ok']);
  return (
    <div ref={box} style={{ display: 'none' }} className="console-panel absolute left-1/2 top-36 flex -translate-x-1/2 items-center gap-2 px-3 py-1 text-ok" role="img" aria-label={t('hud.toolsReady')}>
      <span ref={arrow} className="inline-flex will-change-transform">
        <ArrowUp size={18} />
      </span>
      <PackageCheck size={16} />
      <span ref={dist} className="num w-12 text-right text-sm text-slate-100" />
    </div>
  );
}

/**
 * Avance del filón en el que se trabaja: «2/3» con una gema; con el bonus listo (la veta que queda lo
 * completa) late y añade un destello. Tolerante: sin datos de filón no pinta nada.
 */
function LodeBadge({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const me = s.crew[0];
  const p = me ? currentLode(s, me, me.x, me.z) : null;
  if (!p) return null;
  return (
    <span
      className={`num flex items-center gap-0.5 rounded border px-1 text-xs ${p.bonusReady ? 'animate-pulse border-ok text-ok' : 'border-accent text-accent'}`}
      role="status"
      aria-label={t('hud.lode', { done: p.done, total: p.total })}>
      <Gem size={12} aria-hidden="true" />
      {p.done}/{p.total}
      {p.bonusReady && <Sparkles size={12} aria-hidden="true" />}
    </span>
  );
}

/** Marco que parpadea en ámbar mientras la caída en curso va a doler (el sonido lo pone `cue('fallWarn')`). */
export function FallAlert() {
  const frame = useRef<HTMLDivElement>(null);
  useFrameFlag(frame, () => hudView.fallDanger, FALL_FRAME, ['hidden']);
  return <div ref={frame} className="pointer-events-none absolute inset-0 hidden ring-[6px] ring-inset ring-warn/80" aria-hidden="true" />;
}

/**
 * Brújula de la nave: flecha hacia la rampa y distancia. Se actualiza en cada frame sin pasar por React
 * (lee `hudView`, que escribe la escena).
 */
export function ShipCompass() {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const dist = useRef<HTMLSpanElement>(null);
  const fetchIcon = useRef<HTMLSpanElement>(null);
  const leaveIcon = useRef<HTMLSpanElement>(null);
  // Con el O₂ justo para volver, la brújula se pone roja y late (sin texto). Contando las herramientas:
  // ámbar con el taladro = «ve ya a por ellas»; ámbar con el paquete tachado = «déjalas y vuelve».
  useFrameFlag(box, () => hudView.o2Short, O2_SHORT);
  useFrameFlag(box, () => hudView.o2Route === 'fetch' || hudView.o2Route === 'leave', O2_TOOLS);
  useFrameFlag(arrow, () => hudView.o2Short, O2_SHORT_ARROW, ['text-accent']);
  useFrameFlag(fetchIcon, () => hudView.o2Route === 'fetch', ['inline-flex'], ['hidden']);
  useFrameFlag(leaveIcon, () => hudView.o2Route === 'leave', ['inline-flex'], ['hidden']);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const b = shipBearing(hudView.x, hudView.z, hudView.yaw);
      if (arrow.current) arrow.current.style.transform = `rotate(${b.angle}rad)`;
      const text = `${Math.round(b.distanceM)} m`;
      if (dist.current && text !== last) {
        dist.current.textContent = text;
        last = text;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={box} className="console-panel absolute left-1/2 top-24 flex -translate-x-1/2 items-center gap-2 px-3 py-1" role="img" aria-label={t('hud.toShip')}>
      <span ref={arrow} className="inline-flex text-accent will-change-transform">
        <ArrowUp size={20} />
      </span>
      <span className="num text-xs uppercase tracking-wider text-slate-400">{t('hud.toShip')}</span>
      <span ref={dist} className="num w-14 text-right text-sm text-slate-100" />
      <span ref={fetchIcon} className="hidden animate-pulse text-warn" aria-label={t('hud.o2Fetch')}>
        <Drill size={18} />
      </span>
      <span ref={leaveIcon} className="hidden text-warn" aria-label={t('hud.o2Leave')}>
        <PackageX size={18} />
      </span>
    </div>
  );
}

/**
 * Oxígeno que se ve: viñeta roja que late por debajo del umbral crítico y oscurecimiento al final.
 * (El sonido —respiración y pitido— lo pone la escena; esto es su equivalente visual.)
 */
export function O2Vignette({ s }: { s: RunState }) {
  const k = useSettings((x) => x.effects);
  const me = s.crew[0];
  if (!me || me.location !== 'eva') return null;
  const r = rules(s);
  const o2 = me.suitO2Pct;
  const red = k * (o2 < r.suit.criticalO2Pct ? 0.35 + 0.55 * (1 - o2 / r.suit.criticalO2Pct) : o2 < r.suit.lowO2Pct ? 0.15 * (1 - o2 / r.suit.lowO2Pct) : 0);
  const dark = !me.alive ? 0.9 : o2 < 6 ? (1 - o2 / 6) * 0.75 : 0;
  return (
    <>
      {red > 0 && (
        <div
          className={`pointer-events-none absolute inset-0 ${o2 < r.suit.criticalO2Pct ? 'animate-pulse' : ''}`}
          style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(200,20,30,${red.toFixed(2)}) 100%)` }}
          aria-hidden="true"
        />
      )}
      {dark > 0 && <div className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-500" style={{ opacity: dark }} aria-hidden="true" />}
    </>
  );
}
