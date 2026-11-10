import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RESOURCE_UNITS, SUBSYSTEM_IDS, catalog, type PingTarget, type ResourceId } from '@payload/shared';
import { lt } from '../i18n';
import { useUi } from '../state/ui';
import { Panel } from '../ui/common';
import { sendPing } from './actions';
import { usePingLog, usePlayerLabels } from './hooks';
import { roleColor } from './roomUiLogic';

const RESOURCES = Object.keys(RESOURCE_UNITS) as ResourceId[];

/** Texto de un ping (nombre del subsistema, recurso o pieza). */
export function usePingText(): (target: PingTarget) => string {
  const { t } = useTranslation();
  return (target) => {
    switch (target.kind) {
      case 'subsystem': return t(`subsystem.${target.id}`);
      case 'resource': return t(`resources.${target.id}`);
      case 'component': {
        const c = catalog.components.find((x) => x.id === target.id);
        return c ? lt(c.name) : target.id;
      }
      case 'point': return t('room.pings.point');
    }
  };
}

/** Pings desde el panel 2D (subsistema o recurso) y lista de los recientes ("Ingeniería marcó: Energía"). */
export function PingsPanel() {
  const { t } = useTranslation();
  const entries = usePingLog((s) => s.entries);
  const labelOf = usePlayerLabels();
  const text = usePingText();
  return (
    <Panel title={t('room.pings.title')} className="relative !p-3">
      <button className="btn absolute right-2 top-2 !p-1" onClick={() => useUi.getState().setTeamPanel(null)} aria-label={t('common.close')} title={t('common.close')}>
        <X size={14} />
      </button>
      <p className="mb-2 text-xs text-slate-400">{t('room.pings.intro')}</p>
      <h3 className="num mb-1 text-xs uppercase tracking-widest text-accent">{t('room.pings.subsystems')}</h3>
      <div className="mb-3 flex flex-wrap gap-1">
        {SUBSYSTEM_IDS.map((s) => <button key={s} className="btn !px-2 !py-1 text-xs" onClick={() => sendPing({ kind: 'subsystem', id: s })}>{t(`subsystem.${s}`)}</button>)}
      </div>
      <h3 className="num mb-1 text-xs uppercase tracking-widest text-accent">{t('room.pings.resources')}</h3>
      <div className="mb-3 flex flex-wrap gap-1">
        {RESOURCES.map((r) => <button key={r} className="btn !px-2 !py-1 text-xs" onClick={() => sendPing({ kind: 'resource', id: r })}>{t(`resources.${r}`)}</button>)}
      </div>
      <h3 className="num mb-1 text-xs uppercase tracking-widest text-slate-400">{t('room.pings.recent')}</h3>
      <ul className="space-y-1 text-sm" aria-live="polite">
        {entries.length === 0 && <li className="text-slate-500">{t('room.pings.none')}</li>}
        {entries.map((e) => {
          const who = labelOf(e.playerId);
          return (
            <li key={e.id} className="rounded bg-[#0a1424] px-2 py-1">
              <span style={{ color: roleColor(e.role) }}>{e.role ? t(`room.role.${e.role}`) : who}</span> {t('room.pings.marked')}: <b>{text(e.target)}</b>
              {e.role && <span className="text-xs text-slate-400"> ({who})</span>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
