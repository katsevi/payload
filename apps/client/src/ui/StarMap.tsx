import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Package, Star, Store, Sun, Weight } from 'lucide-react';
import {
  cruisePowerMarginKw, getNode, getNodeKind, getNodeWorld, hasShop, HAZARD_KINDS, shipPowerKw, solarKw, solarPowerFactor, THROTTLE_IDS,
  type NodeKind, type RunState, type SectorNode,
} from '@payload/shared';
import { effectiveShipOf } from '../game/effective';
import { getRun, useGame } from '../game/runStore';
import { cargoFuelPct } from '../game/shop';
import { isLandableNode } from '../game/surfaceRules';
import { lt } from '../i18n';
import { useUi } from '../state/ui';
import { CreditsBadge } from './Credits';
import { Modal, Panel, fmt } from './common';
import { GlossaryButton, GlossaryPanel, useGlossary } from './Glossary';
import { distanceText, nodeName } from './names';

// Mapa 3D del sistema solar (partidas con diseño): la escena solo se descarga si hace falta.
const SolarMapScene = lazy(() => import('../scenes/SolarMapScene').then((m) => ({ default: m.SolarMapScene })));

const KIND_COLOR: Record<NodeKind, string> = {
  station: '#38e1c0',
  planet: '#5aa9ff',
  moon: '#b8bec9',
  asteroid: '#c79a6b',
  nebula: '#c77dff',
  derelict: '#8a94a6',
  gate: '#ffd25a',
};
const RISK_COLOR = ['text-ok', 'text-warn', 'text-bad', 'text-bad'];
const EMPTY: readonly string[] = [];

const VIEW_W = 640;
const VIEW_H = 330;
const PAD = 46;

/** Símbolo de cada tipo de destino (formas distintas: no depende solo del color). */
function NodeGlyph({ kind }: { kind: NodeKind }) {
  const c = KIND_COLOR[kind];
  switch (kind) {
    case 'station':
      return <rect x={-7} y={-7} width={14} height={14} fill={c} transform="rotate(45)" />;
    case 'planet':
      return <circle r={9} fill={c} />;
    case 'moon':
      return <circle r={6} fill={c} />;
    case 'asteroid':
      return <polygon points="-8,5 -3,-7 6,-5 8,4 1,8" fill={c} />;
    case 'nebula':
      return (
        <g fill={c} opacity={0.75}>
          <circle cx={-4} cy={1} r={6} />
          <circle cx={4} cy={-2} r={6} />
        </g>
      );
    case 'derelict':
      return <path d="M-8 -3 L8 -6 L6 5 L-7 6 Z" fill="none" stroke={c} strokeWidth={2.5} />;
    case 'gate':
      return <circle r={9} fill="none" stroke={c} strokeWidth={3.5} />;
  }
}

function useProjection(nodes: SectorNode[]) {
  return useMemo(() => {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sx = (VIEW_W - PAD * 2) / Math.max(1, maxX - minX);
    const sy = (VIEW_H - PAD * 2) / Math.max(1, maxY - minY);
    return (n: SectorNode): [number, number] => [PAD + (n.x - minX) * sx, PAD + (n.y - minY) * sy];
  }, [nodes]);
}

/** Mundo de un destino aterrizable: nombre y gravedad (o si ya se aterrizó en él). */
function LandableInfo({ s, node }: { s: RunState; node: SectorNode }) {
  const { t } = useTranslation();
  const run = getRun();
  const world = run ? getNodeWorld(s.seed, s.sector, node.id, run.catalog) : null;
  if (s.landedIds.includes(node.id)) return <span>{t('map.landed')}</span>;
  return (
    <span className="text-accent">
      {t('map.landable')}
      {world && ` · ${t(`catalog.${world.id}`, { ns: 'sim' })} · ${t('hud.gravity', { g: fmt(world.gravityMps2, 1) })}`}
    </span>
  );
}

