import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getThrottle, type PoweredSystemId, type RunState, type SystemId } from '@payload/shared';
import { cue } from '../audio/cues';
import { effectiveShipOf, maxPowerKwOf } from '../game/effective';
import { getRun, useGame } from '../game/runStore';
import { useUi } from '../state/ui';
import { Modal, Panel } from './common';
import { SegBar } from './kit';

const POWERED: readonly PoweredSystemId[] = ['engines', 'lifeSupport', 'shields', 'nav'];

type SystemStatus = 'online' | 'off' | 'shorted' | 'broken' | 'noPower';
const STATUS_TEXT: Record<SystemStatus, string> = { online: 'text-ok', off: 'text-slate-400', shorted: 'text-warn', broken: 'text-bad', noPower: 'text-bad' };

export function systemStatus(s: RunState, id: SystemId): SystemStatus {
  const sys = s.ship.systems[id];
  if (sys.healthPct <= 0) return 'broken';
  if (sys.shorted) return 'shorted';
  if (!sys.enabled) return 'off';
  return sys.online ? 'online' : 'noPower';
}

/** Consumo que tendría el sistema encendido (los motores dependen del régimen y solo gastan en ruta). */
export function systemDrawKw(s: RunState, id: PoweredSystemId): number {
  const ship = effectiveShipOf(s, getRun()?.catalog);
  return id === 'engines' ? ship.systemDrawKw.engines * getThrottle(ship, s.ship.throttle).engineDrawMult : ship.systemDrawKw[id];
}

function toggle(id: PoweredSystemId): void {
  const s = useGame.getState().hud;
  if (s && useGame.getState().act({ type: 'toggle-system', systemId: id, enabled: !s.ship.systems[id].enabled }).ok) cue('toggle');
}

/** Panel de la sala de máquinas: qué se queda sin energía cuando no hay para todo. */
export function PowerPanel() {
  const { t } = useTranslation();
  const s = useGame((g) => g.hud);
  const close = () => useUi.getState().setOverlay(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (index >= 0 && !e.repeat) toggle(POWERED[index]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!s) return null;
  // 100 % = la nave sana a esta distancia del Sol (nuclear + paneles); sin diseño, el reactor.
  const maxKw = maxPowerKwOf(s, getRun()?.catalog);
  const supplyPct = (s.ship.powerSupplyKw / maxKw) * 100;
  const demandPct = Math.min(140, (s.ship.powerDemandKw / maxKw) * 100);
  const reactor = systemStatus(s, 'reactor');
  return (
    <Modal onClose={close}>
      <Panel title={t('power.title')} code="PWR-02">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-slate-200">
            {t('systemName.reactor', { ns: 'sim' })} · <span className={STATUS_TEXT[reactor]}>{t(`power.state.${reactor}`)}</span> · <span className="num">{t('power.health', { pct: Math.ceil(s.ship.systems.reactor.healthPct) })}</span>
          </span>
          <span className={`num text-base font-bold ${s.ship.overloaded || s.ship.powerSupplyKw <= 0 ? 'animate-pulse text-bad' : 'text-accent'}`}>
            {t('power.balance', { demand: Math.round(s.ship.powerDemandKw), supply: Math.round(s.ship.powerSupplyKw) })}
          </span>
        </div>
        {/* Escala hasta 140 %: fantasma = suministro, relleno = demanda, marca blanca = suministro. */}
        <SegBar pct={demandPct} ghost={supplyPct} marker={supplyPct} max={140} tone={s.ship.overloaded ? 'bad' : 'accent'} seg={7} className="mb-1 h-3" />
        {s.sunDistanceAu !== undefined && (
          <p className="num mb-1 text-xs text-warn">{t('power.solar', { kw: Math.round(s.ship.solarSupplyKw ?? 0), au: s.sunDistanceAu.toFixed(2) })}</p>
        )}
        <p className={`mb-3 text-xs ${s.ship.overloaded ? 'text-bad' : 'text-slate-400'}`}>{t('power.hint')}</p>
        <ul className="flex flex-col gap-2">
          {POWERED.map((id, i) => {
            const status = systemStatus(s, id);
            const sys = s.ship.systems[id];
            return (
              <li key={id} className={`chamfer flex items-center gap-3 p-2 ${sys.enabled ? '' : 'opacity-80'}`}>
                <span className="kbd" title={t('power.toggle', { key: i + 1 })}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-sm text-slate-100">
                    {t(`systemName.${id}`, { ns: 'sim' })}
                    <span className={`num text-xs ${STATUS_TEXT[status]}`}>{t(`power.state.${status}`)}</span>
                  </div>
                  <div className="text-xs text-slate-400">{t(`power.role.${id}`)}</div>
                </div>
                <div className="num text-right text-xs text-slate-300">
                  <div>{t('power.draw', { kw: Math.round(systemDrawKw(s, id)) })}</div>
                  <div className={sys.healthPct < 60 ? 'text-warn' : ''}>{t('power.health', { pct: Math.ceil(sys.healthPct) })}</div>
                </div>
                <button
                  className={`btn w-24 ${sys.enabled ? 'btn-primary' : ''}`}
                  role="switch"
                  aria-checked={sys.enabled}
                  aria-label={t(`systemName.${id}`, { ns: 'sim' })}
                  onClick={() => toggle(id)}
                >
                  {sys.enabled ? 'ON' : 'OFF'}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 text-right">
          <button className="btn" onClick={close}>
            {t('common.close')} <span className="kbd ml-1">{t('keys.interact')}</span>
          </button>
        </div>
      </Panel>
    </Modal>
  );
}
