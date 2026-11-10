import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUBSYSTEM_IDS, allocatableBudgetMUSD, catalog, defaultAllocation, type TeamAction } from '@payload/shared';
import { tr } from '../i18n';
import { useRoom } from '../net/roomStore';
import { getSession } from '../net/sessionStore';
import { useUi } from '../state/ui';
import { Panel, fmt, useScenario } from '../ui/common';
import { inputCls } from './common';
import { useStableCanDo } from './hooks';
import { allocationFromDraft, allocationRows, draftError, draftFromAllocation, draftTotal, type AllocationDraft } from './roomUiLogic';

const STATUS_TONE = { ok: 'text-ok', tight: 'text-warn', over: 'text-bad' } as const;

/** Reparto del presupuesto por subsistema: lo edita la Dirección; los demás lo ven en solo lectura. */
export function BudgetPanel() {
  const { t } = useTranslation();
  const sc = useScenario();
  const design = useRoom((s) => s.view?.design);
  const allocation = useRoom((s) => s.view?.allocation ?? null);
  const [draft, setDraft] = useState<AllocationDraft>(() => draftFromAllocation(allocation));
  const probe = useMemo<TeamAction>(() => ({ type: 'allocate-budget', allocation: null }), []);
  const check = useStableCanDo(probe);
  const canEdit = check === null || check.kind !== 'reject';
  useEffect(() => setDraft(draftFromAllocation(allocation)), [allocation]);
  const rows = useMemo(() => (design ? allocationRows(design, allocation) : []), [design, allocation]);
  if (!sc || !design) return null;
  const available = allocatableBudgetMUSD(sc, catalog, design.launcherId);
  const err = draftError(draft, sc, design.launcherId);
  const total = draftTotal(draft);
  const set = (s: (typeof SUBSYSTEM_IDS)[number], v: string) => setDraft((d) => ({ ...d, [s]: v }));
  return (
    <Panel title={t('room.budget.title')} className="relative !p-3">
      <button className="btn absolute right-2 top-2 !p-1" onClick={() => useUi.getState().setTeamPanel(null)} aria-label={t('common.close')} title={t('common.close')}>
        <X size={14} />
      </button>
      <p className="mb-2 text-xs text-slate-400">{canEdit ? t('room.budget.introEdit') : t('room.budget.introRead')}</p>
      <p className="num mb-2 text-xs">
        {t('room.budget.available')}: <span className="text-accent">{fmt(available, 2)} {t('unit.musd')}</span>
        {allocation === null && <span className="ml-2 text-slate-400">({t('room.budget.noAllocation')})</span>}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="num text-left text-[10px] uppercase tracking-wider text-slate-400">
            <th scope="col">{t('room.budget.subsystem')}</th>
            <th scope="col" className="text-right">{t('room.budget.assigned')}</th>
            <th scope="col" className="text-right">{t('room.budget.spent')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.subsystem} className="border-t border-line/50">
              <th scope="row" className="py-1 text-left font-normal">{t(`subsystem.${r.subsystem}`)}</th>
              <td className="py-1 text-right">
                {canEdit ? (
                  <input
                    className={`${inputCls} num !w-20 !p-1 text-right`}
                    inputMode="decimal"
                    value={draft[r.subsystem]}
                    onChange={(e) => set(r.subsystem, e.target.value)}
                    aria-label={`${t('room.budget.assigned')}: ${t(`subsystem.${r.subsystem}`)}`}
                  />
                ) : (
                  <span className="num">{r.allocatedMUSD === null ? '—' : fmt(r.allocatedMUSD, 2)}</span>
                )}
              </td>
              <td className={`num py-1 text-right ${STATUS_TONE[r.status]}`} title={t(`resources.status.${r.status}`)}>
                {fmt(r.usedMUSD, 2)} <span className="sr-only">{t(`resources.status.${r.status}`)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit ? (
        <div className="mt-3 space-y-2">
          <p className={`num text-xs ${err ? 'text-bad' : 'text-slate-300'}`} role={err ? 'alert' : undefined}>
            {t('room.budget.total')}: {fmt(total, 2)} / {fmt(available, 2)} {t('unit.musd')} {err ? `· ${tr(err)}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setDraft(draftFromAllocation(defaultAllocation(sc, catalog, { launcherId: design.launcherId, design })))}>{t('room.budget.suggest')}</button>
            <button className="btn btn-primary" disabled={err !== null || allocationFromDraft(draft) === null} onClick={() => getSession().allocateBudget(allocationFromDraft(draft))}>{t('room.budget.apply')}</button>
            <button className="btn" disabled={allocation === null} onClick={() => getSession().allocateBudget(null)}>{t('room.budget.clear')}</button>
          </div>
        </div>
      ) : (
        check?.kind === 'reject' && <p className="mt-2 text-xs text-slate-400">{tr(check.reason)}</p>
      )}
    </Panel>
  );
}
