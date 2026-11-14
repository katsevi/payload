/**
 * Cooperativo (fase 6): entrada a una sala privada con código, lobby (roles, listo, empezar) y la barra de
 * tripulación que se ve durante la partida. Todo el estado viene de `net/coopStore` (lo que dice el servidor).
 */
import { useState } from 'react';
import { Crown, Rocket, Wifi, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COOP_LIMITS, ROLE_IDS, type RoleId } from '@payload/shared';
import { useGame } from '../game/runStore';
import { createRoom, joinRoom, leaveRoom, loadPlayerName, sendLobby } from '../net/coopSession';
import { mePlayer, useCoop } from '../net/coopStore';
import { useUi } from '../state/ui';
import { Panel } from './common';

/** Color de cada rol (avatares, barra de tripulación y lobby). */
export const ROLE_COLORS: Record<RoleId, string> = { pilot: '#5ab0ff', engineer: '#ffb347', manager: '#38e1c0', explorer: '#c58bff' };
export const NO_ROLE_COLOR = '#9aa7b8';

function close(): void {
  void leaveRoom();
  useCoop.setState({ error: null });
  useUi.getState().setOverlay(null);
}

function Entry() {
  const { t } = useTranslation();
  const status = useCoop((s) => s.status);
  const error = useCoop((s) => s.error);
  const [name, setName] = useState(loadPlayerName);
  const [code, setCode] = useState('');
  const busy = status === 'connecting';
  return (
    <Panel title={t('coop.title')} className="mx-auto w-full max-w-sm">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">{t('coop.name')}</span>
        <input className="num rounded border border-line bg-black/40 px-3 py-2 text-slate-100" value={name} maxLength={COOP_LIMITS.nameMaxLen} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <button className="btn btn-primary mt-4 w-full !py-3" disabled={busy} onClick={() => void createRoom(name)}>
        {t('coop.create')}
      </button>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void joinRoom(code, name);
        }}
      >
        <input
          className="num w-full rounded border border-line bg-black/40 px-3 py-2 text-center text-lg uppercase tracking-[0.4em] text-slate-100"
          value={code}
          maxLength={COOP_LIMITS.roomCodeLen}
          placeholder={t('coop.code')}
          aria-label={t('coop.code')}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="btn" type="submit" disabled={busy || code.trim().length !== COOP_LIMITS.roomCodeLen}>
          {t('coop.join')}
        </button>
      </form>
      {busy && <p className="num mt-3 text-center text-xs text-slate-400">{t('coop.connecting')}</p>}
      {error && <p className="mt-3 text-center text-sm text-bad">{t(`coop.error.${error}`)}</p>}
      <button className="btn mt-4 w-full" onClick={close}>
        {t('coop.back')}
      </button>
    </Panel>
  );
}

function Lobby() {
  const { t } = useTranslation();
  const lobby = useCoop((s) => s.lobby)!;
  const me = useCoop(mePlayer);
  const others = lobby.players.filter((p) => p.id !== me?.id);
  const canStart = others.every((p) => !p.connected || p.ready);
  return (
    <Panel title={t('coop.title')} className="mx-auto w-full max-w-md">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-slate-400">{t('coop.codeLabel')}</p>
        <p className="num select-all text-5xl font-bold tracking-[0.4em] text-accent">{lobby.code}</p>
      </div>
      <ul className="mt-4 flex flex-col gap-1.5">
        {lobby.players.map((p) => (
          <li key={p.id} className={`flex items-center gap-2 rounded border border-line bg-black/30 px-3 py-1.5 text-sm ${p.connected ? '' : 'opacity-50'}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.role ? ROLE_COLORS[p.role] : NO_ROLE_COLOR }} aria-hidden="true" />
            <span className="flex-1 truncate text-slate-100">
              {p.name}
              {p.id === me?.id && <span className="text-slate-500"> · {t('coop.you')}</span>}
            </span>
            <span className="num text-xs text-slate-400">{p.role ? t(`catalog.${p.role}`, { ns: 'sim' }) : t('coop.noRole')}</span>
            {p.host ? <Crown size={14} className="text-warn" aria-label={t('coop.host')} /> : <span className={`num text-xs ${p.ready ? 'text-ok' : 'text-slate-500'}`}>{p.ready ? t('coop.ready') : t('coop.notReady')}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label={t('coop.role')}>
        {ROLE_IDS.map((role) => {
          const mine = me?.role === role;
          const taken = others.some((p) => p.role === role);
          return (
            <button
              key={role}
              className={`btn flex flex-col items-start !px-3 !py-2 text-left ${mine ? 'btn-primary' : ''}`}
              disabled={taken}
              aria-pressed={mine}
              onClick={() => sendLobby({ type: 'set-role', role: mine ? null : role })}
            >
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROLE_COLORS[role] }} aria-hidden="true" />
                {t(`catalog.${role}`, { ns: 'sim' })}
              </span>
              <span className="text-[11px] normal-case tracking-normal text-slate-400">{t(`coop.roleHint.${role}`)}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {me?.host ? (
          <button className="btn btn-primary !py-3" disabled={!canStart} onClick={() => sendLobby({ type: 'start' })}>
            <Rocket size={16} className="mr-2 inline" aria-hidden="true" />
            {canStart ? t('coop.start') : t('coop.waitingReady')}
          </button>
        ) : (
          <button className={`btn !py-3 ${me?.ready ? '' : 'btn-primary'}`} onClick={() => sendLobby({ type: 'set-ready', ready: !me?.ready })}>
            {me?.ready ? t('coop.unready') : t('coop.setReady')}
          </button>
        )}
        <button className="btn" onClick={close}>
          {t('coop.leave')}
        </button>
      </div>
    </Panel>
  );
}

/** Pantalla de sala sobre el menú: entrada (crear o unirse) o lobby. */
export function CoopScreen() {
  const inLobby = useCoop((s) => s.lobby !== null);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-auto bg-black/60 p-4" role="dialog" aria-modal="true">
      {inLobby ? <Lobby /> : <Entry />}
    </div>
  );
}

/** Durante la partida: quién está, con qué rol, dónde (a bordo o fuera) y si sigue conectado. */
export function CrewBar() {
  const { t } = useTranslation();
  const lobby = useCoop((s) => s.lobby);
  const myId = useCoop((s) => s.myId);
  const status = useCoop((s) => s.status);
  const crew = useGame((s) => s.hud?.crew);
  if (!lobby || lobby.phase !== 'playing' || !crew) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-1">
      {status === 'reconnecting' && <p className="num animate-pulse rounded border border-warn bg-warn/15 px-2 py-1 text-xs text-warn">{t('coop.reconnecting')}</p>}
      <ul className="flex flex-col gap-1">
        {lobby.players.map((p) => {
          const member = crew.find((c) => c.id === p.crewId);
          const dead = member ? !member.alive : false;
          return (
            <li key={p.id} className={`num flex items-center gap-2 rounded border border-line bg-panel/80 px-2 py-1 text-xs ${dead || !p.connected ? 'opacity-50' : ''}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: p.role ? ROLE_COLORS[p.role] : NO_ROLE_COLOR }} aria-hidden="true" />
              <span className={`max-w-28 truncate ${p.id === myId ? 'text-accent' : 'text-slate-200'} ${dead ? 'line-through' : ''}`}>{p.name}</span>
              {member?.location === 'eva' && !dead && <span className="text-warn">{t('coop.outside', { o2: Math.round(member.suitO2Pct) })}</span>}
              {p.connected ? <Wifi size={11} className="text-slate-500" aria-hidden="true" /> : <WifiOff size={11} className="text-bad" aria-label={t('coop.disconnected')} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
