import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Apple, Fuel, Gem, LifeBuoy, Package, Shield, Wrench } from 'lucide-react';
import { getMaterial, getNode, type RunAction, type SupplyId } from '@payload/shared';
import { effectiveShipOf } from '../game/effective';
import { getRun, useGame } from '../game/runStore';
import {
  buySupplyAction, buyUpgradeAction, deltaText, dispatchShop, moveFocus, sellAction, sellRows, SUPPLY_STEP, supplyRows, upgradeRows, type EffectDelta, type ShopBlock,
} from '../game/shop';
import { DEPOSIT_LOOKS } from '../gfx/surfaceLook';
import { cue } from '../audio/cues';
import { tr } from '../i18n';
import { useUi } from '../state/ui';
import { CreditsBadge, UpgradeIcon } from './Credits';
import { Modal, Panel, fmt } from './common';
import { SectionLabel } from './kit';

const NOTICE_MS = 2600;
const SUPPLY_ICON: Record<SupplyId, ReactNode> = { fuel: <Fuel size={15} />, hull: <Shield size={15} />, spares: <Wrench size={15} /> };

const signed = (n: number): string => (n > 0 ? `+${fmt(n, 1)}` : n < 0 ? `−${fmt(-n, 1)}` : '0');

/** Un efecto de una mejora en pocas letras: «Depósito 100 → 125», «Consumo −12 %», «Escudos +8 kW». */
function useEffectText(): (d: EffectDelta) => string {
  const { t } = useTranslation();
  return (d) => {
    const label = t(`shop.field.${d.field}`);
    const v = deltaText(d);
    switch (d.style) {
      case 'abs':
        return t('shop.abs', { label, before: fmt(v.before ?? 0, 1), after: fmt(v.after ?? 0, 1), unit: d.unit ? t(`shop.unit.${d.unit}`) : '' });
      case 'pct01':
        return t('shop.pct', { label, before: v.before ?? 0, after: v.after ?? 0 });
      case 'kw':
        return t('shop.kw', { label, change: signed(v.change ?? 0) });
      case 'rel':
        return t('shop.rel', { label, change: signed(v.change ?? 0) });
    }
  };
}

