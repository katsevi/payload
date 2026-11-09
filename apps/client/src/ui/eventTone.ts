import type { SimEventType } from '@payload/shared';

/** Gravedad visual de cada evento del motor (registro de operación e informe). */
const BAD: ReadonlySet<SimEventType> = new Set(['launch-failure', 'battery-depleted', 'component-failure', 'overheating']);
const WARN: ReadonlySet<SimEventType> = new Set([
  'battery-low', 'storage-full', 'solar-storm', 'reaction-wheel-failure', 'debris-avoidance', 'launch-delay', 'budget-cut',
]);
const GOOD: ReadonlySet<SimEventType> = new Set(['launch-success', 'mission-complete']);

export type EventTone = 'bad' | 'warn' | 'ok' | 'info';

export function eventTone(type: SimEventType): EventTone {
  if (BAD.has(type)) return 'bad';
  if (WARN.has(type)) return 'warn';
  if (GOOD.has(type)) return 'ok';
  return 'info';
}

export const TONE_TEXT: Record<EventTone, string> = { bad: 'text-bad', warn: 'text-warn', ok: 'text-ok', info: 'text-slate-200' };
export const TONE_BORDER: Record<EventTone, string> = { bad: 'border-bad', warn: 'border-warn', ok: 'border-ok', info: 'border-accent' };
