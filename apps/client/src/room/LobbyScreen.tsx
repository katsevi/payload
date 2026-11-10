import { useMemo, useState } from 'react';
import { Check, Copy, Crown, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { TEAM_LIMITS, type TeamAction } from '@payload/shared';
import { lt, tr } from '../i18n';
import { selectPlayers, useRoom } from '../net/roomStore';
import { getSession } from '../net/sessionStore';
import { Panel, useScenario } from '../ui/common';
import { toggleMyRole } from './actions';
import { RoleChip, inputCls } from './common';
import { useStableCanDo } from './hooks';
import { ROLE_ORDER, playerLabel, roleColor, roleResources, uncoveredRoles } from './roomUiLogic';

const START: TeamAction = { type: 'start-mission' };

/** Sala de espera (fase `lobby`): código, jugadores, roles, y el botón de empezar del anfitrión. */
export function LobbyScreen() {
  const { t } = useTranslation();
  const sc = useScenario();
  const players = useRoom(useShallow(selectPlayers));
  const roomCode = useRoom((s) => s.roomCode);
  const myId = useRoom((s) => s.myId);
  const myRoles = useRoom((s) => s.myRoles);
  const isHost = useRoom((s) => s.isHost);
  const status = useRoom((s) => s.status);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState('');
  const startCheck = useStableCanDo(START);
  const missing = useMemo(() => uncoveredRoles(players), [players]);
  const fallback = (n: number) => t('room.playerN', { n });
  const copy = () => {
    if (!roomCode) return;
    void navigator.clipboard?.writeText(roomCode).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };
  const rename = () => {
    if (name.trim()) {
      getSession().setName(name);
      setName('');
    }
  };
  return (
    <div className="absolute inset-0 z-10 overflow-auto p-4 pt-16">
      {/* Columnas laterales: la franja central queda libre para ver la sala de control y los avatares. */}
      <div className="mx-auto grid w-full max-w-7xl items-start gap-4 lg:grid-cols-[minmax(0,22rem)_1fr_minmax(0,24rem)]">
        <div className="space-y-4">
          <Panel title={t('room.lobby.title')}>
            {sc && <p className="mb-2 text-sm text-accent">{lt(sc.name)}</p>}
            <div className="mb-1 text-xs uppercase tracking-wider text-slate-400">{t('room.lobby.code')}</div>
            <div className="flex items-center gap-2">
              <code className="num select-all rounded border border-line bg-[#0a1424] px-3 py-1.5 text-lg tracking-widest text-accent">{roomCode ?? '—'}</code>
              <button className="btn !p-2" onClick={copy} aria-label={t('room.lobby.copy')} title={t('room.lobby.copy')}>
                {copied ? <Check size={16} className="text-ok" /> : <Copy size={16} />}
              </button>
              <span aria-live="polite" className="text-xs text-ok">{copied ? t('room.lobby.copied') : ''}</span>
            </div>
            <p className="mt-2 text-xs text-slate-400">{t('room.lobby.shareHint')}</p>
          </Panel>
          <Panel title={`${t('room.lobby.players')} (${players.length}/${TEAM_LIMITS.maxPlayers})`}>
            <ul className="space-y-2">
              {players.map((p, i) => (
                <li key={p.id} className="rounded border border-line bg-[#0a1424] p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {p.isHost && <Crown size={14} className="text-warn" aria-label={t('room.host')} />}
                    <span className="font-bold">{playerLabel(p, i, fallback)}</span>
                    {p.id === myId && <span className="num text-[10px] uppercase text-slate-400">({t('room.you')})</span>}
                    <span className={`num ml-auto text-[10px] uppercase ${p.connected ? 'text-ok' : 'text-warn'}`}>
                      {p.connected ? t('room.connection.connected') : t('room.connection.reconnecting')}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.roles.length === 0 ? <span className="text-xs text-slate-500">{t('room.lobby.noRole')}</span> : p.roles.map((r) => <RoleChip key={r} role={r} small />)}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">{t('room.lobby.combineHint')}</p>
            <div className="mt-3 flex gap-2">
              <input className={inputCls} value={name} maxLength={TEAM_LIMITS.nameMaxChars} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} placeholder={t('room.lobby.rename')} aria-label={t('room.lobby.rename')} />
              <button className="btn" onClick={rename} disabled={!name.trim()}>{t('room.lobby.renameBtn')}</button>
            </div>
          </Panel>
        </div>
        <div className="space-y-4 lg:col-start-3">
          <Panel title={t('room.lobby.roles')}>
            <p className="mb-3 text-sm text-slate-300">{t('room.lobby.rolesIntro')}</p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {ROLE_ORDER.map((role) => {
                const holder = players.find((p) => p.roles.includes(role));
                const mine = myRoles.includes(role);
                const takenByOther = !!holder && holder.id !== myId;
                const c = roleColor(role);
                const watches = roleResources(role);
                return (
                  <li key={role} className="flex flex-col rounded border bg-[#0a1424] p-3" style={{ borderColor: c }}>
                    <h3 className="num text-sm font-bold uppercase tracking-wide" style={{ color: c }}>{t(`room.role.${role}`)}</h3>
                    <p className="mt-1 text-xs text-slate-300">{t(`room.roleCard.${role}.decides`)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      <span className="text-slate-500">{t('room.lobby.watches')}:</span>{' '}
                      {watches.length > 0 ? watches.map((r) => t(`resources.${r}`)).join(', ') : t('room.roleCard.noResources')}
                    </p>
                    <div className="mt-2 flex-1 text-xs">
                      {holder ? (
                        <span>{t('room.lobby.heldBy')}: <b>{playerLabel(holder, players.indexOf(holder), fallback)}</b></span>
                      ) : (
                        <span className="text-warn">{t('room.lobby.free')}</span>
                      )}
                    </div>
                    <button
                      className={`btn mt-2 ${mine ? 'btn-primary' : ''}`}
                      onClick={() => toggleMyRole(role)}
                      aria-pressed={mine}
                      disabled={takenByOther || status !== 'connected'}
                      title={takenByOther ? t('room.lobby.taken') : undefined}
                    >
                      {mine ? t('room.lobby.release') : t('room.lobby.claim')}
                    </button>
                  </li>
                );
              })}
            </ul>
            {missing.length > 0 && (
              <p className="mt-3 text-sm text-warn" role="status">
                {t('room.lobby.missing', { roles: missing.map((r) => t(`room.role.${r}`)).join(', ') })}
              </p>
            )}
          </Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button className="btn flex items-center gap-2" onClick={() => getSession().toMenu()}>
              <LogOut size={14} />
              {t('room.leave')}
            </button>
            {isHost ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button className="btn" onClick={() => getSession().autoAssignRoles()}>{t('room.lobby.autoAssign')}</button>
                <button
                  className="btn btn-primary"
                  onClick={() => getSession().startMission()}
                  disabled={startCheck?.kind === 'reject'}
                  title={startCheck?.kind === 'reject' ? tr(startCheck.reason) : undefined}
                >
                  {t('room.lobby.start')}
                </button>
              </div>
            ) : (
              <span className="text-sm text-slate-300">{t('room.lobby.waitHost')}</span>
            )}
          </div>
          {isHost && startCheck?.kind === 'reject' && <p className="text-right text-xs text-warn" role="status">{tr(startCheck.reason)}</p>}
        </div>
      </div>
    </div>
  );
}
