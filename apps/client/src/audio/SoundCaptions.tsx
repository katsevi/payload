import { useTranslation } from 'react-i18next';
import { useSettings } from '../state/settings';
import { useCues } from './cues';
import type { FlashTone } from './soundLogic';

const FLASH_COLOR: Record<FlashTone, string> = {
  ok: 'rgba(61,220,132,.55)',
  warn: 'rgba(255,176,32,.6)',
  bad: 'rgba(255,77,94,.7)',
  info: 'rgba(56,225,192,.5)',
};

const CAPTION_TEXT: Record<FlashTone, string> = {
  ok: 'text-ok border-ok/60',
  warn: 'text-warn border-warn/60',
  bad: 'text-bad border-bad/60',
  info: 'text-accent border-accent/60',
};

/**
 * Equivalentes visuales del audio:
 *  - un borde que destella (siempre) cuando suena un aviso importante, con el color de su gravedad;
 *  - subtítulos de sonido ("[alarma de batería]") si el ajuste `soundCaptions` está activo.
 * Funciona igual con el sonido silenciado o si el navegador no tiene Web Audio.
 */
export function SoundCaptions() {
  const { t } = useTranslation();
  const flash = useCues((s) => s.flash);
  const captions = useCues((s) => s.captions);
  const enabled = useSettings((s) => s.soundCaptions);
  return (
    <>
      {flash && (
        <div
          key={flash.seq}
          aria-hidden="true"
          className="cue-flash pointer-events-none absolute inset-0 z-[25]"
          style={{ ['--cue-color' as string]: FLASH_COLOR[flash.tone] }}
        />
      )}
      {enabled && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1" role="log" aria-live="polite" aria-label={t('settings.soundCaptions')}>
          {captions.map((c) => (
            <span key={c.id} className={`num rounded border bg-panel/90 px-3 py-1 text-xs ${c.tone ? CAPTION_TEXT[c.tone] : 'border-line text-slate-200'}`}>
              {t(c.key)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
