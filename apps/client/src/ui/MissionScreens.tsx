/**
 * Fase 4: elegir misión y diseñarla en el hangar (Go/No-Go). Todo lo que se pinta sale del catálogo y del
 * motor (`computeDesignBudgets`/`reviewDesign` a través de `game/missionDesign.ts`); el hangar 3D está detrás
 * (`scenes/HangarScene.tsx`). Se juega, no se lee: medidores grandes, una línea por pieza y el «¿por qué?»
 * solo al pasar el ratón o con la tecla H.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowLeft, BatteryCharging, Box, CalendarClock, Circle, CircleCheck, CircleX, Coins, Cpu, Fuel, LayoutGrid, Microscope, Minus, Plus, RadioTower, Rocket,
  Shield, Star, Sun, Thermometer, Weight, Wrench, Zap,
} from 'lucide-react';
import { getDifficulties, getDifficulty, getMission, getMissions, guidedProgress, missionAtDifficulty, type DesignResource, type DesignResourceId, type DesignReview, type MissionDef, type MissionDesign } from '@payload/shared';
import {
  activeGroups, addPart, canLaunch, isGuided, countPart, cycleIndex, destinationOptions, evaluate, groupOfModuleKind, hasSavedDesign, launcherOptions, meterFill, paletteItems,
  partFamily, partKeyAction, partTokens, previewAdd, removePart, setDestination, setDifficulty, setLauncher, sortedIssues, type PaletteGroup, type PartRef, type PartToken,
} from '../game/missionDesign';
import { getRun, useGame } from '../game/runStore';
import { SharedVote } from './CoopScreen';
import i18n, { lt, tr } from '../i18n';
import { useHangar } from '../state/hangar';
import { useUi } from '../state/ui';
import { fmt } from './common';
import { GlossaryButton, GlossaryPanel, useGlossary } from './Glossary';
import { LanguageSelect } from './Screens';

const GROUP_ICON: Record<PaletteGroup, ReactNode> = {
  structure: <Box size={15} />,
  propulsion: <Rocket size={15} />,
  power: <Sun size={15} />,
  battery: <BatteryCharging size={15} />,
  comms: <RadioTower size={15} />,
  computer: <Cpu size={15} />,
  thermal: <Thermometer size={15} />,
  shielding: <Shield size={15} />,
  tank: <Fuel size={15} />,
  extra: <Wrench size={15} />,
  instruments: <Microscope size={15} />,
};

const RESOURCE_ICON: Record<DesignResourceId, ReactNode> = {
  mass: <Weight size={18} />,
  power: <Zap size={18} />,
  cost: <Coins size={18} />,
  schedule: <CalendarClock size={18} />,
  slots: <LayoutGrid size={18} />,
  fuel: <Fuel size={18} />,
};

const STATUS_BAR = { ok: 'bg-accent', tight: 'bg-warn', over: 'bg-bad' } as const;
const STATUS_TEXT = { ok: 'text-slate-100', tight: 'text-warn', over: 'text-bad' } as const;

const partName = (id: string): string => i18n.t(`catalog.${id}`, { ns: 'sim' });
const signed = (v: number): string => (v > 0 ? `+${fmt(v)}` : `−${fmt(Math.abs(v))}`);

// ─── Tarjetas de misión ───────────────────────────────────────────────────────────────────────────

function Difficulty({ level }: { level: number }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-0.5 text-warn" title={t(`missions.difficulty.${Math.max(1, Math.min(3, level))}`)}>
      {[1, 2, 3].map((n) => (
        <Star key={n} size={13} fill={n <= level ? 'currentColor' : 'none'} aria-hidden="true" />
      ))}
      <span className="sr-only">{t(`missions.difficulty.${Math.max(1, Math.min(3, level))}`)}</span>
    </span>
  );
}

function MissionCard({ mission }: { mission: MissionDef }) {
  const { t } = useTranslation();
  const bodies = mission.destinations.map((id) => t(`catalog.${id}`, { ns: 'sim' })).join(' · ');
  const kinds = mission.requirements.requiredKinds.map((k) => t(`design.science.${k}`, { ns: 'sim' })).join(', ');
  return (
    <button
      className="console-panel flex flex-col gap-1.5 p-4 text-left transition hover:border-accent focus-visible:border-accent"
      onClick={() => useGame.getState().openDesign(mission.id)}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-base font-bold text-slate-100">{lt(mission.name)}</span>
        <Difficulty level={mission.difficulty} />
        {mission.guided && <span className="num rounded border border-accent/60 px-1.5 text-[10px] uppercase tracking-wider text-accent">{t('missions.guided')}</span>}
      </span>
      <span className="text-xs text-slate-400">{lt(mission.description)}</span>
      <span className="num text-xs text-accent">{t('missions.destinations', { bodies })}</span>
      <span className="num text-xs text-slate-200">{t('missions.money', { budget: fmt(mission.budgetMUSD, 0), months: fmt(mission.deadlineMonths, 0) })}</span>
      <span className="num text-xs text-slate-200">{t('missions.science', { min: fmt(mission.requirements.minScience, 0), kinds })}</span>
      {hasSavedDesign(mission.id) && <span className="num text-[11px] uppercase tracking-wider text-ok">{t('missions.saved')}</span>}
    </button>
  );
}

export function MissionsScreen() {
  const { t } = useTranslation();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.code === 'Escape' && useGame.getState().toMenu();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center gap-5 overflow-auto bg-black/40 p-4 sm:p-8">
      <div className="flex w-full max-w-5xl items-center justify-between gap-3">
        <button className="btn flex items-center gap-1" onClick={() => useGame.getState().toMenu()}>
          <ArrowLeft size={15} /> {t('common.menu')}
        </button>
        <h1 className="num text-xl uppercase tracking-[0.3em] text-accent">{t('missions.title')}</h1>
        <LanguageSelect />
      </div>
      <div className="grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {getMissions(getRun()?.catalog).map((m) => (
          <MissionCard key={m.id} mission={m} />
        ))}
      </div>
    </div>
  );
}

// ─── Hangar: diseño ───────────────────────────────────────────────────────────────────────────────

function Token({ tk }: { tk: PartToken }) {
  const { t } = useTranslation();
  const params: Record<string, string | number> = { ...tk.params };
  if (typeof params.field === 'string') params.field = t(`shop.field.${params.field}`);
  if (typeof params.kind === 'string') params.kind = t(`design.science.${params.kind}`, { ns: 'sim' });
  if (typeof params.value === 'number') params.value = ['add', 'mult', 'kw', 'pct'].includes(tk.key) ? signed(params.value) : fmt(params.value);
  return <span className={tk.tone === 'gain' ? 'text-ok' : 'text-slate-400'}>{t(`design.part.${tk.key}`, params)}</span>;
}

function PartLine({ part }: { part: PartRef }) {
  const { gains, costs } = useMemo(() => partTokens(part), [part]);
  return (
    <span className="num flex flex-wrap gap-x-2 text-[11px] leading-tight">
      {[...gains, ...costs].map((tk, i) => (
        <Token key={i} tk={tk} />
      ))}
    </span>
  );
}

function Meter({ r, ghost, why }: { r: DesignResource; ghost?: DesignResource; why: boolean }) {
  const { t } = useTranslation();
  const fill = meterFill(r);
  const ghostFill = ghost ? meterFill(ghost) : null;
  const unit = t(`design.unit.${r.unit}`, { ns: 'sim' });
  const digits = r.unit === 'months' ? 1 : 0;
  const line = tr(r.why);
  return (
    <div className="flex flex-col gap-0.5" title={line} role="meter" aria-label={t(`design.resource.${r.id}`, { ns: 'sim' })} aria-valuenow={Math.min(125, Math.round(fill * 100))} aria-valuemin={0} aria-valuemax={125}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className={`flex items-center gap-1.5 ${STATUS_TEXT[r.status]}`}>
          {RESOURCE_ICON[r.id]}
          {t(`design.resource.${r.id}`, { ns: 'sim' })}
        </span>
        <span className={`num text-xs ${STATUS_TEXT[r.status]}`}>
          {t('design.meter', { used: fmt(r.used, digits), available: fmt(r.available, digits), unit })}
        </span>
      </div>
      <div className="relative h-3.5 overflow-hidden rounded-sm bg-black/60 ring-1 ring-line">
        {ghostFill !== null && <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${(Math.min(1.25, ghostFill) / 1.25) * 100}%` }} />}
        <div className={`absolute inset-y-0 left-0 ${STATUS_BAR[r.status]} ${r.status === 'over' ? 'animate-pulse' : ''}`} style={{ width: `${(fill / 1.25) * 100}%` }} />
        {/* La marca blanca es el límite (100 %). */}
        <div className="absolute inset-y-0 w-0.5 bg-white/90" style={{ left: `${100 / 1.25}%` }} />
      </div>
      {why && <p className="text-[11px] leading-tight text-slate-400">{line}</p>}
    </div>
  );
}

