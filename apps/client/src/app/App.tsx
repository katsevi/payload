import { lazy, Suspense, useEffect } from 'react';
import { SoundCaptions } from '../audio/SoundCaptions';
import { useAudioDirector } from '../audio/useAudioDirector';
import { getRun, useGame } from '../game/runStore';
import { useUi } from '../state/ui';
import { Hud } from '../ui/Hud';
import { PowerPanel } from '../ui/PowerPanel';
import { CreditsScreen, EndScreen, HelpOverlay, MenuScreen, PauseScreen, SettingsPanel } from '../ui/Screens';
import { StarMap } from '../ui/StarMap';

// Escenas 3D con carga diferida: three/rapier no bloquean el primer pintado.
const ShipScene = lazy(() => import('../scenes/ShipScene').then((m) => ({ default: m.ShipScene })));
const MenuScene = lazy(() => import('../scenes/MenuScene').then((m) => ({ default: m.MenuScene })));

/**
 * Raíz de la interfaz: menú o partida. La partida vive en `game/runStore` (el motor manda); aquí
 * solo se decide qué escena y qué paneles se pintan.
 */
export function App() {
  const screen = useGame((s) => s.screen);
  const runId = useGame((s) => s.runId);
  const phase = useGame((s) => s.hud?.phase);
  const overlay = useUi((s) => s.overlay);
  const ended = phase === 'lost' || phase === 'won';
  useAudioDirector();

  // Solo desarrollo: ?play=1[&seed=123] entra directo a la partida (capturas y depuración).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const q = new URLSearchParams(location.search);
    (window as unknown as { __payload?: unknown }).__payload = { getRun, useGame, useUi };
    if (q.get('play') && useGame.getState().screen === 'menu') useGame.getState().startRun(q.get('seed') ? Number(q.get('seed')) : undefined);
  }, []);

  // Al acabar el sector o la partida se suelta el ratón y se cierran los paneles.
  useEffect(() => {
    if (!ended) return;
    useUi.getState().setOverlay(null);
    if (document.pointerLockElement) document.exitPointerLock();
  }, [ended]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Suspense fallback={null}>{screen === 'menu' ? <MenuScene /> : <ShipScene key={runId} />}</Suspense>

      {screen === 'menu' && <MenuScreen />}
      {screen === 'game' && <Hud />}
      {screen === 'game' && ended && <EndScreen />}

      {overlay === 'map' && !ended && <StarMap />}
      {overlay === 'power' && !ended && <PowerPanel />}
      {overlay === 'pause' && !ended && <PauseScreen />}
      {overlay === 'help' && <HelpOverlay />}
      {overlay === 'settings' && <SettingsPanel />}
      {overlay === 'credits' && <CreditsScreen />}
      <SoundCaptions />
    </div>
  );
}
