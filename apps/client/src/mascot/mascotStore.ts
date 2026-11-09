import { create } from 'zustand';
import type { LocalizedText, MascotExpression } from '@payload/shared';
import { useSettings } from '../state/settings';
import { dialogueFor, isUrgent, mascotDef } from './mascotLogic';

/** Lo que la mascota dice ahora. El texto es a la vez el subtítulo (accesible con aria-live). */
export interface MascotLine {
  seq: number;
  trigger: string;
  expression: MascotExpression;
  /** Texto del catálogo (LocalizedText) o, si no hay diálogo, una clave ui de respaldo. */
  text?: LocalizedText;
  fallbackKey?: string;
}

interface SayOptions {
  /** Ignora el enfriamiento y la cola (p. ej. la tecla H). */
  force?: boolean;
  /** Clave ui que se muestra si la mascota no tiene diálogo para el disparador. */
  fallbackKey?: string;
  fallbackExpression?: MascotExpression;
}

interface MascotState {
  current: MascotLine | null;
  queue: MascotLine[];
  /** Devuelve true si la mascota va a decir algo. */
  say: (trigger: string, opts?: SayOptions) => boolean;
  /** Pasa al siguiente mensaje de la cola (o calla). */
  next: () => void;
  clear: () => void;
}

/** Un mismo disparador no se repite antes de este tiempo (evita spam a 10 000×). */
export const MASCOT_COOLDOWN_MS = 15_000;
const QUEUE_MAX = 3;

let seq = 0;
const variants = new Map<string, number>();
const lastSaid = new Map<string, number>();
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

export const useMascot = create<MascotState>((set, get) => ({
  current: null,
  queue: [],
  say: (trigger, opts = {}) => {
    if (!useSettings.getState().mascot) return false;
    const t = now();
    const last = lastSaid.get(trigger);
    if (!opts.force && last !== undefined && t - last < MASCOT_COOLDOWN_MS) return false;
    const variant = variants.get(trigger) ?? 0;
    const d = dialogueFor(trigger, mascotDef(), variant);
    if (!d && !opts.fallbackKey) return false;
    variants.set(trigger, variant + 1);
    lastSaid.set(trigger, t);
    const line: MascotLine = d
      ? { seq: ++seq, trigger, expression: d.expression, text: d.text }
      : { seq: ++seq, trigger, expression: opts.fallbackExpression ?? 'thinking', fallbackKey: opts.fallbackKey };
    const { current, queue } = get();
    if (!current || opts.force || isUrgent(trigger)) {
      set({ current: line, queue: opts.force ? [] : queue });
    } else if (!queue.some((q) => q.trigger === trigger) && current.trigger !== trigger) {
      set({ queue: [...queue, line].slice(-QUEUE_MAX) });
    }
    return true;
  },
  next: () => {
    const [head, ...rest] = get().queue;
    set({ current: head ?? null, queue: rest });
  },
  clear: () => set({ current: null, queue: [] }),
}));

/** Solo tests: olvida enfriamientos y variantes. */
export function resetMascotMemory(): void {
  variants.clear();
  lastSaid.clear();
  useMascot.setState({ current: null, queue: [] });
}
