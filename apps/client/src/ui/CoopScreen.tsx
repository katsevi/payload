/**
 * Cooperativo (fase 6): entrada a una sala privada con código, lobby (roles, listo, empezar) y la barra de
 * tripulación que se ve durante la partida. Todo el estado viene de `net/coopStore` (lo que dice el servidor).
 */
import { useMemo, useState } from 'react';
import { CircleCheck, CircleX, Crown, PencilRuler, Rocket, Wifi, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COOP_LIMITS, getMissions, reviewDesign, ROLE_IDS, voteTally, type LobbyView, type RoleId, type VoteTally } from '@payload/shared';
import { lt } from '../i18n';
import { useGame } from '../game/runStore';
import { createRoom, joinRoom, leaveRoom, loadPlayerName, sendLobby } from '../net/coopSession';
import { mePlayer, useCoop } from '../net/coopStore';
import { useUi } from '../state/ui';
import { Panel } from './common';

/** Color de cada rol (avatares, barra de tripulación y lobby). */
export const ROLE_COLORS: Record<RoleId, string> = { pilot: '#5ab0ff', engineer: '#ffb347', manager: '#38e1c0', explorer: '#c58bff' };
export const NO_ROLE_COLOR = '#9aa7b8';

/**
 * Fase 6 (ADR 0020): ¿se puede zarpar con el diseño de la sala? Lo mismo que decide el servidor: la revisión del motor da
 * Go y vota Go la mayoría estricta de los conectados (empate = No-Go). Sin diseño (partida libre), `null`.
 */
export function sharedLaunchCheck(lobby: LobbyView): { motorGo: boolean; tally: VoteTally; canStart: boolean } | null {
  if (!lobby.design) return null;
  const motorGo = reviewDesign(lobby.design).go;
  const tally = voteTally(lobby.players.filter((p) => p.connected).map((p) => p.vote ?? null));
  return { motorGo, tally, canStart: motorGo && tally.passed };
}

/** Voto Go/No-Go, recuento y (para el anfitrión) zarpar. Se usa en el lobby y en el hangar compartido. */
export function SharedVote() {
  const { t } = useTranslation();
  const lobby = useCoop((s) => s.lobby);
  const me = useCoop(mePlayer);
  const check = useMemo(() => (lobby ? sharedLaunchCheck(lobby) : null), [lobby]);
  if (!lobby || !check || !me) return null;
  const { motorGo, tally, canStart } = check;
  const vote = (go: boolean) => sendLobby({ type: 'vote', go: me.vote === go ? null : go });
  const why = !motorGo ? t('coop.vote.motorNoGo') : tally.passed ? t('coop.vote.ready') : tally.go * 2 === tally.voters && tally.pending === 0 ? t('coop.vote.tie') : t('coop.vote.needMajority');
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('coop.vote.title')}>
        <button className={`btn flex items-center justify-center gap-1.5 ${me.vote === true ? 'btn-primary' : ''}`} aria-pressed={me.vote === true} onClick={() => vote(true)}>
          <CircleCheck size={15} aria-hidden="true" /> {t('coop.vote.go')}
        </button>
        <button className={`btn ${me.vote === false ? 'btn-danger' : ''}`} aria-pressed={me.vote === false} onClick={() => vote(false)}>
          <CircleX size={15} aria-hidden="true" /> {t('coop.vote.noGo')}
        </button>
      </div>
      <p className={`num text-center text-xs ${canStart ? 'text-ok' : 'text-warn'}`}>
        {t('coop.vote.tally', { go: tally.go, noGo: tally.noGo, voters: tally.voters })} · {why}
      </p>
      {me.host ? (
        <button className="btn btn-primary flex items-center justify-center gap-2 !py-3" disabled={!canStart} onClick={() => sendLobby({ type: 'start' })}>
          <Rocket size={16} aria-hidden="true" /> {canStart ? t('coop.start') : t('coop.vote.waiting')}
        </button>
      ) : (
        <p className="num text-center text-[11px] text-slate-400">{t('coop.vote.hostLaunches')}</p>
      )}
    </div>
  );
}

/** ¿El servidor de la sala admite misiones y diseño compartido? (los de la fase 6 siempre mandan `designRev`). */
export function missionsSupported(lobby: LobbyView): boolean {
  return typeof lobby.designRev === 'number';
}

