import { create } from 'zustand';
import type { MessageRef, ResourceId } from '@payload/shared';

export type Overlay = 'settings' | 'credits' | 'console' | 'glossary' | 'advisors' | null;
export type ViewMode = 'first' | 'third';
/** Panel de equipo acoplado a la derecha (sala): chat, solicitudes, presupuesto, pings. */
export type TeamPanelId = 'chat' | 'requests' | 'budget' | 'pings';

export type NoticeTone = 'info' | 'warn' | 'bad';

/**
 * Aviso puntual en pantalla (lo pinta `NoticeBanner`): un mensaje del motor/servidor (`ref`, namespace
 * `sim`, se muestra con `tr`) o una clave de `ui` (`key` + `params`). Ej.: acción rechazada por la sala.
 */
export interface UiNotice {
  id: number;
  tone: NoticeTone;
  ref?: MessageRef;
  key?: string;
  params?: Record<string, string | number>;
}

/** Tiempo en pantalla de un aviso. */
export const NOTICE_MS = 6000;
let noticeSeq = 0;

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
  /** Panel de equipo abierto (sala; null = ninguno). */
  teamPanel: TeamPanelId | null;
  /** Id del último mensaje de chat visto (para el contador de no leídos). */
  chatSeenId: string | null;
  /** Modal de confirmación al salir de una sala ya empezada. */
  confirmLeave: boolean;
  setConfirmLeave: (on: boolean) => void;
  setTeamPanel: (p: TeamPanelId | null) => void;
  toggleTeamPanel: (p: TeamPanelId) => void;
  markChatSeen: (id: string | null) => void;
  /** Aviso puntual en pantalla (null = ninguno). */
  notice: UiNotice | null;
  /** Muestra un aviso (sustituye al anterior) y devuelve su id. */
  showNotice: (n: Omit<UiNotice, 'id'>) => number;
  /** Quita el aviso (si se pasa id, solo si sigue siendo ese). */
  clearNotice: (id?: number) => void;
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
  teamPanel: null,
  confirmLeave: false,
  setConfirmLeave: (confirmLeave) => set({ confirmLeave }),
  chatSeenId: null,
  setTeamPanel: (teamPanel) => set({ teamPanel }),
  toggleTeamPanel: (p) => set((s) => ({ teamPanel: s.teamPanel === p ? null : p })),
  markChatSeen: (chatSeenId) => set((s) => (s.chatSeenId === chatSeenId ? s : { chatSeenId })),
  notice: null,
  showNotice: (n) => {
    const id = ++noticeSeq;
    set({ notice: { ...n, id } });
    return id;
  },
  clearNotice: (id) => set((s) => (s.notice && (id === undefined || s.notice.id === id) ? { notice: null } : s)),
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
