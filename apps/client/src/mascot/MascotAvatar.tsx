import { useId, useState } from 'react';
import type { MascotDef, MascotExpression } from '@payload/shared';

/**
 * Avatar 2D de la mascota. Si el JSON trae `sprite2d` (ruta servida desde `assets/web`, admite el
 * marcador `{expression}`), se usa esa imagen; si no existe o falla, se dibuja en código un avatar
 * genérico (esfera con anillo orbital) con la expresión pedida. Sin assets externos.
 */
export function MascotAvatar({ mascot, expression, size = 64, label }: { mascot: MascotDef; expression: MascotExpression; size?: number; label: string }) {
  const [spriteFailed, setSpriteFailed] = useState(false);
  if (mascot.sprite2d && !spriteFailed) {
    const src = mascot.sprite2d.replace('{expression}', expression);
    return (
      <img
        src={src.startsWith('/') || src.startsWith('http') ? src : `/${src}`}
        width={size}
        height={size}
        alt={label}
        onError={() => setSpriteFailed(true)}
        className="shrink-0"
      />
    );
  }
  return <GeneratedAvatar expression={expression} size={size} label={label} />;
}

const MOUTH: Record<MascotExpression, string> = {
  happy: 'M26 41 Q32 47 38 41',
  thinking: 'M27 43 L37 42',
  worried: 'M26 45 Q32 39 38 45',
  celebrating: 'M24 39 Q32 52 40 39 Z',
};

function Eyes({ expression }: { expression: MascotExpression }) {
  if (expression === 'celebrating') {
    // Ojos cerrados de alegría (^ ^)
    return (
      <g fill="none" stroke="#06231f" strokeWidth="2.4" strokeLinecap="round">
        <path d="M22 33 L25.5 29.5 L29 33" />
        <path d="M35 33 L38.5 29.5 L42 33" />
      </g>
    );
  }
  const dy = expression === 'thinking' ? -2 : 0;
  const dx = expression === 'thinking' ? 1.5 : 0;
  return (
    <g fill="#06231f">
      <ellipse cx={25.5 + dx} cy={32 + dy} rx="2.6" ry="3.3" />
      <ellipse cx={38.5 + dx} cy={32 + dy} rx="2.6" ry="3.3" />
      <circle cx={26.3 + dx} cy={30.8 + dy} r="0.9" fill="#fff" />
      <circle cx={39.3 + dx} cy={30.8 + dy} r="0.9" fill="#fff" />
      {expression === 'worried' && (
        <g stroke="#06231f" strokeWidth="1.8" strokeLinecap="round">
          <path d="M21.5 25.5 L28 27.5" />
          <path d="M42.5 25.5 L36 27.5" />
        </g>
      )}
      {expression === 'thinking' && <path d="M35 25 Q38.5 22.5 42 24.5" stroke="#06231f" strokeWidth="1.8" fill="none" strokeLinecap="round" />}
    </g>
  );
}

function GeneratedAvatar({ expression, size, label }: { expression: MascotExpression; size: number; label: string }) {
  const gid = `orbi-shade-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={label} className="shrink-0">
      {/* Anillo orbital (detrás) */}
      <ellipse cx="32" cy="36" rx="29" ry="8" fill="none" stroke="#38e1c0" strokeOpacity="0.45" strokeWidth="2" />
      {/* Cuerpo */}
      <circle cx="32" cy="34" r="19" fill="#7ff0d8" />
      <circle cx="32" cy="34" r="19" fill={`url(#${gid})`} />
      <defs>
        <radialGradient id={gid} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0c3a37" stopOpacity="0.35" />
        </radialGradient>
      </defs>
      {/* Antena */}
      <line x1="32" y1="15" x2="32" y2="8" stroke="#cfe8ff" strokeWidth="1.6" />
      <circle cx="32" cy="7" r="2.6" fill={expression === 'worried' ? '#ffb020' : '#38e1c0'} />
      <Eyes expression={expression} />
      <path d={MOUTH[expression]} fill={expression === 'celebrating' ? '#06231f' : 'none'} stroke="#06231f" strokeWidth="2" strokeLinecap="round" />
      {/* Anillo orbital (delante) */}
      <path d="M3 36 Q32 50 61 36" fill="none" stroke="#38e1c0" strokeWidth="2" />
      {expression === 'celebrating' && (
        <g fill="#ffb020">
          <path d="M8 12 l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z" />
          <path d="M54 10 l1.5 3 3 1.5 -3 1.5 -1.5 3 -1.5 -3 -3 -1.5 3 -1.5z" />
        </g>
      )}
      {expression === 'thinking' && <circle cx="50" cy="18" r="2" fill="#cfe8ff" opacity="0.7" />}
    </svg>
  );
}
