import { create } from 'zustand';
import type { PartRef } from '../game/missionDesign';

/** Pieza bajo el ratón o con el foco en la paleta del hangar: la escena la dibuja en fantasma. */
export const useHangar = create<{ hover: PartRef | null; setHover: (p: PartRef | null) => void }>((set) => ({
  hover: null,
  setHover: (hover) => set((s) => (s.hover?.id === hover?.id && s.hover?.kind === hover?.kind ? s : { hover })),
}));
