import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Backpack, Coins, Fuel, Gauge, HardHat, Package, Rocket, Shield, ShieldPlus, Wind, Wrench, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getRun } from '../game/runStore';
import { installedUpgrades } from '../game/shop';

/** Tiempo que se ve el «+N / −N» tras ganar o gastar créditos. */
const POP_MS = 1100;

/**
 * Créditos con una animación breve al cambiar: el número late y sale un «+N» verde o «−N» ámbar. Solo
 * reacciona a cambios de la copia del HUD (~10 Hz), nunca por frame.
 */
export function CreditsBadge({ credits, large = false, className = '' }: { credits: number; large?: boolean; className?: string }) {
  const { t } = useTranslation();
  const prev = useRef(credits);
  const [pop, setPop] = useState<{ delta: number; seq: number } | null>(null);
  useEffect(() => {
    const delta = credits - prev.current;
    prev.current = credits;
    if (delta === 0) return;
    setPop((p) => ({ delta, seq: (p?.seq ?? 0) + 1 }));
    const timer = setTimeout(() => setPop(null), POP_MS);
    return () => clearTimeout(timer);
  }, [credits]);
  return (
    <span className={`relative inline-flex items-center gap-1.5 ${className}`} title={t('hud.credits')} role="status" aria-live="polite">
      <Coins size={large ? 18 : 15} className="text-warn" aria-hidden="true" />
      <span key={pop?.seq ?? 0} className={`num font-bold text-slate-100 ${large ? 'text-lg' : 'text-xs'} ${pop ? 'credits-bump' : ''}`}>
        <span className="sr-only">{t('hud.credits')} </span>
        {t('hud.creditsValue', { credits })}
      </span>
      {pop && (
        <span key={`p${pop.seq}`} className={`credits-pop num pointer-events-none absolute -top-3 right-0 text-xs font-bold ${pop.delta > 0 ? 'text-ok' : 'text-warn'}`} aria-hidden="true">
          {pop.delta > 0 ? `+${pop.delta}` : `−${-pop.delta}`}
        </span>
      )}
    </span>
  );
}

/** Icono de una mejora según el campo de su primer efecto (no según su id: el catálogo puede crecer). */
export function UpgradeIcon({ field, size = 14 }: { field: string; size?: number }): ReactNode {
  const [target, name = ''] = field.split('.');
  if (target === 'jetpack') return <ArrowUp size={size} />;
  if (target === 'falls') return <HardHat size={size} />;
  if (target === 'suit') return name === 'carryCapacityKg' ? <Backpack size={size} /> : <Wind size={size} />;
  if (name === 'fuelCapacity') return <Fuel size={size} />;
  if (name === 'hullMax') return <Shield size={size} />;
  if (name.startsWith('shield')) return <ShieldPlus size={size} />;
  if (name === 'maxSpares') return <Wrench size={size} />;
  if (name.startsWith('reactor') || name.startsWith('overload')) return <Zap size={size} />;
  if (name === 'cruiseSpeedLyPerS' || name === 'fuelPerLy') return <Rocket size={size} />;
  if (name.startsWith('systemDrawKw')) return <Gauge size={size} />;
  return <Package size={size} />;
}

/**
 * Mejoras instaladas: una fila de iconos con un piloto por nivel (encendido = comprado). La señal de que
 * «la nave es otra» sin tocar su geometría exterior (fuera de alcance de la fase 3).
 */
export function UpgradeStrip({ upgrades }: { upgrades: Readonly<Record<string, number>> | undefined }) {
  const { t } = useTranslation();
  const list = installedUpgrades(upgrades, getRun()?.catalog);
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={t('hud.upgrades')}>
      {list.map((u) => (
        <li key={u.upgradeId} className="flex items-center gap-0.5 rounded border border-accent/40 bg-accent/10 px-1 py-0.5 text-accent" title={`${t(`catalog.${u.upgradeId}`, { ns: 'sim' })} · ${t('shop.upgradeLevel', { level: u.level, max: u.maxLevel })}`}>
          <UpgradeIcon field={u.iconField} size={12} />
          <span className="flex flex-col gap-px" aria-hidden="true">
            {Array.from({ length: u.maxLevel }, (_, k) => (
              <span key={k} className={`block h-0.5 w-1.5 rounded-full ${k < u.level ? 'bg-accent' : 'bg-slate-600'}`} />
            )).reverse()}
          </span>
          <span className="sr-only">
            {t(`catalog.${u.upgradeId}`, { ns: 'sim' })} {t('shop.upgradeLevel', { level: u.level, max: u.maxLevel })}
          </span>
        </li>
      ))}
    </ul>
  );
}