function ReviewPanel({ review, onLaunch }: { review: DesignReview; onLaunch: () => void }) {
  const { t } = useTranslation();
  const go = canLaunch(review);
  // Fase 6: en el hangar compartido de una sala no se lanza: se vota (y zarpa el anfitrión).
  const shared = useGame((g) => g.sharedDesign);
  return (
    <div className="console-panel flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="num text-xs uppercase tracking-widest text-slate-400">{t('design.review')}</span>
        <span className={`num text-lg font-bold tracking-widest ${go ? 'text-ok' : 'text-bad'}`}>{go ? t('design.goTitle') : t('design.noGoTitle')}</span>
      </div>
      <ul className="flex max-h-52 flex-col gap-1 overflow-auto text-xs" aria-live="polite">
        {sortedIssues(review).map((x, i) => (
          <li key={`${x.code}-${i}`} className={`flex items-start gap-1.5 ${x.severity === 'blocker' ? 'text-bad' : x.severity === 'warning' ? 'text-warn' : 'text-ok'}`}>
            <span className="mt-px shrink-0">{x.severity === 'blocker' ? <CircleX size={13} /> : x.severity === 'warning' ? <AlertTriangle size={13} /> : <CircleCheck size={13} />}</span>
            <span>{tr(x.message)}</span>
          </li>
        ))}
      </ul>
      {shared ? (
        <SharedVote />
      ) : (
        <button className="btn btn-primary flex items-center justify-center gap-2 !py-3 text-base" disabled={!go} onClick={onLaunch}>
          <Rocket size={17} /> {go ? t('design.launch') : t('design.launchBlocked')}
        </button>
      )}
    </div>
  );
}

