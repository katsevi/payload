import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Package } from 'lucide-react';
import { getNode, getNodeKind, getNodeWorld, HAZARD_KINDS, THROTTLE_IDS, type NodeKind, type RunState, type SectorNode } from '@payload/shared';
import { cue } from '../audio/cues';
import { getRun, useGame } from '../game/runStore';
import { lt } from '../i18n';
import { useUi } from '../state/ui';
import { Modal, Panel, fmt } from './common';

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
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-slate-100">{node.name}</h3>
        <span className="num text-xs uppercase tracking-wider" style={{ color: KIND_COLOR[node.kind] }}>
          {lt(kind.name)}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
        {visited && <span>{t('map.visited')}</span>}
        {kind.landable && <LandableInfo s={s} node={node} />}
        {sensors && !visited && node.cache && (
          <span className="flex items-center gap-1 text-ok">
            <Package size={13} /> {t('map.cache')}
          </span>
        )}
        {kind.service && <span className="text-accent">{t('map.service')}</span>}
      </div>
      {estimate && (
        <>
          <div className="num flex items-center justify-between text-xs text-slate-300">
            <span>
              {t('map.distance')}: {t('map.ly', { value: fmt(estimate.distanceLy, 0) })}
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
                  className={`num flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs ${active ? 'border-accent bg-accent/10 text-accent' : 'border-line text-slate-200 hover:border-accent/60'}`}
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
          <p className="text-xs text-slate-400">{t(`map.throttleHint.${s.ship.throttle}`)}</p>
          <button className="btn btn-primary !py-2.5" disabled={s.phase !== 'docked' || !chosen?.enoughFuel} onClick={onJump}>
            {chosen?.enoughFuel ? t('map.jump', { node: node.name }) : t('map.notEnough')}
          </button>
        </>
      )}
    </div>
  );
}

/** Mapa del sector: se abre desde la mesa del puente. Aquí se decide ruta y régimen. */
export function StarMap() {
  const { t } = useTranslation();
  const s = useGame((g) => g.hud);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const project = useProjection(s?.sector.nodes ?? []);
  if (!s) return null;
  const close = () => useUi.getState().setOverlay(null);
  const here = getNode(s.sector, s.locationId)!;
  const selected = selectedId ? getNode(s.sector, selectedId) : undefined;
  const reachable = s.phase === 'docked' ? here.links : [];
  const hereKind = getNodeKind(here.kind);
  const serviceUsed = s.servicedIds.includes(here.id);
  const sensors = s.ship.systems.nav.online;
  const jump = () => {
    if (selected && useGame.getState().act({ type: 'jump', toId: selected.id }).ok) close();
  };
  const service = () => {
    if (useGame.getState().act({ type: 'service' }).ok) cue('ok');
  };
  return (
    <Modal onClose={close} wide>
      <Panel title={t('map.title', { sector: s.sector.index })}>
        <div className="flex flex-col gap-4 lg:flex-row">
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="min-w-0 flex-1 rounded border border-line bg-black/50" role="group" aria-label={t('map.title', { sector: s.sector.index })}>
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
                      stroke={picked || active ? '#38e1c0' : live ? '#4d6f9c' : '#1f3a5f'}
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
                  {n.id === selectedId && <circle r={16} fill="none" stroke="#38e1c0" strokeWidth={1.5} />}
                  {isHere && <circle r={15} fill="none" stroke="#ffffff" strokeWidth={2} strokeDasharray="4 3" />}
                  <NodeGlyph kind={n.kind} />
                  {showCache && <circle cx={11} cy={-10} r={3.5} fill="#3ddc84" />}
                  <text y={27} textAnchor="middle" fontSize={11} fill={isHere ? '#ffffff' : '#9fb4d0'} fontFamily="ui-monospace, monospace">
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
          <div className="flex w-full flex-col gap-3 lg:w-72">
            {s.transit ? (
              <p className="num text-sm text-accent">{t('map.inTransit', { pct: Math.round((s.transit.traveledLy / s.transit.distanceLy) * 100) })}</p>
            ) : selected && selected.id !== here.id ? (
              <Details s={s} node={selected} onJump={jump} />
            ) : (
              <p className="text-sm text-slate-300">{t('map.select')}</p>
            )}
            {hereKind.service && s.phase === 'docked' && (
              <div className="rounded border border-line p-2">
                <button className="btn w-full" disabled={serviceUsed} onClick={service}>
                  {serviceUsed ? t('map.serviceUsed') : t('map.service')}
                </button>
                {!serviceUsed && <p className="mt-1 text-xs text-slate-400">{t('map.serviceHint')}</p>}
              </div>
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
