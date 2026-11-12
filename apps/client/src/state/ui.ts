import { create } from 'zustand';

/** Panel modal abierto. `map`, `power` y `help` no detienen la partida; `pause` sí. */
export type Overlay = 'settings' | 'credits' | 'map' | 'power' | 'help' | 'pause' | null;
export type ViewMode = 'first' | 'third';

/** Acción disponible junto al jugador (la calcula la escena de la nave). */
export interface PromptBadge {
  key: string;
  params?: Record<string, string | number>;
  tone?: 'warn' | 'info';
}

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
  /** Datos breves junto a la acción (p. ej. botín que queda, coste de O₂, O₂ de la nave bajo). */
  badges?: PromptBadge[];
  /** Se puede, pero con riesgo (p. ej. aterrizar sin combustible para frenar y despegar). */
  warn?: boolean;
}

/** Estado de interfaz transversal a las escenas (no persistente). */
interface UiState {
  overlay: Overlay;
  view: ViewMode;
  prompt: Prompt | null;
  /**
   * Vista exterior del descenso: se activa al iniciar el aterrizaje y la apaga la escena de superficie
   * unos segundos después de tocar tierra (ver `sceneFor`).
   */
  descentView: boolean;
  setDescentView: (on: boolean) => void;
  setOverlay: (o: Overlay) => void;
  toggleOverlay: (o: Exclude<Overlay, null>) => void;
  toggleView: () => void;
  setPrompt: (p: Prompt | null) => void;
}

const samePrompt = (a: Prompt | null, b: Prompt | null): boolean =>
  a === b ||
  (!!a && !!b && a.key === b.key && a.hold === b.hold && a.altKey === b.altKey && a.blocked === b.blocked && a.warn === b.warn &&
    Math.abs(a.progress - b.progress) < 0.004 && JSON.stringify(a.params) === JSON.stringify(b.params) && JSON.stringify(a.altParams) === JSON.stringify(b.altParams));

export const useUi = create<UiState>((set) => ({
  overlay: null,
  view: 'first',
  prompt: null,
  descentView: false,
  setDescentView: (descentView) => set({ descentView }),
  setOverlay: (overlay) => set({ overlay }),
  toggleOverlay: (o) => set((s) => ({ overlay: s.overlay === o ? null : o })),
  toggleView: () => set((s) => ({ view: s.view === 'first' ? 'third' : 'first' })),
  setPrompt: (prompt) => set((s) => (samePrompt(s.prompt, prompt) ? s : { prompt })),
}));

/**
 * Vista del jugador para la interfaz (posición en el plano y giro), escrita por la escena cada frame y
 * leída por indicadores que se pintan sin React (la brújula de la nave). Sin Three.js: es un objeto plano.
 */
export const hudView = {
  x: 0,
  z: 0,
  yaw: 0,
  /** Caída peligrosa en curso (lo calcula la escena; lo pinta `FallAlert`). */
  fallDanger: false,
  /** El O₂ del traje ya no da con holgura para volver andando (tiñe la brújula). */
  o2Short: false,
};