function Pickers({ design, mission, update }: { design: MissionDesign; mission: MissionDef; update: (d: MissionDesign) => void }) {
  const { t } = useTranslation();
  const dests = destinationOptions(mission);
  // Fase 5: en la misión guiada el lanzador es fijo (solo se enseña el suyo).
  const launchers = launcherOptions(design).filter((l) => !mission.guided || l.launcherId === mission.guided.launcherId);
  const pill = (on: boolean) => `num rounded border px-2 py-1 text-left text-xs ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-black/40 text-slate-200 hover:border-accent/60'}`;
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={t('design.destination')} className="flex flex-wrap items-center gap-1.5">
        <span className="num w-20 text-[11px] uppercase tracking-widest text-slate-400">{t('design.destination')}</span>
        {dests.map((d) => (
          <button key={d.bodyId} role="radio" aria-checked={design.destinationId === d.bodyId} className={pill(design.destinationId === d.bodyId)} onClick={() => update(setDestination(design, d.bodyId))}>
            <span className="font-bold">{t(`catalog.${d.bodyId}`, { ns: 'sim' })}</span>{' '}
            <span className="text-slate-400">{t('design.destOption', { au: fmt(d.au, 2), pct: d.solarPct })}</span>
          </button>
        ))}
      </div>
      {/* Fase 5: nivel de dificultad (presupuesto, plazo, ciencia pedida y, en vuelo, averías, peligros y ventanas). */}
      <div role="radiogroup" aria-label={t('design.difficulty')} className="flex flex-wrap items-center gap-1.5">
        <span className="num w-20 text-[11px] uppercase tracking-widest text-slate-400">{t('design.difficulty')}</span>
        {getDifficulties().map((d) => {
          const on = getDifficulty(design.difficultyId).id === d.id;
          return (
            <button key={d.id} role="radio" aria-checked={on} className={pill(on)} title={t('design.difficultyHint')} onClick={() => update(setDifficulty(design, d.id))}>
              <span className="font-bold">{t(`catalog.${d.id}`, { ns: 'sim' })}</span>
            </button>
          );
        })}
      </div>
      <div role="radiogroup" aria-label={t('design.launcher')} className="flex flex-wrap items-center gap-1.5">
        <span className="num w-20 text-[11px] uppercase tracking-widest text-slate-400">{t('design.launcher')}</span>
        {launchers.map((l) => (
          <button
            key={l.launcherId}
            role="radio"
            aria-checked={design.launcherId === l.launcherId}
            className={pill(design.launcherId === l.launcherId)}
            title={t('design.launcherOption', { cost: fmt(l.costMUSD, 0), months: fmt(l.waitMonths, 0), pct: l.reliabilityPct })}
            onClick={() => update(setLauncher(design, l.launcherId))}
          >
            <span className="font-bold">{t(`catalog.${l.launcherId}`, { ns: 'sim' })}</span>{' '}
            <span className="text-slate-400">{t('design.musd', { value: fmt(l.costMUSD, 0) })}</span>{' '}
            <span className={l.capacityKg === null ? 'text-bad' : l.capacityKg === undefined ? 'text-slate-500' : 'text-ok'}>
              {l.capacityKg === null ? t('design.launcherNoReach') : l.capacityKg === undefined ? t('design.launcherNoDest') : t('design.launcherCap', { t: fmt(l.capacityKg / 1000, 1) })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Palette({ design, update, budgetsNow }: { design: MissionDesign; update: (d: MissionDesign) => void; budgetsNow: DesignReview['budgets'] }) {
  const { t } = useTranslation();
  const groups = useMemo(() => activeGroups(undefined, design.missionId), [design.missionId]);
  const [group, setGroup] = useState<PaletteGroup>(groups[0] ?? 'structure');
  const items = useMemo(() => paletteItems(group, undefined, design.missionId), [group, design.missionId]);
  const breaks = useMemo(() => items.map((p) => previewAdd(design, p, undefined, budgetsNow).breaks), [items, design, budgetsNow]);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Foco inicial en la primera pieza de la paleta: el hangar se juega también solo con teclado.
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);
  const setHover = useHangar((h) => h.setHover);
  const mountedIn = (g: PaletteGroup): number =>
    g === 'instruments' ? design.instrumentIds.length : design.moduleIds.filter((id) => {
      const fam = partFamily({ kind: 'module', id });
      return fam !== null && fam !== 'instrument' && groupOfModuleKind(fam) === g;
    }).length;

  // Al cambiar de grupo con las flechas, el foco pasa a la primera pieza del grupo nuevo (tras pintarlo).
  const focusFirst = useRef(false);
  useEffect(() => {
    if (!focusFirst.current) return;
    focusFirst.current = false;
    refs.current[0]?.focus();
  }, [group]);
  const switchGroup = (key: string) => {
    const i = groups.indexOf(group);
    const g = groups[cycleIndex(i, groups.length, key)] ?? group;
    focusFirst.current = true;
    setGroup(g);
  };

  const onKey = (e: React.KeyboardEvent, i: number, part: PartRef) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      refs.current[cycleIndex(i, items.length, e.key)]?.focus();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      switchGroup(e.key);
      return;
    }
    const act = partKeyAction(e.key);
    if (act === 'remove' || (act === 'add' && e.key !== 'Enter')) {
      e.preventDefault();
      update(act === 'add' ? addPart(design, part) : removePart(design, part));
    }
  };

  return (
    <div className="console-panel flex min-h-0 flex-col gap-2 p-3">
      <div className="num text-xs uppercase tracking-widest text-accent">{t('design.palette')}</div>
      <div role="tablist" className="flex flex-wrap gap-1">
        {groups.map((g) => {
          const n = mountedIn(g);
          return (
            <button
              key={g}
              role="tab"
              aria-selected={g === group}
              title={t(`design.group.${g}`)}
              className={`num flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] ${g === group ? 'border-accent bg-accent/15 text-accent' : 'border-line text-slate-300 hover:border-accent/60'}`}
              onClick={() => setGroup(g)}
            >
              {GROUP_ICON[g]}
              <span className={g === group ? '' : 'hidden xl:inline'}>{t(`design.group.${g}`)}</span>
              {n > 0 && <span className="rounded bg-accent/25 px-1 text-accent">{n}</span>}
            </button>
          );
        })}
      </div>
      <ul className="flex min-h-0 flex-col gap-1.5 overflow-auto pr-1" role="list">
        {items.map((part, i) => {
          const n = countPart(design, part);
          const name = partName(part.id);
          const br = breaks[i] ?? [];
          return (
            <li key={part.id} className={`flex items-stretch gap-1 rounded border ${n > 0 ? 'border-accent/60 bg-accent/5' : 'border-line bg-black/30'}`}>
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left focus-visible:outline focus-visible:outline-accent"
                aria-label={t('design.add', { part: name })}
                title={br.length > 0 ? t('design.breaks', { resources: br.map((id) => t(`design.resource.${id}`, { ns: 'sim' })).join(', ') }) : undefined}
                onClick={() => update(addPart(design, part))}
                onKeyDown={(e) => onKey(e, i, part)}
                onPointerEnter={() => setHover(part)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(part)}
                onBlur={() => setHover(null)}
              >
                <span className="flex items-center gap-1.5 text-sm text-slate-100">
                  <Plus size={13} className="shrink-0 text-accent" aria-hidden="true" />
                  <span className="truncate">{name}</span>
                  {n > 0 && <span className="num rounded bg-accent/25 px-1 text-xs text-accent">×{n}</span>}
                  {br.length > 0 && <AlertTriangle size={13} className="shrink-0 text-bad" aria-hidden="true" />}
                </span>
                <PartLine part={part} />
              </button>
              {n > 0 && (
                <button className="flex items-center px-2 text-slate-300 hover:text-bad" aria-label={t('design.remove', { part: name })} onClick={() => update(removePart(design, part))}>
                  <Minus size={15} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="num text-[10px] text-slate-500">{t('design.keys')}</p>
    </div>
  );
}

/** Fase 5: pasos de la misión guiada, una línea cada uno, que se marcan solos (el siguiente pendiente, resaltado). */
function GuidedSteps({ steps }: { steps: ReturnType<typeof guidedProgress> }) {
  const { t } = useTranslation();
  const next = steps.findIndex((s) => !s.done);
  return (
    <ol className="console-panel flex flex-col gap-1 p-2 text-xs" aria-label={t('design.guidedSteps')}>
      {steps.map((s, i) => (
        <li key={s.check} className={`flex items-center gap-1.5 ${s.done ? 'text-ok' : i === next ? 'font-bold text-accent' : 'text-slate-400'}`}>
          {s.done ? <CircleCheck size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}
          <span>{lt(s.text)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Piezas montadas: un chip por pieza (×N); clic = quitar una. */
function Mounted({ design, update }: { design: MissionDesign; update: (d: MissionDesign) => void }) {
  const { t } = useTranslation();
  // Fase 5: en la misión guiada la nave es fija; solo se ve (y se quita) la carga.
  const guided = isGuided(design.missionId);
  const chips: { part: PartRef; n: number }[] = [];
  for (const [kind, list] of [['module', guided ? [] : design.moduleIds], ['instrument', design.instrumentIds]] as const) {
    for (const id of list) {
      const at = chips.find((c) => c.part.kind === kind && c.part.id === id);
      if (at) at.n++;
      else chips.push({ part: { kind, id }, n: 1 });
    }
  }
  if (chips.length === 0) return <p className="console-panel px-3 py-2 text-sm text-slate-300">{t('design.empty')}</p>;
  return (
    <div className="console-panel flex max-w-full flex-wrap items-center gap-1 px-2 py-1.5">
      <span className="num mr-1 text-[10px] uppercase tracking-widest text-slate-400">{t('design.mounted')}</span>
      {chips.map(({ part, n }) => {
        const name = partName(part.id);
        return (
          <button key={`${part.kind}:${part.id}`} className="num flex items-center gap-1 rounded border border-line bg-black/40 px-1.5 py-0.5 text-[11px] text-slate-200 hover:border-bad hover:text-bad" aria-label={t('design.remove', { part: name })} title={t('design.remove', { part: name })} onClick={() => update(removePart(design, part))}>
            {name}
            {n > 1 && <span className="text-accent">×{n}</span>}
            <Minus size={11} aria-hidden="true" />
          </button>
        );
      })}
      <button className="btn ml-auto !px-2 !py-0.5 text-[11px]" onClick={() => update({ ...design, moduleIds: guided ? design.moduleIds : [], instrumentIds: [] })}>
        {t('design.clear')}
      </button>
    </div>
  );
}

export function DesignScreen() {
  const { t } = useTranslation();
  const design = useGame((g) => g.draft);
  const [why, setWhy] = useState(false);
  const [glossary, setGlossary] = useGlossary();
  const hover = useHangar((h) => h.hover);
  const review = useMemo(() => (design ? evaluate(design) : null), [design]);
  const preview = useMemo(() => (design && hover && review ? previewAdd(design, hover, undefined, review.budgets).budgets : null), [design, hover, review]);
  // Fase 6: hangar compartido de una sala («volver» lleva a la sala).
  const shared = useGame((g) => g.sharedDesign);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (useUi.getState().overlay) return;
      if (e.code === 'KeyH' && !e.repeat) setWhy((w) => !w);
      if (e.code === 'Escape') useGame.getState().openMissions();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => () => useHangar.getState().setHover(null), []);

  if (!design || !review) return null;
  let mission: MissionDef;
  try {
    // Fase 5: con las cifras de su nivel de dificultad (presupuesto, plazo y ciencia pedida).
    mission = missionAtDifficulty(getMission(design.missionId), getDifficulty(design.difficultyId));
  } catch {
    return null;
  }
  const steps = guidedProgress(design);
  const update = (d: MissionDesign) => useGame.getState().updateDraft(d);
  const totals = review.budgets.totals;
  const sciOk = totals.scienceValue >= mission.requirements.minScience;
  const relOk = mission.requirements.minReliabilityPct === undefined || totals.reliabilityPct >= mission.requirements.minReliabilityPct;
  return (
    <div className="absolute inset-0 z-10 flex flex-col gap-2 overflow-auto p-2 sm:p-3 lg:overflow-hidden">
      {/* Arriba: volver, misión, destino y lanzador. */}
      <header className="console-panel flex flex-col gap-2 p-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <button className="btn flex shrink-0 items-center gap-1" onClick={() => useGame.getState().openMissions()}>
            <ArrowLeft size={15} /> {shared ? t('design.backToRoom') : t('design.back')}
          </button>
          <div className="min-w-0">
            <h1 className="num truncate text-base uppercase tracking-widest text-accent">{t('design.title', { mission: lt(mission.name) })}</h1>
            <p className="truncate text-xs text-slate-400">{lt(mission.description)}</p>
          </div>
        </div>
        <Pickers design={design} mission={mission} update={update} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className="flex min-h-0 w-full flex-col lg:w-[22rem]">
          <Palette design={design} update={update} budgetsNow={review.budgets} />
        </div>

        {/* Centro: la nave montada (la escena 3D está detrás) y las piezas montadas. */}
        <div className="pointer-events-none flex min-h-48 flex-1 flex-col justify-between gap-2">
          <div className="pointer-events-auto flex flex-col items-start gap-2">
            {steps.length > 0 && <GuidedSteps steps={steps} />}
            <GlossaryButton open={glossary} onToggle={() => setGlossary((g) => !g)} />
            {glossary && <GlossaryPanel onClose={() => setGlossary(false)} />}
          </div>
          <div className="pointer-events-auto">
            <Mounted design={design} update={update} />
          </div>
        </div>

        <aside className="flex w-full flex-col gap-2 overflow-auto lg:w-[21rem]">
          <div className="console-panel flex flex-col gap-2.5 p-3">
            <div className="flex items-center justify-between">
              <span className="num text-xs uppercase tracking-widest text-accent">{t('design.budgets')}</span>
              <button className="num text-[11px] text-slate-400 hover:text-accent" onClick={() => setWhy((w) => !w)} aria-pressed={why}>
                {why ? t('design.whyOn') : t('design.whyOff')}
              </button>
            </div>
            {review.budgets.resources.map((r) => (
              <Meter key={r.id} r={r} ghost={preview?.resources.find((x) => x.id === r.id)} why={why} />
            ))}
            <div className="num flex items-center justify-between gap-2 border-t border-line pt-2 text-xs">
              <span className={sciOk ? 'text-ok' : 'text-bad'}>
                <Microscope size={13} className="mr-1 inline" aria-hidden="true" />
                {t('design.science', { value: fmt(totals.scienceValue, 0), required: fmt(mission.requirements.minScience, 0) })}
              </span>
              <span className={relOk ? 'text-slate-300' : 'text-warn'}>{t('design.reliability', { pct: fmt(totals.reliabilityPct, 0) })}</span>
            </div>
          </div>
          <ReviewPanel review={review} onLaunch={() => useGame.getState().launch()} />
        </aside>
      </div>
    </div>
  );
}
