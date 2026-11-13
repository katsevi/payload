import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { PULSE_ZONE_W, pulseCursor, SEAL_ZONE_W } from '../game/repairGames';
import { minigame } from '../state/minigame';
import { useSettings } from '../state/settings';

/**
 * Indicadores de las micro-interacciones de averías, pintados sin React en cada frame (lee `minigame`):
 * - fuego: la mira cambia de forma (anillo discontinuo → anillo lleno con punto) al apuntar a la llama;
 * - cortocircuito: barra con la zona entre corchetes y la marca que la recorre;
 * - fuga: barra de presión que se llena, con la zona entre corchetes.
 * Acierto y fallo se ven con un icono (✓ / ✗), no solo con color; además suenan (`skillHit`/`skillMiss`).
 */
export function SkillHud() {
  const reticle = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const ok = useRef<HTMLSpanElement>(null);
  const ko = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const show = (el: HTMLElement | null, on: boolean) => {
      if (el && (el.style.display === 'none') === on) el.style.display = on ? '' : 'none';
    };
    const loop = () => {
      const r = minigame.repair;
      const active = !useSettings.getState().simpleRepairs && (r.kind !== null || minigame.spare !== null) && minigame.dodge === null;
      const fire = active && r.kind === 'fire';
      show(reticle.current, fire);
      if (fire && reticle.current) {
        reticle.current.style.borderStyle = r.onTarget ? 'solid' : 'dashed';
        reticle.current.style.transform = `translate(-50%, -50%) scale(${r.onTarget ? 0.8 : 1})`;
      }
      show(dot.current, fire && r.onTarget);
      const pulse = active && r.kind === 'short' && r.pulse;
      const seal = active && ((r.kind === 'leak' && r.seal) || minigame.spare);
      show(bar.current, !!pulse || !!seal);
      let fb = 0;
      if (pulse && r.pulse) {
        fb = r.pulse.feedback;
        if (zone.current) {
          zone.current.style.left = `${r.pulse.zoneA * 100}%`;
          zone.current.style.width = `${PULSE_ZONE_W * 100}%`;
        }
        if (cursor.current) cursor.current.style.left = `${pulseCursor(r.pulse) * 100}%`;
        show(cursor.current, true);
        show(fill.current, false);
      } else if (seal) {
        // La fuga y el repuesto (encajar la pieza) usan la misma barra de carga con zona.
        const sl = minigame.spare ?? r.seal!;
        fb = sl.feedback;
        if (zone.current) {
          zone.current.style.left = `${sl.zoneA * 100}%`;
          zone.current.style.width = `${SEAL_ZONE_W * 100}%`;
        }
        if (fill.current) fill.current.style.width = `${Math.min(1, sl.pressure) * 100}%`;
        show(cursor.current, false);
        show(fill.current, true);
      }
      show(ok.current, (!!pulse || !!seal) && fb === 1);
      show(ko.current, (!!pulse || !!seal) && fb === 2);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div ref={reticle} style={{ display: 'none' }} className="absolute left-1/2 top-1/2 h-10 w-10 rounded-full border-2 border-warn" aria-hidden="true" />
      <div ref={dot} style={{ display: 'none' }} className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warn" aria-hidden="true" />
      <div ref={bar} style={{ display: 'none' }} className="absolute left-1/2 top-[58%] flex -translate-x-1/2 items-center gap-2" aria-hidden="true">
        <div className="relative h-5 w-64 overflow-hidden rounded-sm bg-black/70 ring-1 ring-line">
          <div ref={fill} className="absolute inset-y-0 left-0 bg-accent/60" />
          {/* Zona buena: corchetes y rayado (se distingue sin color). */}
          <div ref={zone} className="absolute inset-y-0 border-x-4 border-ok bg-[repeating-linear-gradient(45deg,rgba(80,230,160,0.35)_0_4px,transparent_4px_8px)]" />
          <div ref={cursor} className="absolute inset-y-[-2px] w-1 -translate-x-1/2 bg-white shadow-[0_0_6px_white]" />
        </div>
        <span ref={ok} style={{ display: 'none' }} className="text-ok">
          <Check size={20} />
        </span>
        <span ref={ko} style={{ display: 'none' }} className="text-bad">
          <X size={20} />
        </span>
      </div>
    </>
  );
}
