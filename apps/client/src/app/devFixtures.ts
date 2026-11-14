/**
 * Solo desarrollo: diseños de referencia de los fixtures del motor (`packages/shared/src/__tests__/fixtures/missions`)
 * para el atajo `?play=1&seed=7&mission=<id>`. Se importa con `import()` dentro de `if (import.meta.env.DEV)`, así
 * que no entra en el build de producción.
 */
import type { MissionDesign } from '@payload/shared';

interface Fixture {
  missionId: string;
  valid?: { design: MissionDesign }[];
}

const FIXTURES = import.meta.glob<Fixture>('../../../../packages/shared/src/__tests__/fixtures/missions/*.json', { eager: true, import: 'default' });

/** Primer diseño válido (el de referencia del bot) de una misión, o null si no hay fixture. */
export function referenceDesign(missionId: string): MissionDesign | null {
  for (const f of Object.values(FIXTURES)) if (f.missionId === missionId) return f.valid?.[0]?.design ?? null;
  return null;
}
