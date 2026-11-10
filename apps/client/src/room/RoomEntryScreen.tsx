import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lt } from '../i18n';
import { createPrivateRoom, hasSavedRoom, joinRoomByCode, quickMatch, resumeRoom } from '../net/roomSession';
import { useRoom } from '../net/roomStore';
import { tr } from '../i18n';
import { isTeamScenario } from '@payload/shared';
import { roomScenarios } from '../ui/catalogViews';
import { Panel } from '../ui/common';
import { inputCls } from './common';
import { cleanCode, cleanName, connectionTone, defaultRoomScenario } from './roomUiLogic';
import { TEAM_LIMITS } from '@payload/shared';

const NAME_KEY = 'payload.playerName';
const readName = (): string => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Pantalla de entrada a una sala de equipo (desde el menú): nombre, escenario, crear, unirse con código o partida rápida. */
export function RoomEntryScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const scenarios = roomScenarios();
  const [name, setName] = useState(readName);
  const [scenarioId, setScenarioId] = useState(() => defaultRoomScenario(scenarios));
  const [code, setCode] = useState('');
  const status = useRoom((s) => s.status);
  const error = useRoom((s) => s.error);
  const busy = status === 'connecting';
  const opts = () => {
    const n = cleanName(name);
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* sin almacenamiento */
    }
    return { scenarioId, name: n };
  };
  const tone = connectionTone(status);
  return (
    <div className="w-full max-w-3xl">
      <Panel title={t('room.entry.title')}>
        <p className="mb-4 text-sm text-slate-300">{t('room.entry.intro')}</p>
        <label className="mb-3 block text-xs uppercase tracking-wider text-slate-400">
          {t('room.name')}
          <input className={inputCls} value={name} maxLength={TEAM_LIMITS.nameMaxChars} onChange={(e) => setName(e.target.value)} placeholder={t('room.namePlaceholder')} />
        </label>
        <fieldset className="mb-4">
          <legend className="mb-1 text-xs uppercase tracking-wider text-slate-400">{t('room.entry.scenario')}</legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {scenarios.map((sc) => (
              <li key={sc.id}>
                <label className={`flex h-full cursor-pointer flex-col rounded border p-2 text-sm ${scenarioId === sc.id ? 'border-accent bg-[#0d1d33]' : 'border-line bg-[#0a1424]'}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="room-scenario" checked={scenarioId === sc.id} onChange={() => setScenarioId(sc.id)} />
                    <span className="font-bold text-accent">{lt(sc.name)}</span>
                    {isTeamScenario(sc) && sc.team && <span className="num rounded border border-ok px-1 text-[10px] uppercase text-ok">{t('room.entry.coop')} · {t('room.entry.players', { min: sc.team.minPlayers, max: sc.team.maxPlayers })}</span>}
                  </span>
                  <span className="num mt-1 text-[11px] text-slate-400">{t(`missionType.${sc.missionType}`)} · {t(`difficulty.${sc.difficulty}`)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <button className="btn btn-primary" disabled={busy || !scenarioId} onClick={() => void createPrivateRoom(opts())}>{t('room.entry.create')}</button>
            <button className="btn" disabled={busy || !scenarioId} onClick={() => void quickMatch(opts())}>{t('room.entry.quick')}</button>
            {hasSavedRoom() && <button className="btn" disabled={busy} onClick={() => void resumeRoom()}>{t('room.entry.resume')}</button>}
          </div>
          <div className="flex flex-col gap-2">
            <label className="block text-xs uppercase tracking-wider text-slate-400">
              {t('room.entry.code')}
              <input className={`${inputCls} num`} value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('room.entry.codePlaceholder')} autoComplete="off" />
            </label>
            <button className="btn" disabled={busy || cleanCode(code) === ''} onClick={() => void joinRoomByCode(cleanCode(code), { name: opts().name })}>{t('room.entry.join')}</button>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button className="btn" onClick={onBack}>{t('common.back')}</button>
          <div aria-live="polite" className="text-right text-sm">
            {status !== 'idle' && (
              <span className={tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-bad'}>{t(`room.connection.${status}`)}</span>
            )}
            {error && (
              <p role="alert" className="text-bad">
                {t(error.key)} {error.ref ? tr(error.ref) : ''}
              </p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
