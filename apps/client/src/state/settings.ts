import { create } from 'zustand';

export interface SettingsState {
  fov: number;
  headBob: boolean;
  sensitivity: number;
  accessible2D: boolean;
  shadows: boolean;
  /** Mascota guía activa (se puede desactivar para jugadores avanzados). */
  mascot: boolean;
  /** Silencia todo el audio (los avisos visuales y subtítulos siguen funcionando). */
  muteAll: boolean;
  /** Volúmenes 0-1 de los tres buses: música, efectos y avisos/voz. */
  volMusic: number;
  volSfx: number;
  volAlerts: number;
  /** Muestra subtítulos de sonido ("[alarma de batería]"). */
  soundCaptions: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

const KEY = 'payload.settings';
const defaults = {
  fov: 75, headBob: false, sensitivity: 1, accessible2D: false, shadows: true, mascot: true,
  muteAll: false, volMusic: 0.5, volSfx: 0.8, volAlerts: 0.8, soundCaptions: false,
};

function load(): typeof defaults {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* sin almacenamiento o JSON inválido */
  }
  return defaults;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { set: _set, ...persisted } = get();
      void _set;
      localStorage.setItem(KEY, JSON.stringify(persisted));
    } catch {
      /* ignorar */
    }
  },
}));