function Details({ s, node, onJump }: { s: RunState; node: SectorNode; onJump: () => void }) {
  const { t } = useTranslation();
  const estimate = getRun()?.estimateJump(node.id) ?? null;
  const sensors = s.ship.systems.nav.online;
  const kind = getNodeKind(node.kind);
  const visited = s.visitedIds.includes(node.id);
  const chosen = estimate?.byThrottle[s.ship.throttle];
  const solar = !!s.missionDesign;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="display text-base font-semibold !tracking-[0.08em] text-slate-50">{nodeName(node)}</h3>
        <span className="num text-xs uppercase tracking-wider" style={{ color: KIND_COLOR[node.kind] }}>
          {lt(kind.name)}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
        {visited && <span>{t('map.visited')}</span>}
        {isLandableNode(s, node.id, getRun()?.catalog) && <LandableInfo s={s} node={node} />}
        {sensors && !visited && node.cache && (
          <span className="flex items-center gap-1 text-ok">
            <Package size={13} /> {t('map.cache')}
          </span>
        )}
        {hasShop(kind) && <span className="text-accent">{t('map.terminal')}</span>}
        {node.missionTarget && (
          <span className="flex items-center gap-1 text-warn">
            <Star size={12} fill="currentColor" aria-hidden="true" /> {t('map.target')}
          </span>
        )}
      </div>
      {solar && <SolarAt s={s} au={node.sunDistanceAu ?? 1} />}
      {estimate && (
        <>
          <div className="num flex items-center justify-between text-xs text-slate-300">
            <span>
              {t('map.distance')}: <span title={solar ? t('map.unitsHint') : undefined}>{distanceText(estimate.distanceLy, solar)}</span>
            </span>
            {sensors ? (
              <span className={`flex items-center gap-1 ${RISK_COLOR[estimate.riskLevel]}`}>
                <AlertTriangle size={13} />
                {t('map.risk')}: {t(`map.riskLevel.${estimate.riskLevel}`)}
              </span>
            ) : (
              <span className="text-warn">{t('map.sensorsDown')}</span>
            )}
          </div>
          {sensors && (
            <div className="num flex flex-wrap gap-x-3 text-[11px] text-slate-400">
              {HAZARD_KINDS.filter((h) => estimate.expectedHazards[h] >= 0.25).map((h) => (
                <span key={h}>
                  {t(`hazard.${h}`, { ns: 'sim' })} ~{fmt(estimate.expectedHazards[h], 1)}
                </span>
              ))}
            </div>
          )}
          <div role="radiogroup" aria-label={t('map.throttle')} className="flex flex-col gap-1">
            {THROTTLE_IDS.map((id) => {
              const e = estimate.byThrottle[id];
              const active = s.ship.throttle === id;
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={active}
                  title={t(`map.throttleHint.${id}`)}
                  className="seg-option chip num flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs"
                  onClick={() => useGame.getState().act({ type: 'set-throttle', throttle: id })}
                >
                  <span className="w-20 font-bold">{t(`throttle.${id}`, { ns: 'sim' })}</span>
                  <span className={e.enoughFuel ? '' : 'text-bad'}>
                    {t('map.fuel')} {fmt(e.fuel, 0)}
                  </span>
                  <span>{e.timeS >= 0 ? t('map.seconds', { value: fmt(e.timeS, 0) }) : '—'}</span>
                </button>
              );
            })}
          </div>
          {/* La masa a bordo (bodega + mejoras) encarece el salto: se dice en una línea, solo si pesa. */}
          {estimate.cargoFuelMult !== undefined && cargoFuelPct(estimate.cargoFuelMult) > 0 && (
            <p className="num flex items-center gap-1 text-xs text-warn">
              <Weight size={13} aria-hidden="true" />
              {t('map.cargoFuel', { pct: cargoFuelPct(estimate.cargoFuelMult) })}
            </p>
          )}
          <p className="text-xs text-slate-400">{t(`map.throttleHint.${s.ship.throttle}`)}</p>
          <button className="btn btn-primary btn-lg" disabled={s.phase !== 'docked' || !chosen?.enoughFuel} onClick={onJump}>
            {chosen?.enoughFuel ? t('map.jump', { node: nodeName(node) }) : t('map.notEnough')}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Energía en el destino (partidas con diseño): distancia al Sol, lo que darán allí los paneles y si el consumo a
 * crucero con todo encendido cabe. Las cifras salen del motor (`shipPowerKw`, `cruisePowerMarginKw`).
 */
function SolarAt({ s, au }: { s: RunState; au: number }) {
  const { t } = useTranslation();
  const ship = effectiveShipOf(s, getRun()?.catalog);
  const margin = cruisePowerMarginKw(ship, au);
  return (
    <div className="num flex flex-col gap-0.5 text-xs">
      <span className="flex items-center gap-1 text-slate-300">
        <Sun size={13} className="text-warn" aria-hidden="true" />
        {t('map.sunDistance', { au: fmt(au, 2) })} · {t('map.powerThere', { kw: fmt(shipPowerKw(ship, au), 0), solar: fmt(solarKw(ship, au), 0) })}
      </span>
      {margin < 0 && <span className="text-bad">{t('map.powerShort', { kw: fmt(-margin, 0) })}</span>}
    </div>
  );
}

/** Dónde está la nave respecto al Sol y qué dan ahora los paneles (cabecera del mapa solar). */
function SolarHere({ s }: { s: RunState }) {
  const { t } = useTranslation();
  const au = s.sunDistanceAu ?? 1;
  return (
    <p className="num flex flex-wrap items-center gap-x-2 text-xs text-slate-300">
      <Sun size={13} className="text-warn" aria-hidden="true" />
      <span>{t('map.sunDistance', { au: fmt(au, 2) })}</span>
      <span>{t('map.solarHere', { pct: Math.round(solarPowerFactor(au) * 100), kw: fmt(s.ship.solarSupplyKw ?? 0, 0) })}</span>
    </p>
  );
}

/** Mapa del sector: se abre desde la mesa del puente. Aquí se decide ruta y régimen. */
export function StarMap() {
  const { t } = useTranslation();
  const s = useGame((g) => g.hud);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [glossary, setGlossary] = useGlossary();
  const project = useProjection(s?.sector.nodes ?? []);
  if (!s) return null;
  const close = () => useUi.getState().setOverlay(null);
  const here = getNode(s.sector, s.locationId)!;
  const selected = selectedId ? getNode(s.sector, selectedId) : undefined;
  const reachable = s.phase === 'docked' ? here.links : [];
  const hereKind = getNodeKind(here.kind);
  const sensors = s.ship.systems.nav.online;
  const jump = () => {
    if (selected && useGame.getState().act({ type: 'jump', toId: selected.id }).ok) close();
  };
  // Con diseño (fase 4) el mapa es el sistema solar en 3D; la escena usa el sector VIVO (misma identidad entre
  // refrescos del HUD) para no recalcular posiciones diez veces por segundo.
  const solar = !!s.missionDesign;
  const liveSector = getRun()?.state.sector ?? s.sector;
  const liveLinks = s.phase === 'docked' ? (getNode(liveSector, here.id)?.links ?? EMPTY) : EMPTY;
  return (
    <Modal onClose={close} wide>
      <Panel title={solar ? t('map.solarTitle', { sector: s.sector.index }) : t('map.title', { sector: s.sector.index })} code="NAV-03">
        <div className="flex flex-col gap-4 lg:flex-row">
          {solar ? (
            <div className="hud-frame relative h-[360px] min-w-0 flex-1 overflow-hidden bg-black/60 lg:h-[460px]">
              <Suspense fallback={null}>
                <SolarMapScene sector={liveSector} hereId={here.id} reachable={liveLinks} selectedId={selectedId} onSelect={setSelectedId} />
              </Suspense>
              <span className="num pointer-events-none absolute bottom-1 left-2 text-[10px] text-slate-500">{t('map.scaleHint')}</span>
              {glossary && <GlossaryPanel className="absolute right-2 top-2" onClose={() => setGlossary(false)} />}
            </div>
          ) : (
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="map-grid min-w-0 flex-1 border border-line bg-black/50" role="group" aria-label={t('map.title', { sector: s.sector.index })}>
            {s.sector.nodes.flatMap((a) =>
              a.links
                .filter((id) => id > a.id)
                .map((id) => {
                  const b = getNode(s.sector, id)!;
                  const [x1, y1] = project(a);
                  const [x2, y2] = project(b);
                  const live = (a.id === here.id && reachable.includes(b.id)) || (b.id === here.id && reachable.includes(a.id));
                  const picked = live && (a.id === selectedId || b.id === selectedId);
                  const active = !!s.transit && [s.transit.fromId, s.transit.toId].includes(a.id) && [s.transit.fromId, s.transit.toId].includes(b.id);
                  return (
                    <line
                      key={`${a.id}-${b.id}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={picked || active ? '#4cd8ff' : live ? '#4f7396' : '#263a4d'}
                      strokeWidth={picked || active ? 2.5 : 1.3}
                      strokeDasharray={live || active ? undefined : '3 5'}
                    />
                  );
                }),
            )}
            {s.sector.nodes.map((n) => {
              const [x, y] = project(n);
              const canGo = reachable.includes(n.id);
              const isHere = n.id === here.id && !s.transit;
              const showCache = sensors && n.cache && !s.visitedIds.includes(n.id);
              return (
                <g
                  key={n.id}
                  transform={`translate(${x} ${y})`}
                  tabIndex={canGo ? 0 : -1}
                  role="button"
                  aria-label={`${n.name} · ${lt(getNodeKind(n.kind).name)}`}
                  aria-disabled={!canGo}
                  className={canGo ? 'cursor-pointer' : ''}
                  opacity={canGo || isHere || n.id === s.sector.goalId ? 1 : 0.55}
                  onClick={() => setSelectedId(n.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedId(n.id)}
                >
                  <circle r={20} fill="transparent" />
                  {n.id === selectedId && <rect x={-16} y={-16} width={32} height={32} fill="none" stroke="#4cd8ff" strokeWidth={1.2} strokeDasharray="6 20" strokeDashoffset={3} />}
                  {isHere && <circle r={15} fill="none" stroke="#ffffff" strokeWidth={2} strokeDasharray="4 3" />}
                  <NodeGlyph kind={n.kind} />
                  {showCache && <circle cx={11} cy={-10} r={3.5} fill="#3ddc84" />}
                  <text y={27} textAnchor="middle" fontSize={11} fill={isHere ? '#ffffff' : '#a9bacb'} fontFamily="var(--font-mono)">
                    {n.name}
                  </text>
                  {isHere && (
                    <text y={-20} textAnchor="middle" fontSize={10} fill="#ffffff">
                      {t('map.here')}
                    </text>
                  )}
                  {n.id === s.sector.goalId && (
                    <text y={-20} textAnchor="middle" fontSize={10} fill="#ffd25a">
                      {t('map.goal')}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          )}
          <div className="flex w-full flex-col gap-3 lg:w-72">
            {solar && (
              <div className="flex items-start justify-between gap-2">
                <SolarHere s={s} />
                <GlossaryButton open={glossary} onToggle={() => setGlossary((g) => !g)} />
              </div>
            )}
            {solar && s.phase === 'docked' && reachable.length > 0 && (
              <div className="flex flex-col gap-1" role="group" aria-label={t('map.reachable')}>
                <span className="label-code">{t('map.reachable')}</span>
                <div className="flex flex-wrap gap-1">
                  {reachable.map((id) => {
                    const n = getNode(s.sector, id);
                    if (!n) return null;
                    return (
                      <button key={id} className="seg-option chip num px-2 py-0.5 text-xs" aria-pressed={id === selectedId} onClick={() => setSelectedId(id)}>
                        {n.missionTarget ? '★ ' : ''}
                        {nodeName(n)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {s.transit ? (
              <p className="num text-sm text-accent">{t('map.inTransit', { pct: Math.round((s.transit.traveledLy / s.transit.distanceLy) * 100) })}</p>
            ) : selected && selected.id !== here.id ? (
              <Details s={s} node={selected} onJump={jump} />
            ) : (
              <p className="text-sm text-slate-300">{t('map.select')}</p>
            )}
            {/* Atracada en una estación: el terminal (venta, suministros, ayuda de emergencia y mejoras). */}
            {hasShop(hereKind) && s.phase === 'docked' && (
              <button className="btn flex w-full items-center justify-between gap-2 !tracking-[0.06em]" onClick={() => useUi.getState().setOverlay('terminal')}>
                <span className="flex items-center gap-2">
                  <Store size={15} aria-hidden="true" />
                  {t('map.terminal')}
                </span>
                <CreditsBadge credits={s.credits} />
              </button>
            )}
            <button className="btn mt-auto" onClick={close}>
              {t('common.close')} <span className="kbd ml-1">{t('keys.interact')}</span>
            </button>
          </div>
        </div>
      </Panel>
    </Modal>
  );
}
