import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ADVISOR_ROLES, adviseByRole, catalog, computeBudgets, getGlossaryEntry, reviewGoNoGo, type AdvisorRole, type RoleAdvice,
} from '@payload/shared';
import { currentLocale, lt, tr } from '../i18n';
import { useVisibleAdvisorRoles } from '../net/roomStore';
import { useDesign } from '../state/design';
import { useUi } from '../state/ui';
import { Modal, Panel } from './common';
import { filterGlossary } from './catalogViews';

// ─── Asesores por rol ───────────────────────────────────────────────────────

const SEV_TONE = { blocker: 'border-bad text-bad', warning: 'border-warn text-warn', info: 'border-accent text-accent' } as const;

/** Consejos de los asesores (director, ingeniería, ciencia, operaciones) para el diseño actual. */
export function useAdvice(): Record<AdvisorRole, RoleAdvice[]> | null {
  const scenarioId = useDesign((s) => s.scenarioId);
  const componentIds = useDesign((s) => s.componentIds);
  const orbitId = useDesign((s) => s.orbitId);
  const launcherId = useDesign((s) => s.launcherId);
  return useMemo(() => {
    if (!scenarioId) return null;
    try {
      const d = { scenarioId, componentIds, orbitId, launcherId };
      const advice = adviseByRole(d, computeBudgets(d, catalog), reviewGoNoGo(d, catalog), catalog);
      const out = Object.fromEntries(ADVISOR_ROLES.map((r) => [r, [] as RoleAdvice[]])) as Record<AdvisorRole, RoleAdvice[]>;
      for (const a of advice) out[a.role].push(a);
      return out;
    } catch {
      return null;
    }
  }, [scenarioId, componentIds, orbitId, launcherId]);
}

/** Asesores por rol: en solitario los cuatro; en sala solo los de mis roles (`useVisibleAdvisorRoles`). */
export function AdvisorsPanel({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const advice = useAdvice();
  const roles = useVisibleAdvisorRoles();
  return (
    <Panel title={t('advisors.title')} className={className}>
      {!advice ? (
        <p className="text-sm text-slate-400">{t('advisors.none')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <section key={role} aria-label={t(`advisors.role.${role}`)}>
              <h3 className="num mb-1 text-xs uppercase tracking-widest text-accent">{t(`advisors.role.${role}`)}</h3>
              <ul className="space-y-1">
                {advice[role].map((a, i) => (
                  <li key={i} className={`rounded border-l-4 bg-[#0a1424] px-2 py-1 text-xs ${SEV_TONE[a.severity]}`}>
                    <span className="sr-only">{t(`review.severity.${a.severity}`)}: </span>
                    <span className="text-slate-200">{tr(a.message)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AdvisorsModal() {
  const { t } = useTranslation();
  const close = () => useUi.getState().setOverlay(null);
  return (
    <Modal onClose={close}>
      <AdvisorsPanel />
      <div className="mt-3 text-right">
        <button className="btn btn-primary" onClick={close}>{t('common.close')}</button>
      </div>
    </Modal>
  );
}

// ─── Glosario y fichas ──────────────────────────────────────────────────────

/** Glosario con buscador; cada ficha muestra término, definición, «¿por qué?» y términos relacionados navegables. */
export function GlossaryPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const selectedId = useUi((s) => s.glossaryId);
  const close = () => useUi.getState().setOverlay(null);
  const select = (id: string | null) => useUi.setState({ glossaryId: id });
  const locale = currentLocale();
  const entries = useMemo(() => filterGlossary(query, locale), [query, locale]);
  const entry = selectedId ? getGlossaryEntry(selectedId, catalog) : null;

  return (
    <Modal onClose={close}>
      <Panel title={t('glossary.title')}>
        {entry ? (
          <article aria-live="polite">
            <button className="btn mb-3 !py-1 text-xs" onClick={() => select(null)}>
              <ArrowLeft size={12} className="mr-1 inline" />
              {t('glossary.backToList')}
            </button>
            <h3 className="text-xl font-bold text-accent">{lt(entry.term)}</h3>
            <p className="mt-2 leading-relaxed">{lt(entry.definition)}</p>
            {entry.why && (
              <p className="mt-3 rounded border-l-4 border-accent bg-[#0a1424] p-2 text-sm text-slate-200">
                <span className="num mr-1 text-xs uppercase text-accent">{t('glossary.why')}</span>
                {lt(entry.why)}
              </p>
            )}
            {entry.related && entry.related.length > 0 && (
              <div className="mt-4">
                <h4 className="num mb-1 text-xs uppercase tracking-widest text-slate-400">{t('glossary.related')}</h4>
                <div className="flex flex-wrap gap-2">
                  {entry.related.map((id) => {
                    const r = getGlossaryEntry(id, catalog);
                    return r ? (
                      <button key={id} className="btn !py-1 text-xs" onClick={() => select(id)}>{lt(r.term)}</button>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </article>
        ) : (
          <>
            <label className="mb-3 flex items-center gap-2 rounded border border-line bg-[#0a1424] px-2">
              <Search size={14} className="text-slate-400" />
              <span className="sr-only">{t('glossary.search')}</span>
              <input
                className="w-full bg-transparent p-2 text-sm outline-none"
                type="search"
                placeholder={t('glossary.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </label>
            {entries.length === 0 ? (
              <p className="text-sm text-slate-400">{(catalog.glossary?.length ?? 0) === 0 ? t('glossary.unavailable') : t('glossary.empty')}</p>
            ) : (
              <ul className="max-h-[55vh] space-y-1 overflow-auto" aria-live="polite">
                {entries.map((g) => (
                  <li key={g.id}>
                    <button className="w-full rounded border border-transparent p-2 text-left hover:border-line hover:bg-[#0f2038]" onClick={() => select(g.id)}>
                      <span className="flex items-center gap-2 font-bold text-accent"><BookOpen size={14} />{lt(g.term)}</span>
                      <span className="line-clamp-2 block text-xs text-slate-300">{lt(g.definition)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="mt-4 flex items-center justify-between">
          <span className="num text-[11px] text-slate-500"><span className="kbd">G</span> {t('glossary.title')}</span>
          <button className="btn btn-primary" onClick={close}>{t('common.close')}</button>
        </div>
      </Panel>
    </Modal>
  );
}
