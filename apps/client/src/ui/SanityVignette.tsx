import type { RunState } from '@payload/shared';
import { sanityVignette } from '../game/sanityFx';
import { myCrew } from '../game/me';
import { useSettings } from '../state/settings';

/** Viñeta fría (azul grisáceo, no el rojo del O₂) según la banda de ánimo. Nada si la cordura está apagada. */
export function SanityVignette({ s }: { s: RunState }) {
  const k = useSettings((x) => x.effects);
  const reduce = useSettings((x) => x.reduceStress);
  const me = myCrew(s);
  if (!me || !me.alive || me.sanityPct === undefined) return null;
  const v = sanityVignette(me.sanityBand, k, reduce);
  if (v.alpha <= 0) return null;
  return (
    <div
      className={`pointer-events-none absolute inset-0 ${v.pulse ? 'animate-pulse' : ''}`}
      style={{
        background: `radial-gradient(ellipse at center, transparent 50%, rgba(40,52,78,${v.alpha.toFixed(2)}) 100%)`,
        ...(v.desaturate > 0 ? { backdropFilter: `saturate(${(1 - v.desaturate).toFixed(2)})` } : {}),
      }}
      aria-hidden="true"
    />
  );
}
