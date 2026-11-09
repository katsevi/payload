import { create } from 'zustand';

/**
 * Progreso persistente del jugador (localStorage con try/catch; sin almacenamiento vive en memoria).
 *  - `attempts[scenarioId]`: siguiente nº de intento de ese escenario. Cada partida nueva y cada
 *    «Rediseñar» consumen uno (`claimAttempt`), así la semilla `defaultSeed + intento` no se repite
 *    entre partidas (antes volvía a 0 al pasar por el menú).
 *  - `academyDone`: la Academia se completó al menos una vez.
 */
interface ProgressState {
  attempts: Record<string, number>;
  academyDone: boolean;
  /** Devuelve el intento a usar para el escenario y avanza el contador persistido. */
  claimAttempt: (scenarioId: string) => number;
  setAcademyDone: (v: boolean) => void;
}

const KEY = 'payload.progress';

interface Persisted {
  attempts: Record<string, number>;
  academyDone: boolean;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      const attempts: Record<string, number> = {};
      for (const [k, v] of Object.entries(p.attempts ?? {})) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) attempts[k] = Math.floor(v);
      }
      return { attempts, academyDone: p.academyDone === true };
    }
  } catch {
    /* sin almacenamiento o JSON inválido */
  }
  return { attempts: {}, academyDone: false };
}

function save(p: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* almacenamiento no disponible */
  }
}

export const useProgress = create<ProgressState>((set, get) => ({
  ...load(),
  claimAttempt: (scenarioId) => {
    const current = get().attempts[scenarioId] ?? 0;
    const attempts = { ...get().attempts, [scenarioId]: current + 1 };
    set({ attempts });
    save({ attempts, academyDone: get().academyDone });
    return current;
  },
  setAcademyDone: (academyDone) => {
    set({ academyDone });
    save({ attempts: get().attempts, academyDone });
  },
}));
