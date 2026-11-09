import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { lt } from '../i18n';
import { isMicrogravity, useLaunch } from '../state/launch';
import { useSettings } from '../state/settings';
import { MascotAvatar } from './MascotAvatar';
import { mascotDef } from './mascotLogic';
import { useMascot } from './mascotStore';

/**
 * La mascota hace de indicador de gravedad cero (GDD): al llegar a microgravedad (separación de etapas,
 * ya en órbita) su avatar 2D flota y dice el diálogo `event:launch-success`; si el lanzamiento falla,
 * dice `event:launch-failure`. El aviso de «gravedad cero» también es texto visible, no solo animación.
 * Con la mascota desactivada en Ajustes no se muestra (el HUD sigue indicando la fase).
 */
export function ZeroGMascot() {
  const { t } = useTranslation();
  const phase = useLaunch((s) => s.phase);
  const enabled = useSettings((s) => s.mascot);
  const mascot = mascotDef();
  const micro = isMicrogravity(phase);

  useEffect(() => {
    if (phase === 'separation') useMascot.getState().say('event:launch-success');
    else if (phase === 'failure') useMascot.getState().say('event:launch-failure');
  }, [phase]);

  if (!enabled || !mascot || !micro) return null;
  const name = lt(mascot.name);
  return (
    <div className="pointer-events-none absolute bottom-44 right-8 z-20 flex flex-col items-center gap-1" role="status">
      <div className="zero-g-float">
        <MascotAvatar mascot={mascot} expression={phase === 'success' ? 'celebrating' : 'happy'} size={72} label={`${name} · ${t('launch.zeroG')}`} />
      </div>
      <span className="num rounded border border-accent/60 bg-panel/80 px-2 py-0.5 text-[11px] uppercase tracking-widest text-accent">{t('launch.zeroG')}</span>
    </div>
  );
}
