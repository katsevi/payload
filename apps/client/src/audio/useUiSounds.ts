import { useEffect } from 'react';
import { useCoop } from '../net/coopStore';
import { useUi, type Overlay } from '../state/ui';
import { cue } from './cues';

const INTERACTIVE = 'button, [role="button"], [role="radio"], [role="tab"], a[href]';

/** El elemento interactivo habilitado bajo el puntero (o null). */
function interactiveAt(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(INTERACTIVE);
  if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;
  return el;
}

function openSfx(o: Exclude<Overlay, null>): 'mapOpen' | 'terminalOpen' | 'panelOpen' {
  return o === 'map' ? 'mapOpen' : o === 'terminal' ? 'terminalOpen' : 'panelOpen';
}

/**
 * Sonidos de la interfaz que no pertenecen a un botón concreto: clic y foco de cualquier botón, abrir y cerrar
 * paneles (mapa, energía, terminal...) y entrada o salida de compañeros en la sala. Todo pasa por `cue`, que ya
 * espacia cada sonido (`minGapMs`), así que ninguno se dispara por fotograma.
 */
export function useUiSounds(): void {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button === 0 && interactiveAt(e.target)) cue('click');
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = interactiveAt(e.target);
      if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) cue('hover');
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerover', onOver, true);

    const unsubUi = useUi.subscribe((s, p) => {
      if (s.overlay === p.overlay) return;
      if (s.overlay !== null) cue(openSfx(s.overlay));
      else if (p.overlay !== null) cue(p.overlay === 'map' ? 'mapClose' : 'panelClose');
    });

    const unsubCoop = useCoop.subscribe((s, p) => {
      if (!s.lobby || !p.lobby || s.lobby.code !== p.lobby.code) return;
      const was = new Set(p.lobby.players.filter((x) => x.connected).map((x) => x.id));
      const now = new Set(s.lobby.players.filter((x) => x.connected).map((x) => x.id));
      for (const id of now) if (!was.has(id) && id !== s.myId) return void cue('crewJoin');
      for (const id of was) if (!now.has(id) && id !== s.myId) return void cue('crewLeave');
    });

    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerover', onOver, true);
      unsubUi();
      unsubCoop();
    };
  }, []);
}
