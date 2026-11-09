import { lazy, Suspense, useEffect, useState } from 'react';
import { useMachine } from '@xstate/react';
import { catalog } from '@payload/shared';
import { useDesign } from '../state/design';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { useLaunch } from '../state/launch';
import { AccessibleDesign } from '../ui/DesignPanel';
import { ConsoleModal, HangarHud, HelpOverlay, LaunchHud, OperationHud, TopBar } from '../ui/Huds';
import { BriefingScreen, CreditsScreen, MenuScreen, PreLaunchScreen, ReportScreen, ReviewScreen, SettingsPanel } from '../ui/Screens';
import { AdvisorsModal, GlossaryPanel } from '../ui/LearningPanels';
import { AcademyPanel } from '../academy/AcademyPanel';
import { academyScenarioId } from '../academy/academyLogic';
import { useAcademy } from '../academy/academyStore';
import { MascotBubble } from '../mascot/MascotBubble';
import { useMascotDirector } from '../mascot/useMascotDirector';
import { useAudioDirector } from '../audio/useAudioDirector';
import { SoundCaptions } from '../audio/SoundCaptions';
import { missionMachine, type MissionEvent, type PhaseName } from './missionMachine';
import { devInitialSnapshot } from './devStart';
import { useGlobalKeys } from './useGlobalKeys';

// Escenas 3D con carga diferida: three/rapier no bloquean el primer pintado.
const lazyScene = <K extends string>(load: () => Promise<Record<K, React.ComponentType<never>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType<Record<string, unknown>> })));
const HangarScene = lazyScene(() => import('../scenes/HangarScene'), 'HangarScene');
const LaunchScene = lazyScene(() => import('../scenes/LaunchScene'), 'LaunchScene');
const MenuScene = lazyScene(() => import('../scenes/MenuScene'), 'MenuScene');
const OrbitScene = lazyScene(() => import('../scenes/OrbitScene'), 'OrbitScene');

export function App() {
  const [devSnapshot] = useState(devInitialSnapshot);
  const [state, send] = useMachine(missionMachine, { snapshot: devSnapshot });
  const phase = state.value as PhaseName;
  const accessible2D = useSettings((s) => s.accessible2D);
  const overlay = useUi((s) => s.overlay);
  useGlobalKeys(phase, accessible2D);
  useMascotDirector(phase);
  useAudioDirector(phase);

  // Solo desarrollo: ?phase=design salta directamente a una fase (útil para capturas y depuración).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const target = new URLSearchParams(location.search).get('phase');
    const path: Record<string, MissionEvent['type'][]> = {
      briefing: ['PLAY'],
      design: ['PLAY', 'START_DESIGN'],
    };
    path[target ?? '']?.forEach((type) => send({ type } as MissionEvent));
    const q = new URLSearchParams(location.search);
    if (q.get('demo') && target === 'design' && useDesign.getState().componentIds.length === 0) {
      // Idempotente (StrictMode ejecuta el efecto dos veces): solo monta si el diseño está vacío.
      const d = useDesign.getState();
      const seen = new Set<string>();
      for (const c of catalog.components) if (!seen.has(c.subsystem)) { seen.add(c.subsystem); d.add(c.id); }
    }
    if (q.get('view') === 'third') useUi.getState().setView('third');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al cambiar de fase se cierran paneles modales (excepto en el menú, donde se abren Ajustes/Créditos).
  useEffect(() => {
    useUi.getState().setOverlay(null);
    useUi.getState().setInstrument(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }, [phase]);

  useEffect(() => {
    useUi.setState({ inputBlocked: phase !== 'design' });
  }, [phase]);

  const inHangar = phase === 'design' || phase === 'review';
  const review = () => send({ type: 'REQUEST_REVIEW' });
  const playScenario = (scenarioId: string) => {
    useAcademy.getState().exit();
    send({ type: 'PLAY', scenarioId });
  };
  const playAcademy = () => {
    useAcademy.getState().start();
    send({ type: 'PLAY', scenarioId: academyScenarioId() });
  };
  const toMenu = () => {
    useAcademy.getState().exit();
    send({ type: 'MENU' });
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Suspense fallback={null}>
      {/* Escena 3D */}
      {(phase === 'menu' || phase === 'briefing' || phase === 'prelaunch' || phase === 'report') && <MenuScene />}
      {inHangar && !accessible2D && <HangarScene />}
      {inHangar && accessible2D && <div className="absolute inset-0 bg-gradient-to-b from-[#0b1220] to-[#02040a]" />}
      {phase === 'launch' && <LaunchScene onDone={() => send({ type: 'LAUNCH_DONE' })} />}
      {phase === 'operation' && <OrbitScene />}
      </Suspense>

      {/* Interfaz */}
      {phase === 'menu' && <MenuScreen onPlay={playScenario} onAcademy={playAcademy} />}
      {phase === 'briefing' && <BriefingScreen onStart={() => send({ type: 'START_DESIGN' })} onBack={toMenu} />}
      {inHangar && accessible2D && <AccessibleDesign onReview={review} />}
      {inHangar && !accessible2D && <HangarHud onReview={review} />}
      {phase === 'review' && <ReviewScreen onBack={() => send({ type: 'BACK_TO_DESIGN' })} onLaunch={() => send({ type: 'LAUNCH' })} />}
      {phase === 'prelaunch' && <PreLaunchScreen onContinue={() => send({ type: 'CONFIRM_LAUNCH' })} />}
      {phase === 'launch' && <LaunchHud onSkip={() => useLaunch.getState().set({ skip: true })} />}
      {phase === 'operation' && <OperationHud onFinish={() => send({ type: 'FINISH' })} />}
      {phase === 'report' && <ReportScreen onRedesign={() => send({ type: 'REDESIGN' })} onMenu={toMenu} />}

      <AcademyPanel phase={phase} onExit={toMenu} />
      <MascotBubble />
      <SoundCaptions />
      {phase !== 'menu' && <TopBar phase={phase} />}
      {phase !== 'menu' && <HelpOverlay phase={phase} />}
      {overlay === 'settings' && <SettingsPanel />}
      {overlay === 'credits' && <CreditsScreen />}
      {overlay === 'console' && <ConsoleModal onReview={review} />}
      {overlay === 'glossary' && <GlossaryPanel />}
      {overlay === 'advisors' && <AdvisorsModal />}
    </div>
  );
}