/** Botón de compra/venta: el precio en rojo si no llega el dinero; navegable con flechas (`data-col`). */
function ShopButton({ col, onClick, block, children, primary = false, label }: { col: 0 | 1; onClick: () => void; block?: ShopBlock; children: ReactNode; primary?: boolean; label?: string }) {
  return (
    <button
      data-col={col}
      className={`btn shop-btn num shrink-0 !px-2 !py-1 !text-[11px] ${primary ? 'btn-primary' : ''} ${block === 'noCredits' ? 'shop-poor' : ''}`}
      disabled={!!block}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Terminal de la estación: venta de la bodega (izquierda) y tienda de suministros, ayuda de emergencia y
 * mejoras (derecha). Todo lo calcula el motor (`run.stationQuote()`); aquí solo se pinta y se despacha la
 * acción. Como el mapa, NO pausa la partida (atracada el tiempo sigue). Se abre con E en la esclusa o con
 * el botón del mapa estelar; Esc o E lo cierran.
 */
export function StationTerminal() {
  const { t } = useTranslation();
  const s = useGame((g) => g.hud);
  const effect = useEffectText();
  const [notice, setNotice] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = () => useUi.getState().setOverlay(null);
  // Solo se cierra a sí mismo: si otro panel ya ocupa su sitio, no lo toca.
  const closeSelf = () => {
    if (useUi.getState().overlay === 'terminal') close();
  };
  const run = getRun();
  // El terminal solo existe atracada en una estación: si deja de estarlo (salto, partida nueva), se cierra.
  // (La cotización la calcula el motor al pintar: se pinta a ~10 Hz o tras cada acción, nunca por frame.)
  const quote = s && run ? run.stationQuote() : null;
  const open = !!quote;
  useEffect(() => {
    if (!open) closeSelf();
  }, [open]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  // Al abrir, el foco va al primer botón disponible (teclado sin ratón).
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button[data-col]:not(:disabled)')?.focus();
  }, []);

  if (!s || !run || !quote) return null;
  const cat = run.catalog;
  const ship = effectiveShipOf(s, cat);
  const sell = sellRows(quote);
  const supplies = supplyRows(quote, s, ship);
  const upgrades = upgradeRows(quote, s, cat);
  const node = getNode(s.sector, quote.nodeId);

  const act = (action: RunAction) => {
    // Sin aviso global: el rechazo se ve una sola vez, aquí dentro.
    const reason = dispatchShop(useGame.getState().act, action, () => cue('noCredits'));
    setNotice(reason ? tr(reason) : null);
  };

  /** Flechas: arriba/abajo dentro de la columna, izquierda/derecha entre columnas. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || !root.current) return;
    const cols = [0, 1].map((c) => [...root.current!.querySelectorAll<HTMLButtonElement>(`button[data-col="${c}"]:not(:disabled)`)]);
    const active = document.activeElement as HTMLButtonElement | null;
    let at = { col: 0, row: -1 };
    cols.forEach((list, c) => {
      const i = list.indexOf(active as HTMLButtonElement);
      if (i >= 0) at = { col: c, row: i };
    });
    if (at.row < 0) at = { col: cols[0]!.length > 0 ? 0 : 1, row: e.key === 'ArrowUp' ? 0 : -1 };
    const next = moveFocus(cols.map((l) => l.length), at, e.key);
    const target = cols[next.col]?.[next.row];
    if (target) {
      e.preventDefault();
      target.focus();
    }
  };

  return (
    <Modal onClose={close} wide>
      <div ref={root} onKeyDown={onKeyDown}>
        <Panel title={t('shop.title', { node: node?.name ?? '' })} code="TRM-05" aside={<CreditsBadge credits={s.credits} large />}>
          <p className={`num mb-2 h-5 text-xs ${notice ? 'text-warn' : 'text-transparent'}`} role="alert" aria-live="assertive">
            {notice ?? '·'}
          </p>
          <div className="flex flex-col gap-4 lg:flex-row">
            {/* ── Venta de la bodega ── */}
            <section className="flex min-w-0 flex-1 flex-col gap-2" aria-label={t('shop.sell')}>
              <SectionLabel code="01">{t('shop.sell')}</SectionLabel>
              {sell.length === 0 ? (
                <p className="text-sm text-slate-400">{t('shop.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {sell.map((row) => {
                    const look = DEPOSIT_LOOKS[row.materialId];
                    let rare = false;
                    try {
                      rare = !!getMaterial(row.materialId, cat).streak;
                    } catch {
                      rare = false;
                    }
                    const name = t(`catalog.${row.materialId}`, { ns: 'sim' });
                    return (
                      <li key={row.materialId} className="flex items-center gap-2 chip border border-line bg-black/30 px-2 py-1.5 text-sm">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center" style={{ background: `${look?.color ?? '#38e1c0'}33`, color: look?.color ?? '#38e1c0' }} aria-hidden="true">
                          {rare ? <Gem size={14} /> : <Package size={14} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-slate-100">{name}</span>
                        <span className="num text-xs text-slate-300">{t('shop.units', { units: row.units })}</span>
                        <span className="num w-16 text-right text-xs text-slate-400">{t('shop.each', { price: row.unitPrice })}</span>
                        <span className="num w-16 text-right text-xs font-bold text-ok">{t('shop.total', { credits: row.total })}</span>
                        <ShopButton col={0} onClick={() => act(sellAction(row.materialId, 1))} label={`${t('shop.sellOne')} · ${name}`}>
                          {t('shop.sellOne')}
                        </ShopButton>
                        <ShopButton col={0} onClick={() => act(sellAction(row.materialId))} label={`${t('shop.sellAll')} · ${name}`}>
                          {t('shop.sellAll')}
                        </ShopButton>
                      </li>
                    );
                  })}
                </ul>
              )}
              <ShopButton col={0} primary block={sell.length === 0 ? 'full' : null} onClick={() => act(sellAction())}>
                {t('shop.sellHold', { credits: quote.sellTotal })}
              </ShopButton>
            </section>

            {/* ── Tienda: suministros, ayuda de emergencia y mejoras ── */}
            <section className="flex min-w-0 flex-1 flex-col gap-2" aria-label={t('shop.store')}>
              <SectionLabel code="02">{t('shop.supplies')}</SectionLabel>
              <ul className="flex flex-col gap-1.5">
                {supplies.map((row) => (
                  <li key={row.supply} className="flex items-center gap-2 chip border border-line bg-black/30 px-2 py-1.5 text-sm">
                    <span className="text-accent" aria-hidden="true">
                      {SUPPLY_ICON[row.supply]}
                    </span>
                    <span className="flex-1 text-slate-100">{t(`shop.supply.${row.supply}`)}</span>
                    <span className="num text-xs text-slate-300">{t('shop.level', { current: Math.floor(row.current), max: Math.round(row.max) })}</span>
                    {row.fillBlock === 'full' ? (
                      <span className="num w-24 text-right text-xs text-ok">{t('shop.full')}</span>
                    ) : (
                      <>
                        <ShopButton col={1} block={row.stepBlock} label={`${t(`shop.supply.${row.supply}`)} · ${t('shop.step', { units: fmt(row.stepUnits, 0), credits: row.stepCost })}`} onClick={() => act(buySupplyAction(row.supply, SUPPLY_STEP[row.supply]))}>
                          <span className={row.stepBlock === 'noCredits' ? 'text-bad' : ''}>{t('shop.step', { units: fmt(row.stepUnits, 0), credits: row.stepCost })}</span>
                        </ShopButton>
                        <ShopButton
                          col={1}
                          primary
                          block={row.fillBlock}
                          label={`${t(`shop.supply.${row.supply}`)} · ${row.fillsUp ? t('shop.fill', { credits: row.fillCost }) : t('shop.fillPartial', { units: fmt(row.fillUnits, 0), credits: row.fillCost })}`}
                          onClick={() => act(buySupplyAction(row.supply))}>
                          <span className={row.fillBlock === 'noCredits' ? 'text-bad' : ''}>
                            {row.fillsUp ? t('shop.fill', { credits: row.fillCost }) : t('shop.fillPartial', { units: fmt(row.fillUnits, 0), credits: row.fillCost })}
                          </span>
                        </ShopButton>
                      </>
                    )}
                  </li>
                ))}
                {quote.provisions && s.psych && (
                  <li className="flex items-center gap-2 chip border border-line bg-black/30 px-2 py-1.5 text-sm">
                    <Apple size={15} className="text-accent" aria-hidden="true" />
                    <span className="flex-1 text-slate-100">{t('shop.provisions')}</span>
                    <span className="num text-xs text-slate-300">{t('shop.level', { current: Math.floor(s.psych.provisions), max: Math.floor(s.psych.provisions + quote.provisions.missing) })}</span>
                    {quote.provisions.missing <= 0 ? (
                      <span className="num w-24 text-right text-xs text-ok">{t('shop.full')}</span>
                    ) : (
                      <ShopButton
                        col={1}
                        primary
                        block={quote.provisions.affordable < 1 ? 'noCredits' : undefined}
                        label={`${t('shop.provisions')} · ${t('shop.fill', { credits: Math.ceil(quote.provisions.unitPrice * quote.provisions.missing) })}`}
                        onClick={() => act({ type: 'buy-provisions', ...(quote.provisions!.affordable < quote.provisions!.missing ? { amount: quote.provisions!.affordable } : {}) })}>
                        <span className={quote.provisions.affordable < 1 ? 'text-bad' : ''}>{t('shop.fill', { credits: Math.ceil(quote.provisions.unitPrice * Math.min(quote.provisions.missing, quote.provisions.affordable || quote.provisions.missing)) })}</span>
                      </ShopButton>
                    )}
                  </li>
                )}
                {quote.emergency.available && (
                  <li className="flex items-center gap-2 chip border border-warn/50 bg-warn/5 px-2 py-1.5 text-sm">
                    <LifeBuoy size={15} className="text-warn" aria-hidden="true" />
                    <span className="text-slate-100">{t('shop.emergency')}</span>
                    <span className="num min-w-0 flex-1 truncate text-xs text-slate-300">
                      {[
                        ...(quote.emergency.fuel >= 1 ? [t('shop.giveFuel', { n: Math.round(quote.emergency.fuel) })] : []),
                        ...(quote.emergency.hull >= 1 ? [t('shop.giveHull', { n: Math.round(quote.emergency.hull) })] : []),
                        ...(quote.emergency.spares >= 1 ? [t('shop.giveSpares', { n: quote.emergency.spares })] : []),
                      ].join(' · ')}
                    </span>
                    <ShopButton col={1} onClick={() => act({ type: 'service' })}>
                      {t('shop.emergencyTake')}
                    </ShopButton>
                  </li>
                )}
              </ul>

              <SectionLabel code="03" className="mt-1">{t('shop.upgrades')}</SectionLabel>
              {upgrades.length === 0 ? (
                <p className="text-sm text-slate-400">{t('shop.noUpgrades')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {upgrades.map((u) => {
                    const name = t(`catalog.${u.upgradeId}`, { ns: 'sim' });
                    return (
                      <li key={u.upgradeId} className={`flex items-center gap-2 chip border px-2 py-1.5 text-sm ${u.level > 0 ? 'border-accent/50 bg-accent/5' : 'border-line bg-black/30'}`}>
                        <span className="text-accent" aria-hidden="true">
                          <UpgradeIcon field={u.iconField} size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate text-slate-100">{name}</span>
                            <span className="num text-[11px] text-slate-400">{t('shop.upgradeLevel', { level: u.level, max: u.maxLevel })}</span>
                          </div>
                          {u.nextLevel !== null && (
                            <div className="num truncate text-[11px]">
                              <span className="text-ok">{u.gains.map(effect).join(' · ')}</span>
                              {u.overloads && (
                                <span className="text-warn" title={t('shop.overload')}>
                                  {' · '}
                                  <AlertTriangle size={11} className="inline -mt-0.5" aria-hidden="true" /> {t('shop.overload')}
                                </span>
                              )}
                              {(u.costs.length > 0 || u.massKg > 0) && <span className="text-warn"> · {[...u.costs.map(effect), ...(u.massKg > 0 ? [t('shop.mass', { kg: fmt(u.massKg, 0) })] : [])].join(' · ')}</span>}
                            </div>
                          )}
                        </div>
                        {u.nextLevel === null ? (
                          <span className="num text-xs text-ok">{t('shop.maxed')}</span>
                        ) : (
                          <ShopButton col={1} primary block={u.block} onClick={() => act(buyUpgradeAction(u.upgradeId))} label={`${name} · ${t('shop.buy', { credits: u.price ?? 0 })}`}>
                            <span className={u.block === 'noCredits' ? 'text-bad' : ''}>{t('shop.buy', { credits: u.price ?? 0 })}</span>
                          </ShopButton>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="num text-[11px] text-slate-500">{t('shop.keys')}</span>
            <button className="btn" onClick={close}>
              {t('common.close')} <span className="kbd ml-1">{t('keys.pause')}</span>
            </button>
          </div>
        </Panel>
      </div>
    </Modal>
  );
}
