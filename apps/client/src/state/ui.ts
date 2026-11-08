import { create } from 'zustand';

export type Overlay = 'settings' | 'credits' | 'console' | null;
export type ViewMode = 'first' | 'third';

/** Estado de interfaz transversal a las escenas (no persistente). */
interface UiState {
  overlay: Overlay;
  help: boolean;
  resourcesOpen: boolean;
  view: ViewMode;
  /** Texto del aviso de interacción cercana (clave i18n + parámetro), calculado por el hangar. */
  prompt: { key: string; name?: string } | null;
  /** true fuera de la fase de diseño (p. ej. durante la revisión): el hangar ignora WASD/E/Q. */
  inputBlocked: boolean;
  setOverlay: (o: Overlay) => void;
  toggleHelp: () => void;
  toggleResources: () => void;
  toggleView: () => void;
  setView: (v: ViewMode) => void;
  setPrompt: (p: UiState['prompt']) => void;
}

export const useUi = create<UiState>((set) => ({
  overlay: null,
  help: false,
  resourcesOpen: false,
  view: 'first',
  prompt: null,
  inputBlocked: false,
  setOverlay: (overlay) => set({ overlay }),
  toggleHelp: () => set((s) => ({ help: !s.help })),
  toggleResources: () => set((s) => ({ resourcesOpen: !s.resourcesOpen })),
  toggleView: () => set((s) => ({ view: s.view === 'first' ? 'third' : 'first' })),
  setView: (view) => set({ view }),
  setPrompt: (prompt) =>
    set((s) => (s.prompt?.key === prompt?.key && s.prompt?.name === prompt?.name ? s : { prompt })),
}));
