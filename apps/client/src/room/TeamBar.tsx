import { useEffect, useRef } from 'react';
import { Banknote, ClipboardList, LogOut, MapPin, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cue } from '../audio/cues';
import { selectInRoom, useRoom } from '../net/roomStore';
import { requestLeave } from './leave';
import { useUi, type TeamPanelId } from '../state/ui';
import { BudgetPanel } from './BudgetPanel';
import { ChatPanel } from './ChatPanel';
import { RoleChip } from './common';
import { usePingLogger } from './hooks';
import { PingsPanel } from './PingsPanel';
import { RequestsPanel } from './RequestsPanel';
import { chatUnread, connectionTone, lastFromOthers, newAlertIds, playerLabel } from './roomUiLogic';

const TONE = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;

/** Barra de equipo (visible en todas las fases de sala): mis roles, conexión, jugadores y acceso a los paneles. */
export function TeamBar() {
  const { t } = useTranslation();
  const myRoles = useRoom((s) => s.myRoles);
  const status = useRoom((s) => s.status);
  const myId = useRoom((s) => s.myId);
  const connected = useRoom((s) => s.view?.players.filter((p) => p.connected).length ?? 0);
  const total = useRoom((s) => s.view?.players.length ?? 0);
  const chat = useRoom((s) => s.view?.chat);
  const openRequests = useRoom((s) => s.view?.requests.filter((r) => r.status === 'open' && s.myRoles.includes(r.toRole)).length ?? 0);
  const panel = useUi((s) => s.teamPanel);
  const seen = useUi((s) => s.chatSeenId);
  const toggle = useUi((s) => s.toggleTeamPanel);
  const unread = panel === 'chat' || !chat ? 0 : chatUnread(chat, myId, seen);
  const announce = chat ? lastFromOthers(chat, myId) : null;
  const announcePlayer = announce ? useRoom.getState().view?.players.find((p) => p.id === announce.playerId) : null;
  usePingLogger();
  useAlertCue();
  // Al salir de la sala se cierra el panel acoplado (la próxima sala empieza limpia).
  useEffect(() => () => { useUi.getState().setTeamPanel(null); useUi.getState().markChatSeen(null); useUi.getState().setConfirmLeave(false); }, []);

  const btn = (id: TeamPanelId, icon: React.ReactNode, label: string, badge = 0, key?: string) => (
    <button className={`btn relative !px-2 !py-1.5 ${panel === id ? 'btn-primary' : ''}`} onClick={() => toggle(id)} aria-pressed={panel === id} title={key ? `${label} (${key})` : label}>
      {icon}
      <span className="sr-only">{label}</span>
      {badge > 0 && (
        <span className="num absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] text-white" aria-label={t('room.bar.badge', { n: badge })}>
          {badge}
        </span>
      )}
    </button>
  );
  return (
    <>
      <div className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-12rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded border border-line bg-panel/90 px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1" aria-label={t('room.bar.myRoles')}>
          {myRoles.length === 0 ? <span className="text-slate-400">{t('room.lobby.noRole')}</span> : myRoles.map((r) => <RoleChip key={r} role={r} small />)}
        </div>
        <span className={`num uppercase ${TONE[connectionTone(status)]}`}>{t(`room.connection.${status}`)}</span>
        <span className="num text-slate-300" title={t('room.bar.players')}>{connected}/{total}</span>
        {btn('chat', <MessageSquare size={14} />, t('room.chat.title'), unread, 'T')}
        {btn('requests', <ClipboardList size={14} />, t('room.requests.title'), openRequests, 'R')}
        {btn('budget', <Banknote size={14} />, t('room.budget.title'))}
        {btn('pings', <MapPin size={14} />, t('room.pings.title'), 0, 'P')}
        <button className="btn !px-2 !py-1.5" onClick={requestLeave} title={t('room.leave')}>
          <LogOut size={14} />
          <span className="sr-only">{t('room.leave')}</span>
        </button>
      </div>
      {/* Mensajes nuevos de otros: anuncio para lectores de pantalla aunque el panel esté cerrado. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce ? `${announcePlayer ? playerLabel(announcePlayer, 0, (n) => t('room.playerN', { n })) : announce.name}: ${announce.text}` : ''}
      </div>
      <TeamPanels />
    </>
  );
}

/** Panel de equipo abierto, acoplado a la derecha. */
export function TeamPanels() {
  const panel = useUi((s) => s.teamPanel);
  if (!panel) return null;
  return (
    <div className="absolute right-3 top-14 z-30 max-h-[78vh] w-[min(26rem,calc(100%-1.5rem))] overflow-auto">
      {panel === 'chat' && <ChatPanel />}
      {panel === 'requests' && <RequestsPanel />}
      {panel === 'budget' && <BudgetPanel />}
      {panel === 'pings' && <PingsPanel />}
    </div>
  );
}

/** Sonido de aviso cuando se abre una alerta de equipo nueva (una vez por alerta; `cue` pone flash y subtítulo). */
function useAlertCue(): void {
  const alerts = useRoom((s) => s.view?.alerts);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!alerts) return;
    if (seen.current === null) {
      // Primera vista: lo ya abierto no suena (p. ej. al reconectar).
      seen.current = new Set(alerts.map((a) => a.id));
      return;
    }
    const fresh = newAlertIds(alerts, seen.current);
    fresh.forEach((id) => seen.current!.add(id));
    if (fresh.length > 0) cue('radioStatic');
  }, [alerts]);
}

/** Atajo para fuera de la barra: ¿hay sala? */
export const useInRoom = (): boolean => useRoom(selectInRoom);
