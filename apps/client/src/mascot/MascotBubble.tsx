import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { lt } from '../i18n';
import { useSettings } from '../state/settings';
import { MascotAvatar } from './MascotAvatar';
import { mascotDef } from './mascotLogic';
import { useMascot } from './mascotStore';

/** Tiempo en pantalla según la longitud del texto (lectura cómoda de los subtítulos). */
export const bubbleDurationMs = (chars: number): number => Math.min(14_000, Math.max(5_000, 2_500 + chars * 55));

/**
 * Burbuja de diálogo de la mascota: avatar con expresión + texto (que es también el subtítulo).
 * `aria-live="polite"` para lectores de pantalla. Se oculta si la mascota está desactivada en Ajustes.
 */
export function MascotBubble() {
  const { t } = useTranslation();
  const enabled = useSettings((s) => s.mascot);
  const line = useMascot((s) => s.current);
  const next = useMascot((s) => s.next);
  const mascot = mascotDef();
  const text = line ? (line.text ? lt(line.text) : line.fallbackKey ? t(line.fallbackKey) : '') : '';

  useEffect(() => {
    if (!line) return;
    const id = window.setTimeout(next, bubbleDurationMs(text.length));
    return () => window.clearTimeout(id);
  }, [line, next, text.length]);

  if (!enabled || !mascot) return null;
  const name = lt(mascot.name);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
      <div role="status" aria-live="polite" aria-atomic="true" className="w-full max-w-lg">
        {line && (
          <div className="console-panel pointer-events-auto flex items-start gap-3 p-3 shadow-lg shadow-black/40">
            <MascotAvatar mascot={mascot} expression={line.expression} size={56} label={`${name} · ${t(`mascot.expression.${line.expression}`)}`} />
            <div className="min-w-0 flex-1">
              <div className="num text-[11px] uppercase tracking-widest text-accent">{name}</div>
              <p className="text-sm leading-snug text-slate-100">{text}</p>
            </div>
            <button className="btn !p-1" onClick={next} aria-label={t('mascot.dismiss')} title={t('mascot.dismiss')}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
