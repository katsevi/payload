import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RESOURCE_UNITS, SUBSYSTEM_IDS, TEAM_LIMITS, catalog, type ResourceId, type SubsystemId, type TeamAction } from '@payload/shared';
import { lt, tr, tu } from '../i18n';
import { useRoom } from '../net/roomStore';
import { getSession } from '../net/sessionStore';
import { useUi } from '../state/ui';
import { Panel, fmt } from '../ui/common';
import { approveRequest, rejectRequest } from './actions';
import { RoleChip, inputCls } from './common';
import { usePlayerLabels, useRoomClock, useStableCanDo } from './hooks';
import {
  canResolveRequest, canWithdrawRequest, parsePositive, relativeAge, requestFromDraft, requestLine, sortRequests,
  type RequestDraft, type RequestLine,
} from './roomUiLogic';

const RESOURCES = Object.keys(RESOURCE_UNITS) as ResourceId[];
const EMPTY_DRAFT: RequestDraft = { resource: 'power', amount: '', subsystem: '', note: '' };

function RequestItem({ line, nowS }: { line: RequestLine; nowS: number }) {
  const { t } = useTranslation();
  const labelOf = usePlayerLabels();
  const myRoles = useRoom((s) => s.myRoles);
  const myId = useRoom((s) => s.myId);
  const [note, setNote] = useState('');
  const from = labelOf(line.fromPlayerId);
  const age = relativeAge(nowS, nowS - line.ageS);
  const component = line.componentId ? catalog.components.find((c) => c.id === line.componentId) : undefined;
  const resolve = canResolveRequest({ status: line.status, toRole: line.toRole }, myRoles);
  const withdraw = canWithdrawRequest({ status: line.status, fromPlayerId: line.fromPlayerId }, myId);
  const tone = line.status === 'open' ? 'border-warn' : line.status === 'approved' ? 'border-ok' : 'border-line';
  return (
    <li className={`rounded border-l-4 bg-[#0a1424] p-2 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <b>{from}</b>
        <RoleChip role={line.fromRole} small />
        <span aria-hidden>→</span>
        <RoleChip role={line.toRole} small />
        <span className="num ml-auto text-[10px] uppercase text-slate-400">
          {t(`room.requests.status.${line.status}`)} · {t(`room.time.${age.unit}`, { n: age.value })}
        </span>
      </div>
      <p className="mt-1">
        <span className="text-accent">{t(`resources.${line.resource}`)}</span>
        {line.amount !== null && <span className="num"> {fmt(line.amount, 2)} {tu(line.unit)}</span>}
        {line.subsystem && <span className="text-slate-300"> · {t(`subsystem.${line.subsystem}`)}</span>}
        {component && <span className="text-slate-300"> · {lt(component.name)}</span>}
      </p>
      {line.why && <p className="mt-1 text-xs text-slate-300">{tr(line.why)}</p>}
      {line.note && <p className="mt-1 text-xs italic text-slate-300">{t('room.quote', { text: line.note })}</p>}
      {line.chained && (
        <p className="mt-1 text-xs text-warn">
          {t('room.requests.chain', { approved: line.approvedBy.map((r) => t(`room.role.${r}`)).join(', '), pending: line.pendingRole ? t(`room.role.${line.pendingRole}`) : '' })}
        </p>
      )}
      {line.resolutionReason && <p className="mt-1 text-xs text-warn">{tr(line.resolutionReason)}</p>}
      {line.resolutionNote && <p className="mt-1 text-xs text-slate-300">{t('room.requests.resolutionNote')}: {t('room.quote', { text: line.resolutionNote })}</p>}
      {resolve && (
        <div className="mt-2 space-y-1">
          <input className={inputCls} value={note} maxLength={TEAM_LIMITS.noteMaxChars} onChange={(e) => setNote(e.target.value)} placeholder={t('room.requests.notePlaceholder')} aria-label={t('room.requests.notePlaceholder')} />
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => approveRequest(line.id, note || undefined)}>{t('room.requests.approve')}</button>
            <button className="btn" onClick={() => rejectRequest(line.id, note || undefined)}>{t('room.requests.reject')}</button>
          </div>
        </div>
      )}
      {withdraw && (
        <button className="btn mt-2" onClick={() => getSession().withdrawRequest(line.id)}>{t('room.requests.withdraw')}</button>
      )}
    </li>
  );
}

function RequestForm() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RequestDraft>(EMPTY_DRAFT);
  const built = useMemo(() => requestFromDraft(draft), [draft]);
  const action = useMemo<TeamAction>(() => ({ type: 'request-resource', ...built }), [built]);
  const check = useStableCanDo(action);
  const badAmount = draft.amount.trim() !== '' && parsePositive(draft.amount) === null;
  const blocked = check?.kind === 'reject' || badAmount;
  const set = <K extends keyof RequestDraft>(k: K, v: RequestDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <details className="mb-3 rounded border border-line bg-[#0a1424] p-2">
      <summary className="cursor-pointer text-sm font-bold text-accent">{t('room.requests.new')}</summary>
      <div className="mt-2 space-y-2 text-xs uppercase tracking-wider text-slate-400">
        <label className="block">
          {t('room.requests.resource')}
          <select className={inputCls} value={draft.resource} onChange={(e) => set('resource', e.target.value as ResourceId)}>
            {RESOURCES.map((r) => <option key={r} value={r}>{t(`resources.${r}`)} ({tu(RESOURCE_UNITS[r])})</option>)}
          </select>
        </label>
        <label className="block">
          {t('room.requests.amount')} ({tu(RESOURCE_UNITS[draft.resource])})
          <input className={inputCls} inputMode="decimal" value={draft.amount} onChange={(e) => set('amount', e.target.value)} aria-invalid={badAmount} />
        </label>
        <label className="block">
          {t('room.requests.subsystem')}
          <select className={inputCls} value={draft.subsystem} onChange={(e) => set('subsystem', e.target.value as SubsystemId | '')}>
            <option value="">{t('room.requests.anySubsystem')}</option>
            {SUBSYSTEM_IDS.map((s) => <option key={s} value={s}>{t(`subsystem.${s}`)}</option>)}
          </select>
        </label>
        <label className="block">
          {t('room.requests.note')}
          <textarea className={inputCls} rows={2} maxLength={TEAM_LIMITS.noteMaxChars} value={draft.note} onChange={(e) => set('note', e.target.value)} />
        </label>
        {check?.kind === 'request' && <p className="normal-case tracking-normal text-slate-300">{tr(check.why)}</p>}
        {check?.kind === 'reject' && <p className="normal-case tracking-normal text-warn">{tr(check.reason)}</p>}
        {badAmount && <p className="normal-case tracking-normal text-warn">{t('room.requests.badAmount')}</p>}
        <button className="btn btn-primary normal-case tracking-normal" disabled={blocked} onClick={() => { getSession().requestResource(built); setDraft(EMPTY_DRAFT); }}>
          {t('room.requests.send')}
        </button>
      </div>
    </details>
  );
}

/** Solicitudes de recursos entre roles: abiertas y resueltas, para todos; el rol dueño las resuelve. */
export function RequestsPanel() {
  const { t } = useTranslation();
  const requests = useRoom((s) => s.view?.requests);
  const nowS = useRoomClock(true);
  const { open, closed } = useMemo(() => sortRequests(requests ?? []), [requests]);
  return (
    <Panel title={t('room.requests.title')} className="relative !p-3">
      <button className="btn absolute right-2 top-2 !p-1" onClick={() => useUi.getState().setTeamPanel(null)} aria-label={t('common.close')} title={t('common.close')}>
        <X size={14} />
      </button>
      <p className="mb-3 text-xs text-slate-400">{t('room.requests.intro')}</p>
      <RequestForm />
      <h3 className="num mb-1 text-xs uppercase tracking-widest text-warn">{t('room.requests.open')} ({open.length})</h3>
      <ul className="mb-3 space-y-2" aria-live="polite">
        {open.length === 0 && <li className="text-sm text-slate-500">{t('room.requests.noneOpen')}</li>}
        {open.map((r) => <RequestItem key={r.id} line={requestLine(r, nowS)} nowS={nowS} />)}
      </ul>
      <h3 className="num mb-1 text-xs uppercase tracking-widest text-slate-400">{t('room.requests.resolved')} ({closed.length})</h3>
      <ul className="space-y-2">
        {closed.length === 0 && <li className="text-sm text-slate-500">{t('room.requests.noneResolved')}</li>}
        {closed.map((r) => <RequestItem key={r.id} line={requestLine(r, nowS)} nowS={nowS} />)}
      </ul>
    </Panel>
  );
}
