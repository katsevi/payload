import { create } from 'zustand';

/** Panel modal abierto. `map`, `power` y `help` no detienen la partida; `pause` sí. */
export type Overlay = 'settings' | 'credits' | 'map' | 'power' | 'help' | 'pause' | null;
export type ViewMode = 'first' | 'third';

/** Acción disponible junto al jugador (la calcula la escena de la nave). */
export interface Prompt {
  /** Clave ui del texto de la acción. */
  key: string;
  params?: Record<string, string | number>;
  /** true = hay que mantener la tecla; `progress` 0-1 es el avance. */
  hold: boolean;
  progress: number;
  /** Segunda acción (tecla Q), p. ej. cambiar el régimen en el timón. */
  altKey?: string;
  altParams?: Record<string, string | number>;
  /** La acción principal no se puede hacer ahora (p. ej. sin repuestos). */
  blocked?: boolean;
}

/** Estado de interfaz transversal a las escenas (no persistente). */
interface UiState {
  overlay: Overlay;
  view: ViewMode;
  prompt: Prompt | null;
  setOverlay: (o: Overlay) => void;
  toggleOverlay: (o: Exclude<Overlay, null>) => void;
  toggleView: () => void;
  setPrompt: (p: Prompt | null) => void;
}

const samePrompt = (a: Prompt | null, b: Prompt | null): boolean =>
  a === b ||
  (!!a && !!b && a.key === b.key && a.hold === b.hold && a.altKey === b.altKey && a.blocked === b.blocked &&
    Math.abs(a.progress - b.progress) < 0.004 && JSON.stringify(a.params) === JSON.stringify(b.params) && JSON.stringify(a.altParams) === JSON.stringify(b.altParams));

export const useUi = create<UiState>((set) => ({
  overlay: null,
  view: 'first',
  prompt: null,
  setOverlay: (overlay) => set({ overlay }),
  toggleOverlay: (o) => set((s) => ({ overlay: s.overlay === o ? null : o })),
  toggleView: () => set((s) => ({ view: s.view === 'first' ? 'third' : 'first' })),
  setPrompt: (prompt) => set((s) => (samePrompt(s.prompt, prompt) ? s : { prompt })),
}));
