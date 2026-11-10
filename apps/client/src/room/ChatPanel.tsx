import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TEAM_LIMITS } from '@payload/shared';
import { useRoom } from '../net/roomStore';
import { useUi } from '../state/ui';
import { Panel } from '../ui/common';
import { sendChat } from './actions';
import { RoleChip, inputCls } from './common';
import { useRoomClock } from './hooks';
import { relativeAge } from './roomUiLogic';

/** Chat de texto de la sala: historial, campo (Enter envía, Escape cierra) y marcado de leídos. */
export function ChatPanel() {
  const { t } = useTranslation();
  const chat = useRoom((s) => s.view?.chat);
  const myId = useRoom((s) => s.myId);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const now = useRoomClock(true);
  const close = () => useUi.getState().setTeamPanel(null);

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
    input.current?.focus();
  }, []);
  const lastId = chat?.[chat.length - 1]?.id ?? null;
  useEffect(() => {
    useUi.getState().markChatSeen(lastId);
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const submit = () => {
    if (sendChat(text)) setText('');
  };
  return (
    <Panel title={t('room.chat.title')} className="relative !p-3">
      <button className="btn absolute right-2 top-2 !p-1" onClick={close} aria-label={t('common.close')} title={t('common.close')}>
        <X size={14} />
      </button>
      <ul ref={list} className="mb-3 max-h-72 space-y-2 overflow-auto text-sm" aria-label={t('room.chat.history')}>
        {(!chat || chat.length === 0) && <li className="text-slate-500">{t('room.chat.empty')}</li>}
        {chat?.map((m) => {
          const age = relativeAge(now, m.atS);
          return (
            <li key={m.id} className={`rounded bg-[#0a1424] p-2 ${m.playerId === myId ? 'border-l-2 border-accent' : ''}`}>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <b>{m.name}</b>
                {m.roles.map((r) => <RoleChip key={r} role={r} small />)}
                <span className="num ml-auto text-[10px] text-slate-500">{t(`room.time.${age.unit}`, { n: age.value })}</span>
              </div>
              <p className="mt-0.5 break-words text-slate-200">{m.text}</p>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <input
          ref={input}
          className={inputCls}
          value={text}
          maxLength={TEAM_LIMITS.chatMaxChars}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') close();
          }}
          placeholder={t('room.chat.placeholder')}
          aria-label={t('room.chat.placeholder')}
        />
        <button className="btn btn-primary !px-3" onClick={submit} disabled={text.trim() === ''} aria-label={t('room.chat.send')} title={t('room.chat.send')}>
          <Send size={14} />
        </button>
      </div>
      <div className="num mt-1 text-right text-[10px] text-slate-500">{text.length}/{TEAM_LIMITS.chatMaxChars}</div>
    </Panel>
  );
}
