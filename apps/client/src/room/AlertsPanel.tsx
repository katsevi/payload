import { useTranslation } from 'react-i18next';
import { TEAM_LIMITS } from '@payload/shared';
import { tr } from '../i18n';
import { useRoom } from '../net/roomStore';
import { TONE_BORDER, TONE_TEXT, eventTone } from '../ui/eventTone';
import { acknowledgeAlert } from './actions';
import { RoleChip } from './common';
import { useRoomClock } from './hooks';
import { alertPendingRoles, alertRemainingS, myAlertRoles } from './roomUiLogic';

/**
 * Alertas de equipo abiertas en operación (la simulación está en pausa hasta que respondan los roles exigidos
 * o pasen `TEAM_LIMITS.alertTimeoutS`). Responder no cambia la simulación: mide la coordinación.
 */
export function AlertsPanel() {
  const { t } = useTranslation();
  const alerts = useRoom((s) => s.view?.alerts);
  const myRoles = useRoom((s) => s.myRoles);
  const open = (alerts ?? []).filter((a) => a.closedAtS === null);
  const nowS = useRoomClock(open.length > 0);
  if (open.length === 0) return null;
  return (
    <div className="absolute left-1/2 top-16 z-30 w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 space-y-2" role="region" aria-label={t('room.alerts.title')}>
      {open.map((a) => {
        const left = Math.ceil(alertRemainingS(a, nowS));
        const mine = myAlertRoles(a, myRoles);
        const pending = alertPendingRoles(a);
        return (
          <section key={a.id} role="alert" className={`console-panel border-l-4 p-3 ${TONE_BORDER[eventTone(a.event.type)]}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className={`num text-xs font-bold uppercase tracking-widest ${TONE_TEXT[eventTone(a.event.type)]}`}>{t('room.alerts.title')} · {t(`event.${a.event.type}`)}</h3>
              <span className="num text-xs text-warn" title={t('room.alerts.timeout', { s: TEAM_LIMITS.alertTimeoutS })}>{t('room.alerts.left', { s: left })}</span>
            </div>
            <p className="mt-1 text-sm">{tr(a.event.message)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
              <span className="text-slate-400">{t('room.alerts.required')}:</span>
              {a.requiredRoles.map((r) => (
                <span key={r} className="inline-flex items-center gap-1">
                  <RoleChip role={r} small />
                  <span className={pending.includes(r) ? 'text-warn' : 'text-ok'}>{pending.includes(r) ? t('room.alerts.pending') : t('room.alerts.answered')}</span>
                </span>
              ))}
            </div>
            {mine.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {mine.map((r) => (
                  <button key={r} className="btn btn-primary" onClick={() => acknowledgeAlert(a.id, r)}>
                    {t('room.alerts.respond', { role: t(`room.role.${r}`) })}
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
