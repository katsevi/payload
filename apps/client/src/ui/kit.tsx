/**
 * Kit visual de la interfaz (ver «Sistema visual (UI)» en apps/client/CLAUDE.md). Piezas pequeñas y sin estado que
 * se apoyan en las clases de `index.css`: nada se anima desde React y todo admite `className` para colocarlo.
 * Los códigos decorativos (`code`) son adorno («SYS-04»): si un texto comunica algo, va por i18n.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type Tone = 'accent' | 'ok' | 'warn' | 'bad';

/** Botón del sistema: primario (relleno), secundario (por defecto), peligro o fantasma. */
export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'md' | 'lg' }) {
  const v = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'ghost' ? 'btn-ghost' : '';
  return <button type="button" className={`btn ${v} ${size === 'lg' ? 'btn-lg' : ''} ${className}`} {...rest} />;
}

/**
 * Barra segmentada (medidores del HUD, del hangar y de energía). `pct` y `ghost` en 0-100 sobre `max` (100 por
 * defecto; el hangar usa 125 para enseñar el exceso); `marker` = línea blanca (límite o suministro).
 */
export function SegBar({
  pct,
  tone = 'accent',
  marker,
  ghost,
  max = 100,
  seg = 6,
  solid = false,
  pulse = false,
  className = 'h-2.5',
}: {
  pct: number;
  tone?: Tone;
  marker?: number;
  ghost?: number;
  max?: number;
  seg?: number;
  solid?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  const w = (v: number) => `${(Math.max(0, Math.min(max, v)) / max) * 100}%`;
  return (
    <div className={`segbar ${solid ? 'is-solid' : ''} ${className}`} style={{ ['--seg' as string]: `${seg}px` }} aria-hidden="true">
      {ghost !== undefined && <div className="segbar-ghost" style={{ width: w(ghost) }} />}
      <div className={`segbar-fill tone-${tone} ${pulse ? 'animate-pulse' : ''}`} style={{ width: w(pct) }} />
      {marker !== undefined && <div className="segbar-mark" style={{ left: w(marker) }} />}
    </div>
  );
}

/** Etiqueta pequeña con borde (estado, tipo, «guiada»…). */
export function Tag({ children, tone, className = '' }: { children: ReactNode; tone?: Tone | 'muted'; className?: string }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent' : 'text-slate-300';
  return <span className={`tag ${color} ${className}`}>{children}</span>;
}

/** Tecla y lo que hace: «[E] Usar». */
export function KeyHint({ k, children, className = '' }: { k: string; children?: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="kbd">{k}</span>
      {children && <span className="label-code !tracking-[0.12em]">{children}</span>}
    </span>
  );
}

/** Fila de ficha técnica: etiqueta a la izquierda, cifra monoespaciada a la derecha. */
export function StatRow({ label, value, tone, strong = false }: { label: ReactNode; value: ReactNode; tone?: Tone; strong?: boolean }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent' : 'text-slate-100';
  return (
    <div className="contents">
      <dt className={strong ? 'font-semibold text-slate-100' : 'text-slate-400'}>{label}</dt>
      <dd className={`num text-right ${color} ${strong ? 'text-lg font-bold' : ''}`}>{value}</dd>
    </div>
  );
}

/** Título de sección con código: «01 // VENTA». */
export function SectionLabel({ code, children, className = '' }: { code?: string; children: ReactNode; className?: string }) {
  return (
    <h3 className={`flex items-center gap-2 ${className}`}>
      {code && <span className="panel-code">{code}</span>}
      <span className="label-code !text-[11px] !text-slate-300">{children}</span>
      <span className="ticks flex-1" aria-hidden="true" />
    </h3>
  );
}

/** Pestañas: lista de opciones con una seleccionada (teclado nativo de botones). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className = '',
}: {
  items: readonly { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex flex-wrap gap-1 ${className}`}>
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={it.id === value} title={it.title} className="seg-option chip num flex items-center gap-1 px-2 py-1 text-[11px]" onClick={() => onChange(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

const TOAST_TONE: Record<Tone | 'info', string> = { info: 'text-slate-300', accent: 'text-accent', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };

/** Aviso breve con barra de tono a la izquierda (el texto sigue en claro para leerse). */
export function Toast({ tone = 'info', children, className = '' }: { tone?: Tone | 'info'; children: ReactNode; className?: string }) {
  return (
    <li className={`toast ui-enter ${TOAST_TONE[tone]} ${className}`}>
      <span className={tone === 'info' ? 'text-slate-100' : ''}>{children}</span>
    </li>
  );
}
