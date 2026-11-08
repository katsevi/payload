import { Minus, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { catalog, componentsForScenario, type ComponentDef, type SubsystemId } from '@payload/shared';
import { lt } from '../i18n';
import { SUBSYSTEM_ORDER } from '../scenes/hangarLayout';
import { useDesign } from '../state/design';
import { Panel, fmt, useBudgets, useScenario } from './common';
import { IssueList } from './Screens';
import { ResourcePanel } from './ResourcePanel';

/** Selectores de órbita y lanzador (permitidos por el escenario). Usado en la consola 3D y en el modo 2D. */
export function MissionSelectors() {
  const { t } = useTranslation();
  const scenario = useScenario();
  const orbitId = useDesign((s) => s.orbitId);
  const launcherId = useDesign((s) => s.launcherId);
  const setOrbit = useDesign((s) => s.setOrbit);
  const setLauncher = useDesign((s) => s.setLauncher);
  const orbits = catalog.orbits.filter((o) => scenario?.allowedOrbits.includes(o.id));
  const launchers = catalog.launchers.filter((l) => scenario?.allowedLaunchers.includes(l.id));
  const orbit = orbits.find((o) => o.id === orbitId);
  const launcher = launchers.find((l) => l.id === launcherId);
  const selectCls = 'w-full rounded border border-line bg-[#0a1424] p-2 text-sm';
  return (
    <div className="space-y-3">
      <label className="block text-xs uppercase tracking-wider text-slate-400">
        {t('hangar.orbit')}
        <select className={selectCls} value={orbitId ?? ''} onChange={(e) => setOrbit(e.target.value ? (e.target.value as typeof orbitId) : null)}>
          <option value="">{t('hangar.choose')}</option>
          {orbits.map((o) => (
            <option key={o.id} value={o.id}>
              {lt(o.name)} ({fmt(o.perigeeKm, 0)}–{fmt(o.apogeeKm, 0)} {t('unit.km')})
            </option>
          ))}
        </select>
      </label>
      {orbit && <p className="text-xs text-slate-300">{lt(orbit.why)}</p>}
      <label className="block text-xs uppercase tracking-wider text-slate-400">
        {t('hangar.launcher')}
        <select className={selectCls} value={launcherId ?? ''} onChange={(e) => setLauncher(e.target.value || null)}>
          <option value="">{t('hangar.choose')}</option>
          {launchers.map((l) => (
            <option key={l.id} value={l.id}>
              {lt(l.name)} ({fmt(l.costMUSD)} {t('unit.musd')})
            </option>
          ))}
        </select>
      </label>
      {launcher && <p className="text-xs text-slate-300">{lt(launcher.description)}</p>}
    </div>
  );
}

function ComponentRow({ c }: { c: ComponentDef }) {
  const { t } = useTranslation();
  const count = useDesign((s) => s.componentIds.filter((id) => id === c.id).length);
  const add = useDesign((s) => s.add);
  const removeOne = useDesign((s) => s.removeOne);
  return (
    <li className="flex items-center gap-2 border-b border-line/50 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate">{lt(c.name)}</div>
        <div className="num text-[11px] text-slate-400" title={lt(c.why)}>
          {fmt(c.massKg)} {t('unit.kg')} · {fmt(c.powerW)} {t('unit.w')} · {fmt(c.costMUSD)} {t('unit.musd')}
        </div>
      </div>
      <button className="btn !p-1.5" onClick={() => removeOne(c.id)} disabled={count === 0} aria-label={`${t('hangar.remove')}: ${lt(c.name)}`}>
        <Minus size={14} />
      </button>
      <span className="num w-5 text-center">{count}</span>
      <button className="btn !p-1.5" onClick={() => add(c.id)} aria-label={`${t('hangar.add')}: ${lt(c.name)}`}>
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
  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-auto p-4 pt-16 lg:grid-cols-[1fr_22rem]">
      <Panel title={t('hangar.accessibleTitle')}>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-bold">{t('hangar.components')}</h3>
            <ComponentList />
          </div>
          <div className="space-y-4">
            {issues.length > 0 && (
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
      </Panel>
      <div className="pointer-events-auto">
        <ResourcePanel />
      </div>
    </div>
  );
}
