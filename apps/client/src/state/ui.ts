import { create } from 'zustand';
import type { ResourceId } from '@payload/shared';

export type Overlay = 'settings' | 'credits' | 'console' | 'glossary' | 'advisors' | null;
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
  /** Entrada del glosario abierta en el panel (null = lista). */
  glossaryId: string | null;
  /** Recurso resaltado en el panel de recursos (lo fija la Academia). */
  highlight: ResourceId | null;
  /** Vista a través del instrumento principal (operación). */
  instrument: boolean;
  /** Vista de superficie con el rover Aurora (solo lunar/Marte, desde la vista del instrumento). */
  surface: boolean;
  openGlossary: (id?: string | null) => void;
  toggleInstrument: () => void;
  setInstrument: (on: boolean) => void;
  setSurface: (on: boolean) => void;
  setHighlight: (r: ResourceId | null) => void;
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
  glossaryId: null,
  highlight: null,
  instrument: false,
  surface: false,
  toggleInstrument: () => set((s) => ({ instrument: !s.instrument, surface: false })),
  setInstrument: (instrument) => set((s) => ({ instrument, surface: instrument ? s.surface : false })),
  setSurface: (surface) => set({ surface }),
  openGlossary: (id = null) => set({ overlay: 'glossary', glossaryId: id }),
  setHighlight: (highlight) => set((s) => (s.highlight === highlight ? s : { highlight })),
  setOverlay: (overlay) => set({ overlay }),
  toggleHelp: () => set((s) => ({ help: !s.help })),
  toggleResources: () => set((s) => ({ resourcesOpen: !s.resourcesOpen })),
  toggleView: () => set((s) => ({ view: s.view === 'first' ? 'third' : 'first' })),
  setView: (view) => set({ view }),
  setPrompt: (prompt) =>
    set((s) => (s.prompt?.key === prompt?.key && s.prompt?.name === prompt?.name ? s : { prompt })),
}));
