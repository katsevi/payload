import { useTranslation } from 'react-i18next';
import type { MissionType } from '@payload/shared';
import { lt } from '../i18n';
import { useSettings } from '../state/settings';
import { MascotAvatar } from './MascotAvatar';
import { dialogueFor, mascotDef, missionHelpTrigger } from './mascotLogic';

/**
 * Consejo fijo de la mascota en el briefing, tomado del diálogo `help:<tipo de misión>` del JSON.
 * No aparece si la mascota está desactivada o el JSON no trae ese diálogo.
 */
export function MascotHint({ missionType }: { missionType: MissionType }) {
  const { t } = useTranslation();
  const enabled = useSettings((s) => s.mascot);
  const mascot = mascotDef();
  const d = enabled ? dialogueFor(missionHelpTrigger(missionType), mascot) : null;
  if (!mascot || !d) return null;
  const name = lt(mascot.name);
  return (
    <div className="mt-4 flex items-start gap-3 rounded border border-line bg-panel-2/60 p-3">
      <MascotAvatar mascot={mascot} expression={d.expression} size={48} label={`${name} · ${t(`mascot.expression.${d.expression}`)}`} />
      <div className="min-w-0">
        <div className="num text-[11px] uppercase tracking-widest text-accent">{t('briefing.mascotTip', { name })}</div>
        <p className="text-sm leading-snug text-slate-100">{lt(d.text)}</p>
      </div>
    </div>
  );
}
