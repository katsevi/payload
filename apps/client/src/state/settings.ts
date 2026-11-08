import { create } from 'zustand';

export interface SettingsState {
  fov: number;
  headBob: boolean;
  sensitivity: number;
  accessible2D: boolean;
  shadows: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

const KEY = 'payload.settings';
const defaults = { fov: 75, headBob: false, sensitivity: 1, accessible2D: false, shadows: true };

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
      const { fov, headBob, sensitivity, accessible2D, shadows } = get();
      localStorage.setItem(KEY, JSON.stringify({ fov, headBob, sensitivity, accessible2D, shadows }));
    } catch {
      /* ignorar */
    }
  },
}));
