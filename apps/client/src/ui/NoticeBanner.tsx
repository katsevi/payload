import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tr } from '../i18n';
import { NOTICE_MS, useUi, type NoticeTone } from '../state/ui';

const TONE: Record<NoticeTone, string> = {
  info: 'border-accent text-slate-100',
  warn: 'border-warn text-warn',
  bad: 'border-bad text-bad',
};

/**
 * Aviso puntual en pantalla (`useUi.notice`): p. ej. una acción que la sala rechazó (`tr(reason)`),
 * una solicitud enviada o el estado de la conexión. Se cierra solo; `role="alert"` para lectores de pantalla.
 */
export function NoticeBanner() {
  const { t } = useTranslation();
  const notice = useUi((s) => s.notice);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => useUi.getState().clearNotice(notice.id), NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [notice]);

  if (!notice) return null;
  const text = notice.ref ? tr(notice.ref) : notice.key ? t(notice.key, notice.params ?? {}) : '';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-40 flex justify-center px-4">
      <div role="alert" className={`console-panel pointer-events-auto flex max-w-xl items-start gap-3 border-l-4 px-3 py-2 text-sm ${TONE[notice.tone]}`}>
        <p className="flex-1">{text}</p>
        <button className="btn !p-1" onClick={() => useUi.getState().clearNotice(notice.id)} aria-label={t('common.close')} title={t('common.close')}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
