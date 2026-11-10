import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { catalog, reviewGoNoGo, type TeamRole, type ValidationIssue } from '@payload/shared';
import { tr } from '../i18n';
import { canDoIn, selectPoll, useRoom } from '../net/roomStore';
import type { TeamActionCheck } from '@payload/shared';
import { IssueList } from '../ui/Screens';
import { Panel, fmt } from '../ui/common';
import { AdvisorsPanel } from '../ui/LearningPanels';
import { voteGo, voteNoGo } from './actions';
import { RoleChip, inputCls } from './common';
import { usePlayerLabels } from './hooks';
import {
  NO_GO_CODES, collabRows, durationParts, noGoFormError, noGoVoteLines, playerLabel, voteStates, type NoGoForm,
} from './roomUiLogic';

/** Selector del motivo de un No-Go (obligatorio; «otro» exige nota). */
function NoGoDialog({ role, onCancel }: { role: TeamRole; onCancel: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<NoGoForm>({ code: null, note: '' });
  const err = noGoFormError(form);
  const [tried, setTried] = useState(false);
  const submit = () => {
    setTried(true);
    if (err) return;
    voteNoGo(role, form);
    onCancel();
  };
  return (
    <div className="mt-3 rounded border border-bad bg-[#0a1424] p-3" role="group" aria-label={t('room.vote.reasonTitle', { role: t(`room.role.${role}`) })}>
      <h4 className="mb-1 text-sm font-bold text-bad">{t('room.vote.reasonTitle', { role: t(`room.role.${role}`) })}</h4>
      <p className="mb-2 text-xs text-slate-300">{t('room.vote.reasonHint')}</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {NO_GO_CODES.map((c) => (
          <li key={c}>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name={`nogo-${role}`} checked={form.code === c} onChange={() => setForm((f) => ({ ...f, code: c }))} />
              {t(`team.noGoReason.${c}`, { ns: 'sim' })}
            </label>
          </li>
        ))}
      </ul>
      <label className="mt-2 block text-xs uppercase tracking-wider text-slate-400">
        {form.code === 'other' ? t('room.vote.noteRequired') : t('room.vote.noteOptional')}
        <textarea className={inputCls} rows={2} maxLength={280} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} aria-invalid={tried && err === 'note'} />
      </label>
      {tried && err && <p role="alert" className="mt-1 text-xs text-bad">{t(`room.vote.error.${err}`)}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button className="btn" onClick={onCancel}>{t('common.back')}</button>
        <button className="btn btn-primary" onClick={submit} disabled={err !== null}>{t('room.vote.sendNoGo')}</button>
      </div>
    </div>
  );
}

/** Votación Go/No-Go compartida (sustituye a `ReviewScreen` cuando hay sala). */
export function VoteScreen() {
  const { t } = useTranslation();
  const votes = useRoom((s) => s.view?.votes);
  const design = useRoom((s) => s.view?.design);
  const phase = useRoom((s) => s.view?.phase);
  const myRoles = useRoom((s) => s.myRoles);
  // Recuento con la revisión actual: solo cuando cambian votos o diseño (no a ~10 Hz).
  const poll = useMemo(() => selectPoll(useRoom.getState()), [votes, design]); // eslint-disable-line react-hooks/exhaustive-deps
  const [noGoFor, setNoGoFor] = useState<TeamRole | null>(null);
  const name = usePlayerLabels();
  const result = useMemo(() => {
    if (!design) return { go: false, issues: [] as ValidationIssue[] };
    try {
      return reviewGoNoGo(design, catalog);
    } catch {
      return { go: false, issues: [] as ValidationIssue[] };
    }
  }, [design]);
  const states = useMemo(() => voteStates(votes ?? [], poll), [votes, poll]);
  // Veredicto de «Go» por rol: solo cuando cambian diseño, votos, fase o mis roles (no a ~10 Hz).
  const goChecks = useMemo(() => {
    const out: Record<string, TeamActionCheck> = {};
    for (const role of myRoles) out[role] = canDoIn(useRoom.getState(), { type: 'vote', role, value: 'go' });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRoles, design, votes, phase]);
  if (!design) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-auto bg-black/60 p-4 pt-16">
      <Panel title={t('review.title')} className="max-h-full w-full max-w-3xl overflow-auto">
        <div className={`num mb-1 text-4xl font-bold ${result.go ? 'text-ok' : 'text-bad'}`}>{result.go ? t('review.go') : t('review.nogo')}</div>
        <p className="mb-3 text-sm text-slate-300">{result.go ? t('review.goText') : t('review.nogoText')}</p>
        <IssueList issues={result.issues} />
        <h3 className="num mb-2 mt-4 text-xs uppercase tracking-widest text-accent">{t('room.vote.title')}</h3>
        <ul className="grid gap-2 sm:grid-cols-2" aria-live="polite">
          {states.map((s) => (
            <li key={s.role} className="rounded border border-line bg-[#0a1424] p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <RoleChip role={s.role} small />
                <span className={`num text-xs font-bold uppercase ${s.state === 'go' ? 'text-ok' : s.state === 'no-go' ? 'text-bad' : 'text-slate-400'}`}>
                  {s.state === 'go' ? t('room.vote.go') : s.state === 'no-go' ? t('room.vote.nogo') : t('room.vote.pending')}
                </span>
              </div>
              {s.playerId && <div className="mt-1 text-xs text-slate-400">{t('room.vote.by', { name: name(s.playerId) })}</div>}
              {s.reason && <div className="mt-1 text-xs text-slate-300">{t(`team.noGoReason.${s.reason.code}`, { ns: 'sim' })}{s.reason.note ? `: ${t('room.quote', { text: s.reason.note })}` : ''}</div>}
            </li>
          ))}
        </ul>
        <h3 className="num mb-2 mt-4 text-xs uppercase tracking-widest text-accent">{t('room.vote.mine')}</h3>
        {myRoles.length === 0 ? (
          <p className="text-sm text-slate-400">{t('room.vote.noRole')}</p>
        ) : (
          <ul className="space-y-2">
            {myRoles.map((role) => {
              const goCheck = goChecks[role] ?? { kind: 'apply' as const };
              const goBlocked = goCheck.kind === 'reject';
              return (
                <li key={role} className="flex flex-wrap items-center gap-2">
                  <RoleChip role={role} />
                  <button className="btn btn-primary" onClick={() => voteGo(role)} disabled={goBlocked} title={goCheck.kind === 'reject' ? tr(goCheck.reason) : undefined}>{t('room.vote.sendGo')}</button>
                  <button className="btn" onClick={() => setNoGoFor(noGoFor === role ? null : role)} aria-expanded={noGoFor === role}>{t('room.vote.nogo')}</button>
                  {goBlocked && goCheck.kind === 'reject' && <span className="text-xs text-warn">{tr(goCheck.reason)}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {noGoFor && <NoGoDialog role={noGoFor} onCancel={() => setNoGoFor(null)} />}
        <AdvisorsPanel className="mt-4 !p-3" />
      </Panel>
    </div>
  );
}

/** Motivos del último No-Go (de la votación o del motor) visibles para todo el equipo al volver a diseño. */
export function LastNoGoPanel({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const lastNoGo = useRoom((s) => s.view?.lastNoGo ?? null);
  const name = usePlayerLabels();
  if (!lastNoGo) return null;
  const lines = lastNoGo.source === 'vote' ? noGoVoteLines(lastNoGo.votes) : [];
  const blockers = lastNoGo.issues.filter((i) => i.severity === 'blocker');
  return (
    <Panel title={t('hangar.noGoReasons')} className={`max-w-sm !p-3 ${className}`}>
      <p className="mb-2 text-xs text-slate-300">{lastNoGo.source === 'vote' ? t('room.lastNoGo.vote') : t('room.lastNoGo.review')}</p>
      {lastNoGo.source === 'vote' ? (
        <ul className="space-y-1">
          {lines.map((l, i) => (
            <li key={i} className="rounded border-l-4 border-bad bg-[#0a1424] p-2 text-sm">
              <RoleChip role={l.role} small /> <span className="text-xs text-slate-400">{name(l.playerId)}</span>
              <div>{t(`team.noGoReason.${l.code}`, { ns: 'sim' })}{l.note ? `: ${t('room.quote', { text: l.note })}` : ''}</div>
            </li>
          ))}
        </ul>
      ) : (
        <IssueList issues={blockers} />
      )}
    </Panel>
  );
}

/** Sección de colaboración del informe de sala: puntuación, desglose, puntuación de equipo y el porqué. */
export function CollaborationSection() {
  const { t } = useTranslation();
  const collab = useRoom((s) => s.view?.collaboration ?? null);
  if (!collab) return null;
  return (
    <Panel title={t('room.report.title')}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="num text-5xl font-bold text-accent">{fmt(collab.score, 0)}<span className="text-xl text-slate-400"> / 100</span></div>
          <p className="num text-xs uppercase text-slate-400">{t('room.report.collabScore')}</p>
        </div>
        <dl className="num grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
          {collabRows(collab).map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-slate-400">{t(`room.report.row.${r.key}`)}</dt>
              <dd>
                {r.value === null
                  ? t('common.none')
                  : r.key === 'requestTime' || r.key === 'alertTime'
                    ? (() => { const d = durationParts(r.value); return t(`room.duration.${d.key}`, d.params); })()
                    : `${r.value} / ${r.total ?? 0}`}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-3 text-sm text-slate-300"><span className="text-accent">{t('resources.why')}</span> {t('room.report.why')}</p>
    </Panel>
  );
}
