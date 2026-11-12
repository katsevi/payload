import { lazy, Suspense, useEffect } from 'react';
import { SoundCaptions } from '../audio/SoundCaptions';
import { useAudioDirector } from '../audio/useAudioDirector';
import { reachSurface } from '../game/debug';
import { getRun, useGame } from '../game/runStore';
import { sceneFor } from '../game/surfaceRules';
import { useUi } from '../state/ui';
import { Hud } from '../ui/Hud';
import { PowerPanel } from '../ui/PowerPanel';
import { CreditsScreen, EndScreen, HelpOverlay, MenuScreen, PauseScreen, SettingsPanel } from '../ui/Screens';
import { StarMap } from '../ui/StarMap';

// Escenas 3D con carga diferida: three/rapier no bloquean el primer pintado.
const ShipScene = lazy(() => import('../scenes/ShipScene').then((m) => ({ default: m.ShipScene })));
const MenuScene = lazy(() => import('../scenes/MenuScene').then((m) => ({ default: m.MenuScene })));
const loadSurface = () => import('../scenes/SurfaceScene').then((m) => ({ default: m.SurfaceScene }));
const SurfaceScene = lazy(loadSurface);

/** Solo desarrollo: lleva la partida a la superficie (`descent` = justo al empezar el descenso). */
function toSurface(stage: 'descent' | 'landed' | 'eva' = 'eva'): boolean {
  const run = getRun();
  if (!run) return false;
  const ok = reachSurface(run, stage);
  if (stage !== 'descent') useUi.getState().setDescentView(false);
  useGame.getState().tick(0);
  return ok;
}

/**
 * Raíz de la interfaz: menú o partida. La partida vive en `game/runStore` (el motor manda); aquí
 * solo se decide qué escena y qué paneles se pintan.
 */
export function App() {
  const screen = useGame((s) => s.screen);
  const runId = useGame((s) => s.runId);
  const phase = useGame((s) => s.hud?.phase);
  const overlay = useUi((s) => s.overlay);
  const crewAt = useGame((s) => s.hud?.crew[0]?.location);
  const descentView = useUi((s) => s.descentView);
  const ended = phase === 'lost' || phase === 'won';
  const scene = sceneFor(phase, crewAt, descentView);
  const surfaceMode = crewAt === 'eva' ? 'eva' : 'descent';
  useAudioDirector();

  // Solo desarrollo: ?play=1[&seed=123] entra directo a la partida (capturas y depuración).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const q = new URLSearchParams(location.search);
    const w = window as unknown as { __payload?: object };
    w.__payload = { ...(w.__payload ?? {}), getRun, useGame, useUi, toSurface };
    if (q.get('play') && useGame.getState().screen === 'menu') {
      useGame.getState().startRun(q.get('seed') ? Number(q.get('seed')) : undefined);
      // ?surface=1 (fuera, en EVA) · ?surface=descent (minijuego del descenso) · ?surface=landed (a bordo, posada)
      const stage = q.get('surface');
      if (stage) toSurface(stage === 'descent' || stage === 'landed' ? stage : 'eva');
    }
  }, []);

  // La escena de superficie se descarga en segundo plano en cuanto empieza la partida.
  useEffect(() => {
    if (screen === 'game') void loadSurface();
  }, [screen]);

  // Al acabar el sector o la partida se suelta el ratón y se cierran los paneles.
  useEffect(() => {
    if (!ended) return;
    useUi.getState().setOverlay(null);
    if (document.pointerLockElement) document.exitPointerLock();
  }, [ended]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Suspense fallback={null}>
        {screen === 'menu' ? <MenuScene /> : scene === 'surface' ? <SurfaceScene key={`${runId}:${surfaceMode}`} mode={surfaceMode} /> : <ShipScene key={runId} />}
      </Suspense>

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