/** Fase 6: misión de la sala (la elige el anfitrión) y acceso al hangar compartido. */
function MissionRow({ lobby, host }: { lobby: LobbyView; host: boolean }) {
  const { t } = useTranslation();
  const missions = getMissions();
  const design = lobby.design ?? null;
  const motorGo = design ? reviewDesign(design).go : false;
  // Un servidor anterior a la fase 6 (ADR 0020) no manda `designRev` e ignora `set-mission`: el selector volvería solo
  // a «Partida libre». Se avisa en vez de dejar un selector que no responde.
  const supported = missionsSupported(lobby);
  return (
    <div className="chamfer mt-4 flex flex-col gap-2 p-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="label-code w-20 shrink-0">{t('coop.mission')}</span>
        {host && supported ? (
          <select
            className="field flex-1 !py-1"
            value={design?.missionId ?? ''}
            onChange={(e) => sendLobby({ type: 'set-mission', missionId: e.target.value || null })}
          >
            <option value="">{t('coop.freePlay')}</option>
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {lt(m.name)}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex-1 text-slate-100">{design ? lt(missions.find((m) => m.id === design.missionId)?.name ?? { es: design.missionId, en: design.missionId }) : t('coop.freePlay')}</span>
        )}
      </label>
      {!supported && host && <p className="num text-[11px] text-warn">{t('coop.missionsUnsupported')}</p>}
      {design && (
        <div className="flex items-center gap-2">
          <span className={`num text-xs font-bold ${motorGo ? 'text-ok' : 'text-bad'}`}>{motorGo ? t('design.goTitle') : t('design.noGoTitle')}</span>
          <span className="num flex-1 truncate text-[11px] text-slate-400">{t('coop.parts', { n: design.moduleIds.length + design.instrumentIds.length })}</span>
          <button className="btn flex items-center gap-1.5 !py-1 text-xs" onClick={() => useGame.getState().openSharedDesign(design)}>
            <PencilRuler size={14} aria-hidden="true" /> {t('coop.openHangar')}
          </button>
        </div>
      )}
    </div>
  );
}

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
    <Panel title={t('coop.title')} code="NET-06" className="ui-enter mx-auto w-full max-w-sm">
      <label className="flex flex-col gap-1 text-sm">
        <span className="label-code">{t('coop.name')}</span>
        <input className="field" value={name} maxLength={COOP_LIMITS.nameMaxLen} onChange={(e) => setName(e.target.value)} autoFocus />
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
          className="field w-full text-center text-lg uppercase tracking-[0.4em]"
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
  const withDesign = !!lobby.design;
  return (
    <Panel title={t('coop.title')} code="NET-06" className="ui-enter mx-auto w-full max-w-md">
      <div className="text-center">
        <p className="label-code">{t('coop.codeLabel')}</p>
        <p className="num mt-1 select-all border-y border-line py-2 text-5xl font-bold tracking-[0.4em] text-accent">{lobby.code}</p>
      </div>
      <ul className="mt-4 flex flex-col gap-1.5">
        {lobby.players.map((p) => (
          <li key={p.id} className={`chip flex items-center gap-2 border border-line bg-black/30 px-3 py-1.5 text-sm ${p.connected ? '' : 'opacity-50'}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.role ? ROLE_COLORS[p.role] : NO_ROLE_COLOR }} aria-hidden="true" />
            <span className="flex-1 truncate text-slate-100">
              {p.name}
              {p.id === me?.id && <span className="text-slate-500"> · {t('coop.you')}</span>}
            </span>
            <span className="num text-xs text-slate-400">{p.role ? t(`catalog.${p.role}`, { ns: 'sim' }) : t('coop.noRole')}</span>
            {p.host && <Crown size={14} className="text-warn" aria-label={t('coop.host')} />}
            {withDesign ? (
              <span className={`num text-xs ${p.vote === true ? 'text-ok' : p.vote === false ? 'text-bad' : 'text-slate-500'}`}>
                {p.vote === true ? t('coop.vote.go') : p.vote === false ? t('coop.vote.noGo') : t('coop.vote.none')}
              </span>
            ) : (
              !p.host && <span className={`num text-xs ${p.ready ? 'text-ok' : 'text-slate-500'}`}>{p.ready ? t('coop.ready') : t('coop.notReady')}</span>
            )}
          </li>
        ))}
      </ul>
      <MissionRow lobby={lobby} host={!!me?.host} />
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
        {withDesign ? (
          <SharedVote />
        ) : me?.host ? (
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
    <div className="modal-backdrop absolute inset-0 z-30 flex items-center justify-center overflow-auto p-4" role="dialog" aria-modal="true">
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
            <li key={p.id} className={`hud-frame num flex items-center gap-2 px-2 py-1 text-xs ${dead || !p.connected ? 'opacity-50' : ''}`}>
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
