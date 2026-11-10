import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissRetry, retryRoom } from '../net';
import { useRoom } from '../net/roomStore';

/** `untilMs` está en el reloj de `configureNet.now` (por defecto `performance.now()`). */
const clockNow = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

/**
 * Aviso con cuenta atrás cuando se perdió la conexión sin querer pero el servidor aún guarda el lugar
 * (`useRoom.retry`, `TEAM_LIMITS.reconnectGraceS` desde la caída): «Reintentar» llama a `retryRoom()` y
 * «Descartar» renuncia a volver (`dismissRetry()`). Se monta en App en todas las fases, también en el menú.
 */
export function RetryBanner() {
  const { t } = useTranslation();
  const retry = useRoom((s) => s.retry);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!retry) return;
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [retry]);
  if (!retry) return null;
  const seconds = Math.max(0, Math.ceil((retry.untilMs - clockNow()) / 1000));
  const run = () => {
    setBusy(true);
    void retryRoom().finally(() => setBusy(false));
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 top-28 z-40 flex justify-center px-4">
      <div role="alert" className="console-panel pointer-events-auto max-w-xl border-l-4 border-warn p-3 text-sm">
        <h3 className="num text-xs font-bold uppercase tracking-widest text-warn">{t('room.retry.title')}</h3>
        <p className="mt-1">{seconds > 0 ? t('room.retry.body', { seconds }) : t('room.retry.expired')}</p>
        <div className="mt-2 flex gap-2">
          {seconds > 0 && (
            <button className="btn btn-primary" disabled={busy} onClick={run}>{t('room.retry.button')}</button>
          )}
          <button className="btn" onClick={() => dismissRetry()}>{t('room.retry.dismiss')}</button>
        </div>
      </div>
    </div>
  );
}
