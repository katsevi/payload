import { useEffect, useRef } from 'react';
import { ArrowUp, Navigation } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hudView } from '../state/ui';

/**
 * Con un aviso de impacto y lejos del timón: una flecha grande junto a la mira que gira hacia el timón y
 * late (forma e icono, no solo color). La escribe `GameLoop` en `hudView.helm*`; se pinta sin React por frame.
 */
export function HelmPointer() {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let on = false;
    const loop = () => {
      if (hudView.helmOn !== on && box.current) {
        on = hudView.helmOn;
        box.current.style.display = on ? '' : 'none';
      }
      if (on && arrow.current) arrow.current.style.transform = `rotate(${hudView.helmAngle}rad) translateY(-64px)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={box} style={{ display: 'none' }} className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0" role="img" aria-label={t('hud.toHelm')}>
      <div ref={arrow} className="absolute -left-6 -top-6 flex h-12 w-12 animate-pulse items-center justify-center rounded-full border-2 border-warn bg-black/50 text-warn will-change-transform">
        <ArrowUp size={22} />
      </div>
      <div className="absolute -left-3 top-8 text-warn">
        <Navigation size={18} />
      </div>
    </div>
  );
}
