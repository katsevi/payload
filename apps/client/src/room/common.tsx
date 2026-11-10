import { useTranslation } from 'react-i18next';
import type { TeamRole } from '@payload/shared';
import { roleColor } from './roomUiLogic';

/** Chip de rol con su color (texto + borde: no depende solo del color). */
export function RoleChip({ role, small = false }: { role: TeamRole; small?: boolean }) {
  const { t } = useTranslation();
  const c = roleColor(role);
  return (
    <span
      className={`num inline-flex items-center gap-1 rounded border px-1.5 ${small ? 'text-[10px]' : 'text-xs'} uppercase tracking-wide`}
      style={{ borderColor: c, color: c }}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {t(`room.role.${role}`)}
    </span>
  );
}

export const inputCls = 'w-full rounded border border-line bg-[#0a1424] p-2 text-sm text-slate-100';
