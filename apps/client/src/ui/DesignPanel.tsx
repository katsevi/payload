import { Minus, Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { TeamActionCheck } from '@payload/shared';
import { useTranslation } from 'react-i18next';
import { catalog, componentsForScenario, type ComponentDef, type SubsystemId } from '@payload/shared';
import { lt, tr } from '../i18n';
import { useRequestCooldown, useStableCanDo } from '../room/hooks';
import { LastNoGoPanel } from '../room/RoomReview';
import { selectInRoom, useRoom } from '../net/roomStore';
import { getSession } from '../net/sessionStore';
import { SUBSYSTEM_ORDER } from '../scenes/hangarLayout';
import { useDesign } from '../state/design';
import { Panel, fmt, useBudgets, useScenario } from './common';
import { IssueList } from './Screens';
import { ResourcePanel } from './ResourcePanel';
import { AdvisorsPanel } from './LearningPanels';
import { useAcademy } from '../academy/academyStore';

/**
 * Selectores de órbita y lanzador (permitidos por el escenario). Usado en la consola 3D y en el modo 2D.
 * Lee `useDesign`; escribe a través de la sesión (solitario: store; sala: acción al servidor).
 */
export function MissionSelectors() {
  const { t } = useTranslation();
  const scenario = useScenario();
  const orbitId = useDesign((s) => s.orbitId);
  const launcherId = useDesign((s) => s.launcherId);
  const setOrbit = (o: typeof orbitId) => getSession().selectOrbit(o);
  const setLauncher = (l: string | null) => getSession().selectLauncher(l);
  const orbits = catalog.orbits.filter((o) => scenario?.allowedOrbits.includes(o.id));
  const launchers = catalog.launchers.filter((l) => scenario?.allowedLaunchers.includes(l.id));
  const orbit = orbits.find((o) => o.id === orbitId);
  const launcher = launchers.find((l) => l.id === launcherId);
  const selectCls = 'w-full rounded border border-line bg-[#0a1424] p-2 text-sm disabled:opacity-50';
  // En sala: la decisión es de la Dirección. El veredicto sale de `canDo` (no se duplican reglas).
  const orbitAction = useMemo(() => ({ type: 'select-orbit' as const, orbitId }), [orbitId]);
  const launcherAction = useMemo(() => ({ type: 'select-launcher' as const, launcherId }), [launcherId]);
  const orbitCheck = useStableCanDo(orbitAction);
  const launcherCheck = useStableCanDo(launcherAction);
  const orbitDenied = orbitCheck?.kind === 'reject' ? tr(orbitCheck.reason) : undefined;
  const launcherDenied = launcherCheck?.kind === 'reject' ? tr(launcherCheck.reason) : undefined;
  return (
    <div className="space-y-3">
      <label className="block text-xs uppercase tracking-wider text-slate-400">
        {t('hangar.orbit')}
        <select className={selectCls} disabled={!!orbitDenied} title={orbitDenied} aria-describedby={orbitDenied ? 'orbit-denied' : undefined} value={orbitId ?? ''} onChange={(e) => setOrbit(e.target.value ? (e.target.value as typeof orbitId) : null)}>
          <option value="">{t('hangar.choose')}</option>
          {orbits.map((o) => (
            <option key={o.id} value={o.id}>
              {lt(o.name)} ({fmt(o.perigeeKm, 0)}–{fmt(o.apogeeKm, 0)} {t('unit.km')})
            </option>
          ))}
        </select>
      </label>
      {orbitDenied && <p id="orbit-denied" className="text-xs text-warn">{orbitDenied}</p>}
      {orbit && <p className="text-xs text-slate-300">{lt(orbit.why)}</p>}
      <label className="block text-xs uppercase tracking-wider text-slate-400">
        {t('hangar.launcher')}
        <select className={selectCls} disabled={!!launcherDenied} title={launcherDenied} aria-describedby={launcherDenied ? 'launcher-denied' : undefined} value={launcherId ?? ''} onChange={(e) => setLauncher(e.target.value || null)}>
          <option value="">{t('hangar.choose')}</option>
          {launchers.map((l) => (
            <option key={l.id} value={l.id}>
              {lt(l.name)} ({fmt(l.costMUSD)} {t('unit.musd')})
            </option>
          ))}
        </select>
      </label>
      {launcherDenied && <p id="launcher-denied" className="text-xs text-warn">{launcherDenied}</p>}
      {launcher && <p className="text-xs text-slate-300">{lt(launcher.description)}</p>}
    </div>
  );
}

/** Texto de una restricción de sala: el motivo del rechazo, o el porqué de la solicitud automática. */
function checkNote(check: TeamActionCheck | null): { kind: 'reject' | 'request'; text: string } | null {
  if (!check || check.kind === 'apply') return null;
  return check.kind === 'reject' ? { kind: 'reject', text: tr(check.reason) } : { kind: 'request', text: tr(check.why) };
}

function ComponentRow({ c }: { c: ComponentDef }) {
  const { t } = useTranslation();
  const count = useDesign((s) => s.componentIds.filter((id) => id === c.id).length);
  const add = (id: string) => getSession().addComponent(id);
  const removeOne = (id: string) => getSession().removeComponent(id);
  const addAction = useMemo(() => ({ type: 'add-component' as const, componentId: c.id }), [c.id]);
  const removeAction = useMemo(() => ({ type: 'remove-component' as const, componentId: c.id }), [c.id]);
  const addCheck = useStableCanDo(addAction);
  const removeCheck = useStableCanDo(removeAction);
  const cooldown = useRequestCooldown();
  // Tras una solicitud propia, otra tan pronto chocaría con el límite de ráfaga del servidor.
  const coolingDown = cooldown && addCheck?.kind === 'request';
  const addNote = coolingDown ? { kind: 'reject' as const, text: t('room.requests.cooldown') } : checkNote(addCheck);
  const removeNote = checkNote(removeCheck);
  return (
    <li className={`flex items-center gap-2 border-b border-line/50 py-1.5 text-sm ${addCheck?.kind === 'reject' ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate">{lt(c.name)}</div>
        {addNote && <div className={`text-[11px] ${addNote.kind === 'reject' ? 'text-slate-400' : 'text-warn'}`}>{addNote.kind === 'request' ? `${t('room.perm.request')}: ` : ''}{addNote.text}</div>}
        <div className="num text-[11px] text-slate-400" title={lt(c.why)}>
          {fmt(c.massKg)} {t('unit.kg')} · {fmt(c.powerW)} {t('unit.w')} · {fmt(c.costMUSD)} {t('unit.musd')}
        </div>
      </div>
      <button className="btn !p-1.5" onClick={() => removeOne(c.id)} disabled={count === 0 || removeCheck?.kind === 'reject'} title={removeNote?.text} aria-label={`${t('hangar.remove')}: ${lt(c.name)}${removeNote ? ` — ${removeNote.text}` : ''}`}>
        <Minus size={14} />
      </button>
      <span className="num w-5 text-center">{count}</span>
      <button className={`btn !p-1.5 ${addCheck?.kind === 'request' ? '!border-warn' : ''}`} onClick={() => add(c.id)} disabled={addCheck?.kind === 'reject' || coolingDown} title={addNote?.text} aria-label={`${t('hangar.add')}: ${lt(c.name)}${addNote ? ` — ${addNote.text}` : ''}`}>
        <Plus size={14} />
      </button>
    </li>
  );
}

export function ComponentList() {
  const { t } = useTranslation();
  const scenarioId = useDesign((s) => s.scenarioId);
  const groups = useMemo(() => {
    let list: ComponentDef[] = [];
    try {
      list = componentsForScenario(scenarioId, catalog);
    } catch {
      /* catálogo no disponible */
    }
    return SUBSYSTEM_ORDER.map((s: SubsystemId) => ({ s, items: list.filter((c) => c.subsystem === s) })).filter((g) => g.items.length);
  }, [scenarioId]);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.s}>
          <h3 className="num text-xs uppercase tracking-widest text-accent">{t(`subsystem.${g.s}`)}</h3>
          <ul>
            {g.items.map((c) => (
              <ComponentRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Resumen compacto de recursos con el limitante resaltado. */
export function LimitingSummary() {
  const { t } = useTranslation();
  const report = useBudgets();
  if (!report?.limiting) return null;
  const r = report.resources.find((x) => x.id === report.limiting);
  if (!r) return null;
  return (
    <p className="num text-xs text-bad">
      {t('resources.limiting')}: {t(`resources.${r.id}`)} ({fmt(r.margin * 100, 0)}%)
    </p>
  );
}

/** Modo accesible 2D: todo el diseño sin moverse en 3D. */
export function AccessibleDesign({ onReview }: { onReview: () => void }) {
  const { t } = useTranslation();
  const issues = useDesign((s) => s.lastIssues);
  const academy = useAcademy((s) => s.active);
  const inRoom = useRoom(selectInRoom);
  return (
    <div className={`grid h-full grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[1fr_22rem] ${academy ? 'pt-64' : 'pt-16'}`}>
      <Panel title={t('hangar.accessibleTitle')}>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-bold">{t('hangar.components')}</h3>
            <ComponentList />
          </div>
          <div className="space-y-4">
            {inRoom && <LastNoGoPanel className="!max-w-none" />}
            {!inRoom && issues.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-bold text-bad">{t('hangar.noGoReasons')}</h3>
                <IssueList issues={issues} />
              </div>
            )}
            <MissionSelectors />
            <LimitingSummary />
            <button className="btn btn-primary w-full" onClick={onReview}>
              {t('hangar.requestReview')}
            </button>
          </div>
        </div>
        <AdvisorsPanel className="mt-4 !p-3" />
      </Panel>
      <div className="pointer-events-auto">
        <ResourcePanel />
      </div>
    </div>
  );
}
