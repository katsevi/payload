import { create } from 'zustand';

export interface SettingsState {
  fov: number;
  headBob: boolean;
  sensitivity: number;
  /** Silencia todo el audio (los avisos visuales y subtítulos siguen funcionando). */
  muteAll: boolean;
  /** Volúmenes 0-1 de los tres buses: música, efectos y avisos. */
  volMusic: number;
  volSfx: number;
  volAlerts: number;
  /** Muestra subtítulos de sonido ("[alarma]"). */
  soundCaptions: boolean;
  /** Intensidad 0-1 de la sacudida de cámara y de la viñeta de oxígeno. */
  effects: number;
  /** Recoger con una pulsación (alterna) en vez de mantener E. */
  toggleCollect: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

const KEY = 'payload.settings';
const defaults = { fov: 75, headBob: false, sensitivity: 1, muteAll: false, volMusic: 0.5, volSfx: 0.8, volAlerts: 0.8, soundCaptions: false, effects: 1, toggleCollect: false };

function load(): typeof defaults {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, unknown> = { ...defaults };
      // Solo se recuperan los ajustes que siguen existiendo (los de versiones anteriores se descartan).
      for (const k of Object.keys(defaults)) if (typeof saved[k] === typeof out[k]) out[k] = saved[k];
      return out as typeof defaults;
    }
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
