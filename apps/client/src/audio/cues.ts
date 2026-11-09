import { create } from 'zustand';
import { audio } from './audioEngine';
import { SFX_META, type FlashTone, type SfxId } from './soundLogic';

/** Subtítulo de sonido visible unos segundos. */
export interface SoundCaption {
  id: number;
  key: string;
  tone: FlashTone | null;
}

interface CueState {
  captions: SoundCaption[];
  /** Último flash visual (seq cambia en cada aviso para reiniciar la animación). */
  flash: { seq: number; tone: FlashTone } | null;
  addCaption: (key: string, tone: FlashTone | null) => void;
  setFlash: (tone: FlashTone) => void;
  clear: () => void;
}

export const CAPTION_MS = 3800;
const MAX_CAPTIONS = 3;
let seq = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();

/** Equivalentes visuales de los avisos sonoros. Siempre se rellenan; los subtítulos se muestran solo si el ajuste está activo. */
export const useCues = create<CueState>((set, get) => ({
  captions: [],
  flash: null,
  addCaption: (key, tone) => {
    const id = ++seq;
    set({ captions: [...get().captions.filter((c) => c.key !== key), { id, key, tone }].slice(-MAX_CAPTIONS) });
    const timer = setTimeout(() => {
      timers.delete(timer);
      set({ captions: get().captions.filter((c) => c.id !== id) });
    }, CAPTION_MS);
    timers.add(timer);
  },
  setFlash: (tone) => set({ flash: { seq: ++seq, tone } }),
  clear: () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    set({ captions: [], flash: null });
  },
}));

const lastAt = new Map<SfxId, number>();
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Dispara un efecto: suena (si hay audio y no está silenciado) y deja su equivalente visual (flash y
 * subtítulo). El visual NO depende del audio: funciona con el sonido silenciado o sin AudioContext.
 * Devuelve false si el aviso se descartó por llegar demasiado pronto tras el anterior.
 */
export function cue(id: SfxId): boolean {
  const meta = SFX_META[id];
  const t = nowMs();
  const last = lastAt.get(id);
  if (last !== undefined && t - last < meta.minGapMs) return false;
  lastAt.set(id, t);
  audio.play(id);
  if (meta.flash) useCues.getState().setFlash(meta.flash);
  if (meta.captionKey) useCues.getState().addCaption(meta.captionKey, meta.flash);
  return true;
}

/** Solo tests: olvida los tiempos de enfriamiento. */
export function resetCueMemory(): void {
  lastAt.clear();
  useCues.getState().clear();
}
