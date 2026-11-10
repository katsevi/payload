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
import { NoticeBanner } from '../ui/NoticeBanner';
import { AlertsPanel } from '../room/AlertsPanel';
import { LobbyScreen } from '../room/LobbyScreen';
import { VoteScreen } from '../room/RoomReview';
import { TeamBar } from '../room/TeamBar';
import { LeaveRoomModal } from '../room/LeaveRoomModal';
import { RetryBanner } from '../room/RetryBanner';
import { requestLeave } from '../room/leave';
import { startDevRoom } from '../room/devRoom';
import { AcademyPanel } from '../academy/AcademyPanel';
import { MascotBubble } from '../mascot/MascotBubble';
import { useMascotDirector } from '../mascot/useMascotDirector';
import { useAudioDirector } from '../audio/useAudioDirector';
import { SoundCaptions } from '../audio/SoundCaptions';
import { selectInRoom, useActivePhase, useRoom } from '../net/roomStore';
import { resumeRoom } from '../net/roomSession';
import { getLocalSession, getSession } from '../net/sessionStore';
import { missionMachine, type MissionEvent, type PhaseName } from './missionMachine';
import { devInitialSnapshot } from './devStart';
import { useGlobalKeys } from './useGlobalKeys';

// Escenas 3D con carga diferida: three/rapier no bloquean el primer pintado.
const lazyScene = <K extends string>(load: () => Promise<Record<K, React.ComponentType<never>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType<Record<string, unknown>> })));
const HangarScene = lazyScene(() => import('../scenes/HangarScene'), 'HangarScene');
const LaunchScene = lazyScene(() => import('../scenes/LaunchScene'), 'LaunchScene');
const MenuScene = lazyScene(() => import('../scenes/MenuScene'), 'MenuScene');
const ControlRoomScene = lazyScene(() => import('../scenes/ControlRoomScene'), 'ControlRoomScene');
const OrbitScene = lazyScene(() => import('../scenes/OrbitScene'), 'OrbitScene');

/**
 * Raíz de la interfaz. La fase visible es la del servidor si hay sala (`useRoom.view.phase`) y, si no,
 * la de la máquina del solitario. Todas las escrituras de juego pasan por la sesión activa
 * (`getSession()`: `LocalSession` en solitario, `RoomSession` en sala); las escenas leen los stores.
 */
export function App() {
  const [devSnapshot] = useState(devInitialSnapshot);
  const [state, send] = useMachine(missionMachine, { snapshot: devSnapshot });
  const phase = useActivePhase(state.value as PhaseName);
  const accessible2D = useSettings((s) => s.accessible2D);
  const inRoom = useRoom(selectInRoom);

  // La sesión de solitario manda sus eventos a esta máquina.
  useEffect(() => {
    const local = getLocalSession();
    local.bind(send);
    return () => local.bind(null);
  }, [send]);

  // Tras recargar la página, volver a la sala si había una (token en sessionStorage).
  useEffect(() => {
    if (!devSnapshot && !(import.meta.env.DEV && new URLSearchParams(location.search).get('room') === 'demo')) void resumeRoom();
  }, [devSnapshot]);

  // Solo desarrollo: ?room=demo&phase=lobby|design|review|operation|report muestra la sala sin servidor.
  useEffect(() => startDevRoom(), []);
  const overlay = useUi((s) => s.overlay);
  useGlobalKeys(phase, accessible2D);
  useMascotDirector(phase);
  useAudioDirector(phase);

  // Solo desarrollo: ?phase=design salta directamente a una fase (útil para capturas y depuración).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(location.search).get('room') === 'demo') return;
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
  // Los manejadores leen la sesión al pulsar (puede cambiar al entrar o salir de una sala).
  const review = () => getSession().requestReview();
  // En una sala ya empezada, salir pide confirmación (no se puede volver a entrar).
  const toMenu = () => requestLeave();

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Suspense fallback={null}>
      {/* Escena 3D */}
      {inRoom && (phase === 'lobby' || phase === 'briefing' || phase === 'prelaunch') ? (
        // Sala de control compartida con los avatares del equipo (en 2D accesible no se monta la escena).
        accessible2D ? <div className="absolute inset-0 bg-gradient-to-b from-[#0b1220] to-[#02040a]" /> : <ControlRoomScene />
      ) : (
        (phase === 'menu' || phase === 'lobby' || phase === 'briefing' || phase === 'prelaunch' || phase === 'report') && <MenuScene />
      )}
      {inHangar && !accessible2D && <HangarScene />}
      {inHangar && accessible2D && <div className="absolute inset-0 bg-gradient-to-b from-[#0b1220] to-[#02040a]" />}
      {phase === 'launch' && <LaunchScene onDone={() => getSession().launchDone()} />}
      {phase === 'operation' && <OrbitScene />}
      </Suspense>

      {/* Interfaz (la sala de espera `lobby` la pinta la UI de sala) */}
      {phase === 'lobby' && inRoom && <LobbyScreen />}
      {phase === 'menu' && <MenuScreen onPlay={(id) => getLocalSession().playScenario(id)} onAcademy={() => getLocalSession().playAcademy()} />}
      {phase === 'briefing' && <BriefingScreen onStart={() => getSession().startDesign()} onBack={toMenu} />}
      {inHangar && accessible2D && <AccessibleDesign onReview={review} />}
      {inHangar && !accessible2D && <HangarHud onReview={review} />}
      {phase === 'review' && inRoom && <VoteScreen />}
      {phase === 'review' && !inRoom && <ReviewScreen onBack={() => getSession().backToDesign()} onLaunch={() => getSession().launch()} />}
      {phase === 'prelaunch' && <PreLaunchScreen onContinue={() => getSession().confirmLaunch()} />}
      {phase === 'launch' && <LaunchHud onSkip={() => useLaunch.getState().set({ skip: true })} />}
      {phase === 'operation' && <OperationHud onFinish={() => getSession().finishOperation()} />}
      {phase === 'report' && <ReportScreen onRedesign={() => getSession().redesign()} onMenu={toMenu} />}

      {inRoom && phase === 'operation' && <AlertsPanel />}
      <AcademyPanel phase={phase} onExit={toMenu} />
      <MascotBubble />
      <NoticeBanner />
      <RetryBanner />
      <LeaveRoomModal />
      <SoundCaptions />
      {inRoom && phase !== 'menu' && <TeamBar />}
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
