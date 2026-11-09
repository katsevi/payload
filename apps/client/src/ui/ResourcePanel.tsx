import { useTranslation } from 'react-i18next';
import { tr, tu } from '../i18n';
import { useUi } from '../state/ui';
import { Panel, fmt, useBudgets } from './common';

const STATUS_COLOR = { ok: 'bg-ok', tight: 'bg-warn', over: 'bg-bad' } as const;

/** Panel de recursos (Tab): una barra por recurso con margen y su "¿por qué?". */
export function ResourcePanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const report = useBudgets();
  const highlight = useUi((s) => s.highlight);
  return (
    <Panel title={t('resources.title')} className="pointer-events-none w-full max-w-md">
      {!report || report.resources.length === 0 ? (
        <p className="text-sm text-slate-400">{t('hangar.noStructure')}</p>
      ) : (
        <ul className="space-y-3">
          {report.resources.map((r) => {
            const limiting = report.limiting === r.id;
            const focused = highlight === r.id;
            // Rojo solo si está excedido, ámbar si está justo; un limitante sano se marca sin alarma.
            const tone = r.status === 'over' ? 'text-bad' : r.status === 'tight' ? 'text-warn' : 'text-accent';
            const ring = r.status === 'over' ? 'ring-bad' : r.status === 'tight' ? 'ring-warn' : 'ring-accent';
            const pct = r.available > 0 ? Math.min(100, Math.max(0, (r.used / r.available) * 100)) : r.used > 0 ? 100 : 0;
            return (
              <li key={r.id} className={`rounded p-1 ${focused ? 'bg-accent/10 ring-2 ring-accent' : limiting ? `ring-1 ${ring}` : ''}`} aria-current={focused ? 'step' : undefined}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className={limiting ? `font-bold ${tone}` : ''}>
                    {t(`resources.${r.id}`)}
                    {limiting && <span className="ml-2 text-[10px] uppercase">{t('resources.limiting')}</span>}
                    {focused && <span className="ml-2 text-[10px] uppercase text-accent">{t('academy.focus')}</span>}
                  </span>
                  <span className="num">
                    {fmt(r.used)} / {fmt(r.available)} {tu(r.unit)}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded bg-[#0a1424]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`h-full ${STATUS_COLOR[r.status]}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="num mt-0.5 flex justify-between text-[10px] text-slate-400">
                  <span>
                    {t('resources.margin')}: {fmt(r.margin * 100, 0)}%
                  </span>
                  <span>{t(`resources.status.${r.status}`)}</span>
                </div>
                {!compact && (
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-300">
                    <span className="text-accent">{t('resources.why')}</span> {tr(r.why)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
